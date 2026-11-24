import { useEffect, useState } from 'react'

/**
 * Chromium can render a page before the visitor opens it (Speculation Rules prerender, see next-page/).
 * The page runs while hidden, then is shown instantly. Anything that should happen only when a person
 * actually arrives (saving state, one-time entrances, page-view analytics) waits for activation.
 */
export const isPrerendering = () => typeof document !== 'undefined' && (document as Document & { prerendering?: boolean }).prerendering === true

export function whenActivated(): Promise<void> {
  if (!isPrerendering()) return Promise.resolve()
  return new Promise(resolve => document.addEventListener('prerenderingchange', () => resolve(), { once: true }))
}

/** False only while the page is a speculative prerender nobody has opened. */
export function useActivated() {
  const [activated, setActivated] = useState(() => !isPrerendering())
  useEffect(() => {
    if (activated) return
    let live = true
    void whenActivated().then(() => { if (live) setActivated(true) })
    return () => { live = false }
  }, [activated])
  return activated
}
