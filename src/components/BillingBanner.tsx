import { useEffect, useState } from 'react';
import { fmtDate } from '@/lib/dateFmt';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Subscription } from '@/types';

/**
 * The billing lifecycle, as one line at the top of the app (0114).
 * Trial: days left. Grace: pay by the date or the account locks. Locked:
 * read-only until the invoice is paid. Ending: cancellation takes effect at
 * the period end. Silent whenever the subscription is simply active.
 * Admins only — residents have their own gate (/no-license).
 */
export function BillingBanner() {
  const { t } = useTranslation();
  const { canAny, isPlatformAdmin } = useAuth();
  const [sub, setSub] = useState<Subscription | null>(null);

  const isAdmin = !isPlatformAdmin && canAny('building.manage');
  useEffect(() => {
    if (!isAdmin) return;
    supabase.from('subscriptions').select('*').neq('status', 'cancelled')
      .order('created_at', { ascending: false }).limit(5)
      .then(({ data }) => {
        const list = (data as Subscription[]) ?? [];
        // the loudest state wins across everything the admin can see
        const rank = (s: Subscription) => s.status === 'locked' ? 0 : s.status === 'grace' ? 1 : s.cancel_at_period_end ? 2 : s.status === 'trial' ? 3 : 4;
        setSub(list.sort((a, b) => rank(a) - rank(b))[0] ?? null);
      });
  }, [isAdmin]);

  if (!isAdmin || !sub) return null;

  const day = (iso: string | null | undefined) =>
    iso ? fmtDate(iso) : '';
  const daysLeft = (iso: string | null | undefined) =>
    iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : null;

  let text: string | null = null;
  // "Ending" wears the finance negative red (red-500, the color of a number
  // going the wrong way) - Jey's call 2026-08-26: a subscription running out
  // is money news, not neutral news. Still one notch softer than the red-600
  // of locked/grace, where access is actually blocked, so severity reads in
  // order: ending < grace/locked. Trial stays amber (a nudge, not an alarm).
  let tone = 'bg-slate-600 text-white';
  if (sub.status === 'locked') {
    text = t('billing.bannerLocked');
    tone = 'bg-red-600 text-white';
  } else if (sub.status === 'grace') {
    text = t('billing.bannerGrace', { date: day(sub.grace_ends_at) });
    tone = 'bg-red-600 text-white';
  } else if (sub.cancel_at_period_end && sub.status === 'active') {
    text = t('billing.bannerEnding', { date: day(sub.current_period_end) });
    tone = 'bg-red-500 text-white';
  } else if (sub.status === 'trial') {
    const n = daysLeft(sub.trial_ends_at);
    if (n !== null && n <= 10) { text = t('billing.bannerTrial', { count: n }); tone = 'bg-amber-500 text-white'; }
  }
  if (!text) return null;

  return (
    <div className={`shrink-0 text-center text-xs font-medium py-1.5 px-4 ${tone}`}>
      {text}{' '}
      <Link to="/licenses" className="underline font-semibold">{t('billing.bannerCta')}</Link>
    </div>
  );
}
