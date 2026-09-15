/**
 * Harnais d'audit de #60 : chaque vérification demandée reprend sa consigne du registre, mot pour mot.
 *
 * Tranché par le porteur le 11 septembre, dans #60 : la vérification listée dans la PR recopie la
 * consigne que `docs/gardes.md` donne pour elle, comme `demander` l'écrit déjà ; absente ou
 * différente, la vérification est rouge. « Explicite vaut mieux qu'implicite » : qui valide depuis
 * la PR doit lire ce qu'il a à faire sans ouvrir le registre.
 *
 * Boîte noire, dans le style de `declaration-lue.test.mjs` : `cli.mjs pr --corps-fichier` sur le dépôt
 * tel quel, chaque piège avec son témoin. La consigne se lit au registre du jour, par son format :
 * ce qui suit le tiret cadratin de la ligne `Vérification manuelle`, suite renfoncée comprise, les
 * morceaux joints d'une espace. Ce qui précède le tiret (« · I9 », « · essai ») reste libre.
 *
 * Attendu : rouge en nommant la vérification dont la consigne manque ou diffère.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

const dossier = mkdtempSync(join(tmpdir(), 'tirelire-declaration-consigne-'));
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

const ENTETE = ["Pour #… : essai du harnais d'audit de #60 (consigne recopiée).", '', '## Ce qui change', '', 'Essai.', ''];

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

const echapper = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Un nom apparaît pour lui-même : `VM-U1-parcours` ne se lit pas dans `VM-U1-parcours-bis`. */
const apparait = (sortie, nom) => new RegExp(`(?<![\\w-])${echapper(nom)}(?![\\w-])`).test(sortie);
function rougeEtNomme(r, nom, cas) {
  rouge(r, cas);
  assert.ok(apparait(r.sortie, nom), `rouge sans nommer ${nom} : ${cas}\n${r.sortie}`);
}

/** Une vérification listée, analysée et validée ; `suite` suit « · essai » sur la ligne de tête. */
const listee = (cle, suite) => [`- \`${cle}\` · essai${suite}`, `  - Analyse (audit, 2026-09-11) : ${ANALYSE}`, '  - [x] Validée par un développeur humain'];
const sectionDe = (e, lignesVm) => description([`Touchés : ${e.id}`, 'Lien possible masqué : aucun', '', '### Vérifications manuelles', '', ...lignesVm]);

/** De préférence une entrée dont la consigne porte du code entre accents graves : la recopie ne doit pas le perdre. */
const E = SIMPLES.find((e) => e.vms.some((cle) => consigneDu(cle).includes('`'))) ?? SIMPLES[0];

// ─── Pièges ──────────────────────────────────────────────────────────────────────────────────
// Chaque piège est un sous-test : un cas rouge ne cache pas les suivants.

test('#60 · une vérification demandée sans sa consigne du registre, ou avec une autre, ne passe pas', async (t) => {
  assert.ok(E, `aucune entrée qui demande une vérification sans renvoi : ${RELIRE}`);
  const [cle, ...autres] = E.vms;
  const consigne = consigneDu(cle);
  const mots = consigne.split(' ');
  assert.ok(mots.length >= 6, `consigne de ${cle} introuvable ou trop courte au registre (« ${consigne} ») : ${RELIRE}`);
  const autre = [...ENTREES.values()].flatMap((x) => x.vms).find((k) => k !== cle && consigneDu(k) && consigneDu(k) !== consigne);
  assert.ok(autre, `aucune autre vérification au registre : ${RELIRE}`);
  const reste = autres.flatMap((k) => listee(k, ` — ${consigneDu(k)}`));
  const avec = (suite) => verifier(sectionDe(E, [...listee(cle, suite), ...reste]));
  const milieu = Math.floor(mots.length / 2);

  vert(avec(` — ${consigne}`), `témoin : ${cle} listée avec sa consigne du registre, analysée et validée`);
  rouge(verifier(description([`Touchés : ${E.id}`, 'Lien possible masqué : aucun'])), `témoin : ${E.id} déclaré sans ses vérifications`);

  for (const [cas, suite] of [
    ['la clé seule, comme la PR #63 aujourd’hui', ''],
    ['un résumé à la place de la consigne', ` — ${cle.replace(/^VM-[IUC]\d+-/, '').replace(/-/g, ' ')}`],
    ['la consigne tronquée de moitié', ` — ${mots.slice(0, milieu).join(' ')}`],
    ['la consigne privée d’un mot', ` — ${[...mots.slice(0, milieu), ...mots.slice(milieu + 1)].join(' ')}`],
    [`la consigne d’une autre vérification (${autre})`, ` — ${consigneDu(autre)}`],
    ['la consigne cachée dans un commentaire HTML', ` — <!-- ${consigne} -->`],
  ]) {
    await t.test(cas, () => {
      rougeEtNomme(avec(suite), cle, `${cle} listée avec ${cas} : la PR passe sans que la consigne du registre y soit lisible`);
    });
  }
});

test('#60 · la section que prépare « demander » recopie la consigne, et passe une fois analysée et validée', () => {
  assert.ok(E, `aucune entrée qui demande une vérification sans renvoi : ${RELIRE}`);
  const r = spawnSync(process.execPath, [CLI, 'demander', '--ids', E.id, '--base', 'HEAD'], { cwd: DEPOT, env: ENV, encoding: 'utf8' });
  assert.equal(r.status, 0, `« demander » échoue :\n${r.stdout}${r.stderr}`);
  const lignes = r.stdout.split('\n');
  const blocs = E.vms.flatMap((cle) => {
    const i = lignes.findIndex((l) => l.startsWith(`- \`${cle}\``));
    assert.ok(i >= 0, `« demander » ne liste pas ${cle} :\n${r.stdout}`);
    assert.ok(lignes[i].endsWith(` — ${consigneDu(cle)}`), `« demander » ne recopie pas la consigne de ${cle} :\n${lignes[i]}`);
    return lignes.slice(i, i + 3).map((l) => l.replace(/:\s*à écrire$/, `: ${ANALYSE}`).replace('[ ] Validée', '[x] Validée'));
  });
  vert(verifier(sectionDe(E, blocs)), `les vérifications de ${E.id} telles que « demander » les écrit, analysées et validées`);
});
