import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2, Home, Loader2, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, type DemoPersona } from '@/lib/demo';
import { Logo } from '@/components/ui/Logo';
import { Wordmark } from '@/components/ui/Wordmark';

/** /demo — lands from the marketing site. Visitors pick a persona (building
 *  admin or unit owner), we sign into that read-only account and hard-reload
 *  into the dashboard so AuthContext boots fresh. /demo?as=admin|owner skips
 *  the chooser. */
export default function DemoEntry() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState<DemoPersona | null>(null);
  const [error, setError] = useState(false);

  async function enter(persona: DemoPersona) {
    setBusy(persona);
    setError(false);
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user.email?.toLowerCase() !== DEMO_ACCOUNTS[persona]) {
      if (session) await supabase.auth.signOut();
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: DEMO_ACCOUNTS[persona],
        password: DEMO_PASSWORD,
      });
      if (signInErr) { setError(true); setBusy(null); return; }
    }
    window.location.replace('/dashboard');
  }

  useEffect(() => {
    const as = params.get('as');
    if (as === 'admin' || as === 'owner') enter(as);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const personas: { key: DemoPersona; icon: typeof Building2 }[] = [
    { key: 'admin', icon: Building2 },
    { key: 'owner', icon: Home },
  ];

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-8 px-6 text-white"
      style={{ background: 'linear-gradient(150deg, oklch(0.32 0.11 185) 0%, oklch(0.2 0.05 186) 45%, oklch(0.13 0.03 190) 100%)' }}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-2.5">
          <Logo size={34} variant="white" />
          <Wordmark className="text-sm" />
        </div>
        <h1 className="text-2xl font-bold mt-2">{t('demo.chooseTitle')}</h1>
        <p className="text-sm text-white/70 max-w-sm">{t('demo.chooseSub')}</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 w-full max-w-2xl">
        {personas.map(({ key, icon: Icon }) => (
          <button
            key={key}
            onClick={() => enter(key)}
            disabled={busy !== null}
            className="group rounded-2xl bg-white/5 hover:bg-white/10 border border-white/15 p-6 text-start transition-colors cursor-pointer disabled:opacity-60"
          >
            <Icon size={26} className="text-[oklch(0.85_0.09_180)] mb-3" />
            <p className="font-semibold flex items-center gap-1.5">
              {t(`demo.${key}.title`)}
              {busy === key
                ? <Loader2 size={15} className="animate-spin" />
                : <ChevronRight size={15} className="opacity-0 group-hover:opacity-100 transition-opacity rtl:rotate-180" />}
            </p>
            <p className="text-sm text-white/65 mt-1.5 leading-relaxed">{t(`demo.${key}.body`)}</p>
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-white/80 max-w-sm text-center">{t('demo.unavailable')}</p>}

      <a href="https://abniyah.com" className="text-xs text-white/50 hover:text-white/80 transition-colors">
        {t('demo.backToSite')}
      </a>
    </div>
  );
}
