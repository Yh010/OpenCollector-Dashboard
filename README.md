# OpenCollector Dashboard

Internal telemetry console for approved operators. Requires Node 24.14+.

## Local development

1. Run the sibling OpenCollector API on port 3000.
2. Set `OPENCOLLECTOR_ADMIN_USER_IDS` in its private `.env` to your Supabase
   user UUID (`openkode whoami`). Restart the API after changing the list.
3. In Supabase Auth URL Configuration, allow
   `http://127.0.0.1:5175/auth/callback/*`.
4. Run `pnpm install`, then `pnpm dev` and open `http://127.0.0.1:5175`.
5. Continue with Google using an approved account.

The dashboard uses PKCE and stores only its Supabase refresh token in tab-scoped
sessionStorage. Access tokens stay in memory; Google provider tokens are not
retained. Reloading restores and verifies the session; sign-out clears dashboard
state immediately and revokes this session. A 401/403 unmounts the workspace.
Closing the tab is not a server-side logout; use Sign out on shared machines.

All API requests, including Excel downloads and AI analysis, carry the bearer
token in headers. No tokens are placed in export links. The server checks
operator membership on every request. Ordinary OpenKode accounts do not gain
dashboard access automatically.

## Configuration

The default public Supabase URL/key are included. Override these Vite variables
for another deployment (only public keys belong in VITE_* variables):

```
VITE_OPENCOLLECTOR_URL=http://127.0.0.1:3000
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_KEY
```

Services must use HTTPS or loopback HTTP. Set `DASHBOARD_ORIGIN` in the collector
and the Supabase callback allowlist to the actual dashboard origin. The Google
OAuth client secret stays in Supabase. Build with `pnpm build`; verify with
`pnpm test`. Deployment still requires a real HTTPS domain and hosting setup.

## Vercel deployment

Import this repository as a Vite project. Use Node 24.x, `pnpm run build`, and
output directory `dist`. `vercel.json` sends Google callback paths to the app.

Set `VITE_OPENCOLLECTOR_URL` to the actual Render HTTPS origin before building.
The included Supabase URL and publishable key are public configuration; Google
client secrets, service-role keys, and database passwords must stay out of this
project. Add `https://YOUR_PRODUCTION_DOMAIN/auth/callback/*` to Supabase Auth's
redirect allowlist and use that same origin as the collector's `DASHBOARD_ORIGIN`.
Use a stable production URL for login, rather than arbitrary preview domains.

The hosted collector currently returns 503 for AI analysis because its model
previously ran on local Ollama. Trace viewing, charts and Excel export work
without a model. Render's first request after inactivity can take about a minute.
