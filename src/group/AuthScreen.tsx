import { useState, type FormEvent } from "react"
import { api, saveSession } from "./api"
import {
  IconEye,
  IconEyeOff,
  IconKey,
  IconTrendingUp,
  IconUser,
} from "./Icons"
import type { Session } from "./types"

type Props = {
  onEnter: (session: Session) => void
}

export function AuthScreen({ onEnter }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [inviteCode, setInviteCode] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError("")
    try {
      const session =
        mode === "login"
          ? await api.login({ username: username.trim(), password })
          : await api.register({
              username: username.trim(),
              password,
              invite_code: inviteCode.trim(),
            })
      saveSession(session)
      onEnter(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求未完成，请重试")
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="auth-wrap">
      <div className="auth-ambient-glow" />

      <div className="auth-card-modern">
        <header className="auth-header">
          <div className="auth-badge">
            <span className="auth-badge-icon">
              <IconTrendingUp size={16} />
            </span>
            <span>GP CIRCLE · 协同投研</span>
          </div>
          <h1 className="auth-title">股票小分队</h1>
          <p className="auth-subtitle">
            群友自选看板 · 买卖记账 · 跟投协作 · AI风险排查
          </p>
        </header>

        <div className="auth-segmented" role="tablist">
          <button
            type="button"
            className={`auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => {
              setMode("login")
              setError("")
            }}
          >
            账号登录
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === "register" ? "active" : ""}`}
            onClick={() => {
              setMode("register")
              setError("")
            }}
          >
            凭邀请码注册
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <div className="form-group">
            <label>用户名</label>
            <div className="input-affix-wrapper">
              <span className="input-prefix">
                <IconUser size={16} />
              </span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="请输入用户名"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>密码</label>
            <div className="input-affix-wrapper">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="请输入密码"
                required
              />
              <button
                type="button"
                className="input-eye-btn"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
              </button>
            </div>
          </div>

          {mode === "register" && (
            <div className="form-group animate-slide-down">
              <label>邀请码</label>
              <div className="input-affix-wrapper">
                <span className="input-prefix">
                  <IconKey size={16} />
                </span>
                <input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="首位成员填写 ADMIN"
                  required
                  spellCheck={false}
                />
              </div>
              <span className="input-hint">首位注册使用邀请码 ADMIN，通过后即为管理员。之后的邀请码由管理员发放，一经使用即作废</span>
            </div>
          )}

          {error && <div className="auth-error-banner">{error}</div>}

          <button className="auth-submit-btn" type="submit" disabled={pending}>
            {pending ? (
              <span className="btn-loading">
                <span className="spinner-dots" /> 验证中...
              </span>
            ) : mode === "login" ? (
              "进入小群工作台"
            ) : (
              "激活加入小群"
            )}
          </button>
        </form>

        <div className="auth-footer-bar">
          <p className="auth-disclaimer">
            数据接入公开证券行情接口 · 小群记录仅供交流研讨，不构成任何投资建议
          </p>
        </div>
      </div>
    </main>
  )
}
