// Publication guard: the one site lives at https://chefsergioandco.github.io and points nowhere else.
import fs from 'node:fs'
import { DIST, report, walk } from './lib.mjs'

const origin = 'https://chefsergioandco.github.io'
const api = 'https://chef-sergio-staging.chefsergioandco.workers.dev'
const failures = []
if (fs.existsSync(`${DIST}/CNAME`)) failures.push('The site must not publish a custom-domain CNAME: its address is chefsergioandco.github.io')
let bundledApi = false, bundledAudience = false, pages = 0
for (const file of walk(DIST).filter(file => /\.(html|js|css|json|xml|txt|webmanifest|svg)$/.test(file))) {
  const content = fs.readFileSync(file, 'utf8')
  // Nothing may point to the old personal domain, ever; chefsergioandco.com is not an address of this site
  // (Sergio's hello@ mailbox is the one deliberate use of that domain).
  if (/cbassuarez/i.test(content)) failures.push(`${file}: refers to cbassuarez`)
  if (/https?:\/\/(?:[a-z0-9-]+\.)*chefsergioandco\.com\b/i.test(content)) failures.push(`${file}: links to chefsergioandco.com instead of chefsergioandco.github.io`)
  if (!/\.(html|js)$/.test(file)) continue
  if (file.endsWith('.js')) {
    bundledApi ||= content.includes(api)
    bundledAudience ||= content.includes(`${origin}/staging-api`)
    continue
  }
  pages++
  if (!/<meta name="robots" content="noindex">/.test(content)) failures.push(`${file}: staging page must remain noindex`)
  const canonical = content.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
  if (canonical && new URL(canonical).origin !== origin) failures.push(`${file}: canonical leaves the staging origin`)
}
if (!bundledApi || !bundledAudience) failures.push('Built account configuration must contain the business API and GitHub Auth0 audience')
report('publication target', failures, [`${pages} HTML documents checked; no custom domain, no cbassuarez, no chefsergioandco.com links`])
