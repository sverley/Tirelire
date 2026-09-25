import { configDefaults, defineConfig } from 'vitest/config';

// Config séparée de `vite.config.ts` : les tests tournent dans Node et démarrent eux-mêmes le
// serveur de développement ; ils n'ont pas besoin des greffons Svelte ni PWA.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // En CI, les tests navigateur se jouent dans leur propre étape, à leur seuil (#232) :
    // `TIRELIRE_SANS_NAVIGATEUR` les retire du `pnpm test` de tous les paquets.
    exclude: process.env.TIRELIRE_SANS_NAVIGATEUR ? [...configDefaults.exclude, 'test/navigateur/**'] : configDefaults.exclude,
    // Démarrage du serveur Vite + lancement du navigateur : large, mais franchi une seule fois.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Garde de #113 : un harnais joué en local ne sort pas de la machine.
    setupFiles: ['../../packages/gardes/sans-sortie-vitest.mjs'],
  },
});
