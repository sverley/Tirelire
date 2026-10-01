/**
 * Rapporteur `node --test` du lanceur (#302) : ce que chaque fichier de test a donné, pour que le
 * lanceur atteste ceux dont tous les tests ont tourné et fini verts. Une ligne JSON par fichier
 * lancé (`lance`), puis, s'il y a lieu, une ligne `echec` (un test rouge ou annulé, ou le fichier qui
 * ne se charge pas) et une ligne `saute` (un test sauté, faute d'outil par exemple), chacune avec son
 * fichier.
 *
 * Le fichier se lit sur le bilan que node donne de chaque fichier (`test:summary`) et sur le test qui
 * porte son nom : les événements des tests eux-mêmes situent le test là où `test()` est appelé, qui
 * est l'enveloppe des niveaux (`niveaux-node-enveloppe.mjs`) quand un seuil est posé. Un test `todo`
 * ne compte ni comme échec ni comme saut, comme dans `verdictDuLancement` (`attestation.mjs`).
 */
import { resolve } from 'node:path';

const ligne = (type, fichier) => `${JSON.stringify({ type, fichier })}\n`;

export default async function* rapport(source) {
  const lances = new Set();
  function* lance(fichier) {
    if (lances.has(fichier)) return;
    lances.add(fichier);
    yield ligne('lance', fichier);
  }
  for await (const { type, data } of source) {
    if (!data?.file) continue;
    const fichier = resolve(data.file);
    if (type === 'test:summary') {
      yield* lance(fichier);
      const c = data.counts ?? {};
      if (c.failed || c.cancelled) yield ligne('echec', fichier);
      if (c.skipped) yield ligne('saute', fichier);
    } else if (data.nesting === 0 && resolve(String(data.name)) === fichier) {
      // Le test du fichier lui-même : il échoue si le fichier ne se charge pas, ou si un test rougit.
      yield* lance(fichier);
      if (type === 'test:fail' || (type === 'test:complete' && data.details?.passed === false)) yield ligne('echec', fichier);
    }
  }
}
