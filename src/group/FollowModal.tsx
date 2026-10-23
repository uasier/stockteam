import { useState, type FormEvent } from "react"
import { formatPrice } from "./format"
import { UserAvatar } from "./UserAvatar"
import { IconX, IconTrendingUp, IconArrowDown } from "./Icons"
import type { Activity } from "./types"

type Props = {
  activity: Activity
  onClose: () => void
  onSubmit: (price: string) => Promise<void>
}

export function FollowModal({ activity, onClose, onSubmit }: Props) {
  const [price, setPrice] = useState(activity.price || "")
  const [submitting, setSubmitting] = useState(false)

  const isBuy = activity.kind === "buy"

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      await onSubmit(price)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box follow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="follow-badge-row">
            <span className={`pill-badge ${isBuy ? "pill-up" : "pill-down"}`}>
              {isBuy ? <IconTrendingUp size={13} /> : <IconArrowDown size={13} />}
              {isBuy ? "跟买操作" : "跟卖操作"}
            </span>
            <span className="source-user">
              <UserAvatar
                className="avatar-tiny"
                name={activity.user.username}
                avatar={activity.user.avatar}
              />
              跟随 {activity.user.username}
            </span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <IconX size={18} />
          </button>
        </div>

        <div className="follow-stock-info">
          <div className="stock-titles">
            <h3 className="stock-name">{activity.stock.name || activity.stock.code}</h3>
            <span className="stock-code-tag">{activity.stock.code}</span>
          </div>
          <div className="source-price-tip">
            源参考价：<strong className="num">{formatPrice(activity.price)}</strong> 元
          </div>
        </div>

        <form onSubmit={handleSubmit} className="follow-form">
          <div className="form-item">
            <label>{isBuy ? "你的买入成本单价 (元)" : "你的卖出价格 (元)"}</label>
            <div className="input-affix-wrapper">
              <input
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="请输入价格"
                required
                autoFocus
              />
              <span className="input-suffix">¥</span>
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
              取消
            </button>
            <button
              type="submit"
              className={`btn-primary ${isBuy ? "btn-buy" : "btn-sell"}`}
              disabled={submitting || !price}
            >
              {submitting ? "提交中..." : isBuy ? "确认跟买入库" : "确认跟卖结平"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
