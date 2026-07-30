import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import './i18n';
import App from './App';

// After a redeploy, an open tab still references old hashed chunk files that no
// longer exist — lazy routes then fail to load and the app blanks out. Vite
// fires this event on chunk-load failure; one reload picks up the new build.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  window.location.reload();
});

// Service worker: when a NEW deploy's worker takes control it purges the old
// deploy's cached files — the page that's still open then 404s on its own
// chunks (blank pages until enough manual refreshes). Reload once, automatically,
// the moment control changes; and proactively check for updates so long-lived
// sessions don't drift stale.
let reloading = false;
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (reloading) return;
  reloading = true;
  window.location.reload();
});
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    setInterval(() => registration.update(), 60 * 60 * 1000); // hourly
    document.addEventListener('visibilitychange', () => {     // and on tab return
      if (document.visibilityState === 'visible') registration.update();
    });
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
