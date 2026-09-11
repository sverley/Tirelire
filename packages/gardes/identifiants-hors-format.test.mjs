/**
 * Harnais d'audit de #59, écrit par la session d'audit de la PR #63.
 *
 * #59 veut une couverture qui « échoue dès qu'une entrée n'a ni harnais ni vérification manuelle,
 * y compris une entrée qu'on vient d'ajouter ». Le harnais d'amorçage le montre pour un ajout écrit
 * exactement comme les entrées existantes (`## I99 · …`). Celui-ci essaie les formes voisines qu'un
 * rédacteur emploie sans y penser : un autre séparateur que le point médian, un titre d'un autre
 * niveau, un usage dont seul l'identifiant est en gras.
 *
 * Un identifiant qui ouvre un titre, ou le gras d'un élément de liste, définit un invariant, un usage
 * ou une contrainte. La garde peut reconnaître la forme ou la refuser : les deux répondent au besoin,
 * pourvu qu'elle échoue en nommant l'identifiant. Passer en silence laisserait une entrée sans garde.
 *
 * Boîte noire, comme l'amorçage : le dépôt est copié dans un dossier temporaire, un document y est
 * modifié, puis `node packages/gardes/cli.mjs couverture` est lancé. Seuls comptent le code de sortie
 * et le message. Les points d'insertion se cherchent dans les documents du jour ; s'ils manquent, le
 * harnais le dit au lieu de passer.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = 'packages/gardes/cli.mjs';
const INVARIANTS = 'docs/invariants.md';
const CONTRAINTES = 'docs/contraintes.md';
const RELIRE = "le harnais d'audit de #59 est à relire";
const MOT = "ajouté par l'audit de #59";

/** Rien du crochet git ni de la CI n'atteint la garde lancée : un GIT_DIR hérité lui ferait lire le vrai dépôt. */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([cle]) => !/^(GITHUB_|GIT_)/.test(cle) && cle !== 'NODE_TEST_CONTEXT'),
);

const temporaires = [];
after(() => {
  for (const dossier of temporaires) rmSync(dossier, { recursive: true, force: true });
});

// ─── Dépôt copié et garde lancée ─────────────────────────────────────────────────────────────

const IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', '.gradle']);

/**
 * Copie de l'arbre de travail : fichiers suivis et nouveaux, sans les ignorés. Hors dépôt git, quand
 * un autre harnais lance les tests du paquet dans sa propre copie, tout sauf les dossiers ignorés.
 */
function copierDepot() {
  const racine = mkdtempSync(join(tmpdir(), 'tirelire-audit-59-'));
  temporaires.push(racine);
  let fichiers = null;
  try {
    fichiers = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: DEPOT, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    }).split('\0').filter(Boolean);
  } catch {
    // pas un dépôt git
  }
  if (!fichiers) {
    cpSync(DEPOT, racine, {
      recursive: true,
      filter: (source) => !source.slice(DEPOT.length).split(sep).some((partie) => IGNORES.has(partie)),
    });
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

const lire = (racine, fichier) => readFileSync(join(racine, fichier), 'utf8');
const ecrire = (racine, fichier, texte) => writeFileSync(join(racine, fichier), texte);

function couverture(racine) {
  const r = spawnSync(process.execPath, [CLI, 'couverture'], { cwd: racine, env: ENV, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}

function rougeEtNomme(r, id, forme) {
  assert.notEqual(
    r.code,
    0,
    `la couverture passe alors que ${id} a été ajouté sans entrée (${forme}) : la garde ne voit pas cette forme, ni pour la reconnaître ni pour la refuser.`,
  );
  assert.match(r.sortie, new RegExp(`\\b${id}\\b`), `la couverture échoue sans nommer ${id} :\n${r.sortie.slice(-2000)}`);
}

// ─── Ajouts dans les documents du jour ───────────────────────────────────────────────────────

const lignesDe = (texte) => texte.replace(/\r\n?/g, '\n').split('\n');
const CORPS = ["Ajouté par le harnais d'audit de #59, sans entrée au registre.", ''];

/** Nouveau titre : avant « ## Historique » s'il existe, sinon à la fin du document. */
function ajouterTitre(texte, titre) {
  const l = lignesDe(texte);
  const i = l.findIndex((x) => /^##\s+Historique\b/.test(x));
  if (i < 0) return `${texte.trimEnd()}\n\n${[titre, '', ...CORPS].join('\n')}`;
  l.splice(i, 0, titre, '', ...CORPS);
  return l.join('\n');
}

/** Nouvel usage en élément de liste, juste avant le dernier usage existant. */
function ajouterUsage(texte, element) {
  const l = lignesDe(texte);
  const usages = l.flatMap((x, i) => (/^\s*[-*]\s+\*\*U\d+/.test(x) ? [i] : []));
  assert.ok(usages.length, `aucun usage en élément de liste dans ${INVARIANTS} : ${RELIRE}`);
  l.splice(usages.at(-1), 0, element);
  return l.join('\n');
}

/** Nouvel usage en titre, entre la liste des usages d'I3 et le titre qui suit. */
function ajouterUsageEnTitre(texte, titre) {
  const l = lignesDe(texte);
  const i3 = l.findIndex((x) => /^##\s+I3\b/.test(x));
  const suivant = l.findIndex((x, i) => i > i3 && /^##\s/.test(x));
  assert.ok(i3 >= 0 && suivant > i3, `I3 ou le titre qui le suit est introuvable dans ${INVARIANTS} : ${RELIRE}`);
  l.splice(suivant, 0, titre, '', ...CORPS);
  return l.join('\n');
}

// ─── Cas ─────────────────────────────────────────────────────────────────────────────────────

test('#59 · témoin : le dépôt copié tient sa garde, sinon aucun cas ci-dessous ne prouve rien', () => {
  const r = couverture(copierDepot());
  assert.equal(r.code, 0, `la couverture échoue déjà sur le dépôt copié :\n${r.sortie.slice(-2000)}`);
});

test('#59 · contrôle : un invariant ajouté sous la forme des entrées existantes (« ## I99 · ») fait échouer', () => {
  const racine = copierDepot();
  ecrire(racine, INVARIANTS, ajouterTitre(lire(racine, INVARIANTS), `## I99 · Invariant ${MOT}`));
  rougeEtNomme(couverture(racine), 'I99', 'forme des entrées existantes');
});

const FORMES_VOISINES = [
  ['I99', 'un invariant en « ## I99 — »', INVARIANTS, (t) => ajouterTitre(t, `## I99 — Invariant ${MOT}`)],
  ['I99', 'un invariant en « ## I99 – »', INVARIANTS, (t) => ajouterTitre(t, `## I99 – Invariant ${MOT}`)],
  ['I99', 'un invariant en « ## I99 : »', INVARIANTS, (t) => ajouterTitre(t, `## I99 : Invariant ${MOT}`)],
  ['I99', 'un invariant en « ## I99. »', INVARIANTS, (t) => ajouterTitre(t, `## I99. Invariant ${MOT}`)],
  ['I99', 'un invariant en « ### I99 · »', INVARIANTS, (t) => ajouterTitre(t, `### I99 · Invariant ${MOT}`)],
  ['U99', 'un usage en « - **U99 — ….** »', INVARIANTS, (t) => ajouterUsage(t, `- **U99 — Usage ${MOT}.** Sans entrée au registre.`)],
  ['U99', 'un usage en « - **U99** · … »', INVARIANTS, (t) => ajouterUsage(t, `- **U99** · Usage ${MOT}. Sans entrée au registre.`)],
  ['U99', 'un usage en « ### U99 · »', INVARIANTS, (t) => ajouterUsageEnTitre(t, `### U99 · Usage ${MOT}`)],
  ['C99', 'une contrainte en « ## C99 — »', CONTRAINTES, (t) => ajouterTitre(t, `## C99 — Contrainte ${MOT}`)],
];

for (const [id, forme, fichier, ajouter] of FORMES_VOISINES) {
  test(`#59 · ${forme}, ajouté sans entrée, fait échouer la couverture en le nommant`, () => {
    const racine = copierDepot();
    const avant = lire(racine, fichier);
    const apres = ajouter(avant);
    assert.notEqual(apres, avant, `rien n'a été ajouté à ${fichier} : ${RELIRE}`);
    ecrire(racine, fichier, apres);
    rougeEtNomme(couverture(racine), id, forme);
  });
}
