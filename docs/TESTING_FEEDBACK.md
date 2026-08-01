# Abniyah — Testing Session Feedback (round 1)

Split into **Finance** (Ahmad — prioritized by fix order) and **Everything else** (kept as written).
Ordering rationale is Ahmad's proposed sequence; details to be discussed per item.

---

## FINANCE  *(ordered by suggested fix order)*

### A. Correctness bugs — fix first (wrong numbers/behaviour, mostly self-contained)
1. **Outstanding** not changing when filtering on top, but adjusting when filtering down.
2. **Fund balance** should include positive **and** negative outstanding.
3. **Voided-payment bug:** a voided payment disappeared from the UI but stayed in the downloaded report; then adding a new payment showed it voided again.

### B. Owner / Tenant sub-ledger — the core epic (most comments below are one feature)
> Almost everything here hangs on splitting a leased unit's balance into an **owner** ledger and a **tenant** ledger. Prereq: the "Add user" duplicate-owner/tenant rule in the non-finance section.
4. Units with **only an owner** → any charge defaults to the owner. The owner/tenant choice only applies to units that have **both** a tenant and an owner, based on what's selected when the expense is recorded.
5. **Record expense:** for leased units, choose to charge the **owner or tenant**. Remove the "All members" option from expense.
6. **Record payment:** for leased apartments only (unit has a tenant), a new option appears to select **who paid** (owner or tenant).
7. **Balance** shows **Tenant Balance** and **Owner Balance** — N/A if no tenant — as sub-rows under the unit.
8. **Adjustments:** allow **offloading balance from tenant to owner**.
9. **Notification bug:** message is sent to **both** owner and tenant even though the payment was recorded to one of them. *(Touches the frozen WhatsApp template param counts — see finance-guardrails.)*
10. **Owner sees tenant's data:** the owner sees all expenses/payments tagged with the tenant's name; when a tenant is deleted, balances transfer to the owner *(confirm this is the intended behaviour)*.
11. **Finance + Dashboard:** for units with a tenant, the owner can toggle between seeing **his** numbers or the **tenant's** numbers.

### C. Dues — owner/tenant *(depends on B)*
12. Show **amount due** and **carry-in** as a unit total, then **sub-rows for tenant and owner**.
13. Add a row for **owner one-time / off-budget**.

### D. Reporting
14. The **downloaded statement** needs Abniyah formatting — *consider a proper reporting module.*

### E. Labels / cosmetic — quick wins (batch anytime, low risk)
15. **Book tab:** add a **Record Expense** button parallel to Record Payment.
16. **Adjustments:** rename the **"Record Adjustment"** button.
17. Make the **red** for negative values **pink**.
18. Add **descriptions** of Balance, Collected, Billed.

---

## EVERYTHING ELSE  *(kept as-is)*

### Landing App page
- Revisit main page opening sentence, too finance signals and center the sentence

### Register page
- American english instead of Australian English, organization instead of organisation
- Compound Admin: blocks instead of Blocks
- Text field validation for full name, email address, password
- Email: check that it doesn't already exist
- City: change to drop down with search
- Limit for number of licenses for building admin
- Confirm your email, statement at the bottom, contact Abniyah team needs clickable contact

### Getting started
- Replace create your building with complete your building details

### Add unit
- Occupancy remove abroad
- Text validation in add unit: confirm date is entered
- Allows duplicate unit name, adjust this
- Groups: default groups Occupied and Vacant and the button should be Create Group not Structure.create
- Vacant indicator color seems off

### Add user
- Add Abniyah user gives there are no units but there actually are units, bug needs fixing
- It allows an apartment with an owner to have another owner, dont allow this. Same for tenant dont allow adding tenant before removing other tenant  *(prereq for Finance §B owner/tenant ledger)*

### General comments
- Comma separated numbers  *(affects money display across Finance)*
- All email templates to be adjusted  *(includes finance emails — mind the WhatsApp/email money-template guardrail)*
- Phone textfield suggestion number change to Abniyah number
- Everywhere a phone is required, force country code to be added
- Managing and My home, moving to managing tab doesnt change the dashboard and doesnt show which unit we manage
- Change config to Configuration
- Scroll down to refresh iOS app
