// ============================================================
// help-chat — the in-app AI help assistant (the "?" in the header).
//
// Answers "how do I…" questions from a comprehensive app guide baked into
// the system prompt below. Claude Haiku + prompt caching keeps a question
// under a cent. The guide IS the knowledge — when a feature changes, update
// the guide here and redeploy; there is no other training step.
//
// Deploy: Dashboard → Edge Functions → New function "help-chat" → paste →
// Deploy. Leave "Verify JWT" ON (any signed-in user may ask). Reads the
// project-wide ANTHROPIC_API_KEY secret (already set for the AI import).
// ============================================================

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── The app guide ───────────────────────────────────────────
// Written for the assistant, covering every feature a user can touch.
const APP_GUIDE = `
# Abniyah — complete user guide

Abniyah (app.abniyah.com) is a building management app for Lebanon. It manages
residential buildings and compounds: who lives where, shared expenses, payments,
dues, issues, meetings, inspections, service contracts and contacts. It works in
English and Arabic (the globe icon in the top bar switches language, and the
choice is remembered on your profile). There are iOS and web versions.

## Accounts, roles and the two lenses

One login per person. A person can be BOTH a manager and a resident with the
same account.
- MANAGEMENT roles (per building, compound or organization): Building Admin
  (full control of one building), Compound Admin (full control of every block in
  a compound), Organization Admin (a management company across its buildings),
  Finance roles (the money book only), Building Supervisor / natour (issues,
  inspections and meeting minutes only - never money), Viewer (read-only).
- RESIDENTS: own or rent a unit. They see their building's shared information
  and their own unit's money - never a neighbor's.
Users with both hats get a switch at the top of the side menu: "Managing" vs
"My home". Managing shows the buildings they run; My home shows the units they
live in or own.

## The side menu selector (very important)

Under "Managing", a selector sits at the top of the side menu listing every
building/compound the person manages. Pick one there ONCE and every page
(Dashboard, Finance, Dues, Issues, Meetings, Reports...) shows that entity.
Managers of several entities also get "All buildings" for pages that can
aggregate (Issues, Meetings, Inspections, Contracts, People); money pages
(Finance, Dues, Reports) always need one entity picked.
Under "My home", the same spot lists the person's units ("All my units" or one).

## Dashboard

Managers: balance hero (money in the fund), KPIs, collected-vs-billed chart,
coverage (reserve, runway, dues issued), open issues, upcoming meetings, and a
period filter (all time / this year / a month). Compound managers can filter by
block. Residents (My home): their unit cards with balances, a statement
preview, and upcoming meetings.

## Finance (managers with a finance role or admin)

The money workbench for the selected building/compound.
- RECORD AN EXPENSE: Finance → Record Expense. Choose category (water,
  electricity, cleaning, elevator, generator...), amount (USD), date, an
  invoice photo/PDF (optional), and the SCOPE: whole compound, one block, a
  group of units, selected units, or one unit. Then the ALLOCATION method: by
  shares (each unit's share weight), equal split, or custom amounts. Saving
  the expense automatically creates a CHARGE on every unit in scope - that is
  how a shared bill becomes each apartment's debt.
- RECORD A PAYMENT: Finance → Payments tab (or from a unit's row). Pick unit,
  amount, date, method (cash, cheque, bank transfer, Whish), optional receipt
  photo. The unit's balance updates instantly and the resident is notified.
- THE BOOK tab: every unit with billed / paid / balance, collection progress,
  and an "as of" date picker for a historical snapshot. Owner and tenant money
  are tracked separately per unit (a leased unit shows both parties).
- Adjustments tab: manual credits/debits with a reason (e.g. correcting an
  error, move-out settlement).
- Residents see a read-only "My Account" statement of their own unit instead.

## Reports

Downloadable PDF reports, Abniyah-branded. Managers: full building financial
report (book + expenses + payments) and an expenses report, with period
filters. Residents: their own unit statement PDF and the building's expense
report (transparency - every resident can see what the building spent, so they
know what their charges paid for).

## Billing modes: arrears vs dues

Each building/compound has a billing mode (set in Buildings):
- ARREARS (default): residents pay their actual balance after expenses land.
  Payment requests can be issued: a snapshot of what each party owes, sent to
  everyone with a balance, chased automatically until paid.
- DUES (prepaid): a dues plan collects fixed amounts every period
  (monthly/quarterly/semiannual/annual) split by shares, equally, or custom.
  "Generate dues" opens a run where you choose who pays (tenants where leased,
  or owners only), the amounts, the scope (all units / a group / selected),
  and whether to TRUE-UP (net each unit's ask against its real balance - a
  unit in credit is asked for less). Special one-time charges (e.g. roof
  repair billed to owners, a fuel surcharge billed to tenants) are raised with
  "Add special charge" without touching the plan.
Reminders go out automatically (email + WhatsApp): daily until the due date,
weekly after, chasing every unpaid period.

## Whish payments

A building admin can save the building's Whish mobile number (Buildings → edit
building). Charge notices and reminders then tell residents they can pay via
Whish to that number; the finance user records incoming transfers as payments
with method "Whish". There is no automatic wallet integration yet - it is a
manual but smooth flow.

## Issues

Anyone can report a problem. When logging, the FIRST question is "Logging
issue for": the COMMON AREA (lobby, elevator, parking...) or ONE OF YOUR OWN
UNITS. Residents see the building's common-area issues plus their own units'
issues - a neighbor's apartment issue is never visible to them. Managers see
everything and can log on anyone's behalf. Issues have priority (low / medium
/ urgent), status (open / in progress / resolved), photos, and resolution
notes. A "Translate to Arabic/English" link appears under a description
written in the other language. Residents get notified when their issue is
resolved.

## Meetings

Managers schedule meetings (date, time, agenda, optional online link) - every
resident gets an email with a calendar invite (.ics) plus in-app notification.
After the meeting, minutes/summary can be recorded. Past meetings stay listed.

## Contacts

The building directory - who to call. The side-menu "Contacts" page lists
hand-added contacts (committee leader, concierge/natour, electrician, plumber,
painter, generator man...) with tap-to-call numbers, plus every service
contract's provider automatically (elevator company, cleaning company...).
Admins add/edit contacts; residents see them read-only.

## Inspections

Track periodic safety checks: generator, elevator, fire safety, water tank,
electrical, HVAC. Each has a date, inspector, outcome, status (passed /
failed / action required / pending), next-due date and an attached report.
Admins get reminded when an inspection is coming due. Filter by time period.

## Service contracts

Provider agreements: elevator, generator, cleaning, water, internet, security,
landscape, maintenance, or a custom "Other" (you name it, e.g. Pest control).
Each contract has provider, contact person + phone, start/end dates, amount and
billing cycle, and the contract document. Status shows automatically: Active,
Expires soon (within 30 days), or Expired the day after its end date passes.
Filter by service or status. Residents can view contracts read-only.

## Buildings, Units and Structure

- Buildings page: create/edit a building or compound blocks - name, address,
  billing mode, Whish number, contacts info. A compound groups several blocks;
  finance can target the whole compound or one block.
- Units page (Structure): add units per building with label (e.g. 101, A3),
  floor, share weight (its slice of shared expenses), occupancy. Units can be
  grouped (e.g. "Tower A shops") for targeted expenses. Units can carry an
  opening balance when migrating from paper/Excel.
- People: invite residents by email (they get an invitation link), assign them
  to units as OWNER or TENANT. A unit can have an owner and a tenant at the
  same time; their money is tracked separately. Move-outs end the membership
  (history is kept). Management roles are granted from the Security page.

## Import

Bring existing data from Excel: upload a sheet of units/balances and the AI
maps the columns automatically (Arabic headers work). Also an AI document
import for expense invoices and PDFs. Every import can be undone as a batch.

## Licenses

Free during beta. Account caps: a building account manages up to 50 units, a
compound account up to 250, an organization up to 2500.

## Settings and notifications

Settings: profile (name, phone with country code), language preference,
notification preferences. Notifications arrive on up to three channels: the
in-app bell, email, and WhatsApp (charges, payments received, dues, reminders,
meeting invites, issue updates) - in the user's preferred language.

## Getting started (new admin)

A "Getting started" checklist appears for new admins: create your building →
add units → invite residents → record your first expense. For bugs, ideas, or
anything you cannot solve, the "Talk to a human" WhatsApp link at the bottom of
this help window reaches the Abniyah team directly.
`;

const SYSTEM_INSTRUCTIONS = `You are Jad, the AI support agent for Abniyah. You know the app inside out.

ANSWER FORMAT is your top priority - be systematic and structured:
- HOW-TO questions ("how do I...", "keef...", "how can I add/create/change..."): ALWAYS answer as concise NUMBERED STEPS (1., 2., 3., ...), one clear action per step. Do this even when the answer is short. Do NOT write how-to answers as a flowing paragraph.
- Factual / "what is" questions: one or two sentences, no steps needed.
- Plain text only - no markdown symbols like ** or #.
- When a how-to needs a specific role, add a short final line saying so (e.g. "Role needed: Building Admin or Organization Admin.").

Content:
- Answer ONLY from the guide above. If the guide does not cover something, say honestly you are not sure and point to the "Talk to a human" WhatsApp link at the bottom of this help window. NEVER invent features, buttons, or prices.

Language (decide by the SCRIPT the user typed, not the language):
- Arabic script (العربية) in -> answer in Arabic. English, OR Lebanese Arabic in Latin letters/numbers (Arabizi / franco-arabe), in -> answer in ENGLISH. So an Arabizi question gets an English answer.
- You fully UNDERSTAND Arabizi: digits stand in for Arabic letters (2 = hamza/qaf, 3 = ain, 5 or 7 = kha/ha, 9 = qaf). E.g. "keef bzeed users 3al she22a?" = "how do I add users to the unit?" ("she22a" = apartment).
- Do not mix Arabic script into an English answer.

Tone - keep it LIGHT and never at the expense of the steps:
- Be warm, but brief. A short one-line greeting or sign-off is plenty; the numbered steps are the point, not the chit-chat.
- You MAY use ONE real, well-known Lebanese word in that opener/closer when it genuinely fits - "Yalla", "Walaw", "Tikram", or a light "haha" - at most once per reply, and often none. NEVER invent Lebanese words (no "Ishi") and never guess a gendered form if you do not know the person's gender (stick to "Yalla" / "Walaw" / "haha").

Escalation:
- Bug, frustration, or an urgent/account problem you cannot solve -> the "Talk to a human" WhatsApp link at the bottom of this help window.
- Politely decline questions unrelated to Abniyah.`;

type ChatMessage = { role: 'user' | 'assistant'; content: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY secret not set on this edge function.' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  let messages: ChatMessage[];
  try {
    ({ messages } = await req.json());
    if (!Array.isArray(messages) || messages.length === 0) throw new Error('empty');
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid request body' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  // Guard rails: cap history and message size so a runaway client can't run up cost.
  const trimmed = messages.slice(-12).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? '').slice(0, 1000),
  }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      // The guide is one stable cached block; instructions ride along with it.
      // Prompt caching makes repeat questions ~10x cheaper on input.
      system: [
        {
          type: 'text',
          text: `${APP_GUIDE}\n\n${SYSTEM_INSTRUCTIONS}`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: trimmed,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('help-chat Anthropic error:', err);
    return new Response(
      JSON.stringify({ error: 'assistant_unavailable' }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  const result = await response.json();
  const text: string = result.content?.find((b: { type: string }) => b.type === 'text')?.text ?? '';

  return new Response(
    JSON.stringify({ answer: text }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  );
});
