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
| **Domain registrar** | Ownership of `abniyah.com` (DNS is delegated to Cloudflare) | *(fill in: where the domain is registered + renewal date)* | 🔴 Total if it lapses | Domain expiry = site + all email dead |
| **Google Fonts** | Sora / Inter / Poppins webfonts at runtime | fonts.googleapis.com (no account) | 🟢 Low | Fonts fall back to system; cosmetic only |

## Secrets & configuration — where they live

| Secret / setting | Lives in | Used by |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Cloudflare Pages env vars + local `.env.local` (gitignored) | Frontend (anon key is public-safe) |
| `VITE_BETA_GATE=1` | Cloudflare Pages env vars | Beta gate — **delete this var + redeploy = public launch** |
| Supabase **service role key** | Supabase → Edge Functions secrets (auto-injected) | Edge functions. ⚠️ Never in client code or git |
| `RESEND_API_KEY`, `FROM_EMAIL`, `APP_URL` | Supabase → Edge Functions → secrets | `dynamic-action` (notification emails) |
| Resend SMTP (host `smtp.resend.com`, user `resend`, password = sending-scope API key) | Supabase → Project Settings → Auth → SMTP | Auth emails (confirm/reset/invite) |
| `ANTHROPIC_API_KEY` | Supabase → Edge Functions → secrets | AI import functions |
| `CRON_SECRET` | Supabase → Edge Functions → secrets | `send-reminders` (cron auth) |
| `WEBHOOK_SECRET` | Supabase → Edge Functions → secrets — **⚠️ NOT YET SET** | `dynamic-action` forgery check (armed only once set; also add `x-webhook-secret` header on every Database Webhook) |
| Beta access code(s) | DB table `beta_access_codes` (SQL editor to manage) | Beta gate screen |

## Deployed moving parts (inside Supabase)

| Piece | Deploy method |
|---|---|
| SQL migrations `0002`–`0048` | By hand: SQL Editor, paste + run (no automated runner). Shared DB — run once |
| Edge functions: `dynamic-action`, `invite-user`, `send-reminders`, `ai-expense-import`, `ai-pdf-import`, `ai-import-mapping` (`notify` = legacy, superseded) | Dashboard → Edge Functions → paste from `supabase/functions/<name>/index.ts` → Deploy |
| Database Webhooks (profiles, issues, meetings, charges, payments, dues → POST `dynamic-action`) | Dashboard → Database → Webhooks |
| Auth settings: Confirm email ON, custom SMTP, redirect URLs (`app.abniyah.com/register`, `/set-password`, pages.dev + localhost variants) | Dashboard → Authentication |

## Renewal / billing checklist

- [ ] Domain `abniyah.com` renewal — *(date? auto-renew on?)*
- [ ] Supabase plan — free tier limits (DB size, MAU) will bite as customers grow
- [ ] Resend plan — free tier is 100 emails/day; watch as buildings onboard
- [ ] Anthropic API — pay-as-you-go credit balance (AI import stops silently at $0)
- [ ] Cloudflare Pages — free tier fine for now
- [ ] GitHub — private repo on free plan, fine

## Single points of failure worth knowing

1. **One Supabase project = production.** There is no staging; migrations run
   against live. (Backup strategy is an open roadmap item.)
2. **Auth emails and notification emails both ride Resend** — one suspended
   Resend account kills registration *and* notifications.
3. **Domain lapse kills everything at once** (site + email sending domain).
4. Deploys depend on the GitHub↔Cloudflare link; if it desyncs, redeploy
   manually from the Pages dashboard.
