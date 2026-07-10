# BuildingHub — Handoff / Change Log for Jihad

**From:** Ahmad
**Scope:** everything built in this iteration (the "v3" rebuild + finance/compound/dues work).
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
- **Repo:** currently on Ahmad's fork `AhmadYamoutTat/BuildingHub` (`master`). Open a PR into the main repo to sync.

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
git pull            # from the fork (or main once PR'd)
npm install
# create .env.local (NOT in git):
#   VITE_SUPABASE_URL=...      (shared, same project)
#   VITE_SUPABASE_ANON_KEY=...
npm run dev         # http://localhost:5173
```
- **Migrations & webhooks live on the shared Supabase project** — run them **once** (any teammate). Others inherit them automatically.
- Bootstrap a platform admin: `UPDATE profiles SET is_platform_admin = true WHERE id = (SELECT id FROM auth.users WHERE email = '<you>')`.

---

## 7. Known gaps / tech debt

- **Legacy role fallbacks:** Issues/Meetings/Users still honor `profiles.role` alongside grants (kept working during migration). Plan to retire once everyone's on grants.
- **Grants management UI:** assigning admins/accountants is still done via SQL (`grants` table). Needs a People → Access screen.
- **Meetings attendee picker** reads `profiles.building_id` (legacy) — membership-only owners may not appear yet.
- **Owner vs tenant:** owner-only for now (schema left extensible).
- **Arabic:** main pages translated; a few newer strings (some Issues/Meetings bits) still English.
- **Bundle size:** >500 kB warning — no code-splitting yet.
- **Dues model = "B1"** (prepay target; residents see real charges). A stricter **"B2" budget** model (flat fee, fund-only expenses, explicit period true-up) is designed but not built.

---

## 8. Planned / next steps

1. **Access/grants UI** — manage org/building admins & accountants without SQL.
2. **Finish notifications ops** — confirm all webhooks present; consider a **WhatsApp** channel (v2) and **arrears/dues reminders** (needs a scheduled cron).
3. **Inspection due-date reminders** (scheduled job).
4. **Retire legacy `profiles.role`** paths across Issues/Meetings/Users; move attendees to memberships.
5. **Tenant model** (owner + tenant per unit, route charges by category).
6. **B2 budget dues** option, if a building wants flat-fee-only.
7. **Compound funds/reserve reporting** polish; export/statements (PDF).
8. **Code-splitting** for load performance.

---

*Questions on any of this — the code is documented and `docs/WORKFLOW.md` has the reasoning behind each decision.*
