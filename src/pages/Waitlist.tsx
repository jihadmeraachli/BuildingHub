import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/ui/Logo';
import { Wordmark } from '@/components/ui/Wordmark';
import { WaitlistForm } from '@/components/WaitlistForm';
import { LanguagePicker } from '@/components/ui/LanguagePicker';

/**
 * The public waitlist page, deliberately OUTSIDE the beta gate (App.tsx routes
 * it beside /privacy and /terms). Marketing posts can link straight here while
 * the rest of the site is still closed, which is the whole point: the gate
 * offers a code or nothing, and everyone without a code was bouncing.
 *
 * Everything is above the fold and there is one field. A visitor arriving from
 * a phone should be able to finish in a thumb-tap and a typed address.
 */
export default function Waitlist() {
  const { t } = useTranslation();
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{ background: 'linear-gradient(135deg, oklch(0.38 0.14 185) 0%, oklch(0.22 0.05 185) 100%)' }}
    >
      <div className="w-full max-w-md bg-card rounded-2xl shadow-2xl border border-border p-8">
        <div className="flex items-center justify-between gap-3 mb-8">
          <div className="flex items-center gap-2.5">
            <Logo size={30} />
            <Wordmark className="text-sm text-foreground" />
          </div>
          <LanguagePicker variant="app" />
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-2">{t('waitlist.title')}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">{t('waitlist.blurb')}</p>

        <WaitlistForm source="landing" />

        <p className="mt-4 text-xs text-muted-foreground leading-relaxed">{t('waitlist.privacyNote')}</p>

        {/* Same brand↔legal-entity line the gate carries: this page is now
            also a surface an external reviewer can reach without a code. */}
        <p className="mt-8 text-[11px] text-muted-foreground/60 text-center">
          Abniyah {t('landing.productOf')} Tatawwor
        </p>
      </div>
    </div>
  );
}
