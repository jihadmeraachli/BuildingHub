# Four-week launch content calendar

Written August 2026, for the run-up to and out of private beta. Twelve posts
plus a weekly WhatsApp status, three touches a week, which is what one person
can actually sustain while also running a beta.

Read the **Dependencies** section before scheduling anything. Several posts
below are blocked on things that do not exist yet, and I have marked each one
rather than writing around it.

---

## The channels, and why

| Platform | Lebanon reach (late 2025) | Verdict |
|---|---|---|
| Facebook | 3.45M users, 58.9% of population | **Yes, primary.** The committee treasurer is 45 to 65 and lives here. Also the only one of the three with usable groups. |
| Instagram | 2.95M users, 50.3% | **Yes, primary.** Reels carry the teaser, Stories carry the day-to-day. The younger owner and the tenant are here. |
| WhatsApp status | not reported by DataReportal | **Yes, but understand what it is.** Not a broadcast channel: it reaches your contacts, and your contacts are Lebanese building people. It is a warm channel, not a reach channel, and it is where a committee member forwards you to another committee member. That forward is the actual mechanism. |
| TikTok | 4.58M users aged 18+ | **Post the reel, build nothing.** Biggest reach in the country by a distance and the vertical assets already exist, so the marginal cost of cross-posting is ten minutes. But the buyer is a committee treasurer, not a 22-year-old, so do not spend a single extra hour producing for it. |
| LinkedIn | 1.40M members, 23.9% | **Yes, for one audience only.** Smallest reach, highest value: property-management companies and org buyers, who are the customers that make the per-unit price work. One post a week from the Tatawwor page, not a content program. |

So: your three are right, with TikTok as free cross-posting and LinkedIn as a
narrow B2B lane. Figures from
[DataReportal, Digital 2026: Lebanon](https://datareportal.com/reports/digital-2026-lebanon).

**One thing that is not a channel but should be.** The buildings themselves run
on WhatsApp groups. You cannot post into someone else's building group without
being a member and it would be spam if you could. What you can do is make every
asset forwardable: square or vertical, legible at thumbnail size, and carrying
the name and a phone number in the frame, so when one committee member sends it
to another it survives the trip with no caption.

---

## Dependencies (things that do not exist yet)

These gate the calendar. Ranked by how much they hurt.

1. **There is no destination.** `VITE_BETA_GATE` puts abniyah.com and the demo
   behind a passcode, and `index.html` still carries `noindex, nofollow`. Nothing
   in weeks 1 to 3 can say "visit the site." Every CTA below is a DM or a
   WhatsApp message instead. **This is fine for a teaser and fatal for week 4.**
2. **There is no waitlist form.** So interest has nowhere to land except your
   inbox, and you have no way to count it. Two options: (a) build a waitlist
   form outside the gate (a product ask: one email field, writes to a table,
   nothing else), or (b) use a `wa.me` click-to-chat link as the CTA and handle
   it by hand. **I would do (b) for weeks 1 to 2 and (a) before week 3**, because
   by week 3 you will be losing people you cannot follow up with.
3. **There is no public WhatsApp number.** HANDOFF lists the dedicated WhatsApp
   number as still being sourced. A `wa.me` CTA needs a number today. Decide
   whether it is a temporary personal or Tatawwor business number, because
   every post below points at it.
4. **The Instagram, Facebook, TikTok and LinkedIn accounts.** I could not verify
   from the repo that any of these exist. If they do not, that is a day of setup
   (handles, bios in both languages, profile art, a Meta Business account, and a
   Facebook page linked to Instagram) and it has to happen before week 1.
5. **The reel backgrounds have no recorded license.** The reel file says
   "licensed stock, embedded in this file." `assets/marketing/MANIFEST.md` says
   "Nothing licensed yet." Both cannot be true. The three images in
   `assets/marketing/originals/` are about to become the first thing the public
   sees of Abniyah, and if any of them is an unlicensed preview that is a
   problem the moment a post is boosted. **Resolve and record it in MANIFEST.md
   before week 1**, or replace the backgrounds with the Beirut shoot the reel
   file itself recommends.
6. **No proof points.** No customer, no quote, no number. Nothing in this
   calendar invents one. Week 3 is where their absence is most visible, and the
   fix is to ask three beta buildings, at the start of their beta, for
   permission to quote them by first name and building type after their first
   monthly close.
7. **Screen recordings.** Most of weeks 2 and 3 need video of the product, and
   only four still screenshots exist (`public/marketing/`). The good news: the
   **demo building (Tulip) is seeded with fictional residents**, so you can
   record it freely with no privacy problem. Budget half a day to capture eight
   to ten short clips in one sitting, in both languages, and the whole month is
   covered.

---

## Before week 1: a one-time setup list

- Accounts live, bios written in Arabic and English, one `wa.me` link in each bio
- MANIFEST.md updated with the reel background licenses (dependency 5)
- The reel exported from `assets/marketing/reel-final/index.html` via
  `scripts/bake-reel.mjs`, in both languages, in 1:1 and 9:16
- A screen-recording session on the demo building: dashboard, recording an
  expense and watching it split across units, the LBP entry box, a metering
  cycle, the custom report filtering, the resident view of a balance
- Decide the handle: one account posting in both languages (recommended, since
  the audience is bilingual and two accounts halves your reach), with Arabic
  first in the caption and English below

---

## Week 1: say the problem, do not sell

**Goal:** followers, saves, and DMs. Not signups. There is nowhere to sign up.
**CTA on every post:** "Message us and we'll show you." (`wa.me` link in bio.)

### Post 1 · Monday · Instagram Reel + Facebook + WhatsApp status + TikTok
**Format:** the existing teaser reel, Arabic version, 1:1 for status and 9:16 for
Reels.
**Asset:** `assets/marketing/reel-final/` baked out. Exists.
**Copy (caption):**

> وين راحت الفاتورة؟ كم صرف المبنى السنة الماضية؟ ومين بيرد عالجروب؟
>
> ثلاث أسئلة بتتكرر بكل مبنى بلبنان. عم نبني شي يجاوب عليها.
>
> أبنية · إدارة المباني، مصمّمة للبنان. قريباً.
>
> Where did the receipt go? How much did the building spend last year? Getting
> the committee in one room is the hard part. Three questions every building in
> Lebanon asks. We are building the answer.

Note the caption reuses the reel's own Lebanese dialect for the questions and
switches to MSA for the explanation. Keep that split everywhere: dialect for the
hook, MSA for the substance. It is how people actually talk about this.

### Post 2 · Wednesday · Instagram carousel + Facebook
**Format:** three-card carousel, one problem per card, same visual treatment as
the reel (desaturated, teal-tinted, darkened top and bottom).
**Asset:** NEW. Three stills, which can be pulled from the reel frames if the
license question (dependency 5) resolves in your favor.
**Brief:** Card 1: "الوصل ضاع" / the receipt is gone. Card 2: "الحساب مش
مضبوط" / the numbers do not add up. Card 3: "كل شي بالجروب" / everything lives
in the WhatsApp group. Card 4 (the turn): the Abniyah mark and one line, "بدنا
نخلص من هالثلاثة" / "We are getting rid of all three."
**Caption:** ask a question and mean it: "شو أكتر شي بيوجع براس لجنة المبنى؟
جاوبونا." ("What is the biggest headache for a building committee? Tell us.")
Replies are your first research and your first warm list.

### Post 3 · Friday · WhatsApp status + Instagram story
**Format:** plain text on brand background, ten seconds.
**Asset:** trivial, make in Canva or as an HTML frame.
**Copy:** "عم نجرّب أبنية مع عدد محدود من المباني بالبيتا. إذا بتحب مبناك يكون
منهن، إبعتلي رسالة." ("We are running Abniyah with a small number of buildings
in beta. If you want yours to be one of them, message me.")
This is the single highest-converting thing you will post all month, because it
goes to people who already know you.

---

## Week 2: show that it is real, one feature at a time

**Goal:** move from "nice idea" to "that is actually built." Still DM-based.
**By the end of this week you want the waitlist form live** (dependency 2).

### Post 4 · Monday · Instagram Reel + Facebook
**Format:** 20 to 30 second screen recording. Record an expense once, watch it
split across every unit by share, open one unit and see the charge.
**Asset:** NEW screen recording from the demo building.
**Copy:**

> سجّل المصروف مرة وحدة. أبنية بيوزعه على الوحدات حسب حصصها، وبيحدّث كل رصيد.
> المالك بيشوف شو عليه، واللجنة بتشوف مين دفع ومين لأ.
>
> Record the expense once. Abniyah splits it across the units by their shares
> and updates every balance. The owner sees what they owe. The committee sees
> who has paid.

### Post 5 · Wednesday · Instagram Reel + Facebook + WhatsApp status + TikTok
**Format:** 20 second screen recording of the dual-currency entry: type an
amount in dollars, type it in lira, show the rate being logged on that entry,
then change the building's rate and show that last month's records did not move.
**Asset:** NEW screen recording.
**Why this one gets the best slot:** it is the clearest thing we do that generic
property software gets wrong, and every Lebanese viewer understands the pain
instantly without explanation.
**Copy:**

> بتسجّل بالدولار أو بالليرة. سعر الصرف بينحفظ على القيد نفسه، فلما يتغير السعر،
> حسابات السنة الماضية بتضل متل ما هي.
>
> Enter in dollars or in lira. The rate is frozen on that entry, so when the
> rate changes, last year's records stay exactly as they were.

### Post 6 · Friday · LinkedIn (Tatawwor page) + Facebook
**Format:** text post, 150 to 200 words, no image needed (or one screenshot).
**Asset:** `public/marketing/shot-finance-en.jpg`. Exists.
**Brief:** written for the management-company buyer, not the committee. The
angle: one account covers a compound, its blocks and every unit, and a unit's
balance is the same figure whether you look at it from the block or the
compound. Mention org-level access and role separation (the natour can handle
issues and never touches money). Close with "we are taking a small number of
portfolios into beta."

---

## Week 3: the generator, and the receipts

**Goal:** the strongest differentiator, plus the first credibility signals.
**Needs the waitlist form live.** Also the week the gate should come down.

### Post 7 · Monday · Instagram Reel + Facebook + WhatsApp status + TikTok
**Format:** 30 second screen recording of a metering cycle: stock in, fuel
bought, readings per unit and common areas, the average unit cost, the pro-rata
common share, and the finished expense with a charge on every unit.
**Asset:** NEW screen recording.
**Copy:**

> فاتورة المولّد هي أكتر رقم بينحاكى فيه بالمبنى. أبنية بيحسبها من القراءات:
> المخزون، الكمية المشتراة، عدّاد كل وحدة، وحصة المشتركات بالتناسب. وكل الحساب
> بيضل محفوظ، فمين ما سأل بيشوفه.
>
> The generator bill is the most argued-about number in the building. Abniyah
> works it out from the readings: stock, fuel bought, each unit's meter, and the
> common share pro rata. The whole calculation stays on file, so anyone who asks
> can see it.

This is the post to put money behind if you boost anything this month.

### Post 8 · Wednesday · Instagram carousel + Facebook
**Format:** four cards on transparency, from the resident's side.
**Asset:** `shot-dashboard-ar.jpg` exists; the rest NEW from the demo.
**Brief:** Card 1: the resident opens the app and sees their balance. Card 2:
they see the building's expenses. Card 3: they report a leak with a photo. Card
4: their neighbor's apartment issues are not visible to them, because access is
enforced in the database, not hidden on a screen. That fourth card is the one
that earns respect from a committee that has been burned before.

### Post 9 · Friday · Instagram story series + WhatsApp status
**Format:** three or four story frames, face to camera if you are willing.
**Asset:** NEW, phone camera is fine and reads as more honest than a produced
video.
**Brief:** Jey, in Arabic, saying plainly: what we built, why we built it for
Lebanon specifically, and that a small number of buildings are in beta now.
**Blocked on:** nothing. This is the one piece of proof you can create today
without a customer.
**Flag:** the obvious alternative, a customer quote, does not exist yet and
should not be faked. If one beta building will go on record by the end of week 3,
this slot becomes theirs and is worth ten of anything else in this calendar.

---

## Week 4: open the door

**Everything this week is blocked on the launch checklist** in HANDOFF section
9: drop `VITE_BETA_GATE`, remove the `noindex` meta tag, flip `robots.txt` to
`Allow: /`. If that has not happened, run week 4 as a repeat of week 1's teaser
with a firm date, and move this week to whenever the gate lifts. Do not post a
CTA that lands on a passcode screen.

### Post 10 · Monday · Instagram Reel + Facebook + WhatsApp status + TikTok + LinkedIn
**Format:** the teaser reel, re-cut: same three struck-through problems, but the
final frame becomes "متوفّر الآن" / "Available now" with the URL.
**Asset:** the reel with one frame changed. Cheap, and it closes the loop for
everyone who saw week 1.
**Copy:**

> أبنية صار متوفّر. جرّبه ثلاثين يوم مجاناً، بلا بطاقة دفع.
> abniyah.com
>
> Abniyah is live. 30 days free, no card required.

### Post 11 · Wednesday · Instagram + Facebook + WhatsApp status
**Format:** single image or 15 second clip pointing at the **live demo**.
**Asset:** screen recording of the demo persona chooser and the first screen
behind it.
**Why:** the demo is the strongest asset we have. Two personas, a fully
populated building, no signup. It answers "will this fit my building" in thirty
seconds, which no amount of copy does.
**Copy:**

> فرجيك قبل ما تسجّل. ادخل عالتجربة الحيّة وشوف مبنى كامل شغّال: الحسابات،
> الأعطال، الاجتماعات، وكشف حساب المالك.
>
> See it before you sign up. Open the live demo and walk through a complete,
> working building.

### Post 12 · Friday · Instagram carousel + Facebook + LinkedIn
**Format:** the "how it works in three steps" carousel, mirroring
`landing.how` (register, set up in minutes, collect on autopilot).
**Asset:** `shot-setup-en.jpg` exists; needs an Arabic equivalent shot in RTL.
**Copy:** lift `landing.how` from `src/i18n/ar.json` and `en.json` directly. It
is already written, already reviewed, and consistency between the ad and the
site is worth more than fresh wording.

### Ongoing from week 4
One WhatsApp status a week, one Instagram story every two or three days from the
demo or from real (fictional-data) product moments, and one LinkedIn post a week
aimed at management companies. That is the maintenance cadence once the launch
push is over.

---

## Paid: my recommendation

**Spend nothing in weeks 1 to 3.** There is no destination and no way to measure
a click, so any budget is bought reach with no conversion path. Boosting a post
that ends in "DM us" wastes most of the money on people who will not.

**From week 4, once the gate is down and the site is indexable**, run one small
test: a single Meta campaign (Instagram plus Facebook, Lebanon, ages 35 to 65,
interests around real estate and property management), driving to the **live
demo** rather than the homepage, with post 7 (the generator) and post 11 (the
demo) as the two creatives. Two weeks, one clear metric: demo sessions per
dollar. Decide the number yourself: I would size it as a test you would not mind
losing entirely, since the first campaign in a new market buys information, not
customers.

**Do not run App Store or Play ads.** The iOS app is TestFlight only and the
Android app does not exist yet.

---

## What to measure, given you cannot measure much yet

Until the site is live and instrumented, the only honest metrics are: DMs
received, WhatsApp replies, follower growth, and saves and shares (which matter
more than likes here, because a save means a committee member intends to bring
it up at a meeting). Write them down weekly by hand. From week 4, add demo
sessions and trial starts, which are the only two numbers that count.

One thing worth watching that costs nothing: **which of the three teaser
problems gets the most replies.** That is free positioning research, and it
should decide which feature leads the paid creative in week 4.
