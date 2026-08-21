// ============================================================
// The languages Abniyah speaks, in one place.
//
// Before French there were two, and every toggle in the app hardcoded the pair
// as `lang === 'ar' ? 'en' : 'ar'` — six of them, in the header, on the landing
// page, on Login, Register, Legal and in Settings. A third language turned all
// six into bugs at once. They read this list now, so a fourth is one entry.
//
// WHY FRENCH (2026-08-21). It is the one competitor feature worth taking
// seriously: Binayati ships it and we do not. A large slice of Lebanese
// syndics, notaries and older committee members work in French, and for them
// its absence is disqualifying before the demo starts. It is also the cheapest
// of our three known gaps to close — payments need Whish, proof needs
// customers and time, French needs a file. And unlike Arabic it is
// left-to-right, so none of the RTL work repeats.
//
// ⚠️ profiles.preferred_language has a CHECK constraint listing these codes
// (0060, extended by 0101). Adding a language here means extending it there.
// ============================================================

export type Language = 'en' | 'ar' | 'fr';

export interface LanguageDef {
  code: Language;
  /** Written in the language itself: a French speaker looks for "Français",
   *  not for "French". */
  label: string;
  /** The two-or-three letters on the compact toggle. */
  short: string;
  dir: 'ltr' | 'rtl';
}

export const LANGUAGES: LanguageDef[] = [
  { code: 'en', label: 'English',  short: 'EN', dir: 'ltr' },
  { code: 'ar', label: 'العربية',  short: 'عر', dir: 'rtl' },
  { code: 'fr', label: 'Français', short: 'FR', dir: 'ltr' },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (LANGUAGE_CODES as string[]).includes(v);
}

export function dirOf(lang: string): 'ltr' | 'rtl' {
  return LANGUAGES.find((l) => l.code === lang)?.dir ?? 'ltr';
}

export function labelOf(lang: string): string {
  return LANGUAGES.find((l) => l.code === lang)?.label ?? lang;
}

/**
 * The next language in the ring, for the compact one-button toggles.
 *
 * A cycle rather than a dropdown on purpose: with three languages a button is
 * still the right control, and every one of those toggles sits in a header or
 * a corner where a select would be heavier than the thing it selects. The
 * button shows the language you would GET, not the one you are in — otherwise
 * nobody can tell whether it is a label or an action.
 */
export function nextLanguage(current: string): LanguageDef {
  const i = LANGUAGES.findIndex((l) => l.code === current);
  return LANGUAGES[(i + 1) % LANGUAGES.length];
}
