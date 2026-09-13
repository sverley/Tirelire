/**
 * Copie du dépôt pour les harnais d'audit de #59 (PR #63).
 *
 * Une copie par fichier de tests, modifiée puis rétablie à chaque cas, pour que les tests du paquet
 * restent assez rapides pour le crochet de pré-commit. La couverture se lit de deux façons : par la
 * CLI, comme la CI, ou par `verifierCouverture`, qu'utilisent la CLI et la vérification des PR,
 * rechargée à chaque appel pour qu'aucun cache ne resserve un résultat d'avant la modification.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RELIRE = "le harnais d'audit de #59 est à relire";

// Rien du crochet git ni de la CI n'atteint la garde : un GIT_DIR hérité lui ferait lire le vrai dépôt.
for (const cle of Object.keys(process.env)) if (/^GIT_/.test(cle)) delete process.env[cle];
const ENV = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !/^GITHUB_/.test(cle) && cle !== 'NODE_TEST_CONTEXT'));

const IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', '.gradle']);

/** Copie de l'arbre de travail (fichiers suivis et nouveaux), effacée à la fin du fichier de tests. */
export function copieDuDepot() {
  const racine = mkdtempSync(join(tmpdir(), 'tirelire-audit-59-'));
  after(() => rmSync(racine, { recursive: true, force: true }));
  let fichiers = null;
  try {
    fichiers = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: DEPOT, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    }).split('\0').filter(Boolean);
  } catch {
    // pas un dépôt git : copie faite par un autre harnais
  }
  if (!fichiers) {
    cpSync(DEPOT, racine, { recursive: true, filter: (source) => !source.slice(DEPOT.length).split(sep).some((p) => IGNORES.has(p)) });
    return racine;
  }
  for (const fichier of fichiers) {
    try {
      mkdirSync(dirname(join(racine, fichier)), { recursive: true });
      cpSync(join(DEPOT, fichier), join(racine, fichier));
    } catch {
      // suivi par git mais retiré de l'arbre de travail
    }
  }
  return racine;
}

export const lire = (racine, fichier) => readFileSync(join(racine, fichier), 'utf8');
export const lignesDe = (texte) => texte.replace(/\r\n?/g, '\n').split('\n');

/** Applique `transformer` à un fichier de la copie le temps de `mesurer`, puis le rétablit. */
export async function modifie(racine, fichier, transformer, mesurer) {
  const avant = lire(racine, fichier);
  const apres = transformer(avant);
  if (apres === avant) throw new Error(`rien n'a changé dans ${fichier} : ${RELIRE}`);
  writeFileSync(join(racine, fichier), apres);
  try {
    return await mesurer();
  } finally {
    writeFileSync(join(racine, fichier), avant);
  }
}

/** La couverture comme la lance la CI : code de sortie et messages. */
export function couvertureCli(racine) {
  const r = spawnSync(process.execPath, ['packages/gardes/cli.mjs', 'couverture'], { cwd: racine, env: ENV, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}

let chargements = 0;
/** Problèmes de couverture de la copie, garde rechargée. */
export async function problemes(racine) {
  const garde = await import(`${pathToFileURL(join(DEPOT, 'packages/gardes/gardes.mjs')).href}?audit-59=${++chargements}`);
  return garde.verifierCouverture(racine).problemes;
}
