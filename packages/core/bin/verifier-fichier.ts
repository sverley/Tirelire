/**
 * Vérifie un fichier SQLite comme Tirelire le ferait à son ouverture, pour qui le fabrique hors de
 * l'application (#198, point 5) : même verdict, et chaque problème nommé, pas seulement le premier.
 * Le fichier est lu sur la machine ; rien n'en sort (I7), rien n'y est écrit.
 *
 *   pnpm --dir packages/core run verifier-fichier <fichier.sqlite>
 *
 * Un chemin relatif se lit depuis le dossier d'où la commande est appelée (`INIT_CWD`, que pnpm
 * pose), pas depuis `packages/core` où pnpm la lance.
 *
 * Sortie 0 : le fichier s'ouvre (ce qui s'y complète est dit) ; 1 : il est refusé ; 2 : la commande
 * est mal appelée, ou le fichier ne se lit pas sur le disque.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decrireProbleme, verifierFichier } from '../src/index.js';

const chemin = process.argv[2];
if (!chemin || process.argv.length > 3) {
  console.error('Usage : pnpm --dir packages/core run verifier-fichier <fichier.sqlite>');
  process.exit(2);
}

let octets: Uint8Array;
try {
  octets = new Uint8Array(await readFile(resolve(process.env['INIT_CWD'] ?? process.cwd(), chemin)));
} catch (err) {
  console.error(`Lecture impossible de ${chemin} : ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

const verdict = await verifierFichier(octets);
if (verdict.ouvre) {
  const c = verdict.completion;
  const complete = [
    ...c.tables.map((t) => `table ${t} absente : ouverte vide`),
    ...c.colonnes.map((col) => `colonne ${col} absente : vide`),
    ...(c.horloges.length ? [`${c.horloges.length} ligne(s) sans horloge : datée(s) par l’instance qui ouvre`] : []),
    ...(c.comptePrincipal ? ['compte principal absent : il naît à son défaut'] : []),
  ];
  console.log(`${chemin} : s’ouvre.${complete.length ? ' Complété à l’ouverture :' : ' Rien à compléter.'}`);
  for (const ligne of complete) console.log(`  - ${ligne}`);
  process.exit(0);
}
console.log(`${chemin} : refusé. ${verdict.problemes.length ? `${verdict.problemes.length} problème(s) :` : verdict.message}`);
for (const p of verdict.problemes) console.log(`  - ${decrireProbleme(p)}`);
process.exit(1);
