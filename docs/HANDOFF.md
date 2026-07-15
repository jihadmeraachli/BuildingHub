# BuildingHub — Handoff / Change Log

**Team:** Jihad (Jey) — platform owner & product. Ahmad — lead developer.
**Scope:** everything built across v1 (Jey) and v3 (Ahmad) iterations.
**Deep spec:** see [`docs/WORKFLOW.md`](./WORKFLOW.md) for the full domain model and decisions.

---

## 1. TL;DR — what this iteration did

We took BuildingHub from a single-building, role-based app to a **multi-tenant platform** that supports:

- **Organizations / management companies**, **compounds → blocks → units → owners**, all optional and additive.
- A **capability/grant permission model** enforced in the database (RLS), not just the UI.
- A real **finance engine**: record an expense → allocate it (by shares / equal / custom / to a group / to specific units) → per-unit **charges** → **payments** → the **building/compound book** (balances, arrears, reserve).
- **Two billing models**, switchable per building/compound: **arrears** (pay actual balance) and **dues** (fixed periodic prepayments with automatic reconciliation).
- **Inspections** and **service contracts** modules (compound- or block-level).
- **Notifications** — in-app bell **and** email — on the meaningful events.
- **Scheduled reminders** — weekly cron job emails overdue balance + dues alerts to unit owners, inspection due-date alerts to building/org admins.
- A modern UI, Arabic/RTL, and compound/block filtering across the app.

It's all **additive** — existing single buildings keep working (default billing mode is `arrears`).

---

## 2. Architecture (where things live)

- **Frontend:** React 19 + TypeScript + Vite + Tailwind v4, i18n (en/ar). Pages in `src/pages`, shared UI in `src/components/ui`, hooks/helpers in `src/lib`.
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions). All security is **Row-Level Security** routed through one SQL function, `user_can(building, capability)`.
- **Email:** Supabase Edge Functions send email via **Resend**. `dynamic-action` handles transactional emails (triggered by Database Webhooks). `send-reminders` handles scheduled weekly reminders (triggered by pg_cron).
- **Repo:** `jihadmeraachli/BuildingHub` (private), branch `master`. Both Jey and Ahmad push/pull directly — always `git pull origin master` before starting.
- **UI revamp:** ✅ **merged to master** (commit `3676bc1`). Ahmad's dark Tatawwor-brand theme is live for everyone — `ui-revamp` branch is no longer needed. Run `npm install` after pulling (adds **framer-motion**). shadcn/ui work is unblocked.

### The permission model (important)
- **Identity** (one login per person) is separate from **management grants** (`grants` table: a user has a role on a building or an org) and **resident membership** (`memberships`: a user owns a unit).
- Roles are **capability bundles** (`building_admin`, `org_admin`, `building_finance`/accountant, `viewer`, …). Mirrored client-side in `src/lib/permissions.ts`; DB source of truth in `role_has_cap()`.
- **Platform admin** = us/the operator (`profiles.is_platform_admin`), god-mode across all tenants. Old `super_admin` accounts were promoted to platform admins.
- A person can be **both** an admin and a resident with one account (no second profile).
- **Org admins** can create/manage compounds (scoped to their org via `compounds.org_id`), create buildings, invite users, and manage people — all without needing platform admin access.

---

## 3. Data model & migrations

Run these **in order** in Supabase → SQL Editor. All are **idempotent / additive** (safe to re-run; nothing destructive). Base schema is `supabase/schema.sql`.

| # | File | What it adds |
|---|------|--------------|
| 0002 | `0002_v3_foundation.sql` | orgs, org_buildings, compounds, `buildings.compound_id`, grants, units, memberships, groups, expenses, charges, payments + `user_can()`/`role_has_cap()` + RLS. `profiles.is_platform_admin`. |
| 0003 | `0003_payment_receipt.sql` | `payments.receipt_url` |
| 0004 | `0004_meeting_url.sql` | `meetings.meeting_url` (online/Zoom link) |
| 0005 | `0005_storage_attachments.sql` | **public `attachments` storage bucket** + policies (fixes uploads) |
| 0006 | `0006_issue_apartment.sql` | `issues.apartment_number` |
| 0007 | `0007_issues_rls_v3.sql` | issues RLS → v3 model (fixes "can't log issue") |
| 0008 | `0008_inspections_contracts.sql` | `inspections` + `service_contracts` tables + RLS |
| 0009 | `0009_notifications.sql` | in-app notification **triggers** (charge/payment/meeting/issue) |
| 0010 | `0010_contracts_resident_read.sql` | residents can view contracts (read-only) |
| 0011 | `0011_notify_payment_changes.sql` | notify on payment edit/delete |
| 0012 | `0012_notify_expense_delete.sql` | notify owners when an expense is deleted |
| 0013 | `0013_expense_compound.sql` | expenses can target a whole **compound** (nullable building_id + compound_id) |
| 0014 | `0014_inspections_contracts_compound.sql` | compound-level inspections/contracts |
| 0015 | `0015_dues.sql` | `dues_plans`, `dues_unit_amounts`, `dues` + notify triggers (issue/edit/delete) |
| 0016 | `0016_billing_mode.sql` | `billing_mode` (`arrears`\|`dues`) on buildings + compounds |
| 0017 | `0017_dues_webhooks.sql` | *(optional helper)* SQL to create dues email webhooks — we used the Webhooks UI instead |
| 0018 | `0018_tenant_model.sql` | Activates `memberships.tenure` (NOT NULL, default `'owner'`); adds `charges.billed_to` (`owner`\|`tenant`\|`both`, default `'both'`) |
| 0019 | `0019_dues_b2.sql` | B2 dues plan type — charges full base amount, no carry-in reconciliation |
| 0020 | `0020_org_admin_buildings.sql` | RLS: org admins can create/manage buildings under their org |
| 0021 | `0021_org_admin_compounds.sql` | RLS: org admins can create/manage compounds |
| 0022 | `0022_compound_org_scope.sql` | `compounds.org_id` — scopes compounds to an org; org admins only see their org's compounds |
| 0023 | `0023_reminder_helpers.sql` | SQL helper functions for send-reminders: `get_overdue_units()`, `get_overdue_dues()`, `get_due_inspections(days)` |
| 0024 | `0024_index_audit.sql` | Indexes: `org_buildings`, `compounds.org_id`, `inspections.next_due_date`, `dues.due_date`, `notifications`, `memberships` |
| 0025 | `0025_storage_rls.sql` | Storage RLS; `attachments` bucket goes private (signed URLs) |
| 0026 | `0026_user_lifecycle.sql` | **Deactivate, don't delete.** `role_rank()` ladder; **building_admin loses `org.manage`/`org.assign_buildings`**; caps `user.deactivate` (admins) / `user.delete` (platform only). `unit_balance()`/`user_outstanding()`. `memberships.ended_at` (soft move-out). Table-level guards: no self-deactivation, none at/above your level, none outside your remit, **no orphaning a building's last admin**. `delete_user()` platform-only + blocked while grants exist or balance ≠ 0. Audit FKs → `ON DELETE SET NULL` so history survives. |
| 0027 | `0027_compound_scope.sql` | **The compound is the management unit.** `grants.scope_type` gains `'compound'` + `grants.compound_id`. Roles `compound_admin`(70), `compound_finance`(40), `building_super`(50, the ناطور — issues only, **never money**). **`user_can()` now cascades compound → every block** (incl. blocks added later). 0026's guards taught about compound scope. |
| 0028 | `0028_legacy_role_backfill.sql` | **Backfills `grants` from legacy `profiles.role`.** v3 stopped reading `profiles.role` for permissions but the data was never migrated — People showed "Building Admin" for people with **no grants and therefore no access**, and the anti-orphan guard couldn't see them. Also teaches `building_admin_ids()` (notifications) about compound scope. **Has a PREVIEW query — read it before running.** |
| 0029 | `0029_profile_self_service.sql` | **Security: closes a privilege-escalation hole.** `profiles_update_own` allowed updating *any* column, and `is_platform_admin` is a column → any resident could self-promote to god-mode. Now guarded by a `BEFORE UPDATE` trigger (own name/phone/photo/prefs only). Also re-points `profiles_update_admin` from legacy `current_user_role()` to `user_can(building,'resident.manage')`. |

### Key idea: the access ladder (0026 + 0027)
```
platform_admin 100  the operator (profiles.is_platform_admin) — god-mode
org_admin       80  management company, across its buildings
compound_admin  70  the whole compound — ALL blocks, incl. blocks added later
building_admin  60  one block
building_super  50  the ناطور — issues/inspections/minutes, NEVER money
*_finance       40  the book only
viewer          20  read-only
```
**You may only manage grants strictly BELOW your own rank**, and you may only
deactivate at or below your level, inside your remit. Nobody deletes an account
except the platform admin, and only once they hold no grants and owe nothing.
`grants` scope is `org | compound | building` — a compound grant covers every
block in the compound. **`grants` is the only source of management access;
`profiles.role` is dead** (0028 backfilled the stragglers).

### Key idea: charges carry the block
Every `charge` stores both `unit_id` **and** `building_id` (the unit's block). So the **compound book** and **per-block slice** both fall out automatically, and **a unit's balance is identical** whether viewed at compound or block level.

---

## 4. Backend ops (Supabase) — current state

- **Storage:** one public bucket `attachments` (invoices, receipts, meeting files, issue photos). Created by migration `0005`.
- **Edge function `dynamic-action`:** deployed. Sends email for: new resident / approval, new issue, **issue resolved**, **new charge**, **payment (record/edit/delete)**, **dues (issue/edit/delete)**, scheduled meeting (+.ics). Recipient lookup is v3-aware (memberships ∪ legacy `profiles.building_id`).
  - Secrets: `RESEND_API_KEY`, `FROM_EMAIL`, `APP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Edge function `invite-user`:** deployed. Platform admin and org admins can invite new users by email with role assignment. Uses `auth.admin.inviteUserByEmail()` (service role). Org admins cannot grant org-level access or assign users to buildings outside their org.
  - Secrets: same as `dynamic-action` + `APP_URL` (for the magic link redirect).
- **Edge function `send-reminders`:** deployed. Weekly cron sends overdue balance reminders to unit owners and inspection due-date alerts to building/org admins. Auth via `CRON_SECRET` bearer token (JWT verification disabled on this function — function handles its own auth).
  - Secrets: `RESEND_API_KEY`, `FROM_EMAIL`, `APP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.
  - Scheduled via pg_cron: `0 7 * * 1` (Mondays 7am UTC = 9am Beirut).
- **Database Webhooks** (Database → Webhooks) — each POSTs to `dynamic-action`. Should exist for: `profiles` (Insert/Update), `issues` (Insert/Update), `meetings` (Insert), `charges` (Insert), `payments` (Insert/Update/Delete), `dues` (Insert/Update/Delete).
- **Notifications are two independent channels:** the 🔔 bell = DB triggers (migrations), email = webhooks → edge function. Same event → one of each; they don't duplicate within a channel.

---

## 5. Feature areas (what's in the app now)

- **Dashboard:** gradient balance hero, KPIs, collected-vs-spent interactive chart, **coverage** (reserve + runway + dues issued), upcoming meetings — all filterable by **compound / block / building**.
- **Finance:** entity selector (compound or standalone building) + block filter + period (all/year/month). Record expense with scope (whole compound / a block / group / selected units / one unit) and method (by shares/equal/custom); per-unit **Book**, **Expenses**, **Payments** tabs; detail + edit/delete + attachments. Residents get a read-only **"My Account"** statement.
- **Dues:** per building/compound plan (cadence + by-shares/equal/manual/B2). "Generate dues for a period" auto-trues-up (`amount_due = max(0, base − balance)`). Residents see a **Dues card**.
- **Structure:** units (share weight/occupancy/owners/tenure) + allocation groups; building selector grouped by compound.
- **Inspections / Service Contracts:** compound- or block-level; residents can view.
- **Issues / Meetings:** compound/block/building selector; create targets a specific block; issue status filter, apartment-as-unit dropdown; meeting attendees + "select all" + online link + detail view + attachments.
- **Buildings:** create/edit/delete buildings & compounds (org-scoped for org admins); assign building↔compound; billing-mode toggle.
- **People:** approvals + assigned unit display + **invite user modal** (platform admin + org admin; sends magic-link email with role assignment).
- **Organizations:** create/edit/delete orgs; assign buildings to orgs (platform admin).
- **Sidebar:** two-tier layout — Operations (Dashboard, Finance, Dues, Issues, Meetings, Inspections, Contracts) + collapsible Settings section (Buildings, Structure, People). Settings section persisted in localStorage.
- **Auth:** login, forgot password → email link → `/set-password` page (handles both password reset and first-time invite setup).

---

## 6. How to run / onboard a machine

```bash
git clone https://github.com/jihadmeraachli/BuildingHub.git   # first time only
git pull origin master   # every session — pull before starting
npm install
# create .env.local (NOT in git):
#   VITE_SUPABASE_URL=https://miyrsnlpftybmudiuhbi.supabase.co
#   VITE_SUPABASE_ANON_KEY=<shared anon key — ask Jey or Ahmad>
npm run dev         # http://localhost:5173
```
- **Migrations & webhooks live on the shared Supabase project** — already applied, you inherit them automatically.
- Bootstrap a platform admin: `UPDATE profiles SET is_platform_admin = true WHERE id = (SELECT id FROM auth.users WHERE email = '<you>')`.
- **GitHub Projects board:** `github.com/jihadmeraachli/BuildingHub` → Projects → BuildingHub Roadmap. Move cards as you work.

---

## 7. Known gaps / tech debt

- **Meetings attendee picker** reads `profiles.building_id` (legacy) — membership-only owners may not appear yet.
- **Compound inspection admins** — `get_due_inspections()` finds org admins via `org_buildings` join; platform-admin-only compounds (no `org_id`) won't have anyone to notify for inspection reminders.
- **WhatsApp notifications** — dedicated number still being sourced; email is the only active channel for now.
- **shadcn/ui migration** — Ahmad's dark Tatawwor theme is ✅ **merged to master**. Next UI step: migrate components to shadcn/ui for a professional design system, keeping the Tatawwor brand tokens (cyan `#57D6E2` → blue `#349ECD`, Poppins display font) and the dark theme. Note: the dark theme is currently a scoped `.app-dark` override layer in `src/index.css` — shadcn uses CSS variables + `dark:` variants, so that layer should be **replaced by** shadcn theme tokens during the migration rather than stacked on top.

---

## 8. Full roadmap (tracked in GitHub Projects → BuildingHub Roadmap)

### Phase 3 — In Progress
- **Email reminders** — ✅ done (`send-reminders` edge fn + pg_cron; overdue balance + dues + inspection due-date alerts).
- **UI overhaul** — ✅ dark Tatawwor-brand theme merged to master; shadcn/ui migration next.
- **WhatsApp notifications** — dedicated number being sourced; bundle with mobile app release.
- **PWA / Mobile app** — installable on phones; publish on Google Play & App Store.

### Phase 2 — ✅ Complete
- **Organizations UI** — ✅ done (CRUD, org strip, building assignment, org admin role).
- **Invite user flow** — ✅ done (`invite-user` edge fn; platform admin + org admin can invite with role).
- **Forgot password / set password** — ✅ done (Login forgot flow + `/set-password` page handles reset + invite magic links).
- **Org admin scope** — ✅ done (org admins see/manage only their org's buildings + compounds; sidebar/header role display fixed).
- **Compound org scoping** — ✅ done (`compounds.org_id`; org admins only see their org's compounds).
- **Access/grants UI** — ✅ done (People → Access tab; assign roles without SQL).
- **PDF export / statements** — ✅ done (`src/lib/pdf.tsx`, lazy-loaded; unit statements + building/compound reports).
- **Tenant model** — ✅ done (tenure picker in Structure; `billed_to` routing on charges; migration 0018).
- **B2 budget dues** — ✅ done (plan_type b1/b2; migration 0019).

### Done (Phase 1)
- **Retire legacy `profiles.role`** fallback paths — ✅ done.
- **Code-splitting** — ✅ done (React.lazy + Suspense).
- **Polish** — ✅ done (loading skeletons + toast notifications).
- **Arabic RTL** — ✅ done.

### Platform & business
- **Licensing module + self-serve onboarding** — DESIGNED, ready to build after shadcn/ui.
  - Pricing: **$5/unit/month**. Buyer is a building, compound, or org — they purchase a pool of N unit licenses.
  - Access: **full access locked** without a license (no read-only tier).
  - **Two paths — both supported:**
    - **Self-serve:** Marketing site → Register → Onboarding wizard (create building → choose license quantity → pay OR start trial) → Dashboard.
    - **Admin-managed:** Platform admin can still manually create buildings, activate trials, grant/extend licenses, assign units — full control for enterprise deals, support cases, or onboarding assisted customers.
  - **Trial:** 30 days. Can be started via self-serve (auto on first building creation) OR manually activated by platform admin.
  - **Paid:** Wish Money integration (Lebanon). Monthly recurring.
  - DB tables: `licenses` (owner_type/id, quantity, price_per_unit, status: trial|active|expired, trial_ends_at, expires_at, notes) + `unit_licenses` (license_id, unit_id, UNIQUE). SQL function `is_licensed(unit_id)` for enforcement.
  - In-app expiry banner with days remaining + pay button.
- **Payment gateway** — Wish Money API integration (research API; implement alongside licensing module).
- **Scalability review** — discuss architecture limits and horizontal scaling.
- **Security review** — harden beyond RLS: pen-test surface, secrets rotation, rate limiting.
- **Backups & data residency** — backup strategy, retention, regional data requirements.
- **Marketing website** — public site at `buildinghub.tatawwor.com` with app walkthrough.
- **Legal & compliance** — Privacy Policy, Terms of Service, GDPR compliance.
- **Mobile app** — publish on Google Play (Android) and App Store (iOS).

---

## 9. Important modifications — do before/during scaling

Prioritised by impact. Do these before or alongside the first real user onboarding.

| Priority | Area | What | Why |
|---|---|---|---|
| 1 | **Scalability** | ✅ Index audit — migration 0024 adds indexes on `org_buildings`, `compounds.org_id`, `inspections.next_due_date`, `dues.due_date`, `notifications(user_id)`, `memberships(unit_id, tenure)` | `user_can()` runs on every RLS-protected query; `org_buildings` had zero indexes — critical fix. |
| 2 | **Security** | ✅ Signed URLs — `AttachmentLink` component + `getSignedUrl()` in upload.ts; migration 0025 adds storage RLS; `attachments` bucket switched to private | Was fully public; invoices/receipts/photos now require auth and expire after 1 hour. |
| 3 | **Scalability / Ops** | Upgrade to Supabase Pro (minimum) before real users | Free tier: 500MB DB, 50k MAU, no PITR backups, limited connections. Pro adds PITR, 100k MAU, more connections. Business tier adds read replicas. |
| 4 | **Scalability** | Materialised view for unit balances — pre-compute `SUM(charges) - SUM(payments)` per unit, refresh on charge/payment insert | Finance queries currently full-scan charges + payments on every load. Fine at hundreds of units; painful at 10k+. |
| 5 | **Security** | Rate limiting on edge functions (`invite-user`, `send-reminders`) | No protection against hammering. Add Supabase's built-in rate limiting or a simple token-bucket check in the function. |
| 6 | **Backup** | Weekly `pg_dump` export to Cloudflare R2 or S3 | Supabase Pro gives 7-day PITR but no offsite copy. A weekly export is a cheap extra safety net. |
| 7 | **Security** | Pen-test the RLS policies | `user_can()` + compound/org cascades haven't been adversarially tested. Run a review before taking on enterprise customers. |
| 8 | **Scalability** | Cache `user_can()` results per session | Eliminates repeated permission joins on every request. Only needed if index audit + materialised view aren't enough headroom. High effort — park until you hit the limit. |

---

*Questions on any of this — the code is documented and `docs/WORKFLOW.md` has the reasoning behind each decision.*
