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
import { TabBar } from './TabBar';
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

  // Phone tables (see index.css "PHONE TABLES"): copy each column header
  // onto its cells as data-label so the card layout can print it. Runs on
  // every DOM change inside <main>, cheaply (only tables, only cells that
  // lack the attribute or whose header text changed).
  useEffect(() => {
    const root = mainRef.current;
    if (!root) return;
    const stamp = () => {
      for (const table of root.querySelectorAll('table')) {
        const heads = [...table.querySelectorAll('thead th, thead td')].map((th) => (th.textContent ?? '').trim());
        if (!heads.length) continue;
        for (const row of table.querySelectorAll('tbody tr, tfoot tr')) {
          let col = 0;
          for (const cell of row.children) {
            const span = Number((cell as HTMLElement).getAttribute('colspan') || 1);
            const label = heads[col] ?? '';
            if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
            // a cell that is only buttons/links is an action row: no label, right-aligned
            const onlyControls = !!cell.querySelector('button, a') && (cell.textContent ?? '').trim() === [...cell.querySelectorAll('button, a')].map((c) => (c.textContent ?? '').trim()).join('').replace(/\s+/g, '');
            if (onlyControls && !cell.hasAttribute('data-actions')) cell.setAttribute('data-actions', '');
            // a cell with nothing in it (no text, no control, no icon) is just a gap on a phone
            const empty = (cell.textContent ?? '').trim() === '' && !cell.querySelector('button, a, input, svg, img');
            if (empty) cell.setAttribute('data-empty', ''); else cell.removeAttribute('data-empty');
            col += span;
          }
        }
      }
    };
    stamp();
    const mo = new MutationObserver(() => stamp());
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  // Demo visitors who convert must not carry the demo session into /register.
  async function startTrial() {
    // scope 'local': the shared demo persona is signed in on many browsers at
    // once; the default 'global' would sign every other demo visitor out.
    await supabase.auth.signOut({ scope: 'local' });
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
        {/* Under lg the tab bar floats over the bottom edge: pad the scroll
            area by its height + the home-indicator inset so the last row of
            every page can scroll clear of it. */}
        <main ref={mainRef} className="relative flex-1 overflow-y-auto overflow-x-clip p-4 lg:p-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-6">
          <PullIndicator innerRef={ptrRef} />
          <Outlet />
        </main>
        <TabBar onMore={() => setSidebarOpen(true)} />
        {/* Native only, self-hiding: offers Face ID once, just after signing in. */}
        <BioPrompt />
      </div>
    </div>
    </HelpProvider>
  );
}
