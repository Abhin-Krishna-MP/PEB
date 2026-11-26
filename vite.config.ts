import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { cpSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const fromTransformers = createRequire(require.resolve('@huggingface/transformers'))

export default defineConfig({
  resolve: {
    alias: [{ find: /^folio-ort-wasm(?=\?|$)/, replacement: fromTransformers.resolve('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm') }],
  },
  worker: { format: 'es' },
  plugins: [
    react(), tailwind(),
    {
      name: 'pdf-runtime-assets',
      buildStart() {
        mkdirSync('public/spirit-runtime', { recursive: true })
        for (const file of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
          cpSync(fromTransformers.resolve('onnxruntime-web/' + file), 'public/spirit-runtime/' + file)
        }
        for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
          cpSync('node_modules/pdfjs-dist/' + folder, 'public/pdf/' + folder, { recursive: true })
        }
      },
    },
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'icon-192.png', 'icon-512.png', 'maskable.png'],
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
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,webp,jpg,gif,pdf,woff2,bcmap,ttf,pfb,wasm,icc}'],
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        globIgnores: ['**/*.onnx', '**/*.onnx_data*'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
    }),
  ],
})
