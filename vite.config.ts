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
        // SPA fallback for client-side routes; never intercept Supabase calls
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/functions\//],
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
