import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { supabase } from '@/lib/supabase';

/**
 * The credential that lets Face ID sign you in FROM THE LOGIN SCREEN — after
 * an explicit sign-out, after the app was closed, after a restart (#55).
 *
 * Kept deliberately separate from Supabase's own session storage, because
 * `signOut()` clears that. This copy survives sign-out on purpose: signing out
 * should stop the app being open, not force you to retype a password the
 * device can already prove is yours.
 *
 * Trade-off worth knowing: anyone who can pass Face ID / the passcode on this
 * device can get back in without the password. That is the same bargain every
 * banking app makes, and it is why the credential is dropped the moment Face
 * ID sign-in is switched off.
 *
 * iOS Keychain only — never written on the web.
 */
const KEY = 'abniyah_bio_session';
const isNative = Capacitor.isNativePlatform();

interface StoredSession {
  access_token: string;
  refresh_token: string;
  email?: string;
}

/** Remember the current session so Face ID can restore it later. */
export async function rememberSessionForBio(): Promise<void> {
  if (!isNative) return;
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!s?.refresh_token) return;
  const payload: StoredSession = {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    email: s.user?.email ?? undefined,
  };
  try { await SecureStorage.setItem(KEY, JSON.stringify(payload)); } catch { /* non-fatal */ }
}

export async function getBioSession(): Promise<StoredSession | null> {
  if (!isNative) return null;
  try {
    const raw = await SecureStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export async function forgetBioSession(): Promise<void> {
  if (!isNative) return;
  try { await SecureStorage.removeItem(KEY); } catch { /* may not exist */ }
}

/**
 * Restore the remembered session. Call ONLY after a successful biometric
 * check. Returns false if the stored token has expired or been revoked, in
 * which case the password is the way back in.
 */
export async function restoreBioSession(): Promise<boolean> {
  const stored = await getBioSession();
  if (!stored) return false;
  const { error } = await supabase.auth.setSession({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
  });
  if (error) {
    // A refresh token that no longer works is worse than useless — drop it so
    // the Face ID button stops being offered.
    await forgetBioSession();
    return false;
  }
  return true;
}
