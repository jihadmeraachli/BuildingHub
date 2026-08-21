import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';

/**
 * One email field, and nothing else asked for — the ask the content calendar
 * specified. locale and source ride along silently so a follow-up can go out
 * in the right language and we can tell which surface actually converts.
 *
 * ALREADY ON THE LIST IS SUCCESS. The unique index (0104) makes a second
 * submission a 23505. Treating that as an error would tell someone who simply
 * forgot they had signed up that something is broken, so it reads as success —
 * which is also true.
 */
export function WaitlistForm({ source, className = '' }: { source: 'gate' | 'landing'; className?: string }) {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  // Bots fill every field they find; people never see this one.
  const [trap, setTrap] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value || busy) return;
    // Silently accept and drop: telling a bot it was caught teaches it.
    if (trap) { setDone(true); return; }

    setBusy(true);
    setError('');
    const { error: err } = await supabase.from('waitlist').insert({
      email: value,
      locale: i18n.language,
      source,
    });
    setBusy(false);

    if (err && err.code !== '23505') {
      // 23514 is the database's own email-shape check — the one error worth
      // spelling out, because the visitor can fix it.
      setError(err.code === '23514' ? t('waitlist.badEmail') : t('waitlist.failed'));
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className={`flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 ${className}`}>
        <Check size={16} className="text-primary shrink-0" />
        <p className="text-sm font-medium text-primary">{t('waitlist.thanks')}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={`space-y-2 ${className}`} noValidate>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="waitlist-email">{t('waitlist.emailLabel')}</label>
        <input
          id="waitlist-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(''); }}
          placeholder={t('waitlist.placeholder')}
          className="flex-1 min-w-0 rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {/* Honeypot: off-screen rather than display:none, which some bots skip. */}
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={trap}
          onChange={(e) => setTrap(e.target.value)}
          className="absolute -left-[9999px] h-0 w-0 opacity-0"
        />
        <Button type="submit" disabled={!email.trim() || busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : t('waitlist.join')}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
