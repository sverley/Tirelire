/** Crochet de résolution (#232) : `node:test` devient son enveloppe par niveaux, sauf pour elle. */
const ENVELOPPE = new URL('./niveaux-node-enveloppe.mjs', import.meta.url).href;

export async function resolve(specifier, context, suivant) {
  if (specifier === 'node:test' && context.parentURL !== ENVELOPPE) return { url: ENVELOPPE, shortCircuit: true };
  return suivant(specifier, context);
}
