"""风险排查报告。

结论只来自这次检索到的公开标题。标题里出现某个词，只说明标题这么写，不代表已经核实。
没有配置模型时，用同一份核对清单写备忘。配置了模型后，模型只能解释这份清单，不能另补公告。
"""

from __future__ import annotations

import json
import re

import requests
from django.conf import settings

from .quotes import Headline

DISCLAIMER = "这些文字只供小群讨论，不是投资建议，也不代表价格会涨或会跌。监管和新闻请以交易所、公司和原文为准。"

CHECKLIST = (
    ("监管问询", "regulatory", ("问询函", "关注函", "监管函", "监管工作函")),
    ("立案或处罚", "regulatory", ("立案", "行政处罚", "处罚决定", "通报批评", "责令改正", "证监会")),
    ("异常波动核查", "regulatory", ("异常波动", "停牌核查")),
    ("股东减持", "negative", ("减持",)),
    ("诉讼仲裁", "negative", ("诉讼", "仲裁", "起诉", "被执行")),
    ("业绩风险", "negative", ("预亏", "预减", "首亏", "业绩变脸", "由盈转亏", "业绩下滑")),
    ("诚信与偿债", "negative", ("造假", "暴雷", "违约", "失信")),
    ("退市风险", "negative", ("退市", "*ST", "被ST", "实施ST")),
    ("股权质押", "other", ("质押",)),
    ("限售解禁", "other", ("解禁",)),
)

SYSTEM = """你是证券信息整理助手。只根据用户给出的行情、新闻标题和已经标好的排查结果写报告。
排查结果来自标题关键词，不是已经核实的公告。
不要新增排查结果里没有的问询、立案、减持、诉讼、业绩、金额或机构。
不要给出买入、卖出、持有或目标价。
只输出一个 JSON 对象，不要使用 Markdown。字段为 summary、regulatory、negative_news、other_risks。
summary 不超过 120 字。other_risks 最多 3 条短句，只复述排查结果。"""


def _clip(value, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _hits(headlines: list[Headline], words: tuple[str, ...]) -> list[str]:
    found = []
    for item in headlines:
        title = item.title.strip()
        if title and any(word in title for word in words) and title not in found:
            found.append(title)
        if len(found) >= 2:
            break
    return found


def scan_headlines(headlines: list[Headline]) -> list[dict]:
    """按固定清单标出标题里有没有这些词。没有标题时全部标成无法核对。"""
    checks = []
    for name, group, words in CHECKLIST:
        evidence = _hits(headlines, words)
        if not headlines:
            status = "unknown"
        elif evidence:
            status = "seen"
        else:
            status = "unseen"
        checks.append({"name": name, "group": group, "status": status, "evidence": evidence})
    return checks


def stance_of(checks: list[dict]) -> str:
    if any(item.get("status") == "seen" for item in checks):
        return "attention"
    if not checks or all(item.get("status") == "unknown" for item in checks):
        return "unknown"
    return "quiet"


def _names(checks: list[dict]) -> str:
    return "、".join(item["name"] for item in checks)


def _section(hits: list[dict], quiet: str) -> str:
    if not hits:
        return quiet
    parts = []
    for item in hits:
        title = item["evidence"][0] if item["evidence"] else ""
        parts.append(f"{item['name']}（{title}）" if title else item["name"])
    return "标题中出现：" + "；".join(parts) + "。这只说明标题里有这些词，原文尚未核对。"


def prose_from_scan(name: str, code: str, checks: list[dict], *, configured: bool) -> dict:
    label = f"{name}（{code}）" if name else code
    regulatory_hits = [item for item in checks if item["group"] == "regulatory" and item["status"] == "seen"]
    negative_hits = [item for item in checks if item["group"] == "negative" and item["status"] == "seen"]
    other_hits = [item for item in checks if item["group"] == "other" and item["status"] == "seen"]
    missing = not checks or all(item["status"] == "unknown" for item in checks)
    if missing:
        summary = f"{label}这次没有检索到公开标题，不能判断是否涉及监管或负面新闻。"
        regulatory = "没有标题可供核对。问询、立案、处罚和异常波动都无法从这次检索里确认。"
        negative = "没有标题可供核对。减持、诉讼、业绩、诚信和退市都无法从这次检索里确认。"
        other_risks = ["没有检索到公开标题", "行情可能延迟"]
    elif regulatory_hits or negative_hits or other_hits:
        summary = f"{label}的公开标题里出现了{_names(regulatory_hits + negative_hits + other_hits)}。这只说明标题写了这些词，原文尚未核对。"
        regulatory = _section(regulatory_hits, "这些标题里没有出现问询函、立案、处罚或异常波动核查。")
        negative = _section(negative_hits, "这些标题里没有出现减持、诉讼、业绩风险、造假违约或退市。")
        other_risks = [f"{item['name']}：{item['evidence'][0]}" for item in other_hits] or ["标题里没有看到质押或解禁"]
    else:
        summary = f"{label}已核对公开标题，没有看到监管或明确负面关键词。"
        regulatory = "这些标题里没有出现问询函、立案、处罚或异常波动核查。"
        negative = "这些标题里没有出现减持、诉讼、业绩风险、造假违约或退市。"
        other_risks = ["标题里没有看到质押或解禁"]
    if not configured:
        summary = f"没有配置分析模型。{summary}"
    return {
        "summary": _clip(summary, 180),
        "regulatory": regulatory,
        "negative_news": negative,
        "other_risks": other_risks[:3],
        "checks": checks,
        "stance": stance_of(checks),
        "source": "unconfigured" if not configured else "rules",
        "model": "",
    }


def unconfigured_report(name: str, code: str) -> dict:
    return prose_from_scan(name, code, scan_headlines([]), configured=False)


def fallback_report(base: dict, model: str) -> dict:
    report = dict(base)
    report["summary"] = _clip(f"模型这次没有返回可用结果。{base['summary']}", 180)
    report["source"] = "fallback"
    report["model"] = model
    return report


def _extract_json(text: str) -> dict:
    raw = text.strip()
    raw = re.sub(r"^```(?:json)?", "", raw).strip()
    raw = re.sub(r"```$", "", raw).strip()
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no json")
    payload = json.loads(raw[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError("not object")
    return payload


def _model_risks(payload: dict) -> list[str]:
    risks = payload.get("other_risks")
    if not isinstance(risks, list):
        return []
    clean = []
    for item in risks:
        text = _clip(item, 80)
        if text and text not in clean:
            clean.append(text)
        if len(clean) >= 3:
            break
    return clean


def current_ai_api_key() -> str:
    """已保存的密钥优先。还没有保存过时，沿用环境变量。"""
    from .models import SiteSetting

    row = SiteSetting.objects.filter(pk=1).first()
    if row is None:
        return (settings.AI_API_KEY or "").strip()
    return row.ai_api_key.strip()


def _user_prompt(name: str, code: str, quote_text: str, headlines: list[Headline], checks: list[dict]) -> str:
    lines = [
        f"股票：{name or '未知'} {code}",
        f"行情：{quote_text or '暂无'}",
        "标题：",
    ]
    if headlines:
        lines.extend(f"- {item.published_at} {item.media} {item.title}" for item in headlines)
    else:
        lines.append("- 没有检索到标题")
    lines.append("排查结果（只来自标题关键词，seen 表示标题中出现，unseen 表示未出现，unknown 表示没有标题）：")
    for item in checks:
        evidence = "、".join(item["evidence"]) if item["evidence"] else "无"
        lines.append(f"- {item['name']} {item['status']} {evidence}")
    return "\n".join(lines)


def build_report(
    name: str,
    code: str,
    quote_text: str,
    headlines: list[Headline],
    *,
    api_key: str | None = None,
) -> dict:
    checks = scan_headlines(headlines)
    if api_key is None:
        api_key = current_ai_api_key()
    base = prose_from_scan(name, code, checks, configured=bool(api_key))
    if not api_key:
        return base
    try:
        response = requests.post(
            settings.AI_BASE_URL.rstrip("/") + "/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.AI_MODEL,
                "temperature": 0.2,
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": _user_prompt(name, code, quote_text, headlines, checks)},
                ],
            },
            timeout=(5, 20),
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        payload = _extract_json(content)
        risks = _model_risks(payload)
        base["summary"] = _clip(payload.get("summary"), 180) or base["summary"]
        base["regulatory"] = _clip(payload.get("regulatory"), 400) or base["regulatory"]
        base["negative_news"] = _clip(payload.get("negative_news"), 400) or base["negative_news"]
        if risks:
            base["other_risks"] = risks
        base["source"] = "model"
        base["model"] = settings.AI_MODEL
        return base
    except (requests.RequestException, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
        return fallback_report(base, settings.AI_MODEL)
