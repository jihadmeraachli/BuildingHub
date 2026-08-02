# Abniyah — Service & Account Dependencies

Everything the app needs to run, deploy, and communicate. Keep this current when
adding/removing a service. **Owner** = whose account holds it (fill in / correct).

_Last reviewed: 2026-07-26_

## Core services

| Service | What it provides | Identifier | Criticality | If it goes down |
|---|---|---|---|---|
| **Supabase** | Database (Postgres + RLS), Auth (login, 2FA, email confirm), Storage (attachments, avatars), Edge Functions, Database Webhooks | Project `miyrsnlpftybmudiuhbi` — https://miyrsnlpftybmudiuhbi.supabase.co | 🔴 Total — the app IS this database | App unusable: no login, no data |
| **Cloudflare** | DNS for `abniyah.com` + Pages hosting (`abniyah` project) with auto-deploy from GitHub `master` → app.abniyah.com | dash.cloudflare.com → Workers & Pages → `abniyah` | 🔴 Total — serves the frontend | Site unreachable (data safe) |
| **GitHub** | Source of truth for code (private repo), roadmap board, deploy trigger for Cloudflare Pages | `jihadmeraachli/BuildingHub` · collaborator: AhmadYamoutTat | 🟠 High — no deploys without it | Site keeps running; no updates possible |
| **Resend** | ALL outbound email, two channels: (1) Supabase Auth SMTP (confirmation/reset/invite emails), (2) app notifications via `dynamic-action` function | resend.com — domain verified for sending | 🟠 High | Nobody can register/reset password; notifications stop. App itself keeps working |
| **Anthropic** | AI document import (Claude API) — `ai-expense-import`, `ai-pdf-import`, `ai-import-mapping` functions | console.anthropic.com API key | 🟡 Medium | AI import fails; everything else unaffected |
| **Meta (WhatsApp Cloud API)** | WhatsApp notifications (charges, payments, dues, unit invitations) via `dynamic-action`; pre-approved templates; per-message billing (~$0.014 utility/Lebanon) | business.facebook.com portfolio + developers.facebook.com app + dedicated sender number (SIM — can never be reused in the WhatsApp app) | 🟡 Medium | WhatsApp channel stops; email unaffected. Setup: docs/WHATSAPP_SETUP.md |
| **Domain registrar** | Ownership of `abniyah.com` (DNS is delegated to Cloudflare) | *(fill in: where the domain is registered + renewal date)* | 🔴 Total if it lapses | Domain expiry = site + all email dead |
| **Google Fonts** | Sora / Inter / Poppins webfonts at runtime | fonts.googleapis.com (no account) | 🟢 Low | Fonts fall back to system; cosmetic only |

## Secrets & configuration — where they live

| Secret / setting | Lives in | Used by |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Cloudflare Pages env vars + local `.env.local` (gitignored) | Frontend (anon key is public-safe) |
| `VITE_BETA_GATE=1` | Cloudflare Pages env vars | Beta gate — **delete this var + redeploy = public launch** |
| Supabase **service role key** | Supabase → Edge Functions secrets (auto-injected) | Edge functions. ⚠️ Never in client code or git |
| `RESEND_API_KEY`, `FROM_EMAIL`, `APP_URL` | Supabase → Edge Functions → secrets | `dynamic-action` (notification emails). ⚠️ `FROM_EMAIL` must be on a domain VERIFIED in the same Resend account as the key — mismatch = silent 403, no emails (happened 2026-07-26 with the legacy `tatawwor.com` sender). Use `notifications@abniyah.com` |
| Resend SMTP (host `smtp.resend.com`, user `resend`, password = sending-scope API key) | Supabase → Project Settings → Auth → SMTP | Auth emails (confirm/reset/invite) |
| `ANTHROPIC_API_KEY` | Supabase → Edge Functions → secrets | AI import functions |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_LANG` (optional) | Supabase → Edge Functions → secrets — **⚠️ NOT YET SET** (WhatsApp dormant until both set) | `dynamic-action` WhatsApp sends. Token = permanent System User token (24h temp token dies silently). See docs/WHATSAPP_SETUP.md |
| `CRON_SECRET` | Supabase → Edge Functions → secrets | `send-reminders` (cron auth) |
| `WEBHOOK_SECRET` | Supabase → Edge Functions → secrets — **⚠️ NOT YET SET** | `dynamic-action` forgery check (armed only once set; also add `x-webhook-secret` header on every Database Webhook) |
| Beta access code(s) | DB table `beta_access_codes` (SQL editor to manage) | Beta gate screen |

## Deployed moving parts (inside Supabase)

| Piece | Deploy method |
|---|---|
| SQL migrations `0002`–`0048` | By hand: SQL Editor, paste + run (no automated runner). Shared DB — run once |
| Edge functions: `dynamic-action`, `invite-user`, `send-reminders`, `ai-expense-import`, `ai-pdf-import`, `ai-import-mapping` (`notify` = legacy, superseded) | Dashboard → Edge Functions → paste from `supabase/functions/<name>/index.ts` → Deploy |
| Database Webhooks (profiles, issues, meetings, charges, payments, dues, membership_invites, **adjustments** → POST `dynamic-action`) | Dashboard → Database → Webhooks. ⚠️ adjustments INSERT added 2026-08-02 for move-out offload emails (dynamic-action §5c-ii) — copy an existing webhook's config (e.g. charges), change table to `adjustments`, events to Insert only. |
| Auth settings: Confirm email ON, custom SMTP, redirect URLs (`app.abniyah.com/register`, `/set-password`, pages.dev + localhost variants) | Dashboard → Authentication |

## 🚨 Website not updating? (Cloudflare Pages deploy runbook)

Symptom (seen 2026-08-02): pushes to `master` build fine locally (`npm run build`
green) but **app.abniyah.com / abniyah.com stay on an old build** — new features
never appear online. Confirmed the deployed bundle was weeks stale (missing
0059/0060-era code). The code was NOT the cause: clean build passes, all imports
resolve with exact case, tree matches `origin/master`. **The break is on the
Cloudflare side** — the GitHub→Pages pipeline stopped publishing.

**How to confirm which build is live** (no dashboard needed):
```bash
# compare the live entry-JS hash to a fresh local build
curl -s https://app.abniyah.com/ | grep -oE 'assets/index-[A-Za-z0-9]+\.js'
npm run build && ls dist/assets/index-*.js   # different hash + missing recent strings ⇒ stale
```

**Fix — do these in order (Cloudflare dashboard → Workers & Pages → `abniyah`):**
1. **Deployments tab** — are recent `master` commits listed?
   - **Not listed** → the Git integration disconnected. Settings → **Builds &
     deployments → Git integration** → reconnect `jihadmeraachli/BuildingHub`.
   - **Listed but Failed** → open the failed build's **log**, read the error
     (usually Node version or an env var). Fix, then Retry.
2. **Settings → Builds & deployments** — verify:
   - **Production branch = `master`**
   - **Build command = `npm run build`**, **Output directory = `dist`**
   - Build env vars present: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
     (and `VITE_BETA_GATE=1` until public launch).
3. **Retry deployment** on the latest `master` commit. One green build republishes
   the whole app at once.

**Emergency bypass (deploy without the Git pipeline)** — direct upload from a
machine with the repo:
```bash
npm run build
npx wrangler login                       # one-time browser OAuth
npx wrangler pages deploy dist --project-name=abniyah --branch=master
```
`--branch=master` makes it the production deployment. This sidesteps GitHub
entirely and is the fastest way to get current code live in ~30s.

## Renewal / billing checklist

- [ ] Domain `abniyah.com` renewal — *(date? auto-renew on?)*
- [ ] Supabase plan — free tier limits (DB size, MAU) will bite as customers grow
- [ ] Resend plan — free tier is 100 emails/day; watch as buildings onboard
- [ ] Anthropic API — pay-as-you-go credit balance (AI import stops silently at $0)
- [ ] Meta WhatsApp — per-message billing on the Business account card; sender SIM must stay alive (number re-verification)
- [ ] Cloudflare Pages — free tier fine for now
- [ ] GitHub — private repo on free plan, fine

## Single points of failure worth knowing

1. **One Supabase project = production.** There is no staging; migrations run
   against live. Mitigation: nightly database backups via GitHub Actions,
   90-day retention — see [BACKUPS.md](BACKUPS.md) (requires the
   `SUPABASE_DB_URL` repo secret; storage FILES not yet covered).
2. **Auth emails and notification emails both ride Resend** — one suspended
   Resend account kills registration *and* notifications.
3. **Domain lapse kills everything at once** (site + email sending domain).
4. Deploys depend on the GitHub↔Cloudflare link; if it desyncs, redeploy
   manually from the Pages dashboard.
