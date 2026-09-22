/**
 * Rapporteur `node --test` du pré-commit (#127). Il écrit une ligne JSON par échec, par test
 * passé, par diagnostic et par sortie d'erreur, chacun avec son fichier de test, pour que
 * `verdict.mjs` trie les échecs par fichier. Un fichier en échec hors de tout test échoue sous son
 * propre nom : s'il ne s'est pas chargé (syntaxe, import), sa sortie d'erreur dit pourquoi ; s'il
 * s'est chargé (promesse rejetée après la fin d'un test, sortie en échec), un diagnostic ou sa
 * sortie d'erreur le dit.
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
    } else if (type === 'test:pass' && data.file) {
      yield `${JSON.stringify({ type: 'passe', file: resolve(data.file) })}\n`;
    } else if ((type === 'test:stderr' || type === 'test:diagnostic') && data.file) {
      const sorte = type === 'test:stderr' ? 'stderr' : 'diagnostic';
      yield `${JSON.stringify({ type: sorte, file: resolve(data.file), message: String(data.message) })}\n`;
    }
  }
}
