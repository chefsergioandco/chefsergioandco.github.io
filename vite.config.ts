import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { existsSync } from 'node:fs'

// Workspace styles include body portals. Restrict them to the active admin route so
// returning to the public site keeps its approved typography and navigation.
const adminRouteStyles = {
  postcssPlugin: 'admin-route-boundary',
  Once(root: any) {
    if (!root.source?.input?.file?.replaceAll('\\', '/').includes('/admin/src/')) return
    root.walkRules((rule: any) => {
      if (rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return
      rule.selectors = rule.selectors.map((selector: string) => {
        if (/^:root(?=\b|[.:#\[]|$)/.test(selector)) return selector.replace(/^:root/, 'html[data-admin-route]')
        if (/^html(?=\b|[.:#\[]|$)/.test(selector)) return selector.replace(/^html/, 'html[data-admin-route]')
        return 'html[data-admin-route] ' + selector
      })
    })
  },
}
export default defineConfig({
  // '/' for the custom domain; set BASE_PATH=/repo-name/ for a github.io project preview.
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss(), autoprefixer(), adminRouteStyles] } },
  resolve: { dedupe: ['react', 'react-dom'] },
  define: {
    __SITE_MODE__: JSON.stringify(process.env.SITE_MODE || 'prototype'),
    // The selected page structure ships with the approved salon color and type system.
    __LOOK__: JSON.stringify(process.env.LOOK || 'c'),
    // The authored sequence is packaged separately. Keep its existing static treatment until it is installed.
    __PLATING_SEQUENCE_AVAILABLE__: JSON.stringify(['sequence.json', 'poster-640.webp', 'poster-1280.webp'].every(file => existsSync(new URL(`./public/art/plating/${file}`, import.meta.url)))),
  },
  build: { outDir: 'dist', emptyOutDir: true, manifest: true },
})
