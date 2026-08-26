# Backups & Restore

The production database is backed up **nightly** by the GitHub Actions workflow
[.github/workflows/db-backup.yml](../.github/workflows/db-backup.yml). No
external services, no cost: dumps live as workflow artifacts in the private
repo, kept **90 days**.

_Written 2026-07-31; updated 2026-08-26 after the Frankfurt migration — the GitHub secret now points at the new project, and the first Frankfurt backup ran green the same day. Note: the pooler cluster prefix (aws-0/aws-1) varies per project; if psql says "tenant not found", try the other prefix._

## What is covered

| Data | Covered by | Notes |
|---|---|---|
| App data (buildings, units, charges, payments, grants, …) | ✅ nightly dump | `public` schema, full schema + data |
| User accounts (emails, password hashes, 2FA factors) | ✅ nightly dump | `auth` schema (sessions/tokens excluded on purpose: users just sign in again) |
| Storage file METADATA | ✅ nightly dump | `storage` schema |
| Storage FILES (attachments bucket: invoices, photos, avatars) | ❌ not yet | Phase 2: sync the bucket to Cloudflare R2 via its S3-compatible API |
| Edge functions, migrations, app code | ✅ git | This repo is the source of truth |
| Supabase secrets (API keys, tokens) | ❌ by design | Re-enter by hand on restore; inventory in [DEPENDENCIES.md](DEPENDENCIES.md) |

## One-time setup (done once by Jey)

1. Supabase Dashboard → **Connect** (top bar) → **Session pooler** → copy the URI
   (it looks like `postgresql://postgres.kyhagtdyfhwbmqtbvmbg:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`).
   Insert the database password (Database Settings → reset it if unknown).
   ⚠️ Must be the **Session pooler** URI, not the direct connection: GitHub's
   runners can't reach Supabase's IPv6-only direct host.
2. GitHub → `jihadmeraachli/BuildingHub` → **Settings → Secrets and variables →
   Actions → New repository secret**: name `SUPABASE_DB_URL`, value = that URI.
3. **Actions** tab → `Database backup` → **Run workflow** → confirm it goes
   green and produces a `db-backup-…` artifact of a plausible size.

## Where backups live

GitHub → repo → **Actions → Database backup → (any run) → Artifacts** →
`db-backup-<run>` (a gzipped SQL file). Download any of the last 90 days.

## How to restore (disaster playbook)

1. Create a fresh Supabase project (or use the existing one if it's intact).
2. Download the newest artifact, unzip: `abniyah-db-….sql`.
3. Run it against the new database (Session pooler URI again):
   `psql "<NEW_DB_URL>" -f abniyah-db-….sql`
   (Harmless "already exists" errors for built-in auth/storage scaffolding are
   expected; data rows are what matter.)
4. Redeploy edge functions from `supabase/functions/` and re-enter their
   secrets ([DEPENDENCIES.md](DEPENDENCIES.md) lists every one).
5. Recreate Database Webhooks (list in DEPENDENCIES.md) and the pg_cron
   schedule (footer of migration 0056).
6. Point the frontend at the new project: update `VITE_SUPABASE_URL` +
   `VITE_SUPABASE_ANON_KEY` in Cloudflare Pages env vars, redeploy.
7. Auth settings by hand: custom SMTP (Resend), redirect URLs, email templates.

## Known gaps / future work

- **Storage files** (Phase 2): nightly `rclone` sync of the `attachments`
  bucket to Cloudflare R2 (free 10 GB) via Supabase's S3-compatible endpoint.
- **Point-in-time recovery**: only Supabase Pro offers it; nightly granularity
  means up to 24h of data loss in the worst case. Revisit when there are paying
  customers (Supabase Pro's daily backups + PITR would then also be layered on).
- Restore has never been DRILLED. Do one practice restore into a scratch
  project before launch.
