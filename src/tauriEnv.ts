export function detectTauri(globalObj: {
  window?: { __TAURI_INTERNALS__?: unknown; isTauri?: boolean }
}): boolean {
  const win = globalObj.window
  return win != null && (win.__TAURI_INTERNALS__ != null || win.isTauri === true)
}

export function isTauri(): boolean {
  return detectTauri(globalThis as { window?: { __TAURI_INTERNALS__?: unknown; isTauri?: boolean } })
}
