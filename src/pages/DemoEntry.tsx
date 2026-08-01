import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DEMO_EMAIL, DEMO_PASSWORD, isDemoEmail } from '@/lib/demo';
import { Logo } from '@/components/ui/Logo';

/** /demo — lands from the marketing site, signs into the read-only demo
 *  account and hard-reloads into the dashboard so AuthContext boots fresh. */
export default function DemoEntry() {
  const { t } = useTranslation();
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!isDemoEmail(session?.user.email)) {
        if (session) await supabase.auth.signOut();
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: DEMO_EMAIL,
          password: DEMO_PASSWORD,
        });
        if (signInErr) { setError(signInErr.message); return; }
      }
      window.location.replace('/dashboard');
    })();
  }, []);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-4 text-white"
      style={{ background: 'linear-gradient(150deg, oklch(0.32 0.11 185) 0%, oklch(0.2 0.05 186) 45%, oklch(0.13 0.03 190) 100%)' }}
    >
      <Logo size={44} variant="white" />
      {error ? (
        <p className="text-sm text-white/80 max-w-sm text-center px-6">{t('demo.unavailable')}</p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-white/80">
          <Loader2 size={16} className="animate-spin" /> {t('demo.loading')}
        </p>
      )}
    </div>
  );
}
