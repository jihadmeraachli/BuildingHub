# Migration runbook: Seoul → Frankfurt

> **✅ EXECUTED 2026-08-26** (Claude-driven, Option C). New project
> `kyhagtdyfhwbmqtbvmbg` ("Abniyah EU"). All phases completed and verified:
> data parity exact, logins + MFA + storage + functions + webhooks + cron +
> SMTP live, production bundle confirmed serving Frankfurt, backup chain
> re-pointed and proven. **One deviation:** paid projects cannot be paused, so
> Seoul stays ACTIVE (crons unscheduled, nothing points at it) as the frozen
> fallback — **delete it ~2026-09-09** and remove its compute cost.

Move the production Supabase project from `ap-northeast-2` (Seoul) to
`eu-central-1` (Frankfurt). Beirut↔Seoul is ~250–300 ms per round trip;
Beirut↔Frankfurt is ~60–80 ms — every API call gets 3–4× faster for the
users we're building for.

**Why now:** ~0 real users, so downtime is free and there is no live data to
race. This window closes at launch. The migration also doubles as the restore
drill [BACKUPS.md](BACKUPS.md) says we have never done.

**Who:** Jey drives (has dashboard + Cloudflare access), Ahmad verifies.
**Budget:** 2–4 focused hours. Nothing here is hard; it is all checklist.

_Written 2026-08-26. Old project: `miyrsnlpftybmudiuhbi` (Seoul, Micro after
the compute upgrade). References: [DEPENDENCIES.md](DEPENDENCIES.md) for every
secret and moving part; [BACKUPS.md](BACKUPS.md) for the dump/restore method._

---

## Phase 0 — Prep (any time, zero risk)

1. **Create the new project:** Supabase org → New project →
   name `Abniyah` → region **Frankfurt (eu-central-1)** → generate a strong DB
   password and **save it** (password manager). On the Pro org it is born as
   proper Micro compute.
2. Note the new **project ref**, `https://<newref>.supabase.co`, **anon key**
   and **service role key** (Settings → API).
3. **Confirm the APNs `.p8` file is on hand** (Apple only lets you download it
   once). If it is lost, pause here and issue a new key first — the migration
   needs it re-entered as a secret.
4. Run the **Database backup** workflow manually (GitHub → Actions → Database
   backup → Run workflow) so there is a fresh artifact minutes old, not hours.

## Phase 1 — Database (schema + data + logins)

The nightly dump already covers everything that lives in Postgres: the whole
`public` schema (all 147 migrations' tables, RLS, functions, triggers), the
`auth` schema (users, **password hashes, TOTP 2FA factors** — logins survive),
and `storage` metadata.

1. Download the fresh artifact (Actions → Database backup → latest run →
   Artifacts), unzip to `abniyah-db-….sql`.
2. Get the NEW project's **Session pooler** URI (Connect → Session pooler —
   the direct host is IPv6-only and unreachable from many networks).
3. Restore:
   ```bash
   psql "<NEW_SESSION_POOLER_URI>" -f abniyah-db-….sql
   ```
   "Already exists" noise for built-in auth/storage scaffolding is expected;
   the data rows are what matter.
4. **Row-count spot check** — run on BOTH projects, numbers must match:
   ```sql
   SELECT (SELECT count(*) FROM buildings)  AS buildings,
          (SELECT count(*) FROM units)      AS units,
          (SELECT count(*) FROM charges)    AS charges,
          (SELECT count(*) FROM payments)   AS payments,
          (SELECT count(*) FROM dues)       AS dues,
          (SELECT count(*) FROM profiles)   AS profiles,
          (SELECT count(*) FROM auth.users) AS auth_users;
   ```

> Sessions do NOT migrate (new JWT secret) — everyone signs in again. At 7
> MAU, that is a feature, not a problem.

## Phase 2 — Storage files + stored URLs (the sneaky one)

The dump carries the bucket rows and file *metadata*, **not the files**, and —
worse — the app stores **full public URLs** in the database
(`src/lib/upload.ts` saves `…miyrsnlpftybmudiuhbi.supabase.co/storage/…`), so
every `receipt_url`, `attachment_url`, `file_url`, `avatar_url` still points
at Seoul after the restore.

1. **Copy the files** (total is ~1 MB today — trivial): for each of the two
   public buckets `attachments` and `avatars`, download from old, upload to
   new, **same paths**. Ask Claude for the copy script when you get here, or
   do it by hand in the dashboard (Storage → drag between tabs) at this size.
2. **Rewrite the stored URLs** — run on the NEW project; it walks every text
   column in `public` and swaps the ref (idempotent):
   ```sql
   DO $$
   DECLARE r RECORD; n BIGINT;
   BEGIN
     FOR r IN
       SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type IN ('text','character varying')
     LOOP
       EXECUTE format(
         'UPDATE public.%I SET %I = replace(%I, ''miyrsnlpftybmudiuhbi'', ''<NEWREF>'')
          WHERE %I LIKE ''%%miyrsnlpftybmudiuhbi%%''',
         r.table_name, r.column_name, r.column_name, r.column_name);
       GET DIAGNOSTICS n = ROW_COUNT;
       IF n > 0 THEN RAISE NOTICE '%.%: % rows', r.table_name, r.column_name, n; END IF;
     END LOOP;
   END $$;
   ```
3. **Verify nothing is left:** re-run the loop — it should report zero rows.

## Phase 3 — Edge functions + secrets

1. Paste each function from `supabase/functions/<name>/index.ts` into the NEW
   dashboard (Functions → New/Code → Deploy). Live set (skip `notify`, legacy):
   `dynamic-action`, `invite-user`, `send-reminders`, `file-feedback`,
   `help-chat`, `ai-expense-import`, `ai-pdf-import`, `ai-import-mapping`,
   `whish-pay`, `whish-callback`, `areeba-pay`, `areeba-callback`.
   ⚠️ Copy from the **repo**, check the line count matches before deploying
   (the 2026-08-03 lesson).
2. Re-enter every secret from the [DEPENDENCIES.md](DEPENDENCIES.md) secrets
   table: `RESEND_API_KEY`, `FROM_EMAIL`, `APP_URL`, `ANTHROPIC_API_KEY`,
   `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_PER_LANG`, `APNS_KEY_ID`,
   `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (the whole `.p8`), `CRON_SECRET`,
   `WEBHOOK_SECRET`. (`WHISH_*` / `AREEBA_*` whenever those keys arrive.)

## Phase 4 — Webhooks + cron (all carry the OLD url after restore)

1. **Purge restored old-URL triggers.** The dump brings across every webhook
   trigger still pointing at Seoul. Find them on the NEW project:
   ```sql
   SELECT DISTINCT event_object_table, trigger_name
   FROM information_schema.triggers
   WHERE action_statement LIKE '%miyrsnlpftybmudiuhbi%';
   ```
   `DROP TRIGGER <name> ON <table>;` each one.
2. **Recreate Database Webhooks** in the dashboard (Database → Webhooks), all
   POSTing to `https://<newref>.supabase.co/functions/v1/dynamic-action`, each
   with the `x-webhook-secret` header: `profiles` (U), `issues` (U),
   `meetings` (I), `charges` (I), `payments` (I/U/D), `dues` (I/U/D),
   `membership_invites` (I), `adjustments` (I), `payment_request_lines` (I),
   `subscriptions` (I), `invoices` (I/U).
   Cross-check the list against what the OLD project's dashboard shows before
   pausing it — that dashboard is the ground truth.
3. **Re-schedule pg_cron** (cron jobs do not survive the dump). On the old
   project run `SELECT jobname, schedule, command FROM cron.job;` and replicate
   each on the new one. Known set:
   - `daily-reminders` — 0056's footer template: `net.http_post` to
     `https://<newref>.supabase.co/functions/v1/send-reminders` with
     `Authorization: Bearer <CRON_SECRET>`, schedule `0 6 * * *`.
   - `purge-soft-deleted` — 0138: `SELECT purge_soft_deleted()` at `30 3 * * *`.

## Phase 5 — Auth settings (dashboard-only, by hand)

- **SMTP:** host `smtp.resend.com`, user `resend`, password = the Resend
  sending-scope API key, sender `notifications@abniyah.com`.
- **Site URL** `https://app.abniyah.com`; **Redirect URLs**: the app URL +
  `http://localhost:5173` for dev.
- Email templates if any were customized; confirm email-confirmation stays ON.

## Phase 6 — Verify BEFORE flipping anything

Point your local `.env.local` at the NEW project (new URL + anon key),
`npm run dev`, and walk the app **against Frankfurt while production still
serves Seoul**:

- [ ] Sign in as platform admin — old password works (hashes migrated), 2FA prompts
- [ ] Dashboard numbers identical to Seoul's
- [ ] Record a payment → void it (writes + RLS working)
- [ ] Upload an attachment → open it (storage + signed URLs)
- [ ] Open an old receipt/attachment (Phase 2 URL rewrite proved)
- [ ] Trigger a notification email (webhook → dynamic-action → Resend)
- [ ] Ask Jad answers (help-chat + ANTHROPIC_API_KEY)
- [ ] Demo persona logins still work; `scripts/` RLS probes pass against the new URL
- [ ] `SELECT * FROM cron.job;` shows both jobs

## Phase 7 — Cutover (minutes)

1. **Pause the OLD project** (Settings → General → Pause) — freezes it as a
   pristine fallback and guarantees nothing writes to Seoul during the flip.
2. Cloudflare Pages → `abniyah` → Settings → Environment variables: set
   `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` to the new values →
   **Retry deployment** → verify with the bundle-hash check + a login.
3. Update **both devs'** local `.env.local`.
4. GitHub secret **`SUPABASE_DB_URL`** → the NEW Session-pooler URI (or the
   nightly backup silently starts failing / dumping nothing).
5. Run the backup workflow once against Frankfurt — green run, plausible size.

## Phase 8 — Retire Seoul

- Keep the old project **paused for 1–2 weeks** as the fallback.
- Then delete it, and update the project ref in
  [DEPENDENCIES.md](DEPENDENCIES.md), [BACKUPS.md](BACKUPS.md) and this file
  (they all hardcode `miyrsnlpftybmudiuhbi`).

---

## Known traps, all accounted for above

| Trap | Where handled |
|---|---|
| Stored file URLs embed the old project ref | Phase 2 rewrite loop |
| Storage files don't travel in a pg dump | Phase 2 copy |
| Restored webhook triggers still POST to Seoul | Phase 4.1 purge |
| pg_cron jobs don't travel in the dump | Phase 4.3 |
| `daily-reminders` cron hardcodes URL + CRON_SECRET | Phase 4.3 |
| Sessions invalidated (new JWT secret) | Expected; users re-login |
| GitHub backup secret still points at Seoul | Phase 7.4 |
| `.p8` APNs key must be re-entered, downloadable once | Phase 0.3 gate |
| Old anon key baked into restored 0017-style triggers | Phase 4.1 purge |
