# WhatsApp Setup — Meta Cloud API

Step-by-step guide to turn on WhatsApp notifications. The code is already deployed
inside the `dynamic-action` edge function and stays **dormant until the two secrets
are set** — so nothing breaks while you work through this at your own pace.

_Written 2026-07-26. Meta moves its console around; if a menu name differs, the
concept is the same._

## How it works (30 seconds)

Same pipeline as email: a database event (charge, payment, dues, invitation) fires a
Database Webhook → `dynamic-action` → sends the email **and**, for users who ticked
the WhatsApp box and have a phone saved, a WhatsApp **template message** via Meta's
Cloud API. Business-initiated WhatsApp messages must use templates that Meta
pre-approves — that's why Part 2 below matters and why the wording in the app code
and in Meta's console must match.

- Opt-in: `profiles.notify_whatsapp` (Settings → notifications; admins can toggle it
  in People, guarded by a saved phone).
- Phone: `profiles.phone`, normalized Lebanon-first (`03 123 456` → `+961 3 123 456`;
  full international numbers work for anyone abroad).
- Cost: utility templates ≈ $0.014/message for Lebanon, billed by Meta to the card
  on the Business account. No monthly fee.

## Part 1 — Meta Business account + WhatsApp

1. Go to **business.facebook.com** → create a Business portfolio for Abniyah
   (use an email you keep long-term — this account is a production dependency).
2. Go to **developers.facebook.com** → **My Apps → Create App** → type **Business**
   → link it to the Abniyah portfolio.
3. In the app dashboard, **Add product → WhatsApp → Set up**. Meta creates a test
   number for you immediately — you can send to 5 verified test recipients with it
   **before** doing anything else. Good for our first end-to-end test.
4. **Register the real sender number** (WhatsApp → API Setup → Add phone number):
   - Use a NEW number (cheap SIM/eSIM). ⚠️ Once registered here it can never be
     used in the normal WhatsApp app.
   - You'll verify it by SMS or voice call, so the SIM must be able to receive one.
   - Display name: **Abniyah** (Meta reviews it; keep it matching the brand/site).
5. **Business verification** (Business Settings → Security Center): submit the
   business documents when Meta asks. Unverified accounts are capped (~250
   conversations/day) — fine for beta; verify before launch.
6. Add a **payment method** (Business Settings → Billing) — messages are billed here.

## Part 2 — Create the message templates

WhatsApp Manager → **Message templates → Create template**. Category **Utility**
for all four. Language **English** (code `en`) — ⚠️ if the editor only offers
**English (US)**, that's code `en_US`: then set the `WHATSAPP_LANG` secret to
`en_US`, or sends fail with error 132001 "template name does not exist in en"
(the code's language must equal the template's exact language code). Create each
with EXACTLY this name and body — the code sends variables by position, so
`{{1}}`, `{{2}}`… order matters.

**⚠️ LEGACY bilingual format (2026-07-29 → per-language rollout):** the bodies
below are the stacked Arabic+English versions that are LIVE while
`WHATSAPP_PER_LANG` is off. The successor is **Part 2b** (one language per
recipient, driven by `profiles.preferred_language`, migration 0060) — new work
happens there; this section stays only until the switch is flipped.

**Bilingual format:** every message carries an Arabic section
first, a divider, then the same message in English. Meta requires strictly
sequential variables, so the English section REUSES the same values under new
numbers — the code sends every value twice automatically (`sendWhatsApp`
duplicates the param list). When Meta asks for sample values, fill each pair
with the same text (e.g. {{1}} and {{5}} both `Rana`).

### 1. `abniyah_new_charge` — 8 variables
```
مرحباً {{1}}،
تمت إضافة رسم جديد على حسابك بالتفاصيل التالية:
المبلغ: {{2}}
الوحدة: {{3}}
المبنى: {{4}}
يمكنك مراجعة التفاصيل والرصيد من حسابك.

———

Hello {{5}},
A new charge was added to your account:
Amount: {{6}}
Unit: {{7}}
Building: {{8}}
You can review the details and your balance in your account.
```
Samples — the editor asks for one value per variable, 8 fields total; the English
half repeats the Arabic half's values:
`{{1}}` Rana · `{{2}}` $120.00 · `{{3}}` A-3 · `{{4}}` El Woroud ·
`{{5}}` Rana · `{{6}}` $120.00 · `{{7}}` A-3 · `{{8}}` El Woroud

### 2. `abniyah_payment_received` — 8 variables
```
مرحباً {{1}}،
استلمنا دفعتك بالتفاصيل التالية:
المبلغ: {{2}}
الوحدة: {{3}}
المبنى: {{4}}
شكراً لك!

———

Hello {{5}},
We received your payment with the details below:
Amount: {{6}}
Unit: {{7}}
Building: {{8}}
Thank you!
```
Samples (8 fields):
`{{1}}` Rana · `{{2}}` $250.00 · `{{3}}` A-3 · `{{4}}` El Woroud ·
`{{5}}` Rana · `{{6}}` $250.00 · `{{7}}` A-3 · `{{8}}` El Woroud

### 3. `abniyah_dues_issued` — 10 variables
```
مرحباً {{1}}،
صدرت مستحقاتك عن {{2}}:
المبلغ: {{3}}
الوحدة: {{4}}
المبنى: {{5}}
تجد التفاصيل وخيارات الدفع في حسابك.

———

Hello {{6}},
Your dues for {{7}} have been issued:
Amount: {{8}}
Unit: {{9}}
Building: {{10}}
Details and payment options are in your account.
```
Samples (10 fields):
`{{1}}` Rana · `{{2}}` July 2026 · `{{3}}` $100.00 · `{{4}}` A-3 · `{{5}}` El Woroud ·
`{{6}}` Rana · `{{7}}` July 2026 · `{{8}}` $100.00 · `{{9}}` A-3 · `{{10}}` El Woroud

### 4. `abniyah_unit_invite` — 8 variables
```
مرحباً {{1}}،
دعاك {{2}} لربط حسابك في أبنية بوحدة:
الوحدة: {{3}}
المبنى: {{4}}
سجّل الدخول للقبول أو الرفض — لن يُربط أي شيء دون موافقتك.

———

Hello {{5}},
{{6}} invited you to link your Abniyah account to a unit:
Unit: {{7}}
Building: {{8}}
Sign in to accept or decline — nothing is linked without your approval.
```
Samples (8 fields):
`{{1}}` Rana · `{{2}}` Jihad Meraachli · `{{3}}` A-3 · `{{4}}` El Woroud ·
`{{5}}` Rana · `{{6}}` Jihad Meraachli · `{{7}}` A-3 · `{{8}}` El Woroud

### 5. `abniyah_payment_reminder` — 8 variables (automated monthly reminder cron)
```
مرحباً {{1}}،
تذكير ودّي: يوجد رصيد مستحق على وحدتك.
المبلغ: {{2}}
الوحدة: {{3}}
المبنى: {{4}}
تجد التفاصيل وخيارات الدفع في حسابك.

———

Hello {{5}},
A friendly reminder: your unit has an outstanding balance.
Amount: {{6}}
Unit: {{7}}
Building: {{8}}
Details and payment options are in your account.
```
Samples (8 fields):
`{{1}}` Rana · `{{2}}` $140.00 · `{{3}}` A-3 · `{{4}}` El Woroud ·
`{{5}}` Rana · `{{6}}` $140.00 · `{{7}}` A-3 · `{{8}}` El Woroud

⚠️ Templates belong to the WhatsApp ACCOUNT (WABA), not the phone number — create
them under the account that holds the PRODUCTION number. A number in a different
account can't see them (error 132001 "template name does not exist").

Approval is usually minutes to ~1 day for Utility templates. Status shows in
WhatsApp Manager; you'll also get an email.

**Language code stays `en`** even though the body is bilingual — the code matches
the template's registered language, and the Arabic lives inside the body. Don't
set `WHATSAPP_LANG` unless the template's language column says something else.

## Part 2b — Per-language templates (0060) + the Whish pay line

Each resident gets ONE message in their chosen language
(`profiles.preferred_language`, set from Settings or the header toggle), and
the money templates end with a **pay-line variable**: the code fills it with
"You can pay directly through Whish to <number>" when the building has a Whish
account (0059), else a generic "details in your account" line.

**How to roll out (order matters):**
1. Run migrations 0059 + 0060 in the SQL Editor (if not already).
2. Redeploy `dynamic-action` and `send-reminders` — the new code still sends
   the LEGACY bilingual format until the flag flips, so nothing changes yet.
3. In WhatsApp Manager, for each of the five templates below:
   - Open the template → **Add language → Arabic (`ar`)** → paste the Arabic
     body → submit.
   - **Edit** the English (`en`) body → replace the old bilingual body with the
     new English-only body → submit. (The currently-approved version keeps
     sending while the edit is in review.)
4. When ALL ten variants (5 templates × 2 languages) show **Approved**:
   Supabase → Edge Functions → Secrets → add `WHATSAPP_PER_LANG` = `1`.
   If messages still arrive bilingual afterwards, redeploy both functions.
   Rollback at any time: delete the secret.

> Submitted via the Graph API on 2026-08-02 (the UI can't add languages to
> existing templates). Two Meta validation rules shaped the bodies: a variable
> may not START or END the body (hence the closing line after the pay-line
> variable), and short bodies with many variables trip a words-per-variable
> ratio check (hence the fuller sentences on dues).

### 1. `abniyah_new_charge` — 5 variables per language
English (`en`):
```
Hello {{1}},
A new charge was added to your unit account with the details below:
Amount: {{2}}
Unit: {{3}}
Building: {{4}}
{{5}}
Thank you!
```
Arabic (`ar`):
```
مرحباً {{1}}،
تمت إضافة رسم جديد على حساب وحدتك بالتفاصيل التالية:
المبلغ: {{2}}
الوحدة: {{3}}
المبنى: {{4}}
{{5}}
شكراً لك!
```
Samples: `{{1}}` Rana · `{{2}}` $120.00 · `{{3}}` A-3 · `{{4}}` El Woroud ·
`{{5}}` en: `You can pay directly through Whish to 03 123 456.` /
ar: `يمكنك الدفع مباشرة عبر Whish إلى 03 123 456.`

### 2. `abniyah_payment_received` — 4 variables per language
English (`en`):
```
Hello {{1}},
We received your payment with the details below:
Amount: {{2}}
Unit: {{3}}
Building: {{4}}
Thank you!
```
Arabic (`ar`):
```
مرحباً {{1}}،
استلمنا دفعتك بالتفاصيل التالية:
المبلغ: {{2}}
الوحدة: {{3}}
المبنى: {{4}}
شكراً لك!
```
Samples: `{{1}}` Rana · `{{2}}` $250.00 · `{{3}}` A-3 · `{{4}}` El Woroud

### 3. `abniyah_dues_issued` — 6 variables per language
English (`en`):
```
Hello {{1}},
Your dues for {{2}} have been issued with the details below:
Amount due: {{3}}
Unit: {{4}}
Building: {{5}}
{{6}}
Thank you for keeping your account up to date!
```
Arabic (`ar`):
```
مرحباً {{1}}،
صدرت مستحقاتك عن {{2}} بالتفاصيل التالية:
المبلغ المستحق: {{3}}
الوحدة: {{4}}
المبنى: {{5}}
{{6}}
شكراً لمواظبتك على تسديد حسابك!
```
Samples: `{{1}}` Rana · `{{2}}` July 2026 · `{{3}}` $100.00 · `{{4}}` A-3 ·
`{{5}}` El Woroud · `{{6}}` as in template 1.

### 4. `abniyah_unit_invite` — 4 variables per language
English (`en`):
```
Hello {{1}},
{{2}} invited you to link your Abniyah account to a unit:
Unit: {{3}}
Building: {{4}}
Sign in to accept or decline. Nothing is linked without your approval.
```
Arabic (`ar`):
```
مرحباً {{1}}،
دعاك {{2}} لربط حسابك في أبنية بوحدة:
الوحدة: {{3}}
المبنى: {{4}}
سجّل الدخول للقبول أو الرفض، لن يُربط أي شيء دون موافقتك.
```
Samples: `{{1}}` Rana · `{{2}}` Jihad Meraachli · `{{3}}` A-3 · `{{4}}` El Woroud

### 5. `abniyah_payment_reminder` — 5 variables per language
English (`en`):
```
Hello {{1}},
A friendly reminder: your unit has an outstanding balance with the details below.
Amount: {{2}}
Unit: {{3}}
Building: {{4}}
{{5}}
Thank you for settling it soon!
```
Arabic (`ar`):
```
مرحباً {{1}}،
تذكير ودّي: يوجد رصيد مستحق على وحدتك بالتفاصيل التالية.
المبلغ: {{2}}
الوحدة: {{3}}
المبنى: {{4}}
{{5}}
شكراً لتسديده قريباً!
```
Samples: `{{1}}` Rana · `{{2}}` $140.00 · `{{3}}` A-3 · `{{4}}` El Woroud ·
`{{5}}` as in template 1.

Recipients with no saved preference get English. The em-dash-free copy rule
applies to template bodies too.

## Part 3 — Wire the secrets into Supabase

From the developer app → WhatsApp → **API Setup**, copy:
- **Phone number ID** (a long number under the sender phone — NOT the phone itself)
- **Access token** — the API Setup page shows a 24-hour temporary token; for
  production create a **System User** (Business Settings → Users → System users →
  Add → Admin) → **Generate token** → select the app, permissions
  `whatsapp_business_messaging` + `whatsapp_business_management`, expiry **never**.

Then in Supabase → **Edge Functions → dynamic-action → Secrets**, add:

| Secret | Value |
|---|---|
| `WHATSAPP_TOKEN` | the permanent System User token |
| `WHATSAPP_PHONE_ID` | the Phone number ID |
| `WHATSAPP_LANG` | *(optional)* `en` (default) or `ar` once Arabic templates approved |

Finally **redeploy `dynamic-action`** (Functions → dynamic-action → Deploy) so the
new code + secrets load.

## Part 4 — Test

1. In the app: your profile → save your mobile number → tick WhatsApp notifications.
2. Record a small payment on one of your test units.
3. You should get the email AND the `abniyah_payment_received` WhatsApp message.
4. If no message: Supabase → Edge Functions → dynamic-action → **Logs** — WhatsApp
   errors are logged as `WhatsApp error (template_name): ...` with Meta's reason
   (wrong template name, template not approved yet, unregistered test recipient,
   token expired are the usual suspects).

## Gotchas

- **Template mismatch = silent-ish failure.** If a template name or its variable
  count differs from the code, Meta rejects the send (visible only in function
  logs). The four names above must match exactly.
- **Test number phase:** recipients must be added as verified test numbers in the
  API Setup page until a real sender number is registered.
- **Token expiry:** the 24h temp token dies quietly — same symptom as the Resend
  FROM_EMAIL issue (nothing arrives, error only in logs). Use the System User
  permanent token before considering it done.
- **Quality rating:** Meta rates the sender number on user blocks/reports. Utility
  messages to opted-in residents are low-risk, but this is why the opt-in checkbox
  matters — never flip it on for someone who didn't ask.
