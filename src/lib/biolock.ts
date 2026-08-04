import { Capacitor } from '@capacitor/core';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';

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
// Legacy key name: kept so devices that had the old app lock enabled keep
// their preference instead of silently losing it.
const KEY = 'abniyah_biolock';

export const isNativeApp = Capacitor.isNativePlatform();

export const bioLoginEnabled = () => isNativeApp && localStorage.getItem(KEY) === '1';

export const setBioLoginEnabled = (on: boolean) => {
  if (on) localStorage.setItem(KEY, '1');
  else localStorage.removeItem(KEY);
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
