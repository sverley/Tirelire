import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { execFileSync } from 'node:child_process';
import { versionConstruite } from './src/lib/version';

// `--base` (ou TIRELIRE_BASE) permet de servir le site depuis un sous-dossier d'un hébergement.
const base = process.env.TIRELIRE_BASE ?? '/';

/** Le commit d'une construction locale, s'il se lit ; rien n'est inventé sinon (#142). */
function commitLocal(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

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
  // La version que ce code exécutera, fixée ici : ce que l'application affiche (#142, `version.ts`).
  define: { __TIRELIRE_VERSION__: JSON.stringify(versionConstruite(process.env, commitLocal)) },
  plugins: [
    svelte(),
    VitePWA({
      // Une nouvelle version s'installe puis attend : l'application le signale et l'utilisateur
      // choisit quand recharger ; rien ne se recharge à son insu (#142, principe 4).
      registerType: 'prompt',
      injectRegister: false,
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
