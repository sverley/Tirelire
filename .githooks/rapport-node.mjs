/**
 * Rapporteur `node --test` du pré-commit (#127, D75). Il écrit une ligne JSON par échec et par
 * sortie d'erreur, chacune avec son fichier de test, pour que `verdict.mjs` trie les échecs par
 * fichier. Un fichier qui ne se charge pas (syntaxe, import) échoue sous son propre nom ; sa sortie
 * d'erreur dit pourquoi.
 */
import { resolve } from 'node:path';

export default async function* rapport(source) {
  for await (const { type, data } of source) {
    if (type === 'test:fail') {
      const file = data.file ? resolve(data.file) : null;
      const erreur = data.details?.error;
      yield `${JSON.stringify({
        type: 'echec',
        file,
        name: data.name,
        fichier: Boolean(file) && data.nesting === 0 && resolve(String(data.name)) === file,
        sorte: erreur?.failureType ?? null,
        message: String(erreur?.cause?.message ?? erreur?.message ?? '').slice(0, 300),
      })}\n`;
    } else if (type === 'test:stderr' && data.file) {
      yield `${JSON.stringify({ type: 'stderr', file: resolve(data.file), message: String(data.message) })}\n`;
    }
  }
}
