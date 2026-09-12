/**
 * Harnais d'audit de #60 : ce que la description déclare, la vérification le lit.
 *
 * #60 : la vérification échoue « quand la PR ne fait pas cette déclaration, ou quand elle cite une
 * entrée sans demander sa vérification manuelle » ; « aucun » reste possible, « mais explicite :
 * jamais un oubli ». La description se lit sur GitHub, souvent sur téléphone : ce que le lecteur y
 * voit déclaré doit être ce que la vérification juge.
 *
 * Boîte noire, comme l'amorçage : `node packages/gardes/cli.mjs pr --corps-fichier …` sur le dépôt tel
 * quel, sans base, donc sans plancher de chemins ni retrait. Les entrées se cherchent dans le registre
 * du jour, par son format. Chaque piège a son témoin, la même déclaration écrite de la façon que la
 * vérification lit déjà : le témoin fixe le verdict attendu, le piège ne doit pas être vert tant
 * qu'une vérification déclarée manque. Lire la forme ou la refuser : le harnais n'impose ni l'une ni
 * l'autre.
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

const dossier = mkdtempSync(join(tmpdir(), 'tirelire-declaration-'));
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

const ENTETE = ["Pour #… : essai du harnais d'audit de #60.", '', '## Ce qui change', '', 'Essai.', ''];

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

test("#60 · une plage d'identifiants déclare chacun de ceux qu'elle couvre", async (t) => {
  let plage;
  for (const e of SIMPLES) {
    const suivants = [1, 2].map((d) => ENTREES.get(`${e.id[0]}${Number(e.id.slice(1)) + d}`));
    if (suivants.every((s) => s && s.vms.length && !s.renvoie)) {
      plage = [e.id, ...suivants.map((s) => s.id)];
      break;
    }
  }
  assert.ok(plage, `aucune suite de trois entrées qui demandent chacune une vérification : ${RELIRE}`);
  const [debut, milieu, fin] = plage;
  const section = (touches, ids) => description([`Touchés : ${touches}`, 'Lien possible masqué : aucun', ...verifications(ids)]);

  vert(verifier(section(plage.join(', '), plage)), `témoin : ${plage.join(', ')} énumérés, toutes leurs vérifications validées`);
  rouge(verifier(section(plage.join(', '), [debut, fin])), `témoin : ${plage.join(', ')} énumérés, sans les vérifications de ${milieu}`);
  for (const forme of [`${debut} à ${fin}`, `${debut}–${fin}`, `${debut}-${fin}`]) {
    await t.test(`« Touchés : ${forme} »`, () => {
      rouge(verifier(section(forme, [debut, fin])), `« Touchés : ${forme} » passe sans les vérifications de ${milieu}`);
    });
  }
});

test('#60 · une seconde ligne « Touchés : » ou « Lien possible masqué : », ou une seconde section, ne passe pas en silence', async (t) => {
  const [e] = SIMPLES;
  assert.ok(e, `aucune entrée qui demande une vérification sans renvoi : ${RELIRE}`);

  vert(verifier(description(['Touchés : aucun', 'Lien possible masqué : aucun'])), 'témoin : « aucun » explicite, rien à vérifier');
  rouge(verifier(description([`Touchés : ${e.id}`, 'Lien possible masqué : aucun'])), `témoin : ${e.id} déclaré sans ses vérifications`);
  vert(verifier(description([`Touchés : ${e.id}`, 'Lien possible masqué : aucun', ...verifications([e.id])])), `témoin : ${e.id} déclaré, vérifications validées`);

  for (const [cas, section] of [
    ['une seconde ligne « Touchés : »', ['Touchés : aucun', 'Lien possible masqué : aucun', `Touchés : ${e.id}`]],
    ['une seconde ligne « Lien possible masqué : »', ['Touchés : aucun', 'Lien possible masqué : aucun', `Lien possible masqué : ${e.id}`]],
    ['une seconde section', ['Touchés : aucun', 'Lien possible masqué : aucun', '', '## Invariants et contraintes', '', `Touchés : ${e.id}`, 'Lien possible masqué : aucun']],
  ]) {
    await t.test(cas, () => {
      rouge(verifier(description(section)), `${cas} déclare ${e.id}, et la PR passe sans ses vérifications`);
    });
  }
});

test('#60 · une déclaration poursuivie à la ligne ne perd pas sa suite en silence', async (t) => {
  const [a, e] = SIMPLES;
  assert.ok(a && e, `moins de deux entrées qui demandent une vérification sans renvoi : ${RELIRE}`);
  const section = (lignes, ids) => description([...lignes, 'Lien possible masqué : aucun', ...verifications(ids)]);

  vert(verifier(section([`Touchés : ${a.id}, ${e.id}`], [a.id, e.id])), `témoin : ${a.id}, ${e.id} sur une ligne, vérifications validées`);
  rouge(verifier(section([`Touchés : ${a.id}, ${e.id}`], [a.id])), `témoin : ${a.id}, ${e.id} sur une ligne, sans les vérifications de ${e.id}`);
  // GitHub affiche la seconde ligne sous la première : le lecteur voit les deux déclarées.
  await t.test(`« Touchés : ${a.id}, » puis « ${e.id} » à la ligne`, () => {
    rouge(verifier(section([`Touchés : ${a.id},`, e.id], [a.id])), `« Touchés : ${a.id}, » poursuivi par « ${e.id} » : la PR passe sans les vérifications de ${e.id}`);
  });
});

test("#60 · une section citée en exemple dans un bloc de code n'est pas la déclaration de la PR", async (t) => {
  const [e] = SIMPLES;
  assert.ok(e, `aucune entrée qui demande une vérification sans renvoi : ${RELIRE}`);
  const exemple = ['Le modèle se remplit ainsi :', '', '```markdown', '## Invariants et contraintes', '', 'Touchés : aucun', 'Lien possible masqué : aucun', '```', ''];

  // L'exemple ne change rien au verdict : témoin sans lui, piège avec.
  rouge(verifier(ENTETE.join('\n')), 'témoin : aucune section');
  rouge(verifier(description([`Touchés : ${e.id}`, 'Lien possible masqué : aucun'])), `témoin : ${e.id} déclaré sans ses vérifications`);
  await t.test("l'exemple seul, sans section de la PR", () => {
    rouge(verifier([...ENTETE, ...exemple].join('\n')), 'un exemple en bloc de code, sans section de la PR : la PR passe sans déclaration');
  });
  await t.test(`l'exemple avant la section qui déclare ${e.id}`, () => {
    rouge(
      verifier(description([`Touchés : ${e.id}`, 'Lien possible masqué : aucun'], { avant: exemple })),
      `un exemple en bloc de code avant la section qui déclare ${e.id} : la PR passe sans ses vérifications`,
    );
  });
});
