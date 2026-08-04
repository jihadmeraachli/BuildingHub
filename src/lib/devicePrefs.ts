import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

/**
 * Small per-device preferences that must OUTLIVE the app being closed.
 *
 * iOS clears the web view's localStorage when the app is terminated, which is
 * what broke Face ID sign-in: the session was moved to the Keychain but the
 * "Face ID is on" flag was not, so relaunching forgot the setting, skipped the
 * gate and fell back to the password screen. Anything that has to survive a
 * swipe-close belongs here, not in localStorage.
 *
 * Reads are synchronous against an in-memory cache — component state
 * initialisers need an answer immediately — so `loadDevicePrefs()` must resolve
 * before anything reads them. Writes update the cache at once and persist in
 * the background.
 *
 * On the web this is just localStorage; there is no Keychain and none of the
 * above applies.
 */
const isNative = Capacitor.isNativePlatform();

export const PREF_BIO_LOGIN = 'abniyah_biolock';    // legacy key name, kept so
                                                    // existing devices keep the setting
export const PREF_LAST_EMAIL = 'abniyah_last_email';
export const PREF_BIO_ASKED = 'abniyah_bio_asked';

const KEYS = [PREF_BIO_LOGIN, PREF_LAST_EMAIL, PREF_BIO_ASKED];

const cache = new Map<string, string | null>();
let loaded = false;

/** Populate the cache. Safe to call more than once; only the first does work. */
export async function loadDevicePrefs(): Promise<void> {
  if (loaded) return;
  for (const key of KEYS) {
    let value: string | null = null;
    if (isNative) {
      try { value = await SecureStorage.getItem(key); } catch { value = null; }
    }
    // Fall back to localStorage — covers the web, and migrates devices that
    // set the preference before it moved to the Keychain.
    if (value === null || value === undefined) value = localStorage.getItem(key);
    cache.set(key, value ?? null);
    // Re-persist a migrated value so the next launch finds it in the Keychain.
    if (isNative && value) { try { await SecureStorage.setItem(key, value); } catch { /* keep going */ } }
  }
  loaded = true;
}

/** Sync read. Falls back to localStorage when the cache has not been filled
 *  yet — that covers the web, where there is no Keychain to wait for. */
export const getPref = (key: string): string | null =>
  (cache.has(key) ? cache.get(key) ?? null : localStorage.getItem(key));

export function setPref(key: string, value: string): void {
  cache.set(key, value);
  localStorage.setItem(key, value);
  if (isNative) void SecureStorage.setItem(key, value).catch(() => undefined);
}

export function removePref(key: string): void {
  cache.set(key, null);
  localStorage.removeItem(key);
  if (isNative) void SecureStorage.removeItem(key).catch(() => undefined);
}
