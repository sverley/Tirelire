import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Garde de #113 : un harnais joué en local ne sort pas de la machine.
    setupFiles: ['../gardes/sans-sortie-vitest.mjs'],
  },
});
