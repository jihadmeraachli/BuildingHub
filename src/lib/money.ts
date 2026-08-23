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

const LOCALE: Record<string, string> = { en: 'en-US', fr: 'fr-FR', ar: 'ar-LB-u-nu-latn' };
const cache = new Map<string, Intl.NumberFormat>();

function formatter(lang: string): Intl.NumberFormat {
  const loc = LOCALE[lang] ?? LOCALE.en;
  let f = cache.get(loc);
  if (!f) {
    f = new Intl.NumberFormat(loc, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    cache.set(loc, f);
  }
  return f;
}

/** "$1,234.56" · "1 234,56 $" · "1,234.56 $" — the current UI language unless given. */
export function fmtMoney(n: number, lang: string = i18n.language): string {
  return formatter((lang || 'en').slice(0, 2)).format(n);
}

/** Same, for a value held in cents (pricing tables). */
export const fmtMoneyCents = (cents: number, lang?: string) => fmtMoney(cents / 100, lang);
