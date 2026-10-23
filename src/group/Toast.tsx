import { IconCheck, IconAlertTriangle, IconSparkles } from "./Icons"

export type ToastNotice = {
  id: number
  text: string
  type?: "success" | "error" | "info"
}

type Props = {
  notice: ToastNotice | null
}

export function Toast({ notice }: Props) {
  if (!notice) return null

  const type = notice.type || "info"

  return (
    <div className={`toast-container toast-${type}`} role="status" aria-live="polite">
      <div className="toast-icon">
        {type === "success" && <IconCheck size={16} />}
        {type === "error" && <IconAlertTriangle size={16} />}
        {type === "info" && <IconSparkles size={16} />}
      </div>
      <span className="toast-message">{notice.text}</span>
    </div>
  )
}
