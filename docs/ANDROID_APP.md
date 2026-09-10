# Android app — build pipeline & status

Started 2026-09-10. Unlike iOS (which needs the Mac — see IOS_APP.md), the
entire Android pipeline runs on the Windows machine. First debug APK built
and sideloaded the same day.

## Status
- ✅ Capacitor Android platform (`@capacitor/android`, folder gitignored like `ios/`)
- ✅ Icons + splash (all densities) generated from `assets/icon.png` / `assets/splash*.png`
- ✅ Debug APK builds locally (17 MB), points at production Frankfurt
- ✅ Biometrics: `@aparajita/capacitor-biometric-auth` is cross-platform — fingerprint works with zero changes
- ✅ `device_tokens.platform` supported `'android'` since 0084; `src/lib/push.ts` stamps it
- ✅ `dynamic-action` has an FCM v1 send branch (env-guarded, inert until `FCM_SERVICE_ACCOUNT` is set)
- ⬜ Firebase project + `google-services.json` (Jey — see below)
- ⬜ `FCM_SERVICE_ACCOUNT` secret + dynamic-action redeploy
- ⬜ Release keystore + signed AAB
- ⬜ Google Play Console organization account
- ⬜ Play listing (reuse docs/APP_STORE.md copy + screenshots pipeline)

## Toolchain on this machine (installed 2026-09-10)
- JDK: `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot` (Temurin 21, winget)
- Android SDK: `C:\Android` (cmdline-tools + platform-tools + platforms;android-36 + build-tools;36.0.0)
- `android/local.properties` (gitignored) carries `sdk.dir=C:\\Android`

## Build commands (PowerShell)
```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
$env:ANDROID_HOME = "C:\Android"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

npm run build                # web bundle (uses .env.local -> PRODUCTION db)
npx cap sync android         # copy dist/ into the native project
cd android
.\gradlew.bat assembleDebug  # -> android\app\build\outputs\apk\debug\app-debug.apk
```
Release (once keystore exists): `.\gradlew.bat bundleRelease` → AAB for Play.

## Fresh machine? Regenerate the platform
`android/` is **gitignored** (same convention as `ios/`): one-time
`npx cap add android`, then `npx @capacitor/assets generate --android`,
then drop `google-services.json` into `android/app/` (download from the
Firebase console — it is NOT in the repo), then the build commands above.

## Sideloading onto the Pixel Tablet (testing)
1. Settings → About tablet → tap **Build number** 7× (enables Developer options)
2. Transfer `app-debug.apk` (Drive/USB/chat) → tap it → allow "install unknown apps" for the source app → Install
3. Or with a USB cable: `C:\Android\platform-tools\adb.exe install app-debug.apk`

## Push notifications (the one missing piece) — Jey's console steps
1. **Firebase**: console.firebase.google.com → Add project (name: Abniyah;
   Analytics off is fine) → Add app → Android → package `com.abniyah.app`
   → download **google-services.json** → put it in `android/app/`.
   The gradle template auto-detects it; rebuild and Android push registers.
2. **Server key**: Project settings → Service accounts → **Generate new
   private key** (a JSON file downloads). Supabase → Edge Functions →
   secrets → add `FCM_SERVICE_ACCOUNT` = the ENTIRE file contents.
   Redeploy `dynamic-action`. iOS/APNs is untouched; the send loop splits
   by `device_tokens.platform`.

## Google Play (when ready to ship)
- Play Console **organization** account: play.google.com/console → $25
  one-time → requires the D-U-N-S (**557923160**, same as Apple) and org
  website tatawwor.com. Same seller-identity logic as the Apple conversion.
- Signing: generate an upload keystore (`keytool -genkey ...`), enroll in
  **Play App Signing** (Google holds the release key; the upload key is
  replaceable if lost). NEVER commit the keystore; store it with the other
  company credentials.
- Listing: reuse APP_STORE.md copy; screenshots via the existing Playwright
  pipeline at Android sizes (phone 1080×1920+, 7"/10" tablet for tablets).
- Review notes: same demo access + review account + gate code as Apple
  (see APP_STORE.md "Provisioned" section).
