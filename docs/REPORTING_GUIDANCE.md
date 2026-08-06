# Reporting Guidance — for Jihad (2026-08-05)

The money model is now complete (migrations 0085–0090: expense-type catalog,
LBP dual currency, Prepaid Budget, as-of requests, extraordinary expenses,
metering). Reporting is the half that makes it *legible* to residents and
committees. This is the spec for that work, in priority order.

## Ground rules — every report, no exceptions

1. **USD is canonical.** `amount_usd` is the number that totals, balances and
   sorts. Never re-convert.
2. **LBP is a per-row log.** Any row carrying `amount_lbp + lbp_rate` must show
   it: `$100.00 + LL 5,000,000 @ 89,500`. Never convert at *today's* rate — the
   row's frozen rate is the legal record of the transaction. `currencyBreakdown()`
   in `src/lib/currency.ts` formats this; use it, don't re-derive.
3. **Party-aware always.** A tenant's report never shows the owner's money and
   vice versa. Reuse `buildUnitBuckets` / `tenantTitle` — a tenant is always
   "Current tenant: Name" or "Former tenant: Name", never bare.
4. **Numbers come from `src/lib/reportData.ts` pure functions**, shared with the
   screens. If a report needs a number the lib doesn't compute, add the function
   THERE with a test, then render it. Screen and PDF must be incapable of
   disagreeing.
5. **Expense names come from the catalog** (`expense_types`), not the legacy
   enum — a custom type must never print as "Other". (`ExpensesReportDoc`
   currently has this bug: its `categoryLabels` map is keyed on the enum.)
6. Bilingual as usual; dates through `fmtDate` (Arabic month names).

## The reports, in priority order

### 1. Payment receipt — after EVERY payment (highest value)
The thing a resident holds up when there's a dispute.
- **Content:** receipt number, payment date, building, unit, payer (party +
  name — tenant payments name the tenant), amount in USD **and** the LBP
  breakdown with its rate, method, remaining outstanding for that party
  (party-scoped, from the same math as the reminders), Whish line if set.
- **Numbering:** add a `receipt_no` on payments, assigned by a DB trigger from a
  per-building sequence (`BLDG-2026-00042` style). Do it in SQL, not the client
  — two admins recording at once must not collide.
- **Delivery:** (a) the payment email becomes the receipt (styled HTML — the
  data is already in the webhook record, including LBP); (b) a "Download
  receipt (PDF)" button on the payment detail + the resident's payment rows,
  via the existing `@react-pdf` setup. Don't generate PDFs inside the edge
  function — heavy and unnecessary when the email itself is the receipt.

### 2. Expenses transparency PDF — fix and extend (exists, 0069)
- Catalog names (bug above), LBP column (`amount + rate` per row where
  present), **Extraordinary** marker on `is_extraordinary` rows, and a
  "derived from metering cycle Jul 1–31" note on `meter_cycle_id` rows.

### 3. Budget vs actual — PDF export (in-app card exists)
- Same table (`buildBudgetVsActual`), plus a **collection appendix**: per unit
  and party, issued vs collected for the budget's dues (`budget_id` joins;
  settlement = the party's payments since issue, same rule as
  `get_overdue_dues`). This is the committee handout.

### 4. Metering cycle report (new)
The sheet you pin in the lobby: period, stock math (opening + bought − closing,
avg unit cost), per-unit readings and consumption, cost per kW/m³, the common
split, per-unit amounts. Everything is in `meter_cycles` + `meter_readings` +
the posted charges; `computeMeterCycle` recomputes the derivation for display.

### 5. Collections / aging report (new)
Per unit + party: outstanding bucketed current / 30 / 60 / 90+ days, from
request lines (`request_line_outstanding`, aged by `due_date`) and open dues
(aged by `due_date`). Add `buildAging()` to reportData with a test first.

### 6. Unit statement — polish (exists)
- LBP breakdowns on payment rows, the as-of date in the header when one is
  active, and the dues rows' budget label (what the resident is prepaying FOR
  — `budgets.label` via `dues.budget_id`; residents can already read
  `budget_lines` by RLS, so a one-line "includes: Fuel, Gardening…" is free).

## Backlog found during the money audit
*(updated 2026-08-06 after Jihad's Claude's review — most items were built the
same day: cancel-budget UI in 9017841, metered-edit guard + cycle edit/delete in
6b5fc58/0092, compound LBP prefill in 9017841, atomic money ops in 0092.)*
- **Adjustments are USD-only** — the one genuinely open decision. They're
  non-cash (discounts/waivers), so probably fine as-is; confirm and close.
- **Accepted pattern, documented not changed:** `budget_lines` /
  `meter_readings` read access nests a query on the parent table inside the
  policy, inheriting the parent's RLS. Correct, but it means disabling RLS on
  `budgets`/`meter_cycles` silently opens the children — never disable RLS on a
  parent without checking its dependents.
- Metering cycle **draft** status exists in the schema, unused — cycles are
  finalize-only for now.
