/** Résout `./x.js` vers `./x.ts` : la commande `verifier-fichier` lit le cœur dans ses sources TypeScript. */
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (err) {
    if (specifier.startsWith('.') && specifier.endsWith('.js')) return next(specifier.slice(0, -3) + '.ts', context);
    throw err;
  }
}`));
