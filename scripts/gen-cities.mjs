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

/** Search key: lowercase, accents stripped, punctuation flattened. Makes
 *  "Zahle" match "Zahlé" and "achrafieh" match "El Achrafiyé". */
const norm = (s) => s.normalize('NFD').replace(/[̀-ًͯ-ْ]/g, '')
  .toLowerCase().replace(/[’'`\-.]/g, '').replace(/\s+/g, ' ').trim();

const isLatin = (s) => /^[\p{Script=Latin}\p{N}\s'’`\-.()]+$/u.test(s);
const isArabic = (s) => /\p{Script=Arabic}/u.test(s);

// The old hand-curated list is the spelling Lebanese users actually type and
// what existing records already store, so it wins over GeoNames' French
// transliteration ("Achrafieh", not "El Achrafiyé").
const PREFERRED = ['Achrafieh', 'Hamra', 'Verdun', 'Badaro', 'Gemmayzeh', 'Mar Mikhael', 'Sodeco',
  'Ras Beirut', 'Raouche', 'Moussaitbeh', 'Mazraa', 'Ain Mreisseh', 'Zahle', 'Tripoli', 'Jounieh',
  'Baalbek', 'Aley', 'Antelias', 'Baabda', 'Bikfaya', 'Broummana', 'Beit Mery', 'Bsalim', 'Chekka',
  'Chiyah', 'Chtaura', 'Dbayeh', 'Dekwaneh', 'Ehden', 'Fanar', 'Ghazir', 'Hasbaya', 'Hermel',
  'Jdeideh', 'Jezzine', 'Khiam', 'Mansourieh', 'Marjeyoun', 'Nabatieh', 'Naccache', 'Sarba',
  'Zalka', 'Zgharta', 'Zouk Mikael', 'Bourj Hammoud', 'Bint Jbeil', 'Anjar', 'Enfe', 'Bcharre'];
const preferredByNorm = new Map(PREFERRED.map(p => [norm(p), p]));

const rows = [];
const seen = new Set();
for (const line of readFileSync(join(work, 'LB.txt'), 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 15) continue;
  let name = f[1]?.trim();
  if (f[6] !== 'P' || !KEEP.has(f[7]) || !name) continue;
  const ascii = (f[2] ?? '').trim();
  const alts = (f[3] ?? '').split(',').map(s => s.trim()).filter(Boolean);

  // Search terms: every Latin spelling GeoNames knows, plus one Arabic form so
  // the Arabic UI can be searched in Arabic. Normalised and deduped.
  const latin = [name, ascii, ...alts.filter(isLatin)];
  const arabic = alts.find(isArabic);

  // Adopt the familiar spelling as the display name when we know one.
  for (const cand of latin) {
    const pref = preferredByNorm.get(norm(cand));
    if (pref) { name = pref; break; }
  }

  // EVERY normalised spelling, kept for de-duplication only. GeoNames often
  // carries the same place twice ("Achrafieh" and "El Achrafiyé"); without
  // matching on the full spelling set they survive as visible duplicates.
  const keys = new Set(latin.map(norm).filter(Boolean));

  // Alternate spellings are only worth their bundle weight at RUNTIME for
  // places someone might type a variant of — inhabited places and
  // administrative seats. The ~3,000 unpopulated hamlets carry the name alone;
  // accent-insensitive matching still finds them.
  const worthAliases = Number(f[14] || 0) > 0 || /^PPL[AC]/.test(f[7]);
  let aliases = [];
  if (worthAliases) {
    const emit = new Set(keys);
    emit.delete(norm(name));
    aliases = [...emit].slice(0, 3);
    if (arabic) aliases.push(norm(arabic));
  }

  const gov = govByCode.get(f[10]) ?? '';
  const key = `${name}|${gov}`;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push({ name, gov, aliases, keys, preferred: preferredByNorm.has(norm(name)) });
}

// Collapse rows that are the same place under different spellings. Two rows in
// the same governorate that share ANY normalised spelling are one place — keep
// the familiar name where we have one, else the shorter label.
{
  const byGov = new Map();
  for (const r of rows) {
    if (!byGov.has(r.gov)) byGov.set(r.gov, []);
    byGov.get(r.gov).push(r);
  }
  const dropped = new Set();
  for (const group of byGov.values()) {
    const claim = new Map(); // normalised spelling -> winning row
    for (const r of group) {
      let target = null;
      for (const k of r.keys) if (claim.has(k)) { target = claim.get(k); break; }
      if (target && target !== r) {
        // Merge into the winner, preferring the familiar spelling.
        if (r.preferred && !target.preferred) {
          target.name = r.name;
          target.preferred = true;
        }
        for (const k of r.keys) { target.keys.add(k); if (!claim.has(k)) claim.set(k, target); }
        for (const a of r.aliases) if (!target.aliases.includes(a)) target.aliases.push(a);
        target.aliases = target.aliases.filter(a => a !== norm(target.name)).slice(0, 4);
        dropped.add(r);
        continue;
      }
      for (const k of r.keys) if (!claim.has(k)) claim.set(k, r);
    }
  }
  if (dropped.size) console.log(`merged ${dropped.size} duplicate spellings`);
  for (let i = rows.length - 1; i >= 0; i--) if (dropped.has(rows[i])) rows.splice(i, 1);
}

for (const [name, gov] of SUPPLEMENT) {
  const key = `${name}|${gov}`;
  if (seen.has(key)) continue;
  // Skip if GeoNames already covers this place under any spelling — the
  // supplement fills gaps, it must not create near-duplicates.
  const n = norm(name);
  if (rows.some(r => r.keys.has(n))) continue;
  seen.add(key);
  rows.push({ name, gov, aliases: [], keys: new Set([n]), preferred: true });
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
const packed = out
  .map(r => `${r.name}|${r.gov ? govs.indexOf(r.gov) : ''}|${(r.aliases ?? []).join(';')}`)
  .join('\n');

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
  /** Normalised alternate spellings, search only (never displayed). Lets
   *  "achrafieh" find "Achrafieh" and Arabic queries find Latin names. */
  aliases: string[];
}

const GOVERNORATES = ${JSON.stringify(govs)};

/** name|governorateIndex|alias;alias — compact on purpose (bundle size). */
const PACKED = \`${packed}\`;

export const LEBANON_PLACES: LebanonPlace[] = PACKED.split('\\n').map(line => {
  const [name, gi, alias] = line.split('|');
  return {
    name,
    governorate: gi === '' ? '' : GOVERNORATES[Number(gi)],
    label: name,
    aliases: alias ? alias.split(';') : [],
  };
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

/** Normalise a query the same way the aliases were built, so accents,
 *  apostrophes and case never decide whether a place is findable. */
export const normalizePlace = (s: string): string =>
  s.normalize('NFD').replace(/[\\u0300-\\u036f\\u064b-\\u0652]/g, '')
    .toLowerCase().replace(/[’'\`\\-.]/g, '').replace(/\\s+/g, ' ').trim();

export const COUNTRIES${countries}`;

writeFileSync('src/lib/locationData.ts', file, 'utf8');
rmSync(work, { recursive: true, force: true });

const has = (n) => out.some(r => r.name.toLowerCase().includes(n.toLowerCase()));
console.log(`wrote ${out.length} places`);
console.log('governorates:', govs.join(', '));
for (const probe of ['Qoraytem', 'Khaiyat', 'Achrafi', 'Hamra', 'Verdun', 'Badaro', 'Tripoli', 'Zahl'])
  console.log(`  ${probe}: ${has(probe) ? 'found' : 'MISSING'}`);
