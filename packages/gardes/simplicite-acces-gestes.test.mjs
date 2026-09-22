/**
 * Harnais d'audit de #71 (chantier de #38, objectif primaire #58), écrit par la session d'audit.
 *
 * #71 demande trois choses : **I4** (simple par défaut) et **I5** (inciter à tout utiliser) reçoivent
 * un harnais, ou une renonciation assumée par écrit ; le **nombre de gestes d'I6** (catégoriser en
 * peu de clics) est fixé et mesuré. Au 13 septembre 2026, I4 et I5 ne sont tenus que par une
 * vérification manuelle et une ligne « À bâtir » qui renvoie à #38 ; I6 a son harnais de règles,
 * mais aucun chiffre nulle part.
 *
 * Ce que la couverture fait déjà (#59, #66) : elle refuse une entrée sans garde, un test nommé qui
 * n'existe pas ou ne tourne pas, un harnais sans témoin rouge ni dette. Ce qu'elle ne fait pas —
 * une vérification manuelle et une dette lui suffisent, indéfiniment — et que ce fichier garde :
 *
 * 1. **I4 et I5 ne restent pas en dette.** Chacun porte un harnais qui cite son témoin rouge, ou
 *    une renonciation écrite et datée, validée par le porteur (tranché le 12 septembre dans #58 :
 *    « une session ne laisse pas d'elle-même une entrée en vérification manuelle »). L'un ou
 *    l'autre, jamais rien, et jamais une ligne « À bâtir » laissée sous #38 ou #71.
 * 2. **Le nombre de gestes d'I6 est fixé au registre, et mesuré.** Tranché par le porteur le
 *    13 septembre dans #71 : depuis l'écran Opérations, **2 gestes pour catégoriser, 3 avec une
 *    sous-catégorie** ; **un geste de plus pour automatiser** toutes les opérations semblables,
 *    soit 3 et 4 ; et **le harnais mesure à l'objectif plus un geste de marge**, soit 3 et 4 pour
 *    catégoriser, 4 et 5 pour automatiser. L'entrée porte donc les quatre objectifs et la marge ;
 *    un harnais les mesure, ou une renonciation écrite le dit. Un objectif qui ne vit que dans
 *    le fil d'une PR ne se compare à rien au tour suivant.
 * 3. **Les gardes du jour ne disparaissent pas.** Le harnais d'I6 et les trois vérifications
 *    manuelles (`VM-I4-simple`, `VM-I5-acces`, `VM-I6-gestes`) sont figés ici : une dette se règle
 *    en bâtissant, pas en effaçant. Retirer une garde reste possible, mais par la section
 *    « Invariants et contraintes » de l'issue, déclarée, puis validée par le passage en Ready
 *    (`CLAUDE.md`).
 *
 * **Forme d'une renonciation**, lecture retenue sauf avis contraire du porteur (question posée dans
 * #71) : un paragraphe de prose dans l'entrée, qui dit « renonciation », ce qui a été essayé, et
 * porte l'accord du porteur avec sa date ou le numéro de l'issue où il l'a donné. Le registre n'a
 * pas d'étiquette pour cela, et en inventer une serait changer sa grammaire.
 *
 * Ce fichier ne juge pas le contenu des harnais d'I4, I5 et I6 : ce qu'ils doivent traverser est dit
 * par l'issue, et se relit en audit. Il garde ce qui se vérifie sans interpréter.
 *
 * **Reprise du 13 septembre 2026, session de codage.** Trois témoins rouges dérivaient le registre
 * cassé en *défaisant une injection* (ôter la dette d'I4, retirer l'objectif que le témoin venait
 * d'écrire) : une fois le besoin tenu, ils ne cassaient plus rien et passaient au vert à tort. Ils
 * s'en prennent désormais au contenu réel de l'entrée — les lignes `Harnais` d'I4 retirées, les
 * nombres de gestes d'I6 effacés, sa marge effacée — et redeviennent donc rouges quand la garde
 * qu'ils surveillent disparaît. Aucune vérification n'a été retirée ni affaiblie.
 *
 * Les deux premières vérifications sont le « Fait quand » de #71 : elles sont **rouges** tant que le
 * codage n'a pas livré, et c'est la PR de #71 qui doit les faire passer. Elles ne sont pas marquées
 * `todo` : un `todo` rend la suite verte, et rien n'obligerait alors à le retirer avant la fusion
 * (question du porteur, 13 septembre). Un rouge, lui, interdit la fusion (#58) tant que le besoin
 * n'est pas tenu. Chacune a son témoin vert — une version dérivée où le besoin est tenu — et son
 * témoin rouge — une version volontairement cassée, qui doit échouer. Tout se joue sur du texte en mémoire : le vrai registre pour ce qui doit tenir sur le
 * dépôt du jour, des versions dérivées pour ce qui doit tenir en général.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { RACINE, lireRegistre, temoinRouge, testNomme } from './gardes.mjs';

const REGISTRE = 'docs/gardes.md';
const RELIRE = "le harnais d'audit de #71 est à relire";

/** Les entrées que #71 sort de la dette. */
const SANS_HARNAIS = Object.freeze(['I4', 'I5']);

/** Les issues du chantier : une dette laissée sous l'une d'elles est une dette non réglée. */
const CHANTIER = new Set(['38', '71']);

/**
 * Tranché par le porteur le 13 septembre 2026 (#71) : depuis l'écran Opérations, catégoriser demande
 * au plus deux gestes, trois avec une sous-catégorie ; automatiser toutes les opérations semblables
 * en demande un de plus. Ce sont des objectifs vers lesquels tendre ; le harnais qui les mesure
 * s'autorise un geste de marge — soit 3 et 4 pour catégoriser, 4 et 5 pour automatiser.
 */
const OBJECTIF = Object.freeze({
  'catégoriser': 2,
  'catégoriser avec une sous-catégorie': 3,
  'automatiser les semblables': 3,
  'automatiser les semblables avec une sous-catégorie': 4,
});

/** La marge que le porteur accorde au harnais, en gestes, sur chacun des objectifs. */
const MARGE = 1;

const registre = () => {
  try {
    return readFileSync(join(RACINE, REGISTRE), 'utf8');
  } catch {
    return assert.fail(`${REGISTRE} est introuvable : ${RELIRE}`);
  }
};

/** Apostrophes et espaces libres : deux écritures du même nom de test sont le même nom. */
const memeTexte = (t) => String(t ?? '').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();

/** De quoi reconnaître une ligne `Harnais` d'une fois sur l'autre : son entrée, ses fichiers, son test nommé. */
const identite = (id, h) => `${id} · ${h.chemins.join(', ')} · ${memeTexte(testNomme(h.description)) || '—'}`;

/** L'entrée demandée ; une entrée disparue est une erreur de lecture, pas un besoin tenu. */
const entree = (texte, id) =>
  lireRegistre(texte).entrees.get(id) ?? assert.fail(`${id} n'a plus d'entrée au registre : ${RELIRE}`);

/** Le texte brut d'une entrée, de son titre au titre suivant : la prose y compris, que le registre ignore. */
function texteDeLEntree(texte, id) {
  const lignes = texte.split('\n');
  const debut = entree(texte, id).ligne - 1;
  let fin = debut + 1;
  while (fin < lignes.length && !/^#{1,6}\s+[IUC]\d+\s+·/.test(lignes[fin])) fin += 1;
  return lignes.slice(debut, fin).join('\n');
}

/** Les harnais du jour (13 septembre 2026) : I4 et I5 n'en ont aucun, I6 en a un. */
const HARNAIS_DU_JOUR = new Set(['I6 · packages/core/test/automations.test.ts · —']);

/** Les vérifications manuelles du jour : une par entrée. */
const VERIFICATIONS_DU_JOUR = Object.freeze({
  I4: ['VM-I4-simple'],
  I5: ['VM-I5-acces'],
  I6: ['VM-I6-gestes'],
});

/** Un harnais ajouté depuis le 13 septembre, qui cite son témoin rouge — « à bâtir » ne compte pas. */
const porteUnHarnaisNeuf = (e) =>
  e.harnais.some((h) => !HARNAIS_DU_JOUR.has(identite(e.id, h)) && temoinRouge(h.description)?.nom);

/**
 * Une renonciation écrite : un paragraphe qui dit renoncer, avec l'accord du porteur, daté ou
 * rattaché à l'issue où il l'a donné.
 */
const renonciationEcrite = (texte, id) => {
  const t = texteDeLEntree(texte, id);
  return /renonc/i.test(t) && /accord du porteur/i.test(t) && /(\d{4}-\d{2}-\d{2}|\d{1,2}\s+\p{L}+\s+\d{4}|#\d+)/u.test(t);
};

/** Une dette laissée sous une issue du chantier : #71 est censée la régler. */
const detteDuChantier = (e) =>
  e.aBatir.filter((a) => [...a.matchAll(/#(\d+)/g)].some((m) => CHANTIER.has(m[1])));

/** Les nombres de gestes écrits dans une entrée : « 3 gestes », « 1 geste de plus ». */
const nombresDeGestes = (texte, id) => [...texteDeLEntree(texte, id).matchAll(/(\d+)\s*gestes?\b/gi)].map((m) => m[1]);

// ─── Versions dérivées du registre, pour les témoins ──────────────────────────────────────────────

/** Enlève des lignes (numéros à partir de 1) et la suite renfoncée qui les prolonge. */
function retirerLignes(texte, numeros) {
  const lignes = texte.split('\n');
  const restantes = [];
  for (let i = 0; i < lignes.length; i += 1) {
    if (!numeros.has(i + 1)) {
      restantes.push(lignes[i]);
      continue;
    }
    while (i + 1 < lignes.length && /^[ \t]+\S/.test(lignes[i + 1])) i += 1;
  }
  return restantes.join('\n');
}

/** Ôte la dette d'une entrée, sans rien mettre à la place. */
const sansDetteDe = (texte, id) =>
  retirerLignes(texte, new Set(entree(texte, id).aBatir.length ? lignesABatir(texte, id) : []));

/** Ôte à une entrée tout ce qui la garde par un programme : ses lignes `Harnais`, et sa dette. */
const sansGardeProgrammee = (texte, id) =>
  retirerLignes(texte, new Set([...entree(texte, id).harnais.map((h) => h.ligne), ...lignesABatir(texte, id)]));

/** Récrit le texte d'une entrée, et lui seul : le reste du registre ne bouge pas. */
const dansLEntree = (texte, id, transformer) => {
  const bloc = texteDeLEntree(texte, id);
  return texte.replace(bloc, () => transformer(bloc));
};

/** Numéros des lignes « À bâtir » d'une entrée : `lireRegistre` n'en garde que le texte. */
function lignesABatir(texte, id) {
  const lignes = texte.split('\n');
  const debut = entree(texte, id).ligne - 1;
  const numeros = [];
  for (let i = debut + 1; i < lignes.length && !/^#{1,6}\s+[IUC]\d+\s+·/.test(lignes[i]); i += 1) {
    if (/^[-*]\s+\*\*À bâtir\*\*\s*·/.test(lignes[i])) numeros.push(i + 1);
  }
  return numeros;
}

/** La version « besoin tenu » : l'entrée reçoit un harnais inventé qui cite son témoin rouge. */
const avecHarnais = (texte, id, chemin) =>
  sansDetteDe(texte, id).replace(
    new RegExp(`^## ${id} · .*$`, 'm'),
    (ligne) =>
      `${ligne}\n\n- **Harnais** · \`${chemin}\` — « parcours ${id} inventé » : ce que ${id} promet.\n` +
      `  Témoin rouge : « témoin inventé ${id} »`,
  );

/** La version « besoin tenu autrement » : le harnais est refusé, par écrit et avec l'accord du porteur. */
const avecRenonciation = (texte, id) =>
  sansDetteDe(texte, id).replace(
    new RegExp(`^## ${id} · .*$`, 'm'),
    (ligne) =>
      `${ligne}\n\nRenonciation au harnais : mesuré sans navigateur, essayé et abandonné ;` +
      ` la vérification manuelle ci-dessous en tient lieu. Accord du porteur du 2026-09-13 (#71).`,
  );

/** L'objectif du porteur, écrit comme le registre l'attend : les quatre nombres et la marge. */
const OBJECTIF_ECRIT =
  `Objectif (porteur, #71) : au plus 2 gestes pour catégoriser une opération depuis l'écran ` +
  `Opérations, 3 gestes avec une sous-catégorie, et 1 geste de plus pour automatiser toutes les ` +
  `opérations semblables, soit 3 et 4 gestes ; le harnais mesure avec une marge de ${MARGE} geste. `;

/** La version « besoin tenu » pour I6 : l'objectif écrit, et un harnais qui le mesure. */
const avecLesNombres = (texte) =>
  avecHarnais(texte, 'I6', 'apps/web/test/gestes.test.ts').replace(
    /^(- \*\*Vérification manuelle\*\* · `VM-I6-gestes` — )/m,
    `$1${OBJECTIF_ECRIT}`,
  );

// ─── 1. I4 et I5 : un harnais, ou une renonciation écrite ────────────────────────────────────────

function garderOuRenoncer(texte, ids = SANS_HARNAIS) {
  const manquants = [];
  for (const id of ids) {
    const e = entree(texte, id);
    if (!porteUnHarnaisNeuf(e) && !renonciationEcrite(texte, id)) {
      manquants.push(`${id} · ni harnais citant son témoin rouge, ni renonciation écrite avec l'accord du porteur`);
    }
    for (const dette of detteDuChantier(e)) manquants.push(`${id} · dette laissée en place · À bâtir · ${dette}`);
  }
  assert.deepEqual(manquants, [], `des invariants restent sans garde programmée et sans renonciation :\n${manquants.join('\n')}`);
}

test('#71 · I4 et I5 sont gardés par un harnais, ou par une renonciation écrite et datée', () => {
  garderOuRenoncer(registre());
});

test('#71 · témoin vert — I4 gardé par un harnais, I5 par une renonciation, sont acceptés', () => {
  const tenu = avecRenonciation(avecHarnais(registre(), 'I4', 'apps/web/test/navigateur/assistant-simple.test.ts'), 'I5');
  garderOuRenoncer(tenu);
});

test("#71 · témoin rouge — une entrée laissée à sa seule vérification manuelle fait échouer « I4 et I5 sont gardés »", () => {
  const casse = sansGardeProgrammee(registre(), 'I4');
  assert.notEqual(casse, registre(), `aucune garde programmée n'a pu être retirée d'I4 : ${RELIRE}`);
  assert.throws(() => garderOuRenoncer(casse), /restent sans garde programmée et sans renonciation/);
});

// ─── 2. I6 : le nombre de gestes fixé, et mesuré ─────────────────────────────────────────────────

function gestesFixesEtMesures(texte) {
  const manquants = [];
  const t = texteDeLEntree(texte, 'I6');
  const gestes = new Set(nombresDeGestes(texte, 'I6'));
  for (const [cas, n] of Object.entries(OBJECTIF)) {
    if (!gestes.has(String(n))) manquants.push(`I6 · l'objectif de ${n} gestes (${cas}) n'est écrit nulle part dans l'entrée`);
  }
  if (!/marge|tolérance/i.test(t) || !new RegExp(`${MARGE}\\s*gestes?\\b`, 'i').test(t)) {
    manquants.push(`I6 · la marge de ${MARGE} geste accordée au harnais n'est pas écrite`);
  }
  if (!/(automatis|semblables)[^.\n]*?\d+\s*gestes?|\d+\s*gestes?[^.\n]*?(automatis|semblables)/i.test(t)) {
    manquants.push("I6 · aucun nombre de gestes pour automatiser toutes les opérations semblables");
  }
  const e = entree(texte, 'I6');
  if (!porteUnHarnaisNeuf(e) && !renonciationEcrite(texte, 'I6')) {
    manquants.push("I6 · le compte de gestes n'est mesuré par aucun harnais, et aucune renonciation écrite ne le dit");
  }
  for (const dette of detteDuChantier(e)) manquants.push(`I6 · dette laissée en place · À bâtir · ${dette}`);
  assert.deepEqual(manquants, [], `le nombre de gestes d'I6 n'est pas fixé et mesuré :\n${manquants.join('\n')}`);
}

test("#71 · le nombre de gestes d'I6 est fixé au registre et mesuré", () => {
  gestesFixesEtMesures(registre());
});

test("#71 · témoin vert — l'objectif du porteur écrit et un harnais qui le mesure sont acceptés", () => {
  gestesFixesEtMesures(avecLesNombres(registre()));
});

test("#71 · témoin rouge — un objectif de gestes qui n'est écrit nulle part fait échouer « le nombre de gestes est fixé »", () => {
  const casse = dansLEntree(registre(), 'I6', (t) => t.replace(/\d+\s*gestes?/gi, 'peu de gestes'));
  assert.notEqual(casse, registre(), `aucun nombre de gestes n'a pu être effacé : ${RELIRE}`);
  assert.throws(() => gestesFixesEtMesures(casse), /l'objectif de 2 gestes/);
});

test("#71 · témoin rouge — la marge effacée fait échouer « le nombre de gestes est fixé »", () => {
  const casse = dansLEntree(registre(), 'I6', (t) => t.replace(/marge|tolérance/gi, 'mesure'));
  assert.notEqual(casse, registre(), `la marge n'a pas pu être retirée : ${RELIRE}`);
  assert.throws(() => gestesFixesEtMesures(casse), /la marge de 1 geste/);
});

// ─── 3. Les gardes du jour ne disparaissent pas ──────────────────────────────────────────────────

function gardesTenues(texte) {
  const entrees = lireRegistre(texte).entrees;
  const presents = new Set([...entrees.values()].flatMap((e) => e.harnais.map((h) => identite(e.id, h))));
  const perdues = [...HARNAIS_DU_JOUR].filter((i) => !presents.has(i)).map((i) => `harnais disparu · ${i}`);
  for (const [id, attendues] of Object.entries(VERIFICATIONS_DU_JOUR)) {
    const vues = new Set((entrees.get(id)?.verifications ?? []).map((v) => v.id));
    for (const vm of attendues) if (!vues.has(vm)) perdues.push(`vérification manuelle disparue · ${id} · ${vm}`);
  }
  assert.deepEqual(perdues, [], `des gardes d'I4, I5 et I6 ont disparu au lieu d'être complétées :\n${perdues.join('\n')}`);
}

test("#71 · le registre garde le harnais d'I6 et les trois vérifications manuelles d'I4, I5 et I6", () => {
  assert.equal(Object.values(VERIFICATIONS_DU_JOUR).flat().length, 3, RELIRE);
  gardesTenues(registre());
});

test("#71 · témoin rouge — la vérification manuelle d'I4 effacée fait échouer « le registre garde ses gardes »", () => {
  const casse = retirerLignes(registre(), new Set([entree(registre(), 'I4').verifications[0].ligne]));
  assert.notEqual(casse, registre(), `aucune vérification manuelle n'a pu être effacée : ${RELIRE}`);
  assert.throws(() => gardesTenues(casse), /vérification manuelle disparue/);
});

test("#71 · témoin rouge — le harnais d'I6 effacé fait échouer « le registre garde ses gardes »", () => {
  const casse = retirerLignes(registre(), new Set([entree(registre(), 'I6').harnais[0].ligne]));
  assert.notEqual(casse, registre(), `aucune ligne Harnais n'a pu être effacée : ${RELIRE}`);
  assert.throws(() => gardesTenues(casse), /harnais disparu/);
});
