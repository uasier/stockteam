import { useEffect, useState, type FormEvent } from "react"
import { api } from "./api"
import { fetchHeadlines, fetchLiveQuotes } from "./market"
import { UserAvatar } from "./UserAvatar"
import {
  feedKindLabel,
  feedKindTone,
  formatClock,
  formatDate,
  formatDateTime,
  formatPct,
  formatPrice,
  getMarketLabel,
  groupTimeline,
  riskSourceLabel,
  riskStanceLabel,
  riskStatusLabel,
  tone,
} from "./format"
import {
  IconAlertTriangle,
  IconBriefcase,
  IconClock,
  IconExternalLink,
  IconHeart,
  IconMessageSquare,
  IconNewspaper,
  IconRefresh,
  IconShield,
  IconSparkles,
  IconThumbsUp,
  IconX,
} from "./Icons"
import { openTonghuashunStock } from "../openStock"
import { formatTimeAgo } from "../time"
import type { Activity, Comment, RiskReport, StockDetail } from "./types"

type TabType = "trade" | "timeline" | "risk" | "comments"

type Props = {
  code: string
  onClose: () => void
  onChanged: () => Promise<void>
  notify: (text: string, type?: "success" | "error" | "info") => void
}

export function DetailSheet({ code, onClose, onChanged, notify }: Props) {
  const [detail, setDetail] = useState<StockDetail | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [timeline, setTimeline] = useState<Activity[]>([])
  const [risk, setRisk] = useState<RiskReport | null>(null)
  const [riskState, setRiskState] = useState<"loading" | "ready" | "error">("loading")
  const [activeTab, setActiveTab] = useState<TabType>("trade")

  // 表单状态
  const [commentText, setCommentText] = useState("")
  const [cost, setCost] = useState("")
  const [sellPrice, setSellPrice] = useState("")
  const [tagDraft, setTagDraft] = useState("")
  const [customPrice, setCustomPrice] = useState("")
  const [customDate, setCustomDate] = useState("")
  const [pending, setPending] = useState("")

  async function load() {
    const [nextDetail, nextComments, nextTimeline] = await Promise.all([
      api.stock(code),
      api.comments(code),
      api.timeline(code),
    ])
    setDetail(nextDetail)
    setComments(nextComments.items)
    setTimeline(nextTimeline.items)
    setCustomPrice(nextDetail.watch?.custom_price ?? "")
    setCustomDate(nextDetail.watch?.custom_date ?? "")
    setSellPrice(nextDetail.stock.price ?? nextDetail.holding?.cost_price ?? "")
    setCost((current) => current || nextDetail.stock.price || "")
  }

  useEffect(() => {
    let alive = true
    setDetail(null)
    setTimeline([])
    setRisk(null)
    setRiskState("loading")
    setCost("")
    setCommentText("")
    load().catch((err: unknown) => {
      if (alive) notify(err instanceof Error ? err.message : "获取股票详情失败", "error")
    })
    api
      .risk(code)
      .then(async (report) => {
        if (!alive) return
        if (report.source !== "pending") {
          setRisk(report)
          setRiskState("ready")
          return
        }
        const quotes = await fetchLiveQuotes([code]).catch(() => [])
        const name = quotes[0]?.name || code
        const headlines = await fetchHeadlines(`${name} ${code}`)
        const price = quotes[0]?.price
        const quoteText = price ? `现价 ${price}，涨跌幅 ${quotes[0]?.change_pct ?? ""}%` : "暂无现价"
        const next = await api.refreshRisk(code, { headlines, quote_text: quoteText })
        if (!alive) return
        setRisk(next)
        setRiskState("ready")
      })
      .catch(() => {
        if (alive) setRiskState("error")
      })

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      alive = false
      window.removeEventListener("keydown", onKey)
    }
  }, [code])

  async function run(name: string, action: () => Promise<void>) {
    setPending(name)
    try {
      await action()
      await load()
      await onChanged()
    } catch (err) {
      notify(err instanceof Error ? err.message : "操作未完成", "error")
    } finally {
      setPending("")
    }
  }

  const stock = detail?.stock
  const watch = detail?.watch
  const holding = detail?.holding
  const market = getMarketLabel(code)
  const isUp = tone(stock?.change_pct) === "up"
  const isDown = tone(stock?.change_pct) === "down"

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <aside
        className="sheet-container"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 移动端底部抽屉拖动手柄 */}
        <div className="sheet-drag-handle-wrap" onClick={onClose}>
          <div className="sheet-drag-handle-bar" />
        </div>

        {/* 顶部标题栏 */}
        <header className="sheet-header">
          <div className="sheet-header-main">
            <div className="sheet-code-row">
              <span className="market-tag">{market}</span>
              <span className="sheet-stock-code num">{stock?.code || code}</span>
            </div>
            <h2 className="sheet-stock-name">{stock?.name || "加载中..."}</h2>
          </div>
          <div className="sheet-header-actions">
            <button
              type="button"
              className="sheet-icon-btn"
              onClick={() => openTonghuashunStock(code)}
              title="前往同花顺查看"
            >
              <IconExternalLink size={17} />
            </button>
            <button
              type="button"
              className={`sheet-icon-btn ${pending === "refresh" ? "spin" : ""}`}
              disabled={pending === "refresh"}
              onClick={() =>
                run("refresh", async () => {
                  const quotes = await fetchLiveQuotes([code])
                  if (quotes.length === 0) throw new Error("行情暂时没有取到")
                  await api.saveQuotes(quotes)
                  notify("行情已刷新", "success")
                })
              }
              title="刷新实时行情"
            >
              <IconRefresh size={17} />
            </button>
            <button type="button" className="sheet-icon-btn close-btn" onClick={onClose} aria-label="关闭">
              <IconX size={19} />
            </button>
          </div>
        </header>

        {/* 核心行情卡片 */}
        {stock ? (
          <div className={`quote-hero-card ${tone(stock.change_pct)}`}>
            <div className="quote-hero-left">
              <div className="hero-price-line">
                <span className="currency-symbol">¥</span>
                <span className="hero-price num">{formatPrice(stock.price)}</span>
              </div>
              <div className="hero-change-row">
                <span className={`hero-pct-badge ${tone(stock.change_pct)} num`}>
                  {formatPct(stock.change_pct)}
                </span>
                <span className="hero-time">
                  <IconClock size={12} />
                  {stock.quoted_at ? `${formatTimeAgo(stock.quoted_at)}更新` : "行情同步中"}
                </span>
              </div>
            </div>

            <div className="quote-hero-right">
              <button
                type="button"
                className={`like-hero-btn ${stock.liked ? "liked" : ""}`}
                disabled={pending === "like"}
                onClick={() =>
                  run("like", async () => {
                    await api.likeStock(code)
                  })
                }
              >
                <IconHeart size={16} fill={stock.liked ? "currentColor" : "none"} />
                <span>+1 关注 ({stock.attention ?? 0})</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="quote-hero-skeleton animate-pulse" />
        )}

        {/* 盘口 4 核心指标 */}
        <div className="market-metrics-grid">
          <div className="metric-box">
            <span className="metric-label">今开</span>
            <span className="metric-value num">{formatPrice(stock?.open)}</span>
          </div>
          <div className="metric-box">
            <span className="metric-label">最高</span>
            <span className={`metric-value num ${isUp ? "up" : ""}`}>{formatPrice(stock?.high)}</span>
          </div>
          <div className="metric-box">
            <span className="metric-label">最低</span>
            <span className={`metric-value num ${isDown ? "down" : ""}`}>{formatPrice(stock?.low)}</span>
          </div>
          <div className="metric-box">
            <span className="metric-label">昨收</span>
            <span className="metric-value num">{formatPrice(stock?.prev_close)}</span>
          </div>
        </div>

        {/* 选项卡导航 */}
        <div className="sheet-nav-tabs">
          <button
            type="button"
            className={`sheet-tab-btn ${activeTab === "trade" ? "active" : ""}`}
            onClick={() => setActiveTab("trade")}
          >
            <IconBriefcase size={15} />
            <span>交易与自选</span>
          </button>
          <button
            type="button"
            className={`sheet-tab-btn ${activeTab === "timeline" ? "active" : ""}`}
            onClick={() => setActiveTab("timeline")}
          >
            <IconClock size={15} />
            <span>时间轴 ({timeline.length})</span>
          </button>
          <button
            type="button"
            className={`sheet-tab-btn ${activeTab === "risk" ? "active" : ""}`}
            onClick={() => setActiveTab("risk")}
          >
            <IconShield size={15} />
            <span>AI 风险透视</span>
          </button>
          <button
            type="button"
            className={`sheet-tab-btn ${activeTab === "comments" ? "active" : ""}`}
            onClick={() => setActiveTab("comments")}
          >
            <IconMessageSquare size={15} />
            <span>群友发言 ({comments.length})</span>
          </button>
        </div>

        {/* 抽屉内容主体 */}
        <div className="sheet-body-scroll">
          {/* TAB 1: 交易与自选 */}
          {activeTab === "trade" && (
            <div className="tab-pane animate-fade-in">
              {/* 自选配置卡片 */}
              <div className="card-section">
                {(detail?.watchers.length ?? 0) > 0 && (
                  <p className="watch-people-line">
                    {detail?.watchers.map((item) => item.user.username).join("、")} 已加入自选
                  </p>
                )}
                <div className="section-head">
                  <div className="section-title">
                    <IconSparkles size={16} />
                    <span>自选状态</span>
                  </div>
                  {watch && (
                    <button
                      type="button"
                      className="text-danger-btn"
                      onClick={() =>
                        run("remove", async () => {
                          await api.removeWatch(watch.id)
                          notify("已移出观察列表", "info")
                        })
                      }
                    >
                      移出观察
                    </button>
                  )}
                </div>

                {watch ? (
                  <div className="watch-config-box">
                    <div className="two-col-inputs">
                      <div className="form-item">
                        <label>自选标记价格 (元)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={customPrice}
                          onChange={(e) => setCustomPrice(e.target.value)}
                          placeholder="如入选时的价格"
                        />
                      </div>
                      <div className="form-item">
                        <label>自选日期</label>
                        <input
                          type="date"
                          value={customDate}
                          onChange={(e) => setCustomDate(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="watch-save-row">
                      <button
                        type="button"
                        className="btn-pill-save"
                        disabled={pending === "watch"}
                        onClick={() =>
                          run("watch", async () => {
                            await api.updateWatch(watch.id, {
                              custom_price: customPrice,
                              custom_date: customDate,
                            })
                            notify("自选信息已更新", "success")
                          })
                        }
                      >
                        {pending === "watch" ? "保存中..." : "保存自选设置"}
                      </button>
                    </div>

                    {/* 自定义标签 */}
                    <div className="tags-manager">
                      <label>分类标签 (自定义)</label>
                      <div className="tags-flow">
                        {watch.tags.map((tag) => (
                          <span key={tag} className="tag-chip">
                            <span>{tag}</span>
                            <button
                              type="button"
                              onClick={() =>
                                run("tag", async () => {
                                  await api.updateWatch(watch.id, {
                                    tag_names: watch.tags.filter((item) => item !== tag),
                                  })
                                })
                              }
                              title="删除标签"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <form
                          className="tag-input-form"
                          onSubmit={(e) => {
                            e.preventDefault()
                            const name = tagDraft.trim()
                            if (!name) return
                            if (watch.tags.includes(name)) {
                              notify("标签已存在", "info")
                              return
                            }
                            run("tag", async () => {
                              await api.updateWatch(watch.id, {
                                tag_names: [...watch.tags, name],
                              })
                              setTagDraft("")
                            })
                          }}
                        >
                          <input
                            value={tagDraft}
                            onChange={(e) => setTagDraft(e.target.value)}
                            placeholder="+ 新标签 (按回车)"
                            maxLength={10}
                          />
                        </form>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="empty-add-watch">
                    <p>
                      {(detail?.watchers.length ?? 0) > 0
                        ? "小群已有人在观察，跟进后不记录自选价格"
                        : "该股票目前未加入你的观察列表"}
                    </p>
                    <button
                      type="button"
                      className="btn-primary-gradient"
                      disabled={pending === "add"}
                      onClick={() =>
                        run("add", async () => {
                          const joining = (detail?.watchers.length ?? 0) > 0
                          await api.addWatch(code)
                          notify(joining ? "已跟进观察" : "已放入观察列表", "success")
                        })
                      }
                    >
                      {pending === "add"
                        ? "加入中..."
                        : (detail?.watchers.length ?? 0) > 0
                          ? "跟进观察"
                          : "+ 立即加入观察"}
                    </button>
                  </div>
                )}
              </div>

              {/* 持仓记账卡片 */}
              <div className="card-section">
                <div className="section-head">
                  <div className="section-title">
                    <IconBriefcase size={16} />
                    <span>{holding ? "我的持仓头寸" : "记一笔买入持仓"}</span>
                  </div>
                </div>

                {holding ? (
                  <div className="holding-active-box">
                    {/* 持仓卡片数据展示 */}
                    <div className="holding-summary-grid">
                      <div className="holding-stat-item">
                        <span className="stat-label">买入成本</span>
                        <span className="stat-val num">¥ {formatPrice(holding.cost_price)}</span>
                      </div>
                      <div className="holding-stat-item">
                        <span className="stat-label">浮动盈亏</span>
                        <span className={`stat-val num ${tone(holding.pnl_pct)}`}>
                          {formatPct(holding.pnl_pct)}
                        </span>
                      </div>
                    </div>

                    {/* 卖出结账表单 */}
                    <form
                      className="sell-inline-form"
                      onSubmit={(e) => {
                        e.preventDefault()
                        run("sell", async () => {
                          await api.sell(holding.id, { sell_price: sellPrice })
                          notify("已记入卖出并结平", "success")
                        })
                      }}
                    >
                      <div className="form-item">
                        <label>清仓卖出单价 (元)</label>
                        <div className="input-affix-wrapper">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={sellPrice}
                            onChange={(e) => setSellPrice(e.target.value)}
                            required
                          />
                          <span className="input-suffix">¥</span>
                        </div>
                      </div>
                      <button
                        type="submit"
                        className="btn-danger-gradient"
                        disabled={pending === "sell" || !sellPrice}
                      >
                        {pending === "sell" ? "结平中..." : "确认卖出结平"}
                      </button>
                    </form>
                  </div>
                ) : (
                  <form
                    className="buy-inline-form"
                    onSubmit={(e) => {
                      e.preventDefault()
                      run("buy", async () => {
                        await api.buy({ code, cost_price: cost })
                        notify("已成功记入持仓", "success")
                      })
                    }}
                  >
                    <div className="form-item">
                      <label>买入成本价格 (元)</label>
                      <div className="input-affix-wrapper">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={cost}
                          onChange={(e) => setCost(e.target.value)}
                          placeholder="如 12.50"
                          required
                        />
                        <span className="input-suffix">¥</span>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="btn-primary-gradient"
                      disabled={pending === "buy" || !cost}
                    >
                      {pending === "buy" ? "记入中..." : "记入买入持仓"}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: AI 风险透视 */}
          {activeTab === "risk" && (
            <div className="tab-pane animate-fade-in">
              <div className="card-section">
                <div className="section-head">
                  <div className="section-title">
                    <IconShield size={16} />
                    <span>AI 风险智能排查报告</span>
                  </div>
                  <button
                    type="button"
                    className="btn-pill-sm"
                    disabled={pending === "risk"}
                    onClick={() =>
                      run("risk", async () => {
                        setRiskState("loading")
                        try {
                          const quotes = await fetchLiveQuotes([code]).catch(() => [])
                          const name = quotes[0]?.name || stock?.name || code
                          const headlines = await fetchHeadlines(`${name} ${code}`)
                          const price = quotes[0]?.price || stock?.price
                          const change = quotes[0]?.change_pct || stock?.change_pct
                          const quoteText = price ? `现价 ${price}，涨跌幅 ${change ?? ""}%` : "暂无现价"
                          const rep = await api.refreshRisk(code, { headlines, quote_text: quoteText })
                          setRisk(rep)
                          setRiskState("ready")
                          notify("风险报告已重新生成", "success")
                        } catch (err) {
                          setRiskState(risk ? "ready" : "error")
                          throw err
                        }
                      })
                    }
                  >
                    <IconRefresh size={13} className={pending === "risk" ? "spin" : ""} />
                    <span>{pending === "risk" ? "诊断中..." : "重新排查"}</span>
                  </button>
                </div>

                {riskState === "loading" && (
                  <div className="risk-loading-skeleton">
                    <div className="skeleton-bar lg animate-pulse" />
                    <div className="skeleton-bar md animate-pulse" />
                    <div className="skeleton-bar sm animate-pulse" />
                  </div>
                )}

                {riskState === "error" && (
                  <div className="risk-error-tip">
                    <IconAlertTriangle size={18} />
                    <span>暂无法生成最新风险报告，可能是外部资讯接口超时，请稍后刷新重试。</span>
                  </div>
                )}

                {risk && riskState === "ready" && (
                  <div className="risk-report-content">
                    <div className="risk-summary-card">
                      <div className={`risk-stance-badge ${risk.stance || "unknown"}`}>
                        <IconSparkles size={14} />
                        <span>{riskStanceLabel(risk.stance)}</span>
                      </div>
                      <p className="summary-text">{risk.summary}</p>
                      <p className="risk-meta">
                        {riskSourceLabel(risk.source)}
                        {risk.model ? ` · ${risk.model}` : ""}
                        {risk.created_at ? ` · ${formatDate(risk.created_at)} ${formatClock(risk.created_at)}` : ""}
                      </p>
                    </div>

                    <div className="risk-columns-grid">
                      <div className="risk-column-card">
                        <div className="col-title">
                          <IconShield size={16} className="text-brand" />
                          <strong>是否涉及监管</strong>
                          <span className={`risk-status-chip status-${risk.regulatory_status || "unknown"}`}>
                            {riskStatusLabel(risk.regulatory_status)}
                          </span>
                        </div>
                        <p className="col-desc">{risk.regulatory || "这次没有核对出监管标题。"}</p>
                      </div>

                      <div className="risk-column-card">
                        <div className="col-title">
                          <IconAlertTriangle size={16} className="text-warning" />
                          <strong>是否有明确负面新闻</strong>
                          <span className={`risk-status-chip status-${risk.negative_status || "unknown"}`}>
                            {riskStatusLabel(risk.negative_status)}
                          </span>
                        </div>
                        <p className="col-desc">{risk.negative_news || "这次没有核对出负面标题。"}</p>
                      </div>
                    </div>

                    {(risk.checks?.length ?? 0) > 0 ? (
                      <div className="risk-check-board">
                        <h4>排查清单</h4>
                        {(["regulatory", "negative", "other"] as const).map((group) => {
                          const rows = risk.checks.filter((item) => item.group === group)
                          if (rows.length === 0) return null
                          const title = group === "regulatory" ? "监管" : group === "negative" ? "负面新闻" : "其他事项"
                          return (
                            <section key={group} className="risk-check-group">
                              <h5>{title}</h5>
                              <ul>
                                {rows.map((item) => (
                                  <li key={item.name} className={`risk-check status-${item.status}`}>
                                    <div className="risk-check-head">
                                      <strong>{item.name}</strong>
                                      <span>{riskStatusLabel(item.status)}</span>
                                    </div>
                                    {item.evidence.length > 0 && <p>{item.evidence.join("；")}</p>}
                                  </li>
                                ))}
                              </ul>
                            </section>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="risk-meta">这份报告还没有排查清单。重新排查后，会按标题逐项核对监管和负面新闻。</p>
                    )}

                    {risk.other_risks && risk.other_risks.length > 0 && (
                      <div className="other-risks-box">
                        <h4>补充说明</h4>
                        <ul>
                          {risk.other_risks.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {risk.headlines && risk.headlines.length > 0 && (
                      <div className="headlines-radar">
                        <div className="radar-head">
                          <IconNewspaper size={15} />
                          <h4>近期市场资讯参考</h4>
                        </div>
                        <div className="headlines-list">
                          {risk.headlines.map((item, idx) => (
                            <a
                              key={idx}
                              href={item.url || undefined}
                              target="_blank"
                              rel="noreferrer"
                              className="headline-item"
                            >
                              <span className="headline-title">{item.title}</span>
                              <div className="headline-meta">
                                <span className="media-badge">{item.media || "财经资讯"}</span>
                                {item.published_at && (
                                  <span className="pub-date">{formatDateTime(item.published_at)}</span>
                                )}
                                <IconExternalLink size={12} className="meta-ext-icon" />
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="risk-disclaimer-box">
                      <p>{risk.disclaimer || "本风险分析系根据公开资讯由大模型整理生成，仅供参考，不构成任何投资依据。"}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "timeline" && (
            <div className="tab-pane animate-fade-in">
              <div className="card-section">
                {timeline.length === 0 ? (
                  <div className="empty-comments">
                    <IconClock size={32} />
                    <p>这只股票还没有圈子记录。加入观察、买卖、关注和评论都会按时间记在这里。</p>
                  </div>
                ) : (
                  <div className="stock-timeline">
                    {groupTimeline(timeline).map((group) => (
                      <section key={group.day} className="timeline-day-block">
                        <h3 className="timeline-day">{group.label}</h3>
                        <ol className="timeline-list">
                          {group.items.map((item, index) => {
                            const kindTone = feedKindTone(item.kind)
                            return (
                              <li
                                key={item.id}
                                className={`timeline-item ${index === group.items.length - 1 ? "is-last" : ""}`}
                              >
                                <div className="timeline-rail" aria-hidden="true">
                                  <span className={`timeline-dot ${kindTone}`} />
                                </div>
                                <time className="timeline-clock num" dateTime={item.created_at}>
                                  {formatClock(item.created_at)}
                                </time>
                                <div className="timeline-body">
                                  <div className="timeline-title">
                                    <strong>{item.user.username}</strong>
                                    <span className={`kind-pill pill-${kindTone}`}>{feedKindLabel(item.kind)}</span>
                                    {item.source_id && <span className="follow-indicator-tag">跟随</span>}
                                  </div>
                                  {item.price && <div className="timeline-meta num">成交价 ¥{formatPrice(item.price)}</div>}
                                  {item.note && <p className="timeline-note">{item.note}</p>}
                                </div>
                              </li>
                            )
                          })}
                        </ol>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: 群友发言交流 */}
          {activeTab === "comments" && (
            <div className="tab-pane animate-fade-in">
              <div className="card-section">
                {/* 发言输入表单 */}
                <form
                  className="comment-composer"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault()
                    if (!commentText.trim()) return
                    run("comment", async () => {
                      await api.addComment(code, commentText)
                      setCommentText("")
                      notify("发言已发送", "success")
                    })
                  }}
                >
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="分享你所了解的客观事实、研报或观点（回车换行，不支持投资误导）"
                    maxLength={500}
                    rows={3}
                  />
                  <div className="composer-footer">
                    <span className="char-count">{commentText.length}/500</span>
                    <button
                      type="submit"
                      className="btn-send-comment"
                      disabled={pending === "comment" || !commentText.trim()}
                    >
                      {pending === "comment" ? "发送中..." : "发表观点"}
                    </button>
                  </div>
                </form>

                {/* 评论列表 */}
                <div className="comments-stream">
                  {comments.length === 0 ? (
                    <div className="empty-comments">
                      <IconMessageSquare size={32} />
                      <p>暂无群友留言，快来留下第一个见解吧</p>
                    </div>
                  ) : (
                    comments.map((item) => (
                      <article key={item.id} className="comment-bubble">
                        <UserAvatar
                          className="comment-avatar"
                          name={item.user.username}
                          avatar={item.user.avatar}
                        />
                        <div className="comment-content-area">
                          <div className="comment-head">
                            <strong className="user-name">{item.user.username}</strong>
                            <time className="comment-time">{formatTimeAgo(item.created_at)}</time>
                          </div>
                          <p className="comment-text">{item.body}</p>
                          <div className="comment-foot">
                            <button
                              type="button"
                              className={`like-comment-btn ${item.liked ? "liked" : ""}`}
                              onClick={() =>
                                run(`c${item.id}`, async () => {
                                  await api.likeComment(item.id)
                                })
                              }
                            >
                              <IconThumbsUp size={13} fill={item.liked ? "currentColor" : "none"} />
                              <span>{item.liked ? "已赞同" : "赞同"}</span>
                              {item.like_count > 0 && <span className="count num">{item.like_count}</span>}
                            </button>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
