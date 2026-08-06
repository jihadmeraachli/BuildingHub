# The Ahla Test Lap — live verification of the money rework (0076–0092)

Every scenario here targets a path where this week's bugs failed **silently** —
no error, just wrong money or a reminder that never arrived. The math has test
suites; this lap is the first time the SQL (RLS, triggers, cascades, the atomic
functions) runs against real data.

**Rules**
- Test in **Ahla Building** (or any sandbox). **Never Tulip** — it is the demo
  showroom and marketing screenshots depend on its books.
- Use a resident account whose profile has **email ON** (not Nadine — her email
  is off). Have that inbox open in another tab.
- When a step fails, note the **step number** — each maps to a specific
  migration (table at the bottom), so the number tells us where to look.

---

## Part 0 — Setup (5 min, building settings)

| # | Do | Expect |
|---|---|---|
| 0.1 | Buildings → edit Ahla → **Expense types** section | The 7 seeded types listed (Water, Electricity, …). Add one: `Fuel`. It appears instantly |
| 0.2 | Tick **Metered** on Electricity (or Fuel) | Checkbox sticks after closing/reopening the modal |
| 0.3 | Set **LBP exchange rate** = `89500`, **Days to pay** = `7`, save | Reopen the modal — both persisted |
| 0.4 | Confirm Ahla's **billing mode = Dues** (flip it if not) | Prepaid Budget tab shows the New budget button |

*Failure here → 0085 (types) or 0086 (rate) or 0076 (due days).*

---

## Part A — Dues mode

### A1. Issue a line-item budget
| # | Do | Expect |
|---|---|---|
| A1.1 | Prepaid Budget → **New budget**. Name `Test Q4`, period from = today, to = +3 months, due date = +7 days | Modal shows the lines editor with one empty row |
| A1.2 | Add lines: `Fuel` 300 USD, `Gardening` (custom type) 200 USD | **Budget total: $500.00** updates live |
| A1.3 | On one line, put `0` USD and `8,950,000` LBP, rate prefilled `89500` | That line contributes **$100.00**; total updates |
| A1.4 | Leave: by shares, all units, tenants-where-leased, true-up ON. Check the preview | One row per party that owes; a leased unit shows the **tenant's name**; carries match the Outstanding card |
| A1.5 | **Issue budget** | Toast; the budget appears under **Issued budgets** with its period and total; dues rows appear grouped under `Test Q4` |
| A1.6 | Resident's phone/inbox | 🔔 "Dues due …" AND an email — to the **billed party only** (tenant of leased units, owner otherwise) |

### A2. Cancel it (atomic — 0092)
| # | Do | Expect |
|---|---|---|
| A2.1 | Issued budgets → **Cancel** on `Test Q4`, confirm | Toast "Budget cancelled and its asks withdrawn" |
| A2.2 | The page | Budget gone from the list, its dues rows gone, **Outstanding by unit back to what it was before A1** |
| A2.3 | Resident's 🔔 | "Dues removed" notice |

### A3. The flat ask (fuel case — true-up OFF)
| # | Do | Expect |
|---|---|---|
| A3.1 | Pick a unit **in credit** (record a payment first if none is) | Outstanding card shows nothing for it |
| A3.2 | New budget: one line `Fuel` $200, **UNCHECK "Apply the arrears true-up"**, issue | Preview asks that unit the FULL $200 despite its credit |
| A3.3 | Same budget with true-up ON (don't issue — just toggle and watch) | Preview asks $0 for that unit (credit swallows it) |

*This is the pair that motivated the toggle: ON = accounting-correct, OFF = collects the cash.*

### A4. Extraordinary expense in dues mode → delete (0089 + 0091)
| # | Do | Expect |
|---|---|---|
| A4.1 | Finance → Record Expense: `Burst pipe test`, $150, tick **Extraordinary** | Hint says "flat prepaid ask… collected in full even from units in credit" |
| A4.2 | Save | TWO toasts (expense saved + extraordinary ask issued). Prepaid Budget shows a budget `Extraordinary: Burst pipe test` with the amber tag; dues rows exist with a due date +7 days |
| A4.3 | Resident | 🔔 + email for the due |
| A4.4 | Finance → Expenses → **delete** `Burst pipe test` | Confirm dialog says the ask is withdrawn WITH it. After: the extraordinary budget AND its dues are gone; residents get "dues removed" |

*A4.4 is the 0091 cascade — before it, deleting the expense left residents
chased forever for money that no longer existed.*

---

## Part B — Arrears mode
Flip Ahla to **arrears** in Buildings (or use an arrears sandbox building).

### B1. As-of payment request (0088)
| # | Do | Expect |
|---|---|---|
| B1.1 | Ensure a unit has: an old charge (dated last month, e.g. $500) and a **recent payment** (dated this week, e.g. $300). Backdate via the date fields when recording | Book shows balance −$200 |
| B1.2 | Book → **Request payment** → set **"Request balances as of"** = end of last month | Preview asks **$200** (old $500 − the $300 paid since), NOT $500 and NOT today's balance if other charges exist |
| B1.3 | Add a charge dated **today**, reopen the modal, same as-of | The new charge does NOT appear in the ask (it waits for the next request) |
| B1.4 | Issue. Resident | 🔔 + email + WhatsApp "Payment requested", amount $200, due +7 days |

### B2. Extraordinary in arrears → delete
| # | Do | Expect |
|---|---|---|
| B2.1 | Record Expense `Generator repair test`, $120, **Extraordinary** ticked | A payment request labelled `Extraordinary: Generator repair test` appears (resident card + notifications) — and the B1 request is **still open** (extraordinary does not supersede) |
| B2.2 | Delete the expense | The extraordinary request vanishes with it; the B1 request survives |
| B2.3 | Press the general **Request payment** again and issue | It **replaces** all open requests (0079) — one fresh ask covering the full balance; the resident card shows one obligation, not stacked ones |

---

## Part C — Metering (either mode)

### C1. Record and finalize a cycle
| # | Do | Expect |
|---|---|---|
| C1.1 | Finance → **Metering** tab | The metered type from 0.2 selectable. (Empty state points at building settings if you skipped 0.2) |
| C1.2 | New cycle: period = last month. Stock: opening `1000`, bought `500` @ `$450`, closing `300` | Live line: "Consumed 1,200 at an average 0.90 each = **$1,080.00** to allocate" |
| C1.3 | Readings: unit A `5000→5100`, unit B `8000→8300`, Common `200→400` (leave others empty) | Preview: A **$360** (100 kW + half of common), B **$720**, header total **$1,080.00**, rate 1.8/kW |
| C1.4 | **Finalize & post expense** | Toast. Expenses tab shows one expense `Electricity · <period>` for $1,080; the Book moves; charges hit the **tenant where leased** |
| C1.5 | SQL editor sanity: | `BEGIN; UPDATE expenses SET amount_usd = 1 WHERE meter_cycle_id IS NOT NULL; ROLLBACK;` → must FAIL with "posted by a metering cycle" |

### C2. Edit → re-post (atomic — 0092)
| # | Do | Expect |
|---|---|---|
| C2.1 | Click the cycle row | Modal opens **prefilled** — stock, cost, and every reading as entered |
| C2.2 | Change unit B's end reading `8300→8400`, **Recompute & re-post** | New totals in the preview first; after posting, the expense amount updated, charges **replaced not duplicated** (check unit B has ONE charge from this cycle, at the new amount) |
| C2.3 | New cycle (don't save) | Start readings prefill from the EDITED end readings; opening stock = last closing |

### C3. Delete
| # | Do | Expect |
|---|---|---|
| C3.1 | Trash icon on the cycle, confirm | Cycle gone, its expense gone, charges gone, Book back to pre-C1 |

---

## Part D — LBP on ordinary money (0086)
| # | Do | Expect |
|---|---|---|
| D1 | Record Expense: $50 USD + 4,475,000 LBP, rate prefilled 89500 | "Total: **$100.00**" shown before saving; the row carries a **MIX** tag |
| D2 | Record Payment the same way | MIX tag; the payment **email** has a "Paid as" line: `$50.00 + LL 4,475,000 @ 89,500` |
| D3 | Change the building's rate to `100000`, reopen the D1 expense detail | The OLD entries still show **89,500** — the rate is frozen per row; only new forms prefill 100000 |

---

## Part E — The morning after (~9:05am Beirut)
| # | Check | Expect |
|---|---|---|
| E1 | `SELECT sent_on, source, party, count(*) FROM reminders_sent GROUP BY 1,2,3 ORDER BY 1 DESC;` | Rows dated today for what is genuinely owed; **nothing** for the cancelled budget or deleted extraordinary asks |
| E2 | A unit owing on BOTH an open request and dues (if you set one up) | TWO rows same day, `source` arrears + dues — neither silenced the other |
| E3 | Resident inboxes | Daily reminder while inside the window; wording says the due date; "overdue" wording only after it |

---

## If a step fails — where to look

| Step | Suspect |
|---|---|
| 0.x | 0085 / 0086 / 0076 |
| A1–A2 | 0087 (budgets) / 0092 (cancel_budget) |
| A3 | 6497e48 true-up toggle + e0dc482 netting |
| A4 / B2 | 0089 (extraordinary) / 0091 (cascade) |
| B1 | 0088 (as-of + settlement by entry time) |
| B2.3 | 0079 (supersede) |
| C1–C3 | 0090 (metering) / 0092 (guard + atomic re-post/delete) |
| D | 0086 (currency) + dynamic-action deploy |
| E | 0076/0080/0082 (windows, sources, chase-all) + the cron |

Report the step number + what you saw instead — that's enough to pinpoint it.
