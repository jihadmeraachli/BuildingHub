# App Store Submission — Abniyah

Everything needed to take the existing TestFlight build to the public App
Store. Companion to [IOS_APP.md](IOS_APP.md) (the build/upload mechanics).

_Written 2026-09-03. Prerequisite shipped the same day: self-service account
deletion (0170) — Apple Guideline 5.1.1(v) blocks any accounts-app without it._

## Blockers status

| Apple requirement | Status |
|---|---|
| Privacy policy URL | ✅ https://abniyah.com/privacy (en/ar) |
| In-app account deletion (5.1.1v) | ✅ 0170 — Settings → Delete account (run the migration + ship a build containing it) |
| "Not just a website" (4.2 minimum functionality) | ✅ native push (APNs), Face ID sign-in, Keychain sessions — say so in review notes |
| Sign-in works for reviewer | ✅ demo mode (`/demo`) or a dedicated review account — see Review notes |
| Export compliance | ✅ standard HTTPS only → exempt |

## App Store record (App Store Connect → Apps → + New App)

- **Name:** Abniyah
- **Bundle ID:** com.abniyah.app · **SKU:** abniyah
- **Primary language:** English (add Arabic localization of the listing too)
- **Category:** Business (secondary: Productivity)
- **Age rating:** answer everything "No" → 4+
- **Price:** Free (the committee pays the subscription outside the app —
  nothing is sold *in* the app, so no IAP is involved; see 3.1.3(b),
  business-services exemption. Do NOT mention pricing inside the app UI.)

## Listing copy

### English

**Subtitle (30 chars max):** `Building management, done right`

**Promotional text (170 chars):**
`Dues, votes, maintenance and money — your building, finally organized. Built for Lebanon: USD + LBP, Arabic + English, WhatsApp and email alerts.`

**Description:**

```
Abniyah runs the building so the committee doesn't have to chase it.

FOR RESIDENTS
• See your balance and full statement any time — every charge explained
• Pay your share and get notified the moment it's recorded
• Vote on building decisions straight from your phone (or your inbox)
• Report issues with photos and follow them to resolution
• Lost & found, meeting invites, building announcements — one place

FOR COMMITTEES & MANAGERS
• Collect dues in USD and LBP with per-payment exchange rates
• A real fund ledger: cash on hand, reserve, every entry auditable
• Generator & water metering with fair, transparent billing models
• Inspections that schedule their own follow-ups
• Contracts, projects, amenities — the whole building's paper trail
• Payment requests with reminders that stop when people pay

BUILT FOR LEBANON
• Full Arabic and English (and French), right-to-left done properly
• USD + LBP side by side, rates frozen per transaction
• Works as an app, from email, and on the web

Your data stays yours: bank-grade authentication, Face ID sign-in,
and notifications only for what matters.
```

**Keywords (100 chars, comma-separated, no spaces needed):**
`building,syndic,committee,dues,HOA,Lebanon,لجنة,مبنى,اشتراكات,property,tenants,نضارة,بناية`

### Arabic (listing localization)

**Subtitle:** `إدارة المبنى، كما يجب`

**Description:** (translate the English faithfully; keep the three section
headers: للسكان / للجان والإدارة / مصمّم للبنان. The in-app Arabic wording is
the vocabulary reference so the listing matches the product.)

## Privacy nutrition labels (App Store Connect → App Privacy)

Data is **collected and linked to identity**, **not used for tracking**, no
third-party advertising. Declare:

| Data type | Linked? | Purpose |
|---|---|---|
| Contact info → Name, Email, Phone | Yes | App functionality (account, notices) |
| User content → Photos (issue/lost-item/attachment uploads), Other user content (issues, votes, messages to the building) | Yes | App functionality |
| Identifiers → User ID, Device ID (push token) | Yes | App functionality (notifications) |
| Financial info → Payment history (building dues ledger — NOT payment cards; the app never collects card numbers) | Yes | App functionality |

Third parties that process data (for the privacy policy, already listed
there): Supabase (database/auth, EU-Frankfurt), Resend (email), Apple APNs
(push), Meta WhatsApp Cloud API (optional notifications).

## Review notes (paste into "Notes for Review")

```
Abniyah is a building-management platform for residential buildings in
Lebanon. Residents see their dues and statements, vote, and report issues;
building committees manage collections, funds, metering and maintenance.

REVIEW ACCESS: use the demo — open the app and tap "Try the demo" (or
navigate to /demo). It signs into a fully populated read-only building, no
credentials needed. If you prefer a real account, we can provision one on
request.

NATIVE FUNCTIONALITY beyond the web experience: push notifications via
APNs (charges, payments, votes, issues), Face ID sign-in, and sessions
stored in the iOS Keychain.

ACCOUNT DELETION: Settings → Delete account (self-service, per 5.1.1(v)).

No in-app purchases: building subscriptions are billed to the building
committee (an organization) outside the app, per 3.1.3(b).
```

## Screenshots (the only asset work left)

Required: **6.9" (iPhone 16 Pro Max)** set; 6.5" reuses it. 5–8 shots, taken
from the simulator (`⌘S` in Simulator saves a PNG at the right size).

Suggested sequence (shoot in English; duplicate the best 3–4 in Arabic for
the Arabic listing):
1. Dashboard — the money hero (cash USD/LBP, open issues, upcoming meeting)
2. Resident statement — charges/payments with explanations
3. Voting — an open vote with live results bars
4. Metering — a finalized generator cycle (billed vs market rate)
5. Issues — the list with photos and statuses
6. Settings — Face ID toggle + notifications (the "native" story)

Take them with the **demo building** so no real resident data appears.

## Submission-day checklist (Mac)

1. `git pull && npm install && npm run build && npx cap sync ios`
2. Verify the two fragile native bits per IOS_APP.md: AppDelegate relay,
   `aps-environment = production`
3. Xcode: bump Version to `1.0` (+ Build), Archive → Upload
4. App Store Connect: fill everything above, attach screenshots
5. Add the build to the **App Store** version (not just TestFlight),
   answer export compliance (exempt), submit for review
6. Review typically 1–3 days; rejections usually cite a guideline number —
   bring it back here and we fix precisely that

## Open questions

- **Team:** currently the individual team `8PHJEU7CDL` (seller shows the
  personal name). If the Tatawwor **organization** enrollment (D-U-N-S
  557923160) has completed, create the app record under the org team
  instead — moving an app between teams later is possible (App Transfer)
  but is paperwork; pick the team BEFORE creating the record.
- **Android:** untouched (needs Firebase for push). The PWA covers Android
  browsers meanwhile.
