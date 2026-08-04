import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Fingerprint } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Logo } from '@/components/ui/Logo';
import { Wordmark } from '@/components/ui/Wordmark';
import { Button } from '@/components/ui/Button';
import { isNativeApp, bioLoginEnabled, bioAuthenticate } from '@/lib/biolock';
import { loadDevicePrefs } from '@/lib/devicePrefs';

/**
 * Face ID sign-in gate for the native app (#55).
 *
 * Runs ONCE per launch — cold start, or the first open after a device restart.
 * Backgrounding the app does not re-lock it; that was the old behaviour and it
 * made every app switch a Face ID prompt.
 *
 * Only gates when there is actually a saved session to protect. Signed out,
 * the login screen is already the gate, so we skip straight through rather
 * than asking for a face to reveal a password form.
 */
type Status = 'checking' | 'locked' | 'open';

export function BioLock({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  // Always start by checking on native: the Face ID preference lives in the
  // Keychain and reading it is async, so we cannot decide synchronously here.
  const [status, setStatus] = useState<Status>(() => (isNativeApp ? 'checking' : 'open'));
  const [prompting, setPrompting] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (status !== 'checking') return;
    let cancelled = false;
    (async () => {
      // Load prefs FIRST — everything downstream reads them synchronously.
      await loadDevicePrefs();
      if (cancelled) return;
      if (!bioLoginEnabled()) { setStatus('open'); return; }
      // Only gate when there is a session worth protecting. This sits outside
      // AuthProvider, so read the persisted session directly.
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setStatus(data.session ? 'locked' : 'open');
    })();
    return () => { cancelled = true; };
  }, [status]);

  const unlock = useCallback(async () => {
    if (prompting) return;
    setPrompting(true);
    const ok = await bioAuthenticate(t('bio.reason'));
    setPrompting(false);
    if (ok) setStatus('open');
    else setFailed(true);
  }, [prompting, t]);

  // Prompt as soon as we know the app is locked.
  useEffect(() => {
    if (status === 'locked' && document.visibilityState === 'visible') unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  /** Escape hatch: sign out and fall back to email + password. Without this a
   *  failed or unavailable Face ID would be a dead end on the user's own app. */
  const usePassword = useCallback(async () => {
    await supabase.auth.signOut();
    setStatus('open');
  }, []);

  // Nothing rendered underneath until Face ID passes — the whole point is that
  // the session is not visible to whoever is holding the phone.
  if (status !== 'open') {
    return (
      <div
        className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-6 bg-background px-8"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center gap-2.5">
          <Logo size={36} />
          <Wordmark className="text-base text-foreground" />
        </div>
        {status === 'locked' && (
          <>
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Fingerprint size={30} className="text-primary" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              {failed ? t('bio.failed') : t('bio.lockedTitle')}
            </p>
            <div className="flex flex-col items-center gap-3">
              <Button onClick={unlock} loading={prompting}>{t('bio.unlock')}</Button>
              <button
                onClick={usePassword}
                className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
              >
                {t('bio.usePassword')}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
