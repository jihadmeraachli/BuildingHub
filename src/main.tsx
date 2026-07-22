import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
