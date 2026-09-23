/**
 * Harnais d'audit de #70 (chantier de #38, chantier primaire #58), écrit par la session d'audit.
 *
 * #70 demande que chacun des cinq usages d'I3 — U1 budget seul, U2 budget et virements permanents,
 * U3 budget puis import, U4 budget reconstruit, U5 import seul — ait **son harnais de bout en bout
 * au registre, avec son témoin rouge**. Au 13 septembre 2026, chaque usage n'y est gardé que par des
 * harnais unitaires du cœur, et porte une ligne « À bâtir » qui renvoie à l'issue de son parcours
 * (#15, #13, #40, #16, #39).
 *
 * **Tranché par le porteur le 13 septembre**, sur la question posée dans #70 : #70 ne bâtit que les
 * parcours que le produit tient — U1, U2, U5. Ceux de U3 et U4 partent avec leur besoin (#40, #16),
 * parce qu'une PR ne se fusionne pas au rouge (#58) et qu'un parcours durablement rouge au registre
 * userait la garde. Leur dette reste donc au registre, et ce fichier la tient : elle ne peut pas
 * disparaître sans qu'un parcours la remplace.
 *
 * Ce que la couverture fait déjà (#59, #66) : elle refuse un usage sans garde, un harnais dont le
 * test nommé n'existe pas ou ne tourne pas, un harnais sans témoin rouge ni dette. Ce qu'elle ne
 * fait pas, et que ce fichier garde :
 *
 * 1. **U1, U2 et U5 portent chacun un harnais de plus que leurs harnais unitaires du 13 septembre,
 *    et ce harnais cite son témoin rouge.** La couverture se contente des gardes du jour : un usage
 *    resté à ses seuls tests unitaires lui paraît gardé. C'est le « Fait quand » de #70 : les trois
 *    parcours sont bâtis (`packages/core/test/parcours-u{1,2,5}.test.ts`), et les deux `todo` que
 *    portait ce fichier avant leur construction ont été retirés par la PR qui les a bâtis.
 * 2. **U3 et U4 gardent une dette qui renvoie à leur besoin, tant qu'ils n'ont pas leur parcours.**
 *    Vert dès aujourd'hui, et vert après #40 et #16 : l'un ou l'autre, jamais rien. La couverture,
 *    elle, accepterait qu'une ligne « À bâtir » disparaisse sans rien à sa place.
 * 3. **La dette de U1, U2 et U5 est réglée**, et réglée **en bâtissant, pas en effaçant** : une
 *    dette disparaît aussi si l'on retire la ligne, et un usage paraît gardé de bout en bout si l'on
 *    remplace ses harnais unitaires au lieu d'en ajouter un. Les sept harnais et les six
 *    vérifications manuelles des usages sont figés ici : le registre ne peut plus en perdre un sans
 *    que ce harnais le dise. Retirer une garde reste possible, mais par la section « Invariants et
 *    contraintes » de l'issue, déclarée, puis validée par la fusion du porteur (D82).
 *
 * Ce fichier ne juge pas le contenu des parcours : ce qu'un parcours doit traverser est dit par
 * l'issue de chaque usage, et se relit en audit. Il garde ce qui se vérifie sans interpréter, et
 * laisse au registre le soin de nommer les tests.
 *
 * **Depuis #162**, les usages sont définis dans la description, et leurs gardes vivent dans
 * l'entrée d'I3 du registre, qui les mesure : chaque ligne nomme son usage entre parenthèses
 * (`(U1)`), ou dans le nom de son test. Ce fichier regroupe ces lignes par usage ; ce qu'il vérifie
 * n'a pas changé.
 *
 * Chaque vérification a son témoin rouge ici même : les mêmes assertions rejouées sur une version
 * volontairement cassée — un usage laissé à ses seuls harnais unitaires, une dette effacée sans
 * parcours, un usage remis « À bâtir », une garde effacée — qui doit échouer. Tout se joue sur du
 * texte en mémoire : le vrai registre pour ce qui doit tenir sur le dépôt du jour, des versions
 * dérivées pour ce qui doit tenir en général.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { RACINE, lireRegistre, temoinRouge, testNomme } from './gardes.mjs';

const REGISTRE = 'docs/gardes.md';
const RELIRE = "le harnais d'audit de #70 est à relire";
const USAGES = Object.freeze(['U1', 'U2', 'U3', 'U4', 'U5']);

/** Tranché le 13 septembre : #70 ne bâtit que les parcours que le produit tient. */
const PORTENT_UN_PARCOURS = Object.freeze(['U1', 'U2', 'U5']);

/** Les deux usages dont le produit reste à outiller : leur parcours part avec leur besoin. */
const PARCOURS_AVEC_LE_BESOIN = Object.freeze({ U3: '40', U4: '16' });

/** Les issues du chantier : une dette nouvelle citerait la sienne, et se verrait. */
const CHANTIER = new Set(['13', '15', '38', '39', '70']);

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

/** L'usage d'une ligne de l'entrée d'I3 : le premier identifiant d'usage qu'elle cite. */
const usageDe = (texte) => String(texte ?? '').match(/\b(U[1-9])\b/)?.[1];
const usageDeVerification = (v) => v.id.match(/^VM-I3-(u\d)-/i)?.[1]?.toUpperCase();

/** L'entrée d'I3, qui porte les gardes des usages. */
const entreeI3 = (texte) => lireRegistre(texte).entrees.get('I3') ?? assert.fail(`I3 n'a plus d'entrée au registre : ${RELIRE}`);

/** Les gardes de chaque usage demandé, lues dans l'entrée d'I3 ; un usage sans aucune garde est une erreur de lecture. */
const entreesDesUsages = (texte, ids = USAGES) => {
  const i3 = entreeI3(texte);
  return ids.map((id) => {
    const e = {
      id,
      harnais: i3.harnais.filter((h) => usageDe(h.description) === id),
      verifications: i3.verifications.filter((v) => usageDeVerification(v) === id),
      aBatir: i3.aBatir.filter((a) => usageDe(a) === id),
    };
    if (!e.harnais.length && !e.verifications.length && !e.aBatir.length) assert.fail(`${id} n'a plus de garde dans l'entrée d'I3 : ${RELIRE}`);
    return e;
  });
};

/** Les lignes `Harnais` des usages au jour de l'audit (13 septembre 2026) : sept, unitaires. */
const HARNAIS_DU_JOUR = new Set([
  "U1 · packages/core/test/assistant.test.ts · budget construit par l'assistant (D40)",
  'U2 · packages/core/test/flux-derives-besoin.test.ts · —',
  'U2 · apps/web/test/navigateur/flux-derives-plan.test.ts · —',
  'U3 · packages/core/test/import.test.ts · rapprochement',
  'U4 · packages/core/test/review.test.ts · —',
  'U5 · packages/core/test/import.test.ts · —',
  'U5 · packages/core/test/automations.test.ts · —',
]);

/** Les vérifications manuelles des usages au même jour, I3 comprise : six. */
const VERIFICATIONS_DU_JOUR = Object.freeze({
  I3: ['VM-I3-independance'],
  U1: ['VM-I3-u1-parcours'],
  U2: ['VM-I3-u2-ordres'],
  U3: ['VM-I3-u3-rapprochement'],
  U4: ['VM-I3-u4-reconstruction'],
  U5: ['VM-I3-u5-sans-tirelire'],
});

/** Les harnais qu'une entrée porte en plus de ses harnais unitaires du 13 septembre. */
const ajoutes = (e) => e.harnais.filter((h) => !HARNAIS_DU_JOUR.has(identite(e.id, h)));

/** Un parcours bâti : un harnais ajouté qui cite son témoin rouge — « à bâtir » ne compte pas. */
const porteUnParcours = (e) => ajoutes(e).some((h) => temoinRouge(h.description)?.nom);

// ─── Versions dérivées du registre, pour les témoins rouges ──────────────────────────────────────

/** La version « besoin tenu » : chaque usage reçoit un parcours inventé, témoin rouge cité. */
const avecParcours = (texte) =>
  texte.replace(
    /^## I3 · .*$/m,
    (ligne) =>
      `${ligne}\n\n` +
      USAGES.map(
        (id) =>
          `- **Harnais** · \`packages/core/test/parcours-${id.toLowerCase()}.test.ts\` — ` +
          `« parcours ${id} inventé » : de bout en bout. Témoin rouge : « témoin inventé ${id} »`,
      ).join('\n'),
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
  for (const e of entreesDesUsages(texte)) for (const h of ajoutes(e)) otees.add(h.ligne);
  return retirerLignes(texte, otees);
}

/** La version « besoin tenu » : plus aucune ligne « À bâtir » au registre. */
const sansDette = (texte) => texte.replace(/^- \*\*À bâtir\*\* · .*\n(?:[ \t]+\S.*\n)*/gm, '');

/** La dette d'un seul usage, effacée. */
const sansDetteDe = (texte, id) =>
  texte.replace(new RegExp(`^- \\*\\*À bâtir\\*\\* · \\(${id}\\).*\\n(?:[ \\t]+\\S.*\\n)*`, 'm'), '');

/** La version volontairement cassée : U1 retombe en dette. */
const enDette = (texte) =>
  texte.replace(/^## I3 · .*$/m, (ligne) => `${ligne}\n\n- **À bâtir** · (U1) le parcours complet sans aucune opération (#15).`);

// ─── 1. U1, U2 et U5 portent leur harnais de bout en bout ────────────────────────────────────────

function parcoursDeBoutEnBout(texte, ids = PORTENT_UN_PARCOURS) {
  const manquants = [];
  for (const e of entreesDesUsages(texte, ids)) {
    if (!ajoutes(e).length) {
      manquants.push(`${e.id} · aucun harnais de bout en bout : l'usage en reste à ses ${e.harnais.length} harnais du 13 septembre`);
    } else if (!porteUnParcours(e)) {
      manquants.push(`${e.id} · le harnais de bout en bout ne cite pas de témoin rouge : « à bâtir » ne tient pas le « Fait quand » de #70`);
    }
  }
  assert.deepEqual(manquants, [], `des usages n'ont pas leur harnais de bout en bout au registre :\n${manquants.join('\n')}`);
}

test('#70 · U1, U2 et U5 portent au registre un harnais de bout en bout, avec son témoin rouge', () => {
  parcoursDeBoutEnBout(registre());
});

test('#70 · un registre où chaque usage cite son parcours est accepté', () => {
  parcoursDeBoutEnBout(avecParcours(registre()), USAGES);
});

test('#70 · témoin rouge — un usage laissé à ses seuls harnais unitaires fait échouer « U1, U2 et U5 portent un harnais de bout en bout »', () => {
  const tenu = avecParcours(registre());
  const casse = sansParcours(tenu);
  assert.notEqual(casse, tenu, `aucun parcours n'a pu être retiré : ${RELIRE}`);
  assert.throws(() => parcoursDeBoutEnBout(casse), /n'ont pas leur harnais de bout en bout/);
});

// ─── 2. U3 et U4 : un parcours, ou une dette qui renvoie à leur besoin ───────────────────────────

function detteOuParcours(texte) {
  const orphelins = [];
  for (const [id, issue] of Object.entries(PARCOURS_AVEC_LE_BESOIN)) {
    const [e] = entreesDesUsages(texte, [id]);
    const dette = e.aBatir.some((a) => [...a.matchAll(/#(\d+)/g)].some((m) => m[1] === issue));
    if (!dette && !porteUnParcours(e)) {
      orphelins.push(`${id} · ni harnais de bout en bout, ni « À bâtir » qui renvoie à #${issue}`);
    }
  }
  assert.deepEqual(orphelins, [], `des usages ont perdu leur dette sans recevoir leur parcours :\n${orphelins.join('\n')}`);
}

test('#70 · U3 et U4 gardent une dette qui renvoie à #40 et #16 tant que leur parcours n\'est pas bâti', () => {
  detteOuParcours(registre());
});

test('#70 · un parcours bâti tient lieu de dette : U3 sans « À bâtir » mais avec son parcours est accepté', () => {
  detteOuParcours(sansDetteDe(avecParcours(registre()), 'U3'));
});

test('#70 · témoin rouge — la dette de U3 effacée sans parcours fait échouer « U3 et U4 gardent leur dette »', () => {
  const casse = sansDetteDe(registre(), 'U3');
  assert.notEqual(casse, registre(), `la dette de U3 n'a pas pu être effacée : ${RELIRE}`);
  assert.throws(() => detteOuParcours(casse), /ont perdu leur dette sans recevoir leur parcours/);
});

// ─── 3. La dette de U1, U2 et U5 est réglée, en bâtissant ────────────────────────────────────────

function detteReglee(texte, ids = PORTENT_UN_PARCOURS) {
  const restes = [];
  for (const e of entreesDesUsages(texte, ids)) {
    for (const a of e.aBatir) {
      if ([...a.matchAll(/#(\d+)/g)].some((m) => CHANTIER.has(m[1]))) restes.push(`${e.id} · À bâtir · ${a}`);
    }
  }
  assert.deepEqual(restes, [], `des usages restent « À bâtir » au lieu d'être gardés :\n${restes.join('\n')}`);
}

test('#70 · U1, U2 et U5 ne restent plus « À bâtir » (#15, #13, #39)', () => {
  detteReglee(registre());
});

test('#70 · un registre sans dette sur ces trois usages est accepté', () => {
  detteReglee(sansDette(registre()));
});

test('#70 · témoin rouge — un usage remis « À bâtir » fait échouer « U1, U2 et U5 ne restent plus à bâtir »', () => {
  const casse = enDette(sansDette(registre()));
  assert.notEqual(casse, sansDette(registre()), `aucune ligne « À bâtir » n'a pu être remise : ${RELIRE}`);
  assert.throws(() => detteReglee(casse), /restent « À bâtir »/);
});

function gardesTenues(texte) {
  const i3 = entreeI3(texte);
  const presents = new Set(i3.harnais.map((h) => identite(usageDe(h.description), h)));
  const perdues = [...HARNAIS_DU_JOUR].filter((i) => !presents.has(i)).map((i) => `harnais disparu · ${i}`);
  const vues = new Set(i3.verifications.map((v) => v.id));
  for (const [id, attendues] of Object.entries(VERIFICATIONS_DU_JOUR)) {
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
