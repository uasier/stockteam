import { apiBase } from "./api"
import { getUserGradient, getUserInitials, resolveAvatar } from "./format"

type Props = {
  name: string
  avatar?: string
  className?: string
}

export function UserAvatar({ name, avatar, className }: Props) {
  const src = resolveAvatar(avatar, apiBase())
  if (src) {
    return <img className={`${className ?? ""} user-avatar-img`.trim()} src={src} alt="" />
  }
  return (
    <span className={className} style={{ background: getUserGradient(name) }}>
      {getUserInitials(name)}
    </span>
  )
}
