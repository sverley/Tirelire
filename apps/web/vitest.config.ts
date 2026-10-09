import { defineConfig, type Plugin } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * Le service worker ne s'inscrit pas dans un test : `virtual:pwa-register`, que seul le greffon PWA
 * fournit, y est un module qui n'inscrit rien.
 */
const pwaSansServiceWorker: Plugin = {
  name: 'tirelire-pwa-sans-service-worker',
  resolveId: (id) => (id === 'virtual:pwa-register' ? '\0virtual:pwa-register' : undefined),
  load: (id) => (id === '\0virtual:pwa-register' ? 'export function registerSW() { return async () => {}; }' : undefined),
};

// Config séparée de `vite.config.ts` : les tests tournent dans Node, et les tests navigateur
// construisent et servent eux-mêmes le site. Le greffon Svelte et la condition `browser` servent aux
// tests de l'interface sans navigateur qui montent l'application sous jsdom (`test/ecran.ts`, #417) :
// ils y exécutent les composants tels que le navigateur les exécute ; le greffon PWA n'y est pas.
export default defineConfig({
  plugins: [svelte({ compilerOptions: { hmr: false } }), pwaSansServiceWorker],
  resolve: { conditions: ['browser'] },
  test: {
    include: ['test/**/*.test.ts'],
    // Démarrage du serveur Vite + lancement du navigateur : large, mais franchi une seule fois.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Garde de #113 : un harnais joué en local ne sort pas de la machine.
    setupFiles: ['../../packages/gardes/sans-sortie-vitest.mjs'],
    // Le site des tests navigateur se construit une fois par lancement (#302, point 8).
    globalSetup: ['vitest.site-du-lancement.ts'],
  },
});
