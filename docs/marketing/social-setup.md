# Social media setup — pages, AI autopilot, and what Jey actually has to do

Written 2026-09-04. Companion to [content-calendar.md](content-calendar.md)
(which owns the platform reasoning and the post plan). This doc owns the
one-time setup: creating the accounts, wiring them to an AI management tool,
and the standing 15-minutes-a-week routine that replaces "managing social
media."

## The tool decision (researched 2026-09-04)

13 tools compared (Marky, Blaze, Vista Social, SocialBee, Ocoya, Predis,
FeedHive, Publer, Buffer, Hootsuite, Highperformr, RADAAR, ManyChat).
Full comparison lived in the research session; the conclusions:

| Verdict | Tool | Why |
|---|---|---|
| **Primary pick** | **Blaze.ai** (~$79–149/mo) | The only true autopilot: builds a brand kit from abniyah.com, generates AND publishes on schedule to IG/FB/TikTok/LinkedIn, auto-publish on by default. |
| **Runner-up** | **Vista Social** ($79/mo) | Best-reviewed of the set (G2 4.8★ × 1,071). Built-in comment/DM auto-replies + real Meta boosting. But content is draft-and-approve, not unattended. |
| Ruled out | velocity.li | No independent reviews anywhere; all "rankings" self-published; inconsistent pricing. Unproven — not for a paying brand. |
| Ruled out | Marky (mymarky.ai) | Needs draft review anyway; recent complaints of failed FB/TikTok posts and post-purchase credit changes. |
| Ruled out | FeedHive | Documented *silent* posting failures + slow support — worst failure mode for someone who checks in rarely. |
| Ruled out | Predis.ai | Arabic explicitly not supported and not on the roadmap. |
| Not needed yet | ManyChat | Comment→DM automation; add only if DM volume ever hurts. Start with its free tier if so. |

Known limits accepted going in (all tools share them):
- **Arabic is untested territory** for every tool — none advertises it. Test
  Arabic output during the trial before paying (audience is Arabic-first per
  the content calendar).
- **No tool gets fully unattended immediately.** AI trained on abniyah.com can
  invent product claims — the one mistake this brand can't afford. First
  month: review queued posts weekly before they go out, then loosen.
- Boosting + comment handling are done **natively and free** via Meta Business
  Suite (Boost button + app notifications), not through the tool.

## Phase 0 — decisions & materials (DECIDED 2026-09-04)

1. **Handle: `@abniyahapp`** everywhere, one bilingual account per platform.
   (`@abniyah` is taken on Instagram by an unrelated personal account —
   verified 2026-09-04; `@abniyahapp` confirmed free on Instagram AND TikTok
   the same day. Register it everywhere promptly — handles are first-come.)
2. **Public WhatsApp number: `+961 78 995 443`** (the Tatawwor line) —
   WhatsApp Business app, on a phone someone answers daily; every bio's CTA
   is `wa.me/96178995443`. ⚠️ This number must NEVER become the Cloud API
   sender — that stays a separate dedicated SIM (WHATSAPP_SETUP.md: API
   registration is irreversible).
3. **Email for all signups: info@abniyah.com** — M365 alias of the
   abniyah.com shared mailbox (DEPENDENCIES.md), visible to both Jey and
   Ahmad; never a personal address.
4. **Assets**: app icon as profile picture (square, from the iOS asset set);
   a cover image (dashboard screenshot from the demo building works).
5. **Bios** (Arabic first, then English, per the calendar):
   - AR: `بنايتك، منظّمة أخيرًا. اشتراكات، تصويت، صيانة وحسابات — لبنايات لبنان.`
   - EN: `Your building, finally organized. Dues, votes, maintenance & money — built for Lebanon.`
   - Link: the wa.me link (site is behind the beta gate — nothing else to link).

## STATUS 2026-09-04 — accounts ALL CREATED (one evening, Jey)

- **Meta**: reused the existing Tatawwor portfolio (the WhatsApp Cloud API
  one). Abniyah Facebook page created inside it — dressed, username
  `abniyahapp`, WhatsApp +961 78 995 443 connected (switched from the old
  empty Tatawwor page). Instagram `@abniyahapp` created as Business and
  linked to the page. Avatar = mark only (no wordmark text).
- **TikTok**: `@abniyahapp` live as Business; verification review pending
  (~3 days); display name stuck as "abniyahapp" until ~2026-09-11 (TikTok
  7-day lock) — then rename to "Abniyah".
- **LinkedIn**: Tatawwor L.L.C page already existed under Jey's
  jihad.meraachli@tatawwor.com account; dressed 2026-09-04.
- **Language decision (Jey)**: pages and posts are ENGLISH-first; Arabic
  reserved for ads later. (Week 1 batch was written Arabic-first — use its
  English variants; future batches English-first.)
- Remaining: Ahmad as second full-control admin (Meta People invite +
  LinkedIn super admin + TikTok creds), and the scheduler decision
  (Blaze trial vs Claude-generated batches + cheap scheduler).

## Phase 1 — Meta (Facebook + Instagram): the backbone

Order matters: Business portfolio → Facebook Page → Instagram → link them.
The FB↔IG link is what lets ANY tool post to Instagram via the API.

1. Go to **business.facebook.com** → Create a business portfolio:
   "Tatawwor L.L.C", info@tatawwor.com.
2. Inside it, **create the Facebook Page**: name "Abniyah", category
   "Software company" (or "Property management company"), bio + profile
   picture + cover + wa.me link. Turn OFF the "similar pages suggestions"
   vanity stuff; leave everything else default.
3. **Create the Instagram account** (from a phone is easiest): the chosen
   handle, info@tatawwor.com. Then Settings → Account type → switch to
   **Business** (not Creator).
4. **Link them**: Facebook Page settings → Linked accounts → Instagram →
   sign in. (Or Instagram → Edit profile → Page.) Verify in Meta Business
   Suite that both the Page and the IG account show up.
5. **Admins**: add Ahmad as a second full-control person on the business
   portfolio (Settings → People). Two admins always — accounts get locked.
6. **2FA on everything**: the personal Facebook profiles that administer the
   Page, and the Instagram login. Meta locks pages behind admins' personal
   account security.
7. Install the **Meta Business Suite app** on the phone, notifications ON —
   this is the free "comment/DM inbox" and the **Boost** button.

## Phase 2 — TikTok

1. Create the account with the same handle + info@tatawwor.com.
2. Settings → Account → **Switch to Business account** (required for API
   posting by tools; category: Software/App).
3. Bio (short, AR+EN) + wa.me link in the website field once available.
   Per the calendar: TikTok is **cross-posting only** — zero extra effort.

## Phase 3 — LinkedIn

1. The audience here is property-management companies, not residents.
   Create (or claim) the **Tatawwor L.L.C company page**, Jey + Ahmad as
   super admins. Abniyah posts come from there, one a week.

## Phase 4 — connect Blaze.ai and configure autopilot

1. Sign up at blaze.ai with info@tatawwor.com. **Start on the trial**, and
   during it run the two make-or-break tests: (a) generate Arabic posts and
   judge them, (b) check every connected channel actually publishes.
2. **Brand kit**: feed it abniyah.com, upload the logo, set the teal palette,
   set voice ("plain, direct, no hype; Arabic first, English second").
   Paste in a **feature whitelist** — the truthful claims list (what the app
   actually does today) — and an explicit instruction: *never mention a
   feature, price, or availability not in this list.* This is the guardrail
   against invented claims.
3. **Connect channels** (OAuth only — never give any tool a password):
   - Instagram + Facebook: "Connect with Facebook" → log in with the
     personal profile that admins the Page → grant access to the Abniyah
     Page and the linked IG Business account.
   - TikTok: OAuth with the Business account.
   - LinkedIn: OAuth as super admin of the Tatawwor page.
4. **Cadence**: 3 posts/week (the calendar's sustainable rate), IG+FB
   primary, cross-post to TikTok, 1/week LinkedIn.
5. **Approval mode first**: leave "approve before posting" ON for the first
   month. Weekly 10-minute review of the queue (factual claims + Arabic
   quality), then flip to full auto-publish once it's trustworthy.

If Blaze fails the trial tests → same setup with Vista Social ($79/mo);
you gain auto-replies and in-tool boosting, you lose unattended generation.

## Phase 5 — the standing routine (the actual "involvement")

- **Weekly, ~15 min**: glance at Blaze's queue (month 1), glance at Business
  Suite notifications, reply to any real DM (they're leads, not chores),
  and hit **Boost** ($10–20, 3–4 days, Lebanon, 25–65) on any post that
  outperformed organically.
- **Monthly, ~10 min**: check each platform actually received posts (silent
  posting failures are the #1 tool complaint industry-wide).

## Blockers inherited from the content calendar (unchanged)

1. No public destination (beta gate + noindex) → all CTAs are wa.me.
2. No public WhatsApp number yet.
3. Reel background image licenses unresolved — must be settled **before any
   post is boosted** (paid distribution of unlicensed imagery).
