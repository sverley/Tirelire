/**
 * Amorçage de #109, écrit par la session d'audit du 15 septembre 2026, avant le codage (D68).
 *
 * #109 est un besoin organisationnel sans garde : il ne demande qu'une **entrée de décision**.
 * Le glossaire pose qu'un terme arrêté vaut partout ailleurs, sans dire ce qu'il advient des
 * paroles conservées — le texte du porteur, gardé mot pour mot et cité dans les décisions. Le
 * porteur a tranché pendant l'audit de #107 : les citations sont amendées, pas laissées au mot
 * d'avant. L'entrée écrit cette règle, ses limites et sa source.
 *
 * Sept lectures jugent l'entrée, une huitième juge ce qui l'entoure :
 *
 *   1. une entrée nouvelle, datée du 15 septembre 2026, porte un numéro libre et un titre ;
 *   2. elle dit la conséquence : le balayage d'un renommage porte sur le dépôt entier, et
 *      la limite : les fils clos et l'historique des commits ne se réécrivent pas ;
 *   3. elle dit que les paroles conservées suivent, amendées et non laissées au mot d'avant ;
 *   4. elle dit la limite tranchée le 15 septembre : une citation ne s'amende que sous couvert de
 *      son auteur, et l'accord se demande à chaque issue de renommage ;
 *   5. elle dit ce qu'on fait d'une incohérence constatée : elle se remonte dans une issue ;
 *   6. elle nomme sa source (le glossaire, arrêté le 14 septembre) et son occasion (#107, PR #108) ;
 *   7. rien d'autre ne change : aucun renommage, aucun harnais permanent nouveau.
 *
 * Le numéro n'est pas codé en dur. #109 dit « numéro libre au moment du codage » : l'entrée se
 * cherche par sa date, et son numéro doit seulement dépasser ceux de la base. Coder `D69` ici
 * rendrait l'amorçage faux le jour où une autre PR prend ce rang.
 *
 * Témoins. La lecture qui juge le texte est une fonction pure, `notionsManquantes`, éprouvée sur
 * des textes fabriqués : une entrée qui dit tout doit passer, une entrée à qui manque une notion
 * doit être vue, notion par notion. Les autres lectures constatent un format ou un diff exact :
 * un témoin n'y ajouterait rien (D62, garder la garde à la mesure du projet).
 *
 * Comparaison à la base : elle demande l'historique, que le workflow des amorçages pose déjà
 * (`fetch-depth: 0`). Sans historique — clone court, copie sans `.git` — le test le dit et passe,
 * sauf sous `TIRELIRE_STRICT`, où il échoue plutôt que de se taire.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELIRE = "l'amorçage de #109 est à relire";
const STRICT = Boolean(process.env.TIRELIRE_STRICT);

const DECISIONS = 'docs/decisions.md';
const CE_FICHIER = 'amorcage/paroles-conservees.test.mjs';
const DATE = '2026-09-15';

/** Ce que la branche a le droit de changer : l'entrée, et l'amorçage qui la juge. */
const CHEMINS_ADMIS = new Set([DECISIONS, CE_FICHIER]);

// ─── Lecture du catalogue ────────────────────────────────────────────────────────────────────

/** Les entrées de `docs/decisions.md`, du titre à l'entrée suivante. */
function entrees(texte) {
  const enTete = /^## D(\d+)\s+·\s+(\d{4}-\d{2}-\d{2})\s+·\s+(.+)$/gm;
  const trouvees = [...texte.matchAll(enTete)];
  return trouvees.map((m, i) => ({
    numero: Number(m[1]),
    date: m[2],
    titre: m[3].trim(),
    corps: texte.slice(m.index, i + 1 < trouvees.length ? trouvees[i + 1].index : texte.length),
  }));
}

// ─── Ce que l'entrée doit dire ───────────────────────────────────────────────────────────────

/**
 * Chaque notion est un faisceau : toutes ses expressions doivent se trouver dans l'entrée. Les
 * formes admises sont larges — ce qui se juge est le sens porté, pas une tournure imposée. Le
 * codeur écrit depuis le besoin, il n'a pas à deviner une phrase.
 */
const NOTIONS = Object.freeze([
  Object.freeze({
    quoi: 'le balayage porte sur le dépôt entier',
    formes: Object.freeze([/d[ée]p[ôo]t\s+(entier|complet)|tout\s+le\s+d[ée]p[ôo]t/i]),
  }),
  Object.freeze({
    quoi: 'le balayage s\'arrête aux fils clos et à l\'historique',
    formes: Object.freeze([/clos|ferm[ée]s?\b/i, /historique|commit/i]),
  }),
  Object.freeze({
    quoi: 'les paroles conservées suivent, amendées',
    formes: Object.freeze([/citation|parole|t[ée]moignage/i, /amend/i]),
  }),
  Object.freeze({
    quoi: "elles ne restent pas au mot d'avant",
    formes: Object.freeze([/mot\s+d'avant|ancien\s+(mot|terme)|terme\s+retir[ée]|au\s+mot\s+pr[ée]c[ée]dent/i]),
  }),
  Object.freeze({
    quoi: "une citation ne s'amende que sous couvert de son auteur",
    formes: Object.freeze([
      /sous\s+couvert|accord\s+(explicite\s+)?(du|de\s+l')\s*(porteur|auteur)|(porteur|auteur)\s+(l')?autorise|avec\s+l'accord/i,
      /chaque\s+(issue|besoin)\s+de\s+renommage|issue\s+de\s+renommage|à\s+chaque\s+renommage/i,
    ]),
  }),
  Object.freeze({
    quoi: 'une incohérence constatée se remonte dans une issue',
    formes: Object.freeze([/incoh[ée]ren|[ée]cart\s+constat/i, /issue/i]),
  }),
  Object.freeze({
    quoi: 'la source : le glossaire arrêté le 14 septembre',
    formes: Object.freeze([/glossaire/i, /14\s+septembre|2026-09-14/i]),
  }),
  Object.freeze({
    quoi: "l'occasion : #107 et la PR #108",
    formes: Object.freeze([/#107/, /#108/]),
  }),
]);

/** Fonction pure : les notions de #109 que ce texte ne porte pas. */
export function notionsManquantes(texte) {
  return NOTIONS.filter((n) => !n.formes.every((f) => f.test(texte))).map((n) => n.quoi);
}

// ─── Accès à la base de la PR ────────────────────────────────────────────────────────────────

function base() {
  try {
    const sha = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: DEPOT, encoding: 'utf8' }).trim();
    return sha || null;
  } catch {
    return null;
  }
}

function auPointDeDepart(sha, chemin) {
  try {
    return execFileSync('git', ['show', `${sha}:${chemin}`], { cwd: DEPOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/** Sans historique, la comparaison se tait — sauf sous `TIRELIRE_STRICT`, où elle échoue. */
function sansHistorique(quoi) {
  assert.ok(!STRICT, `${quoi} : historique git absent, et TIRELIRE_STRICT est posé (${RELIRE})`);
  console.log(`${quoi} : historique git absent, comparaison à la base ignorée`);
}

const CATALOGUE = () => readFileSync(resolve(DEPOT, DECISIONS), 'utf8');

/** L'entrée jugée : la seule du 15 septembre 2026 qui ne soit pas déjà à la base. */
function entreeDuBesoin() {
  const nouvelles = entrees(CATALOGUE()).filter((e) => e.date === DATE);
  const sha = base();
  if (!sha) return { entrees: nouvelles, sha: null };
  const avant = auPointDeDepart(sha, DECISIONS);
  if (avant === null) return { entrees: nouvelles, sha: null };
  const dejaLa = new Set(entrees(avant).map((e) => `${e.numero}·${e.titre}`));
  return { entrees: nouvelles.filter((e) => !dejaLa.has(`${e.numero}·${e.titre}`)), sha, avant };
}

// ─── 1. Une entrée nouvelle, datée, numérotée librement ──────────────────────────────────────

test("docs/decisions.md porte une entrée nouvelle datée du 15 septembre 2026", () => {
  const { entrees: nouvelles, sha, avant } = entreeDuBesoin();
  assert.equal(
    nouvelles.length,
    1,
    `attendu une entrée nouvelle du ${DATE} dans ${DECISIONS}, trouvé ${nouvelles.length} (${RELIRE})`,
  );
  const [entree] = nouvelles;
  assert.ok(entree.titre.length >= 10, `l'entrée doit porter un titre qui dit la règle, lu : « ${entree.titre} »`);

  if (!sha || avant === undefined) return sansHistorique('numérotation');
  const rangs = entrees(avant).map((e) => e.numero);
  const dernier = Math.max(...rangs);
  assert.ok(
    entree.numero > dernier,
    `le numéro doit être libre : D${entree.numero} proposé, la base va jusqu'à D${dernier}`,
  );
  const doublons = entrees(CATALOGUE()).filter((e) => e.numero === entree.numero);
  assert.equal(doublons.length, 1, `D${entree.numero} apparaît ${doublons.length} fois dans le catalogue`);
});

// ─── 2 à 6. Ce que l'entrée dit ──────────────────────────────────────────────────────────────

for (const notion of NOTIONS) {
  test(`l'entrée dit : ${notion.quoi}`, () => {
    const { entrees: nouvelles } = entreeDuBesoin();
    assert.equal(nouvelles.length, 1, `entrée du ${DATE} introuvable ou ambiguë (${RELIRE})`);
    const manquantes = notionsManquantes(nouvelles[0].corps);
    assert.ok(
      !manquantes.includes(notion.quoi),
      `l'entrée ne dit pas : ${notion.quoi}\n--- entrée lue ---\n${nouvelles[0].corps.trim()}`,
    );
  });
}

// ─── 7. Rien d'autre ne change ───────────────────────────────────────────────────────────────

test("rien d'autre ne change : aucun renommage, aucun harnais permanent nouveau", () => {
  const sha = base();
  if (!sha) return sansHistorique('périmètre');
  const diff = execFileSync('git', ['diff', '--name-only', sha, 'HEAD'], { cwd: DEPOT, encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const hors = diff.filter((chemin) => !CHEMINS_ADMIS.has(chemin));
  assert.deepEqual(
    hors,
    [],
    `#109 ne change que ${DECISIONS} : ${hors.join(', ')} sort du périmètre. Un besoin découvert en route devient une issue (D63).`,
  );
});

// ─── Témoins de la lecture qui juge ──────────────────────────────────────────────────────────

const TEMOIN_COMPLET = `## D99 · ${DATE} · Le vocabulaire arrêté vaut aussi dans les paroles conservées

Quand un terme du glossaire change, le balayage porte sur le dépôt entier : tout ce qui décrit le
projet et sa structure suit, y compris les paroles conservées. Les citations du porteur sont
amendées ; elles ne restent pas au mot d'avant. Le balayage s'arrête aux fils clos et à
l'historique des commits, qui ne se réécrivent pas.

Une citation ne s'amende que sous couvert de son auteur : chaque issue de renommage porte l'accord
explicite du porteur. Une incohérence constatée — un terme retiré qui subsiste — se remonte dans une
issue, nouvelle ou existante, elle ne se corrige pas au fil de l'eau.

Source : le glossaire, arrêté par le porteur le 14 septembre 2026. Occasion : #107, PR #108.
`;

test("témoin vert : une entrée fabriquée qui dit tout passe toutes les lectures", () => {
  assert.deepEqual(notionsManquantes(TEMOIN_COMPLET), []);
});

test("témoin rouge : chaque notion retirée du témoin est vue, une par une", () => {
  for (const notion of NOTIONS) {
    // La première forme du faisceau suffit à porter la notion : l'effacer doit la faire voir.
    const [forme] = notion.formes;
    const abime = TEMOIN_COMPLET.replace(new RegExp(forme.source, `g${forme.flags.replace('g', '')}`), '…');
    assert.ok(
      notionsManquantes(abime).includes(notion.quoi),
      `une entrée à qui manque « ${notion.quoi} » doit être vue (${RELIRE})`,
    );
    assert.deepEqual(
      notionsManquantes(abime),
      [notion.quoi],
      `effacer « ${notion.quoi} » ne doit pas emporter les autres notions (${RELIRE})`,
    );
  }
});
