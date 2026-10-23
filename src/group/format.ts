import { parseTimestamp } from "../time"
import type { ActivityKind, Holding, SortDir, SortKey, Stock, WatchItem } from "./types"

export type WatchGroup = {
  stock: Stock
  watchers: WatchItem[]
}

export function resolveApiBase(saved: string | null, envBase: string | undefined, dev: boolean): string {
  if (typeof saved === "string") return saved.replace(/\/$/, "")
  if (envBase) return envBase.replace(/\/$/, "")
  return dev ? "" : "https://stockteam.uasier.com"
}

export function readError(status: number, text: string): string {
  try {
    const data = JSON.parse(text) as { error?: unknown }
    if (typeof data.error === "string" && data.error.trim()) return data.error.trim()
  } catch {
    // 非 JSON 时用状态码。
  }
  if (status === 401) return "登录已失效，请重新进入"
  return "请求没有完成"
}

export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

export function tone(value: string | number | null | undefined): "up" | "down" | "flat" {
  const number = toNumber(value)
  if (number === null || number === 0) return "flat"
  return number > 0 ? "up" : "down"
}

export function formatPrice(value: string | number | null | undefined): string {
  const number = toNumber(value)
  if (number === null) return "--"
  return number.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatPct(value: string | number | null | undefined): string {
  const number = toNumber(value)
  if (number === null) return "--"
  const text = Math.abs(number).toFixed(2)
  if (number > 0) return `+${text}%`
  if (number < 0) return `-${text}%`
  return "0.00%"
}

const FEED_KIND_LABEL: Record<string, string> = {
  buy: "买入建仓",
  sell: "卖出平仓",
  watch: "加入观察",
  unwatch: "移出观察",
  watch_edit: "更新自选",
  like: "加一关注",
  unlike: "取消关注",
  comment: "发表评论",
  comment_like: "评论加一",
  comment_unlike: "取消评论加一",
}

export type FeedFilter = ActivityKind | "" | "trade"

export const FEED_FILTERS: { kind: FeedFilter; label: string }[] = [
  { kind: "trade", label: "只看买入卖出" },
  { kind: "", label: "全部" },
  ...(Object.entries(FEED_KIND_LABEL) as [ActivityKind, string][]).map(([kind, label]) => ({ kind, label })),
]

export function feedKindLabel(kind: string): string {
  return FEED_KIND_LABEL[kind] ?? "动态"
}

export function riskStanceLabel(stance: string): string {
  if (stance === "attention") return "标题里有待核对事项"
  if (stance === "quiet") return "标题里未见这些关键词"
  if (stance === "unknown") return "缺少可核对标题"
  return "综合扫描"
}

export function riskStatusLabel(status: string): string {
  if (status === "seen") return "标题中出现"
  if (status === "unseen") return "标题中未出现"
  if (status === "unknown") return "无法核对"
  return "未排查"
}

export function riskSourceLabel(source: string): string {
  if (source === "model") return "模型根据标题整理"
  if (source === "fallback") return "模型没有返回，已改用标题核对"
  if (source === "unconfigured") return "未配置模型，只做了标题核对"
  return "风险备忘"
}

export function feedKindTone(kind: string): "up" | "down" | "flat" {
  if (kind === "buy") return "up"
  if (kind === "sell") return "down"
  return "flat"
}

export function formatClock(value: string | null | undefined): string {
  const timestamp = parseTimestamp(value)
  if (timestamp === null) return "--"
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${hours}:${minutes}`
}

export type TimelineGroup<T extends { created_at: string }> = {
  day: string
  label: string
  items: T[]
}

function timelineDayKey(value: string): string {
  const timestamp = parseTimestamp(value)
  if (timestamp === null) return value.slice(0, 10)
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

function timelineDayLabel(day: string, now: Date): string {
  const parts = day.split("-")
  if (parts.length !== 3) return day
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((today.getTime() - date.getTime()) / 86400000)
  const text = `${Number(parts[1])}月${Number(parts[2])}日`
  if (diff === 0) return `今天 · ${text}`
  if (diff === 1) return `昨天 · ${text}`
  if (date.getFullYear() === now.getFullYear()) return text
  return `${parts[0]}年${text}`
}

export function groupTimeline<T extends { created_at: string }>(items: T[], now = new Date()): TimelineGroup<T>[] {
  const groups: TimelineGroup<T>[] = []
  const index = new Map<string, TimelineGroup<T>>()
  for (const item of items) {
    const day = timelineDayKey(item.created_at)
    let group = index.get(day)
    if (!group) {
      group = { day, label: timelineDayLabel(day, now), items: [] }
      index.set(day, group)
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

export function formatDate(value: string | null | undefined, now = new Date()): string {
  if (!value) return "--"
  const text = value.trim()
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  let year: number
  let month: number
  let day: number
  if (dateOnly) {
    year = Number(dateOnly[1])
    month = Number(dateOnly[2])
    day = Number(dateOnly[3])
  } else {
    const timestamp = parseTimestamp(text)
    if (timestamp === null) return text
    const date = new Date(timestamp)
    year = date.getFullYear()
    month = date.getMonth() + 1
    day = date.getDate()
  }
  if (!year || !month || !day) return text
  if (year === now.getFullYear()) return `${month}月${day}日`
  return `${year}年${month}月${day}日`
}

export function formatDateTime(value: string | null | undefined, now = new Date()): string {
  const day = formatDate(value, now)
  if (!value || day === "--" || day === value.trim()) return day
  if (!/[T\s]\d{2}:\d{2}/.test(value)) return day
  const clock = formatClock(value)
  return clock === "--" ? day : `${day} ${clock}`
}

export function changeRatio(
  base: string | number | null | undefined,
  next: string | number | null | undefined,
): number | null {
  const from = toNumber(base)
  const to = toNumber(next)
  if (from === null || to === null || from === 0) return null
  return ((to - from) / from) * 100
}

function compareNullable(left: number | null, right: number | null, dir: SortDir): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return dir === "desc" ? right - left : left - right
}

export function sortWatch(items: WatchItem[], key: SortKey, dir: SortDir): WatchItem[] {
  return [...items].sort((a, b) => {
    const diff =
      key === "change"
        ? compareNullable(toNumber(a.stock.change_pct), toNumber(b.stock.change_pct), dir)
        : key === "price"
          ? compareNullable(toNumber(a.stock.price), toNumber(b.stock.price), dir)
          : key === "attention"
            ? compareNullable(a.stock.attention, b.stock.attention, dir)
            : compareNullable(Date.parse(a.custom_date), Date.parse(b.custom_date), dir)
    if (diff !== 0) return diff
    return a.stock.code.localeCompare(b.stock.code)
  })
}

export type HoldingGroup = {
  stock: Stock
  holders: Holding[]
}

export function groupHoldings(items: Holding[]): HoldingGroup[] {
  const groups: HoldingGroup[] = []
  const byCode = new Map<string, HoldingGroup>()
  for (const item of items) {
    const existing = byCode.get(item.stock.code)
    if (existing) {
      existing.holders.push(item)
      continue
    }
    const group = { stock: item.stock, holders: [item] }
    byCode.set(item.stock.code, group)
    groups.push(group)
  }
  return groups
}

export function groupWatch(items: WatchItem[]): WatchGroup[] {
  const groups: WatchGroup[] = []
  const byCode = new Map<string, WatchGroup>()
  for (const item of items) {
    const existing = byCode.get(item.stock.code)
    if (existing) {
      existing.watchers.push(item)
      continue
    }
    const group = { stock: item.stock, watchers: [item] }
    byCode.set(item.stock.code, group)
    groups.push(group)
  }
  return groups
}

export function sortHoldings(items: Holding[], key: SortKey, dir: SortDir): Holding[] {
  return [...items].sort((a, b) => {
    const pickedA = Date.parse(a.status === "closed" ? a.closed_at || a.opened_at : a.opened_at)
    const pickedB = Date.parse(b.status === "closed" ? b.closed_at || b.opened_at : b.opened_at)
    const diff =
      key === "change"
        ? compareNullable(
            a.status === "closed" ? postSellChange(a) : toNumber(a.pnl_pct),
            b.status === "closed" ? postSellChange(b) : toNumber(b.pnl_pct),
            dir,
          )
        : key === "price"
          ? compareNullable(toNumber(a.stock.price), toNumber(b.stock.price), dir)
          : key === "attention"
            ? compareNullable(a.stock.attention, b.stock.attention, dir)
            : compareNullable(pickedA, pickedB, dir)
    if (diff !== 0) return diff
    return a.stock.code.localeCompare(b.stock.code)
  })
}

export function mergeStock<T extends { stock: { code: string } }>(items: T[], stocks: { code: string }[]): T[] {
  const map = new Map(stocks.map((stock) => [stock.code, stock]))
  return items.map((item) => {
    const next = map.get(item.stock.code)
    return next ? { ...item, stock: { ...item.stock, ...next } } : item
  })
}

export function getMarketLabel(code: string): string {
  const c = code.trim()
  if (c.startsWith("688")) return "科创板"
  if (c.startsWith("60")) return "沪A"
  if (c.startsWith("30")) return "创业板"
  if (c.startsWith("00")) return "深A"
  if (c.startsWith("92") || c.startsWith("83") || c.startsWith("87") || c.startsWith("43")) return "北交所"
  return "A股"
}

export function calcHoldingStats(holdings: Holding[]) {
  const open = holdings.filter((item) => item.status === "open")
  let pnlSum = 0
  let pnlCount = 0
  for (const item of open) {
    const pnl = toNumber(item.pnl_pct)
    if (pnl === null) continue
    pnlSum += pnl
    pnlCount += 1
  }
  return {
    count: open.length,
    avgPnlPct: pnlCount > 0 ? pnlSum / pnlCount : 0,
  }
}

export function postSellChange(holding: Holding): number | null {
  if (holding.status !== "closed") return null
  return changeRatio(holding.sell_price, holding.stock.price)
}

export function calcClosedStats(holdings: Holding[]) {
  const closed = holdings.filter((h) => h.status === "closed")
  let pnlSum = 0
  let pnlCount = 0
  let winCount = 0
  let postSum = 0
  let postCount = 0
  let roseAfterSellCount = 0
  let fellAfterSellCount = 0

  for (const h of closed) {
    const pnlPct = toNumber(h.pnl_pct)
    if (pnlPct !== null) {
      pnlSum += pnlPct
      pnlCount += 1
      if (pnlPct > 0) winCount += 1
    }
    const after = postSellChange(h)
    if (after === null) continue
    postSum += after
    postCount += 1
    if (after > 0) roseAfterSellCount += 1
    else if (after < 0) fellAfterSellCount += 1
  }

  const winRate = closed.length > 0 ? (winCount / closed.length) * 100 : 0

  return {
    closedCount: closed.length,
    winCount,
    winRate,
    avgRealizedPnlPct: pnlCount > 0 ? pnlSum / pnlCount : 0,
    avgPostSellPct: postCount > 0 ? postSum / postCount : null,
    postSellCount: postCount,
    roseAfterSellCount,
    fellAfterSellCount,
  }
}

export function resolveAvatar(avatar: string | null | undefined, base: string): string {
  if (!avatar) return ""
  if (/^(https?:|data:|blob:)/.test(avatar)) return avatar
  return `${base}${avatar}`
}

export function getUserInitials(name: string): string {
  const trimmed = (name || "").trim()
  if (!trimmed) return "股"
  return trimmed.slice(0, trimmed.length > 1 && /^[a-zA-Z]/.test(trimmed) ? 2 : 1).toUpperCase()
}

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #3b82f6, #1d4ed8)",
  "linear-gradient(135deg, #8b5cf6, #6d28d9)",
  "linear-gradient(135deg, #ec4899, #be185d)",
  "linear-gradient(135deg, #f59e0b, #d97706)",
  "linear-gradient(135deg, #10b981, #047857)",
  "linear-gradient(135deg, #06b6d4, #0e7490)",
  "linear-gradient(135deg, #6366f1, #4338ca)",
  "linear-gradient(135deg, #f43f5e, #e11d48)",
]

export function getUserGradient(name: string): string {
  let hash = 0
  for (let i = 0; i < (name || "").length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i)
    hash |= 0
  }
  const idx = Math.abs(hash) % AVATAR_GRADIENTS.length
  return AVATAR_GRADIENTS[idx]
}

