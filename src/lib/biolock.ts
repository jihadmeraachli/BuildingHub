import { Capacitor } from '@capacitor/core';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { getPref, setPref, removePref, PREF_BIO_LOGIN } from '@/lib/devicePrefs';

/**
 * Face ID / Touch ID sign-in for the native app (#55).
 *
 * Gates the app at LAUNCH — cold start, or the first open after a device
 * restart — and NOT on every return from the background. Backgrounding no
 * longer re-locks: the phone's own lock screen already covers someone picking
 * the handset up, and re-prompting on every app switch was the annoying part.
 *
 * What it protects: Supabase keeps the signed-in session on the device, so
 * without this the app opens straight into a building's finances for whoever
 * is holding the phone. With it, that session is only revealed after Face ID.
 *
 * It deliberately does NOT survive an explicit sign-out — once you sign out the
 * password is required again, which is what signing out should mean.
 *
 * Preference is per device, in localStorage.
 */
export const isNativeApp = Capacitor.isNativePlatform();

// The preference lives in the Keychain, NOT localStorage: iOS clears web
// storage when the app is terminated, so a localStorage flag meant the app
// forgot Face ID was enabled on every relaunch — precisely the launch this
// feature exists for. Reads assume loadDevicePrefs() has already resolved.
export const bioLoginEnabled = () => isNativeApp && getPref(PREF_BIO_LOGIN) === '1';

export const setBioLoginEnabled = (on: boolean) => {
  if (on) setPref(PREF_BIO_LOGIN, '1');
  else removePref(PREF_BIO_LOGIN);
};

export async function bioAvailable(): Promise<boolean> {
  if (!isNativeApp) return false;
  try {
    const r = await BiometricAuth.checkBiometry();
    // Device credential (passcode) works as a fallback even without enrolled
    // biometrics, so "available" here means "the device can gate access".
    return r.isAvailable || r.deviceIsSecure;
  } catch {
    return false;
  }
}

/** Prompt Face ID / Touch ID (passcode fallback). Resolves true on success. */
export async function bioAuthenticate(reason: string): Promise<boolean> {
  try {
    await BiometricAuth.authenticate({
      reason,
      allowDeviceCredential: true,
      cancelTitle: '',
      iosFallbackTitle: '',
    });
    return true;
  } catch {
    return false;
  }
}
