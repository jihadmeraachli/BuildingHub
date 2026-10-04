// One money formatter for the screen, following the reader's language.
//
// Every page used to carry its own `$${n.toLocaleString(...)}`: a dollar sign
// glued in front of whatever the browser did with the digits. In French that
// produced "$105.00" on the landing page (hardcoded en-US) and "$1 234,56" in
// the app (browser locale, English prefix) — neither is how French writes a
// price. Intl knows: "105,00 $" in French, "$105.00" in English, and Arabic
// with Latin digits because that is how Lebanon writes money.
//
// PDFs keep their own en-US helper on purpose: a statement is an English
// document whatever the reader's screen language.
import i18n from '@/i18n';

// Arabic deliberately formats as en-US. CLDR's ar-LB gives "1.234,50 US$"
// (German-style separators, a "US$" suffix, and bidi marks that let the minus
// drift to the wrong side of the number on a phone). Lebanon writes money as
// "$1,234.50" with Latin digits whatever the script around it, so the English
// shape is the correct Arabic one.
const LOCALE: Record<string, string> = { en: 'en-US', fr: 'fr-FR', ar: 'en-US' };
const cache = new Map<string, Intl.NumberFormat>();

function formatter(lang: string, digits = 2): Intl.NumberFormat {
  const loc = LOCALE[lang] ?? LOCALE.en;
  const key = `${loc}/${digits}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(loc, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits });
    cache.set(key, f);
  }
  return f;
}

/** Browsers may break a line right after a hyphen-minus, which put "-" on one
 *  line and "$13,700.00" on the next in a narrow tile. U+2212 (MINUS SIGN) is
 *  the typographically correct glyph and never a break opportunity. */
const noBreakMinus = (s: string) => s.replace(/^-/, '\u2212\u2060'); // minus + word joiner: never split from the "$"

/** Inside Arabic text the bidi algorithm pulls the sign and the "$" to the
 *  other side of the digits ("$261.92−", "261.92$"). Wrapping the figure in
 *  an LTR isolate (U+2066 … U+2069) keeps it exactly as written; the marks are
 *  invisible, so they are only added for RTL to keep English strings plain. */
const isolate = (s: string, lang: string) => (lang === 'ar' ? `\u2066${s}\u2069` : s);

/** "$1,234.56" · "1 234,56 $" · "1,234.56 $" — the current UI language unless given. */
export function fmtMoney(n: number, lang: string = i18n.language): string {
  const l = (lang || 'en').slice(0, 2);
  return isolate(noBreakMinus(formatter(l).format(n)), l);
}

/** Same, for a value held in cents (pricing tables). */
export const fmtMoneyCents = (cents: number, lang?: string) => fmtMoney(cents / 100, lang);

/** Whole dollars, for tight stat tiles where "$14,420.00" wraps mid-number on
 *  a phone. Rounds half-up on magnitude so -$14,420.50 reads -$14,421, not
 *  -$14,420 (JS rounds toward +∞ on .5). Cents stay in the row beneath. */
export function fmtMoneyWhole(n: number, lang: string = i18n.language): string {
  const whole = Math.sign(n) * Math.round(Math.abs(n));
  const l = (lang || 'en').slice(0, 2);
  return isolate(noBreakMinus(formatter(l, 0).format(whole === 0 ? 0 : whole)), l);
}
