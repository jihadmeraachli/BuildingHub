// Regenerates the Lebanon place list in src/lib/locationData.ts from GeoNames.
//
//   node scripts/gen-cities.mjs
//
// Source: https://download.geonames.org/export/dump/  (CC BY 4.0)
//
// Notes on the data:
//  - GeoNames has NO district (caza) linkage for Lebanon — only 8 of ~3,700
//    populated places carry an admin2 code — so we disambiguate duplicate names
//    by GOVERNORATE (mohafaza), which is fully populated.
//  - Feature code PPLX ("section of a populated place") is what Achrafieh,
//    Hamra, Qoraytem and Tallet el Khayyat actually are, so it is included.
//  - Output is a compact delimited string parsed at import time: an array of
//    objects would be ~5x the bundle size for no benefit.
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const work = mkdtempSync(join(tmpdir(), 'geonames-'));
const get = async (url, name) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  writeFileSync(join(work, name), Buffer.from(await res.arrayBuffer()));
  return join(work, name);
};

console.log('downloading GeoNames…');
await get('https://download.geonames.org/export/dump/LB.zip', 'LB.zip');
const admin1Path = await get('https://download.geonames.org/export/dump/admin1CodesASCII.txt', 'admin1.txt');
execFileSync('powershell', ['-NoProfile', '-Command',
  `Expand-Archive -Path '${join(work, 'LB.zip')}' -DestinationPath '${work}' -Force`]);

const govByCode = new Map();
for (const line of readFileSync(admin1Path, 'utf8').split('\n')) {
  const [code, name] = line.split('\t');
  // GeoNames labels some "X Governorate" and others just "X" — normalise.
  if (code?.startsWith('LB.')) govByCode.set(code.slice(3), name.trim().replace(/\s+Governorate$/, ''));
}

// GeoNames is thin on Beirut quarters — it has Achrafieh and Hamra but not
// Qoraytem or Tallet el Khayyat. These are the well-known neighbourhoods it
// misses, plus the legacy hand-list entries whose spelling differs from
// GeoNames, so no city already stored on a record becomes unselectable.
const SUPPLEMENT = [
  ['Qoraytem', 'Beirut'], ['Tallet el Khayyat', 'Beirut'], ['Ain el Tineh', 'Beirut'],
  ['Sanayeh', 'Beirut'], ['Kantari', 'Beirut'], ['Clemenceau', 'Beirut'],
  ['Minet el Hosn', 'Beirut'], ['Wata Msaytbeh', 'Beirut'], ['Tarik el Jdideh', 'Beirut'],
  ['Mar Elias', 'Beirut'], ['Barbir', 'Beirut'], ['Basta Tahta', 'Beirut'],
  ['Basta Fawka', 'Beirut'], ['Noueiri', 'Beirut'], ['Ras el Nabaa', 'Beirut'],
  ['Bachoura', 'Beirut'], ['Saifi', 'Beirut'], ['Rmeil', 'Beirut'],
  ['Medawar', 'Beirut'], ['Karm el Zeitoun', 'Beirut'], ['Sioufi', 'Beirut'],
  ['Furn el Hayek', 'Beirut'], ['Adlieh', 'Beirut'], ['Sodeco', 'Beirut'],
  ['Mathaf', 'Beirut'], ['Corniche el Mazraa', 'Beirut'], ['Ramlet el Baida', 'Beirut'],
  ['Manara', 'Beirut'], ['Snoubra', 'Beirut'], ['Jnah', 'Beirut'],
  ['Bir Hassan', 'Beirut'], ['Ouzai', 'Beirut'], ['Zokak el Blat', 'Beirut'],
  ['Zarif', 'Beirut'], ['Tayyouneh', 'Beirut'], ['Badaro', 'Beirut'],
  ['Gemmayzeh', 'Beirut'], ['Mar Mikhael', 'Beirut'], ['Karantina', 'Beirut'],
  ['Ain Mreisseh', 'Beirut'], ['Raouche', 'Beirut'], ['Verdun', 'Beirut'],
  ['Ras Beirut', 'Beirut'], ['Moussaitbeh', 'Beirut'], ['Mazraa', 'Beirut'],
  // legacy list spellings that differ from GeoNames
  ['Byblos (Jbeil)', 'Mount Lebanon'], ['Sidon (Saida)', 'South'], ['Tyre (Sour)', 'South'],
  ['Metn', 'Mount Lebanon'], ['Koura', 'North Lebanon'], ['Akkar', 'Akkar'],
  ['West Bekaa', 'Bekaa'], ['Minyeh', 'North Lebanon'], ['Furn el Chebbak', 'Mount Lebanon'],
  ['Jal el Dib', 'Mount Lebanon'], ['Sin el Fil', 'Mount Lebanon'], ['Dora', 'Mount Lebanon'],
  ['Bourj el Barajneh', 'Mount Lebanon'], ['Haret Hreik', 'Mount Lebanon'],
  ['Hazmiyeh', 'Mount Lebanon'], ['Dekwaneh', 'Mount Lebanon'], ['Kaslik', 'Mount Lebanon'],
];

const KEEP = new Set(['PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLC', 'PPLX', 'PPLL', 'PPLS']);

const rows = [];
const seen = new Set();
for (const line of readFileSync(join(work, 'LB.txt'), 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 15) continue;
  const name = f[1]?.trim();
  if (f[6] !== 'P' || !KEEP.has(f[7]) || !name) continue;
  const gov = govByCode.get(f[10]) ?? '';
  const key = `${name}|${gov}`;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push({ name, gov });
}

for (const [name, gov] of SUPPLEMENT) {
  const key = `${name}|${gov}`;
  if (seen.has(key)) continue;
  // Skip only if GeoNames already has this exact name somewhere — the
  // supplement exists to fill gaps, not to create near-duplicates.
  if (rows.some(r => r.name.toLowerCase() === name.toLowerCase())) continue;
  seen.add(key);
  rows.push({ name, gov });
}

// A bare name is stored as-is when it is unique country-wide; otherwise the
// governorate disambiguates it, so the stored value stays unique and groups
// cleanly in reports.
const count = new Map();
for (const r of rows) count.set(r.name, (count.get(r.name) ?? 0) + 1);
// Parentheses, not an em-dash: the repo bans em-dashes in user-facing copy,
// and this matches the existing "Byblos (Jbeil)" style.
for (const r of rows) r.label = count.get(r.name) > 1 && r.gov ? `${r.name} (${r.gov})` : r.name;

const byLabel = new Map();
for (const r of rows) if (!byLabel.has(r.label)) byLabel.set(r.label, r);
const out = [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label, 'en'));

const govs = [...new Set(out.map(r => r.gov).filter(Boolean))].sort();
const packed = out.map(r => `${r.name}|${r.gov ? govs.indexOf(r.gov) : ''}`).join('\n');

const existing = readFileSync('src/lib/locationData.ts', 'utf8');
const countries = existing.split('export const COUNTRIES')[1];

const file = `// The city list is AUTO-GENERATED — regenerate with \`node scripts/gen-cities.mjs\`
// rather than hand-editing it. Source: GeoNames (https://www.geonames.org/), CC BY 4.0.
//
// Every populated place in Lebanon, including city quarters such as Achrafieh,
// Hamra and Qoraytem (GeoNames classes them as "sections of a populated
// place"). GeoNames carries no district/caza linkage for Lebanon, so where two
// places share a name the GOVERNORATE disambiguates: "Deir el Ahmar (Baalbek-Hermel)".
//
// \`label\` is what we store on the record AND what the user sees — one canonical
// string, so reports group reliably. Governorate is kept alongside so city and
// area can be split into separate columns later without re-collecting anything.

export interface LebanonPlace {
  /** Canonical stored value, and the display label. */
  label: string;
  /** Bare place name, no disambiguating suffix. */
  name: string;
  /** Mohafaza. Empty for the handful GeoNames leaves unassigned. */
  governorate: string;
}

const GOVERNORATES = ${JSON.stringify(govs)};

/** name|governorateIndex, one per line — compact on purpose (bundle size). */
const PACKED = \`${packed}\`;

export const LEBANON_PLACES: LebanonPlace[] = PACKED.split('\\n').map(line => {
  const sep = line.lastIndexOf('|');
  const name = line.slice(0, sep);
  const gi = line.slice(sep + 1);
  const governorate = gi === '' ? '' : GOVERNORATES[Number(gi)];
  return { name, governorate, label: name, };
});

// Re-apply the duplicate rule at runtime so label stays in sync with the data.
{
  const seen = new Map<string, number>();
  for (const p of LEBANON_PLACES) seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
  for (const p of LEBANON_PLACES) {
    if ((seen.get(p.name) ?? 0) > 1 && p.governorate) p.label = \`\${p.name} (\${p.governorate})\`;
  }
  LEBANON_PLACES.sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

/** Canonical values only — what gets stored on a building/compound/profile. */
export const LEBANON_CITIES: string[] = LEBANON_PLACES.map(p => p.label);

export const COUNTRIES${countries}`;

writeFileSync('src/lib/locationData.ts', file, 'utf8');
rmSync(work, { recursive: true, force: true });

const has = (n) => out.some(r => r.name.toLowerCase().includes(n.toLowerCase()));
console.log(`wrote ${out.length} places`);
console.log('governorates:', govs.join(', '));
for (const probe of ['Qoraytem', 'Khaiyat', 'Achrafi', 'Hamra', 'Verdun', 'Badaro', 'Tripoli', 'Zahl'])
  console.log(`  ${probe}: ${has(probe) ? 'found' : 'MISSING'}`);
