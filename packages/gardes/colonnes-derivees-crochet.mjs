/**
 * Crochet de résolution de la sonde des colonnes dérivées (`colonnes-derivees.mjs`, #314) : les
 * imports internes du cœur s'écrivent en `.js` et visent des `.ts` ; un `.js` relatif introuvable se
 * résout vers son `.ts`.
 */
import { register } from 'node:module';

register(
  `data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (specifier.startsWith('.') && specifier.endsWith('.js')) return next(specifier.slice(0, -3) + '.ts', context);
    throw e;
  }
}`)}`,
);
