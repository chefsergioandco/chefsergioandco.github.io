# Chef Sergio & Co. staging

The isolated staging frontend is `https://chefsergioandco.github.io/`, with booking at `/book/`, customer accounts at `/dashboard/` and the restricted workspace at `/admin/`.

The API is `https://chef-sergio-staging.chefsergioandco.workers.dev`, hosted in the business Cloudflare account for `admin.chefsergioandco@gmail.com`. All frontend requests derive their API origin from `src/account/config.ts`. Auth0 provides Google and email/password sign-in through a public PKCE application; account and admin requests use bearer tokens and require server authorization.

This public repository contains frontend source, artwork and fonts. It contains no customer database, Worker server source or runtime credentials. The GitHub Pages workflow pins the root base path and prototype mode, publishes no custom-domain CNAME and keeps the site noindex. The existing personal site and real Chef Sergio domain are outside this staging deployment.

Provider delivery and payments are controlled separately by the backend. An implemented screen or a passing local fixture does not establish live email delivery, verified email, payment acceptance or customer authorization. Preview settings never fabricate a successful payment or reserve a date. See [STAGING.md](STAGING.md) for configuration and validation boundaries.

Install with `npm ci`. Run `npm run check:types`, `npm run check:booking` and `PUBLIC_URL=https://chefsergioandco.github.io npm run build`. Serve the build with `PORT=4423 npm run preview`; `npm run check:account` checks browser behavior using clearly fictional transport fixtures. Live OAuth, email links and authenticated journeys must also be verified on the actual staging origin.

Open business decisions and labelled reference photography remain staging material until approved. Moving to `chefsergioandco.com` is a separate coordinated change to Pages, Auth0 callbacks, allowed origins and backend link settings.
