// Fixed-color files also work in browsers that ignore SVG favicon media queries.
;(function () {
  var script = document.currentScript
  if (!script || !window.matchMedia) return
  var source = new URL(script.src)
  var base = new URL('.', source)
  var preference = window.matchMedia('(prefers-color-scheme: dark)')
  function update() {
    var dark = preference.matches
    var suffix = dark ? '-dark' : ''
    var files = {
      ico: 'favicon' + suffix + '.ico',
      '16': 'favicon-16x16' + suffix + '.png',
      '32': 'favicon-32x32' + suffix + '.png',
      svg: 'favicon-' + (dark ? 'dark' : 'light') + '.svg'
    }
    document.querySelectorAll('link[data-favicon]').forEach(function (link) {
      var file = files[link.getAttribute('data-favicon')]
      if (file) link.href = new URL(file + source.search, base).href
    })
  }
  update()
  if (preference.addEventListener) preference.addEventListener('change', update)
  else preference.addListener(update)
})()
