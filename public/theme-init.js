// Appearance before first paint: a saved Light or Dark choice sets html[data-theme];
// no choice follows the system (prefers-color-scheme in styles.css). Kept separate
// from favicon-theme.js, which follows the browser chrome and therefore the system.
(function () {
  var colors = { light: '#fefefd', dark: '#191714' }
  var metas = document.querySelectorAll('meta[name="theme-color"]')
  var index
  // The admin workspace is always light, so its browser bar is too.
  if (/(^|\/)admin(\/|$)/.test(location.pathname)) {
    for (index = 0; index < metas.length; index++) metas[index].setAttribute('content', colors.light)
    return
  }
  var choice = null
  try { choice = localStorage.getItem('site-theme') } catch (error) { /* Private mode: follow the system. */ }
  if (choice !== 'light' && choice !== 'dark') return
  document.documentElement.setAttribute('data-theme', choice)
  // An explicit choice also recolours the browser bar, whatever the system says.
  for (index = 0; index < metas.length; index++) metas[index].setAttribute('content', colors[choice])
})()
