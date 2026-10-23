import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ApiError, api, loadSession, saveSession } from "./api"
import { AuthScreen } from "./AuthScreen"
import { DetailSheet } from "./DetailSheet"
import { FollowModal } from "./FollowModal"
import {
  calcClosedStats,
  calcHoldingStats,
  FEED_FILTERS,
  feedKindLabel,
  feedKindTone,
  formatDate,
  formatPct,
  formatPrice,
  getMarketLabel,
  groupHoldings,
  groupWatch,
  mergeStock,
  postSellChange,
  sortHoldings,
  sortWatch,
  tone,
  toNumber,
} from "./format"
import {
  IconArrowDown,
  IconArrowUp,
  IconBriefcase,
  IconCheck,
  IconCheckCircle,
  IconClock,
  IconCopy,
  IconExternalLink,
  IconKey,
  IconLogOut,
  IconMoon,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconStar,
  IconSun,
  IconTrendingUp,
  IconX,
  IconZap,
} from "./Icons"
import { Toast, type ToastNotice } from "./Toast"
import { UserAvatar } from "./UserAvatar"
import { openTonghuashunStock } from "../openStock"
import { formatTimeAgo } from "../time"
import type { Activity, ActivityKind, CircleView, Holding, Invite, SearchHit, Session, SortDir, SortKey, Stock, WatchItem } from "./types"

const SORTS: { key: SortKey; label: string }[] = [
  { key: "change", label: "涨跌幅" },
  { key: "price", label: "最新价" },
  { key: "attention", label: "关注度" },
  { key: "picked", label: "记录时间" },
]

export function GroupApp() {
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [view, setView] = useState<CircleView>("feed")
  const [watch, setWatch] = useState<WatchItem[]>([])
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [feed, setFeed] = useState<Activity[]>([])
  const [feedKind, setFeedKind] = useState<ActivityKind | "" | "trade">("")
  const [feedAlive, setFeedAlive] = useState(false)
  const feedRequest = useRef(0)
  const [invites, setInvites] = useState<Invite[]>([])
  const [sortKey, setSortKey] = useState<SortKey>("change")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [detailCode, setDetailCode] = useState<string | null>(null)
  const [notice, setNotice] = useState<ToastNotice | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date())
  const [menuOpen, setMenuOpen] = useState(false)
  const [usernameDraft, setUsernameDraft] = useState("")
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState("")
  const [profilePending, setProfilePending] = useState(false)
  const [aiKey, setAiKey] = useState("")
  const [aiKeyPending, setAiKeyPending] = useState(false)
  const [follow, setFollow] = useState<Activity | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  // 主题切换：light | dark
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("gp_theme")
    if (saved === "light" || saved === "dark") return saved
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  })

  useEffect(() => {
    if (!session) return
    setUsernameDraft(session.user.username)
  }, [session?.user.id, session?.user.username])

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
    localStorage.setItem("gp_theme", theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"))
  }

  const notify = useCallback((text: string, type: "success" | "error" | "info" = "info") => {
    const id = Date.now()
    setNotice({ id, text, type })
    window.setTimeout(() => {
      setNotice((current) => (current?.id === id ? null : current))
    }, 2800)
  }, [])

  useEffect(() => {
    if (!menuOpen || !session?.user.is_admin) return
    let alive = true
    api
      .aiKey()
      .then((result) => {
        if (alive) setAiKey(result.api_key)
      })
      .catch((err: unknown) => {
        if (alive) notify(err instanceof Error ? err.message : "API Key 没有载入", "error")
      })
    return () => {
      alive = false
    }
  }, [menuOpen, session?.user.is_admin, notify])

  const reload = useCallback(async () => {
    const requestId = ++feedRequest.current
    const kind = feedKind
    const [nextWatch, nextHoldings, nextFeed] = await Promise.all([
      api.watch(),
      api.holdings(),
      api.feed(kind || undefined),
    ])
    if (requestId !== feedRequest.current) return
    setWatch(nextWatch.items)
    setHoldings(nextHoldings.items)
    setFeed(nextFeed.items)
    if (!kind) setFeedAlive(nextFeed.items.length > 0)
    setLastRefreshedAt(new Date())
  }, [feedKind])

  useEffect(() => {
    document.title = "股票小分队 · 投资研讨圈"
    if (!session) return
    let alive = true
    api
      .me()
      .then((user) => {
        if (!alive) return
        const next = { ...session, user }
        saveSession(next)
        setSession(next)
      })
      .catch((err: unknown) => {
        if (!alive) return
        if (err instanceof ApiError && err.status === 401) {
          saveSession(null)
          setSession(null)
        }
      })
    return () => {
      alive = false
    }
  }, [session?.token])

  useEffect(() => {
    if (!session) return
    let alive = true
    reload().catch((err: unknown) => {
      if (!alive) return
      notify(err instanceof Error ? err.message : "列表加载未完成", "error")
    })
    return () => {
      alive = false
    }
  }, [session?.token, reload, notify])

  useEffect(() => {
    if (!session || view !== "invites") return
    api.invites().then((result) => setInvites(result.items)).catch((err: unknown) => notify(err instanceof Error ? err.message : "邀请码未加载", "error"))
  }, [session, view, notify])

  // 搜索自动补全
  useEffect(() => {
    const text = query.trim()
    if (text.length < 1 || view !== "watch") {
      setHits([])
      return
    }
    const timer = window.setTimeout(() => {
      api.search(text).then((result) => setHits(result.items)).catch(() => setHits([]))
    }, 220)
    return () => window.clearTimeout(timer)
  }, [query, view])

  const visibleCodes = useMemo(() => {
    const rows = view === "sold" ? holdings.filter((item) => item.status === "closed") : view === "hold" ? holdings.filter((item) => item.status === "open") : watch
    return rows.map((item) => item.stock.code)
  }, [view, watch, holdings])

  function applyQuotes(stocks: Stock[]) {
    setWatch((items) => mergeStock(items, stocks))
    setHoldings((items) => mergeStock(items, stocks))
    setFeed((items) => mergeStock(items, stocks))
    setLastRefreshedAt(new Date())
  }

  // 进入页面先拉一次现价，之后每 20 秒刷新。卖出后涨幅用的就是这份现价。
  useEffect(() => {
    if (!session || visibleCodes.length === 0 || view === "feed" || view === "invites") return
    let alive = true
    const load = () => {
      api
        .quotes(visibleCodes)
        .then((result) => {
          if (alive) applyQuotes(result.items)
        })
        .catch(() => undefined)
    }
    load()
    const timer = window.setInterval(load, 20000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [session, visibleCodes.join(","), view])

  async function refreshNow() {
    const codes = [...new Set([...watch.map((item) => item.stock.code), ...holdings.map((item) => item.stock.code)])]
    if (codes.length === 0) {
      notify("暂无观察或持仓股票，请先添加", "info")
      return
    }
    setRefreshing(true)
    try {
      const result = await api.refresh(codes)
      applyQuotes(result.items)
      notify("行情已全面更新，并同步至服务端", "success")
    } catch (err) {
      notify(err instanceof Error ? err.message : "行情刷新失败", "error")
    } finally {
      setRefreshing(false)
    }
  }

  async function addCode(code: string) {
    const followed = watch.some((item) => item.stock.code === code)
    try {
      await api.addWatch(code)
      setQuery("")
      setHits([])
      await reload()
      notify(followed ? "已跟进观察" : "已成功放入观察列表", "success")
    } catch (err) {
      notify(err instanceof Error ? err.message : "加入观察失败", "error")
    }
  }

  async function followWatch(activity: Activity) {
    try {
      await api.follow(activity.id)
      await reload()
      notify("已跟进观察", "success")
    } catch (err) {
      notify(err instanceof Error ? err.message : "跟进观察失败", "error")
    }
  }

  function chooseSort(key: SortKey) {
    if (key === sortKey) setSortDir((dir) => (dir === "desc" ? "asc" : "desc"))
    else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const openHoldings = useMemo(() => holdings.filter((item) => item.status === "open"), [holdings])
  const closedHoldings = useMemo(() => holdings.filter((item) => item.status === "closed"), [holdings])
  const sortedWatch = useMemo(() => sortWatch(watch, sortKey, sortDir), [watch, sortKey, sortDir])
  const watchGroups = useMemo(() => groupWatch(sortedWatch), [sortedWatch])
  const sortedOpen = useMemo(() => sortHoldings(openHoldings, sortKey, sortDir), [openHoldings, sortKey, sortDir])
  const holdingGroups = useMemo(() => groupHoldings(sortedOpen), [sortedOpen])
  const myOpen = useMemo(() => openHoldings.filter((item) => item.mine), [openHoldings])
  const sortedClosed = useMemo(() => sortHoldings(closedHoldings, sortKey, sortDir), [closedHoldings, sortKey, sortDir])

  // 统计概览
  const holdingStats = useMemo(() => calcHoldingStats(myOpen), [myOpen])
  const closedStats = useMemo(() => calcClosedStats(closedHoldings), [closedHoldings])

  if (!session) return <AuthScreen onEnter={setSession} />

  return (
    <div className="circle-app">
      {/* 顶部现代化导航与控制台 */}
      <header className="header-glass">
        <div className="header-inner">
          <div className="brand-group">
            <div className="brand-mark">
              <IconTrendingUp size={20} />
            </div>
            <div className="brand-texts">
              <div className="brand-tagline-row">
                <span className="brand-tagline">GP CIRCLE</span>
                <span className="market-live-pill">
                  <span className="live-dot pulse" />
                  <span>A股实时联动</span>
                </span>
              </div>
              <strong className="brand-name">股票小分队</strong>
            </div>
          </div>

          <div className="header-actions">
            {/* 行情刷新按钮与时间 */}
            <button
              type="button"
              className={`btn-action-refresh ${refreshing ? "spin-active" : ""}`}
              onClick={refreshNow}
              title="点击强制更新最新行情并反哺服务端"
            >
              <IconRefresh size={15} />
              <span className="btn-text">刷新行情</span>
            </button>

            {/* 主题切换 */}
            <button
              type="button"
              className="btn-icon-circle"
              onClick={toggleTheme}
              title={`切换至${theme === "dark" ? "明亮" : "暗黑"}模式`}
              aria-label="切换主题"
            >
              {theme === "dark" ? <IconSun size={17} /> : <IconMoon size={17} />}
            </button>

            {/* 用户菜单胶囊 */}
            <div className="user-dropdown-wrap">
              <button
                type="button"
                className="user-pill-btn"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <UserAvatar
                  className="user-avatar-tiny"
                  name={session.user.username}
                  avatar={avatarPreview || session.user.avatar}
                />
                <span className="user-display-text">{session.user.username}</span>
                {session.user.is_admin && <span className="admin-chip">管理员</span>}
              </button>

              {menuOpen && (
                <>
                  <div className="dropdown-overlay" onClick={() => setMenuOpen(false)} />
                  <div className="user-dropdown-menu animate-scale-in">
                    <div className="dropdown-user-info">
                      <label className="avatar-picker">
                        <UserAvatar
                          className="dropdown-avatar-lg"
                          name={usernameDraft || session.user.username}
                          avatar={avatarPreview || session.user.avatar}
                        />
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/gif,image/webp"
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null
                            setAvatarFile(file)
                            setAvatarPreview((current) => {
                              if (current.startsWith("blob:")) URL.revokeObjectURL(current)
                              return file ? URL.createObjectURL(file) : ""
                            })
                          }}
                        />
                      </label>
                      <div className="dropdown-user-names">
                        <strong>{session.user.username}</strong>
                      </div>
                    </div>

                    <div className="dropdown-config-group">
                      <label>用户名</label>
                      <input
                        className="server-input-box"
                        value={usernameDraft}
                        onChange={(event) => setUsernameDraft(event.target.value)}
                        maxLength={20}
                        spellCheck={false}
                      />
                      <div className="server-buttons-row">
                        {session.user.avatar && (
                          <button
                            type="button"
                            className="btn-text-sm"
                            disabled={profilePending}
                            onClick={() => {
                              setProfilePending(true)
                              api
                                .clearAvatar()
                                .then((user) => {
                                  const next = { ...session, user }
                                  saveSession(next)
                                  setSession(next)
                                  setAvatarFile(null)
                                  setAvatarPreview("")
                                  notify("头像已移除", "success")
                                })
                                .catch((err: unknown) =>
                                  notify(err instanceof Error ? err.message : "头像没有移除", "error"),
                                )
                                .finally(() => setProfilePending(false))
                            }}
                          >
                            移除头像
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-primary-sm"
                          disabled={profilePending || usernameDraft.trim().length < 2}
                          onClick={() => {
                            setProfilePending(true)
                            const save = async () => {
                              if (avatarFile) await api.uploadAvatar(avatarFile)
                              return api.updateProfile({ username: usernameDraft.trim() })
                            }
                            save()
                              .then((user) => {
                                const next = { ...session, user }
                                saveSession(next)
                                setSession(next)
                                setAvatarFile(null)
                                setAvatarPreview((current) => {
                                  if (current.startsWith("blob:")) URL.revokeObjectURL(current)
                                  return ""
                                })
                                notify("资料已更新", "success")
                              })
                              .catch((err: unknown) =>
                                notify(err instanceof Error ? err.message : "资料没有保存", "error"),
                              )
                              .finally(() => setProfilePending(false))
                          }}
                        >
                          {profilePending ? "保存中" : "保存资料"}
                        </button>
                      </div>
                    </div>

                    {session.user.is_admin && (
                      <>
                        <div className="dropdown-divider" />
                        <div className="dropdown-config-group">
                          <label>DeepSeek API Key</label>
                          <input
                            className="server-input-box"
                            type="password"
                            value={aiKey}
                            onChange={(event) => setAiKey(event.target.value)}
                            placeholder="sk-..."
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <div className="server-buttons-row">
                            <button
                              type="button"
                              className="btn-primary-sm"
                              disabled={aiKeyPending}
                              onClick={() => {
                                setAiKeyPending(true)
                                api
                                  .saveAiKey(aiKey.trim())
                                  .then((result) => {
                                    setAiKey(result.api_key)
                                    notify("DeepSeek API Key 已保存", "success")
                                  })
                                  .catch((err: unknown) =>
                                    notify(err instanceof Error ? err.message : "API Key 没有保存", "error"),
                                  )
                                  .finally(() => setAiKeyPending(false))
                              }}
                            >
                              {aiKeyPending ? "保存中" : "保存密钥"}
                            </button>
                          </div>
                        </div>
                      </>
                    )}

                    <div className="dropdown-divider" />

                    <button
                      type="button"
                      className="dropdown-item-logout"
                      onClick={() => {
                        api.logout().catch(() => undefined)
                        saveSession(null)
                        setSession(null)
                      }}
                    >
                      <IconLogOut size={15} />
                      <span>退出登录</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* 主工作区 */}
      <div className="main-workspace">
        {/* 左侧导航 Rail / 移动端悬浮底栏 */}
        <nav className="nav-dock" aria-label="主要导航">
          <button
            type="button"
            className={`dock-btn ${view === "feed" ? "active" : ""}`}
            onClick={() => setView("feed")}
          >
            <span className="dock-icon">
              <IconZap size={18} />
            </span>
            <span className="dock-label">圈子动态</span>
            {feedAlive && <span className="dock-badge dot-badge" />}
          </button>

          <button
            type="button"
            className={`dock-btn ${view === "watch" ? "active" : ""}`}
            onClick={() => setView("watch")}
          >
            <span className="dock-icon">
              <IconStar size={18} />
            </span>
            <span className="dock-label">自选观察</span>
            {watchGroups.length > 0 && <span className="dock-badge">{watchGroups.length}</span>}
          </button>

          <button
            type="button"
            className={`dock-btn ${view === "hold" ? "active" : ""}`}
            onClick={() => setView("hold")}
          >
            <span className="dock-icon">
              <IconBriefcase size={18} />
            </span>
            <span className="dock-label">当前持仓</span>
            {holdingGroups.length > 0 && <span className="dock-badge active-badge">{holdingGroups.length}</span>}
          </button>

          <button
            type="button"
            className={`dock-btn ${view === "sold" ? "active" : ""}`}
            onClick={() => setView("sold")}
          >
            <span className="dock-icon">
              <IconCheckCircle size={18} />
            </span>
            <span className="dock-label">已卖出</span>
            {closedHoldings.length > 0 && <span className="dock-badge">{closedHoldings.length}</span>}
          </button>

          {session.user.is_admin && (
            <button
              type="button"
              className={`dock-btn ${view === "invites" ? "active" : ""}`}
              onClick={() => setView("invites")}
            >
              <span className="dock-icon">
                <IconKey size={18} />
              </span>
              <span className="dock-label">邀请码</span>
              {invites.length > 0 && <span className="dock-badge">{invites.length}</span>}
            </button>
          )}
        </nav>

        {/* 核心内容面板区 */}
        <main className="content-stage">
          {view === "feed" && (
            <div className="toolbar-deck">
              <div className="sort-buttons-group feed-kind-filters" role="toolbar" aria-label="动态类型">
                <span className="toolbar-caption">动态类型：</span>
                {FEED_FILTERS.map((item) => (
                  <button
                    key={item.kind || "all"}
                    type="button"
                    className={`sort-pill-btn ${feedKind === item.kind ? "active" : ""}`}
                    aria-pressed={feedKind === item.kind}
                    onClick={() => setFeedKind(item.kind)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 排序筛选工具条 */}
          {view !== "feed" && view !== "invites" && (
            <div className="toolbar-deck">
              <div className="sort-buttons-group" role="toolbar" aria-label="股票排序">
                <span className="toolbar-caption">排序维度：</span>
                {SORTS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`sort-pill-btn ${sortKey === item.key ? "active" : ""}`}
                    onClick={() => chooseSort(item.key)}
                  >
                    <span>{view === "sold" && item.key === "change" ? "卖出后涨幅" : item.label}</span>
                    {sortKey === item.key && (
                      <span className="sort-indicator">
                        {sortDir === "desc" ? <IconArrowDown size={12} /> : <IconArrowUp size={12} />}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="refresh-status-tip">
                <IconClock size={12} />
                <span>上次同步 {formatTimeAgo(lastRefreshedAt.toISOString())}</span>
              </div>
            </div>
          )}

          {/* 1. 观察列表视图 */}
          {view === "watch" && (
            <section className="dashboard-panel animate-fade-in">
              {/* 搜索添加栏 */}
              <div className="search-deck">
                <form
                  className="search-input-wrapper"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const exact = hits[0]?.code || query.trim()
                    if (exact) addCode(exact)
                  }}
                >
                  <span className="search-icon">
                    <IconSearch size={18} />
                  </span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="输入股票代码 / 名称 / 拼音首字母，回车快速加入观察"
                    aria-label="搜索并添加股票"
                  />
                  {query && (
                    <button
                      type="button"
                      className="search-clear-btn"
                      onClick={() => {
                        setQuery("")
                        setHits([])
                      }}
                    >
                      <IconX size={15} />
                    </button>
                  )}

                  {/* 联想搜索结果下拉框 */}
                  {hits.length > 0 && (
                    <div className="search-dropdown-menu animate-slide-down">
                      <div className="dropdown-label">搜索建议（点击或按回车直入观察）：</div>
                      <div className="dropdown-hits-list">
                        {hits.map((hit) => (
                          <button
                            key={hit.code}
                            type="button"
                            className="hit-row-btn"
                            onClick={() => addCode(hit.code)}
                          >
                            <div className="hit-left">
                              <span className="market-tag-sm">{getMarketLabel(hit.code)}</span>
                              <strong className="hit-name">{hit.name || hit.code}</strong>
                              <span className="hit-code num">{hit.code}</span>
                            </div>
                            <span className="hit-action-tag">+ 观察</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </form>
              </div>

              {/* 空状态 */}
              {watchGroups.length === 0 && (
                <div className="panel-empty-box">
                  <div className="empty-icon-ring">
                    <IconStar size={36} />
                  </div>
                  <h3>小群还没有观察的股票</h3>
                  <p>在上方搜索框输入任意 A 股代码（如 600519、000001 或 贵州茅台），加入后全员都能看到</p>
                </div>
              )}

              {/* 股票列表流 */}
              {watchGroups.length > 0 && (
                <div className="stock-cards-stream">
                  {watchGroups.map((group) => {
                    return (
                      <div
                        key={group.stock.code}
                        className="stock-card-row"
                        onClick={() => setDetailCode(group.stock.code)}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="card-left-col">
                          <div className="stock-title-line">
                            <span className="market-badge">{getMarketLabel(group.stock.code)}</span>
                            <strong className="stock-name-text">{group.stock.name || group.stock.code}</strong>
                            <span className="stock-code-text num">{group.stock.code}</span>
                            <span className="watch-pickers">
                              {group.watchers.map((watcher) => (
                                <span key={watcher.id} className="watch-picker">
                                  <UserAvatar
                                    className="watch-picker-avatar"
                                    name={watcher.user.username}
                                    avatar={watcher.user.avatar}
                                  />
                                  {watcher.user.username}
                                </span>
                              ))}
                            </span>
                            {!group.watchers.some((watcher) => watcher.mine) && (
                              <button
                                type="button"
                                className="btn-follow-watch"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  addCode(group.stock.code)
                                }}
                              >
                                跟进观察
                              </button>
                            )}
                          </div>

                          {group.watchers.filter((watcher) => watcher.custom_price || watcher.tags.length || watcher.note).map((watcher) => {
                            const priceDiff =
                              watcher.custom_price && group.stock.price
                                ? ((toNumber(group.stock.price)! - toNumber(watcher.custom_price)!) / toNumber(watcher.custom_price)!) * 100
                                : null
                            return (
                              <div className="stock-meta-line" key={watcher.id}>
                                {group.watchers.length > 1 && (
                                  <span className="meta-picker-name">{watcher.user.username}</span>
                                )}
                                <span className="meta-picked-date">
                                  自选 {formatDate(watcher.custom_date)}
                                </span>
                                {watcher.custom_price && (
                                  <span className="meta-picked-price">
                                    自选价 ¥{formatPrice(watcher.custom_price)}
                                    {priceDiff !== null && (
                                      <span className={`diff-pill ${tone(priceDiff)} num`}>
                                        {priceDiff > 0 ? "+" : ""}{priceDiff.toFixed(2)}%
                                      </span>
                                    )}
                                  </span>
                                )}
                                {watcher.tags.map((tag) => (
                                  <span key={tag} className="card-tag-pill">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )
                          })}
                        </div>

                        <div className="card-right-col">
                          <div className="quote-price-group">
                            <span className="quote-price-main num">
                              {formatPrice(group.stock.price)}
                            </span>
                            <span className={`quote-change-badge ${tone(group.stock.change_pct)} num`}>
                              {formatPct(group.stock.change_pct)}
                            </span>
                          </div>

                          <div className="card-hover-actions">
                            <button
                              type="button"
                              className="btn-quick-act"
                              onClick={(e) => {
                                e.stopPropagation()
                                openTonghuashunStock(group.stock.code)
                              }}
                              title="前往同花顺查看"
                            >
                              <IconExternalLink size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {/* 2. 持仓列表视图 */}
          {view === "hold" && (
            <section className="dashboard-panel animate-fade-in">
              {/* 持仓战绩大看板 */}
              {holdingGroups.length > 0 && (
                <div className="portfolio-kpi-banner">
                  <div className="kpi-banner-glow" />
                  <div className="kpi-banner-item">
                    <span className="kpi-label">持仓只数</span>
                    <strong className="kpi-val num">{holdingGroups.length}</strong>
                    <span className="kpi-sub">小群里未结平的标的</span>
                  </div>
                  {myOpen.length > 0 && (
                    <div className="kpi-banner-item">
                      <span className="kpi-label">我的平均浮动盈亏</span>
                      <strong className={`kpi-val num ${tone(holdingStats.avgPnlPct)}`}>
                        {formatPct(holdingStats.avgPnlPct)}
                      </strong>
                      <span className="kpi-sub">按买入价与现价计算</span>
                    </div>
                  )}
                </div>
              )}

              {holdingGroups.length === 0 && (
                <div className="panel-empty-box">
                  <div className="empty-icon-ring">
                    <IconBriefcase size={36} />
                  </div>
                  <h3>目前没有处于持仓状态的股票</h3>
                  <p>在观察列表点击任意股票卡片，填入买入成本，即可开启持仓盈亏追踪</p>
                </div>
              )}

              {holdingGroups.length > 0 && (
                <div className="stock-cards-stream">
                  {holdingGroups.map((group) => {
                    const mine = group.holders.find((holder) => holder.mine)
                    return (
                      <div
                        key={group.stock.code}
                        className="stock-card-row"
                        onClick={() => setDetailCode(group.stock.code)}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="card-left-col">
                          <div className="stock-title-line">
                            <span className="market-badge">{getMarketLabel(group.stock.code)}</span>
                            <strong className="stock-name-text">{group.stock.name || group.stock.code}</strong>
                            <span className="stock-code-text num">{group.stock.code}</span>
                            <span className="watch-pickers">
                              {group.holders.map((holder) => (
                                <span key={holder.id} className="watch-picker">
                                  <UserAvatar
                                    className="watch-picker-avatar"
                                    name={holder.user.username}
                                    avatar={holder.user.avatar}
                                  />
                                  {holder.user.username}
                                </span>
                              ))}
                            </span>
                          </div>

                          {mine && (
                            <div className="stock-meta-line">
                              <span>成本 ¥{formatPrice(mine.cost_price)}</span>
                              <span>·</span>
                              <span>{formatDate(mine.opened_at)} 建仓</span>
                            </div>
                          )}
                        </div>

                        <div className="card-right-col">
                          <div className="quote-price-group">
                            <span className="quote-price-main num">
                              {formatPrice(group.stock.price)}
                            </span>
                            <span className={`quote-change-badge ${tone(mine ? mine.pnl_pct : group.stock.change_pct)} num`}>
                              {mine ? `浮盈 ${formatPct(mine.pnl_pct)}` : formatPct(group.stock.change_pct)}
                            </span>
                          </div>

                          {mine && (
                            <div className="card-hover-actions">
                              <button
                                type="button"
                                className="btn-quick-act"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setDetailCode(group.stock.code)
                                }}
                                title="平仓卖出"
                              >
                                卖出结平
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {/* 3. 已卖出历史视图 */}
          {view === "sold" && (
            <section className="dashboard-panel animate-fade-in">
              {closedHoldings.length > 0 && (
                <div className="portfolio-kpi-banner sold-kpi-banner">
                  <div className="kpi-banner-glow" />
                  <div className="kpi-banner-item">
                    <span className="kpi-label">已结清交割</span>
                    <strong className="kpi-val num">{closedStats.closedCount} 笔</strong>
                    <span className="kpi-sub">历史归档总记录</span>
                  </div>
                  <div className="kpi-banner-item">
                    <span className="kpi-label">交易胜率</span>
                    <strong className="kpi-val num">{closedStats.winRate.toFixed(1)}%</strong>
                    <span className="kpi-sub">盈利 {closedStats.winCount} 笔</span>
                  </div>
                  <div className="kpi-banner-item">
                    <span className="kpi-label">平均实现盈亏</span>
                    <strong className={`kpi-val num ${tone(closedStats.avgRealizedPnlPct)}`}>
                      {formatPct(closedStats.avgRealizedPnlPct)}
                    </strong>
                    <span className="kpi-sub">按买入价与卖出价计算</span>
                  </div>
                  <div className="kpi-banner-item">
                    <span className="kpi-label">卖出后平均涨幅</span>
                    <strong className={`kpi-val num ${tone(closedStats.avgPostSellPct)}`}>
                      {formatPct(closedStats.avgPostSellPct)}
                    </strong>
                    <span className="kpi-sub">
                      {closedStats.postSellCount > 0
                        ? `上涨 ${closedStats.roseAfterSellCount} 笔 · 下跌 ${closedStats.fellAfterSellCount} 笔`
                        : "还没有卖出后的现价"}
                    </span>
                  </div>
                </div>
              )}

              {sortedClosed.length === 0 && (
                <div className="panel-empty-box">
                  <div className="empty-icon-ring">
                    <IconCheckCircle size={36} />
                  </div>
                  <h3>暂无卖出结清记录</h3>
                  <p>持仓结平后的买卖交割战绩将保存在这里，用于总结回顾投资复盘</p>
                </div>
              )}

              {sortedClosed.length > 0 && (
                <div className="stock-cards-stream">
                  {sortedClosed.map((item) => {
                    const afterSell = postSellChange(item)
                    return (
                    <div
                      key={item.id}
                      className="stock-card-row"
                      onClick={() => setDetailCode(item.stock.code)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="card-left-col">
                        <div className="stock-title-line">
                          <span className="market-badge">{getMarketLabel(item.stock.code)}</span>
                          <strong className="stock-name-text">{item.stock.name || item.stock.code}</strong>
                          <span className="stock-code-text num">{item.stock.code}</span>
                        </div>

                        <div className="stock-meta-line">
                          <span>买入 ¥{formatPrice(item.cost_price)}</span>
                          <span>·</span>
                          <span>{formatDate(item.closed_at)} 卖出</span>
                          <span>·</span>
                          <span className={tone(item.pnl_pct)}>实现盈亏 {formatPct(item.pnl_pct)}</span>
                        </div>
                        <div className="after-sell-path num">
                          <span>卖出 ¥{formatPrice(item.sell_price)}</span>
                          <span aria-hidden="true">→</span>
                          <span>现价 ¥{formatPrice(item.stock.price)}</span>
                        </div>
                      </div>

                      <div className="card-right-col after-sell-col">
                        <div className={`after-sell-figure ${tone(afterSell)}`}>
                          <span className="after-sell-label">卖出后涨幅</span>
                          <strong className="num">{formatPct(afterSell)}</strong>
                        </div>
                      </div>
                    </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {/* 4. 圈子动态视图（Feed） */}
          {view === "feed" && (
            <section className="dashboard-panel animate-fade-in">
              {feed.length === 0 && (
                <div className="panel-empty-box">
                  <div className="empty-icon-ring">
                    <IconZap size={36} />
                  </div>
                  <h3>
                    {feedKind === "trade"
                      ? "没有买入或卖出动态"
                      : feedKind
                        ? `没有${feedKindLabel(feedKind)}动态`
                        : "小群圈子暂无新动态"}
                  </h3>
                  <p>
                    {feedKind
                      ? "换一个类型，或等小群里出现这类操作"
                      : "加入观察、更新自选、买卖、关注和评论都会记在这里"}
                  </p>
                </div>
              )}

              {feed.length > 0 && (
                <div className="feed-timeline-stream">
                  {feed.map((item) => {
                    const tradable = item.kind === "buy" || item.kind === "sell"
                    const kindTone = feedKindTone(item.kind)
                    const isSelf = item.user.id === session.user.id

                    const stockName = item.stock.name || item.stock.code
                    return (
                      <article key={item.id} className={`feed-activity-card feed-${item.kind} ${tradable ? "is-trade" : "is-note"}`}>
                        <header className="feed-lead">
                          <UserAvatar
                            className="feed-avatar"
                            name={item.user.username}
                            avatar={item.user.avatar}
                          />
                          <div className="feed-lead-copy">
                            <p className="feed-sentence">
                              <strong>{item.user.username}</strong>
                              <span className={`feed-verb verb-${kindTone}`}>{feedKindLabel(item.kind)}</span>
                              {item.source_id && <span className="follow-indicator-tag">跟随</span>}
                              <button
                                type="button"
                                className="feed-stock-link"
                                onClick={() => setDetailCode(item.stock.code)}
                              >
                                {stockName}
                                <span className="num">{item.stock.code}</span>
                              </button>
                            </p>
                            <time className="feed-time-ago">{formatTimeAgo(item.created_at)}</time>
                          </div>
                          {tradable && (
                            <div className={`feed-deal-figure ${kindTone}`}>
                              <span>{item.kind === "buy" ? "买入价" : "卖出价"}</span>
                              <strong className="num">¥{formatPrice(item.price)}</strong>
                            </div>
                          )}
                        </header>

                        {item.kind === "comment" && item.note && <blockquote className="feed-quote">{item.note}</blockquote>}
                        {item.kind !== "comment" && item.note && <p className="feed-aside">{item.note}</p>}

                        <div className="feed-footline">
                          <button
                            type="button"
                            className="feed-quote-chip"
                            onClick={() => setDetailCode(item.stock.code)}
                          >
                            <span>现价</span>
                            <strong className="num">¥{formatPrice(item.stock.price)}</strong>
                            <span className={`quote-change-badge ${tone(item.stock.change_pct)} num`}>
                              {formatPct(item.stock.change_pct)}
                            </span>
                          </button>
                          {!isSelf && item.kind === "watch" && !watch.some((row) => row.mine && row.stock.code === item.stock.code) && (
                            <button type="button" className="btn-follow-action follow-watch" onClick={() => followWatch(item)}>
                              跟进观察
                            </button>
                          )}
                          {!isSelf && tradable && (
                            <button
                              type="button"
                              className={`btn-follow-action ${item.kind === "buy" ? "follow-buy" : "follow-sell"}`}
                              onClick={() => setFollow(item)}
                            >
                              {item.kind === "buy" ? "跟买" : "跟卖"}
                            </button>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {/* 5. 邀请码视图（管理员） */}
          {view === "invites" && session.user.is_admin && (
            <section className="dashboard-panel animate-fade-in">
              <div className="invites-admin-head">
                <div className="head-text">
                  <h2>小群邀请码管理</h2>
                  <p>生成独一无二的通行邀请码，发给拟邀请加入小群的同伴，每张仅可激活一次</p>
                </div>
                <button
                  type="button"
                  className="btn-primary-gradient"
                  onClick={() =>
                    api
                      .createInvites(1)
                      .then(async (created) => {
                        const code = created.items[0]?.code
                        if (code && navigator.clipboard) {
                          await navigator.clipboard.writeText(code).catch(() => undefined)
                        }
                        const listed = await api.invites()
                        setInvites(listed.items)
                        notify(code ? `已成功生成 ${code} 并写入剪贴板` : "邀请码已生成", "success")
                      })
                      .catch((err: unknown) =>
                        notify(err instanceof Error ? err.message : "生成邀请码失败", "error"),
                      )
                  }
                >
                  <IconPlus size={16} />
                  <span>生成一张新邀请码</span>
                </button>
              </div>

              {invites.length === 0 && (
                <div className="panel-empty-box">
                  <div className="empty-icon-ring">
                    <IconKey size={36} />
                  </div>
                  <h3>还没有生成过邀请码</h3>
                  <p>点击上方按钮生成邀请码，即可发给微信或群友加入小群</p>
                </div>
              )}

              {invites.length > 0 && (
                <div className="invites-cards-grid">
                  {invites.map((item) => {
                    const isUsed = Boolean(item.used_by)
                    const isJustCopied = copiedCode === item.code

                    return (
                      <div
                        key={item.id}
                        className={`invite-code-card ${isUsed ? "used" : "active"}`}
                        onClick={() => {
                          navigator.clipboard?.writeText(item.code)
                          setCopiedCode(item.code)
                          notify(`已复制邀请码：${item.code}`, "success")
                          window.setTimeout(() => setCopiedCode((c) => (c === item.code ? null : c)), 2000)
                        }}
                      >
                        <div className="invite-card-top">
                          <span className={`invite-status-chip ${isUsed ? "chip-used" : "chip-active"}`}>
                            {isUsed ? "已激活兑换" : "可使用"}
                          </span>
                          <span className="copy-action-hint">
                            {isJustCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                            <span>{isJustCopied ? "已复制" : "点击复制"}</span>
                          </span>
                        </div>

                        <div className="invite-code-display num">{item.code}</div>

                        <div className="invite-card-footer">
                          {isUsed ? (
                            <span className="used-info">使用者：@{item.used_by}</span>
                          ) : (
                            <span className="unused-info">创建于 {formatDate(item.created_at)}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          <footer className="footer-disclaimer">
            <p>
              行情每 20 秒静默更新 · 红涨绿跌为 A 股标准 · 圈子记录与 AI 风险分析仅供群内研讨，不构成任何投资依据与实盘建议
            </p>
          </footer>
        </main>
      </div>

      {/* 股票详情抽屉 */}
      {detailCode && (
        <DetailSheet
          code={detailCode}
          onClose={() => setDetailCode(null)}
          onChanged={reload}
          notify={notify}
        />
      )}

      {/* 跟买跟卖模态框 */}
      {follow && (
        <FollowModal
          activity={follow}
          onClose={() => setFollow(null)}
          onSubmit={async (price) => {
            try {
              await api.follow(follow.id, { price })
              setFollow(null)
              await reload()
              notify(follow.kind === "buy" ? "跟买建仓成功" : "跟卖结平成功", "success")
            } catch (err) {
              notify(err instanceof Error ? err.message : "跟单提交失败", "error")
            }
          }}
        />
      )}

      {/* 全局通知 */}
      <Toast notice={notice} />
    </div>
  )
}
