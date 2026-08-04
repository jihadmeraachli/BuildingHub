import { Capacitor } from '@capacitor/core';
import { SecureStorage, KeychainAccess } from '@aparajita/capacitor-secure-storage';

/**
 * Where the signed-in session lives (#55).
 *
 * On the WEB nothing changes — Supabase's own localStorage handling.
 *
 * In the NATIVE app localStorage proved unreliable: swiping the app away and
 * reopening it lost the session, so Face ID had nothing to unlock and the user
 * had to retype their password. The session now lives in the iOS Keychain,
 * which genuinely survives app termination and device restarts.
 *
 * Keychain access is `whenPasscodeSetThisDeviceOnly`: readable only while the
 * device is unlocked, only on a device that HAS a passcode, and never carried
 * to another device by a backup. Auth tokens should not travel.
 *
 * Every call falls back to localStorage if the Keychain misbehaves — a storage
 * failure must degrade to today's behaviour, never lock someone out of their
 * own app.
 */
const isNative = Capacitor.isNativePlatform();

// Set once, not per write. Failure is non-fatal: the plugin keeps its default
// (`whenUnlocked`), which is still Keychain-backed.
let accessReady: Promise<void> | null = null;
function ensureAccessLevel(): Promise<void> {
  accessReady ??= SecureStorage
    .setDefaultKeychainAccess(KeychainAccess.whenPasscodeSetThisDeviceOnly)
    .catch(() => undefined);
  return accessReady;
}

async function kcGet(key: string): Promise<string | null> {
  try {
    await ensureAccessLevel();
    const v = await SecureStorage.getItem(key);
    if (v !== null && v !== undefined) return v;
  } catch { /* fall through to localStorage */ }
  return localStorage.getItem(key);
}

async function kcSet(key: string, value: string): Promise<void> {
  try {
    await ensureAccessLevel();
    await SecureStorage.setItem(key, value);
    // Don't leave a stale copy behind in the less-protected store.
    localStorage.removeItem(key);
    return;
  } catch { /* fall through */ }
  localStorage.setItem(key, value);
}

async function kcRemove(key: string): Promise<void> {
  try { await SecureStorage.removeItem(key); } catch { /* may simply not exist */ }
  localStorage.removeItem(key);
}

/** Supabase accepts an async storage adapter (the React Native pattern). */
export const nativeSessionStorage = {
  getItem: kcGet,
  setItem: kcSet,
  removeItem: kcRemove,
};

/** Web keeps Supabase's built-in behaviour; only the app gets the Keychain. */
export const sessionStorageAdapter = isNative ? nativeSessionStorage : undefined;
