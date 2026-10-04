import { useEffect, useState, type ElementType } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CalendarDays, HandCoins, Home, Layers, Menu, Wallet } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { isDemoEmail, DEMO_HIDDEN_ROUTES } from '@/lib/demo';
import { cn } from '@/lib/utils';

/**
 * Bottom tab bar for phones and small tablets (hidden from lg up, where the
 * sidebar is permanent).
 *
 * A phone app navigates with its thumb, not a hamburger: the four places a
 * person goes most sit in the bar, always visible, and "More" opens the full
 * drawer (the same one the hamburger opens) for everything else. Which four
 * depends on who is looking:
 *   resident       Home · Account · Issues · Meetings
 *   manager        Home · Money · Units · Issues
 *   collector      Home · Collect · Issues · Meetings
 * The drawer keeps every link, so nothing becomes unreachable; the bar only
 * shortens the common trips.
 *
 * The bar hides while a text field has focus so it never sits on top of the
 * keyboard's accessory row, and it pads for the home indicator.
 */
export const TAB_BAR_HEIGHT = 56; // px, before the safe-area inset

interface Tab { to: string; label: string; icon: ElementType }

export function TabBar({ onMore }: { onMore: () => void }) {
  const { t } = useTranslation();
  const { user, canAny, grants, isPlatformAdmin, residentLens } = useAuth();
  const location = useLocation();
  const isDemo = isDemoEmail(user?.email);

  const isResident = residentLens || (!isPlatformAdmin && grants.length === 0);
  const canStructure = canAny('unit.manage') || grants.some(g => g.scope_type === 'org' && g.role === 'org_admin');
  const isCollector = !isResident && canAny('payment.record') && !canAny('finance.view');

  const tabs: Tab[] = (isResident
    ? [
        { to: '/dashboard', label: t('nav.tabHome'), icon: Home },
        { to: '/finance', label: t('nav.tabAccount'), icon: Wallet },
        { to: '/issues', label: t('nav.issues'), icon: AlertTriangle },
        { to: '/meetings', label: t('nav.meetings'), icon: CalendarDays },
      ]
    : isCollector
      ? [
          { to: '/dashboard', label: t('nav.tabHome'), icon: Home },
          { to: '/collect', label: t('nav.collect'), icon: HandCoins },
          { to: '/issues', label: t('nav.issues'), icon: AlertTriangle },
          { to: '/meetings', label: t('nav.meetings'), icon: CalendarDays },
        ]
      : [
          { to: '/dashboard', label: t('nav.tabHome'), icon: Home },
          { to: '/finance', label: t('nav.tabMoney'), icon: Wallet },
          canStructure
            ? { to: '/structure', label: t('nav.tabUnits'), icon: Layers }
            : { to: '/meetings', label: t('nav.meetings'), icon: CalendarDays },
          { to: '/issues', label: t('nav.issues'), icon: AlertTriangle },
        ]
  ).filter(tab => !(isDemo && DEMO_HIDDEN_ROUTES.has(tab.to)));

  const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(to + '/');
  const onTab = tabs.some(tab => isActive(tab.to));

  // Hide while typing: the keyboard's own bar and ours should never stack.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isField = (el: Element | null) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
    const onFocus = (e: FocusEvent) => setTyping(isField(e.target as Element));
    const onBlur = () => setTyping(false);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    return () => { document.removeEventListener('focusin', onFocus); document.removeEventListener('focusout', onBlur); };
  }, []);

  return (
    <nav
      aria-label={t('nav.tabBarLabel')}
      className={cn(
        'lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/92 backdrop-blur-md',
        'pb-[env(safe-area-inset-bottom)] transition-transform duration-200',
        typing && 'translate-y-full',
      )}
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))`, height: TAB_BAR_HEIGHT }}>
        {tabs.map(({ to, label, icon: Icon }) => {
          const active = isActive(to);
          return (
            <NavLink
              key={to}
              to={to}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center justify-center gap-1 min-w-0 px-1 select-none',
                active ? 'text-primary' : 'text-muted-foreground active:text-foreground',
              )}
            >
              <span className={cn('flex items-center justify-center w-12 h-7 rounded-full transition-colors', active && 'bg-primary/12')}>
                <Icon size={21} strokeWidth={active ? 2.4 : 1.9} />
              </span>
              <span className="text-[10.5px] font-medium leading-none truncate max-w-full">{label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          className={cn(
            'flex flex-col items-center justify-center gap-1 min-w-0 px-1 select-none cursor-pointer',
            !onTab ? 'text-primary' : 'text-muted-foreground active:text-foreground',
          )}
          aria-label={t('nav.tabMore')}
        >
          <span className={cn('flex items-center justify-center w-12 h-7 rounded-full transition-colors', !onTab && 'bg-primary/12')}>
            <Menu size={21} strokeWidth={!onTab ? 2.4 : 1.9} />
          </span>
          <span className="text-[10.5px] font-medium leading-none">{t('nav.tabMore')}</span>
        </button>
      </div>
    </nav>
  );
}
