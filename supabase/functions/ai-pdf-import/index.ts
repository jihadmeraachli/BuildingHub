const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY secret not set on this edge function.' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  let pdf: string;
  try {
    ({ pdf } = await req.json());
    if (!pdf) throw new Error('missing pdf field');
  } catch {
    return new Response(
      JSON.stringify({ error: 'Request body must contain a base64-encoded "pdf" field.' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `You are a data extraction assistant for a building management system.
Extract structured unit/apartment records from the document.
Respond with valid JSON only — no explanation, no markdown fences.`,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdf,
              },
            },
            {
              type: 'text',
              text: `Extract every apartment or unit record from this building management document.

Return a JSON object with a single "rows" array. Each element represents one unit:
{
  "unit_label":  string  — unit/apartment identifier (see rules below)
  "balance_due": number  — outstanding balance in USD; use 0 if not found or already paid
  "owner_name":  string  — owner or resident full name; "" if not found
  "owner_phone": string  — phone number; "" if not found
  "notes":       string  — any extra info; "" if nothing relevant
}

Rules for unit_label (most important — read carefully):
- If the document has a single clear unit/apartment number column (شقة رقم, apt no., unit no.), use it directly.
- If the document identifies units by FLOOR + DIRECTION (e.g. columns like الطابق + الجهة, floor + side, étage + orientation), COMBINE them into one label using the pattern: "{floor} {direction}". Examples: "1 East", "2 West", "3 North", "الطابق 2 شرق". Translate direction words to English: شرق→East, غرب→West, شمال→North, جنوب→South, وسط→Center, شرقي→East, غربي→West, شمالي→North, جنوبي→South.
- If the document has BOTH a unit number AND floor+direction, prefer the floor+direction combination as it is more descriptive (e.g. "2 East" rather than "3").
- A sequential row counter (1, 2, 3…) is NOT a unit label — skip it or look for another column.
- Every unit_label must be non-empty and unique; skip rows where you cannot determine an identifier.

Rules for balance_due:
- Look for a column that represents the CURRENT or FINAL net balance for each unit. It may be named: رصيد, ارصدة, صافي, balance, net, solde, or a column header that contains a month/year (e.g. "ارصدة شهر ح 2026", "balance June 2026").
- When multiple period/month columns exist, use the LAST (rightmost / most recent) one.
- Use the value as-is — positive means the unit owes money, negative means credit, 0 means settled.
- Do NOT zero out negative or zero values; preserve the actual number.
- If no balance column exists at all, use 0.

Other rules:
- Keep Arabic owner names in Arabic as-is.
- Convert Arabic-Indic numerals (٠١٢٣٤٥٦٧٨٩) to Western digits in ALL numeric fields AND in unit_label.
- Skip header rows, total/sum rows, and blank rows.

Respond with ONLY this JSON (no other text):
{"rows": [...]}`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return new Response(
      JSON.stringify({ error: `Anthropic API error: ${err}` }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  const result = await response.json();
  const text: string = result.content?.[0]?.text ?? '{}';

  const match = text.match(/\{[\s\S]*\}/);
  let rows: unknown[] = [];
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      rows = Array.isArray(parsed.rows) ? parsed.rows : [];
    } catch { /* leave empty */ }
  }

  // Sanitise rows: ensure correct types, fill defaults
  const sanitised = rows.map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return {
      unit_label:  String(row.unit_label  ?? '').trim(),
      balance_due: typeof row.balance_due === 'number' ? row.balance_due : parseFloat(String(row.balance_due ?? '0')) || 0,
      owner_name:  String(row.owner_name  ?? ''),
      owner_phone: String(row.owner_phone ?? ''),
      notes:       String(row.notes       ?? ''),
    };
  }).filter(r => r.unit_label !== '');

  return new Response(
    JSON.stringify({ rows: sanitised }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
});
