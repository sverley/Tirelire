/**
 * Amorçage de #109, écrit par la session d'audit du 15 septembre 2026, avant le codage (D68).
 *
 * #109 est un besoin organisationnel sans garde : il ne demande qu'une **entrée de décision**.
 * Le glossaire pose qu'un terme arrêté vaut partout ailleurs, sans dire ce qu'il advient des
 * paroles conservées — le texte du porteur, gardé mot pour mot et cité dans les décisions. Le
 * porteur a tranché pendant l'audit de #107 : les citations sont amendées, pas laissées au mot
 * d'avant. L'entrée écrit cette règle, ses limites et sa source.
 *
 * Les lectures jugent l'entrée, désormais nommée D69 :
 *
 *   1. elle est là, datée du 15 septembre 2026, et porte un titre ;
 *   2. elle dit la conséquence : le balayage d'un renommage porte sur le dépôt entier, et
 *      la limite : ce que la garde locale ne lit pas n'est pas balayé ;
 *   3. elle dit que les paroles conservées suivent, amendées et non laissées au mot d'avant ;
 *   4. elle dit la limite tranchée le 15 septembre : une citation ne s'amende que sous couvert de
 *      son auteur, et l'accord se demande à chaque issue de renommage ;
 *   5. elle dit ce qu'on fait d'une incohérence constatée : elle se remonte dans une issue ;
 *   6. elle nomme sa source (le glossaire, arrêté le 14 septembre) et son occasion (#107, PR #108) ;
 *
 * Le numéro, lui, est maintenant connu. Tant que #109 était en cours, il ne l'était pas : l'entrée
 * se cherchait par sa date, et la comparaison à la base disait laquelle était nouvelle. Depuis la
 * fusion, D69 est sur `main` et son rang ne bougera plus — une décision ne se réécrit pas
 * (`CLAUDE.md`). L'ancrage par le numéro remplace donc l'ancrage par la base, et la lecture garde
 * son sens sans historique.
 *
 * Allégé par #112, le 15 septembre 2026, des lectures qui comparaient à la base de la PR : la
 * lecture de périmètre « rien d'autre ne change » est retirée, et la recherche de l'entrée par
 * différence avec la base est remplacée par l'ancrage sur D69, dit juste au-dessus. Ce qu'elles
 * vérifiaient, et pourquoi ce n'est plus utile : D70.
 *
 * Témoins. La lecture qui juge le texte est une fonction pure, `notionsManquantes`, éprouvée sur
 * des textes fabriqués : une entrée qui dit tout doit passer, une entrée à qui manque une notion
 * doit être vue, notion par notion. La lecture qui reste constate un format exact : un témoin n'y
 * ajouterait rien (D62, garder la garde à la mesure du projet).
 *
 * Plus rien ici ne lit l'historique git : l'amorçage rend le même verdict sur un clone court, et
 * `TIRELIRE_STRICT` ne change plus rien à ce qu'il dit.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELIRE = "l'amorçage de #109 est à relire";

const DECISIONS = 'docs/decisions.md';
const DATE = '2026-09-15';

/** L'entrée écrite pour #109, fusionnée le 15 septembre 2026 : son rang ne bouge plus. */
const NUMERO = 69;

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
    quoi: 'le balayage s\'arrête à ce que la garde locale ne lit pas',
    formes: Object.freeze([/suivis?\s+par\s+git|fichiers?\s+suivis?|garde\s+locale/i, /github|commit/i]),
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

// ─── L'entrée jugée ──────────────────────────────────────────────────────────────────────────

const CATALOGUE = () => readFileSync(resolve(DEPOT, DECISIONS), 'utf8');

/** Les entrées portant le rang de #109 : une seule, sauf si le catalogue a été abîmé. */
const entreesDuBesoin = () => entrees(CATALOGUE()).filter((e) => e.numero === NUMERO);

// ─── 1. L'entrée est là, datée, titrée ───────────────────────────────────────────────────────

test("docs/decisions.md porte une entrée nouvelle datée du 15 septembre 2026", () => {
  const trouvees = entreesDuBesoin();
  assert.equal(
    trouvees.length,
    1,
    `attendu une entrée D${NUMERO} dans ${DECISIONS}, trouvé ${trouvees.length} (${RELIRE})`,
  );
  const [entree] = trouvees;
  assert.equal(entree.date, DATE, `D${NUMERO} devait être datée du ${DATE}, lu : ${entree.date}`);
  assert.ok(entree.titre.length >= 10, `l'entrée doit porter un titre qui dit la règle, lu : « ${entree.titre} »`);
});

// ─── 2 à 6. Ce que l'entrée dit ──────────────────────────────────────────────────────────────

for (const notion of NOTIONS) {
  test(`l'entrée dit : ${notion.quoi}`, () => {
    const trouvees = entreesDuBesoin();
    assert.equal(trouvees.length, 1, `entrée D${NUMERO} introuvable ou ambiguë (${RELIRE})`);
    const manquantes = notionsManquantes(trouvees[0].corps);
    assert.ok(
      !manquantes.includes(notion.quoi),
      `l'entrée ne dit pas : ${notion.quoi}\n--- entrée lue ---\n${trouvees[0].corps.trim()}`,
    );
  });
}

// ─── Témoins de la lecture qui juge ──────────────────────────────────────────────────────────

const TEMOIN_COMPLET = `## D99 · ${DATE} · Le vocabulaire arrêté vaut aussi dans les paroles conservées

Quand un terme du glossaire change, le balayage porte sur le dépôt entier : tout ce qui décrit le
projet et sa structure suit, y compris les paroles conservées. Les citations du porteur sont
amendées ; elles ne restent pas au mot d'avant. Le balayage s'arrête à ce que la garde
locale sait lire, les fichiers suivis par git : les fils GitHub et les messages de commit en sont
dehors.

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
