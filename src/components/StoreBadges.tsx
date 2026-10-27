import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** The two store links, launch day 27 Oct 2026. Kept in one place so the
 *  landing page, the login page and any post-launch mail agree on them. */
export const APP_STORE_URL = 'https://apps.apple.com/app/id6796778347';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.abniyah.app';

const base = 'inline-flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-start transition-colors';

/** Download badges for iOS and Android, drawn inline (no third-party assets,
 *  no tracking). `tone="light"` sits on the dark landing ground. */
export function StoreBadges({ tone = 'light', className }: { tone?: 'light' | 'dark'; className?: string }) {
  const { t } = useTranslation();
  const skin = tone === 'light'
    ? 'border-white/25 bg-white/10 text-white hover:bg-white/20'
    : 'border-border bg-card text-foreground hover:bg-accent';
  return (
    <div className={cn('flex items-center justify-center gap-3 flex-wrap', className)}>
      <a href={APP_STORE_URL} target="_blank" rel="noopener" className={cn(base, skin)} aria-label={t('landing.onAppStore')}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M16.37 12.7c-.03-2.6 2.13-3.86 2.23-3.92-1.22-1.78-3.11-2.02-3.78-2.05-1.6-.16-3.13.94-3.95.94-.82 0-2.07-.92-3.4-.9-1.75.03-3.37 1.02-4.27 2.59-1.82 3.16-.46 7.84 1.31 10.4.87 1.25 1.9 2.66 3.25 2.61 1.3-.05 1.8-.84 3.37-.84 1.57 0 2.02.84 3.4.81 1.4-.02 2.29-1.27 3.15-2.53 1-1.45 1.4-2.86 1.43-2.93-.03-.01-2.74-1.05-2.77-4.18zM13.78 5.04c.72-.87 1.2-2.08 1.07-3.29-1.03.04-2.29.69-3.03 1.56-.66.77-1.25 2-1.09 3.18 1.15.09 2.33-.58 3.05-1.45z" />
        </svg>
        <span className="leading-tight">
          <span className="block text-[10px] uppercase tracking-wide opacity-70">{t('landing.downloadOn')}</span>
          <span className="block text-sm font-semibold">App Store</span>
        </span>
      </a>
      <a href={PLAY_STORE_URL} target="_blank" rel="noopener" className={cn(base, skin)} aria-label={t('landing.onGooglePlay')}>
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3.6 2.3 13.3 12 3.6 21.7c-.3-.2-.5-.6-.5-1V3.3c0-.4.2-.8.5-1z" fill="#34A853" />
          <path d="M16.6 15.3 13.3 12l3.3-3.3 4 2.3c.9.5.9 1.5 0 2l-4 2.3z" fill="#FBBC04" />
          <path d="M3.6 2.3c.3-.2.7-.3 1.1-.1l11.9 6.5L13.3 12 3.6 2.3z" fill="#4285F4" />
          <path d="M13.3 12l3.3 3.3-11.9 6.5c-.4.2-.8.1-1.1-.1L13.3 12z" fill="#EA4335" />
        </svg>
        <span className="leading-tight">
          <span className="block text-[10px] uppercase tracking-wide opacity-70">{t('landing.getItOn')}</span>
          <span className="block text-sm font-semibold">Google Play</span>
        </span>
      </a>
    </div>
  );
}
