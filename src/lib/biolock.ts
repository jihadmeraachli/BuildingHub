import { Capacitor } from '@capacitor/core';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';

/**
 * Device-local app lock (Face ID / Touch ID / device passcode) for the native
 * app. Purely a local gate in front of the already-authenticated UI — no
 * backend involvement. Preference is per device, in localStorage.
 */
const KEY = 'abniyah_biolock';

export const isNativeApp = Capacitor.isNativePlatform();

export const bioLockEnabled = () => isNativeApp && localStorage.getItem(KEY) === '1';

export const setBioLockEnabled = (on: boolean) => {
  if (on) localStorage.setItem(KEY, '1');
  else localStorage.removeItem(KEY);
};

export async function bioAvailable(): Promise<boolean> {
  if (!isNativeApp) return false;
  try {
    const r = await BiometricAuth.checkBiometry();
    // Device credential (passcode) works as fallback even without enrolled
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
