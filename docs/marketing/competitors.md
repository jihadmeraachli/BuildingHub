# Competitors: what they charge, how they position, where we lose

> **Actioned, 2026-08-20.** The pricing argument in the last section was
> accepted and shipped as migration **0100**: Abniyah now charges one monthly
> price per building size ($85 up to 20 units, rising to $480 at 500, agreed
> individually above that) instead of a flat $5 per unit. The figures in the
> "What this means" section below are the ones that made the case, and are kept
> as the record of it. Everything about the competitors themselves still stands.

Researched August 2026. Three profiles, chosen for how directly they compete
for the same buyer: one Lebanese, one regional Arabic, one international
benchmark that publishes its prices in full. Every figure below is quoted from
a page I actually opened, and the URL is given. Where a company does not
publish pricing, that is stated as a fact rather than filled in with a guess.

The last section is the part worth reading twice. It argues that our pricing
has a structural problem, not a positioning problem.

---

## 1. Binayati (Beirut, Lebanon)

**Who it is for.** Building treasurers, committees, landlords and facility
managers running residential or commercial buildings. It describes itself as
"for owners, tenants, and co-managers." This is the same buyer we are selling
to, in the same country, in the same building.

**How it positions.** "The best property management app in Lebanon" and "your
digital building assistant." The pitch is fee collection and transparency: the
treasurer sends invoices and payment reminders, and residents see the building's
financial reports online. It leads with the app, not with accounting.

**Pricing.** **Not published.** Both the product page and the page titled
"Binayati Pricing Plans" carry only "Get Your Free Trial Now" and "Request for a
Quotation Now." A 15-day free trial is advertised. The iOS app itself is listed
as Free with no in-app purchases, which means the money is collected outside the
store, from the building rather than the resident.

**What it claims to do.** Invoices and receipts with automated delivery, email
and SMS payment reminders, online financial reports, expense management and
budgeting, committee meeting tools, bulk invoicing, credit notes, and
**multi-currency support**. Listed languages: **English, Arabic and French.**

**Footprint — smaller than "since 2018" suggests.** Google Play shows
**1,000+ installs**, first released May 2018, last updated July 2026, by
OURJOUWAN.COM of Bauchrieh. The US App Store storefront shows 4.2 stars from 5
ratings. Neither number is a clean read on the Lebanese install base, but
1,000+ Android installs after seven years is a real ceiling, not a rounding
artefact: this is an incumbent by tenure, not by scale.

**Where Abniyah is stronger.**
- **The ledger model.** Compound to block to unit, with a charge carrying its
  block so the compound book and each block slice reconcile to the same figure.
  Binayati's public material describes invoicing and reports, not a
  double-entry-grade book with opening balances, credit notes, waivers,
  write-offs and non-destructive voiding.
- **Owner and tenant as separate sub-ledgers**, with obligations that follow the
  right party and settle to the owner when a tenant leaves. Nothing in their
  public material suggests this exists.
- **Generator and water metering.** Stock in, fuel bought, readings per unit and
  common areas, average unit cost, pro-rata common share, posted as one expense
  with per-unit charges and a retained audit trail. This is the single most
  Lebanese feature we have and it appears on no competitor page I read.
- **Privacy enforced in the database.** A resident cannot see a neighbor's unit
  issues or balances because row-level security says so, not because a screen
  hides it.

**Where Abniyah is weaker.**
- **French.** They ship it, we do not. A large slice of Lebanese syndics,
  notaries and older committee members work in French. This is a real product
  gap, not a copy problem, and it is the one competitor feature I would take
  most seriously.
- ~~**Payment collection.**~~ **CLAIM DOES NOT HOLD (checked 2026-08-20).**
  This was written up as their biggest advantage over us. It is not real.

  Their own **Google Play Data safety declaration** says the app collects
  "Location, Personal info, and Device or other IDs" and — decisively — **"No
  data shared with third parties."** Google's form has explicit categories for
  Financial info, User payment info and Purchase history. They declare none of
  them. The **App Store privacy labels** agree: Contact Info only. Their
  Android permissions are camera and network, nothing payment-related.

  You cannot route a payment through a gateway without sharing data with a
  third party, so "no third-party sharing" and "we process payments" cannot
  both be true. These are self-reported declarations to Apple and Google, not
  marketing copy.

  It also fits everything else: their site says "integration with leading
  online payment gateways" and **never names one** (PayHOA names Stripe, ADDA
  names Noqodi — a real integration is a trust signal), and their App Store
  feature list is administrative: "Manage Payments", "Partial payment for
  expenses", which is a treasurer recording what came in. Exactly what we do.

  **So we are level on collection, not behind.** When Whish ships we are ahead
  of the only local competitor, on the buyer's number one pain.

  Worth knowing for when someone else tries it: in Lebanon a card gateway
  (Areeba, NetCommerce) would be close to useless for building dues. Card
  penetration collapsed after 2019 and committees are paid in cash, through OMT
  or through Whish. Whish is the right integration for this market, not the
  cheap one.
- **Time in market.** They have years of shipped versions, an App Store
  presence, and presumably reference buildings. We have a private beta.
- **Multi-currency.** They claim it. We should not assume our USD/LBP handling
  is unique until somebody checks what theirs actually does.

**Action worth taking this week.** The app is free to download. Install
Binayati, run a building through it, and answer two questions in one sitting:

1. **Does it freeze the exchange rate on each transaction, or re-convert
   history when the rate changes?** If it re-converts, our LBP story is a
   genuine wedge and should lead every ad. If it freezes, the wedge moves to
   metering, which no competitor in this research advertises at all.
2. ~~Can a resident actually pay through the app?~~ **Answered without
   installing anything**: no. Their own Play and App Store data declarations
   report no financial or payment data and no third-party sharing. See above.

So the install is now about the currency question alone, which is still worth
an hour because it decides the campaign's lead message.

Sources:
[binayati.com product](https://www.binayati.com/property-management-application/) ·
[binayati.com pricing](https://www.binayati.com/binayati-price/) ·
[App Store listing](https://apps.apple.com/us/app/binayati/id1378048412)

---

## 2. ADDA (adda.ae, UAE and India)

**Who it is for.** Professional operators at scale: Owners Association
Management companies, community managers, rental and property managers, and
developers, across high-rise towers and villa communities. Not a committee
running one building. This is the enterprise end of our market and the shape
our org-admin and compound features were built for.

**How it positions.** "UAE's Most Loved Property Management Platform," with
regulatory compliance as the wedge: first software to integrate with Dubai's
MOLLAK platform, VAT-ready accounting, auditable transactions, and a
portfolio-first architecture. The claim is that it is UAE-regulation-native
rather than a global system adapted after the fact. That is precisely the claim
we make about Lebanon, aimed at a different regulator.

They publish scale numbers prominently: 2.1M active users, 1.78M households,
5.45M helpdesk requests resolved. Whether those are UAE or global (the company
has a large India business) is not stated on the page.

**Pricing.** **Not published on adda.ae.** The site routes to "Start Your Free
Trial" and a sales contact form. Third-party software directories list ADDA's
India product from **₹12 per unit per month** (roughly $0.14), customized by
society size and modules. Treat that as an indicator of the India price ladder,
not of a UAE quote, and note that it comes from a review aggregator rather than
from ADDA.

**Where Abniyah is stronger.**
- **Lebanon fit.** MOLLAK compliance is worth nothing in Beirut. Dual-currency
  entry with a per-transaction frozen rate, generator metering, and a natour
  role that can touch issues but never money are worth a great deal.
- **Sold to a committee, not to a management company.** ADDA's product,
  onboarding and pricing all assume a professional operator with a portfolio.
  Most Lebanese buildings do not have one.
- **Self-serve.** Register, create a building, start a 30-day trial with no
  card. ADDA gates everything behind a sales conversation.

**Where Abniyah is weaker.**
- **Everything that comes with scale**: integrations (SAP, Oracle, Dynamics,
  Salesforce, Yardi), a payments partner (Noqodi), visitor access and amenity
  booking, a published customer roster, and the credibility of large numbers on
  a homepage.
- **Regulatory anchor.** MOLLAK forces UAE buildings onto compliant software.
  Lebanon has no equivalent forcing function, which means our sale is always a
  discretionary spend. That is a market condition, not a product flaw, but it
  shapes everything: we have to be worth buying, not merely required.

Sources: [adda.ae](https://adda.ae/) ·
[third-party pricing listing](https://www.saascounter.com/products/apartment-adda)

---

## 3. PayHOA (United States)

Included because it is the closest international analog to our actual buyer (a
self-managed owners' association with no professional manager) **and** because
it publishes its full price list, which almost nobody else in this category
does. It is the only clean pricing benchmark I found.

**Who it is for.** Self-managed HOAs and community associations, plus a
separate track for management companies.

**How it positions.** Straightforward self-service software for boards that do
not want to hire a management company. No long-term contracts, no cancellation
fees, switch billing frequency any time. The positioning is essentially "you can
do this yourself, cheaply."

**Pricing (published in full, USD).**

| Units | Monthly billing | Annual billing (per month) | Effective per unit, annual |
|---|---|---|---|
| 0–25 | $54 | $49 | $1.96 at 25 units |
| 26–50 | $65 | $59 | $1.18 at 50 units |
| 51–100 | $109 | $99 | $0.99 at 100 units |
| 101–150 | $142 | $129 | $0.86 at 150 units |
| 151–200 | $186 | $169 | $0.85 at 200 units |
| 201–300 | $219 | $199 | $0.66 at 300 units |
| 301–400 | $252 | $229 | $0.57 at 400 units |
| 401–500 | $275 | $249 | $0.50 at 500 units |
| 500+ | $0.55 per unit | ($275 monthly minimum) | $0.55 |

**Where Abniyah is stronger.** Arabic and RTL (PayHOA is English only), dual
currency, metering, the compound and block model, owner and tenant sub-ledgers,
and a product designed around a building that has a natour and a generator
rather than a lawn and a pool.

**Where Abniyah is weaker.** Price, by a factor of five to nine at any building
above fifty units. See below. Also: PayHOA takes payments, we do not.

Source: [payhoa.com/pricing](https://www.payhoa.com/pricing/)

---

## Also checked, not profiled

- **Syndic Digital / SyndicPro** (VME International): "the #1 Property
  Management Software for the Francophone Market," live in Tunisia, rolling out
  in Morocco, targeting Morocco, France, Belgium and Algeria. Free Starter plan
  for one building, professional plans on request, **no published prices**. The
  closest competitor in shape (co-ownership, syndic, Arab world) and the most
  likely to enter Lebanon, because Lebanon is the obvious next francophone
  market after the Maghreb. Worth watching.
  [syndic.digital](https://www.syndic.digital/en/)
- **Condo Control**: the best-known condo/HOA product internationally. Its own
  pricing page shows tiers by unit band (0–99 up to 500+) but **no prices**, only
  "get a custom quote." Third-party review sites cite a $49/month starting
  point, which is not the same as a published price and should not be quoted as
  one. [condocontrol.com/pricing](http://www.condocontrol.com/pricing/)
- **Buildium**: publishes plan prices (Essential from $62/month, Growth from
  $192/month, Premium from $400/month, USD) but is a US rental-portfolio tool,
  not a committee tool, and charges extra per e-signature and per screening.
  Useful only as an upper price anchor.
  [buildium.com/pricing](https://www.buildium.com/pricing/)
- **Regional per-unit anchors**: a Saudi comparison guide quotes Yarn Cloud from
  **SAR 10.99 per unit per month** (about $2.93) at its Lite tier, and AppFolio
  at **$1.40 to $3.00 per unit per month plus onboarding**.
  [yarn.com.sa comparison](https://yarn.com.sa/resources/pms-comparison/)

---

## What this means for our pricing and positioning

### The uncomfortable part: $5 per unit is high, and the shape is wrong

We charge $5 per unit per month, $50 per unit per year, flat, with no volume
break (`landing.faq.price`). Set against everything I could find:

| | Effective cost, 100-unit building | Effective cost, 300-unit compound |
|---|---|---|
| **Abniyah** (annual) | **$417/mo** | **$1,250/mo** |
| PayHOA (annual) | $99/mo | $199/mo |
| Yarn Cloud Lite (SAR 10.99/unit) | ~$293/mo | ~$879/mo |
| AppFolio (mid of published band) | ~$220/mo | ~$660/mo |

Two separate problems sit in that table.

**One: the absolute level.** We are the most expensive option in every
comparison I could build, in the poorest market any of these products serve. A
40-unit Beirut building pays us $2,000 a year. That number has to be defended in
a committee meeting, out loud, by the person who proposed it.

**Two, and worse: the shape.** Flat per-unit pricing means the price rises
linearly forever while our cost to serve does not. Every competitor tapers.
PayHOA falls from $1.96 to $0.55 per unit as a community grows; we charge the
same $5 at 500 units as at 5. The buildings we most want (compounds, management
companies with portfolios) are exactly the ones our price list punishes hardest.
A 250-unit compound sees $15,000 a year and stops reading.

**My recommendation.** Keep $5 as the headline for small buildings, where it is
defensible and where the comparison to PayHOA is closest ($5 x 20 units = $100
against their $49, roughly double for a product that speaks Arabic and handles
lira). Then add bands above it, so the price stops being linear:

- 1 to 30 units: $5 per unit per month
- 31 to 100 units: $3.50
- 101 to 250 units: $2.50
- 251+ units: $1.75, or a negotiated compound rate

That keeps the simple story on the landing page ("from $5 per unit"), stops the
compound sale dying on arithmetic, and puts us in the same neighborhood as the
regional per-unit benchmarks at the sizes where we are competing for real money.
The trade-off is that "simple, per-unit pricing" stops being literally true, and
a pricing table with four rows is a harder page to write than one number. I
think that is a cheap price for not losing every large customer at the quote.

This is a business decision, not a marketing one, so it is yours. But the copy I
write for compounds will be dishonest by omission until it is resolved: I would
be selling a portfolio product on a price list that is worst-in-market for
portfolios.

### Where the positioning is genuinely strong

Three things survive contact with every competitor page I read, and they are
what the launch should say, in this order:

1. **Lira and dollar, handled the way a Lebanese building actually keeps books.**
   One canonical figure, the rate frozen on each entry, so today's rate never
   rewrites last year's records. Generic property software converts and moves
   on. (Verify against Binayati first, per the action item above.)
2. **The generator and the water, metered and settled fairly.** Readings, stock,
   average unit cost, pro-rata common areas, posted as a real expense with a
   retained audit trail. Nobody else in this research advertises it. In Lebanon
   the generator bill is the single most argued-about number in the building.
3. **Arabic that was not translated.** Full RTL, per-person language, in a
   category where the international products are English-only and the regional
   ones treat Arabic as a language pack. ADDA is the only one that takes
   bilingual seriously, and it is not selling here.

Note what is not on that list: "all-in-one," "easy to use," and "transparency
for residents." Every competitor says all three. They are table stakes and they
win nothing.

### Where we are genuinely behind, and what it costs us

- **We cannot take money yet — but neither can Binayati.** ADDA genuinely has a
  payments partner (Noqodi), and ADDA does not sell here. Binayati's claim does
  not survive their own store declarations (see above). So on the buyer's
  number one pain we are LEVEL with the local competition today, and ahead of
  it the day Whish ships. Until then, `landing.faq.payments` already says the
  honest thing: management records payments and residents see them instantly.
- **No French.** Binayati has it. For a slice of this market that is
  disqualifying before the demo starts.
- **No proof.** No named customer, no logo, no number, no review. Everyone else
  has some. The fix is not copy: it is three beta buildings willing to be quoted
  by first name and building type after their first successful monthly close.
  Ask for that permission at the start of the beta, not at the end.
- **No forcing function.** MOLLAK makes ADDA's sale for it in Dubai. Nothing
  makes ours in Beirut. Every dollar we charge is discretionary spend by a
  committee that has survived without software for decades.

### One thing to stop doing

Do not benchmark against Buildium, AppFolio or Yardi in any public copy. They
are rental-portfolio tools for landlords, we are a committee tool for buildings,
and inviting the comparison puts us next to products with payment processing,
screening and accounting integrations we do not have. Our comparison set is
Binayati, and increasingly Syndic Digital. That is the fight worth naming.
