import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { Session } from '@supabase/supabase-js';
import { supabase, AUTH_STORAGE_KEY } from '@/lib/supabase';
import { nativeSessionStorage } from '@/lib/sessionStore';

/**
 * The credential that lets Face ID sign you in FROM THE LOGIN SCREEN — after
 * an explicit sign-out, after the app was closed, after a restart (#55).
 *
 * It is a copy of the live session's tokens, kept apart from Supabase's own
 * session storage. Two things have to hold for that copy to be worth anything,
 * and until 2026-09 neither did — Face ID sign-in died about an hour after it
 * was switched on ("Face ID sign-in has expired"):
 *
 *   1. THE COPY MUST TRACK ROTATION. Supabase rotates the refresh token on
 *      every refresh (~hourly) and the previous one stops working. A copy taken
 *      once at enrolment is dead after the first rotation. AuthContext therefore
 *      re-saves it on every auth event that carries a session.
 *
 *   2. SIGN-OUT MUST NOT REVOKE IT. `supabase.auth.signOut()` revokes the
 *      session SERVER-SIDE, so the Keychain copy "surviving" sign-out was
 *      surviving as a dead token. With Face ID sign-in on, signing out on this
 *      device is `softSignOut()` instead: the local session is forgotten, the
 *      server session is left alive, reachable only through Face ID.
 *
 * Trade-off worth knowing: anyone who can pass Face ID / the passcode on this
 * device can get back in without the password, including after "Sign out".
 * That is the same bargain every banking app makes, and it is why the
 * credential is dropped the moment Face ID sign-in is switched off. A lost
 * phone is handled the usual way — change the password, or have the account
 * deactivated (0130 cuts API access at once).
 *
 * Keychain / Keystore only — never written on the web.
 */
const KEY = 'abniyah_bio_session';
const isNative = Capacitor.isNativePlatform();

interface StoredSession {
  access_token: string;
  refresh_token: string;
  email?: string;
}

/**
 * Remember a session so Face ID can restore it later.
 *
 * Pass the session when you already hold it — REQUIRED inside
 * `onAuthStateChange`, where calling back into `supabase.auth` can deadlock on
 * the client's internal lock. With no argument it reads the current session.
 */
export async function rememberSessionForBio(session?: Session | null): Promise<void> {
  if (!isNative) return;
  const s = session ?? (await supabase.auth.getSession()).data.session;
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
 * Sign out of THIS DEVICE while leaving the session alive on the server, so
 * Face ID can bring it back. Returns false when there is nothing to preserve
 * (web, or no session) — the caller should fall back to a real sign-out.
 *
 * supabase-js has no "forget locally without revoking" call: every `signOut()`
 * scope hits the logout endpoint. So this stops the refresh timer, takes one
 * last copy of the tokens (the copy must equal the live session at the moment
 * we let go of it), removes the stored session by name, and reloads — the
 * client boots with nothing in storage, which is what signed-out means locally.
 */
export async function softSignOut(): Promise<boolean> {
  if (!isNative) return false;
  const { data } = await supabase.auth.getSession();
  if (!data.session?.refresh_token) return false;
  await supabase.auth.stopAutoRefresh();
  await rememberSessionForBio(data.session);
  await nativeSessionStorage.removeItem(AUTH_STORAGE_KEY);
  window.location.replace('/');
  return true;
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
