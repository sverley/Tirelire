/**
 * L'attestation des tests côté git (#237, #266, #302) : lire les empreintes vertes de la branche,
 * l'arbre du contenu joué, et ajouter à l'attestation locale. Partagé par le lanceur (`lanceur.mjs`),
 * qui atteste chaque fichier de test joué vert à tout lancement hors CI, et par les crochets
 * (`.githooks/attestation.mjs`). Les décisions sont dans `attestation.mjs`.
 *
 * L'attestation locale est un commit sans fichier, sur `refs/attestations/<branche>`, dont le message
 * porte les empreintes vertes ; ce que le dernier crochet a lu de `<branche>--attestation`, sur le
 * dépôt distant, est gardé sur `refs/attestations-distantes/<branche>`. Seul l'outillage l'écrit,
 * hors sous-branche (D83).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fusionner, lireLAttestation, lireLesEntrees, texteDeLAttestation } from './attestation.mjs';

export const REF = (branche) => `refs/attestations/${branche}`;
export const DISTANTE = (branche) => `refs/attestations-distantes/${branche}`;
export const BRANCHE_D_ATTESTATION = (branche) => `${branche}--attestation`;
/** L'outillage signe : l'attestation n'est l'œuvre de personne. */
const IDENTITE = { GIT_AUTHOR_NAME: 'Livraison Tirelire', GIT_AUTHOR_EMAIL: 'livraison@tirelire.invalid' };

/** `git` dans `cwd`, sortie rognée ; lève en cas d'échec. */
export const git = (args, { cwd, ...options } = {}) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, ...options }).trim();

export const essaie = (f) => {
  try {
    return f();
  } catch {
    return null;
  }
};

/** La racine du dépôt git qui contient `cwd`, ou `null` hors de tout dépôt. */
export const racineGit = (cwd) => essaie(() => git(['rev-parse', '--show-toplevel'], { cwd }));

/**
 * La branche dont un lancement dans `cwd` peut lire et écrire l'attestation : `{ branche }`, ou
 * `{ raison }` — aucune branche extraite, `main`, ou une sous-branche (`--codeur`, `--auditeur`, qui
 * n'attestent rien, D83).
 */
export function brancheAttestable(cwd) {
  const branche = essaie(() => git(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd }));
  if (!branche) return { raison: 'aucune branche extraite' };
  if (branche === 'main') return { raison: 'sur main' };
  if (/--(?:codeur|auditeur|attestation)$/.test(branche)) return { raison: `sous-branche ${branche}` };
  return { branche };
}

/** Les empreintes vertes portées par un commit d'attestation, ou `[]`. */
export function vertsDu(commit, cwd) {
  if (!commit) return [];
  return lireLAttestation(essaie(() => git(['log', '-1', '--format=%B', commit], { cwd }))).attestation?.verts ?? [];
}

const refExiste = (ref, cwd) => essaie(() => git(['rev-parse', '-q', '--verify', ref], { cwd }));

/**
 * Les empreintes vertes connues de ce clone pour la branche, sans réseau : l'attestation locale,
 * réunie à ce que le dernier crochet a lu du dépôt distant.
 */
export function vertsConnus(branche, cwd) {
  return fusionner(vertsDu(refExiste(REF(branche), cwd), cwd), vertsDu(refExiste(DISTANTE(branche), cwd), cwd));
}

/**
 * Ajoute des empreintes vertes à l'attestation locale de la branche. Des lancements parallèles
 * (`pnpm test` joue les paquets en même temps) y écrivent chacun : la référence ne se remplace que si
 * elle n'a pas bougé depuis sa lecture, sinon la lecture et la réunion recommencent. `anciens` : des
 * empreintes à garder en plus de celles de l'attestation locale (celle du dépôt distant, par exemple).
 * Rend vrai si l'attestation est écrite.
 */
export function ajouterALAttestation({ branche, nouveaux, anciens = [], cwd }) {
  if (!nouveaux.length) return false;
  const env = { ...process.env, ...IDENTITE, GIT_COMMITTER_NAME: IDENTITE.GIT_AUTHOR_NAME, GIT_COMMITTER_EMAIL: IDENTITE.GIT_AUTHOR_EMAIL };
  const vide = git(['hash-object', '-t', 'tree', '-w', '--stdin'], { cwd, input: '' });
  for (let essai = 0; essai < 8; essai++) {
    const avant = refExiste(REF(branche), cwd);
    const message = texteDeLAttestation({ branche, verts: [...nouveaux, ...vertsDu(avant, cwd), ...anciens] });
    const commit = git(['commit-tree', vide, '-F', '-'], { cwd, input: message, env });
    // L'ancienne valeur attendue : vide si la référence n'existait pas.
    if (essaie(() => (git(['update-ref', REF(branche), commit, avant ?? ''], { cwd }), true))) return true;
  }
  return false;
}

/**
 * L'arbre du contenu joué (#302) : la copie de travail telle qu'elle est, fichiers suivis et fichiers
 * non suivis que `.gitignore` n'écarte pas, modifications et suppressions comprises. Il s'écrit par un
 * index à part, neuf : chaque fichier y est relu, sans se fier à ce que l'index du clone sait de ses
 * dates et de sa taille ; ni l'index ni la branche ne changent. Rend `{ arbre, entrees }`, ou `null`
 * s'il ne se lit pas.
 */
export function arbreDeLaCopie(racine) {
  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-copie-'));
  try {
    const index = join(dossier, 'index');
    const env = { ...process.env, GIT_INDEX_FILE: index };
    git(['add', '-A', '--', ':/'], { cwd: racine, env });
    const arbre = git(['write-tree'], { cwd: racine, env });
    return { arbre, entrees: entreesDe(arbre, racine) };
  } catch {
    return null;
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

/** Les entrées d'un arbre ou d'un commit. */
export const entreesDe = (objet, cwd) => lireLesEntrees(git(['ls-tree', '-r', '-z', '--full-tree', objet], { cwd }));

/** La base commune de HEAD et de `origin/main`, ou `null`. */
export const baseAvecMain = (cwd) => essaie(() => git(['merge-base', 'HEAD', 'refs/remotes/origin/main'], { cwd }));

/** Les fichiers du harnais du besoin, par sa définition commune (`.githooks/harnais-du-besoin.sh`). */
export function harnaisDuBesoin(branche, racine) {
  const script = join(racine, '.githooks/harnais-du-besoin.sh');
  if (!existsSync(script)) return [];
  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-harnais-'));
  const liste = join(dossier, 'liste');
  try {
    execFileSync('sh', ['-c', '. "$1" && harnais_du_besoin "$2" >/dev/null', 'harnais', script, liste], {
      cwd: racine,
      env: { ...process.env, GITHUB_HEAD_REF: branche },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return (essaie(() => readFileSync(liste, 'utf8')) ?? '').split('\n').filter(Boolean);
  } catch {
    return [];
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}
