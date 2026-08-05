import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '@/lib/supabase';

/**
 * Real phone notifications — the ones that arrive with the app closed and the
 * phone locked. Distinct from the in-app bell, which only exists while the app
 * is open.
 *
 * Flow: ask iOS for permission → iOS returns a device token → store it against
 * the signed-in user → the `dynamic-action` edge function sends to that token
 * on the same events that already trigger email and WhatsApp.
 *
 * Permission is asked at a deliberate moment (see usePushRegistration), never
 * on first launch: iOS gives an app exactly ONE chance at that prompt, and a
 * cold "Allow notifications?" before the user knows what the app does is the
 * classic way to get denied forever.
 */
export const pushSupported = Capacitor.isNativePlatform();

let listenersBound = false;

/** Why enabling failed, when it does. Surfaced in Settings so a silent
 *  misconfiguration is not mistaken for "it just doesn't work". */
export type PushFailure = 'denied' | 'no-token' | 'error';

/** Store (or refresh) this device's token for the signed-in user. */
async function saveToken(token: string) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;
  // Upsert on the token: the same device re-registering must update its row,
  // not add another, or one phone buzzes repeatedly per notification.
  await supabase.from('device_tokens').upsert(
    {
      user_id: uid,
      token,
      platform: Capacitor.getPlatform() === 'android' ? 'android' : 'ios',
      last_seen: new Date().toISOString(),
    },
    { onConflict: 'token' },
  );
}

function bindListeners() {
  if (listenersBound) return;
  listenersBound = true;

  PushNotifications.addListener('registration', (t) => { void saveToken(t.value); });

  PushNotifications.addListener('registrationError', (err) => {
    // Nothing the user can do; the other channels still deliver.
    console.error('push registration failed', err);
  });
}

/**
 * Ask for permission and register. Returns true if this device is now
 * receiving notifications. Safe to call repeatedly — iOS only shows the
 * system prompt the first time.
 */
export async function enablePush(): Promise<{ ok: true } | { ok: false; reason: PushFailure }> {
  if (!pushSupported) return { ok: false, reason: 'error' };
  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return { ok: false, reason: 'denied' };

    bindListeners();

    // register() resolving only means the REQUEST was made — the token, or an
    // error, arrives later on a listener. Waiting for whichever comes first is
    // the difference between the toggle reporting the truth and reporting
    // optimism: without the Push Notifications capability in Xcode, iOS grants
    // permission and then never issues a token, which looked like success.
    return await new Promise((resolve) => {
      let settled = false;
      const done = (r: { ok: true } | { ok: false; reason: PushFailure }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void reg.then((h) => h.remove());
        void errReg.then((h) => h.remove());
        resolve(r);
      };
      const timer = setTimeout(() => done({ ok: false, reason: 'no-token' }), 12000);
      const reg = PushNotifications.addListener('registration', (t) => {
        void saveToken(t.value).then(() => done({ ok: true }));
      });
      const errReg = PushNotifications.addListener('registrationError', (e) => {
        console.error('push registration failed', e);
        done({ ok: false, reason: 'no-token' });
      });
      void PushNotifications.register();
    });
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** Already granted? Used to re-register silently on later launches. */
export async function pushAlreadyGranted(): Promise<boolean> {
  if (!pushSupported) return false;
  try {
    return (await PushNotifications.checkPermissions()).receive === 'granted';
  } catch {
    return false;
  }
}

/**
 * Drop this device's token. MUST run on sign-out: otherwise the next person to
 * use the phone keeps receiving the previous user's building notices.
 */
export async function disablePush(): Promise<void> {
  if (!pushSupported) return;
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user?.id) {
      // We cannot read the token back from iOS, so clear every token this user
      // has registered on this install.
      await supabase.from('device_tokens').delete().eq('user_id', auth.user.id);
    }
    await PushNotifications.removeAllListeners();
    listenersBound = false;
  } catch { /* best effort — signing out must not fail on this */ }
}
