import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registration lives in main.tsx (controllerchange reload + periodic
      // update checks) — don't also inject the bare registerSW.js script.
      injectRegister: false,
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'logo-color.png', 'logo-mask.png'],
      manifest: {
        name: 'Abniyah',
        short_name: 'Abniyah',
        description: 'Building management for residents, owners and managers.',
        start_url: '/',
        display: 'standalone',
        background_color: '#0F4A3F',
        theme_color: '#0F4A3F',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // SPA fallback for client-side routes; never intercept Supabase calls.
        // The fallback is '/', NOT '/index.html': Cloudflare Pages answers
        // /index.html with a 308 to /, and Safari refuses a redirected
        // response from a service worker ("Response served by service worker
        // has redirections") — which is exactly what the payer saw coming
        // back from Whish to /licenses?paid=1 on 10 Oct 2026. '/' is 200, so
        // it is precached as its own entry and index.html stays out of the
        // manifest.
        navigateFallback: '/',
        navigateFallbackDenylist: [/^\/functions\//],
        globPatterns: ['**/*.{js,css,png,svg,ico,woff2}'],
        additionalManifestEntries: [{ url: '/', revision: String(Date.now()) }],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // A frequent-deploy day left old workers serving a precache whose
        // files the next deploy had replaced: a plain refresh died with
        // ERR_FAILED while ctrl+shift+R (which bypasses the worker) worked.
        // Drop stale precaches and let a new worker take over at once.
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
