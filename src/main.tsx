import React from "react"
import ReactDOM from "react-dom/client"
import { GroupApp } from "./group/GroupApp"
import { applyMobileClass } from "./platform"
import "./group/group.css"

function syncMobileClass() {
  applyMobileClass(document.documentElement, navigator.userAgent, window.innerWidth)
}

syncMobileClass()
window.addEventListener("resize", syncMobileClass)

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <GroupApp />
  </React.StrictMode>,
)
