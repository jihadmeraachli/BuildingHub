import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Fingerprint } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { Wordmark } from '@/components/ui/Wordmark';
import { Button } from '@/components/ui/Button';
import { isNativeApp, bioLockEnabled, bioAuthenticate } from '@/lib/biolock';

/**
 * Native-app lock screen: when the user has enabled it in Settings, the app
 * locks every time it goes to the background and asks for Face ID / Touch ID
 * (device passcode fallback) on return. The app stays mounted underneath —
 * the overlay only hides it — so unlocking is instant and loses no state.
 */
export function BioLock({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [locked, setLocked] = useState(() => bioLockEnabled());
  const [prompting, setPrompting] = useState(false);

  const unlock = useCallback(async () => {
    if (prompting) return;
    setPrompting(true);
    const ok = await bioAuthenticate(t('bio.reason'));
    setPrompting(false);
    if (ok) setLocked(false);
  }, [prompting, t]);

  // Re-lock whenever the app is backgrounded (iOS app switcher, home screen).
  useEffect(() => {
    if (!isNativeApp) return;
    const onVis = () => {
      if (document.visibilityState === 'hidden' && bioLockEnabled()) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Prompt automatically the moment we lock / launch locked.
  useEffect(() => {
    if (locked && document.visibilityState === 'visible') unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  return (
    <>
      {children}
      {locked && (
        <div
          className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-6 bg-background"
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex items-center gap-2.5">
            <Logo size={36} />
            <Wordmark className="text-base text-foreground" />
          </div>
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Fingerprint size={30} className="text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">{t('bio.lockedTitle')}</p>
          <Button onClick={unlock} loading={prompting}>{t('bio.unlock')}</Button>
        </div>
      )}
    </>
  );
}
