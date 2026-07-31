import { useEffect } from 'react';
import {
  BookOpenCheck, Wallet, MessageSquareText, Wrench, CalendarCheck2, Building2,
} from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { Wordmark } from '@/components/ui/Wordmark';

/**
 * Public landing page, served on the ROOT domain (abniyah.com) — see the
 * hostname branch in App.tsx. Deliberately outside the beta gate and auth:
 * this page is the public face of the product and the verifiable link between
 * the Abniyah brand and Tatawwor (the registered business) — evidence pages
 * like Meta's WhatsApp display-name review land here.
 */

const FEATURES = [
  {
    icon: BookOpenCheck,
    title: 'The building book',
    body: 'Every expense, charge and payment in one ledger. The compound view and each block reconcile to the cent.',
  },
  {
    icon: Wallet,
    title: 'Dues & collections',
    body: 'Issue monthly dues or bill actual expenses. Owners see their balance; managers see who has paid.',
  },
  {
    icon: MessageSquareText,
    title: 'WhatsApp & email updates',
    body: 'Receipts, new charges and dues reach residents on WhatsApp and email, in Arabic and English.',
  },
  {
    icon: Wrench,
    title: 'Issues & maintenance',
    body: 'Residents report problems with photos; managers track them from reported to resolved.',
  },
  {
    icon: CalendarCheck2,
    title: 'Meetings & decisions',
    body: 'Schedule building meetings with calendar invites, keep minutes and decisions where everyone finds them.',
  },
  {
    icon: Building2,
    title: 'Compounds & portfolios',
    body: 'One account for a single building, a compound of blocks, or a whole management company.',
  },
];

export default function Landing() {
  useEffect(() => {
    document.title = 'Abniyah | Building management for Lebanon · a product of Tatawwor';
  }, []);

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
        <a
          href="https://app.abniyah.com"
          className="rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-2 text-sm font-semibold transition-colors"
        >
          Open the app
        </a>
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
          Run your building like a pro.
        </h1>
        <p className="text-lg text-white/80 max-w-2xl mx-auto">
          Expenses, collections, and the building book. All in one place.
          Built to manage buildings with privacy in mind.
        </p>
        <p className="text-lg text-white/70 max-w-2xl mx-auto mt-2" dir="rtl" lang="ar">
          المصاريف والتحصيل ودفتر المبنى. كلّها في مكان واحد. مصمَّم لإدارة المباني مع الحفاظ على الخصوصية.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <a
            href="https://app.abniyah.com"
            className="rounded-xl bg-white text-[oklch(0.25_0.08_185)] px-6 py-3 text-sm font-bold hover:bg-white/90 transition-colors"
          >
            Open the app
          </a>
          <span className="text-sm text-white/50">Currently in private beta</span>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-2xl bg-white/5 border border-white/10 p-6">
              <f.icon size={22} className="text-[oklch(0.85_0.09_180)] mb-3" />
              <h3 className="font-semibold mb-1.5">{f.title}</h3>
              <p className="text-sm text-white/65 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Who it's for */}
      <section className="max-w-5xl mx-auto px-6 pb-24 text-center">
        <p className="text-white/70 max-w-2xl mx-auto text-sm leading-relaxed">
          Abniyah serves owners&rsquo; committees, building supervisors, and property-management
          companies, from a single block to a portfolio of compounds. One login per person:
          manage your buildings, or simply follow your own home.
        </p>
      </section>

      {/* Footer — the brand ↔ legal-entity link lives here, publicly. */}
      <footer className="border-t border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Logo size={20} variant="white" />
            <span className="text-xs text-white/60">
              © {new Date().getFullYear()} Abniyah, a product of <strong className="text-white/80">Tatawwor</strong>. All rights reserved.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
