export function navigateAccount(target: string, replace = false) {
  const url = new URL(target, location.origin)
  if (url.origin !== location.origin) throw new Error('Invalid account destination.')
  history[replace ? 'replaceState' : 'pushState'](null, '', url.pathname + url.search + url.hash)
  window.dispatchEvent(new Event('site:navigate'))
}
