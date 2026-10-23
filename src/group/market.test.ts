import { describe, expect, it } from "vitest"
import { parseNews, parseSinaText, parseSuggest, parseTencentHint, parseUlist } from "./market"

describe("live market parsers", () => {
  it("reads an eastmoney quote payload", () => {
    const quotes = parseUlist({ data: { diff: [{ f12: "600519", f14: "贵州茅台", f2: 1335, f3: -1.25 }] } })
    expect(quotes[0].code).toBe("600519")
    expect(quotes[0].name).toBe("贵州茅台")
    expect(quotes[0].price).toBe("1335.000")
    expect(quotes[0].change_pct).toBe("-1.250")
  })

  it("reads a sina quote line", () => {
    const quotes = parseSinaText('var hq_str_sh600519="贵州茅台,1311.840,1318.490,1335.000,1343.880,1310.000";')
    expect(quotes[0].name).toBe("贵州茅台")
    expect(quotes[0].price).toBe("1335.000")
  })

  it("keeps a-share names and pinyin matches, and drops us stocks", () => {
    const items = parseSuggest({
      QuotationCodeTable: {
        Data: [
          { Code: "600519", Name: "贵州茅台", PinYin: "GZMT", Classify: "AStock", SecurityTypeName: "沪A" },
          { Code: "688981", Name: "中芯国际", PinYin: "ZXGJ", Classify: "23", SecurityTypeName: "科创板" },
          { Code: "MAT", Name: "美泰", PinYin: "MT", Classify: "UsStock", SecurityTypeName: "美股" },
        ],
      },
    })
    expect(items.map((item) => item.code)).toEqual(["600519", "688981"])
  })

  it("reads tencent pinyin hints and skips indexes", () => {
    const items = parseTencentHint("sh~600519~贵州茅台~gzmt~GP-A^sz~399990~煤炭等权~mtdq~ZS^sh~688981~中芯国际~zxgj~GP-A-KCB")
    expect(items.map((item) => [item.code, item.name])).toEqual([
      ["600519", "贵州茅台"],
      ["688981", "中芯国际"],
    ])
  })

  it("reads news titles", () => {
    const headlines = parseNews({
      result: { cmsArticleWebOld: [{ title: "减持公告", mediaName: "交易所", date: "2026-10-23", url: "https://example.com" }] },
    })
    expect(headlines[0].title).toBe("减持公告")
  })
})
