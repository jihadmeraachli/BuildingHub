# Android App — Capacitor + Google Play

The Android app is the same web app in a native shell, exactly as iOS is. The
good news up front: **Android builds on Windows**. No Mac in the loop, so Jey
can do the whole thing without waiting on hardware.

_Written 2026-08-07. iOS equivalent: [docs/IOS_APP.md](IOS_APP.md)._

## The decision to make before anything else

**Register the Play developer account as an ORGANIZATION, not a personal one.**

Personal accounts created after 13 November 2023 must run a closed test with
**at least 12 testers, opted in continuously for 14 days**, before they may
apply for production access. The 14 days only start counting once the release
is approved *and* 12 testers have actually opted in, so in practice it is
closer to three weeks.

**Organization accounts registered to a legal business entity are exempt
entirely.** Abniyah is a Tatawwor product, so the entity exists.

The trade: an organization account needs a **D-U-N-S number**, which takes time
to obtain (the same hurdle noted for Apple in the iOS doc). So it is a wait
either way — but a D-U-N-S can be applied for today, in parallel with building,
whereas the 12-tester clock cannot start until the app is finished and
approved. Start the D-U-N-S process now if Android matters.

Either way the account costs **$25 once**, not yearly like Apple.

## Prerequisites

| | |
|---|---|
| **Android Studio** | Includes the SDK and a bundled JDK. Windows is fine. |
| **`@capacitor/android`** | The one npm package not yet installed. |
| **Play Console account** | $25 one-time. See the decision above. |
| **A signing keystore** | Generated once. **Losing it means you can never update the app** — a new keystore is a new app, with a new listing and no existing users. Back it up somewhere that is not just this laptop. |
| **A test device** | The emulator is fine for most things, but not for biometrics or push. |

## First build

```bash
npm install @capacitor/android
npx cap add android
npx @capacitor/assets generate --android   # icon + splash from assets/
npm run build
npx cap sync android
npx cap open android                        # opens Android Studio
```

Like `ios/`, the generated **`android/` folder is not committed** — each
machine generates its own, which is why the manual steps below have to be
repeated after any regeneration.

## Push notifications need Firebase, and none of the APNs work carries over

This is the one genuinely new piece of engineering, not a port.

Android push goes through **Firebase Cloud Messaging**, which shares nothing
with APNs except our own database and the events that trigger a send:

1. Create a Firebase project, add an Android app with package `com.abniyah.app`.
2. Download **`google-services.json`** into `android/app/`.
3. `@capacitor/push-notifications` handles the client side; the token lands in
   the same `device_tokens` table, with `platform = 'android'` (0084 already
   allows for it).
4. **`dynamic-action` needs an FCM sender** alongside `pushToUserIds()`. The
   APNs code stays; a parallel branch sends to Android tokens using a Firebase
   service account (HTTP v1 API), and the function picks by `platform`.

⚠️ The iOS lesson worth remembering: the failure was never in the sending
logic, it was two native setup steps nobody had written down. Expect the
Android equivalent to be `google-services.json` in the wrong place, and check
that first.

## The other two plugins

Both already work on Android, but confirm on a real device:

- **`@aparajita/capacitor-biometric-auth`** → Android BiometricPrompt
  (fingerprint or face). The Keychain-vs-localStorage lesson from iOS applies
  identically: anything that must survive the app closing goes through
  `src/lib/devicePrefs.ts`, never `localStorage`.
- **`@aparajita/capacitor-secure-storage`** → Android Keystore. Same adapter,
  no code change.

## Play Store listing requirements

- **Privacy policy URL** — already public at `abniyah.com/privacy`, kept
  deliberately outside the beta gate.
- **Data safety form** — declares what the app collects. Be accurate: it
  collects names, emails, phone numbers, and financial records about units.
- **Content rating questionnaire.**
- **Target API level** — Play enforces a recent one; Android Studio will warn
  if the Capacitor default has fallen behind.
- Screenshots, feature graphic, short and full description. The Arabic listing
  is worth doing properly rather than machine-translating, for the same reason
  the ads are written in Arabic rather than translated.

## Shipping

```bash
npm run build      # ⚠️ NOT optional — this is what puts the new app in the binary
npx cap sync android
npx cap open android
```

Then in Android Studio: **Build → Generate Signed Bundle / APK → Android App
Bundle (.aab)**, signed with the keystore, and upload the `.aab` in the Play
Console.

⚠️ Same trap as iOS: **skipping `npm run build` + `npx cap sync android` ships
the previous web app under a new version code**, and nothing warns you.

Version code must increase on every upload. Play rejects a repeat, exactly as
App Store Connect does.
