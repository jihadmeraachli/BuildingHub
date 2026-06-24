# BuildingHub — Master Workflow & Domain Model

> **Status:** Design spec (v3 — forks resolved, decisions locked). This is the
> agreed blueprint from the brainstorm and supersedes the role model in the
> current `supabase/schema.sql`.
> **Audience:** product + engineering. Every action in §9 is written to be
> internally consistent with the model in §1–§8 — if the model changes, the
> affected actions in §9 must be re-checked.

---

## 0. What BuildingHub is

A multi-tenant building-management super-app for Lebanon. It serves three real
market shapes:

1. **Self-managed buildings** — a resident committee runs the building, possibly
   hiring an accountant.
2. **Company-managed buildings** — a management company (organization) runs many
   buildings and handles billing + collection.
3. **Compounds** — multiple blocks under one umbrella, where some costs are
   shared across all blocks and some are per-block or per-unit.

The app must let any of these record costs, split them fairly, collect money,
and show the building's "book" (balance, arrears, reserve) at all times.

---

## LOCKED DECISIONS (v1 scope)

| Fork | Decision |
|---|---|
| Compound fund | **One book per compound**, with block-level views/reports (every money row carries `block_id` for filtering). |
| Billing model | **Pure expense-driven.** No minimum floor, no recurring fee schedule in v1 (deferred). |
| Owner vs tenant | **Owner only.** Charges always route to the unit's owner. Tenure/tenant deferred; schema left extensible. |
| Currency | **USD only.** No LBP / FX in v1 (deferred). |
| Accountant | Finance capabilities live **inside the admin role by default**; a **distinct finance-scoped grant** is added only when a dedicated accountant is employed. |
| Balance sign | **Positive = credit** (paid more than owed). **Negative = owed** (arrears). |

---

## 1. Core principles (the decisions everything else hangs on)

1. **Management is a relationship, not a fixed ladder.** A building is functional
   on its own. An organization is *optional sugar* on top.
2. **Decouple "what you can do" (capabilities/roles) from "where you can do it"
   (grants on a building or org).**
3. **Two access systems, kept separate:** *management access* (grants) and
   *resident membership* (a link to a unit). A person can have both.
4. **One human = one identity = one login.** Never two profiles. "Admin who also
   lives here" = one account with one grant + one membership.
5. **Money anchors to the unit, not the person.** Charges attach to `unit_id`;
   the unit's **owner** is the responsible payer.
6. **Separate the cost event from who pays it.** An *Expense* is fanned out by an
   *allocation rule* into per-unit *Charges*. Payments settle charges.
7. **Every check funnels through one function, `user_can()`.** All RLS policies
   call it, so the permission model lives in exactly one place.

---

## 2. Identity & the two access systems

```
                         ┌──────────────────────────┐
                         │   IDENTITY (auth user)    │  one login, one email,
                         │   profile = personal info │  one notification inbox
                         └────────────┬─────────────┘
                                      │
              ┌───────────────────────┼────────────────────────┐
              │                                                  │
   MANAGEMENT ACCESS (grants)                       RESIDENT MEMBERSHIP
   "I administer / do finance for…"                 "I own unit…"
   scope = a BUILDING or an ORG                     link = a UNIT (owner)
   additive, role = bundle of caps                  gives ROW-LEVEL view of own data
```

- A **committee admin** = identity + grant(building, building_admin).
- A **management-company staffer** = identity + grant(org, org_admin) → cascades
  to every building the org manages.
- An **accountant (when employed)** = identity + grant(building **or** org,
  finance). When no dedicated accountant exists, finance work is done by the
  admin (whose role already includes finance caps).
- An **owner/resident** = identity + membership(unit).
- An **admin who also lives here** = identity + grant + membership. One account.
  His apartment still gets charges like everyone else, because charges anchor to
  the unit (principle 5). UI handles the two "hats" with a view toggle, not a
  second account.

---

## 3. Physical hierarchy

```
Organization (optional — the management company)
   │  manages (many-to-many: org ↔ buildings)
   ▼
Compound (optional — null for a standalone building)   ← ONE BOOK lives here
   │
   ▼
Block / Building                                       ← block_id tags every money row
   │
   ▼
Unit / Apartment                                       ← owner is the payer
   │
   ▼
Owner  →  via Membership
```

- A standalone building = a compound with one block, or `compound_id = null`.
- **One financial book per compound** (or standalone building). Funds are never
  commingled across the buildings an org manages.
- Block-level visualization is a **report filter**, not a separate book: every
  expense/charge/payment carries `block_id`, so the same book can be sliced
  per-block on demand.
- A cost has a **level**: `compound` (shared by all blocks), `block`, or `unit`.

---

## 4. The axes of a unit/owner (v1)

| Axis | Values | Affects |
|---|---|---|
| **Account status** | pending / active / suspended | login & app access |
| **Occupancy** | occupied / vacant / abroad | consumption-based charges, notifications |
| **Allocation groups** | tags: "Stairwell A", "Left wing", "Generator 10A", "Ground floor"… | reusable scopes for splitting costs |

> **Tenure (owner/tenant) is deferred.** v1 tracks the **owner only** as the
> responsible payer. The `memberships` table is shaped to add a `tenure` column
> later without migration pain.

---

## 5. Permissions model

### Capabilities (the verbs)

| Domain | Capabilities |
|---|---|
| Structure | `building.manage`, `unit.manage`, `group.manage` |
| People | `resident.approve`, `resident.manage`, `grant.manage` |
| Issues | `issue.view_all`, `issue.update` |
| Finance | `expense.manage`, `charge.manage`, `payment.record`, `payment.confirm`, `finance.view` |
| Meetings | `meeting.manage` |
| Org | `org.manage`, `org.assign_buildings` |

### Roles = named bundles of capabilities

| Role | Bundle | Typical scope |
|---|---|---|
| platform_admin | everything (bypass) | global |
| org_admin | all management caps **(incl. finance)** | org |
| org_finance (accountant) | finance.* + finance.view | org |
| building_admin | all management caps **(incl. finance)** | one building |
| building_finance (accountant) | finance.* + finance.view | one building |
| viewer | `*.view` only | building or org |
| owner/resident | membership, not a grant | unit (row-level) |

> Because `building_admin`/`org_admin` bundles already contain the finance caps,
> a building with **no** dedicated accountant needs no finance grant — the admin
> does it. Employing an accountant = add a `building_finance`/`org_finance` grant.

### The single check — `user_can(building, capability)`

```
can(user, cap, building):
  1. user is platform_admin?                         → ALLOW
  2. grant(user, org) where org manages building
        AND cap ∈ bundle(grant.role)?                → ALLOW
  3. grant(user, building) AND cap ∈ bundle(role)?   → ALLOW
  4. resident self-scoped cap AND user owns a unit ∈ building → ALLOW (row-level)
  5. else                                            → DENY
```

Additive / most-permissive wins. No deny rules in v1. Implemented once as a SQL
helper; every RLS policy calls it.

---

## 6. Cost allocation — Expense → Charges

```
   EXPENSE / COST EVENT                ALLOCATION RULE                 CHARGES
   ┌───────────────────┐         ┌──────────────────────┐      ┌─────────────────┐
   │ amount (USD)      │         │ SCOPE  (which units): │      │ unit 1A → $40   │
   │ category          │ ──────► │  compound / block /   │ ───► │ unit 1B → $40   │
   │ date              │         │  group / list / unit  │      │ unit 2A → $60   │
   │ level + block_id  │         │ METHOD (how to split):│      │ ...             │
   │ allocation rule   │         │  equal / shares /     │      │ (one per unit)  │
   └───────────────────┘         │  consumption / custom │      └─────────────────┘
                                 │  / percentage         │            │
                                 └──────────────────────┘            ▼
                              charges route to each unit's OWNER → unit STATEMENT
```

- **Scope** answers *which* units: whole compound, a block, a named **group**
  (the "subgroup" answer), an explicit list (the "2 apartments broke it" case),
  or a single unit.
- **Method** answers *how* to split: `equal`, `by_shares` (each unit has a
  `share_weight` — the traditional حصص split, default), `by_consumption`
  (metered readings), `custom` (exact amounts), `by_percentage`.
- v1 charges originate from **(a) an allocated expense** or **(b) a one-off
  manual charge**. (Recurring fee schedules deferred.)

---

## 7. Billing model (v1 = pure expense-driven)

```
Committee/company spends money  →  records an EXPENSE  →  allocates (scope+method)
   →  one CHARGE per affected unit  →  posts to each unit's statement
   →  owner pays  →  PAYMENT recorded & applied
```

- **No minimum floor and no fixed recurring fee in v1.** Units are billed for the
  actual allocated cost only.
- Fee-driven / budget billing is a **future** add-on (same Charge object, new
  source) — not built now.

---

## 8. The building book (financial ledger)

```
BUILDING BOOK (per compound / standalone building; sliceable by block_id)
  opening balance
    + Σ payments in (owners settling charges)
    − Σ expenses paid out
  ───────────────────────────────────────────────
  = FUND BALANCE   ── positive = reserve / احتياطي (over-collection shows here)

PER-UNIT ACCOUNT (statement)  —  sign convention:
  balance = Σ payments − Σ charges
    balance > 0  →  POSITIVE = credit / prepayment (paid more than owed)
    balance < 0  →  NEGATIVE = owed / arrears / متأخرات (paid less than owed)
```

- **USD only** in v1 — every money row stores a USD amount; no FX/LBP.
- Reports that fall out for free: fund balance (whole compound and per block),
  total arrears, who-owes-what, collection rate, expense breakdown by category,
  reserve over time.

---

## 9. End-to-end action workflows

> Each action lists **actor → capability checked → effect → events fired**.
> If §1–§8 change, re-verify each block here.

### 9.1 Setup & onboarding

```
Platform admin creates Org (optional)
   └─ Org assigned buildings        [org.assign_buildings]
Self-managed: building created directly, committee admin granted
   building_admin                   [building.manage / grant.manage]
   └─ optional: dedicated accountant granted building_finance (else admin does finance)
Define compound? → blocks → units (share_weight, groups, occupancy)  [unit.manage / group.manage]
Define charge categories                                             [building.manage]
Owner self-registers → status=pending → membership(unit)
Admin approves owner → status=active                                [resident.approve]
   └─ event: user_approved → notify owner
```

### 9.2 Record an expense and bill it out (the main flow)

```
Actor: admin / finance        Check: expense.manage
1. Enter expense: amount (USD), category, date, level, block_id
2. Choose allocation rule: SCOPE (compound/block/group/list/unit) + METHOD
3. Preview the per-unit split  ──────────────► confirm
4. System generates one CHARGE per affected unit  [charge.manage]
5. Charges post to each unit's statement (debit → balance more negative)
   fund "spent" increases
6. event: charge_issued (per unit) → notify the unit's OWNER
```

### 9.3 Targeted / damage charge (the "2 apartments" case)

```
Actor: admin / finance        Check: expense.manage
1. Enter cost (e.g., broken gate $200)
2. SCOPE = explicit list [unit 3A, unit 3B]; METHOD = custom ($100/$100) or equal
3. Generate 2 charges → statements → notify those 2 owners
```

### 9.4 Record a payment / collection

```
Actor: admin / finance / accountant   Check: payment.record
1. Owner pays (cash to natoor / committee, or bank transfer)
2. Record payment: unit, amount (USD), method, date
3. Apply to open charges (oldest first, or a specific charge)
   └─ pays MORE than owed → unit balance goes POSITIVE (credit/prepayment)
   └─ pays LESS than owed → unit balance stays NEGATIVE (arrears)
4. Fund balance "in" increases → over-collection raises the reserve
5. (optional) payment.confirm step for two-person control
6. event: payment_received → notify owner (receipt) + admin
```

### 9.5 Report & resolve an issue

```
Owner creates issue (own unit, photos→Storage)      (resident self-scoped)
   └─ event: new_issue → notify admins
Admin views all building issues                      Check: issue.view_all
Admin updates status open→in_progress→resolved (+notes)  Check: issue.update
   └─ event: issue_update → notify reporter
If the fix incurs a cost → flows into 9.2/9.3 as an expense/charge
```

### 9.6 Meetings

```
Admin schedules / records meeting (attendees, attachments)  Check: meeting.manage
   └─ event: meeting_scheduled → notify building owners
Owners view meetings (all)                                  (resident self-scoped)
```

### 9.7 Manage people & access

```
Approve / reject / suspend owner           Check: resident.approve / resident.manage
Grant or revoke management access          Check: grant.manage
   (employ an accountant = grant finance scope; add org staff = grant on org)
Switch view (Admin ⇄ My apartment)         UI only — same identity, grant + membership
```

### 9.8 View the book / statements

```
Admin / finance: fund balance (compound + per block), arrears, collection rate,
   category breakdown, reserve over time     Check: finance.view
Owner: own unit statement (charges, payments, balance) + building-wide charges
   (row-level)
```

---

## 10. Notifications (phase 2, designed for now)

Every charge & payment fires a **domain event**; notification handlers subscribe.
Channels: in-app (exists), email (exists), WhatsApp (planned — `notify_whatsapp`).

| Event | Recipients |
|---|---|
| charge_issued / invoice | unit owner |
| payment_received / receipt | owner + admin |
| arrears_reminder | units with negative balance |
| new_issue / issue_update | admins / reporter |
| meeting_scheduled | building owners |
| user_approved | owner |

---

## 11. Schema impact (vs. current `supabase/schema.sql`)

The current single-role-per-`profiles` row cannot express the model above. Target:

- `profiles` → personal info only (identity, contact, notification prefs).
- `organizations` + `org_buildings` (org↔building management links).
- `grants` → `(user, scope_type[org|building], scope_id, role)`.
- `compounds`, `blocks` (buildings), `units` (share_weight, occupancy).
- `memberships` → `(user, unit)` — `tenure` column reserved for future.
- `groups` + `unit_groups` (allocation tags).
- `expenses`, `charges`, `payments` (no fee_schedules in v1).
- `charge_categories`.
- `funds` / ledger view per compound; `block_id` on every money row for slicing.
- All money in **USD** (no FX columns in v1).
- `notifications` (exists) + event emission.
- One SQL helper `user_can(building, capability)`; all RLS policies route through it.

---

## 12. Deferred (explicitly out of v1)

- Recurring fee / budget billing model.
- Owner-vs-tenant split & tenant contacts (owner-only for now).
- LBP / multi-currency / FX.
- Minimum monthly floor.
- WhatsApp channel + arrears auto-reminders (events designed, delivery later).

---

## 13. Decision log

| # | Decision | Rationale |
|---|---|---|
| 1 | Org is optional sugar; management = grants | self-managed buildings stand alone |
| 2 | Decouple capability from scope | one mechanism for admin/accountant/org/super |
| 3 | Two access systems: grants vs. membership | a person can be both admin & owner |
| 4 | One identity per human, never 2 profiles | charges anchor to unit, hats are a UI toggle |
| 5 | Expense ≠ Charge; allocation rule (scope+method) | covers all-units, subgroups, targeted, metered |
| 6 | One book per compound, block_id slicing | matches Lebanese compound reality + block views |
| 7 | Pure expense-driven, no minimum/fee in v1 | simplest accurate billing; bill actual cost only |
| 8 | Owner-only payer in v1 | user only cares about owners now; tenant deferrable |
| 9 | USD only in v1 | avoid FX complexity until needed |
| 10 | Accountant = finance grant only when employed | admin role already carries finance caps |
| 11 | Balance: +credit / −owed | matches user's mental model for statements |
| 12 | One `user_can()` behind all RLS | single source of truth for security |
