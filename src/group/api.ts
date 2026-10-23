import { readError, resolveApiBase } from "./format"
import type {
  Activity,
  ActivityKind,
  Comment,
  Holding,
  Invite,
  RiskReport,
  SearchHit,
  Session,
  Stock,
  StockDetail,
  User,
  WatchItem,
} from "./types"

const TOKEN_KEY = "gp_circle_token"
const USER_KEY = "gp_circle_user"

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

export function loadSession(): Session | null {
  const token = localStorage.getItem(TOKEN_KEY)
  const raw = localStorage.getItem(USER_KEY)
  if (!token || !raw) return null
  try {
    return { token, user: JSON.parse(raw) as User }
  } catch {
    return null
  }
}

export function saveSession(session: Session | null) {
  if (!session) {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    return
  }
  localStorage.setItem(TOKEN_KEY, session.token)
  localStorage.setItem(USER_KEY, JSON.stringify(session.user))
}

export function apiBase(): string {
  return resolveApiBase(null, import.meta.env.VITE_API_BASE, import.meta.env.DEV)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) headers.set("Authorization", `Token ${token}`)
  const response = await fetch(`${apiBase()}${path}`, { ...init, headers })
  const text = await response.text()
  if (!response.ok) throw new ApiError(readError(response.status, text), response.status)
  return (text ? JSON.parse(text) : {}) as T
}

export const api = {
  register(body: { username: string; password: string; invite_code: string }) {
    return request<Session>("/api/auth/register", { method: "POST", body: JSON.stringify(body) })
  },
  login(body: { username: string; password: string }) {
    return request<Session>("/api/auth/login", { method: "POST", body: JSON.stringify(body) })
  },
  logout() {
    return request<{ ok: boolean }>("/api/auth/logout", { method: "POST" })
  },
  me() {
    return request<User>("/api/auth/me")
  },
  updateProfile(body: { username: string }) {
    return request<User>("/api/auth/me", { method: "PATCH", body: JSON.stringify(body) })
  },
  uploadAvatar(file: File) {
    const body = new FormData()
    body.append("file", file)
    return request<User>("/api/auth/avatar", { method: "POST", body })
  },
  clearAvatar() {
    return request<User>("/api/auth/avatar", { method: "DELETE" })
  },
  aiKey() {
    return request<{ api_key: string }>("/api/ai-key")
  },
  saveAiKey(apiKey: string) {
    return request<{ api_key: string }>("/api/ai-key", {
      method: "PATCH",
      body: JSON.stringify({ api_key: apiKey }),
    })
  },
  invites() {
    return request<{ items: Invite[] }>("/api/auth/invites")
  },
  createInvites(count: number) {
    return request<{ items: Invite[] }>("/api/auth/invites", {
      method: "POST",
      body: JSON.stringify({ count }),
    })
  },
  search(q: string) {
    return request<{ items: SearchHit[] }>(`/api/stocks/search?q=${encodeURIComponent(q)}`)
  },
  quotes(codes: string[]) {
    return request<{ items: Stock[] }>(`/api/quotes?codes=${encodeURIComponent(codes.join(","))}`)
  },
  refresh(codes: string[]) {
    return request<{ items: Stock[] }>("/api/quotes", {
      method: "POST",
      body: JSON.stringify({ codes }),
    })
  },
  watch() {
    return request<{ items: WatchItem[] }>("/api/watch")
  },
  addWatch(code: string) {
    return request<WatchItem>("/api/watch", { method: "POST", body: JSON.stringify({ code }) })
  },
  updateWatch(id: number, body: Record<string, unknown>) {
    return request<WatchItem>(`/api/watch/${id}`, { method: "PATCH", body: JSON.stringify(body) })
  },
  removeWatch(id: number) {
    return request<{ ok: boolean }>(`/api/watch/${id}`, { method: "DELETE" })
  },
  holdings(status?: "open" | "closed") {
    return request<{ items: Holding[] }>(status ? `/api/holdings?status=${status}` : "/api/holdings")
  },
  buy(body: { code: string; cost_price: string; note?: string }) {
    return request<Holding>("/api/holdings", { method: "POST", body: JSON.stringify(body) })
  },
  sell(id: number, body: { sell_price: string; note?: string }) {
    return request<Holding>(`/api/holdings/${id}/sell`, { method: "POST", body: JSON.stringify(body) })
  },
  feed(kind?: ActivityKind | "trade") {
    const query = kind ? `?kind=${encodeURIComponent(kind)}` : ""
    return request<{ items: Activity[] }>(`/api/feed${query}`)
  },
  follow(id: number, body: { price?: string; note?: string } = {}) {
    return request<{ kind: string; holding?: Holding; watch?: WatchItem }>(`/api/feed/${id}/follow`, {
      method: "POST",
      body: JSON.stringify(body),
    })
  },
  stock(code: string) {
    return request<StockDetail>(`/api/stocks/${code}`)
  },
  timeline(code: string) {
    return request<{ items: Activity[] }>(`/api/stocks/${code}/timeline`)
  },
  likeStock(code: string) {
    return request<Stock>(`/api/stocks/${code}/like`, { method: "POST" })
  },
  comments(code: string) {
    return request<{ items: Comment[] }>(`/api/stocks/${code}/comments`)
  },
  addComment(code: string, body: string) {
    return request<Comment>(`/api/stocks/${code}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    })
  },
  likeComment(id: number) {
    return request<Comment>(`/api/comments/${id}/like`, { method: "POST" })
  },
  risk(code: string) {
    return request<RiskReport>(`/api/stocks/${code}/risk`)
  },
  refreshRisk(code: string) {
    return request<RiskReport>(`/api/stocks/${code}/risk`, { method: "POST" })
  },
}
