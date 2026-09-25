/**
 * Lanceur des tests par seuil (#232, D83) : le script `test` de chaque paquet passe par lui.
 *
 *   node lanceur.mjs vitest run [N] [arguments de vitest…]
 *   node lanceur.mjs node --import ./sans-sortie.mjs --test [N] [arguments de node --test…]
 *
 * N, facultatif, est le seuil : seuls les tests de niveau inférieur ou égal se jouent (2 sans
 * entrée ; 4 joue tout). Il vient en premier après la commande du paquet, pour que `pnpm test N`
 * et `pnpm --dir <paquet> run test N …` le lui passent. Ce qui est écarté se compte et se dit sur
 * une ligne, après le verdict de l'exécuteur, dont le code de sortie est rendu tel quel.
 *
 * Un test appelé nommément (`-t` de vitest, `--test-name-pattern` de node) se joue quel que soit son
 * niveau : le seuil ne s'applique pas.
 *
 * - vitest : le seuil devient un filtre de nom complet (`-t`), et un rapporteur de plus compte les
 *   tests écartés (`niveaux-vitest-rapport.mjs`).
 * - node --test : un préchargement (`niveaux-node.mjs`) substitue à `node:test` une enveloppe qui
 *   n'inscrit pas les tests au-dessus du seuil et les compte.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NIVEAU_MAX, ligneEcartes, lireSeuil, motifDuSeuil } from './niveaux.mjs';

const ici = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const vitest = argv[0] === 'vitest';
const fin = vitest ? argv.indexOf('run') : argv[0] === 'node' ? argv.indexOf('--test') : -1;
if (fin < 0) {
  console.error('lanceur : usage « lanceur.mjs vitest run [N] … » ou « lanceur.mjs node … --test [N] … ».');
  process.exit(2);
}
const { seuil, reste } = lireSeuil(argv.slice(fin + 1));
const nomme = reste.some((a) => (vitest ? /^(?:-t|--testNamePattern|--test-name-pattern)(?:=|$)/ : /^--test-name-pattern(?:=|$)/).test(a));
const filtre = !nomme && seuil < NIVEAU_MAX;

const travail = mkdtempSync(join(tmpdir(), 'tirelire-seuil-'));
const compte = join(travail, 'ecartes');
const env = { ...process.env, TIRELIRE_ECARTES: compte };
delete env.TIRELIRE_SEUIL;
if (filtre) env.TIRELIRE_SEUIL = String(seuil);

/** Exécutable de vitest : celui du paquet ou d'un dossier parent, sinon celui du PATH. */
function binaireVitest() {
  for (let d = process.cwd(); ; d = dirname(d)) {
    const b = join(d, 'node_modules', '.bin', 'vitest');
    if (existsSync(b)) return b;
    if (dirname(d) === d) return 'vitest';
  }
}

let commande;
let args;
if (vitest) {
  commande = binaireVitest();
  args = [...argv.slice(1, fin + 1), ...reste];
  if (filtre) {
    if (!reste.some((a) => /^--reporter(?:=|$)/.test(a))) args.push('--reporter=default');
    args.push(`--reporter=${resolve(ici, 'niveaux-vitest-rapport.mjs')}`, '-t', motifDuSeuil(seuil));
  }
} else {
  commande = process.execPath;
  args = [...(filtre ? ['--import', resolve(ici, 'niveaux-node.mjs')] : []), ...argv.slice(1, fin + 1), ...reste];
}

const enfant = spawn(commande, args, { stdio: 'inherit', env });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => enfant.kill(s));
enfant.on('error', (e) => {
  console.error(`lanceur : ${commande} ne se lance pas (${e.message}).`);
  rmSync(travail, { recursive: true, force: true });
  process.exit(1);
});
enfant.on('exit', (code, signal) => {
  let ecartes = 0;
  try {
    ecartes = readFileSync(compte, 'utf8').split('\n').filter(Boolean).reduce((s, l) => s + Number(l), 0);
  } catch {
    // aucun test écarté n'a été noté
  }
  rmSync(travail, { recursive: true, force: true });
  console.log(ligneEcartes(seuil, ecartes, nomme));
  process.exit(signal ? 1 : (code ?? 1));
});
