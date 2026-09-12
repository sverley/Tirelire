/**
 * Harnais d'audit de #60 : ce que GitHub affiche déclaré, la vérification le lit ; ce qu'il affiche
 * en exemple, elle ne le prend pas pour la déclaration.
 *
 * Complète `declaration-lue.test.mjs`, dans son style et avec ses aides : `cli.mjs pr --corps-fichier`
 * sur le dépôt tel quel, chaque piège avec son témoin. Deux formes qu'il ne couvre pas :
 *
 * - un identifiant tapé en minuscules parmi d'autres (« Touchés : I9, c8 ») : sur téléphone, la
 *   majuscule saute ; la ligne reste lisible et le lecteur y voit C8 déclaré ;
 * - un exemple de section dans un bloc de code écrit autrement qu'entre trois accents graves :
 *   entre tildes, entre quatre accents graves, ou renfoncé de quatre espaces. GitHub l'affiche en
 *   code, comme l'exemple que `declaration-lue.test.mjs` garde déjà.
 *
 * Attendu : pas de vert tant qu'une vérification de ce que la description déclare manque. Lire la
 * forme ou la refuser en la nommant : le harnais n'impose ni l'une ni l'autre.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Consigne d'une vérification manuelle, mot pour mot : ce qui suit le tiret cadratin au registre, suite renfoncée comprise. */
function consigneDu(cle, racine = DEPOT) {
  const lignes = readFileSync(join(racine, 'docs/gardes.md'), 'utf8').split(/\r?\n/);
  const cle_ = cle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const i = lignes.findIndex((l) => new RegExp(`^[-*]\\s+\\*\\*Vérification manuelle\\*\\*\\s+·\\s+\`${cle_}\`\\s+—\\s+`).test(l));
  if (i < 0) return '';
  const morceaux = [lignes[i].replace(/^.*?`\s+—\s+/, '').trim()];
  for (let j = i + 1; j < lignes.length && /^\s+\S/.test(lignes[j]); j++) morceaux.push(lignes[j].trim());
  return morceaux.join(' ');
}
/** Tête d'une vérification listée dans la PR, consigne recopiée comme `demander` l'écrit (tranché dans #60). */
const teteVm = (cle) => `- \`${cle}\` · essai${consigneDu(cle) ? ` — ${consigneDu(cle)}` : ''}`;

const CLI = join(DEPOT, 'packages/gardes/cli.mjs');
const ANALYSE = "Relu par la session d'audit de #60 : essai, rien de réel n'est vérifié.";
const RELIRE = "le harnais d'audit de #60 est à relire";

/** Rien de la CI qui joue ce harnais n'atteint la garde lancée. */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([cle]) => !/^(GITHUB_|GIT_)/.test(cle) && !['CORPS', 'NODE_TEST_CONTEXT'].includes(cle)),
);

const dossier = mkdtempSync(join(tmpdir(), 'tirelire-declaration-visible-'));
after(() => rmSync(dossier, { recursive: true, force: true }));

let numero = 0;
/** La vérification d'une description, hors GitHub : une case cochée y compte comme validée. */
function verifier(corps) {
  const fichier = join(dossier, `corps-${++numero}.md`);
  writeFileSync(fichier, corps);
  const r = spawnSync(process.execPath, [CLI, 'pr', '--corps-fichier', fichier], { cwd: DEPOT, env: ENV, encoding: 'utf8' });
  return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const rouge = (r, cas) => assert.equal(r.code, 1, `attendu rouge : ${cas}\n${r.sortie}`);
const vert = (r, cas) => assert.equal(r.code, 0, `attendu vert : ${cas}\n${r.sortie}`);

// ─── Registre, lu par son format ─────────────────────────────────────────────────────────────

/** Entrées du registre : identifiant, vérifications manuelles, et si elles renvoient à d'autres. */
function registre() {
  const entrees = new Map();
  let entree = null;
  for (const ligne of readFileSync(join(DEPOT, 'docs/gardes.md'), 'utf8').split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(ligne)) {
      const titre = ligne.match(/^#{2,3}\s+([IUC]\d+)\s+·/);
      entree = titre ? { id: titre[1], vms: [], renvoie: false } : null;
      if (entree) entrees.set(entree.id, entree);
      continue;
    }
    if (!entree) continue;
    const vm = ligne.match(/^[-*]\s+\*\*Vérification manuelle\*\*\s+·\s+`([^`]+)`/);
    if (vm) entree.vms.push(vm[1]);
    if (/^[-*]\s+\*\*Couvert par\*\*/.test(ligne)) entree.renvoie = true;
  }
  return entrees;
}

const ENTREES = registre();
/** Entrées qui demandent au moins une vérification et ne renvoient à aucune autre : les déclarer demande exactement leurs vérifications. */
const SIMPLES = [...ENTREES.values()].filter((e) => e.vms.length && !e.renvoie);

// ─── Descriptions ────────────────────────────────────────────────────────────────────────────

const ENTETE = ["Pour #… : essai du harnais d'audit de #60 (formes visibles).", '', '## Ce qui change', '', 'Essai.', ''];

function description(section, { avant = [] } = {}) {
  return [...ENTETE, ...avant, '## Invariants et contraintes', '', ...section, ''].join('\n');
}

/** Les vérifications des entrées désignées, analysées et validées. */
const verifications = (ids) => [
  '',
  '### Vérifications manuelles',
  '',
  ...ids.flatMap((id) => ENTREES.get(id).vms).flatMap((cle) => [
    teteVm(cle),
    `  - Analyse (audit, 2026-09-11) : ${ANALYSE}`,
    '  - [x] Validée par un développeur humain',
  ]),
];

// ─── Pièges ──────────────────────────────────────────────────────────────────────────────────
// Chaque piège est un sous-test : un cas rouge ne cache pas les suivants.

test('#60 · un identifiant écrit en minuscules parmi d’autres ne passe pas en silence', async (t) => {
  const [a, e] = SIMPLES;
  assert.ok(a && e, `moins de deux entrées qui demandent une vérification sans renvoi : ${RELIRE}`);
  const bas = e.id.toLowerCase();

  vert(verifier(description([`Touchés : ${a.id}, ${e.id}`, 'Lien possible masqué : aucun', ...verifications([a.id, e.id])])), `témoin : ${a.id}, ${e.id}, vérifications validées`);
  rouge(verifier(description([`Touchés : ${a.id}, ${e.id}`, 'Lien possible masqué : aucun', ...verifications([a.id])])), `témoin : ${a.id}, ${e.id}, sans les vérifications de ${e.id}`);
  rouge(verifier(description([`Touchés : ${bas}`, 'Lien possible masqué : aucun'])), `témoin : « Touchés : ${bas} » seul`);

  for (const [cas, lignes] of [
    [`« Touchés : ${a.id}, ${bas} »`, [`Touchés : ${a.id}, ${bas}`, 'Lien possible masqué : aucun']],
    [`« Lien possible masqué : ${a.id}, ${bas} »`, ['Touchés : aucun', `Lien possible masqué : ${a.id}, ${bas}`]],
  ]) {
    await t.test(cas, () => {
      rouge(verifier(description([...lignes, ...verifications([a.id])])), `${cas} : la PR passe sans les vérifications de ${e.id}`);
    });
  }
});

test("#60 · un exemple en bloc de code, quelle que soit sa clôture, n'est pas la déclaration de la PR", async (t) => {
  const [e] = SIMPLES;
  assert.ok(e, `aucune entrée qui demande une vérification sans renvoi : ${RELIRE}`);
  const section = ['## Invariants et contraintes', '', 'Touchés : aucun', 'Lien possible masqué : aucun'];
  const formes = [
    ['entre tildes', ['~~~markdown', ...section, '~~~']],
    ['entre quatre accents graves', ['````markdown', ...section, '````']],
    ['renfoncé de quatre espaces', section.map((l) => (l ? `    ${l}` : l))],
  ];

  // L'exemple ne change rien au verdict : témoin sans lui, piège avec.
  rouge(verifier(ENTETE.join('\n')), 'témoin : aucune section');
  rouge(verifier(description([`Touchés : ${e.id}`, 'Lien possible masqué : aucun'])), `témoin : ${e.id} déclaré sans ses vérifications`);

  for (const [forme, bloc] of formes) {
    const exemple = ['Le modèle se remplit ainsi :', '', ...bloc, ''];
    await t.test(`${forme} : l'exemple seul`, () => {
      rouge(verifier([...ENTETE, ...exemple].join('\n')), `un exemple ${forme}, sans section de la PR : la PR passe sans déclaration`);
    });
    await t.test(`${forme} : l'exemple avant la section qui déclare ${e.id}`, () => {
      rouge(
        verifier(description([`Touchés : ${e.id}`, 'Lien possible masqué : aucun'], { avant: exemple })),
        `un exemple ${forme} avant la section qui déclare ${e.id} : la PR passe sans ses vérifications`,
      );
    });
  }
});
