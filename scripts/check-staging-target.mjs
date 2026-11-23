// Publication guard for this isolated GitHub Pages repository.
import fs from 'node:fs'
import { DIST, report, walk } from './lib.mjs'

const origin = 'https://chefsergioandco.github.io'
const api = 'https://chef-sergio-staging.chefsergioandco.workers.dev'
const failures = []
if (fs.existsSync(`${DIST}/CNAME`)) failures.push('Staging must not publish a custom-domain CNAME')
let bundledApi = false, bundledAudience = false, pages = 0
for (const file of walk(DIST).filter(file => /\.(html|js)$/.test(file))) {
  const content = fs.readFileSync(file, 'utf8')
  if (content.includes('chef-sergio-accounts.cbassuarez.workers.dev') || content.includes('cbassuarez.com/chef-sergio-and-co')) failures.push(`${file}: stale personal-account target`)
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
report('staging publication target', failures, [`${pages} HTML documents checked; no custom domain or personal backend`])
