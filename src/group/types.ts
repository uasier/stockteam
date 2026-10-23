export type User = {
  id: number
  username: string
  avatar: string
  is_admin: boolean
}

export type Member = {
  id: number
  username: string
  avatar: string
}

export type Session = {
  token: string
  user: User
}

export type Stock = {
  code: string
  name: string
  price: string | null
  change_pct: string | null
  open: string | null
  high: string | null
  low: string | null
  prev_close: string | null
  quoted_at: string | null
  attention: number
  liked: boolean
}

export type WatchItem = {
  id: number
  custom_price: string | null
  custom_date: string
  note: string
  tags: string[]
  mine: boolean
  user: Member
  stock: Stock
}

export type Holding = {
  id: number
  status: "open" | "closed"
  cost_price: string
  quantity: string | null
  sell_price: string | null
  opened_at: string
  closed_at: string | null
  note: string
  pnl_pct: string | null
  mine: boolean
  user: Member
  stock: Stock
}

export type ActivityKind =
  | "buy"
  | "sell"
  | "watch"
  | "unwatch"
  | "watch_edit"
  | "like"
  | "unlike"
  | "comment"
  | "comment_like"
  | "comment_unlike"

export type Activity = {
  id: number
  kind: ActivityKind
  price: string | null
  quantity: string | null
  note: string
  created_at: string
  source_id: number | null
  user: Member
  stock: Stock
}

export type Comment = {
  id: number
  body: string
  created_at: string
  like_count: number
  liked: boolean
  user: Member
}

export type Headline = {
  title: string
  media: string
  published_at: string
  url: string
}

export type RiskStatus = "seen" | "unseen" | "unknown" | string

export type RiskCheck = {
  name: string
  group: "regulatory" | "negative" | "other" | string
  status: RiskStatus
  evidence: string[]
}

export type RiskReport = {
  summary: string
  regulatory: string
  negative_news: string
  other_risks: string[]
  checks: RiskCheck[]
  regulatory_status: RiskStatus
  negative_status: RiskStatus
  headlines: Headline[]
  stance: "attention" | "quiet" | "unknown" | string
  source: "unconfigured" | "model" | "fallback" | string
  model: string
  created_at: string
  disclaimer: string
}

export type Invite = {
  id: number
  code: string
  note: string
  created_at: string
  used_at: string | null
  used_by: string | null
}

export type SearchHit = {
  code: string
  name: string
  market: string
}

export type StockDetail = {
  stock: Stock
  watch: WatchItem | null
  watchers: WatchItem[]
  holding: Holding | null
}

export type SortKey = "change" | "price" | "attention" | "picked"
export type SortDir = "desc" | "asc"
export type CircleView = "watch" | "hold" | "sold" | "feed" | "invites"
