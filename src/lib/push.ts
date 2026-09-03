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

/** Deep link (3 Sep): the sender stamps each push with the in-app route it
 *  belongs to; tapping the notification lands THERE, not wherever the app
 *  was left. Bound at module load - AuthContext imports this file, so the
 *  listener exists before a cold-start tap is delivered. A full navigation
 *  (not SPA push) works from every state; the bio gate's per-launch
 *  sessionStorage unlock survives it. */
function bindTapListener() {
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const route = (action.notification.data as { route?: string } | undefined)?.route;
    if (typeof route === 'string' && /^\/[a-z0-9\-/]*$/i.test(route)) {
      window.location.href = route;
    }
  });
}
if (pushSupported) bindTapListener();

/** Why enabling failed, when it does. Surfaced in Settings so a silent
 *  misconfiguration is not mistaken for "it just doesn't work".
 *  'no-token'  — iOS actively refused to issue one (carries Apple's reason)
 *  'timeout'   — nothing came back at all, which can just be a slow network
 *  'save'      — Apple issued a token but storing it failed */
export type PushFailure = 'denied' | 'no-token' | 'timeout' | 'save' | 'error';

/** Apple's own words for the last failure. Each diagnostic cycle costs a whole
 *  TestFlight build, so the real message is worth showing rather than guessing
 *  from symptoms. */
export let lastPushError = '';

/** Store (or refresh) this device's token. Returns an error string on failure —
 *  the first version ignored the result, so a rejected write looked identical
 *  to success and the toggle happily reported "on" with nothing saved. */
async function saveToken(token: string): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return 'not signed in';
  // Upsert on the token: the same device re-registering must update its row,
  // not add another, or one phone buzzes repeatedly per notification.
  const { error } = await supabase.from('device_tokens').upsert(
    {
      user_id: uid,
      token,
      platform: Capacitor.getPlatform() === 'android' ? 'android' : 'ios',
      last_seen: new Date().toISOString(),
    },
    { onConflict: 'token' },
  );
  return error ? `${error.code ?? ''} ${error.message}`.trim() : null;
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
    lastPushError = '';
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
      // Separate from a refusal: nothing arriving can simply mean a slow or
      // restricted network, which is a different problem from iOS saying no.
      const timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), 15000);
      const reg = PushNotifications.addListener('registration', (t) => {
        void saveToken(t.value).then((err) => {
          if (err) { lastPushError = err; done({ ok: false, reason: 'save' }); }
          else done({ ok: true });
        });
      });
      const errReg = PushNotifications.addListener('registrationError', (e) => {
        lastPushError = (e as { error?: string })?.error ?? JSON.stringify(e);
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
    bindTapListener(); // removeAllListeners took the tap deep-link with it
  } catch { /* best effort — signing out must not fail on this */ }
}
