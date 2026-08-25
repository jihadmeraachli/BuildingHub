# Abniyah — Financial Model at Three Scales

Extends the earlier profitability brief with fully worked dollar figures at three
concrete building counts. Every number below is computed inline; nothing is
asserted without the arithmetic shown.

**Verified against the repo:**
- `src/lib/pricing.ts` — pricing is a **flat monthly price per building**, by band,
  not per unit. The 1–20 unit band is **$85.00/mo** (`8500` cents), confirmed
  from `PRICING_BANDS[0]`. Annual is `ANNUAL_MONTHS_CHARGED = 10`, i.e. **$850.00/yr**
  per building (12 months for the price of 10 — 2 months free, ~17% off).
- `supabase/functions/dynamic-action/index.ts` — notification fan-out is
  per-unit-party (`unitPartyIds()` called per `unit_id` on charge/payment/dues/
  adjustment events), confirming the modeling assumption that an event fired
  at building level still generates one message per affected unit's
  owner/tenant, not one message per building.
- `docs/DEPENDENCIES.md` — WhatsApp ~$0.014/utility message (Lebanon), Resend
  free tier 100 emails/day shared with Supabase Auth email, Resend Pro $20/mo
  above that, Supabase Pro (assumed, $25/mo), Apple Developer $99/yr, Whish/
  Areeba **not live** (payment secrets "NOT YET SET" in both cases) — the
  2.5% gateway fee below is modeled as the **post-launch steady state**, not
  today's reality.

All three scenarios use **20-unit buildings**, so every building sits in the
same $85/mo pricing band — the only variable across scenarios is building
*count*, which isolates the effect of scale on the model.

---

## Assumptions (held constant across all three scenarios)

| Assumption | Value |
|---|---|
| Band price, 1–20 units | **$85.00/mo** per building (confirmed, `pricing.ts`) |
| Annual price | **$850.00/yr** per building (10 months charged) |
| Notification frequency — LOW / MED / HIGH | 2.5 / **5** / 9 events per unit per month (MED is headline) |
| WhatsApp opt-in rate | 50% of units |
| WhatsApp cost | $0.014 per message (Lebanon utility template) |
| Email | fires on every event, 100% of units (no opt-in gate) |
| Resend free tier | 100 emails/day, **shared with Supabase Auth mail** |
| Resend Pro | $20/mo once free tier is exceeded (covers 50k/mo) |
| Payment gateway fee | 2.5% blended, on collected subscription revenue — **modeled, not live** (Whish/Areeba pending) |
| Supabase Pro | $25.00/mo |
| Cloudflare Pro | $20.00/mo (stated point estimate within the $20–25 range) |
| Apple Developer | $99/yr = $8.25/mo |
| Domain renewal | ~$15/yr = $1.25/mo (estimate — exact renewal date/registrar not filled in in `DEPENDENCIES.md`) |
| Anthropic (AI import + help chat) | scaled with building count: **$5 / $8 / $15** per month for A / B / C respectively (more documents imported, more help-chat volume as the base grows) |
| CAC | $100 per paying building (from prior brief) |
| Churn | 3%/mo central, used only for the LTV:CAC line |

---

## Scenario A — 10 buildings × 20 units (200 units)

**Revenue**
- MRR: 10 × $85.00 = **$850.00/mo**
- Annualized run-rate (12 × MRR): **$10,200/yr**
- If all 10 on annual billing (10 × $850): **$8,500/yr**

**Variable costs**

| Line | LOW (2.5) | MED (5) — headline | HIGH (9) |
|---|---|---|---|
| WhatsApp: 200 units × events × 0.5 × $0.014 | 200×2.5×0.5×0.014 = **$3.50** | 200×5×0.5×0.014 = **$7.00** | 200×9×0.5×0.014 = **$12.60** |
| Email volume: 200×events÷30 | 16.7/day | 33.3/day | 60.0/day |
| Resend tier | Free | Free | Free |

At every sensitivity level, 200 units stays well under the 100/day free-tier
ceiling (worst case 60/day at HIGH). Resend cost = **$0/mo** across the board.

- Gateway fee (2.5% of $850 MRR): **$21.25/mo**

**MED-case variable total:** $7.00 (WhatsApp) + $0.00 (email) + $21.25 (gateway) = **$28.25/mo**

**Fixed costs**

| Item | $/mo |
|---|---|
| Supabase Pro | $25.00 |
| Cloudflare Pro | $20.00 |
| Apple Developer ($99/yr ÷ 12) | $8.25 |
| Domain (~$15/yr ÷ 12) | $1.25 |
| Anthropic (AI import + help chat) | $5.00 |
| Resend | $0.00 |
| **Total fixed** | **$59.50/mo** |

**P&L (MED case)**

| Line | $/mo |
|---|---|
| Revenue | $850.00 |
| − Variable costs | $28.25 |
| **Gross profit** | **$821.75** |
| Gross margin | **96.68%** |
| − Fixed costs | $59.50 |
| **Net profit** | **$762.25/mo** |
| Net margin | **89.68%** |
| Net $/building | $76.23/mo |

---

## Scenario B — 20 buildings × 20 units (400 units)

**Revenue**
- MRR: 20 × $85.00 = **$1,700.00/mo**
- Annualized run-rate: **$20,400/yr**
- If all 20 on annual billing (20 × $850): **$17,000/yr**

**Variable costs**

| Line | LOW (2.5) | MED (5) — headline | HIGH (9) |
|---|---|---|---|
| WhatsApp: 400 units × events × 0.5 × $0.014 | 400×2.5×0.5×0.014 = **$7.00** | 400×5×0.5×0.014 = **$14.00** | 400×9×0.5×0.014 = **$25.20** |
| Email volume: 400×events÷30 | 33.3/day | 66.7/day | **120.0/day** |
| Resend tier | Free | Free | **Pro — free tier breached** |

The free-tier break point in building count, at each sensitivity, is
`buildings = 150 ÷ events/unit/mo` (derived from `20×buildings×events/30 = 100`):
LOW → 60 buildings, MED → 30 buildings, HIGH → **16.7 buildings**. Scenario B's
20 buildings sits *below* the MED and LOW thresholds (free) but *above* the
HIGH threshold — so at high notification frequency, Resend Pro ($20/mo) is
already needed at this scale, even though it is not needed at the MED
headline case.

- Gateway fee (2.5% of $1,700 MRR): **$42.50/mo**

**MED-case variable total:** $14.00 (WhatsApp) + $0.00 (email, still free) + $42.50 (gateway) = **$56.50/mo**

**Fixed costs**

| Item | $/mo |
|---|---|
| Supabase Pro | $25.00 |
| Cloudflare Pro | $20.00 |
| Apple Developer | $8.25 |
| Domain | $1.25 |
| Anthropic | $8.00 |
| Resend (MED case) | $0.00 |
| **Total fixed (MED)** | **$62.50/mo** |

*Sensitivity note: at HIGH notification frequency, add Resend Pro → fixed
costs rise to $82.50/mo.*

**P&L (MED case)**

| Line | $/mo |
|---|---|
| Revenue | $1,700.00 |
| − Variable costs | $56.50 |
| **Gross profit** | **$1,643.50** |
| Gross margin | **96.68%** |
| − Fixed costs | $62.50 |
| **Net profit** | **$1,581.00/mo** |
| Net margin | **93.00%** |
| Net $/building | $79.05/mo |

---

## Scenario C — 100 buildings × 20 units (2,000 units)

**Revenue**
- MRR: 100 × $85.00 = **$8,500.00/mo**
- Annualized run-rate: **$102,000/yr**
- If all 100 on annual billing (100 × $850): **$85,000/yr**

**Variable costs**

| Line | LOW (2.5) | MED (5) — headline | HIGH (9) |
|---|---|---|---|
| WhatsApp: 2,000 units × events × 0.5 × $0.014 | 2000×2.5×0.5×0.014 = **$35.00** | 2000×5×0.5×0.014 = **$70.00** | 2000×9×0.5×0.014 = **$126.00** |
| Email volume: 2,000×events÷30 | **166.7/day** | **333.3/day** | **600.0/day** |
| Resend tier | **Pro (required)** | **Pro (required)** | **Pro (required)** |

100 buildings is past every sensitivity's free-tier threshold (60 / 30 / 16.7
buildings for LOW/MED/HIGH) — Resend Pro at **$20/mo** is required regardless
of notification frequency at this scale.

- Gateway fee (2.5% of $8,500 MRR): **$212.50/mo**

**MED-case variable total:** $70.00 (WhatsApp) + $20.00 (email, Pro) + $212.50 (gateway) = **$302.50/mo**

**Fixed costs**

| Item | $/mo |
|---|---|
| Supabase Pro | $25.00 |
| Cloudflare Pro | $20.00 |
| Apple Developer | $8.25 |
| Domain | $1.25 |
| Anthropic | $15.00 |
| Resend Pro | $20.00 |
| **Total fixed** | **$89.50/mo** |

*Caveat: 2,000 units of transactional data and storage may approach Supabase
Pro plan ceilings (DB size, MAU) sooner than at A or B — this model holds
Supabase at $25/mo per the task's instruction, but Scenario C is the one
where that line should be re-checked against actual Supabase usage once real
data exists.*

**P&L (MED case)**

| Line | $/mo |
|---|---|
| Revenue | $8,500.00 |
| − Variable costs | $302.50 |
| **Gross profit** | **$8,197.50** |
| Gross margin | **96.44%** |
| − Fixed costs | $89.50 |
| **Net profit** | **$8,108.00/mo** |
| Net margin | **95.39%** |
| Net $/building | $81.08/mo |

---

## Side-by-side comparison (MED case, headline)

| | **A: 10 bldgs (200 units)** | **B: 20 bldgs (400 units)** | **C: 100 bldgs (2,000 units)** |
|---|---|---|---|
| MRR | $850.00 | $1,700.00 | $8,500.00 |
| Annualized run-rate | $10,200 | $20,400 | $102,000 |
| WhatsApp (MED) | $7.00 | $14.00 | $70.00 |
| Email volume/day (MED) | 33.3 | 66.7 | 333.3 |
| Resend tier | Free | Free | **Pro ($20/mo)** |
| Gateway fee (2.5%) | $21.25 | $42.50 | $212.50 |
| **Total variable cost** | **$28.25** | **$56.50** | **$302.50** |
| **Total fixed cost** | **$59.50** | **$62.50** | **$89.50** |
| **Total cost** | $87.75 | $119.00 | $392.00 |
| **Gross margin** | 96.68% | 96.68% | 96.44% |
| **Net profit/mo** | **$762.25** | **$1,581.00** | **$8,108.00** |
| **Net margin** | 89.68% | 93.00% | 95.39% |
| **Net $/building/mo** | $76.23 | $79.05 | $81.08 |
| Break-even (buildings) | already past it (see below) | already past it | already past it |

**Break-even, worked:** contribution margin per building (MED case) =
$85.00 revenue − WhatsApp/building ($0.70: 20×5×0.5×0.014) − gateway/building
($2.125: 85×0.025) = **$82.175/building/mo**. Fixed costs at the smallest
scale are $59.50/mo. Break-even building count = $59.50 ÷ $82.175 = **0.72**,
which rounds up to **1 building** — the model's fixed infrastructure cost is
covered by a single paying customer. Break-even is not the binding constraint
at any of these three scales; CAC payback and absolute deal flow are.

**LTV:CAC (brief):** lifetime gross contribution per building = $82.175/mo ÷
3% monthly churn = **$2,739/building**. Against $100 CAC, that is
**≈27:1** — comfortably above the 3:1 rule-of-thumb SaaS benchmark. This
line is illustrative only: 3% churn and $100 CAC are both prior-brief
assumptions, not yet observed data.

---

## What the three scales reveal

Abniyah is profitable from its very first paying building under this cost
model — the fixed cost base (~$60–90/mo) is small enough that break-even
happens below 1 building, so the real story across these scenarios is margin
**expansion**, not margin arrival: net margin climbs from 89.7% at 10
buildings to 93.0% at 20 to 95.4% at 100, because Supabase, Cloudflare,
Apple, and the domain don't grow with building count while revenue does.
**Gateway fees and WhatsApp both scale exactly linearly with buildings** (10×
buildings = 10× cost, at every sensitivity), which makes them predictable but
not the interesting line; **WhatsApp is the most volatile cost** because it is
double-multiplied by two assumptions that could each move independently —
notification frequency (2.5→9 is a 3.6× swing within one scenario) and
opt-in rate (modeled flat at 50% but not yet observed) — so it deserves the
closest post-launch monitoring even though its dollar value stays small at
these scales. **Email is a cliff, not a slope**: it costs $0 until the
building count crosses `150 ÷ events-per-unit` (30 buildings at the MED
case, as low as 17 at HIGH), then jumps a discrete $20/mo — Scenario B is the
one where that cliff is closest, and a busier-than-modeled building mix could
trip it before 20 buildings are even signed. Net $/building rises gently
across scale ($76 → $79 → $81) rather than dramatically, which says the
model's real leverage is customer count, not per-customer economics — get to
100 buildings and the absolute number ($8,108/mo net) is what changes,
not the shape of the unit economics.

---

## Flags for Jey

- **Domain renewal cost is an estimate** (~$15/yr). `docs/DEPENDENCIES.md`
  has this line marked "fill in / correct" — worth confirming the actual
  registrar and renewal date so this model (and the backups/DR checklist)
  isn't running on a guess.
- **The 2.5% gateway fee is not live.** Whish keys are pending approval and
  Areeba's merchant account isn't opened (`WHISH_*` / `AREEBA_*` marked "NOT
  YET SET" in `DEPENDENCIES.md`). Every dollar figure above that includes the
  gateway line is the **post-launch** state, not today's.
- **Anthropic and Cloudflare figures are point estimates**, not measured
  usage — flag if real invoices come in materially different, especially
  Cloudflare (I used $20, the low end of the stated $20–25 range).
- **Supabase Pro may not hold at 2,000 units** without validation — that's
  the one line in Scenario C worth re-checking against real DB size/MAU
  numbers rather than assuming the same $25/mo that works at 200 units.
