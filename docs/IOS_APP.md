# iOS App — Capacitor + TestFlight

The iOS app is the existing web app bundled into a native shell with
**Capacitor**. Everything repo-side is committed (config, icons, splash);
building and shipping happens **on the Mac** with Xcode.

_Written 2026-07-28._

## One-time setup (Mac)

### 1. Apple Developer account — $99/year
Enroll at **developer.apple.com/programs/enroll** with an Apple ID you keep
long-term.

- **Individual** (recommended to start): approved in ~24–48h. App Store seller
  name shows your personal name.
- **Organization**: seller shows "Abniyah" but needs a D-U-N-S number and legal
  entity — takes weeks. You can start Individual and migrate later.

### 2. Install tools
1. **Xcode** from the Mac App Store (big download, ~1h). Open it once and accept
   the license / let it install components.
2. **Node.js**: install from nodejs.org (LTS), or `brew install node`.
3. **CocoaPods** (Capacitor's iOS dependency manager):
   `sudo gem install cocoapods` (or `brew install cocoapods`).

### 3. Get the project
```bash
git clone https://github.com/jihadmeraachli/BuildingHub.git
cd BuildingHub
npm install
```
Create `.env.local` in the project root (same two values as on Windows — copy
them from Cloudflare Pages env or your Windows `.env.local`):
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

### 4. Create the iOS project (once)
```bash
npm run build
npx cap add ios
npx @capacitor/assets generate --ios   # app icon + splash from assets/
```
`npx cap add ios` generates the `ios/` folder (the native Xcode project).
It is **not** committed to git — each machine generates its own.

### 5. Open in Xcode, sign, run
```bash
npx cap open ios
```
In Xcode:
1. Click the **App** project (left sidebar) → target **App** → tab
   **Signing & Capabilities** → tick **Automatically manage signing** →
   **Team**: select your Apple Developer team.
2. Bundle identifier should read `com.abniyah.app` (from capacitor.config.ts).
3. Pick a simulator (e.g. iPhone 15) in the toolbar → **▶ Run**. The app should
   boot to the beta-gate/login screen.
4. To run on your real iPhone: plug it in, select it as the target, Run —
   first time, approve the developer cert on the phone
   (Settings → General → VPN & Device Management).

## Face ID sign-in (one-time native step)

Settings → "Sign in with Face ID" uses the `@aparajita/capacitor-biometric-auth`
plugin. After pulling code that includes it, run `npm install` and
`npx cap sync ios` as usual — plus ONE manual step, because the `ios/` project
isn't committed:

1. Xcode → blue **App** project → target **App** → **Info** tab.
2. Add a new row: key **"Privacy - Face ID Usage Description"**
   (`NSFaceIDUsageDescription`), value: `Abniyah uses Face ID to protect your building data.`
3. Build & run, turn the toggle on, then **fully quit the app** (swipe it away
   in the app switcher) and reopen — the Face ID prompt should appear before
   any app content. Restarting the phone should behave the same.

**What it does (changed 2026-08-04, #55):** the prompt fires once **per
launch** — cold start or first open after a device restart — and NOT when you
merely switch away and come back. The earlier behaviour re-locked on every
backgrounding, which made routine app switching tedious.

"Use my password instead" on the gate signs out and falls back to the normal
login form, so a failed or broken Face ID is never a dead end.

**Face ID also signs you in FROM THE LOGIN SCREEN** — after an explicit sign
out, after the app was closed, after a restart. That needs a credential that
outlives `signOut()`, so `src/lib/bioSession.ts` keeps its own copy of the
refresh token in the Keychain, separate from Supabase's session storage. It is
written when Face ID is switched on (and refreshed on each password login), and
**destroyed when Face ID is switched off** — otherwise disabling the setting
would leave a working way into the account.

The trade-off, which is the same one banking apps make: anyone who can pass
Face ID or the device passcode can get back in without the password. If the
stored token has expired or been revoked, the button disappears and the
password is the way back in.

### The session lives in the Keychain (second plugin, 2026-08-04)

Swiping the app away used to lose the session entirely — WKWebView
localStorage did not survive termination — so on reopening there was nothing
for Face ID to unlock and the password had to be retyped. The Supabase session
is now stored via **`@aparajita/capacitor-secure-storage`** (iOS Keychain),
which does survive termination and device restarts.

- Access level `whenPasscodeSetThisDeviceOnly`: readable only while the device
  is unlocked, only on a device that has a passcode, and never restored onto a
  different device from a backup.
- **Web is untouched** — the adapter is only wired up when
  `Capacitor.isNativePlatform()`, so browsers keep Supabase's own localStorage.
- Every Keychain call falls back to localStorage on failure. A storage problem
  degrades to the old behaviour rather than locking anyone out.
- **No extra Xcode step** for this one — plain Keychain access needs no
  entitlement or usage description. `npm install` + `npx cap sync ios` is
  enough. (The Face ID usage description above is still required.)

⚠️ **Anything that must survive the app closing goes in `src/lib/devicePrefs.ts`,
never `localStorage`.** iOS clears the web view's storage on termination. The
first cut of this feature put the session in the Keychain but left the "Face ID
is on" flag in localStorage, so relaunching forgot the setting, skipped the
gate and fell back to the password screen — the exact launch the feature exists
for. The remembered email and the "already offered Face ID" flag had the same
bug. `devicePrefs` reads are synchronous against a cache that
`loadDevicePrefs()` fills, and `BioLock` awaits it before deciding anything.

⚠️ Re-add this row any time you delete and regenerate the `ios/` folder
(`npx cap add ios` starts fresh). Without it, iOS kills the app when Face ID
is invoked.

## Push notifications (one-time native step)

Real alerts that arrive with the app closed and the phone locked, via
`@capacitor/push-notifications` → Apple APNs, sent from `dynamic-action`
alongside the existing email and WhatsApp on the same events.

**In Xcode** (target **App** → **Signing & Capabilities** → **+ Capability**):
1. **Push Notifications**
2. **Background Modes** → tick **Remote notifications**

⚠️ Re-add both after any `npx cap add ios` regeneration, like the Face ID usage
description and Associated Domains.

**Apple side (already done):** App ID `com.abniyah.app` has Push Notifications
enabled, and an APNs key exists — Key ID `222WU36W5N`, Team ID `8PHJEU7CDL`,
scoped to **Sandbox & Production**. That last choice matters: TestFlight and the
App Store are BOTH production, and only builds run straight from Xcode are
sandbox. The sender tries production first and retries sandbox when Apple
answers `BadDeviceToken`, so both work without a config switch.

**Supabase secrets:** `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (the
whole `.p8` file, BEGIN/END lines included). See docs/DEPENDENCIES.md.

**Behaviour:** permission is requested only from the Settings toggle, never on
launch — iOS grants exactly one chance at that prompt, and asking cold is how
apps get denied permanently. Every launch silently re-registers when permission
already exists, because iOS can issue a **new** device token after an update or
a restore and a stale one stops delivering with no error anywhere. Signing out
deletes the device's tokens, so the next person to use the phone does not keep
receiving the previous user's building notices. Apple reporting a token as gone
(HTTP 410) prunes it automatically.

## Shipping to TestFlight (every release)

```bash
git pull
npm install        # only when dependencies changed
npm run build      # ⚠️ NOT optional — this is what puts the new app in the binary
npx cap sync ios   # ⚠️ copies dist/ into the iOS project
npx cap open ios
```

⚠️ **Skipping `npm run build` + `npx cap sync ios` ships the PREVIOUS web app
under a new build number**, and nothing warns you — the upload succeeds and the
testers see no change. If a build seems not to contain your work, this is why.

Then in Xcode:
1. Target **App** → **General** → **Identity** → increment **Build** (3 → 4 →
   …). App Store Connect rejects a build number it has already seen, so this is
   required every upload. Bump **Version** (1.0 → 1.1) only for a
   user-meaningful release; the build number alone is enough for TestFlight.
2. Toolbar target → **Any iOS Device (arm64)**.
3. Menu **Product → Archive**.
4. When the Organizer window opens → **Distribute App → App Store Connect →
   Upload** (defaults are fine).
5. **appstoreconnect.apple.com** → Apps → Abniyah (first time: create the app
   record — name `Abniyah`, bundle id `com.abniyah.app`, SKU `abniyah`) →
   **TestFlight** tab.
6. The build appears after ~10 min of processing. Answer the export-compliance
   question (uses standard HTTPS encryption only → **exempt**).
7. **Internal testers** (you + Ahmad, up to 100): instant, no review.
   **External testers** (your beta users, up to 10,000): needs a light
   TestFlight review, usually ~1 day the first time.
8. Testers install the **TestFlight** app from the App Store and accept your
   invite (email or public link).

⚠️ Remember: the web app is **bundled** into the binary. A web change deployed
to Cloudflare does NOT update the iOS app — repeat the steps above and push a
new TestFlight build. (Fine at beta pace; if it gets tedious we can add a
live-update service later.)

## The full App Store (after beta)

Same archive/upload flow, but on the **App Store** tab instead of TestFlight:
screenshots, description, privacy policy URL (roadmap: legal pages), and a full
review (2–4 days). Apple's reviewers dislike apps that are "just a website" —
before submitting we should add a native touch or two (e.g. push notifications
via Capacitor, biometric unlock for the session). TestFlight has no such bar —
ship the beta now, polish for App Store later.

## Repo pieces (already done, Windows-side)

- `capacitor.config.ts` — appId `com.abniyah.app`, webDir `dist`
- `assets/icon.png`, `assets/splash*.png` — sources for
  `npx @capacitor/assets generate` (brand gradient + light logo)
- `@capacitor/core` / `@capacitor/cli` / `@capacitor/ios` in package.json
- PWA manifest + service worker (vite-plugin-pwa) — also makes the web app
  installable from the browser on Android/iPhone (Add to Home Screen), which
  keeps working independently of the native app
