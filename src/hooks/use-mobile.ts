import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * Tracks the mobile breakpoint.
 *
 * Uses `useSyncExternalStore` rather than an effect + setState: the media query
 * is an external store, so subscribing to it directly avoids the extra render
 * pass (and the hydration flash) that the effect-based version causes. The
 * server snapshot is `false`, so SSR renders the desktop layout.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function subscribe(onStoreChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onStoreChange)
  return () => mql.removeEventListener("change", onStoreChange)
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches
}

function getServerSnapshot() {
  return false
}
