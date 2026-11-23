# GitHub Pages staging

The static frontend targets https://chefsergioandco.github.io/ with base `/`. The public booking API and bearer account API use the isolated Chef Sergio Cloudflare Worker. This checkout does not modify or migrate the existing public site or Sites booking records.

Public configuration lives in `src/account/config.ts`. Booking, account, receipt and newsletter requests share the business-owned API origin `https://chef-sergio-staging.chefsergioandco.workers.dev`. The Auth0 public SPA application uses Authorization Code with PKCE, callback `/auth/callback/`, logout return `/account/signed-out/`, audience `https://chefsergioandco.github.io/staging-api`, and scopes `openid profile email access:chef`. The client ID is public; no client secret belongs in this repository. `VITE_AUTH0_SPA_CLIENT_ID` can override the public default at build time.

The official Auth0 SPA SDK is pinned exactly to 2.30.0. It loads after account intent, keeps bearer tokens in memory, and uses only `cacheMode: 'cache-only'` token lookups. Reloading the page requires top-level sign-in again. Normal internal navigation preserves the SDK instance. Neither bearer tokens nor customer records are persisted by the account client. The SDK retains only its short-lived PKCE transaction as needed for redirect completion.

All account/customer/admin requests use `/api/spa/*`, Authorization Bearer and `credentials: 'omit'`. Customer writes include `X-Customer-Request: 1`; admin writes retain `X-Admin-Request: 1`. Authenticated PDF downloads fetch into temporary Blob links. Public receipt and newsletter proof tokens stay in fragments until captured and are sent only in POST bodies.

`admin/src/` vendors the reviewed client UI only. Vite deduplicates React and scopes its CSS to the active admin route, including body portals. No private Worker code or runtime credentials are included in the static bundle.

Validation:

- `npm ci`
- `npm run check:types`
- `npm run check:booking`
- `PUBLIC_URL=https://chefsergioandco.github.io npm run build`
- `PORT=4423 npm run preview` then `npm run check:account`
- `ACCOUNT_CHECK_PORT=4424 node scripts/account-chrome-check.mjs`

The browser account check uses isolated fictional transport fixtures for authenticated component behavior and never submits a real booking, email or payment. It does not establish live OAuth/provider acceptance. Root deploy and real user testing must verify Google and email sign-in/sign-up, verification/reset/logout, authorization, booking linkage, profile/menu persistence and receipt access on the actual GitHub Pages origin.

The Pages build stays noindex while the public business/content decisions remain in prototype mode. Preview email and disabled Stripe are independent Worker settings; the static frontend never enables provider delivery.
