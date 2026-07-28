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
for all four. Language **English** (code `en`). Create each with EXACTLY this name
and body — the code sends variables by position, so `{{1}}`, `{{2}}`… order matters.

### 1. `abniyah_new_charge`
```
Hello {{1}}, a new charge of {{2}} was added to unit {{3}} at {{4}}. Open Abniyah to view your account and balance.
```
Sample values (Meta asks for them): `Rana` · `$120.00` · `A-3` · `El Woroud`

### 2. `abniyah_payment_received`
```
Hello {{1}}, we received your payment of {{2}} for unit {{3}} at {{4}}. Thank you!
```
Samples: `Rana` · `$250.00` · `A-3` · `El Woroud`

### 3. `abniyah_dues_issued`
```
Hello {{1}}, your dues for {{2}} are {{3}} (unit {{4}}, {{5}}). Open Abniyah for details and payment options.
```
Samples: `Rana` · `July 2026` · `$100.00` · `A-3` · `El Woroud`

### 4. `abniyah_unit_invite`
```
Hello {{1}}, {{2}} invited you to link your Abniyah account to unit {{3}} at {{4}}. Sign in to accept or decline — nothing is linked without your approval.
```
Samples: `Rana` · `Jihad Meraachli` · `A-3` · `El Woroud`

Approval is usually minutes to ~1 day for Utility templates. Status shows in
WhatsApp Manager; you'll also get an email.

**Arabic later (optional):** create the SAME template names in language `ar` with
translated bodies, then set the `WHATSAPP_LANG` secret to `ar` (it's one global
language for now; per-user language is a future enhancement).

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
