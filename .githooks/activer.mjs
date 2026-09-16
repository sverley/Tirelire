// Active les crochets suivis de `.githooks/` (#120, D73). Se lance par `pnpm crochets`, une fois
// par clone : git ne les active jamais de lui-même, et `pnpm install` n'y touche pas.
// Les crochets joués sont alors ceux de la branche extraite, dans chaque worktree.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

git('config', 'core.hooksPath', '.githooks');
// Une fusion en avance rapide ne joue aucun crochet : chaque fusion crée son commit.
git('config', 'merge.ff', 'false');

// Les crochets que simple-git-hooks écrivait dans .git/hooks ne sont plus joués ; ils sont retirés
// pour ne pas laisser croire le contraire. Un crochet d'une autre origine est seulement signalé.
const dossier = resolve(git('rev-parse', '--git-common-dir'), 'hooks');
for (const nom of existsSync(dossier) ? readdirSync(dossier) : []) {
  if (nom.endsWith('.sample')) continue;
  const chemin = join(dossier, nom);
  let texte = '';
  try {
    texte = readFileSync(chemin, 'utf8');
  } catch {
    continue;
  }
  if (/simple-git-hooks|SIMPLE_GIT_HOOKS/i.test(texte)) {
    rmSync(chemin);
    console.log(`crochets : ancien crochet simple-git-hooks retiré (${nom})`);
  } else {
    console.log(`crochets : ${chemin} n'est plus joué (core.hooksPath vaut .githooks)`);
  }
}
console.log('crochets : .githooks actif (pré-commit < 5 s, pré-push : typecheck et build) ; merge.ff = false');
