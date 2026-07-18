const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!ANTHROPIC_API_KEY) {
    return json({ error: 'ANTHROPIC_API_KEY secret not set.' }, 500);
  }

  let content: string, format: string;
  try {
    ({ content, format } = await req.json());
    if (!content) throw new Error('missing content');
    if (!format) throw new Error('missing format');
  } catch (e: unknown) {
    return json({ error: (e instanceof Error ? e.message : 'Bad request') }, 400);
  }

  // Truncate large CSVs to first 150 rows to stay within token limits
  if (format === 'excel') {
    const lines = content.split('\n');
    if (lines.length > 151) {
      content = lines.slice(0, 151).join('\n');
      console.log(`CSV truncated to 150 rows (was ${lines.length - 1} rows)`);
    }
  }

  const PROMPT = `You are extracting financial data from a building management document.

Return ONLY a JSON object — no markdown, no explanation — with exactly these keys:
{
  "expenses": [
    {
      "description": "string",
      "category": "common_expenses|water|electricity|contracts|projects|fines|other",
      "amount_usd": 0.00,
      "expense_date": "YYYY-MM-DD or null",
      "block": "single letter or identifier e.g. A, B — or null if compound-wide"
    }
  ],
  "unit_charges": [
    {
      "unit_label": "string",
      "description": "string",
      "amount_usd": 0.00,
      "charge_date": "YYYY-MM-DD or null"
    }
  ],
  "unit_payments": [
    {
      "unit_label": "string",
      "amount_usd": 0.00,
      "paid_on": "YYYY-MM-DD or null",
      "method": "cash|bank_transfer|cheque|other"
    }
  ]
}

Rules for expenses (building-wide line items — e.g. security services, janitorial, maintenance):
- Each named expense category with a total amount = one entry
- category: common_expenses for management/admin/services; water for water/generator/diesel; electricity for power; contracts for service contracts; projects for construction/capital; fines for penalties; other for the rest
- amount_usd: USD value only, positive. Ignore LBP columns entirely.
- expense_date: use the document's period end date, or null if unclear
- block: if the document has sections per block/tower (e.g. "Block A expenses", column header "A"), set to the block letter/identifier. Otherwise null.

Rules for unit_charges (per-unit outstanding balances or dues owed):
- unit_label: the apartment/unit code (A104, 201, "1 East", etc.)
- amount_usd: USD balance — positive means the unit owes money, negative means the unit is in credit (overpaid). Skip units with exactly 0 balance.
- description: "Outstanding balance" if positive, "Credit balance" if negative, or use document text
- charge_date: from document or null

Rules for unit_payments (per-unit payments already received):
- amount_usd: positive USD amount received. Ignore LBP.
- paid_on: date of payment or null

Special cases:
- Trial Balance (account codes, debit/credit columns) → populate expenses only
- Per-unit rows with budget + payments + remaining balance → populate unit_charges (remaining balance) and unit_payments (payments column)
- Documents with both building totals AND per-unit data → populate all three arrays
- Convert Arabic-Indic numerals to Western digits in all fields
- Keep Arabic names as-is in description fields

Method mapping for unit_payments:
- "cheque", "check", "chèque", "صك", "شيك" → "cheque"
- "bank transfer", "wire", "swift", "bank", "transfer", "ach", "تحويل" → "bank_transfer"
- "cash", "fresh", "usd fresh", "نقد", "كاش" → "cash"
- anything else or unknown → "other"`;

  let contentBlock: Record<string, unknown>;
  if (format === 'pdf') {
    contentBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: content } };
  } else if (format === 'jpeg' || format === 'jpg') {
    contentBlock = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: content } };
  } else if (format === 'png') {
    contentBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: content } };
  } else {
    // Excel/CSV: content is the CSV text
    contentBlock = { type: 'text', text: content };
  }

  console.log(`Calling Anthropic: format=${format}, content_length=${content.length}`);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          contentBlock,
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`Anthropic error ${response.status}: ${err}`);
    return json({ error: `Anthropic API error: ${err}` }, 502);
  }
  console.log('Anthropic responded OK');

  const result = await response.json();
  const text: string = result.content?.[0]?.text ?? '{}';
  const match = text.match(/\{[\s\S]*\}/);

  if (!match) return json({ error: 'Could not parse AI response', raw: text }, 422);

  let parsed: { expenses?: unknown[]; unit_charges?: unknown[]; unit_payments?: unknown[] };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return json({ error: 'Invalid JSON from AI', raw: text }, 422);
  }

  function num(v: unknown): number {
    if (typeof v === 'number') return isNaN(v) ? 0 : Math.abs(v);
    return Math.abs(parseFloat(String(v ?? '0')) || 0);
  }
  function signedNum(v: unknown): number {
    if (typeof v === 'number') return isNaN(v) ? 0 : v;
    return parseFloat(String(v ?? '0')) || 0;
  }
  function str(v: unknown): string { return String(v ?? '').trim(); }

  const expenses = (parsed.expenses ?? []).map((e: unknown) => {
    const r = e as Record<string, unknown>;
    return { description: str(r.description), category: str(r.category) || 'other', amount_usd: num(r.amount_usd), expense_date: r.expense_date ? str(r.expense_date) : null, block: r.block ? str(r.block) : null };
  }).filter(e => e.amount_usd > 0 && e.description);

  const unit_charges = (parsed.unit_charges ?? []).map((c: unknown) => {
    const r = c as Record<string, unknown>;
    return { unit_label: str(r.unit_label), description: str(r.description) || 'Outstanding balance', amount_usd: signedNum(r.amount_usd), charge_date: r.charge_date ? str(r.charge_date) : null };
  }).filter(c => c.unit_label && c.amount_usd !== 0);

  const VALID_METHODS = ['cash', 'bank_transfer', 'cheque', 'other'];
  const unit_payments = (parsed.unit_payments ?? []).map((p: unknown) => {
    const r = p as Record<string, unknown>;
    const method = VALID_METHODS.includes(str(r.method)) ? str(r.method) : 'other';
    return { unit_label: str(r.unit_label), amount_usd: num(r.amount_usd), paid_on: r.paid_on ? str(r.paid_on) : null, method };
  }).filter(p => p.unit_label && p.amount_usd > 0);

  return json({ expenses, unit_charges, unit_payments });
});
