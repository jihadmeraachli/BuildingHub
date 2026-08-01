import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookOpenCheck, Wallet, MessageSquareText, Wrench, CalendarCheck2, Building2, Globe, Check,
} from 'lucide-react';
import { setLanguage } from '@/i18n';
import { Logo } from '@/components/ui/Logo';
import { Wordmark } from '@/components/ui/Wordmark';

/**
 * Public marketing page on the ROOT domain (abniyah.com) — see the hostname
 * branch in App.tsx. Outside the beta gate and auth; bilingual via the toggle
 * (global handler flips RTL). Also the public brand↔Tatawwor evidence page.
 * Screenshots live in /public/marketing (re-shoot with shoot-marketing.mjs).
 */

const FEATURES = [
  { key: 'f1', icon: BookOpenCheck },
  { key: 'f2', icon: Wallet },
  { key: 'f3', icon: MessageSquareText },
  { key: 'f4', icon: Wrench },
  { key: 'f5', icon: CalendarCheck2 },
  { key: 'f6', icon: Building2 },
];

function Shot({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/5 p-1.5 shadow-2xl shadow-black/40">
      <img src={src} alt={alt} loading="lazy" className="rounded-xl w-full" />
    </div>
  );
}

export default function Landing() {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    document.title = t('landing.docTitle');
  }, [t, i18n.language]);

  const showcases = [
    { key: 'book', img: '/marketing/shot-finance-en.jpg' },
    { key: 'setup', img: '/marketing/shot-setup-en.jpg' },
    { key: 'arabic', img: '/marketing/shot-dashboard-ar.jpg' },
  ];

  const faqs = ['privacy', 'arabic', 'payments', 'price', 'residents'];

  return (
    <div
      className="min-h-screen text-white"
      style={{ background: 'linear-gradient(150deg, oklch(0.32 0.11 185) 0%, oklch(0.2 0.05 186) 45%, oklch(0.13 0.03 190) 100%)' }}
    >
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-[oklch(0.2_0.05_186)]/70 border-b border-white/10">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-4">
          <a href="#" className="flex items-center gap-2.5">
            <Logo size={30} variant="white" />
            <Wordmark className="text-sm" />
          </a>
          <nav className="hidden md:flex items-center gap-6 text-sm text-white/70">
            <a className="hover:text-white transition-colors" href="#product">{t('landing.navProduct')}</a>
            <a className="hover:text-white transition-colors" href="#pricing">{t('landing.navPricing')}</a>
            <a className="hover:text-white transition-colors" href="#about">{t('landing.navAbout')}</a>
            <a className="hover:text-white transition-colors" href="#faq">{t('landing.navFaq')}</a>
          </nav>
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
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-16 pb-12 text-center">
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
        <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
          <a
            href="https://app.abniyah.com/register"
            className="rounded-xl bg-white text-[oklch(0.25_0.08_185)] px-6 py-3 text-sm font-bold hover:bg-white/90 transition-colors"
          >
            {t('landing.startTrial')}
          </a>
          <a
            href="https://app.abniyah.com/demo"
            className="rounded-xl bg-white/10 hover:bg-white/20 border border-white/25 px-6 py-3 text-sm font-semibold transition-colors"
          >
            {t('landing.liveDemo')}
          </a>
          <span className="text-sm text-white/50 basis-full text-center">{t('landing.trialNote')}</span>
        </div>
        <div className="mt-12 max-w-4xl mx-auto">
          <Shot src="/marketing/shot-dashboard-en.jpg" alt="Abniyah dashboard" />
        </div>
      </section>

      {/* Product showcases */}
      <section id="product" className="max-w-5xl mx-auto px-6 py-16 space-y-16">
        {showcases.map((s, i) => (
          <div key={s.key} className="grid md:grid-cols-2 gap-8 items-center">
            <div className={i % 2 === 1 ? 'md:order-2' : ''}>
              <h2 className="text-2xl font-bold mb-3">{t(`landing.show.${s.key}.title`)}</h2>
              <p className="text-white/70 leading-relaxed">{t(`landing.show.${s.key}.body`)}</p>
            </div>
            <div className={i % 2 === 1 ? 'md:order-1' : ''}>
              <Shot src={s.img} alt={t(`landing.show.${s.key}.title`)} />
            </div>
          </div>
        ))}
      </section>

      {/* Feature grid */}
      <section className="max-w-5xl mx-auto px-6 pb-16">
        <h2 className="text-2xl font-bold text-center mb-8">{t('landing.everythingElse')}</h2>
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

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-6 pb-16">
        <h2 className="text-2xl font-bold text-center mb-8">{t('landing.howTitle')}</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {['h1', 'h2', 'h3'].map((k, i) => (
            <div key={k} className="rounded-2xl bg-white/5 border border-white/10 p-6">
              <span className="inline-flex w-8 h-8 rounded-full bg-white/10 items-center justify-center text-sm font-bold mb-3">{i + 1}</span>
              <h3 className="font-semibold mb-1.5">{t(`landing.how.${k}.title`)}</h3>
              <p className="text-sm text-white/65 leading-relaxed">{t(`landing.how.${k}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-5xl mx-auto px-6 pb-16">
        <h2 className="text-2xl font-bold text-center mb-2">{t('landing.pricingTitle')}</h2>
        <p className="text-center text-white/60 text-sm mb-8">{t('landing.pricingSub')}</p>
        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
          {(['monthly', 'annual'] as const).map(plan => (
            <div
              key={plan}
              className={`relative rounded-2xl border p-6 ${plan === 'annual' ? 'border-[oklch(0.85_0.09_180)]/50 bg-white/[0.07]' : 'border-white/10 bg-white/5'}`}
            >
              {plan === 'annual' && (
                <span className="absolute -top-3 start-5 bg-[oklch(0.85_0.09_180)] text-[oklch(0.2_0.05_186)] text-xs font-bold px-2.5 py-0.5 rounded-full">
                  {t('register.save17')}
                </span>
              )}
              <p className="text-sm font-semibold text-white/70 uppercase tracking-wide mb-2">
                {plan === 'monthly' ? t('register.monthly') : t('register.annual')}
              </p>
              <p className="text-4xl font-bold">
                ${plan === 'monthly' ? 5 : 50}
                <span className="text-base font-medium text-white/60">
                  {plan === 'monthly' ? t('register.perUnitMonth') : t('register.perUnitYear')}
                </span>
              </p>
              <ul className="mt-5 space-y-2 text-sm text-white/75">
                {['p1', 'p2', 'p3'].map(k => (
                  <li key={k} className="flex items-start gap-2">
                    <Check size={15} className="mt-0.5 shrink-0 text-[oklch(0.85_0.09_180)]" />
                    {t(`landing.pricing.${k}`)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* About */}
      <section id="about" className="max-w-3xl mx-auto px-6 pb-16 text-center">
        <h2 className="text-2xl font-bold mb-4">{t('landing.aboutTitle')}</h2>
        <p className="text-white/70 leading-relaxed mb-3">{t('landing.aboutBody1')}</p>
        <p className="text-white/70 leading-relaxed">
          {t('landing.aboutBody2')}{' '}
          <a href="https://www.tatawwor.com" target="_blank" rel="noopener" className="underline hover:text-white">tatawwor.com</a>
        </p>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-3xl mx-auto px-6 pb-16">
        <h2 className="text-2xl font-bold text-center mb-8">{t('landing.faqTitle')}</h2>
        <div className="space-y-3">
          {faqs.map(k => (
            <details key={k} className="group rounded-xl bg-white/5 border border-white/10 px-5 py-4">
              <summary className="cursor-pointer font-medium list-none flex items-center justify-between gap-3">
                {t(`landing.faq.${k}.q`)}
                <span className="text-white/40 group-open:rotate-45 transition-transform text-lg leading-none">+</span>
              </summary>
              <p className="mt-3 text-sm text-white/70 leading-relaxed">{t(`landing.faq.${k}.a`)}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-5xl mx-auto px-6 pb-20 text-center">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-8 py-12">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">{t('landing.ctaTitle')}</h2>
          <p className="text-white/70 mb-6">{t('landing.ctaBody')}</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <a
              href="https://app.abniyah.com/register"
              className="inline-block rounded-xl bg-white text-[oklch(0.25_0.08_185)] px-7 py-3 text-sm font-bold hover:bg-white/90 transition-colors"
            >
              {t('landing.startTrial')}
            </a>
            <a
              href="https://app.abniyah.com/demo"
              className="inline-block rounded-xl bg-white/10 hover:bg-white/20 border border-white/25 px-7 py-3 text-sm font-semibold transition-colors"
            >
              {t('landing.liveDemo')}
            </a>
          </div>
        </div>
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
