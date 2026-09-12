/**
 * Harnais d'audit de #69 (chantier de #38, objectif primaire #58), écrit par la session d'audit.
 *
 * #66 a rendu le témoin rouge obligatoire et laissé une dette : les 22 lignes `Harnais` déjà au
 * registre portent « Témoin rouge : à bâtir (#38) ». #69 la règle — chacune reçoit son témoin.
 *
 * Ce que la couverture fait déjà (#66) : elle refuse un harnais sans témoin ni dette, et un témoin
 * cité qui n'existe pas ou ne tourne pas. Ce qu'elle ne fait pas, et que ce fichier garde :
 *
 * 1. **La dette est réglée** — plus aucune ligne `Harnais` ne porte « à bâtir » pour #38 ni #69 ;
 *    la couverture, elle, accepte la dette. C'est le « Fait quand » de #69, et le seul test de ce
 *    fichier qui soit rouge avant le codage : il porte donc `todo` avec l'issue qui le corrige,
 *    comme le veut #66. **La PR qui bâtit les 22 témoins retire ce `todo`.**
 * 2. **Elle est réglée en bâtissant, pas en effaçant** — une dette disparaît aussi si la ligne
 *    `Harnais` disparaît. Le compte des harnais par entrée est figé ici : le registre ne peut plus
 *    en perdre un sans que ce harnais le dise. Retirer un harnais reste possible, mais par la
 *    section « Vérifications manuelles » de la PR, analysée et validée (docs/gardes.md).
 * 3. **Un témoin cité sait échouer** — un témoin écrit comme un test ordinaire passerait, et la
 *    couverture n'y verrait rien : le registre compterait une garde qui ne mord pas, le risque même
 *    que #66 nomme. L'échec attendu se tient dans l'outil de test (`test.fails` avec vitest). La
 *    vérification ne porte que sur les fichiers joués par vitest ; dans un fichier `node:test`, qui
 *    n'a pas de `.fails`, l'échec attendu tient dans une assertion, que seule la relecture de
 *    l'audit confirme (CLAUDE.md).
 *
 * Chaque vérification a son témoin rouge ici même : les mêmes assertions rejouées sur une version
 * volontairement cassée — un registre en dette, un harnais effacé, un témoin écrit comme un test
 * ordinaire — qui doit échouer. Tout se joue sur du texte en mémoire : le vrai registre pour ce qui
 * doit tenir sur le dépôt du jour, des documents inventés pour ce qui doit tenir en général.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { RACINE, lireRegistre, temoinRouge } from './gardes.mjs';

const REGISTRE = 'docs/gardes.md';
const RELIRE = "le harnais d'audit de #69 est à relire";

/** Contenu d'un fichier du dépôt, `null` s'il n'existe pas (un chemin cité peut être un .yml, un .sh). */
const lire = (chemin) => {
  try {
    return readFileSync(join(RACINE, chemin), 'utf8');
  } catch {
    return null;
  }
};

const registre = () => lire(REGISTRE) ?? assert.fail(`${REGISTRE} est introuvable : ${RELIRE}`);

/** Les lignes `Harnais` du registre, à plat, chacune avec son entrée et son témoin rouge. */
const harnais = (texte) =>
  [...lireRegistre(texte).entrees.values()].flatMap((e) =>
    e.harnais.map((h) => ({ entree: e.id, chemins: h.chemins, ligne: h.ligne, rouge: temoinRouge(h.description) })),
  );

// ─── 1. La dette de #38 est réglée ───────────────────────────────────────────────────────────────

/** Les deux numéros du chantier : une dette nouvelle citerait sa propre issue, et se verrait. */
const CHANTIER = new Set(['38', '69']);

function aucuneDette(texte) {
  const restes = harnais(texte)
    .filter((h) => CHANTIER.has(h.rouge?.aBatir))
    .map((h) => `${REGISTRE}:${h.ligne} · ${h.entree} — \`${h.chemins.join(', ')}\``);
  assert.deepEqual(restes, [], `${restes.length} harnais restent en dette de témoin rouge (#38, #69) :\n${restes.join('\n')}`);
}

/** La version « besoin tenu » : chaque dette du chantier remplacée par un témoin cité. */
const reglee = (texte) => texte.replace(/Témoin rouge : à bâtir \(#(?:38|69)\)/g, 'Témoin rouge : « un témoin inventé »');

/**
 * La version volontairement cassée : le premier harnais retombe en dette. La citation se cherche à
 * partir de sa ligne, parce qu'elle se poursuit parfois dans la suite renfoncée — et que le mode
 * d'emploi du registre, plus haut, en montre une qui n'appartient à aucune entrée.
 */
function enDette(texte) {
  const lignes = texte.split('\n');
  const premier = harnais(texte)[0] ?? assert.fail(`aucun harnais au registre : ${RELIRE}`);
  for (let i = premier.ligne - 1; i < lignes.length; i += 1) {
    const remplacee = lignes[i].replace(/(Témoin rouge : )(?:«[^»]*»|à bâtir \(#\d+\))/, '$1à bâtir (#38)');
    if (remplacee !== lignes[i]) {
      lignes[i] = remplacee;
      return lignes.join('\n');
    }
  }
  return texte;
}

test(
  '#69 · plus aucun harnais du registre ne porte « Témoin rouge : à bâtir »',
  { todo: 'rouge tant que les 22 témoins ne sont pas bâtis ; la PR qui les bâtit retire ce todo (#69)' },
  () => {
    aucuneDette(registre());
  },
);

test('#69 · témoin rouge — un harnais laissé « à bâtir » fait échouer « plus aucun harnais en dette »', () => {
  const casse = enDette(reglee(registre()));
  assert.notEqual(casse, reglee(registre()), `aucune ligne Harnais n'a pu être remise en dette : ${RELIRE}`);
  assert.throws(() => aucuneDette(casse), /restent en dette de témoin rouge/);
});

test('#69 · un registre dont chaque harnais cite son témoin ne porte plus aucune dette', () => {
  aucuneDette(reglee(registre()));
});

// ─── 2. Réglée en bâtissant, pas en effaçant ─────────────────────────────────────────────────────

/** Les harnais du registre au jour de l'audit (12 septembre 2026) : 22 lignes, entrée par entrée. */
const HARNAIS_ATTENDUS = Object.freeze({
  I2: 1, U1: 1, U2: 2, U3: 1, U4: 1, U5: 2, I6: 1, I8: 3, I9: 1, I10: 1, C3: 1, C5: 1, C8: 2, C9: 4,
});

function registreComplet(texte) {
  const compte = {};
  for (const h of harnais(texte)) compte[h.entree] = (compte[h.entree] ?? 0) + 1;
  const perdus = Object.entries(HARNAIS_ATTENDUS)
    .filter(([id, n]) => (compte[id] ?? 0) < n)
    .map(([id, n]) => `${id} : ${compte[id] ?? 0} harnais au lieu de ${n}`);
  assert.deepEqual(
    perdus,
    [],
    `des harnais ont disparu du registre au lieu de recevoir leur témoin rouge :\n${perdus.join('\n')}`,
  );
}

/** La version volontairement cassée : la première ligne `Harnais` et sa suite renfoncée effacées. */
const sansUnHarnais = (texte) => texte.replace(/^- \*\*Harnais\*\* · .*\n(?:[ \t]+\S.*\n)*/m, '');

test('#69 · le registre garde ses 22 harnais : aucune entrée n\'a perdu le sien', () => {
  assert.equal(Object.values(HARNAIS_ATTENDUS).reduce((a, b) => a + b, 0), 22, RELIRE);
  registreComplet(registre());
});

test('#69 · témoin rouge — un harnais effacé du registre fait échouer « le registre garde ses 22 harnais »', () => {
  const casse = sansUnHarnais(registre());
  assert.notEqual(casse, registre(), `aucune ligne Harnais n'a pu être effacée : ${RELIRE}`);
  assert.throws(() => registreComplet(casse), /des harnais ont disparu du registre/);
});

// ─── 3. Un témoin cité sait échouer ──────────────────────────────────────────────────────────────

/** Joué par vitest, donc `test.fails` disponible ; un `.mjs` relève de `node:test`. */
const estVitest = (chemin) => /\.test\.[jt]s$/.test(chemin);

/** Le titre tel qu'il est écrit dans la source : espaces libres, caractères spéciaux échappés. */
const motifDuTitre = (nom) =>
  nom
    .split(/\s+/)
    .map((mot) => mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');

/** L'appel qui déclare ce titre, avec ses modificateurs (`.fails`, `.skip`…) ; `null` s'il n'y est pas. */
function declaration(source, nom) {
  // Les apostrophes échappées d'une chaîne ('l\'ordre') redeviennent elles-mêmes avant la recherche.
  const texte = String(source).replace(/\\(['"`])/g, '$1');
  const m = texte.match(new RegExp(`(?<![\\w$.])(?:it|test)((?:\\s*\\.\\s*\\w+)*)\\s*\\(\\s*(['"\`])${motifDuTitre(nom)}\\2`));
  return m ? m[1] : null;
}

function echecsAttendus(texte, lireFichier) {
  const sansEchec = [];
  for (const h of harnais(texte)) {
    const nom = h.rouge?.nom;
    if (!nom) continue;
    let ordinaire = null;
    for (const chemin of h.chemins.filter(estVitest)) {
      const mods = declaration(lireFichier(chemin) ?? '', nom);
      // Absent du fichier : c'est la couverture qui le dit (#66), pas ce harnais.
      if (mods === null) continue;
      if (/\bfails\b/.test(mods)) {
        ordinaire = null;
        break;
      }
      ordinaire ??= chemin;
    }
    if (ordinaire) {
      sansEchec.push(
        `${h.entree} · le témoin rouge « ${nom} » est écrit comme un test ordinaire dans \`${ordinaire}\` : ` +
          "l'outil de test doit tenir l'échec attendu (`test.fails` avec vitest) (#66).",
      );
    }
  }
  assert.deepEqual(sansEchec, [], `des témoins rouges cités passeraient sans rien prouver :\n${sansEchec.join('\n')}`);
}

const GARDE_INVENTEE = '## I2 · Une tirelire est un livre de compte\n\n' +
  "- **Harnais** · `a/un.test.ts` — garde le calcul. Témoin rouge : « le solde d'une tirelire ignore un compte ».\n";
const TEMOIN = "le solde d'une tirelire ignore un compte";

test('#69 · un témoin rouge cité, tenu par `test.fails`, est accepté', () => {
  echecsAttendus(GARDE_INVENTEE, () => `test.fails('${TEMOIN}', () => {});`);
});

test('#69 · témoin rouge — un témoin cité écrit comme un test ordinaire fait échouer « un témoin cité sait échouer »', () => {
  assert.throws(
    () => echecsAttendus(GARDE_INVENTEE, () => `test('${TEMOIN}', () => {});`),
    /des témoins rouges cités passeraient sans rien prouver/,
  );
});

test('#69 · sur le vrai registre, aucun témoin rouge cité n\'est un test ordinaire', () => {
  echecsAttendus(registre(), lire);
});
