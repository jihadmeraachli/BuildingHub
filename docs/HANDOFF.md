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
| 0030 | `0030_avatars_bucket.sql` | Public `avatars` storage bucket (per-user RLS). `attachments` went private in 0025, so avatar `getPublicUrl()` 404'd — profile photos live here instead. |
| 0031 | `0031_licensing.sql` | *(Jihad)* Subscription licensing: `subscriptions`, `license_assignments`, `invoices`, `subscription_events`; `unit_has_active_license()`; $5/unit/mo; self-serve entity-create + auto-grant trigger. |
| 0032 | `0032_admin_onboarding_rpc.sql` | *(Jihad)* `complete_admin_onboarding()` — atomic: activate account, create entity, auto-grant admin, start 30-day trial. |
| 0033 | `0033_opening_balance.sql` | **Opening balances + balance-as-of-date.** `units.opening_balance` (+ date), signed like the balance, excluded from P&L. `unit_balance()` folds it in; `unit_balance_asof()` / `building_book_asof()` for point-in-time statements. |
| 0034 | `0034_adjustments_and_void.sql` | **Adjustments + soft void.** `adjustments` table (credit_note/discount/waiver/write_off = +credit; penalty/refund = −), `adjustment_effect()`. Soft `voided_at/by/reason` on charges/payments/adjustments (no more destructive delete). `unit_balance*()` fold in adjustments + ignore voided. Client mirror: `src/lib/balance.ts`. |
| 0035 | `0035_import_batches.sql` | **Import safety.** `import_batches` ledger; imported rows tagged `import_batch_id`; SHA-256 file hash → duplicate-import warning; `reverse_import_batch()` one-click undo. |
| 0036 | `0036_beta_access.sql` | Private-beta access codes (the beta gate on app.abniyah.com). |
| 0037–0038, 0046, 0050–0052 | `*_onboarding_*.sql` | Register-wizard hardening: status/grant/event guards, idempotent + race-locked `complete_admin_onboarding()`, building address capture. |
| 0039–0045 | `0039_profiles_visibility` … `0045_can_delete_user_fix` | Security audit wave: profile visibility rules, critical access fixes, licensing hardening, legacy-policy ports, financial RPC lockdown, admin identity RPC, delete-user guard fix. |
| 0047 | `0047_policy_recursion_fix.sql` | **Sealed-helper discipline.** RLS policies route through SECURITY DEFINER helper functions to kill policy recursion — follow this pattern for every new cross-table policy. |
| 0048 | `0048_find_user_by_email.sql` | `find_user_by_email()` for admin flows (invite/link existing users). |
| 0049 | `0049_dashboard_aggregates.sql` | Dashboard aggregate RPCs (fund balance, collected vs spent series). |
| 0053 | `0053_membership_invites.sql` | Consent-based unit invitations (`membership_invites` + accept/decline RPCs). |
| 0054 | `0054_invitee_profile_visibility.sql` | Admins can see a pending invitee's profile (name resolution in People). |
| 0055 | `0055_admin_invite_tracking.sql` | `admin_membership_invites()` — People → Invitations tab, all statuses with names. |
| 0056 | `0056_payment_reminder_schedule.sql` | **Automated payment reminders.** `buildings.reminder_day` (1–28, NULL=off), `reminders_sent` dedup table, rebuilt `get_overdue_units()`/`get_overdue_dues()` on `unit_balance()` + compound-governed billing mode; pg_cron `daily-reminders` hits the `send-reminders` edge function at 06:00 UTC (9am Beirut). |
| 0057 | `0057_notification_channel_required.sql` | Every profile must keep ≥1 notification channel (email OR WhatsApp) — backfill + CHECK. |
| 0058 | `0058_viewer_member_names.sql` | `structure_members()` — names-only membership visibility for `finance.view` holders (viewer/auditor roles, public demo). Contact details stay behind `resident.manage`. |
| 0059 | `0059_whish_account.sql` | `buildings.whish_number` — manual Whish payment flow: charge/reminder emails, the resident statement and WhatsApp money templates tell residents to pay to the building's Whish account; finance user records incoming transfers as payments. |
| 0060 | `0060_preferred_language.sql` | `profiles.preferred_language` (en\|ar) — app loads in the user's language on every device (Settings section + header globe persists), and WhatsApp goes out in the recipient's language. |
| 0083 | `0083_meeting_issues.sql` | *(Jihad)* **Open issues on a meeting agenda (#56).** `meeting_issues` join table. Opt-in and hand-picked when scheduling ("Put open issues on the agenda" → select all or tick individually), NOT automatic — an agenda holding every open issue is noise. A join table rather than text pasted into `meetings.summary`, so the link stays live: an issue resolved between scheduling and the meeting shows as resolved (struck through) on the agenda. Read mirrors `meetings_select`; write needs `meeting.manage` and the WITH CHECK forces the issue to belong to the meeting's own building. Issue CONTENT still goes through the 0074 policies, so a meeting agenda cannot expose a neighbour's private unit issue. |
| 0074 | `0074_issue_units.sql` | *(Jihad)* **Private per-unit issues (#49 + #58).** `issues.unit_id` (nullable = common area) + sealed `user_member_unit()` (ACTIVE membership; `user_unit_ids()` from 0002 ignores `ended_at`). Resident visibility becomes: common-area issues of their building + their own units' issues + anything they reported — another owner's apartment issue never reaches them (RLS, not a client filter). Residents can only INSERT for their building's common area or a unit they hold. Backfills legacy `apartment_number` matches (exactly-one-unit only) so old apartment issues don't become building-visible. Drops 0007's legacy `current_user_role()` clauses (0028 backfilled grants). UI: residents get the Log Issue button (was hidden behind the manager-entity gate — the #58 bug); the modal's first question is "Logging issue for: Common area / my units". |
| 0073 | `0073_building_contacts.sql` | *(Jihad)* **Building directory (#59).** `building_contacts` table: free-text `title` + `name` + `phone`, scoped to a block OR whole compound (0014 shape). Read: any building grant (manage / finance.view / issue.view_all) + residents via `user_member_building()`; write: `building.manage`. Powers the new **Contacts** page (`/contacts`), which also auto-surfaces service-contract providers that have a phone, so nobody duplicates the elevator company. |
| 0072 | `0072_dashboard_period.sql` | **Manager Dashboard period filter.** `dashboard_stats/_monthly/_carry` gain `p_from`/`p_to` (defaulting to NULL = previous behaviour). The KPIs do NOT behave uniformly: **flows** (billed, collected, monthly series) sum inside the window; **positions** (outstanding, fund carry) are taken **as of** the window's last day, because a balance is not a sum of a window; **counts** (units, open issues) are the population **live at** that day, since a unit created later never existed in the period and is the denominator for per-unit figures. `outstanding` now routes through `unit_balance_asof()` (0033) so it matches the client and the statements. Old 1-arg signatures are dropped and recreated with defaults (an overload + default is ambiguous to the resolver); same names, same columns plus new ones. ⚠️ Client falls back to un-filtered figures with a toast if this is not applied, so a deploy cannot take the dashboard down. |
| 0071 | `0071_license_caps.sql` | *(Jihad)* License caps per account type (building 50 / compound 250 / org 2500) + `subscriptions.cap_override`, enforced by trigger. |
| 0070 | `0070_dues_party.sql` | **Dues become party-aware (#61).** `dues.billed_to`/`tenant_id`/`kind`/`label`; `dues_plans.owner_pool_amount` + `dues_unit_amounts.owner_amount` (the owner-only slice). Dues notify triggers rebuilt on the 0067 pattern — they previously fanned to EVERY membership with no `ended_at` filter, so moved-out tenants got current dues notices. `reminders_sent` gains `party` and its unique index widens to `(unit, period, party)` — without it the owner's and tenant's reminders for the same unit collide and the second is silently dropped as a duplicate. `get_overdue_dues()` rebuilt per unit PER PARTY (party-scoped recipients, party-scoped payment offset, and it now sums a party's rows in the latest overdue period so an assessment beside a recurring due is not hidden). Backfills every existing row to `billed_to='owner'`, `kind='recurring'` — unit-level meant owner, so nothing already generated changes meaning. **⚠️ Run this together with the `send-reminders` + `dynamic-action` redeploys** (see §4). |

| 0076 | `0076_payment_requests.sql` | **Reminders become obligation-driven.** `payment_requests` + `payment_request_lines` (arrears, party-aware, snapshot amounts); `payment_due_days` on buildings/compounds; `effective_obligation_party()`; per-DAY dedup on `reminders_sent`. |
| 0077 | `0077_payment_request_notify.sql` | Issuing a request notifies the billed party (bell). Email/WhatsApp via the `payment_request_lines` INSERT webhook. |
| 0078 | `0078_payment_request_webhook.sql` | ⚠️ **DO NOT RUN** — that webhook was created in the dashboard. Kept as the SQL reference only. |
| 0079 | `0079_request_replaces_open.sql` | A new request cancels the open one (two live requests billed the same balance twice) + flags units with nobody to notify. |
| 0080 | `0080_request_any_mode.sql` | `reminders_sent` dedup gains `source` — a request and dues can fall due the same day and must not silence each other. |
| 0081 | `0081_request_arrears_only.sql` | Requests are arrears-only again. A prepay building sits in credit so a ledger-based request finds nobody; where it finds arrears, outstanding dues already collect them. |
| 0082 | `0082_chase_all_dues.sql` | Chase EVERY unpaid dues period, not just the latest. |
| 0083 | `0083_meeting_issues.sql` | Meeting agendas link to real issues (a join table) rather than pasted text, so an issue resolved after the invite goes out shows as resolved on the agenda. |
| 0084 | `0084_push_tokens.sql` | `device_tokens` (one row per device, UNIQUE on the token) + `profiles.notify_push` — the third notification channel. |

| 0085 | `0085_expense_types.sql` | **Expense types are DATA** — per building/compound catalog (compound governs), seeded with the 7 legacy categories + auto-seed trigger for new entities. `expenses.expense_type_id` (+ backfill); `category` stays as the legacy mirror (custom types file under 'other'). Managed from building settings; `is_metered` feeds 0090. |
| 0086 | `0086_lbp_currency.sql` | **LBP alongside USD.** Two amount boxes on expense/payment; ONE canonical `amount_usd`; `amount_lbp`+`lbp_rate` are the per-row LOG (rate FROZEN per row — the building/compound `lbp_rate` setting only prefills, via sealed `set_lbp_rate()`). LBP/MIX row tags, detail breakdown, "Paid as" line in the payment email. |
| 0087 | `0087_prepaid_budget.sql` | **The Prepaid Budget** — Dues renamed; no plan+generate: every issuance IS the plan, built from LINES (expense type + amount), Σ lines = the pool, TIME-BOUND (period from→to). `budgets` + `budget_lines`; `dues.budget_id`. Budget-vs-actual card in Reports. `dues_plans` retired from the UI. |
| 0088 | `0088_request_asof.sql` | **Requests target a period**: optional as-of — owed AT the date − payments dated AFTER it. `unit_party_balance_asof()`; settlement moves to ENTRY time (`created_at`); `get_overdue_units()` sums open lines per unit+party (0082 pattern) and skips recipient-less candidates BEFORE the dedup insert. |
| 0089 | `0089_extraordinary_expense.sql` | **Extraordinary expenses collect immediately**: arrears → targeted `request_payment_for_expense()` (no supersede); dues mode → the client issues a flat one-line budget (the netting rule keeps charge+due from double-collecting). |
| 0090 | `0090_metering.sql` | **Metering** — cycles + readings for `is_metered` types (generator/water): stock in/bought/out → avg unit cost; per-unit + common kW; pro-rata; finalize posts ONE ordinary expense with per-unit charges (`expenses.meter_cycle_id`). Math in `lib/metering.ts`, tested. |
| 0091 | `0091_expense_links.sql` | Deleting an extraordinary expense used to leave its ask alive — residents chased forever for something gone. `payment_requests.expense_id` / `budgets.expense_id` CASCADE, and a BEFORE DELETE trigger takes a budget's dues with it (so the dues-removed notifications fire). |
| 0092 | `0092_atomic_money_ops.sql` | Cancel-budget, delete-cycle and re-post become single transactions (`cancel_budget`, `delete_meter_cycle`, `repost_metered_expense`) instead of 2–3 client calls that could half-complete. The metered-expense edit guard moves into the DB as a trigger. |
| 0093 | `0093_repost_scope_guard.sql` | `repost_metered_expense` stopped trusting its payload: SECURITY DEFINER bypasses charges RLS, and 0092 took `unit_id`/`building_id` verbatim while checking only the expense's scope. `building_id` is now derived from the unit, units must be in the expense's building or compound, and a `tenant_id` must actually hold that unit. |

| 0094 | `0094_demo_read_only.sql` | The public demo is read-only **in the database**. `profiles.is_demo` + a BEFORE trigger on every showcase table refuse writes from the personas, so the demo admin can hold a real `building_admin` grant (People, invitations, the full product) even though the password ships in the bundle. Language/notification prefs still save; renames do not. |
| 0095 | `0095_audit_fk_set_null.sql` | Finishes 0026: walks the catalog converting every nullable NO ACTION/RESTRICT FK on `profiles`/`auth.users` to `ON DELETE SET NULL`. `subscriptions.created_by` was blocking `delete_user()` outright. NOT NULL ones are reported, not touched. |

| 0096 | `0096_entity_read_scope.sql` | **Buildings and compounds stop being world-readable.** `buildings_select_active` was v1 schema ("for registration" — v3 never reads it), so any authenticated user could list every building, and Buildings/Compounds render unscoped: a building admin saw the whole platform. Compounds were worse — 0022's scoped policy never took effect because 0002's open one was never dropped. Reads now go through `user_sees_building()`/`user_sees_compound()` (grant, or a membership in it). Building creation moves to the sealed `create_building()`, because the auto-grant trigger fires AFTER RETURNING is projected and a plain insert would be rejected on its own new row. |

⚠️ The `guard_metered_expense` trigger (0092) fires on **every** update to a
metered expense, migrations included. A future backfill over those rows must
`SELECT set_config('app.metering_repost', '1', true);` in the same transaction
or it will fail with the cycle message.

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


### ⚠️ THE MONEY MODEL AFTER 2026-08-03 (read before touching dues or reminders)

**Dues are obligations, not ledger entries.** A dues row writes nothing to
charges/payments/adjustments, so the balance does NOT move when one is issued.
Only a payment moves it. Every bug we hit today came from forgetting that.

**An outstanding due absorbs the carry.** With `L` = the party's ledger balance
(+ = credit) and `D` = their unpaid issued dues:

```
carry = max(0, −L − D) − max(0, L − D)
```

An outstanding ask already collects arrears that are still visible on the
ledger, AND makes a part-payment look like credit. Both are clamped against it.
Without this a second ask re-bills the same arrears (observed: 1East asked
2,092.16 against a real 1,296.08). Lives in `computeDuesGeneration()`
(`src/lib/reportData.ts`) with a test suite covering every case.

**Generation is per-run, not per-plan.** Scope (all/group/units), basis, who
pays (tenants-where-leased vs owners-only), amounts, and the **arrears true-up
toggle** are all chosen when generating. True-up OFF = a flat ask that collects
in full even from a unit in credit — the only way to raise cash mid-period in a
prepay building, since everyone is prepaid and a ledger-based request finds
nobody.

**Payment requests are ARREARS-only** (0081), snapshot what each party owes when
issued, and are settled by payments since — charges landing later belong to the
NEXT request. A new request supersedes the open one.

**History keeps the tenant's name; open obligations follow the money.** A
departed tenant's dues keep their `tenant_id` for the former-tenant view, but
`effective_obligation_party()` resolves chasing AND settlement to the owner —
otherwise nobody is reminded and the owner's payment never clears it.

**Reminders**: daily to the due date, weekly after, per (unit, day, party,
source). Every unpaid period is chased, summed into one reminder dated from the
oldest.


### ⚠️ THE EXPERT-SESSION REWORK (2026-08-05, migrations 0085–0090)

Read this before touching Finance, the Prepaid Budget (ex-Dues) or Reports.

- **Expense types are the building's own catalog** (settings → Expense types).
  Everything joins on them: expenses, budget lines, budget-vs-actual, metering.
- **The Prepaid Budget has no plan.** Every issuance is built from lines; the
  lines' total is the pool; per-run scope/basis/who-pays/true-up as before. The
  obligation shape (dues rows) did NOT change — carry netting, reminders,
  outstanding: all untouched and their suites still pass.
- **LBP**: `amount_usd` stays canonical EVERYWHERE. `amount_lbp`+`lbp_rate` are
  a per-row log; the building setting is only a prefill and never rewrites
  history.
- **Requests**: optional as-of (owed at the date − payments since), settlement
  by entry time, one reminder per unit+party summing all open lines, no
  reminders "sent" to nobody.
- **Extraordinary expense** = collect NOW; mode-branched (request vs flat
  budget).
- **Metering** posts ordinary expenses; the cycle is the audit trail. Expense
  total = Σ rounded per-unit charges, to the cent.
- **Client math tests** live in the session scratchpad pattern — eight suites
  (netting, true-up, bill-to, scope, dues, as-of, budget-vs-actual, metering).
  Run them against `src/lib` before changing any money function.

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
- **⚠️ PENDING OPS for migration 0070 (#61) — run as one batch:**
  1. Run `0070_dues_party.sql` in the SQL Editor.
  2. Redeploy **`send-reminders`** from current master — it now passes `party` to
     the `reminders_sent` insert. Until it is redeployed, a leased unit's tenant
     reminder is swallowed as a duplicate of the owner's (the dedup key widened
     but the old code does not fill the new column). Owner reminders keep working
     throughout: `get_overdue_dues()` deliberately kept the `owner_user_ids`
     column name so the un-redeployed function degrades instead of going silent.
  3. Redeploy **`dynamic-action`** from current master — dues email + WhatsApp now
     use `unitPartyIds()` so a tenant's dues never reach the owner and a
     moved-out tenant hears nothing. **WhatsApp param counts were NOT touched**
     (`abniyah_dues_issued` stays at 6) — only the recipient list changed.

---

## 5. Feature areas (what's in the app now)

- **⚠️ GLOBAL ENTITY SELECTOR (2026-08-02, commits 766c566 + b73c2ec).** The
  compound/building selection now lives in the **sidebar** (Managing lens),
  mirroring the My-home unit picker: pick once, applies to every tab.
  `entityKey` state moved to **`AuthContext`** (`entityKey`/`setEntityKey`,
  persisted in localStorage `abniyah_entity_key`, `''` = "All buildings").
  Per-page entity dropdowns were REMOVED from Dashboard, Finance, Dues,
  Reports, Issues, Meetings, Inspections, Contracts, Users. Rules: platform
  admins never get "All" (auto-forced to first entity); single-entity admins
  are locked; Finance/Dues/Reports show a `common.pickEntity` prompt on "All";
  Issues/Meetings/Inspections/Contracts/Users aggregate across all viewable
  buildings on "All". **Import deliberately keeps its own local target picker**
  (import destination should be explicit). Block drill-down filters stay local
  per page. Pitfall (b73c2ec): any load effect keyed on `entityKey` must also
  depend on `entities.length` — on mount with a persisted key, `entities` is
  still loading and the effect must refire once it resolves.
- **Dashboard:** gradient balance hero, KPIs, collected-vs-spent interactive chart, **coverage** (reserve + runway + dues issued), upcoming meetings — all filterable by **compound / block / building**.
- **Finance:** entity comes from the sidebar selector; block filter + period (all/year/month) stay in-page. Record expense with scope (whole compound / a block / group / selected units / one unit) and method (by shares/equal/custom); per-unit **Book**, **Expenses**, **Payments** tabs; detail + edit/delete + attachments. Residents get a read-only **"My Account"** statement.
- **Dues:** per building/compound plan (cadence + by-shares/equal/manual/B2). "Generate dues for a period" auto-trues-up (`amount_due = max(0, base − balance)`). Residents see a **Dues card**.
- **⚠️ DUES ARE PARTY-AWARE (2026-08-02, #61, migration 0070).** A plan now has
  **two pools**: `pool_amount` (the recurring budget — billed to the **tenant**
  where a unit is leased, to the owner otherwise) and `owner_pool_amount` (the
  owner-only slice charged EVERY period, 0 by default). Plus one-time **special
  charges** ("Add special charge") — allocated across units, off the plan's
  period cycle, with their own due date, `kind='off_budget'`. **The plan's owner
  pool recurs; a special charge fires once.** A special charge picks who pays:
  **Owners only** (capital work — roof, elevator, facade — follows ownership) or
  **Tenants where leased** (a running cost that landed off-cycle, e.g. a fuel
  surcharge when oil doubles; same rule as the recurring budget, so it falls to
  the owner on unleased units). Editing the plan is the WRONG tool for an
  off-cycle charge: it changes every future period and still would not bill now.
  Two rules keep the numbers honest, both implemented in
  **`computeDuesGeneration()` in `src/lib/reportData.ts`**:
  1. **Carry-in is party-scoped** — owner carry = `−bal.owner`, tenant carry =
     `−bal.tenant`. A unit's pre-existing balance is the owner's (opening
     balance is owner by definition), so it never lands on a tenant.
  2. **Carry is consumed once per unit + period + party.** Dues never touch the
     balance ledger, so a second generation into the same period would apply the
     same carry twice. This is what makes "the carry applies to the sum of the
     recurring and special-charge amounts" hold even across separate runs.
  **Move-out needs no dues offload:** `end_membership()` (0065) credits the owner
  sub-ledger, so a departed tenant's balance lands in the OWNER's carry-in next
  period by itself. Historical dues keep their original `tenant_id` — that is the
  former-tenant view, and rewriting it would destroy the history. The Dues tab,
  the generate preview, the resident card and the PDF statements all read the
  shared builders (`buildDuesRows` / `computeDuesGeneration` / `buildUnitBuckets`),
  so screen and PDF cannot disagree.
- **Structure:** units (share weight/occupancy/owners/tenure) + allocation groups; building selector grouped by compound.
- **Inspections / Service Contracts:** compound- or block-level; residents can view.
- **Issues / Meetings:** compound/block/building selector; create targets a specific block; issue status filter, apartment-as-unit dropdown; meeting attendees + "select all" + online link + detail view + attachments.
- **Buildings:** create/edit/delete buildings & compounds (org-scoped for org admins); assign building↔compound; billing-mode toggle.
- **People:** approvals + assigned unit display + **invite user modal** (platform admin + org admin; sends magic-link email with role assignment).
- **Organizations:** create/edit/delete orgs; assign buildings to orgs (platform admin).
- **Sidebar:** two-tier layout — Operations (Dashboard, Finance, Dues, Issues, Meetings, Inspections, Contracts) + collapsible Settings section (Buildings, Structure, People). Settings section persisted in localStorage.
- **Auth:** login, forgot password → email link → `/set-password` page (handles both password reset and first-time invite setup).
- **Marketing site (abniyah.com):** the root domain serves `Landing.tsx` (hostname switch in `App.tsx`) — full marketing page (product showcases with real screenshots in `public/marketing/`, pricing, about, FAQ, bilingual). Screenshots re-shot with `shoot-marketing.mjs`.
- **⚠️ FINANCE REFACTOR 2026-08-02 (pull before touching Finance!):** the book
  row math (`buildBook`), statement buckets (`buildUnitBuckets`) and tenancy
  derivations (`tenancyHelpers`) moved VERBATIM out of Finance.tsx into
  **`src/lib/reportData.ts`** as pure functions — Finance calls them and so does
  the new Reports page, so screen and PDFs always agree. Evolving the ledger
  model = edit the lib, both pages follow. Finance UI unchanged EXCEPT the
  Export Report button moved to Reports (charts/KPIs/tabs all still there).
- **Reports tab (2026-08-02, #62):** `/reports`, sidebar between Finance and
  Dues. Managers (`finance.view`): Building financial report + Unit statement
  cards. Residents (and the My-home lens): My unit statement (tenants get THEIR
  ledger only; owners the full unit) + **Building expenses** transparency PDF
  (`ExpensesReportDoc` in pdf.tsx — expenses only, never unit balances/names).
  Backed by **0069**: building members can READ their building's/compound's
  expense list (Jey's default-on decision); writes untouched. NEW REPORT TYPES
  GO HERE as cards, not into Finance.
- **In-app feedback widget (2026-08-02, 0068):** sidebar "Send feedback" →
  `feedback` table → `file-feedback` edge function → GitHub issue labeled
  `feedback` (reporter, route, device, signed screenshot). SWEEP THE BOARD for
  new feedback issues at session start; docs/TESTING_FEEDBACK.md is annotated
  and frozen — the Projects board is the single source of truth.
- **Copy rules now enforced:** American English (organization, Canceled as
  display; DB enum 'cancelled' untouched; 'Cheque' kept deliberately), no
  em-dashes, theme tokens (never hardcoded slate/emerald backgrounds).
- **My-home dashboard (2026-08-02, #67):** resident view mirrors the manager
  layout (full-width hero, unit card grid, side-by-side quick links) — keep the
  two lenses structurally parallel when editing Dashboard.tsx.
- **WhatsApp is PER-LANGUAGE now (2026-08-02):** `WHATSAPP_PER_LANG=1` is LIVE. Each of the 5 templates has approved `en` + `ar` variants; recipients get ONE message in their `preferred_language`. ⚠️ Param counts are frozen per template (new_charge 5, payment_received 4, dues_issued 6, unit_invite 4, payment_reminder 5) — changing a template's variables requires a body revision through Meta review, done via the Graph API (the UI cannot add languages to existing templates; see WHATSAPP_SETUP.md Part 2b, WABA id 4479435942319273, token = a fresh `abniyah-api` system-user token generated AFTER the WABA asset was assigned). Money templates' last variable is the pay line (Whish account or generic fallback), filled by `payLine()` in both edge functions.
- **Public read-only demo:** "See the live demo" on abniyah.com → `app.abniyah.com/demo` — a bilingual persona chooser. **"View as building admin"** = `jihad.meraachli+demoviewer@gmail.com` ("Demo Admin", `viewer` grant on Tulip); **"View as unit owner"** = `jihad.meraachli+demoowner@gmail.com` ("Nadia Salameh", owns units 302 + 503). Both password `abniyah-demo-2026` (public by design — in the bundle, `src/lib/demo.ts`). Demo sessions: conversion banner + Switch view, no Settings, no issue reporting, sign-out redirects to abniyah.com. Demo admin additionally sees Buildings + Structure read-only (0058 names). **Tulip is the showcase building** — seeded by `seed-demo.mjs` (20 units, 16 fictional residents via gmail +aliases, 8 months of books, contracts, inspections, meetings, issues). Re-run it after wipe-day to rebuild the demo.

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
- **Phone push notifications (iOS)** — ✅ done and verified on device (2026-08-05). `@capacitor/push-notifications` → APNs, sent from `dynamic-action` on the same events as email. Two native steps are easy to lose and cost several TestFlight cycles to find — the AppDelegate registration relay and `aps-environment: production`; both are written up in [docs/IOS_APP.md](IOS_APP.md). Android is not wired up yet (needs Firebase).
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
| 9 | **Launch checklist (un-stealth)** | At public launch: remove `<meta name="robots" content="noindex">` from `index.html`, flip `public/robots.txt` to `Allow: /`, and drop `VITE_BETA_GATE=1` from the Cloudflare Pages build env (ungates app AND marketing site — both use the same gate). | Stealth mode (Aug 2026): abniyah.com landing + the /demo entry sit behind the beta gate; legal pages stay public for App Store review. |

---

*Questions on any of this — the code is documented and `docs/WORKFLOW.md` has the reasoning behind each decision.*
