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
- A modern (Wio-style) UI, Arabic/RTL, and compound/block filtering across the app.

It's all **additive** — existing single buildings keep working (default billing mode is `arrears`).

---

## 2. Architecture (where things live)

- **Frontend:** React 19 + TypeScript + Vite + Tailwind v4, i18n (en/ar). Pages in `src/pages`, shared UI in `src/components/ui`, hooks/helpers in `src/lib`.
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions). All security is **Row-Level Security** routed through one SQL function, `user_can(building, capability)`.
- **Email:** a Supabase Edge Function named **`dynamic-action`** (`supabase/functions/dynamic-action`) sends email via **Resend**, triggered by **Database Webhooks**.
- **Repo:** `jihadmeraachli/BuildingHub` (private), branch `master`. Both Jey and Ahmad push/pull directly — always `git pull origin master` before starting.

### The permission model (important)
- **Identity** (one login per person) is separate from **management grants** (`grants` table: a user has a role on a building or an org) and **resident membership** (`memberships`: a user owns a unit).
- Roles are **capability bundles** (`building_admin`, `org_admin`, `building_finance`/accountant, `viewer`, …). Mirrored client-side in `src/lib/permissions.ts`; DB source of truth in `role_has_cap()`.
- **Platform admin** = us/the operator (`profiles.is_platform_admin`), god-mode across all tenants. Old `super_admin` accounts were promoted to platform admins.
- A person can be **both** an admin and a resident with one account (no second profile).

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
| 0018 | `0018_tenant_model.sql` | Activates `memberships.tenure` (NOT NULL, default `'owner'`); adds `charges.billed_to` (`owner`\|`tenant`\|`both`, default `'both'` — keeps existing charges visible to all) |

### Key idea: charges carry the block
Every `charge` stores both `unit_id` **and** `building_id` (the unit's block). So the **compound book** and **per-block slice** both fall out automatically, and **a unit's balance is identical** whether viewed at compound or block level.

---

## 4. Backend ops (Supabase) — current state

- **Storage:** one public bucket `attachments` (invoices, receipts, meeting files, issue photos). Created by migration `0005`.
- **Edge function `dynamic-action`:** deployed. Sends email for: new resident / approval, new issue, **issue resolved**, **new charge**, **payment (record/edit/delete)**, **dues (issue/edit/delete)**, scheduled meeting (+.ics). Recipient lookup is v3-aware (memberships ∪ legacy `profiles.building_id`).
  - Secrets it needs (Project Settings → Edge Functions → Secrets): `RESEND_API_KEY`, `FROM_EMAIL`, `APP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Database Webhooks** (Database → Webhooks) — each POSTs to `dynamic-action`. Should exist for: `profiles` (Insert/Update), `issues` (Insert/Update), `meetings` (Insert), `charges` (Insert), `payments` (Insert/Update/Delete), `dues` (Insert/Update/Delete). *(One hook can cover multiple events on a table.)*
- **Notifications are two independent channels:** the 🔔 bell = DB triggers (need the migrations), email = webhooks → edge function. Same event → one of each; they don't duplicate within a channel.

---

## 5. Feature areas (what's in the app now)

- **Dashboard:** gradient balance hero, KPIs, collected-vs-spent interactive chart, **coverage** (reserve + runway + dues issued), upcoming meetings — all filterable by **compound / block / building**.
- **Finance:** entity selector (compound or standalone building) + block filter + period (all/year/month). Record expense with scope (whole compound / a block / group / selected units / one unit) and method (by shares/equal/custom); per-unit **Book**, **Expenses**, **Payments** tabs; detail + edit/delete + attachments. Residents get a read-only **"My Account"** statement.
- **Dues:** per building/compound plan (cadence + by-shares/equal/manual). "Generate dues for a period" auto-trues-up (`amount_due = max(0, base − balance)`). Residents see a **Dues card**.
- **Structure:** units (share weight/occupancy/owners) + allocation groups; building selector grouped by compound.
- **Inspections / Service Contracts:** compound- or block-level; residents can view.
- **Issues / Meetings:** compound/block/building selector; create targets a specific block; issue status filter, apartment-as-unit dropdown; meeting attendees + "select all" + online link + detail view + attachments.
- **Buildings:** create/edit/delete buildings & compounds; assign building↔compound; **billing-mode toggle**.
- **People:** approvals + shows each person's **assigned unit** (from memberships).

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
- **GitHub Projects board:** `github.com/jihadmeraachli/BuildingHub` → Projects → BuildingHub Roadmap (41 issues, three columns: Todo / In Progress / Done). Move cards as you work.

---

## 7. Known gaps / tech debt

- **Grants management UI:** assigning admins/accountants is still done via SQL (`grants` table). Needs a People → Access screen.
- **Meetings attendee picker** reads `profiles.building_id` (legacy) — membership-only owners may not appear yet.
- **Owner vs tenant:** ✅ done — `tenure` field active on memberships; `billed_to` on charges routes each expense to owner / tenant / both. Structure page has the tenure picker; Finance expense form has the "Charge to" selector; resident Finance view filters charges by their tenure.
- **Dues model = "B1"** (prepay target; residents see real charges). A stricter **"B2" budget** model (flat fee, fund-only expenses, explicit period true-up) is designed but not built.

---

## 8. Full roadmap (tracked in GitHub Projects → BuildingHub Roadmap)

### In Progress
- **Access/grants UI** — manage org/building admins & accountants without SQL (People → Access screen).
- **WhatsApp notifications** — dedicated number being sourced; personal number cannot be used.

### Tech / product backlog
- **WhatsApp reminders** — arrears/dues overdue alerts (needs a scheduled cron job).
- **Inspection due-date reminders** (scheduled job).
- **Tenant model** — owner + tenant per unit, route charges by category.
- **B2 budget dues** — flat-fee, fund-only expenses, explicit period true-up.
- **PDF export / statements** — ✅ done (`src/lib/pdf.tsx`, lazy-loaded via dynamic import in Finance.tsx). Unit Statement (per-unit charges + payments + balance) and Building/Compound Report (KPIs + unit book + expenses). Export buttons on resident "My Account" view, per-row download icon in manager Book tab, and "Export Report" button in manager header.
- **Retire legacy `profiles.role`** fallback paths — ✅ done (all pages now use `isPlatformAdmin` + grants capabilities only).
- **Code-splitting** — ✅ done (React.lazy + Suspense; main chunk 366 kB, each page loads on demand).
- **PWA** — make the app installable on phones (manifest + service worker).
- **Polish** — ✅ done (loading skeletons + toast notifications across all pages).
- **Arabic RTL** — ✅ done (all user-facing strings go through t() with en/ar keys).

### Platform & business
- **Licensing module** — paid license rules; accounts must be licensed to use the solution.
- **Payment gateway** — integrate a payment provider (Wish or equivalent).
- **AI-powered UI** — evaluate Claude integration for a unique, professional UI experience.
- **Scalability review** — discuss architecture limits and horizontal scaling with Claude.
- **Security review** — harden beyond RLS: pen-test surface, secrets rotation, rate limiting.
- **Backups & data residency** — discuss backup strategy, retention, and regional data requirements.
- **Marketing tools** — social media, SEO, ads strategy.
- **Marketing website** — public site with app walkthrough to drive subscriptions.
- **Legal & compliance** — Privacy Policy, Terms of Service, GDPR compliance, contracts.
- **Mobile app** — publish on Google Play (Android) and App Store (iOS).

---

*Questions on any of this — the code is documented and `docs/WORKFLOW.md` has the reasoning behind each decision.*
