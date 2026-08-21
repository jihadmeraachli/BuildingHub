// ============================================================
// Language picker.
//
// It was a cycling button, which is the right control for TWO languages and
// the wrong one for three. With English, Arabic and French a cycle hides the
// options (you see one letter and cannot tell what else exists) and makes some
// choices two clicks away — from Arabic back to English you had to pass
// through French. Worse, the button showed the language you would GET, so on
// an English page it read "عر", and people reasonably read that as a label
// saying the page was Arabic.
//
// So: show the CURRENT language, open a list of all of them, mark the one in
// use. Boring, and legible at a glance.
//
// Deliberately not a Radix Select: this sits in the corner of the public
// marketing page as well as inside the app, and it must work on a dark
// gradient that does not use the theme tokens. Sixty lines of plain React
// beats making the marketing page depend on the app's design system.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Check } from 'lucide-react';
import { setLanguage } from '@/i18n';
import { LANGUAGES, type Language } from '@/lib/languages';
import { cn } from '@/lib/utils';

interface Props {
  /** `dark` for the marketing pages, which paint their own ground and cannot
   *  read the app's theme tokens. */
  variant?: 'app' | 'dark';
  /** Header uses this to persist the choice to the profile (0060), so it
   *  follows the person onto every device and into their notifications. */
  onChange?: (lang: Language) => void;
  className?: string;
}

export function LanguagePicker({ variant = 'app', onChange, className }: Props) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];
  const dark = variant === 'dark';

  // Click-away and Escape. Without these the menu strands itself open on a
  // phone, where there is no obvious way to dismiss it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(code: Language) {
    setLanguage(code);
    setOpen(false);
    onChange?.(code);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={current.label}
        className={cn(
          'flex items-center gap-1.5 text-sm font-medium cursor-pointer transition-colors',
          dark ? 'text-white/70 hover:text-white' : 'text-muted-foreground hover:text-foreground',
          className,
        )}
      >
        <Globe size={15} />
        {current.short}
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            'absolute end-0 top-full mt-2 min-w-[10rem] z-50 rounded-xl border p-1 shadow-lg',
            dark ? 'border-white/15 bg-[oklch(0.2_0.05_186)]' : 'border-border bg-popover',
          )}
        >
          {LANGUAGES.map((l) => {
            const active = l.code === current.code;
            return (
              <button
                key={l.code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(l.code)}
                // Each entry is written in its own language and its own
                // direction, so Arabic reads right-to-left inside an English
                // menu rather than being laid out backwards.
                dir={l.dir}
                className={cn(
                  'w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-start cursor-pointer transition-colors',
                  dark
                    ? active ? 'bg-white/15 text-white font-semibold' : 'text-white/75 hover:bg-white/10'
                    : active ? 'bg-accent text-foreground font-semibold' : 'text-muted-foreground hover:bg-accent/60',
                )}
              >
                <span>{l.label}</span>
                {active && <Check size={14} className="shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
