/**
 * Amorçage de #111, écrit par la session d'audit du 15 septembre 2026, avant le codage (D68).
 *
 * #111 relève que le glossaire définit l'amorçage plus étroitement que D65 : « les harnais qui
 * vérifient le codage des harnais de la garde », quand D65 en fait la case auditeur × règle, garde
 * codée ou non. Le porteur a tranché la voie 1 le 15 septembre : le glossaire s'élargit, un amorçage
 * vérifie le codage d'un **besoin organisationnel**. #111 est lui-même une règle codée sans garde.
 *
 * Arbitrages de l'audit, rendus le même jour (fil de #111) :
 *   - Q2 : le glossaire garantit la compréhension commune des mots, il ne stocke pas de sources.
 *     Source, occasion et exemples vont dans une décision nouvelle ;
 *   - Q1 : la parole conservée de `docs/description-projet.md` est amendée, première phrase
 *     seulement, au texte validé mot pour mot par le porteur.
 *
 * Arbitrages rendus le 16 septembre, à l'audit du codage (fil de la PR #116) :
 *   - « sans garde » se lit « sans garde nouvelle ou modifiée ». #109 est l'exemple ; #107 n'en
 *     est pas un, son codage ayant modifié la garde (PR #108). L'entrée n'est donc plus tenue de
 *     citer #107, et l'exactitude de ce qu'elle en dit se lit (D62) ;
 *   - la section « Amorçages » du glossaire est validée mot pour mot par le porteur.
 *
 * Arbitrages rendus plus tard le 16 septembre (fil de la PR #116) :
 *   - la garde comprend les catalogues et les descriptions du projet ; #96 porte leur édition par
 *     l'outil. Le glossaire dit donc « sans que le codeur change le comportement de la garde »,
 *     et non plus « sans que le codeur touche à la garde » ;
 *   - D72 ne caractérise plus la règle codée sans garde par `packages/gardes`, mais par le
 *     comportement de la garde : écrire dans un catalogue, c'est ajouter de la donnée (#96).
 *
 * Retouché par l'audit de #122 : la dernière phrase du texte validé devient celle que le porteur a
 * validée mot pour mot le 16 septembre (Q1 de #122), les amorçages étant désormais joués sur chaque
 * PR. Le reste de la section ne change pas.
 *
 * Retouché par l'audit de #131 (17 septembre 2026) : cette dernière phrase devient, mot pour mot,
 * celle du porteur (Q4 de #131). Le reste de la section ne change pas.
 *
 * Les lectures, toutes sur des fichiers suivis, sans réseau ni comparaison à la base (D70) :
 *
 *   1. la section « Amorçages » du glossaire définit par le besoin organisationnel, couvre le cas
 *      sans garde, ne se réduit plus aux harnais de la garde et ne porte aucune source ; elle
 *      porte, au blanc près, le texte validé par le porteur (16 et 17 septembre), retouché le même jour ;
 *   2. « Garde » reste l'outil des catalogues, et les titres du glossaire restent en place ;
 *   3. la première décision qui nomme #111 est nouvelle et porte source, occasion, exemple et
 *      l'accord avec D65 ; les numéros du journal restent uniques et croissants — #113 ajoute
 *      aussi une entrée, le rang se prend au rebasage ;
 *   4. D65 est intacte : sa case auditeur × règle est toujours l'amorçage ;
 *   5. `CLAUDE.md` écrit le cas d'une règle codée sans garde, là où il dit ce que code le codeur ;
 *   6. la parole conservée porte la phrase validée, et garde sa seconde phrase.
 *
 * L'entrée se cherche par son contenu (#111), jamais par son numéro : il n'est pas connu à
 * l'écriture de ce fichier. C'est la **première** qui le nomme : une décision future pourra citer
 * #111 sans rougir cet amorçage, qui continue de tourner après la fusion (D70).
 *
 * Témoins. Les lectures de texte sont des fonctions pures, éprouvées sur des textes fabriqués :
 * l'ancienne définition doit être vue, une définition qui cite une source aussi, et chaque notion
 * retirée d'une entrée complète doit manquer seule. Les lectures 2, 4 et 6 constatent un texte
 * exact : un témoin n'y ajouterait rien (D62).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELIRE = "l'amorçage de #111 est à relire";
const lire = (chemin) => readFileSync(resolve(DEPOT, chemin), 'utf8');

const GLOSSAIRE = 'docs/glossaire.md';
const DECISIONS = 'docs/decisions.md';
const CLAUDE = 'CLAUDE.md';
const DESCRIPTION = 'docs/description-projet.md';

const SANS_GARDE = /sans\s+garde|garde\s+(\S+\s+){0,4}ou\s+non|ou\s+non|aucune\s+garde|pas\s+de\s+garde|si\s+elle\s+se\s+programme|le\s+cas\s+[ée]ch[ée]ant/i;

// ─── Lectures pures ──────────────────────────────────────────────────────────────────────────

/** Le corps d'une section `## titre` d'un document markdown, titre exclu ; `null` si absente. */
export function section(texte, titre) {
  const lignes = texte.split('\n');
  const debut = lignes.findIndex((l) => l.trim() === `## ${titre}`);
  if (debut < 0) return null;
  const fin = lignes.findIndex((l, i) => i > debut && /^##\s/.test(l));
  return lignes.slice(debut + 1, fin < 0 ? undefined : fin).join('\n');
}

/** Ce que la définition de l'amorçage ne tient pas encore. */
export function ecartsDeDefinition(corps) {
  const ecarts = [];
  if (!/besoins?\s+organisationnels?/i.test(corps)) ecarts.push('elle ne définit pas par le besoin organisationnel');
  if (!SANS_GARDE.test(corps)) ecarts.push("elle n'écrit pas le cas d'un besoin codé sans garde");
  if (/codage\s+des\s+harnais\s+de\s+la\s+garde/i.test(corps)) ecarts.push('elle se réduit encore au codage des harnais de la garde');
  const source = corps.match(/#\d+|\bD\d{2,}\b|\b20\d\d-\d\d-\d\d\b|\b\d{1,2}(er)?\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b/i);
  if (source) ecarts.push(`elle porte une source (« ${source[0]} ») : le glossaire n'en stocke pas`);
  return ecarts;
}

/** Les entrées du journal des décisions. */
export function entrees(texte) {
  const trouvees = [...texte.matchAll(/^## D(\d+)\s+·\s+(\d{4}-\d{2}-\d{2})\s+·\s+(.+)$/gm)];
  return trouvees.map((m, i) => ({
    numero: Number(m[1]),
    date: m[2],
    titre: m[3].trim(),
    corps: texte.slice(m.index, i + 1 < trouvees.length ? trouvees[i + 1].index : texte.length),
  }));
}

const NOTIONS = Object.freeze([
  { quoi: 'le besoin : #111', formes: [/#111\b/] },
  { quoi: "l'amorçage vérifie le codage d'un besoin organisationnel", formes: [/amor[çc]age/i, /besoins?\s+organisationnels?/i] },
  { quoi: "le cas d'une règle codée sans garde", formes: [SANS_GARDE] },
  { quoi: "l'exemple d'une règle codée sans garde : #109", formes: [/#109\b/] },
  { quoi: "l'occasion : la PR #110", formes: [/#110\b/] },
  { quoi: "D65 n'est pas contredite", formes: [/\bD65\b/, /contredi|rejoin|concord|align|m[êe]me\s+(d[ée]finition|lecture)|lecture\s+juste/i] },
  { quoi: 'la source : le porteur, le 15 septembre', formes: [/porteur/i, /15\s+septembre|2026-09-15/i] },
  { quoi: 'le texte élargi : le glossaire', formes: [/glossaire/i] },
  { quoi: 'sans garde se lit par le comportement de la garde, un catalogue étant de la donnée (#96)', formes: [/comportement/i, /donn[ée]es?\b/i, /#96\b/] },
].map((n) => Object.freeze({ ...n, formes: Object.freeze(n.formes) })));

/** Les notions de #111 que ce texte ne porte pas. */
export function notionsManquantes(texte) {
  return NOTIONS.filter((n) => !n.formes.every((f) => f.test(texte))).map((n) => n.quoi);
}

/** Vrai si le texte réduit la règle codée sans garde à un codage qui ne touche pas `packages/gardes`. */
export function caracteriseParLeCode(texte) {
  return /sans\s+que\s+le\s+codeur\s+touche\s+[àa]\s+`?packages\/gardes/i.test(texte);
}

/** Les puces d'un document, lignes de suite comprises. */
export function puces(texte) {
  const resultat = [];
  for (const ligne of texte.split('\n')) {
    if (/^\s*[-*]\s+/.test(ligne)) resultat.push(ligne.trim());
    else if (resultat.length && /^\s+\S/.test(ligne)) resultat[resultat.length - 1] += ` ${ligne.trim()}`;
    else if (!ligne.trim()) resultat.push('');
  }
  return resultat.filter(Boolean);
}

/** Les puces qui disent ce que code le codeur d'une règle, et si elles écrivent le cas sans garde. */
export function pucesDuCodeurDeRegle(texte) {
  return puces(texte)
    .filter((p) => /codeur/i.test(p) && /amor[çc]age/i.test(p) && /r[èe]gle/i.test(p) && /garde/i.test(p))
    .map((p) => ({ puce: p, sansGarde: SANS_GARDE.test(p), etroite: /codeur\s+code\s+la\s+garde(?![^.;]*(ou\s+non|sans\s+garde|si\s+elle))/i.test(p) }));
}

// ─── 1 · La définition du glossaire ──────────────────────────────────────────────────────────

test('#111 · le glossaire définit l’amorçage par le besoin organisationnel, garde codée ou non, sans source', () => {
  const corps = section(lire(GLOSSAIRE), 'Amorçages');
  assert.ok(corps !== null, `${GLOSSAIRE} n'a plus de section « Amorçages » (${RELIRE})`);
  assert.deepEqual(ecartsDeDefinition(corps), [], `définition lue :\n${corps.trim()}`);
});

test('#111 · témoin : l’ancienne définition est vue, une définition sourcée aussi, la bonne passe', () => {
  const ancienne = "Les harnais qui vérifient le codage des harnais de la garde. Ils n'ont pas à être joués autrement\nqu'en cas de codage dans la garde, ou dans ce qu'elle garde.";
  assert.equal(ecartsDeDefinition(ancienne).length, 3, RELIRE);
  const bonne = "Les harnais qui vérifient le codage d'un besoin organisationnel, qu'une garde ait été codée ou non.";
  assert.deepEqual(ecartsDeDefinition(bonne), [], RELIRE);
  for (const source of [' Voir #109.', ' Tranché le 15 septembre.', ' (D65)', ' Arrêté le 2026-09-15.']) {
    assert.equal(ecartsDeDefinition(bonne + source).length, 1, `source non vue : ${source} (${RELIRE})`);
  }
});

const DEFINITION_VALIDEE = `Les harnais qui vérifient le codage d'un besoin organisationnel, qu'une garde ait été codée,
modifiée ou non. Une règle peut se coder par la seule prose, sans que le codeur change le comportement
de la garde : son codage a quand même son amorçage.

Un amorçage ne se confond pas avec la garde : la garde tient les catalogues dans la durée,
l'amorçage juge un codage donné, celui d'un besoin organisationnel précis. Les amorçages ne sont
joués que si on touche à la garde et à ce qui est gardé.`;

/** Un texte ramené à ses mots : les retours à la ligne et les blancs ne comptent pas. */
const auBlancPres = (texte) => texte.replace(/\s+/g, ' ').trim();

test('#111 · la section « Amorçages » porte, au blanc près, le texte validé par le porteur (16 et 17 septembre)', () => {
  const corps = section(lire(GLOSSAIRE), 'Amorçages') ?? '';
  assert.equal(auBlancPres(corps), auBlancPres(DEFINITION_VALIDEE), `la section doit porter mot pour mot le texte validé (fil de la PR #116) :\n${DEFINITION_VALIDEE}`);
  assert.deepEqual(ecartsDeDefinition(DEFINITION_VALIDEE), [], `le texte validé ne passe plus la lecture 1 (${RELIRE})`);
});

// ─── 2 · Le reste du glossaire ne bouge pas ──────────────────────────────────────────────────

test('#111 · « Garde » reste l’outil des catalogues, et les titres du glossaire sont en place', () => {
  const texte = lire(GLOSSAIRE);
  for (const titre of ['Besoin', 'Harnais', 'Garde', 'Tests', 'Amorçages', 'Documentation simple']) {
    assert.ok(section(texte, titre) !== null, `section « ${titre} » absente de ${GLOSSAIRE} : aucun terme ne devait sortir`);
  }
  assert.match(section(texte, 'Garde'), /L'outil qui garde les catalogues/, `la définition de la garde a bougé (${RELIRE})`);
});

// ─── 3 · La décision nouvelle ────────────────────────────────────────────────────────────────

test('#111 · les numéros du journal des décisions restent uniques et croissants', () => {
  const numeros = entrees(lire(DECISIONS)).map((e) => e.numero);
  const fautes = numeros.filter((n, i) => i > 0 && n <= numeros[i - 1]);
  assert.deepEqual(fautes, [], `rang en double ou hors ordre dans ${DECISIONS} : rebaser et renuméroter l'entrée de #111`);
});

/** La première entrée du journal qui nomme #111 : celle du besoin, les suivantes ne font que la citer. */
const entreeDuBesoin = () => entrees(lire(DECISIONS)).find((e) => /#111\b/.test(e.corps));

test('#111 · la première décision qui nomme #111 est une entrée nouvelle', () => {
  const entree = entreeDuBesoin();
  assert.ok(entree, `aucune entrée de ${DECISIONS} ne nomme #111`);
  assert.ok(entree.numero > 65, `l'entrée de #111 doit être nouvelle, pas une réécriture de D${entree.numero}`);
  assert.ok(entree.date >= '2026-09-15', `l'entrée de #111 est datée du ${entree.date}, avant l'arbitrage`);
});

for (const notion of NOTIONS.slice(1)) {
  test(`#111 · l'entrée dit : ${notion.quoi}`, () => {
    const entree = entreeDuBesoin();
    assert.ok(entree, `entrée de #111 introuvable (${RELIRE})`);
    assert.ok(!notionsManquantes(entree.corps).includes(notion.quoi), `l'entrée ne dit pas : ${notion.quoi}\n--- entrée lue ---\n${entree.corps.trim()}`);
  });
}

const TEMOIN = `## D99 · 2026-09-16 · L'amorçage se définit par le besoin organisationnel

Besoin #111, tranché par le porteur le 15 septembre : le glossaire s'élargit. Un amorçage vérifie
le codage d'un besoin organisationnel, qu'une garde ait été codée ou non. Le cas d'une règle codée
sans garde existait déjà : l'amorçage de #109 juge une entrée du journal. D65 n'est pas
contredite, sa case auditeur × règle en était la lecture juste. Occasion : l'audit de la PR #110.
Sans garde veut dire sans changer le comportement de la garde : un catalogue, c'est de la donnée (#96).
`;

test('#111 · témoin : une entrée complète passe, chaque notion retirée manque seule', () => {
  assert.deepEqual(notionsManquantes(TEMOIN), [], RELIRE);
  for (const notion of NOTIONS) {
    const [forme] = notion.formes;
    const abime = TEMOIN.replace(new RegExp(forme.source, `g${forme.flags.replace('g', '')}`), '…');
    assert.deepEqual(notionsManquantes(abime), [notion.quoi], `effacer « ${notion.quoi} » doit être vu, et seul (${RELIRE})`);
  }
});

test('#111 · l’entrée ne réduit plus la règle codée sans garde à un codage hors de packages/gardes', () => {
  const entree = entreeDuBesoin();
  assert.ok(entree, `entrée de #111 introuvable (${RELIRE})`);
  assert.ok(!caracteriseParLeCode(entree.corps), "l'entrée dit encore « sans que le codeur touche à `packages/gardes` » : la garde comprend aussi les catalogues, c'est son comportement qui ne change pas (#96)");
});

test('#111 · témoin : la caractérisation par le code est vue, coupée ou non, et celle par le comportement passe', () => {
  assert.equal(caracteriseParLeCode("une puce de `CLAUDE.md` — sans que le codeur touche à `packages/gardes`. Son codage"), true, RELIRE);
  assert.equal(caracteriseParLeCode('sans que le codeur\n  touche à packages/gardes'), true, RELIRE);
  assert.equal(caracteriseParLeCode(TEMOIN), false, RELIRE);
});

// ─── 4 · D65 intacte ─────────────────────────────────────────────────────────────────────────

test('#111 · D65 est intacte : la case auditeur × règle reste l’amorçage', () => {
  const [d65] = entrees(lire(DECISIONS)).filter((e) => e.numero === 65);
  assert.ok(d65, 'D65 a disparu du journal : une décision ne se réécrit pas');
  assert.match(d65.titre, /^Deux questions classent un harnais/, `le titre de D65 a bougé (${RELIRE})`);
  assert.ok(d65.corps.includes('| **Auditeur** | harnais du besoin | **amorçage** |'), 'la table de D65 a bougé : une décision ne se réécrit pas');
});

// ─── 5 · CLAUDE.md ───────────────────────────────────────────────────────────────────────────

test('#111 · CLAUDE.md écrit le cas d’une règle codée sans garde, là où il dit ce que code le codeur', () => {
  const lues = pucesDuCodeurDeRegle(lire(CLAUDE));
  assert.ok(lues.length > 0, `aucune puce de ${CLAUDE} ne dit ce que code le codeur d'une règle (${RELIRE})`);
  const etroites = lues.filter((l) => l.etroite).map((l) => l.puce);
  assert.deepEqual(etroites, [], 'une puce fait encore coder la garde au codeur de toute règle, sans le cas où il n\'y en a pas');
  assert.ok(lues.some((l) => l.sansGarde), `aucune puce n'écrit le cas sans garde :\n${lues.map((l) => l.puce).join('\n')}`);
});

test('#111 · témoin : la puce d’avant est vue, une puce élargie passe', () => {
  const avant = "  - **Si le besoin est une règle**, le codeur code la garde et le harnais de la garde ; l'auditeur\n    code l'**amorçage** qui juge ce travail (D65).\n";
  const apres = "  - **Si le besoin est une règle**, le codeur code la règle, et la garde avec son harnais si elle se\n    programme ; l'auditeur code l'**amorçage** qui juge ce travail, garde codée ou non (D65).\n";
  assert.deepEqual(pucesDuCodeurDeRegle(avant).map((l) => [l.etroite, l.sansGarde]), [[true, false]], RELIRE);
  assert.deepEqual(pucesDuCodeurDeRegle(apres).map((l) => [l.etroite, l.sansGarde]), [[false, true]], RELIRE);
});

// ─── 6 · La parole conservée ─────────────────────────────────────────────────────────────────

test('#111 · la parole conservée porte la phrase validée par le porteur, et garde sa seconde phrase', () => {
  const texte = lire(DESCRIPTION);
  const validee = 'Les harnais qui verifient le codage d\'un besoin organisationnel, qu\'il ait produit une garde ou non, sont nommées "amorçages".';
  const seconde = "Ils n'ont pas besoin d'etre joués autrement qu'en cas de codage dans la garde et ce qu'elle garde.";
  assert.ok(!texte.includes('verifient le codage des harnais de la garde'), `${DESCRIPTION} garde l'ancienne phrase`);
  assert.equal(texte.split(validee).length - 1, 1, `${DESCRIPTION} doit porter une fois, mot pour mot, la phrase validée le 15 septembre :\n${validee}`);
  assert.ok(texte.includes(`${validee} ${seconde}`), `la seconde phrase doit suivre la première, inchangée :\n${seconde}`);
});
