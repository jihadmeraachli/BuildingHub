import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookOpenCheck, Wallet, MessageSquareText, Wrench, CalendarCheck2, Building2, Globe,
} from 'lucide-react';
import { setLanguage } from '@/i18n';
import { Logo } from '@/components/ui/Logo';
import { Wordmark } from '@/components/ui/Wordmark';

/**
 * Public landing page, served on the ROOT domain (abniyah.com) — see the
 * hostname branch in App.tsx. Deliberately outside the beta gate and auth:
 * this page is the public face of the product and the verifiable link between
 * the Abniyah brand and Tatawwor (the registered business) — evidence pages
 * like Meta's WhatsApp display-name review land here.
 * Bilingual: the language toggle drives i18n, and the global languageChanged
 * handler flips document direction for RTL.
 */

const FEATURES = [
  { key: 'f1', icon: BookOpenCheck },
  { key: 'f2', icon: Wallet },
  { key: 'f3', icon: MessageSquareText },
  { key: 'f4', icon: Wrench },
  { key: 'f5', icon: CalendarCheck2 },
  { key: 'f6', icon: Building2 },
];

export default function Landing() {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    document.title = t('landing.docTitle');
  }, [t, i18n.language]);

  return (
    <div
      className="min-h-screen text-white"
      style={{ background: 'linear-gradient(150deg, oklch(0.32 0.11 185) 0%, oklch(0.2 0.05 186) 45%, oklch(0.13 0.03 190) 100%)' }}
    >
      {/* Header */}
      <header className="max-w-5xl mx-auto flex items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <Logo size={34} variant="white" />
          <Wordmark className="text-sm" />
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setLanguage(i18n.language === 'ar' ? 'en' : 'ar')}
            className="flex items-center gap-1.5 text-sm font-medium text-white/70 hover:text-white cursor-pointer"
          >
            <Globe size={15} />
            {i18n.language === 'ar' ? 'EN' : 'عر'}
          </button>
          <a
            href="https://app.abniyah.com"
            className="rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-2 text-sm font-semibold transition-colors"
          >
            {t('landing.openApp')}
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-16 pb-20 text-center">
        <h1
          className="text-4xl sm:text-5xl font-bold leading-tight mb-4"
          style={{
            background: 'linear-gradient(100deg, oklch(1 0 0) 0%, oklch(0.75 0.02 185) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {t('auth.heroTitle1')} {t('auth.heroTitle2')}
        </h1>
        <p className="text-lg text-white/80 max-w-2xl mx-auto">
          {t('auth.heroTagline')}
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <a
            href="https://app.abniyah.com"
            className="rounded-xl bg-white text-[oklch(0.25_0.08_185)] px-6 py-3 text-sm font-bold hover:bg-white/90 transition-colors"
          >
            {t('landing.openApp')}
          </a>
          <span className="text-sm text-white/50">{t('landing.privateBeta')}</span>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(f => (
            <div key={f.key} className="rounded-2xl bg-white/5 border border-white/10 p-6">
              <f.icon size={22} className="text-[oklch(0.85_0.09_180)] mb-3" />
              <h3 className="font-semibold mb-1.5">{t(`landing.features.${f.key}.title`)}</h3>
              <p className="text-sm text-white/65 leading-relaxed">{t(`landing.features.${f.key}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Who it's for */}
      <section className="max-w-5xl mx-auto px-6 pb-24 text-center">
        <p className="text-white/70 max-w-2xl mx-auto text-sm leading-relaxed">
          {t('landing.whoFor')}
        </p>
      </section>

      {/* Footer — the brand ↔ legal-entity link lives here, publicly. */}
      <footer className="border-t border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Logo size={20} variant="white" />
            <span className="text-xs text-white/60">
              © {new Date().getFullYear()} Abniyah, {t('landing.productOf')} <strong className="text-white/80">Tatawwor</strong>. {t('landing.rights')}
            </span>
          </div>
          <span className="flex gap-4 text-xs text-white/60">
            <a className="hover:text-white transition-colors" href="/privacy">{t('landing.privacy')}</a>
            <a className="hover:text-white transition-colors" href="/terms">{t('landing.terms')}</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
