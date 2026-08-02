// ============================================================
// Locale-aware date formatting.
//
// Every page called date-fns `format()` with no locale, so month and weekday
// names rendered in English even with the app in Arabic — "Aug 1, 2026" on an
// otherwise Arabic screen. date-fns defaults to en-US when no locale is passed
// and has no global switch: the locale must be supplied at every call site, so
// all of them go through here instead.
//
// The language is read from the i18n instance at call time rather than passed
// in, so this is a drop-in for `format(new Date(x), pattern)` anywhere —
// including sub-components and non-component helpers where a hook is not
// available. Components already re-render on language change (they use t()),
// so the next render picks up the new locale.
// ============================================================
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import i18n from '@/i18n';

/**
 * Format a date in the app's current language.
 * @param value Date or ISO string; null/invalid returns `fallback`.
 * @param pattern date-fns pattern, e.g. 'MMM d, yyyy'
 */
export function fmtDate(
  value: Date | string | null | undefined,
  pattern: string,
  fallback = '—',
): string {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return format(d, pattern, { locale: i18n.language?.startsWith('ar') ? ar : enUS });
}
