function normalizeStockCode(code: string | undefined): string {
  return String(code ?? "").match(/\d{6}/)?.[0] ?? ""
}

/** 同花顺行情市场号：沪/科创 17，深/创业 33，北交所新代码 151，旧代码 145。 */
function tonghuashunMarketId(code: string | undefined): string | null {
  const trimmed = normalizeStockCode(code)
  if (!trimmed) return null
  if (trimmed.startsWith("6")) return "17"
  if (trimmed.startsWith("0") || trimmed.startsWith("3")) return "33"
  if (trimmed.startsWith("92")) return "151"
  if (trimmed.startsWith("4") || trimmed.startsWith("8")) return "145"
  return null
}

/** 同花顺手机个股页。市场前缀与 stockpage.10jqka.com.cn 的移动端跳转一致。 */
export function buildTonghuashunPageUrl(code: string | undefined): string {
  const trimmed = normalizeStockCode(code)
  const market = tonghuashunMarketId(trimmed)
  if (!trimmed || !market) return "#"
  const prefix = market === "17" || market === "33" ? "hs" : market
  return `https://m.10jqka.com.cn/stockpage/${prefix}_${trimmed}/`
}

/** 唤起同花顺 App 个股分时页。webid=2205 为行情页。 */
export function buildTonghuashunAppUrl(code: string | undefined): string {
  const trimmed = normalizeStockCode(code)
  const market = tonghuashunMarketId(trimmed)
  if (!trimmed || !market) return ""
  const client = `client.html?action=ymtz^webid=2205^stockcode=${trimmed}^marketid=${market}`
  return `amihexin://command=gotopage&clientUrl=${client}`
}
