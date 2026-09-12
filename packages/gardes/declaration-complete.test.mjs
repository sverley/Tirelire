/**
 * Harnais d'audit de #60 : une déclaration se lit jusqu'au bout, et chacune de ses deux lignes est remplie.
 *
 * Complète `declaration-lue.test.mjs`, de la même session d'audit, sans en reprendre les cas. Celui-là
 * poursuit une déclaration qui finit par une virgule ; les documents du projet se coupent aussi après
 * un mot, et la suite peut être renfoncée. GitHub affiche la suite sous la ligne : qui relit la PR voit
 * l'entrée déclarée. Lire la suite ou la refuser : le harnais n'impose ni l'une ni l'autre, pourvu que
 * la PR ne passe pas au vert sans les vérifications de l'entrée citée, et que la vérification la nomme.
 *
 * Il garde aussi ce qui tient déjà, et qu'une lecture plus large des lignes pourrait casser : « aucun »
 * reste « explicite : jamais un oubli » (#60). Une ligne « Touchés : » ou « Lien possible masqué : »
 * absente, vide ou laissée « à analyser », l'autre valant « aucun », garde la PR rouge en se nommant.
 *
 * Boîte noire : `node packages/gardes/cli.mjs pr --corps-fichier …` sur le dépôt tel quel, sans base,
 * donc sans plancher de chemins ni retrait. Les entrées se cherchent dans le registre du jour, par son
 * format ; chaque piège a son témoin, la même déclaration écrite sur une ligne.
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

const dossier = mkdtempSync(join(tmpdir(), 'tirelire-declaration-complete-'));
after(() => rmSync(dossier, { recursive: true, force: true }));

let numero = 0;
/** La vérification d'une description, hors GitHub : une case cochée y compte comme validée. */
function verifier(corps) {
  const fichier = join(dossier, `corps-${++numero}.md`);
  writeFileSync(fichier, corps);
  const r = spawnSync(process.execPath, [CLI, 'pr', '--corps-fichier', fichier], { cwd: DEPOT, env: ENV, encoding: 'utf8' });
  return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const echapper = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Un nom apparaît pour lui-même : `U1` ne se lit ni dans `U11` ni dans `VM-U1-…`. */
const apparait = (sortie, nom) => new RegExp(`(?<![\\w-])${echapper(nom)}(?![\\w])`).test(sortie);

const rouge = (r, cas) => assert.equal(r.code, 1, `attendu rouge : ${cas}\n${r.sortie}`);
const vert = (r, cas) => assert.equal(r.code, 0, `attendu vert : ${cas}\n${r.sortie}`);
function rougeEtNomme(r, candidats, cas) {
  rouge(r, cas);
  assert.ok(candidats.some((nom) => apparait(r.sortie, nom)), `rouge sans nommer ce qui manque (l'un de : ${candidats.join(', ')}) : ${cas}\n${r.sortie}`);
}

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
const description = (section) => [...ENTETE, '## Invariants et contraintes', '', ...section, ''].join('\n');

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

// ─── Cas ─────────────────────────────────────────────────────────────────────────────────────
// Chaque cas est un sous-test : un cas rouge ne cache pas les suivants.

test('#60 · une déclaration coupée après un mot, et non après une virgule, ne perd pas sa suite en silence', async (t) => {
  const [a, e] = SIMPLES;
  assert.ok(a && e, `moins de deux entrées qui demandent une vérification sans renvoi : ${RELIRE}`);
  for (const { nom, uneLigne, coupee } of [
    {
      nom: `« Touchés : ${a.id} et » puis « ${e.id} » à la ligne`,
      uneLigne: [`Touchés : ${a.id} et ${e.id}`, 'Lien possible masqué : aucun'],
      coupee: [`Touchés : ${a.id} et`, e.id, 'Lien possible masqué : aucun'],
    },
    {
      nom: `« Lien possible masqué : ${a.id}, … et » puis « ${e.id}, … » renfoncé à la ligne`,
      uneLigne: ['Touchés : aucun', `Lien possible masqué : ${a.id}, dont la note reprend le vocabulaire, et ${e.id}, pour la même raison`],
      coupee: ['Touchés : aucun', `Lien possible masqué : ${a.id}, dont la note reprend le vocabulaire, et`, `  ${e.id}, pour la même raison`],
    },
  ]) {
    vert(verifier(description([...uneLigne, ...verifications([a.id, e.id])])), `témoin de ${nom} : sur une ligne, vérifications de ${a.id} et ${e.id} validées`);
    rouge(verifier(description([...uneLigne, ...verifications([a.id])])), `témoin de ${nom} : sur une ligne, sans les vérifications de ${e.id}`);
    await t.test(nom, () => {
      rougeEtNomme(
        verifier(description([...coupee, ...verifications([a.id])])),
        [e.id, ...e.vms],
        `${nom} : la PR passe sans les vérifications de ${e.id}`,
      );
    });
  }
});

test("#60 · « aucun » s'écrit sur chaque ligne : absente, vide ou laissée « à analyser », elle garde la PR rouge en se nommant", async (t) => {
  vert(verifier(description(['Touchés : aucun', 'Lien possible masqué : aucun'])), 'témoin : « aucun » explicite sur les deux lignes');
  for (const [etiquette, autre] of [['Touchés', 'Lien possible masqué'], ['Lien possible masqué', 'Touchés']]) {
    for (const [cas, lignes] of [
      ['absente', [`${autre} : aucun`]],
      ['vide', [`${etiquette} :`, `${autre} : aucun`]],
      ['laissée « à analyser »', [`${etiquette} : à analyser`, `${autre} : aucun`]],
    ]) {
      await t.test(`« ${etiquette} : » ${cas}, « ${autre} : aucun »`, () => {
        rougeEtNomme(verifier(description(lignes)), [etiquette], `la ligne « ${etiquette} : » est ${cas} et la PR passe`);
      });
    }
  }
});
