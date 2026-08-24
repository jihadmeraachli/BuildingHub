import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Fingerprint } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/contexts/AuthContext';
import { isDemoEmail } from '@/lib/demo';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  isNativeApp, bioAvailable, bioAuthenticate, bioLoginEnabled, setBioLoginEnabled,
} from '@/lib/biolock';
import { getPref, setPref, PREF_BIO_ASKED } from '@/lib/devicePrefs';
import { rememberSessionForBio } from '@/lib/bioSession';

/**
 * Offers Face ID sign-in once, just after the user has signed in on the native
 * app — the moment they have just typed a password is the moment the offer
 * lands. Left in Settings alone, nobody finds it.
 *
 * Asked at most once per device: declining is remembered, because a prompt
 * that reappears every login is worse than no prompt at all. Settings stays
 * the way back in for anyone who changes their mind.
 */
// In devicePrefs (Keychain on iOS), not localStorage — otherwise closing the
// app forgets the decline and the prompt returns on every launch.

export function BioPrompt() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isNativeApp || !user) return;
    if (isDemoEmail(user.email)) return;              // demo personas are read-only
    if (bioLoginEnabled()) return;                    // already on
    if (getPref(PREF_BIO_ASKED) === '1') return;
    bioAvailable().then((ok) => { if (ok) setOpen(true); });
  }, [user]);

  function remember() { setPref(PREF_BIO_ASKED, '1'); }

  async function enable() {
    setBusy(true);
    // Prove it actually works on this device before promising it next launch.
    const ok = await bioAuthenticate(t('bio.reason'));
    setBusy(false);
    if (!ok) { toast.error(t('settings.bioFailed')); return; }
    setBioLoginEnabled(true);
    // Capture the credential now, while signed in — this is what lets Face ID
    // sign them back in later, including after an explicit sign-out.
    await rememberSessionForBio();
    remember();
    setOpen(false);
    toast.success(t('settings.bioEnabled'));
  }

  function notNow() {
    remember();
    setOpen(false);
  }

  return (
    <Modal open={open} onClose={notNow} title={t('bio.offerTitle')} size="sm">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
          <Fingerprint size={26} className="text-primary" />
        </div>
        <p className="text-sm text-muted-foreground">{t('bio.offerBody')}</p>
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" onClick={notNow}>{t('bio.offerLater')}</Button>
          <Button onClick={enable} loading={busy}>{t('bio.offerEnable')}</Button>
        </div>
      </div>
    </Modal>
  );
}
