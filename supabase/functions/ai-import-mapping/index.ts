const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are a data-mapping assistant for a building management system.
Your only job is to map Excel column headers to database field names.
Always respond with valid JSON only — no explanation, no markdown.`;

const USER_PROMPT = (headers: string[], samples: Record<string, string>[]) => `
Map each Excel column header to the best matching database field.

Headers: ${JSON.stringify(headers)}

Sample data (up to 5 rows):
${JSON.stringify(samples, null, 2)}

Available fields:
- unit_label    : apartment / unit number or identifier  (e.g. "101", "A3", "الشقة ٣")
- balance_due   : outstanding balance this unit owes, in USD (numeric)
- share_weight  : unit weight for expense allocation (numeric, default 1)
- occupancy     : status — occupied / vacant / abroad
- owner_name    : full name of the unit owner or tenant
- owner_phone   : owner phone number
- notes         : any extra notes or description
- SKIP          : column is not useful — ignore it

Rules:
- Every header must map to exactly one field or SKIP.
- If two headers could map to the same field, pick the most likely one and SKIP the other.
- If a header is in Arabic, infer meaning from context and sample values.

Respond with ONLY this JSON (no other text):
{"mappings": {"<header>": "<field>", ...}}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY secret not set on this edge function.' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  let headers: string[], samples: Record<string, string>[];
  try {
    ({ headers, samples } = await req.json());
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid request body' }),
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
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: USER_PROMPT(headers, samples) }],
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

  // Extract the JSON object even if the model wraps it in extra text
  const match = text.match(/\{[\s\S]*\}/);
  let mappings: Record<string, string> = {};
  if (match) {
    try { mappings = JSON.parse(match[0]).mappings ?? {}; } catch { /* leave empty */ }
  }

  return new Response(
    JSON.stringify({ mappings }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
});
