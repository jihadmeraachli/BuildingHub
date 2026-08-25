import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { BillingBanner } from '@/components/BillingBanner';
import { useAuth } from '@/contexts/AuthContext';
import { isDemoEmail, DEMO_HIDDEN_ROUTES, betaScope } from '@/lib/demo';
import { usePullToRefresh, PullIndicator } from '@/components/PullToRefresh';
import { BioPrompt } from '@/components/BioPrompt';
import { pushAlreadyGranted, enablePush } from '@/lib/push';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { HelpProvider } from '@/components/HelpWidget';

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { t } = useTranslation();
  const { user } = useAuth();
  const isDemo = isDemoEmail(user?.email);
  const location = useLocation();

  // Pull-to-refresh in the native iOS shell (#69) — no-op on web.
  const mainRef = useRef<HTMLElement | null>(null);
  const ptrRef = useRef<HTMLDivElement | null>(null);
  usePullToRefresh(mainRef, ptrRef);

  // Re-register for push on every launch where permission is already granted:
  // iOS can hand out a NEW device token after an update or a restore, and a
  // stale one silently stops delivering. Never prompts — enabling is a
  // deliberate action in Settings.
  useEffect(() => {
    pushAlreadyGranted().then((ok) => { if (ok) void enablePush(); });
  }, []);

  // Demo visitors who convert must not carry the demo session into /register.
  async function startTrial() {
    await supabase.auth.signOut();
    window.location.href = '/register';
  }

  // Pre-release: the demo personas don't get the hidden differentiators even
  // by typing the URL — the sidebar hides the links, this closes the door.
  if (isDemo && DEMO_HIDDEN_ROUTES.has(location.pathname)) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <HelpProvider>
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {isDemo && (
          <div className="shrink-0 bg-primary text-primary-foreground text-center text-xs font-medium py-1.5 px-4">
            {t('demo.banner')}{' '}
            <a href="/demo" className="underline font-semibold">{t('demo.switch')}</a>
            {/* 0126: no trial CTA for demo-scoped visitors (partner reviews) */}
            {betaScope() !== 'demo' && (
              <>
                <span className="mx-1.5 opacity-50">·</span>
                <button onClick={startTrial} className="underline font-semibold cursor-pointer">
                  {t('demo.cta')}
                </button>
              </>
            )}
          </div>
        )}
        <BillingBanner />
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main ref={mainRef} className="relative flex-1 overflow-y-auto p-4 lg:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] lg:pb-6">
          <PullIndicator innerRef={ptrRef} />
          <Outlet />
        </main>
        {/* Native only, self-hiding: offers Face ID once, just after signing in. */}
        <BioPrompt />
      </div>
    </div>
    </HelpProvider>
  );
}
