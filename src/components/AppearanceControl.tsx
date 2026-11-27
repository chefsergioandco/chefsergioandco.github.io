import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
const KEY = 'site-theme'
const BAR = { light: '#fefefd', dark: '#191714' } as const
const themes: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/** Mirrors public/theme-init.js, which applies a saved choice before first paint. */
function apply(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = BAR[theme]
}
const saved = (): Theme | null => {
  try { const value = localStorage.getItem(KEY); return value === 'light' || value === 'dark' ? value : null } catch { return null }
}

/** Light or Dark. Until a visitor chooses, the site follows the device setting. */
export function AppearanceControl() {
  // Unknown while prerendering; resolved from the saved choice or the device after hydration.
  const [theme, setTheme] = useState<Theme | null>(null)
  useEffect(() => {
    const device = matchMedia('(prefers-color-scheme: dark)')
    const resolve = () => setTheme(saved() ?? (device.matches ? 'dark' : 'light'))
    resolve()
    // With no saved choice, keep reflecting the device as it changes.
    const follow = () => { if (!saved()) resolve() }
    // Another tab made a choice: apply it here too.
    const sync = (event: StorageEvent) => { if (event.key !== KEY) return; const next = saved(); if (next) apply(next); resolve() }
    device.addEventListener('change', follow)
    window.addEventListener('storage', sync)
    return () => { device.removeEventListener('change', follow); window.removeEventListener('storage', sync) }
  }, [])
  const choose = (next: Theme) => {
    setTheme(next)
    try { localStorage.setItem(KEY, next) } catch { /* Applies to this page only. */ }
    apply(next)
  }
  return (
    <div className="footer-appearance" role="radiogroup" aria-labelledby="footer-appearance-label">
      <span id="footer-appearance-label" className="footer-appearance-label">Appearance</span>
      {themes.map(option => (
        <label key={option.value}>
          <input type="radio" name="site-appearance" value={option.value} checked={theme === option.value} onChange={() => choose(option.value)} />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  )
}
