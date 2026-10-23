import { describe, expect, it } from "vitest"
import {
  calcClosedStats,
  postSellChange,
  sortHoldings,
  calcHoldingStats,
  changeRatio,
  FEED_FILTERS,
  feedKindLabel,
  feedKindTone,
  riskSourceLabel,
  riskStanceLabel,
  riskStatusLabel,
  formatClock,
  formatDate,
  formatDateTime,
  groupTimeline,
  formatPct,
  formatPrice,
  getMarketLabel,
  getUserInitials,
  readError,
  resolveApiBase,
  resolveAvatar,
  groupWatch,
  sortWatch,
  tone,
} from "./format"
import type { Holding, WatchItem } from "./types"

function item(code: string, change: string | null, price: string | null, attention: number, day: string): WatchItem {
  return {
    id: Number(code),
    custom_price: price,
    custom_date: day,
    note: "",
    tags: [],
    mine: true,
    user: { id: 1, username: "lin", avatar: "" },
    stock: {
      code,
      name: code,
      price,
      change_pct: change,
      open: null,
      high: null,
      low: null,
      prev_close: null,
      quoted_at: null,
      attention,
      liked: false,
    },
  }
}

describe("group format", () => {
  it("keeps uploaded avatars on the api host", () => {
    expect(resolveAvatar("", "")).toBe("")
    expect(resolveAvatar("/api/auth/avatar/3", "")).toBe("/api/auth/avatar/3")
    expect(resolveAvatar("/api/auth/avatar/3", "http://127.0.0.1:40301")).toBe(
      "http://127.0.0.1:40301/api/auth/avatar/3",
    )
    expect(resolveAvatar("blob:local", "http://127.0.0.1:40301")).toBe("blob:local")
  })

  it("resolves the api base without dropping an explicit empty value", () => {
    expect(resolveApiBase(null, undefined, true)).toBe("")
    expect(resolveApiBase(null, undefined, false)).toBe("https://stockteam.uasier.com")
    expect(resolveApiBase("http://10.0.0.8:40301/", undefined, true)).toBe("http://10.0.0.8:40301")
    expect(resolveApiBase("", "http://example.com", false)).toBe("")
  })

  it("reads a chinese api error", () => {
    expect(readError(400, JSON.stringify({ error: "邀请码不正确或已经使用" }))).toBe("邀请码不正确或已经使用")
    expect(readError(401, "nope")).toBe("登录已失效，请重新进入")
  })

  it("formats prices and a-share percents", () => {
    expect(formatPrice("1335")).toBe("1,335.00")
    expect(formatPrice(null)).toBe("--")
    expect(formatPct("1.2")).toBe("+1.20%")
    expect(formatPct("-0.5")).toBe("-0.50%")
    expect(tone("1")).toBe("up")
    expect(tone("-1")).toBe("down")
    expect(tone("0")).toBe("flat")
  })

  it("sorts the watchlist and keeps missing quotes at the end", () => {
    const rows = [
      item("000001", null, null, 1, "2026-10-01"),
      item("600519", "1.2", "100", 3, "2026-10-03"),
      item("300750", "-2", "20", 9, "2026-10-02"),
    ]
    expect(sortWatch(rows, "change", "desc").map((row) => row.stock.code)).toEqual(["600519", "300750", "000001"])
    expect(sortWatch(rows, "attention", "desc").map((row) => row.stock.code)).toEqual(["300750", "600519", "000001"])
    expect(sortWatch(rows, "picked", "asc").map((row) => row.stock.code)).toEqual(["000001", "300750", "600519"])
  })

  it("names every circle action for the feed", () => {
    expect(feedKindLabel("watch")).toBe("加入观察")
    expect(feedKindLabel("comment")).toBe("发表评论")
    expect(feedKindTone("buy")).toBe("up")
    expect(feedKindTone("sell")).toBe("down")
    expect(feedKindTone("like")).toBe("flat")
    expect(FEED_FILTERS[0]).toEqual({ kind: "trade", label: "只看买入卖出" })
    expect(FEED_FILTERS.map((item) => item.kind)).toEqual([
      "trade",
      "",
      "buy",
      "sell",
      "watch",
      "unwatch",
      "watch_edit",
      "like",
      "unlike",
      "comment",
      "comment_like",
      "comment_unlike",
    ])
  })

  it("names the risk report stance without turning a keyword hit into a verdict", () => {
    expect(riskStanceLabel("attention")).toBe("标题里有待核对事项")
    expect(riskStanceLabel("quiet")).toBe("标题里未见这些关键词")
    expect(riskStanceLabel("unknown")).toBe("缺少可核对标题")
    expect(riskStatusLabel("seen")).toBe("标题中出现")
    expect(riskStatusLabel("unseen")).toBe("标题中未出现")
    expect(riskSourceLabel("unconfigured")).toBe("未配置模型，只做了标题核对")
    expect(riskSourceLabel("fallback")).toBe("模型没有返回，已改用标题核对")
  })

  it("groups a stock timeline by local day and keeps the newest events first", () => {
    const now = new Date(2026, 9, 23, 20, 0, 0)
    const groups = groupTimeline(
      [
        { id: 3, created_at: "2026-10-23T18:42:00" },
        { id: 2, created_at: "2026-10-23T09:01:00" },
        { id: 1, created_at: "2026-10-22T21:05:00" },
        { id: 0, created_at: "2025-12-31T08:00:00" },
      ],
      now,
    )
    expect(formatClock("2026-10-23T18:42:00")).toBe("18:42")
    expect(formatClock(null)).toBe("--")
    const today = new Date(2026, 9, 23, 20, 0, 0)
    expect(formatDate("2026-10-23 17:39:00", today)).toBe("10月23日")
    expect(formatDate("2026-10-23", today)).toBe("10月23日")
    expect(formatDate("2025-12-31", today)).toBe("2025年12月31日")
    expect(formatDateTime("2026-10-23 17:39:00", today)).toBe("10月23日 17:39")
    const zoned = new Date("2026-10-23T16:30:00Z")
    expect(formatDate("2026-10-23T16:30:00Z", zoned)).toBe(`${zoned.getMonth() + 1}月${zoned.getDate()}日`)
    expect(groups.map((group) => group.label)).toEqual(["今天 · 10月23日", "昨天 · 10月22日", "2025年12月31日"])
    expect(groups[0].items.map((item) => item.id)).toEqual([3, 2])
  })

  it("groups the same stock and keeps every member who added it", () => {
    const first = item("600519", "1.2", "100", 3, "2026-10-03")
    const second = {
      ...item("600519", "1.2", "90", 3, "2026-10-01"),
      id: 2,
      user: { id: 2, username: "min", avatar: "" },
      mine: false,
    }
    const other = item("000001", null, null, 1, "2026-10-02")
    const groups = groupWatch(sortWatch([other, first, second], "change", "desc"))
    expect(groups.map((group) => group.stock.code)).toEqual(["600519", "000001"])
    expect(groups[0].watchers.map((watcher) => watcher.user.username)).toEqual(["lin", "min"])
  })

  it("computes a simple gain from cost to price", () => {
    expect(changeRatio("100", "110")).toBeCloseTo(10)
    expect(changeRatio("0", "110")).toBeNull()
  })

  it("identifies market prefixes correctly", () => {
    expect(getMarketLabel("600519")).toBe("沪A")
    expect(getMarketLabel("688981")).toBe("科创板")
    expect(getMarketLabel("000001")).toBe("深A")
    expect(getMarketLabel("300750")).toBe("创业板")
    expect(getMarketLabel("920027")).toBe("北交所")
  })

  it("calculates holding portfolio statistics", () => {
    const holdings: Holding[] = [
      {
        id: 1,
        status: "open",
        cost_price: "10.00",
        quantity: "100",
        sell_price: null,
        opened_at: "2026-10-01",
        closed_at: null,
        note: "",
        pnl_pct: "20",
        mine: true,
        user: { id: 1, username: "lin", avatar: "" },
        stock: {
          code: "600000",
          name: "浦发银行",
          price: "12.00",
          change_pct: "1.0",
          open: null,
          high: null,
          low: null,
          prev_close: null,
          quoted_at: null,
          attention: 1,
          liked: false,
        },
      },
    ]
    const stats = calcHoldingStats(holdings)
    expect(stats.count).toBe(1)
    expect(stats.avgPnlPct).toBe(20)
  })

  it("calculates closed holdings statistics and win rate", () => {
    const closed: Holding[] = [
      {
        id: 1,
        status: "closed",
        cost_price: "10.00",
        sell_price: "15.00",
        quantity: "100",
        opened_at: "2026-10-01",
        closed_at: "2026-10-02",
        note: "",
        pnl_pct: "50",
        mine: true,
        user: { id: 1, username: "lin", avatar: "" },
        stock: {
          code: "600000",
          name: "浦发银行",
          price: "15.00",
          change_pct: "0",
          open: null,
          high: null,
          low: null,
          prev_close: null,
          quoted_at: null,
          attention: 1,
          liked: false,
        },
      },
    ]
    const stats = calcClosedStats(closed)
    expect(stats.closedCount).toBe(1)
    expect(stats.winCount).toBe(1)
    expect(stats.winRate).toBe(100)
    expect(stats.avgRealizedPnlPct).toBe(50)
    expect(stats.avgPostSellPct).toBe(0)
    expect(postSellChange(closed[0])).toBe(0)
  })

  it("measures how much a stock moved after it was sold", () => {
    const sold = {
      id: 1,
      status: "closed" as const,
      cost_price: "10",
      sell_price: "10",
      quantity: null,
      opened_at: "2026-10-01",
      closed_at: "2026-10-02",
      note: "",
      pnl_pct: "0",
      stock: {
        code: "600519",
        name: "贵州茅台",
        price: "12",
        change_pct: "1",
        open: null,
        high: null,
        low: null,
        prev_close: null,
        quoted_at: null,
        attention: 0,
        liked: false,
      },
    }
    const dropped = {
      ...sold,
      id: 2,
      sell_price: "20",
      stock: { ...sold.stock, code: "000001", price: "16" },
    }
    const missing = {
      ...sold,
      id: 3,
      stock: { ...sold.stock, code: "300750", price: null },
    }
    expect(postSellChange(sold)).toBe(20)
    expect(postSellChange(dropped)).toBe(-20)
    expect(postSellChange(missing)).toBeNull()
    const stats = calcClosedStats([sold, dropped, missing])
    expect(stats.avgPostSellPct).toBe(0)
    expect(stats.roseAfterSellCount).toBe(1)
    expect(stats.fellAfterSellCount).toBe(1)
    expect(stats.postSellCount).toBe(2)
    expect(sortHoldings([dropped, sold, missing], "change", "desc").map((item) => item.id)).toEqual([1, 2, 3])
  })

  it("extracts clean user initials", () => {
    expect(getUserInitials("张三")).toBe("张")
    expect(getUserInitials("Alice")).toBe("AL")
    expect(getUserInitials("")).toBe("股")
  })
})
