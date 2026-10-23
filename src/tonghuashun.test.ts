import { describe, expect, it } from "vitest"
import { buildTonghuashunAppUrl, buildTonghuashunPageUrl } from "./tonghuashun"

describe("tonghuashun links", () => {
  it("builds the mobile page and app urls", () => {
    expect(buildTonghuashunPageUrl("600519")).toBe("https://m.10jqka.com.cn/stockpage/hs_600519/")
    expect(buildTonghuashunPageUrl("000001")).toBe("https://m.10jqka.com.cn/stockpage/hs_000001/")
    expect(buildTonghuashunPageUrl("300750")).toBe("https://m.10jqka.com.cn/stockpage/hs_300750/")
    expect(buildTonghuashunPageUrl("920027")).toBe("https://m.10jqka.com.cn/stockpage/151_920027/")
    expect(buildTonghuashunPageUrl("830799")).toBe("https://m.10jqka.com.cn/stockpage/145_830799/")
    expect(buildTonghuashunPageUrl("abc")).toBe("#")
    expect(buildTonghuashunAppUrl("600519")).toContain("marketid=17")
    expect(buildTonghuashunAppUrl("000001")).toContain("marketid=33")
    expect(buildTonghuashunAppUrl("920027")).toContain("marketid=151")
    expect(buildTonghuashunAppUrl("")).toBe("")
  })
})
