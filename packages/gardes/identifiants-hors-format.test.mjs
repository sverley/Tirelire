/**
 * Harnais d'audit de #59, écrit par la session d'audit de la PR #63.
 *
 * #59 veut une couverture qui « échoue dès qu'une entrée n'a ni harnais ni vérification manuelle,
 * y compris une entrée qu'on vient d'ajouter ». Le harnais d'amorçage le montre pour un ajout écrit
 * exactement comme les entrées existantes (`## I99 · …`). Celui-ci essaie les formes voisines qu'un
 * rédacteur emploie sans y penser : un autre séparateur que le point médian, un titre d'un autre
 * niveau, un usage dont seul l'identifiant est en gras, un usage en liste numérotée, en gras souligné
 * ou en gras italique : GitHub affiche ces trois derniers comme un usage.
 *
 * Un identifiant qui ouvre un titre, ou l'emphase d'un élément de liste, définit un invariant, un
 * usage ou une contrainte. La garde peut reconnaître la forme ou la refuser : les deux répondent au
 * besoin, pourvu qu'elle échoue en nommant l'identifiant. Passer en silence laisserait une entrée
 * sans garde.
 *
 * Le dépôt est copié une fois ; chaque cas y modifie un document, lit la couverture, puis le
 * rétablit. Le témoin et le contrôle passent par `node packages/gardes/cli.mjs couverture`, comme la
 * CI ; les formes voisines appellent `verifierCouverture`, qu'utilisent la CLI et la vérification des
 * PR, pour rester assez rapides pour le crochet de pré-commit. Les points d'insertion se cherchent dans
 * les documents du jour ; s'ils manquent, le harnais le dit au lieu de passer.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RELIRE, copieDuDepot, couvertureCli, lignesDe, modifie, problemes } from './test/copie-du-depot.mjs';

const INVARIANTS = 'docs/invariants.md';
const CONTRAINTES = 'docs/contraintes.md';
const MOT = "ajouté par l'audit de #59";
const CORPS = ["Ajouté par le harnais d'audit de #59, sans entrée au registre.", ''];
const RACINE = copieDuDepot();

function rougeEtNomme(liste, id, forme) {
  assert.ok(liste.length, `la couverture passe alors que ${id} a été ajouté sans entrée (${forme}) : la garde ne voit pas cette forme, ni pour la reconnaître ni pour la refuser.`);
  assert.ok(liste.some((p) => new RegExp(`\\b${id}\\b`).test(p)), `la couverture échoue sans nommer ${id} :\n${liste.join('\n').slice(-2000)}`);
}

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

test('#59 · témoin : le dépôt copié tient sa garde, sinon aucun cas ci-dessous ne prouve rien', () => {
  const r = couvertureCli(RACINE);
  assert.equal(r.code, 0, `la couverture échoue déjà sur le dépôt copié :\n${r.sortie.slice(-2000)}`);
});

test('#59 · contrôle : un invariant ajouté sous la forme des entrées existantes (« ## I99 · ») fait échouer', async () => {
  await modifie(RACINE, INVARIANTS, (t) => ajouterTitre(t, `## I99 · Invariant ${MOT}`), () => {
    const r = couvertureCli(RACINE);
    assert.notEqual(r.code, 0, 'la couverture passe alors que I99 a été ajouté sans entrée, sous la forme des entrées existantes.');
    assert.match(r.sortie, /\bI99\b/, `la couverture échoue sans nommer I99 :\n${r.sortie.slice(-2000)}`);
  });
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
  ['U99', 'un usage en liste numérotée « 1. **U99 · ….** »', INVARIANTS, (t) => ajouterUsage(t, `1. **U99 · Usage ${MOT}.** Sans entrée au registre.`)],
  ['U99', 'un usage en gras souligné « - __U99 · ….__ »', INVARIANTS, (t) => ajouterUsage(t, `- __U99 · Usage ${MOT}.__ Sans entrée au registre.`)],
  ['U99', 'un usage en gras italique « - ***U99 · ….*** »', INVARIANTS, (t) => ajouterUsage(t, `- ***U99 · Usage ${MOT}.*** Sans entrée au registre.`)],
  ['C99', 'une contrainte en « ## C99 — »', CONTRAINTES, (t) => ajouterTitre(t, `## C99 — Contrainte ${MOT}`)],
];

for (const [id, forme, fichier, ajouter] of FORMES_VOISINES) {
  test(`#59 · ${forme}, ajouté sans entrée, fait échouer la couverture en le nommant`, async () => {
    await modifie(RACINE, fichier, ajouter, async () => rougeEtNomme(await problemes(RACINE), id, forme));
  });
}
