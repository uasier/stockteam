import type { Headline, SearchHit, Stock } from "./types"

const ULIST_URLS = [
  "https://push2delay.eastmoney.com/api/qt/ulist.np/get",
  "https://push2.eastmoney.com/api/qt/ulist.np/get",
]
const SUGGEST_URL = "https://searchapi.eastmoney.com/api/suggest/get"
const TENCENT_URL = "https://smartbox.gtimg.cn/s3/"
const NEWS_URL = "https://search-api-web.eastmoney.com/search/jsonp"
const A_SHARE_MARKETS = new Set(["沪A", "深A", "科创板", "京A", "创业板"])

export type LiveQuote = Pick<Stock, "code" | "name" | "price" | "change_pct" | "open" | "high" | "low" | "prev_close" | "quoted_at">

type SuggestRow = {
  code: string
  name: string
  market: string
  pinyin: string
}

function normalizeCode(raw: string | null | undefined): string {
  return String(raw || "").match(/\d{6}/)?.[0] ?? ""
}

function eastmoneySecid(code: string): string | null {
  if (!/^\d{6}$/.test(code)) return null
  if (/^(43|82|83|87|88|92)/.test(code)) return `0.${code}`
  if (/^[569]/.test(code)) return `1.${code}`
  if (/^[012348]/.test(code)) return `0.${code}`
  return null
}

function sinaSymbol(code: string): string | null {
  if (!/^\d{6}$/.test(code)) return null
  if (/^(43|82|83|87|88|92)/.test(code)) return `bj${code}`
  if (/^[569]/.test(code)) return `sh${code}`
  if (/^[012348]/.test(code)) return `sz${code}`
  return null
}

function money(value: unknown): string | null {
  if (value === null || value === undefined || value === "" || value === "-") return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return number.toFixed(3)
}

function marketLabel(code: string, market = "", classify = ""): string {
  const label = market.trim()
  if (A_SHARE_MARKETS.has(label)) return label
  if (label) return ""
  if (classify && !["AStock", "NEEQ", "23", "80", "81"].includes(classify)) return ""
  if (code.startsWith("688")) return "科创板"
  if (code.startsWith("60") || code.startsWith("68")) return "沪A"
  if (code.startsWith("30")) return "创业板"
  if (/^(92|83|87|43)/.test(code)) return "京A"
  if (code.startsWith("00")) return "深A"
  return ""
}

function rowsOf(payload: unknown): Record<string, unknown>[] {
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null
  if (!data || typeof data !== "object") return []
  const diff = (data as { diff?: unknown }).diff
  if (Array.isArray(diff)) return diff.filter((row) => row && typeof row === "object") as Record<string, unknown>[]
  if (diff && typeof diff === "object") return Object.values(diff).filter((row) => row && typeof row === "object") as Record<string, unknown>[]
  return []
}

export function parseUlist(payload: unknown): LiveQuote[] {
  const quotedAt = new Date().toISOString()
  const quotes: LiveQuote[] = []
  for (const row of rowsOf(payload)) {
    const code = normalizeCode(String(row.f12 ?? ""))
    if (!code) continue
    quotes.push({
      code,
      name: String(row.f14 ?? "").trim(),
      price: money(row.f2),
      change_pct: money(row.f3),
      open: money(row.f17),
      high: money(row.f15),
      low: money(row.f16),
      prev_close: money(row.f18),
      quoted_at: quotedAt,
    })
  }
  return quotes
}

export function parseSinaText(text: string): LiveQuote[] {
  const quotedAt = new Date().toISOString()
  const quotes: LiveQuote[] = []
  for (const line of text.split(/\n/)) {
    if (!line.includes("=")) continue
    const [left, right] = line.split("=", 2)
    const code = normalizeCode(left)
    const body = right.trim().replace(/;$/, "").trim().replace(/^"|"$/g, "")
    const parts = body ? body.split(",") : []
    if (!code || parts.length < 6) continue
    const price = money(parts[3])
    const prev = money(parts[2])
    let change: string | null = null
    if (price !== null && prev !== null && Number(prev) !== 0) {
      change = (((Number(price) - Number(prev)) / Number(prev)) * 100).toFixed(3)
    }
    quotes.push({
      code,
      name: parts[0].trim(),
      price,
      change_pct: change,
      open: money(parts[1]),
      high: money(parts[4]),
      low: money(parts[5]),
      prev_close: prev,
      quoted_at: quotedAt,
    })
  }
  return quotes
}

export function parseSuggest(payload: unknown): SuggestRow[] {
  const table = payload && typeof payload === "object" ? (payload as { QuotationCodeTable?: { Data?: unknown } }).QuotationCodeTable : null
  const rows = table && Array.isArray(table.Data) ? table.Data : []
  const items: SuggestRow[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const record = row as Record<string, unknown>
    const code = normalizeCode(String(record.Code ?? ""))
    const market = marketLabel(code, String(record.SecurityTypeName ?? ""), String(record.Classify ?? ""))
    if (!code || !market || seen.has(code) || !eastmoneySecid(code)) continue
    seen.add(code)
    items.push({
      code,
      name: String(record.Name ?? "").trim(),
      market,
      pinyin: String(record.PinYin ?? "").trim().toLowerCase(),
    })
  }
  return items
}

export function parseTencentHint(text: string): SuggestRow[] {
  const body = text.trim()
  if (!body || body === "N") return []
  const items: SuggestRow[] = []
  const seen = new Set<string>()
  for (const part of body.split("^")) {
    const bits = part.split("~")
    if (bits.length < 5) continue
    const code = normalizeCode(bits[1])
    if (!code || seen.has(code) || !bits[4].startsWith("GP-A") || !eastmoneySecid(code)) continue
    seen.add(code)
    items.push({
      code,
      name: bits[2].trim(),
      market: marketLabel(code),
      pinyin: bits[3].trim().toLowerCase(),
    })
  }
  return items
}

export function parseNews(payload: unknown): Headline[] {
  const result = payload && typeof payload === "object" ? (payload as { result?: { cmsArticleWebOld?: unknown } }).result : null
  const rows = result && Array.isArray(result.cmsArticleWebOld) ? result.cmsArticleWebOld : []
  const headlines: Headline[] = []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const record = row as Record<string, unknown>
    const title = String(record.title ?? "").trim()
    if (!title) continue
    headlines.push({
      title: title.slice(0, 120),
      media: String(record.mediaName ?? "").trim().slice(0, 40),
      published_at: String(record.date ?? "").trim().slice(0, 19),
      url: String(record.url ?? "").trim(),
    })
  }
  return headlines
}

function jsonp(url: string, timeoutMs = 8000): Promise<unknown> {
  const callback = `gpq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise((resolve, reject) => {
    const script = document.createElement("script")
    const timer = window.setTimeout(() => finish(new Error("行情请求超时")), timeoutMs)
    const finish = (error?: Error, value?: unknown) => {
      window.clearTimeout(timer)
      delete (window as unknown as Record<string, unknown>)[callback]
      script.remove()
      if (error) reject(error)
      else resolve(value)
    }
    ;(window as unknown as Record<string, unknown>)[callback] = (payload: unknown) => finish(undefined, payload)
    script.src = `${url}${url.includes("?") ? "&" : "?"}cb=${callback}`
    script.onerror = () => finish(new Error("行情请求失败"))
    document.head.appendChild(script)
  })
}

function loadScript(url: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script")
    const timer = window.setTimeout(() => {
      script.remove()
      reject(new Error("行情请求超时"))
    }, timeoutMs)
    script.src = url
    script.onload = () => {
      window.clearTimeout(timer)
      script.remove()
      resolve()
    }
    script.onerror = () => {
      window.clearTimeout(timer)
      script.remove()
      reject(new Error("行情请求失败"))
    }
    document.head.appendChild(script)
  })
}

async function fetchEastmoneyQuotes(codes: string[]): Promise<LiveQuote[]> {
  const secids = codes.map((code) => eastmoneySecid(code)).filter((item): item is string => Boolean(item))
  if (!secids.length) return []
  const params = new URLSearchParams({
    fltt: "2",
    invt: "2",
    fields: "f12,f14,f2,f3,f15,f16,f17,f18",
    secids: secids.join(","),
  })
  const tasks = ULIST_URLS.map(async (url) => parseUlist(await jsonp(`${url}?${params.toString()}`)))
  const settled = await Promise.allSettled(tasks)
  for (const item of settled) {
    if (item.status === "fulfilled" && item.value.length) return item.value
  }
  return []
}

async function fetchSinaQuotes(codes: string[]): Promise<LiveQuote[]> {
  const symbols = codes.map((code) => sinaSymbol(code)).filter((item): item is string => Boolean(item))
  if (!symbols.length) return []
  for (const symbol of symbols) delete (window as unknown as Record<string, unknown>)[`hq_str_${symbol}`]
  const script = document.createElement("script")
  script.charset = "gbk"
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      script.remove()
      reject(new Error("行情请求超时"))
    }, 8000)
    script.src = `https://hq.sinajs.cn/list=${symbols.join(",")}`
    script.onload = () => {
      window.clearTimeout(timer)
      script.remove()
      resolve()
    }
    script.onerror = () => {
      window.clearTimeout(timer)
      script.remove()
      reject(new Error("行情请求失败"))
    }
    document.head.appendChild(script)
  })
  const lines = symbols.map((symbol) => {
    const value = (window as unknown as Record<string, unknown>)[`hq_str_${symbol}`]
    return `hq_str_${symbol}="${String(value ?? "")}";`
  })
  return parseSinaText(lines.join("\n"))
}

export async function fetchLiveQuotes(codes: string[]): Promise<LiveQuote[]> {
  const unique = [...new Set(codes.map((code) => normalizeCode(code)).filter(Boolean))]
  if (!unique.length) return []
  const eastmoney = await fetchEastmoneyQuotes(unique).catch(() => [])
  if (eastmoney.length) return eastmoney
  return fetchSinaQuotes(unique).catch(() => [])
}

async function searchEastmoney(keyword: string): Promise<SuggestRow[]> {
  const params = new URLSearchParams({
    input: keyword,
    type: "14",
    token: "D43BF722C8E33BDC906FB84D85E326E8",
    count: "8",
  })
  return parseSuggest(await jsonp(`${SUGGEST_URL}?${params.toString()}`))
}

async function searchTencent(keyword: string): Promise<SuggestRow[]> {
  delete (window as unknown as Record<string, unknown>).v_hint
  await loadScript(`${TENCENT_URL}?v=2&q=${encodeURIComponent(keyword)}&t=gp`)
  return parseTencentHint(String((window as unknown as Record<string, unknown>).v_hint ?? ""))
}

export async function searchStocks(keyword: string): Promise<SearchHit[]> {
  const text = keyword.trim()
  if (!text) return []
  const settled = await Promise.allSettled([searchTencent(text), searchEastmoney(text)])
  const found = settled.map((item) => (item.status === "fulfilled" ? item.value : []))
  const items: SearchHit[] = []
  const seen = new Set<string>()
  for (const rows of found) {
    for (const row of rows) {
      if (seen.has(row.code)) continue
      seen.add(row.code)
      items.push({ code: row.code, name: row.name, market: row.market })
      if (items.length >= 8) return items
    }
  }
  return items
}

export async function fetchHeadlines(keyword: string): Promise<Headline[]> {
  const text = keyword.trim()
  if (!text) return []
  const param = {
    uid: "",
    keyword: text,
    type: ["cmsArticleWebOld"],
    client: "web",
    clientType: "web",
    clientVersion: "curr",
    param: {
      cmsArticleWebOld: {
        searchScope: "default",
        sort: "time",
        pageIndex: 1,
        pageSize: 8,
        preTag: "",
        postTag: "",
      },
    },
  }
  const url = `${NEWS_URL}?param=${encodeURIComponent(JSON.stringify(param))}`
  try {
    return parseNews(await jsonp(url))
  } catch {
    return []
  }
}
