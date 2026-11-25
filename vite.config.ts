import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { cpSync } from 'node:fs'

export default defineConfig({
  plugins: [
    react(), tailwind(),
    {
      name: 'pdf-runtime-assets',
      buildStart() {
        for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
          cpSync('node_modules/pdfjs-dist/' + folder, 'public/pdf/' + folder, { recursive: true })
        }
      },
    },
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'maskable.png'],
      manifest: {
        name: 'Folio — Your reading room', short_name: 'Folio',
        description: 'A private, offline-first PDF flipbook reader.',
        theme_color: '#101216', background_color: '#101216', display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,webp,jpg,pdf,woff2,bcmap,ttf,pfb,wasm,icc}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
    }),
  ],
})
