# Abniyah — Testing Session Feedback (round 1)

Split into **Finance** (Ahmad — prioritized by fix order) and **Everything else** (kept as written).
Ordering rationale is Ahmad's proposed sequence; details to be discussed per item.

> **Status sweep 2026-08-02 (reconciled with the GitHub Projects board):**
> ✅ = shipped (commit noted) · #NN = open issue on the BuildingHub Roadmap board.
> Finance sections A, B and E shipped in the 2026-08-02 overnight wave (migrations
> 0061–0067). Remaining items live as issues #61–#69 — do not work from this file,
> work from the board.

---

## FINANCE  *(ordered by suggested fix order)*

### A. Correctness bugs — fix first (wrong numbers/behaviour, mostly self-contained)
1. ✅ **Outstanding** not changing when filtering on top, but adjusting when filtering down. *(ee69bb7)*
2. ✅ **Fund balance** should include positive **and** negative outstanding. *(18027d9, migration 0061)*
3. ✅ **Voided-payment bug:** a voided payment disappeared from the UI but stayed in the downloaded report; then adding a new payment showed it voided again. *(93f5dc2 + 2b674c6)*

### B. Owner / Tenant sub-ledger — the core epic (most comments below are one feature)
> Almost everything here hangs on splitting a leased unit's balance into an **owner** ledger and a **tenant** ledger. Prereq: the "Add user" duplicate-owner/tenant rule in the non-finance section.
4. ✅ Units with **only an owner** → any charge defaults to the owner. *(b589ef2, migration 0064)*
5. ✅ **Record expense:** for leased units, choose to charge the **owner or tenant**. *(b589ef2)*
6. ✅ **Record payment:** who paid (owner or tenant). *(78cd6ea, migration 0066 row tenant_id)*
7. ✅ **Balance** sub-rows: Tenant / Owner under the unit. *(78cd6ea + fbdcf37 + 5343d14)*
8. ✅ **Adjustments:** offload balance from tenant to owner. *(94325f4, migration 0065 — auto-offload on tenant departure)*
9. ✅ **Notification bug:** messages now follow the party. *(391b1ad, migration 0067 — ⚠️ requires `dynamic-action` redeploy in the Supabase dashboard)*
10. ✅ **Owner sees tenant's data** + history stays visible after offload. *(74348ea)*
11. ✅ **Finance + Dashboard:** owner toggle own/tenant/combined. *(2aa3668 + 3aad1be + 12e2083)*

### C. Dues — owner/tenant *(depends on B — B is now shipped)*
12. → **#61** Show **amount due** and **carry-in** as a unit total, then **sub-rows for tenant and owner**.
13. → **#61** Add a row for **owner one-time / off-budget**.

### D. Reporting
14. → **#62** The **downloaded statement** needs Abniyah formatting — *consider a proper reporting module.* *(PDF column alignment already improved: c04db61, db64e13, 0d347b5)*

### E. Labels / cosmetic — quick wins (batch anytime, low risk)
15. ✅ **Book tab:** Record Expense button. *(13975c3)*
16. ✅ **Adjustments:** button renamed. *(13975c3)*
17. ✅ Negative-value color + thousands separators. *(73c3c28 + 6b67807)*
18. ✅ Descriptions of Balance, Collected, Billed. *(a948d18)*

---

## EVERYTHING ELSE  *(kept as-is)*

### Landing App page
- → **#68** Revisit main page opening sentence, too finance signals and center the sentence

### Register page
- → **#63** American english instead of Australian English, organization instead of organisation
- → **#63** Compound Admin: blocks instead of Blocks
- → **#63** Text field validation for full name, email address, password
- ✅ Email: check that it doesn't already exist *(ec38354)*
- → **#63** City: change to drop down with search
- → **#63** Limit for number of licenses for building admin
- → **#63** Confirm your email, statement at the bottom, contact Abniyah team needs clickable contact

### Getting started
- → **#68** Replace create your building with complete your building details

### Add unit
- → **#64** Occupancy remove abroad
- → **#64** Text validation in add unit: confirm date is entered
- → **#64** Allows duplicate unit name, adjust this
- → **#64** Groups: default groups Occupied and Vacant and the button should be Create Group not Structure.create
- → **#64** Vacant indicator color seems off

### Add user
- → **#65** Add Abniyah user gives there are no units but there actually are units, bug needs fixing
- ✅ It allows an apartment with an owner to have another owner, dont allow this. Same for tenant. *(6781424 + b4d7a07, migrations 0062/0063)*

### General comments
- ✅ Comma separated numbers *(73c3c28)*
- → **#53** All email templates to be adjusted *(existing board issue — includes finance emails; mind the WhatsApp/email money-template guardrail)*
- → **#66** Phone textfield suggestion number change to Abniyah number
- → **#66** Everywhere a phone is required, force country code to be added
- → **#67** Managing and My home, moving to managing tab doesnt change the dashboard and doesnt show which unit we manage
- → **#68** Change config to Configuration
- → **#69** Scroll down to refresh iOS app
