import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import './i18n';
import App from './App';

// After a redeploy, an open tab still references old hashed chunk files that no
// longer exist — lazy routes then fail to load and the app blanks out. Vite
// fires this event on chunk-load failure. One reload usually picks up the new
// build — but if a stale service worker / HTTP cache keeps serving the old
// index, plain reloads LOOP forever. So: first failure reloads; a repeat within
// 30s self-heals (unregister SWs, clear caches) and reloads once more; a third
// gives up and lets the error surface instead of spinning.
window.addEventListener('vite:preloadError', async (event) => {
  event.preventDefault();
  const now = Date.now();
  const last = Number(sessionStorage.getItem('chunk_reload_at') ?? 0);
  if (now - last < 30_000) {
    if (sessionStorage.getItem('chunk_healed')) return; // already healed once — stop looping
    sessionStorage.setItem('chunk_healed', '1');
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = (await caches?.keys?.()) ?? [];
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch { /* best effort */ }
  }
  sessionStorage.setItem('chunk_reload_at', String(now));
  window.location.reload();
});

// A boot that survives 15s is healthy — reset the loop-breaker state.
setTimeout(() => {
  sessionStorage.removeItem('chunk_reload_at');
  sessionStorage.removeItem('chunk_healed');
}, 15_000);

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
