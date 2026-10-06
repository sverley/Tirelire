/**
 * Rapporteur `node --test` du lanceur (#352, point 4) : chaque test en échec, avec son message et
 * l'endroit de l'échec, une ligne JSON par test (`echecs.mjs`). node donne les événements d'un
 * fichier puis son bilan (`test:summary`) : les échecs vus depuis le bilan précédent sont les siens.
 * Une suite qui n'échoue que parce qu'un de ses tests échoue n'est pas redite.
 */
import { resolve } from 'node:path';
import { endroitDans, messageDe } from './echecs.mjs';

export default async function* rapport(source) {
  let enAttente = [];
  for await (const { type, data } of source) {
    if (type === 'test:fail') {
      const erreur = data.details?.error;
      if (erreur?.failureType === 'subtestsFailed') continue;
      const cause = erreur?.cause ?? erreur;
      enAttente.push({ test: String(data.name), message: messageDe(cause?.message ? cause : erreur), pile: String(cause?.stack ?? ''), lieu: data.file ? `${resolve(data.file)}:${data.line}:${data.column}` : null });
    } else if (type === 'test:summary' && data.file) {
      const fichier = resolve(data.file);
      for (const e of enAttente) {
        const endroit = endroitDans(e.pile, fichier) ?? (e.lieu && !/niveaux-node-enveloppe\.mjs:/.test(e.lieu) ? e.lieu : null);
        yield `${JSON.stringify({ fichier, test: e.test, message: e.message, endroit })}\n`;
      }
      enAttente = [];
    }
  }
}
