/**
 * Harnais de I9 — « Plusieurs distributions » (docs/gardes.md) — et de #153.
 *
 * Ce que le registre lui demande de garder : sur chaque PR, le web et le site d'hébergement se
 * construisent ; l'APK Android ne se construit qu'à un tag `v*`, jamais sur une PR. La ligne
 * `Harnais` de I9 citait `.github/workflows/ci.yml`, qui ne peut pas accueillir de test : ce fichier
 * lit le workflow et tient les assertions à côté (question posée dans #69, tranchée dans la PR #77).
 *
 * Le site s'assemble dans un job ou un autre selon l'événement (la racine sur `main`, le
 * sous-dossier de l'aperçu sur une PR, #141) : chercher « le » job qui l'assemble ne suffit plus.
 * Le workflow est donc joué à blanc, événement par événement : quels jobs et quelles étapes passent
 * leur condition (`if`, `needs`), et combien de fois le site s'assemble (#153). Seule hypothèse sur
 * l'exécution : sans variables de recette, une étape qui lance `apercu.sh` échoue (il « arrête
 * tout », ce que `apps/hebergement/apercu.test.mjs` vérifie) et arrête son job.
 *
 * L'échec attendu d'un témoin rouge tient dans une assertion : `node:test` n'a pas de `test.fails`
 * (docs/gardes.md, #66).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { RACINE } from './gardes.mjs';

const CI = '.github/workflows/ci.yml';
const ARCHIVE = 'tirelire-hebergement';

const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');

// ─── Lecture du workflow ─────────────────────────────────────────────────────────────────────────

/** Les jobs : nom → { début (ligne de l'en-tête), lignes }. `jobs:` est la dernière clé de premier niveau. */
function jobs(yaml) {
  const lignes = yaml.split('\n');
  const début = lignes.findIndex((l) => /^jobs:\s*$/.test(l));
  assert.ok(début >= 0, `${CI} : aucune section \`jobs:\``);
  const blocs = new Map();
  let courant;
  for (let i = début + 1; i < lignes.length; i += 1) {
    const m = lignes[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (m) blocs.set((courant = m[1]), { nom: courant, début: i, lignes: [] });
    else if (courant) blocs.get(courant).lignes.push(lignes[i]);
  }
  return blocs;
}

const CLÉ_ÉTAPE = (clé) => new RegExp(`^(?: {6}- | {8})${clé}:`);

/** Valeur d'une clé : sur sa ligne, ou repliée sur les lignes plus indentées qui suivent (`>-`, `|`). */
function scalaire(lignes, motif) {
  const i = lignes.findIndex((l) => motif.test(l));
  if (i < 0) return '';
  const brut = lignes[i].replace(motif, '').trim();
  if (!/^[>|][-+]?$/.test(brut)) return brut;
  const colonne = lignes[i].search(/\S/) + (/^\s*- /.test(lignes[i]) ? 2 : 0);
  const suite = [];
  for (const l of lignes.slice(i + 1)) {
    if (l.trim() && l.search(/\S/) <= colonne) break;
    suite.push(l.trim());
  }
  return suite.join(' ');
}

/** Une condition, sans guillemets ni `${{ }}`. */
const expression = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2').replace(/^\$\{\{([\s\S]*)\}\}$/, '$1').trim();

function besoins(lignes) {
  const i = lignes.findIndex((l) => /^ {4}needs:/.test(l));
  if (i < 0) return [];
  const v = lignes[i].replace(/^ {4}needs:/, '').trim();
  if (v) return v.replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  const liste = [];
  for (const l of lignes.slice(i + 1)) {
    const m = l.match(/^ {6}- \s*(\S+)/);
    if (!m) break;
    liste.push(m[1]);
  }
  return liste;
}

/** Les étapes d'un job, sans les commentaires ; `k` : indice de leur première ligne dans le job. */
function étapes(lignes) {
  const début = lignes.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  if (début < 0) return [];
  const liste = [];
  for (let k = début + 1; k < lignes.length; k += 1) {
    const l = lignes[k];
    if (/^ {0,4}\S/.test(l)) break;
    if (/^ {6}- /.test(l)) liste.push({ k, lignes: [l] });
    else if (liste.length && l.trim() && !l.trim().startsWith('#')) liste.at(-1).lignes.push(l);
  }
  return liste.map((é) => ({ ...é, texte: é.lignes.join('\n') }));
}

/** Ce que l'étape exécute : tout sauf son nom affiché. */
const commande = (é) => é.lignes.filter((l) => !CLÉ_ÉTAPE('name').test(l)).join('\n');
const assemble = (é) => /hebergement\b.*\bassembler\b|assembler\.mjs/.test(commande(é));
const artefact = (é, sens) =>
  new RegExp(`uses:\\s*actions/${sens}-artifact@`).test(é.texte) ? é.texte.match(/^ {10}name:\s*(\S+)/m)?.[1] : undefined;

// ─── Les expressions de GitHub Actions, le sous-ensemble utile ───────────────────────────────────

function jetons(source) {
  const motif = /\s*(?:'((?:[^']|'')*)'|(\d+(?:\.\d+)?)\b|(==|!=|&&|\|\||<=|>=|[!()<>,])|([A-Za-z_][\w.-]*))/y;
  const liste = [];
  let m;
  while (motif.lastIndex < source.length && (m = motif.exec(source))) {
    if (m[1] !== undefined) liste.push({ t: 'v', v: m[1].replace(/''/g, "'") });
    else if (m[2] !== undefined) liste.push({ t: 'v', v: Number(m[2]) });
    else if (m[3] !== undefined) liste.push({ t: m[3] });
    else liste.push({ t: 'nom', v: m[4] });
  }
  assert.ok(m && motif.lastIndex === source.length, `${CI} : condition illisible par le harnais : ${source}`);
  return liste;
}

const vrai = (x) => !(x === false || x === null || x === undefined || x === 0 || x === '' || Number.isNaN(x));
const nombre = (x) =>
  x == null ? 0 : typeof x === 'boolean' ? Number(x) : typeof x === 'number' ? x : typeof x === 'string' ? (x.trim() ? Number(x) : 0) : NaN;
function égal(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (typeof a === typeof b && a !== null && b !== null) return a === b;
  return nombre(a) === nombre(b);
}
const STATUT = /\b(always|success|failure|cancelled)\s*\(/;

function évaluer(source, ctx, échec = false) {
  const j = jetons(source.trim());
  let i = 0;
  const voit = (t) => j[i]?.t === t;
  const prend = (t) => {
    assert.ok(voit(t), `${CI} : « ${t} » attendu dans la condition ${source}`);
    i += 1;
  };
  const ou = () => {
    let a = et();
    while (voit('||')) (i += 1), (a = ((b) => (vrai(a) ? a : b))(et()));
    return a;
  };
  const et = () => {
    let a = comparaison();
    while (voit('&&')) (i += 1), (a = ((b) => (vrai(a) ? b : a))(comparaison()));
    return a;
  };
  const comparaison = () => {
    let a = unaire();
    while (['==', '!=', '<', '>', '<=', '>='].some(voit)) {
      const op = j[i++].t;
      const b = unaire();
      a = op === '==' ? égal(a, b) : op === '!=' ? !égal(a, b) : { '<': nombre(a) < nombre(b), '>': nombre(a) > nombre(b), '<=': nombre(a) <= nombre(b), '>=': nombre(a) >= nombre(b) }[op];
    }
    return a;
  };
  const unaire = () => (voit('!') ? ((i += 1), !vrai(unaire())) : primaire());
  const primaire = () => {
    const x = j[i++];
    assert.ok(x, `${CI} : condition incomplète : ${source}`);
    if (x.t === 'v') return x.v;
    if (x.t === '(') {
      const v = ou();
      prend(')');
      return v;
    }
    assert.equal(x.t, 'nom', `${CI} : condition illisible par le harnais : ${source}`);
    if (voit('(')) {
      i += 1;
      const args = [];
      while (!voit(')')) {
        args.push(ou());
        if (voit(',')) i += 1;
      }
      prend(')');
      const [a, b] = args.map((v) => (v == null ? '' : v));
      const f = {
        always: () => true,
        success: () => !échec,
        failure: () => échec,
        cancelled: () => false,
        startsWith: () => String(a).toLowerCase().startsWith(String(b).toLowerCase()),
        endsWith: () => String(a).toLowerCase().endsWith(String(b).toLowerCase()),
        contains: () => (Array.isArray(a) ? a.some((v) => égal(v, b)) : String(a).toLowerCase().includes(String(b).toLowerCase())),
      }[x.v];
      assert.ok(f, `${CI} : fonction « ${x.v} » inconnue du harnais`);
      return f();
    }
    if (['true', 'false', 'null'].includes(x.v)) return JSON.parse(x.v);
    return x.v.split('.').reduce((o, k) => (o == null ? null : (o[k] ?? null)), ctx);
  };
  const v = ou();
  assert.equal(i, j.length, `${CI} : condition illisible par le harnais : ${source}`);
  return v;
}

const interpoler = (v, ctx) =>
  v
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .replace(/\$\{\{([\s\S]*?)\}\}/g, (_, e) => {
      const x = évaluer(e, ctx);
      return x == null ? '' : String(x);
    });

// ─── Le workflow joué à blanc ────────────────────────────────────────────────────────────────────

/** Les jobs qui tournent pour cet événement, et leurs étapes jouées. `échoue(étape)` : l'étape échoue. */
function jouer(yaml, ctx, échoue = () => false) {
  const blocs = jobs(yaml);
  const états = new Map();
  const état = (nom, pile = new Set()) => {
    if (états.has(nom)) return états.get(nom);
    assert.ok(blocs.has(nom), `${CI} : le job « ${nom} », attendu par un \`needs\`, n'existe pas`);
    assert.ok(!pile.has(nom), `${CI} : dépendance circulaire autour du job « ${nom} »`);
    pile.add(nom);
    const { lignes } = blocs.get(nom);
    const amont = besoins(lignes).map((n) => état(n, pile));
    const si = expression(scalaire(lignes, /^ {4}if:/));
    const amontOk = amont.every((a) => a.réussi);
    const amontÉchec = amont.some((a) => a.tourne && !a.réussi);
    const tourne = !si ? amontOk : STATUT.test(si) ? vrai(évaluer(si, ctx, amontÉchec)) : amontOk && vrai(évaluer(si, ctx));
    const joués = [];
    let échec = false;
    for (const é of tourne ? étapes(lignes) : []) {
      const c = expression(scalaire(é.lignes, CLÉ_ÉTAPE('if')));
      const passe = !c ? !échec : STATUT.test(c) ? vrai(évaluer(c, ctx, échec)) : !échec && vrai(évaluer(c, ctx));
      if (!passe) continue;
      joués.push(é);
      if (échoue(é) && !/^ +(?:- )?continue-on-error:\s*true/m.test(é.texte)) échec = true;
    }
    const r = { ...blocs.get(nom), besoins: amont.map((a) => a.nom), tourne, réussi: tourne && !échec, joués };
    états.set(nom, r);
    return r;
  };
  return [...blocs.keys()].map((n) => état(n));
}

const assemblages = (partie) => partie.flatMap((job) => job.joués.filter(assemble).map((étape) => ({ job, étape })));
const liste = (a) => a.map(({ job }) => `« ${job.nom} »`).join(', ') || 'aucun job';

const NUMÉRO = 153;
const ACTIONS_PR = ['opened', 'synchronize', 'reopened', 'ready_for_review'];
const RECETTE = { TIRELIRE_DEV_FTP_DOSSIER: 'recette', TIRELIRE_DEV_SITE_URL: 'https://recette.example' };
const pr = (action, recette) => ({
  github: {
    event_name: 'pull_request',
    ref: `refs/pull/${NUMÉRO}/merge`,
    event: { action, pull_request: { number: NUMÉRO, draft: false, head: { sha: 'a'.repeat(40) } } },
  },
  vars: recette ? { ...RECETTE } : {},
  secrets: {},
  inputs: {},
});
const push = (ref, vars = {}) => ({ github: { event_name: 'push', ref, event: {} }, vars, secrets: {}, inputs: {} });
/** Sans variables de recette, `apercu.sh` arrête tout (#141). */
const sansRecette = (é) => /apercu\.sh/.test(commande(é));
const scénariosPR = () =>
  ACTIONS_PR.flatMap((action) => [
    { action, recette: true, nom: `${action}, recette présente`, échoue: () => false },
    { action, recette: false, nom: `${action}, variables de recette absentes`, échoue: sansRecette },
  ]);

// ─── I9 ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Ce que I9 demande au workflow. Écrit à part de sa source pour être rejoué tel quel sur un
 * workflow volontairement cassé : c'est le témoin rouge, plus bas.
 */
function distributionsSurChaquePR(yaml) {
  const entête = yaml.split('\njobs:')[0];
  assert.match(entête, /^ {2}pull_request:\s*$/m, `${CI} : le workflow ne se déclenche pas sur les PR`);
  for (const s of scénariosPR()) {
    const partie = jouer(yaml, pr(s.action, s.recette), s.échoue);
    const joué = (motif) => partie.filter((job) => job.joués.some((é) => motif.test(commande(é))));
    assert.ok(joué(/\bpnpm\s+(?:-r\s+)?build\b/).length, `${CI} : le workflow ne construit pas le web sur une PR (${s.nom})`);
    assert.ok(assemblages(partie).length, `${CI} : le workflow n'assemble pas le site sur une PR (${s.nom})`);
    for (const job of joué(/assembleRelease/)) assert.fail(`${CI} : le job « ${job.nom} » construirait l'APK sur une PR (${s.nom}), avant toute fusion`);
  }
}

test("I9 · sur chaque PR, le web et le site d'hébergement se construisent ; l'APK attend la fusion", () => {
  distributionsSurChaquePR(lire(CI));
});

/** Réécrit les jobs choisis : `changer(job) → nouvelles lignes`, ou `undefined` pour le laisser. */
function réécrire(yaml, changer) {
  const lignes = yaml.split('\n');
  for (const job of [...jobs(yaml).values()].reverse()) {
    const nouvelles = changer(job);
    if (nouvelles) lignes.splice(job.début + 1, job.lignes.length, ...nouvelles);
  }
  return lignes.join('\n');
}

/** Les lignes d'un job, sans sa condition (repliée comprise). */
function sansCondition(lignes) {
  const i = lignes.findIndex((l) => /^ {4}if:/.test(l));
  if (i < 0) return lignes;
  let fin = i + 1;
  while (fin < lignes.length && (!lignes[fin].trim() || lignes[fin].search(/\S/) > 4)) fin += 1;
  return [...lignes.slice(0, i), ...lignes.slice(fin)];
}

/** Le workflow volontairement cassé : l'APK se construit sur les PR, le site d'hébergement non. */
const ciCassé = (yaml) =>
  réécrire(yaml, (job) => {
    const é = étapes(job.lignes);
    if (é.some((x) => /assembleRelease/.test(commande(x)))) return sansCondition(job.lignes);
    if (é.some(assemble)) return ["    if: github.event_name != 'pull_request'", ...sansCondition(job.lignes)];
    return undefined;
  });

test("témoin rouge · une CI qui construit l'APK sur chaque PR et le site d'hébergement seulement après fusion", () => {
  const cassé = ciCassé(lire(CI));
  assert.notEqual(cassé, lire(CI), 'le workflow n’a pas pu être cassé : le harnais de I9 est à relire');
  assert.throws(() => distributionsSurChaquePR(cassé), /n'assemble pas le site sur une PR|construirait l'APK sur une PR/);
});

/** Une étape lançant `apercu.sh reglages` insérée devant chaque assemblage joué sur une PR. */
function ciQuiAttendLaRecette(yaml) {
  const visés = new Map();
  for (const { job, étape } of assemblages(jouer(yaml, pr('synchronize', true)))) visés.set(job.nom, [...(visés.get(job.nom) ?? []), étape.k]);
  return réécrire(yaml, (job) => {
    const ks = visés.get(job.nom);
    if (!ks) return undefined;
    const l = [...job.lignes];
    for (const k of [...ks].reverse()) l.splice(k, 0, '      - run: bash apps/hebergement/apercu.sh reglages');
    return l;
  });
}

test("témoin rouge · une CI dont l'assemblage sur une PR attend les réglages de la recette", () => {
  const cassé = ciQuiAttendLaRecette(lire(CI));
  assert.notEqual(cassé, lire(CI), 'le workflow n’a pas pu être cassé : le harnais de I9 est à relire');
  assert.throws(() => distributionsSurChaquePR(cassé), /n'assemble pas le site sur une PR \([a-z_]+, variables de recette absentes\)/);
});

// ─── #153 · un seul assemblage par passage ───────────────────────────────────────────────────────

/** Ce que #153 demande sur une PR prête, rejoué aussi sur un workflow cassé. */
function unSeulAssemblageSurPR(yaml) {
  for (const s of scénariosPR()) {
    const a = assemblages(jouer(yaml, pr(s.action, s.recette), s.échoue));
    assert.equal(
      a.length,
      1,
      `${CI} : sur une PR prête (${s.nom}), le site d'hébergement s'assemble ${a.length} fois (${liste(a)}) ; une seule attendue (#153)`,
    );
  }
}

test("#153 · sur une PR prête, le site d'hébergement ne s'assemble qu'une fois par passage", () => {
  unSeulAssemblageSurPR(lire(CI));
});

/** L'étape d'assemblage jouée sur une PR, dupliquée juste après elle. */
const ciQuiAssembleDeuxFois = (yaml) => {
  const [{ job: cible, étape }] = assemblages(jouer(yaml, pr('synchronize', true)));
  return réécrire(yaml, (job) => (job.nom === cible.nom ? [...job.lignes.slice(0, étape.k), ...étape.lignes, ...job.lignes.slice(étape.k)] : undefined));
};

test('témoin rouge · une CI qui assemble deux fois le site sur une PR prête', () => {
  const cassé = ciQuiAssembleDeuxFois(lire(CI));
  assert.notEqual(cassé, lire(CI), 'le workflow n’a pas pu être cassé : le harnais de #153 est à relire');
  assert.throws(() => unSeulAssemblageSurPR(cassé), /s'assemble [2-9] fois/);
});

/** Sur `main` et au tag : le site pour la racine s'assemble, se garde, se dépose et se publie. */
function amonts(partie, nom, vus = new Set()) {
  for (const n of partie.find((j) => j.nom === nom)?.besoins ?? []) if (!vus.has(n)) vus.add(n), amonts(partie, n, vus);
  return vus;
}

test('#153 · sur main et au tag v*, le site pour la racine se construit, se dépose et se publie comme avant', () => {
  const cas = [
    ['main', 'refs/heads/main', /deposer\.sh/, 'dépose'],
    ['tag v*', 'refs/tags/v9.9.9', /action-gh-release/, 'publie'],
  ];
  for (const [où, ref, aval, verbe] of cas) {
    for (const base of [undefined, '/sous-dossier/']) {
      const ctx = push(ref, base ? { TIRELIRE_BASE: base } : {});
      const partie = jouer(lire(CI), ctx);
      const a = assemblages(partie);
      assert.equal(a.length, 1, `${CI} : sur ${où}, le site s'assemble ${a.length} fois (${liste(a)}) ; une seule attendue`);
      const [{ job, étape }] = a;
      const env = étape.texte.match(/^ +TIRELIRE_BASE:\s*(.+)$/m) ?? job.lignes.slice(0, job.lignes.findIndex((l) => /^ {4}steps:/.test(l))).join('\n').match(/^ +TIRELIRE_BASE:\s*(.+)$/m);
      const obtenue = env ? interpoler(env[1], ctx) || '/' : '/';
      assert.equal(obtenue, base ?? '/', `${CI} : sur ${où}, le site ne s'assemble plus pour \`vars.TIRELIRE_BASE\`, « / » par défaut`);
      assert.ok(
        job.joués.slice(job.joués.indexOf(étape) + 1).some((é) => artefact(é, 'upload') === ARCHIVE),
        `${CI} : sur ${où}, le job « ${job.nom} » ne garde plus le site dans l'artefact \`${ARCHIVE}\``,
      );
      const receveur = partie.find((j) => j.tourne && étapes(j.lignes).some((é) => aval.test(commande(é))));
      assert.ok(receveur, `${CI} : sur ${où}, plus aucun job ne ${verbe} le site`);
      assert.ok(
        étapes(receveur.lignes).some((é) => artefact(é, 'download') === ARCHIVE),
        `${CI} : sur ${où}, le job « ${receveur.nom} » ne reprend plus l'artefact \`${ARCHIVE}\``,
      );
      assert.ok(amonts(partie, receveur.nom).has(job.nom), `${CI} : sur ${où}, le job « ${receveur.nom} » n'attend plus « ${job.nom} », qui assemble le site`);
    }
  }
});

// ─── #159 · La garde qui juge une PR est celle de main ───────────────────────────────────────────
//
// GitHub lit le workflow dans la PR pour `pull_request`, et sur `main` pour `pull_request_target` :
// seul ce second déclencheur rend le verdict indépendant de ce que la PR propose. Le job reste dans
// ci.yml (« pas de workflow à part », CLAUDE.md). La garde de main lit la tête de la PR sans
// l'exécuter ni l'extraire : `cli.mjs pr --base <b> --tete <t>` juge le commit <t>, quel que soit
// l'arbre d'où elle s'exécute.

const VALIDATION = 'Validation';
const ACTIONS_VALIDATION = [...ACTIONS_PR, 'edited'];
const NOM_WORKFLOW = 'CI et livraison';
const cible = (action, draft = false) => ({
  github: {
    event_name: 'pull_request_target',
    workflow: NOM_WORKFLOW,
    ref: 'refs/heads/main',
    event: { action, pull_request: { number: NUMÉRO, draft, head: { sha: 'a'.repeat(40) }, base: { sha: 'b'.repeat(40) } } },
  },
  vars: { ...RECETTE },
  secrets: {},
  inputs: {},
});
const nomAffiché = (job) => scalaire(job.lignes, /^ {4}name:/).replace(/^(['"])(.*)\1$/, '$2');
function jobValidation(yaml) {
  const trouvés = [...jobs(yaml).values()].filter((j) => nomAffiché(j) === VALIDATION);
  assert.equal(trouvés.length, 1, `${CI} : il faut un seul job nommé « ${VALIDATION} », il y en a ${trouvés.length}`);
  return trouvés[0];
}

/** Les types d'activité d'un déclencheur, ceux de GitHub par défaut s'il n'en dit rien, `null` s'il manque. */
function typesDe(yaml, déclencheur) {
  const lignes = yaml.split('\njobs:')[0].split('\n');
  const i = lignes.findIndex((l) => new RegExp(`^ {2}${déclencheur}:`).test(l));
  if (i < 0) return null;
  const bloc = [];
  for (const l of lignes.slice(i + 1)) {
    if (l.trim() && l.search(/\S/) <= 2) break;
    bloc.push(l);
  }
  const k = bloc.findIndex((l) => /^\s*types:/.test(l));
  if (k < 0) return ['opened', 'synchronize', 'reopened'];
  const enLigne = bloc[k].match(/types:\s*\[([^\]]*)\]/);
  if (enLigne) return enLigne[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const liste = [];
  for (const l of bloc.slice(k + 1)) {
    const m = l.match(/^\s*-\s*['"]?([a-z_]+)/);
    if (!m) break;
    liste.push(m[1]);
  }
  return liste;
}

function validationDepuisMain(yaml) {
  const types = typesDe(yaml, 'pull_request_target');
  assert.ok(types, `${CI} : aucun déclencheur \`pull_request_target\`, le seul pour lequel GitHub lit le workflow sur main et non dans la PR`);
  for (const a of ACTIONS_VALIDATION) assert.ok(types.includes(a), `${CI} : \`pull_request_target\` ne se déclenche pas sur « ${a} »`);
  const v = jobValidation(yaml);
  const tournent = (ctx) => jouer(yaml, ctx).filter((j) => j.tourne).map((j) => j.nom);
  for (const a of ACTIONS_VALIDATION) {
    const t = tournent(cible(a));
    assert.deepEqual(t, [v.nom], `${CI} : sur pull_request_target (${a}), seul le job « ${VALIDATION} » doit tourner ; tournent : ${t.join(', ') || 'aucun'}`);
    const b = tournent(cible(a, true));
    assert.deepEqual(b, [], `${CI} : sur un brouillon (${a}), rien ne doit tourner par pull_request_target ; tournent : ${b.join(', ')}`);
  }
  for (const a of [...ACTIONS_VALIDATION, 'closed']) {
    assert.ok(!jouer(yaml, pr(a, true)).find((j) => j.nom === v.nom).tourne, `${CI} : sur pull_request (${a}), le job « ${VALIDATION} » tourne encore, avec le workflow et la garde de la PR`);
  }
}

function validationSansRienDeLaPR(yaml) {
  const v = jobValidation(yaml);
  const où = `${CI}, job « ${VALIDATION} »`;
  const i = v.lignes.findIndex((l) => /^ {4}permissions:/.test(l));
  assert.ok(i >= 0, `${où} : ses permissions ne sont pas déclarées ; celles du workflow, en écriture, s'appliqueraient`);
  const permissions = [v.lignes[i].replace(/^ {4}permissions:/, '').trim()];
  for (const l of v.lignes.slice(i + 1)) {
    if (l.trim() && l.search(/\S/) <= 4) break;
    if (l.trim() && !l.trim().startsWith('#')) permissions.push(l.trim());
  }
  const écrites = permissions.filter((p) => /write/.test(p));
  assert.deepEqual(écrites, [], `${où} : permissions en écriture`);
  assert.ok(!/\bsecrets\./.test(v.lignes.join('\n')), `${où} : un secret est lu`);
  let juge = false;
  for (const é of étapes(v.lignes)) {
    const c = commande(é);
    const outil = c.match(/\b(pnpm|npm|npx|yarn|corepack|bun)\b/);
    assert.ok(!outil, `${où} : « ${outil?.[1]} » lancerait des scripts`);
    const g = c.match(/\bgit\s+(checkout|switch|restore|reset|merge|pull|worktree|stash|apply|am|cherry-pick|rebase)\b/);
    assert.ok(!g, `${où} : « git ${g?.[1]} » mettrait l'arbre de la PR à la place de celui de main`);
    if (/uses:\s*actions\/checkout@/.test(c)) {
      assert.ok(!/pull_request\.head|head_ref|refs\/pull|\bmerge\b/.test(c), `${où} : actions/checkout extrait la PR ; il doit extraire main`);
    }
    for (const n of c.matchAll(/(?:^|[\s;&|(])node\s+((?:-\S+\s+)*)(\S+)/g)) {
      assert.equal(n[2], 'packages/gardes/cli.mjs', `${où} : « node ${n[1]}${n[2]} » : seule la garde de main s'exécute`);
    }
    if (/\bnode\s+(?:-\S+\s+)*packages\/gardes\/cli\.mjs\s+pr\b[\s\S]*--tete\b/.test(c) && /pull_request\.head\.sha/.test(é.texte)) juge = true;
  }
  assert.ok(juge, `${où} : aucune étape ne lance \`node packages/gardes/cli.mjs pr … --tete\` sur la tête de la PR`);
}

/** Le groupe de concurrence du workflow pour cet événement, ou `null` s'il n'en a pas. */
function groupeDuWorkflow(yaml, ctx) {
  const lignes = yaml.split('\njobs:')[0].split('\n');
  const i = lignes.findIndex((l) => /^concurrency:/.test(l));
  if (i < 0) return null;
  const enLigne = lignes[i].replace(/^concurrency:/, '').trim();
  if (enLigne) return interpoler(enLigne, ctx);
  const g = lignes.slice(i + 1).find((l, k, suite) => /^ {2}group:/.test(l) && suite.slice(0, k).every((x) => !x.trim() || /^\s/.test(x)));
  return g ? interpoler(g.replace(/^ {2}group:/, ''), ctx) : null;
}

test('#159 · sur pull_request_target, seul « Validation » tourne ; sur pull_request, il ne tourne plus', () => {
  validationDepuisMain(lire(CI));
});

test('#159 · « Validation » ne lance rien de la PR : lecture seule, aucun secret, aucun pnpm, aucune extraction de la tête', () => {
  validationSansRienDeLaPR(lire(CI));
});

test('#159 · un push ne range pas la validation et les tests dans le même groupe de concurrence', () => {
  const yaml = lire(CI);
  const nommé = (ctx) => ({ ...ctx, github: { ...ctx.github, workflow: NOM_WORKFLOW } });
  for (const a of ACTIONS_VALIDATION) {
    const tests = groupeDuWorkflow(yaml, nommé(pr(a, true)));
    if (tests !== null) assert.notEqual(groupeDuWorkflow(yaml, cible(a)), tests, `${CI} : sur « ${a} », la validation et les tests partagent le groupe « ${tests} » et s'annuleraient`);
  }
});

test('#159 · témoin rouge · des jobs sans condition tourneraient aussi sur pull_request_target', () => {
  const yaml = lire(CI);
  const cassé = réécrire(yaml, (job) => (nomAffiché(job) === VALIDATION ? undefined : sansCondition(job.lignes)));
  assert.notEqual(cassé, yaml, 'le workflow n’a pas pu être cassé : le harnais de #159 est à relire');
  assert.throws(() => validationDepuisMain(cassé), /seul le job « Validation » doit tourner/);
});

// La garde de main devant une PR : un dépôt jetable, la garde de cette branche et des documents
// inventés sur la base, puis la tête d'une PR ; la garde s'exécute depuis l'arbre de la base.

const REGISTRE_159 = (chemins) =>
  `# Gardes\n\n## I1 · Premier\n\n${chemins ? `Chemins : \`${chemins}\`\n\n` : ''}- **Vérification manuelle** · \`VM-I1-parcours\` — Suivre le parcours complet sur une base vide et constater qu'il aboutit.\n`;
const CORPS_159 = 'Close #1\n\n## Invariants et contraintes\n\nTouchés : aucun\nLien possible masqué : aucun\n\n### Vérifications manuelles\n\n';

function dépôtDePR(changer) {
  const d = mkdtempSync(join(tmpdir(), 'tirelire-159-'));
  const git = (...a) =>
    execFileSync('git', ['-c', 'user.name=Essai', '-c', 'user.email=essai@exemple.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], {
      cwd: d,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const écrire = (chemin, contenu) => {
    mkdirSync(dirname(join(d, chemin)), { recursive: true });
    writeFileSync(join(d, chemin), contenu);
  };
  const garde = join(RACINE, 'packages/gardes');
  for (const f of readdirSync(garde)) if (f.endsWith('.mjs') && !f.endsWith('.test.mjs')) écrire(`packages/gardes/${f}`, readFileSync(join(garde, f)));
  écrire('docs/invariants.md', '# Invariants\n\n## I1 · Premier\n\nTexte.\n');
  écrire('docs/contraintes.md', '# Contraintes\n');
  écrire('docs/gardes.md', REGISTRE_159());
  écrire('src/a.txt', 'un\n');
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  changer({ écrire, retirer: (chemin) => rmSync(join(d, chemin)) });
  git('add', '-A');
  git('commit', '-q', '-m', 'tête');
  const tete = git('rev-parse', 'HEAD');
  const juger = (extrait) => {
    git('checkout', '-q', extrait);
    const env = { ...process.env, CORPS: CORPS_159 };
    delete env.GITHUB_ACTIONS;
    delete env.GITHUB_STEP_SUMMARY;
    const r = spawnSync(process.execPath, ['packages/gardes/cli.mjs', 'pr', '--base', base, '--tete', tete], { cwd: d, env, encoding: 'utf8' });
    return { statut: r.status, sortie: `${r.stdout}${r.stderr}` };
  };
  return { base, tete, juger, fin: () => rmSync(d, { recursive: true, force: true }) };
}

test("#159 · la garde juge le registre de la PR, pas celui de l'arbre d'où elle s'exécute", (t) => {
  const d = dépôtDePR(({ écrire }) => {
    écrire('docs/gardes.md', REGISTRE_159('src/**'));
    écrire('src/a.txt', 'deux\n');
  });
  t.after(d.fin);
  const attendu = /I1 n'est pas déclaré alors que la PR modifie src\/a\.txt/;
  const témoin = d.juger(d.tete);
  assert.match(témoin.sortie, attendu, `témoin : tête extraite, la PR devrait être rouge\n${témoin.sortie}`);
  const r = d.juger(d.base);
  assert.equal(r.statut, 1, `depuis l'arbre de la base, la PR passe : la garde a lu son propre registre, pas celui de la PR\n${r.sortie}`);
  assert.match(r.sortie, attendu);
});

test('#159 · un registre que la PR rend illisible fait échouer la validation, en le nommant', (t) => {
  const d = dépôtDePR(({ retirer }) => retirer('docs/gardes.md'));
  t.after(d.fin);
  const r = d.juger(d.base);
  assert.notEqual(r.statut, 0, `la PR retire le registre, et la garde de la base la laisse passer\n${r.sortie}`);
  assert.match(r.sortie, /docs\/gardes\.md/);
});
