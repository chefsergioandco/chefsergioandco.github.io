# Chef Sergio & Co.

The site is `https://chefsergioandco.github.io/`, with booking at `/book/`, customer accounts at `/dashboard/` and the restricted workspace at `/admin/`. This repository's `main` branch is the only line of development; every push to it deploys the site.

The API is `https://chef-sergio-staging.chefsergioandco.workers.dev`, hosted in the business Cloudflare account for `admin.chefsergioandco@gmail.com`. All frontend requests derive their API origin from `src/account/config.ts`. Auth0 provides Google and email/password sign-in through a public PKCE application; account and admin requests use bearer tokens and require server authorization.

This public repository contains frontend source, artwork and fonts. It contains no customer database, Worker server source or runtime credentials. The GitHub Pages workflow pins the root base path and prototype mode, publishes no custom-domain CNAME and keeps the site noindex.

Provider delivery and payments are controlled separately by the backend. An implemented screen or a passing local fixture does not establish live email delivery, verified email, payment acceptance or customer authorization. Preview settings never fabricate a successful payment or reserve a date. See [STAGING.md](STAGING.md) for account configuration and validation boundaries.

Install with `npm ci`. Run `npm run check:types`, `npm run check:booking` and `PUBLIC_URL=https://chefsergioandco.github.io npm run build`. Serve the build with `PORT=4423 npm run preview`; `npm run check:account` checks browser behavior using clearly fictional transport fixtures. Live OAuth, email links and authenticated journeys must also be verified on the actual site.

Pages get ready before a visitor opens them. Internal links are followed in the page (the account session lives in memory), so `src/next-page/` predicts the next page from where the pointer is heading and braking, keyboard focus, taps and, on phones, what is in view after a scroll, then loads that page's code, styles and lead photo ahead of the click. `scripts/prerender.mjs` writes each public page's hints into its head; account, sign-in, receipt, invitation and checkout pages are never loaded ahead. Code that should run only when a person arrives on a page (saving a booking draft, page-view analytics) can wait for `useActivated()`/`whenActivated()` in `src/activation.ts`. Automated browsers get none of this, and `data-no-prefetch` opts a link out. `npm run check:next-page` measures prediction accuracy and timings in Chrome on a simulated 4G link.

Open business decisions and labelled reference photography remain prototype material until approved.
