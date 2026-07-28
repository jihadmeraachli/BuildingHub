import type { CapacitorConfig } from '@capacitor/cli';

// Native app shell (iOS via Capacitor). The web app in dist/ is bundled into
// the binary — build the web app first, then `npx cap sync ios`.
// Mac-side workflow: docs/IOS_APP.md
const config: CapacitorConfig = {
  appId: 'com.abniyah.app',
  appName: 'Abniyah',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
