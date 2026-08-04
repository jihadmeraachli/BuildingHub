import { useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { isDemoEmail } from '@/lib/demo';
import { usePullToRefresh, PullIndicator } from '@/components/PullToRefresh';
import { BioPrompt } from '@/components/BioPrompt';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { t } = useTranslation();
  const { user } = useAuth();
  const isDemo = isDemoEmail(user?.email);

  // Pull-to-refresh in the native iOS shell (#69) — no-op on web.
  const mainRef = useRef<HTMLElement | null>(null);
  const ptrRef = useRef<HTMLDivElement | null>(null);
  usePullToRefresh(mainRef, ptrRef);

  // Demo visitors who convert must not carry the demo session into /register.
  async function startTrial() {
    await supabase.auth.signOut();
    window.location.href = '/register';
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {isDemo && (
          <div className="shrink-0 bg-primary text-primary-foreground text-center text-xs font-medium py-1.5 px-4">
            {t('demo.banner')}{' '}
            <a href="/demo" className="underline font-semibold">{t('demo.switch')}</a>
            <span className="mx-1.5 opacity-50">·</span>
            <button onClick={startTrial} className="underline font-semibold cursor-pointer">
              {t('demo.cta')}
            </button>
          </div>
        )}
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main ref={mainRef} className="relative flex-1 overflow-y-auto p-4 lg:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] lg:pb-6">
          <PullIndicator innerRef={ptrRef} />
          <Outlet />
        </main>
        {/* Native only, self-hiding: offers Face ID once, just after signing in. */}
        <BioPrompt />
      </div>
    </div>
  );
}
