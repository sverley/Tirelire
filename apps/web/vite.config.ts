import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// `--base` (ou TIRELIRE_BASE) permet de servir le site depuis un sous-dossier d'un hébergement.
const base = process.env.TIRELIRE_BASE ?? '/';

/**
 * Les navigations que le service worker laisse au serveur, au lieu d'y répondre par la page de
 * l'application : les sous-dossiers `pr-<numéro>` sous `racine`, la base du site. À la racine de la
 * recette, la version de développement a pour portée toute la recette ; sans cela, elle servirait sa
 * propre page à la place de chaque aperçu, qui doit rester servi par lui-même, avec son service
 * worker (#233).
 */
export function navigationsLaisséesAuServeur(racine: string): RegExp[] {
  const préfixe = (racine.endsWith('/') ? racine : `${racine}/`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [new RegExp(`^${préfixe}pr-[1-9][0-9]*(?:[/?]|$)`)];
}

export default defineConfig({
  base,
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
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,wasm}'],
        maximumFileSizeToCacheInBytes: 5_000_000,
        navigateFallbackDenylist: navigationsLaisséesAuServeur(base),
      },
    }),
  ],
  optimizeDeps: { exclude: ['sql.js'] },
  build: { target: 'es2022' },
});
