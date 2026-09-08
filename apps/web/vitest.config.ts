import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Premier harnais de test de l'interface. jsdom exécute le code d'un composant, mais ne met rien
// en page : tout ce qui relève de la géométrie — débordement, position réelle d'un panneau, rendu
// à 375 px — reste à vérifier dans un vrai navigateur, au lot 9 (Playwright).
export default defineConfig({
  plugins: [svelte()],
  resolve: { conditions: ['browser'] },
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'] },
});
