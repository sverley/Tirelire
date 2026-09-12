/**
 * Harnais d'audit de #70 (chantier de #38, objectif primaire #58), écrit par la session d'audit.
 *
 * #70 demande que chacun des cinq usages d'I3 — U1 budget seul, U2 budget et virements permanents,
 * U3 budget puis import, U4 budget reconstruit, U5 import seul — ait **son harnais de bout en bout
 * au registre, avec son témoin rouge**. Au 13 septembre 2026, chaque usage n'y est gardé que par des
 * harnais unitaires du cœur, et porte une ligne « À bâtir » qui renvoie à l'issue de son parcours
 * (#15, #13, #40, #16, #39).
 *
 * Ce que la couverture fait déjà (#59, #66) : elle refuse un usage sans garde, un harnais dont le
 * test nommé n'existe pas ou ne tourne pas, un harnais sans témoin rouge ni dette. Ce qu'elle ne
 * fait pas, et que ce fichier garde :
 *
 * 1. **Chaque usage a un harnais de plus que ses harnais unitaires du 13 septembre, et ce harnais
 *    cite son témoin rouge.** La couverture se contente des gardes du jour : un usage resté à ses
 *    seuls tests unitaires lui paraît gardé. C'est le « Fait quand » de #70, donc rouge avant le
 *    codage : le test porte `todo` avec l'issue qui le corrige, et **la PR qui bâtit les cinq
 *    parcours le retire**.
 * 2. **La dette « À bâtir » des cinq usages est réglée.** Même raison : la couverture accepte une
 *    dette déclarée. `todo` lui aussi ; si un usage que le produit n'outille pas encore devait
 *    garder la sienne, le `todo` reste et nomme l'usage — la question est posée dans #70.
 * 3. **Elle est réglée en bâtissant, pas en effaçant.** Une dette disparaît aussi si l'on retire la
 *    ligne « À bâtir », et un usage paraît gardé de bout en bout si l'on remplace ses harnais
 *    unitaires au lieu d'en ajouter un. Les sept harnais et les six vérifications manuelles des
 *    usages sont figés ici : le registre ne peut plus en perdre un sans que ce harnais le dise.
 *    Retirer une garde reste possible, mais par la section « Vérifications manuelles » de la PR,
 *    analysée et validée (docs/gardes.md).
 *
 * Ce fichier ne juge pas le contenu des parcours : ce qu'un parcours doit traverser est dit par
 * l'issue de chaque usage, et se relit en audit. Il garde ce qui se vérifie sans interpréter, et
 * laisse au registre le soin de nommer les tests.
 *
 * Chaque vérification a son témoin rouge ici même : les mêmes assertions rejouées sur une version
 * volontairement cassée — un usage laissé à ses seuls harnais unitaires, un usage remis en dette,
 * une garde effacée — qui doit échouer. Tout se joue sur du texte en mémoire : le vrai registre pour
 * ce qui doit tenir sur le dépôt du jour, des versions dérivées pour ce qui doit tenir en général.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { RACINE, lireRegistre, temoinRouge, testNomme } from './gardes.mjs';

const REGISTRE = 'docs/gardes.md';
const RELIRE = "le harnais d'audit de #70 est à relire";
const USAGES = Object.freeze(['U1', 'U2', 'U3', 'U4', 'U5']);

/** Les issues du chantier : une dette nouvelle citerait la sienne, et se verrait. */
const CHANTIER = new Set(['13', '15', '16', '38', '39', '40', '70']);

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

/** Les entrées des cinq usages, dans l'ordre ; une entrée disparue est une erreur de lecture. */
const entreesDesUsages = (texte) => {
  const entrees = lireRegistre(texte).entrees;
  return USAGES.map((id) => entrees.get(id) ?? assert.fail(`${id} n'a plus d'entrée au registre : ${RELIRE}`));
};

/** Les lignes `Harnais` des usages au jour de l'audit (13 septembre 2026) : sept, unitaires. */
const HARNAIS_DU_JOUR = new Set([
  "U1 · packages/core/test/assistant.test.ts · budget construit par l'assistant (D40)",
  'U2 · packages/core/test/flux-derives-besoin.test.ts · —',
  'U2 · apps/web/test/flux-derives-plan.test.ts · —',
  'U3 · packages/core/test/import.test.ts · rapprochement',
  'U4 · packages/core/test/review.test.ts · —',
  'U5 · packages/core/test/import.test.ts · —',
  'U5 · packages/core/test/automations.test.ts · —',
]);

/** Les vérifications manuelles des usages au même jour, I3 comprise : six. */
const VERIFICATIONS_DU_JOUR = Object.freeze({
  I3: ['VM-I3-independance'],
  U1: ['VM-U1-parcours'],
  U2: ['VM-U2-ordres'],
  U3: ['VM-U3-rapprochement'],
  U4: ['VM-U4-reconstruction'],
  U5: ['VM-U5-sans-tirelire'],
});

// ─── 1. Chaque usage a son harnais de bout en bout ───────────────────────────────────────────────

function parcoursDeBoutEnBout(texte) {
  const manquants = [];
  for (const e of entreesDesUsages(texte)) {
    const ajoutes = e.harnais.filter((h) => !HARNAIS_DU_JOUR.has(identite(e.id, h)));
    if (!ajoutes.length) {
      manquants.push(`${e.id} · aucun harnais de bout en bout : l'usage en reste à ses ${e.harnais.length} harnais du 13 septembre`);
    } else if (!ajoutes.some((h) => temoinRouge(h.description)?.nom)) {
      manquants.push(`${e.id} · le harnais de bout en bout ne cite pas de témoin rouge : « à bâtir » ne tient pas le « Fait quand » de #70`);
    }
  }
  assert.deepEqual(manquants, [], `des usages n'ont pas leur harnais de bout en bout au registre :\n${manquants.join('\n')}`);
}

/** La version « besoin tenu » : chaque usage reçoit un parcours inventé, témoin rouge cité. */
const avecParcours = (texte) =>
  texte.replace(
    /^### (U\d) · .*$/gm,
    (ligne, id) =>
      `${ligne}\n\n- **Harnais** · \`packages/core/test/parcours-${id.toLowerCase()}.test.ts\` — ` +
      `« parcours ${id} inventé » : de bout en bout. Témoin rouge : « témoin inventé ${id} »`,
  );

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

/** La version volontairement cassée : les usages retombent à leurs seuls harnais du 13 septembre. */
function sansParcours(texte) {
  const otees = new Set();
  for (const e of entreesDesUsages(texte)) {
    for (const h of e.harnais) if (!HARNAIS_DU_JOUR.has(identite(e.id, h))) otees.add(h.ligne);
  }
  return retirerLignes(texte, otees);
}

test(
  '#70 · chaque usage porte au registre un harnais de bout en bout, avec son témoin rouge',
  { todo: 'rouge tant que les cinq parcours ne sont pas bâtis ; la PR qui les bâtit retire ce todo (#70)' },
  () => {
    parcoursDeBoutEnBout(registre());
  },
);

test('#70 · un registre où chaque usage cite son parcours est accepté', () => {
  parcoursDeBoutEnBout(avecParcours(registre()));
});

test('#70 · témoin rouge — un usage laissé à ses seuls harnais unitaires fait échouer « chaque usage porte un harnais de bout en bout »', () => {
  const tenu = avecParcours(registre());
  const casse = sansParcours(tenu);
  assert.notEqual(casse, tenu, `aucun parcours n'a pu être retiré : ${RELIRE}`);
  assert.throws(() => parcoursDeBoutEnBout(casse), /n'ont pas leur harnais de bout en bout/);
});

// ─── 2. La dette « À bâtir » des cinq usages est réglée ──────────────────────────────────────────

function detteReglee(texte) {
  const restes = [];
  for (const e of entreesDesUsages(texte)) {
    for (const a of e.aBatir) {
      if ([...a.matchAll(/#(\d+)/g)].some((m) => CHANTIER.has(m[1]))) restes.push(`${e.id} · À bâtir · ${a}`);
    }
  }
  assert.deepEqual(restes, [], `des usages restent « À bâtir » au lieu d'être gardés :\n${restes.join('\n')}`);
}

/** La version « besoin tenu » : plus aucune ligne « À bâtir » au registre. */
const sansDette = (texte) => texte.replace(/^- \*\*À bâtir\*\* · .*\n(?:[ \t]+\S.*\n)*/gm, '');

/** La version volontairement cassée : U1 retombe en dette. */
const enDette = (texte) =>
  texte.replace(/^### U1 · .*$/m, (ligne) => `${ligne}\n\n- **À bâtir** · le parcours complet sans aucune opération (#15).`);

test(
  '#70 · plus aucun usage ne reste « À bâtir » (#13, #15, #16, #39, #40)',
  { todo: 'rouge tant que les cinq parcours ne sont pas bâtis ; la PR qui les bâtit retire ce todo (#70)' },
  () => {
    detteReglee(registre());
  },
);

test('#70 · un registre sans dette sur les usages est accepté', () => {
  detteReglee(sansDette(registre()));
});

test('#70 · témoin rouge — un usage remis « À bâtir » fait échouer « plus aucun usage ne reste à bâtir »', () => {
  const casse = enDette(sansDette(registre()));
  assert.notEqual(casse, sansDette(registre()), `aucune ligne « À bâtir » n'a pu être remise : ${RELIRE}`);
  assert.throws(() => detteReglee(casse), /restent « À bâtir »/);
});

// ─── 3. Réglée en bâtissant, pas en effaçant ─────────────────────────────────────────────────────

function gardesTenues(texte) {
  const entrees = lireRegistre(texte).entrees;
  const presents = new Set([...entrees.values()].flatMap((e) => e.harnais.map((h) => identite(e.id, h))));
  const perdues = [...HARNAIS_DU_JOUR].filter((i) => !presents.has(i)).map((i) => `harnais disparu · ${i}`);
  for (const [id, attendues] of Object.entries(VERIFICATIONS_DU_JOUR)) {
    const vues = new Set((entrees.get(id)?.verifications ?? []).map((v) => v.id));
    for (const vm of attendues) if (!vues.has(vm)) perdues.push(`vérification manuelle disparue · ${id} · ${vm}`);
  }
  assert.deepEqual(perdues, [], `des gardes des usages ont disparu au lieu d'être complétées :\n${perdues.join('\n')}`);
}

/** La version volontairement cassée : la première ligne `Harnais` d'un usage, effacée. */
const sansUnHarnais = (texte) => retirerLignes(texte, new Set([entreesDesUsages(texte)[0].harnais[0].ligne]));

/** La version volontairement cassée : la vérification manuelle d'un usage, effacée. */
const sansUneVerification = (texte) => retirerLignes(texte, new Set([entreesDesUsages(texte)[0].verifications[0].ligne]));

test('#70 · le registre garde les sept harnais et les six vérifications manuelles des usages', () => {
  assert.equal(HARNAIS_DU_JOUR.size, 7, RELIRE);
  assert.equal(Object.values(VERIFICATIONS_DU_JOUR).flat().length, 6, RELIRE);
  gardesTenues(registre());
});

test('#70 · témoin rouge — un harnais d\'usage effacé fait échouer « le registre garde ses gardes »', () => {
  const casse = sansUnHarnais(registre());
  assert.notEqual(casse, registre(), `aucune ligne Harnais n'a pu être effacée : ${RELIRE}`);
  assert.throws(() => gardesTenues(casse), /des gardes des usages ont disparu/);
});

test('#70 · témoin rouge — une vérification manuelle d\'usage effacée fait échouer « le registre garde ses gardes »', () => {
  const casse = sansUneVerification(registre());
  assert.notEqual(casse, registre(), `aucune vérification manuelle n'a pu être effacée : ${RELIRE}`);
  assert.throws(() => gardesTenues(casse), /vérification manuelle disparue/);
});
