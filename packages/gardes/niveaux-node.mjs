/**
 * Préchargement du lanceur (#232) pour `node --test` : quand un seuil est posé
 * (`TIRELIRE_SEUIL`), tout `import … from 'node:test'` reçoit l'enveloppe `niveaux-node-enveloppe.mjs`,
 * qui n'inscrit que les tests de niveau inférieur ou égal. Chargé par `--import`, il suit les
 * processus de chaque fichier de test.
 */
import { register } from 'node:module';

if (process.env.TIRELIRE_SEUIL) register('./niveaux-node-crochet.mjs', import.meta.url);
