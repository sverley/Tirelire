import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// `--base` (ou TIRELIRE_BASE) permet de servir le site depuis un sous-dossier d'un hébergement.
export default defineConfig({
  base: process.env.TIRELIRE_BASE ?? '/',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Tirelire',
        short_name: 'Tirelire',
        description: 'Comptes de la famille : enveloppes, provisions, plan de virements.',
        lang: 'fr',
        theme_color: '#1f6b58',
        background_color: '#f7f8f5',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,wasm}'], maximumFileSizeToCacheInBytes: 5_000_000 },
    }),
  ],
  optimizeDeps: { exclude: ['sql.js'] },
  build: { target: 'es2022' },
});
