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
import { CLÉ_ÉTAPE, STATUT, besoins, commande, expression, interpoler, jetons, jobs, jouer, nombre, scalaire, vrai, égal, étapes, évaluer } from './workflow-a-blanc.mjs';

const CI = '.github/workflows/ci.yml';
const ARCHIVE = 'tirelire-hebergement';

const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');

const assemble = (é) => /hebergement\b.*\bassembler\b|assembler\.mjs/.test(commande(é));
const artefact = (é, sens) =>
  new RegExp(`uses:\\s*actions/${sens}-artifact@`).test(é.texte) ? é.texte.match(/^ {10}name:\s*(\S+)/m)?.[1] : undefined;

const assemblages = (partie) => partie.flatMap((job) => job.joués.filter(assemble).map((étape) => ({ job, étape })));
const liste = (a) => a.map(({ job }) => `« ${job.nom} »`).join(', ') || 'aucun job';

const NUMÉRO = 153;
// Les passages en Ready (#150) : `ready_for_review`, et une PR ouverte ou rouverte hors brouillon. Un
// push sur une PR prête ne rejoue plus rien : il annule la validation du porteur (#168).
const ACTIONS_PR = ['opened', 'reopened', 'ready_for_review'];
// L'adresse de recette est un secret (#156), le dossier une variable.
const RECETTE = { TIRELIRE_DEV_FTP_DOSSIER: 'recette' };
const SECRETS_RECETTE = { TIRELIRE_DEV_SITE_URL: 'https://recette.example' };
const pr = (action, recette) => ({
  github: {
    event_name: 'pull_request',
    ref: `refs/pull/${NUMÉRO}/merge`,
    event: { action, pull_request: { number: NUMÉRO, draft: false, head: { sha: 'a'.repeat(40) } } },
  },
  vars: recette ? { ...RECETTE } : {},
  secrets: recette ? { ...SECRETS_RECETTE } : {},
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

// ─── I9 · le catalogue des cibles (#162) ─────────────────────────────────────────────────────────

const CIBLES = 'docs/cibles.md';

/**
 * Les cibles du catalogue : une entrée `## Nom`, sa ligne « État » et les commandes entre accents
 * graves de sa ligne « Construction ». Une entrée qui ne dit pas son état n'est pas une cible.
 */
function lireCibles(texte) {
  return texte
    .split(/^(?=## )/m)
    .map((bloc) => ({
      nom: bloc.match(/^## (.+)$/m)?.[1]?.trim(),
      état: bloc.match(/^- \*\*État\*\*\s*:\s*(.+?)\s*$/m)?.[1],
      commandes: [...(bloc.match(/^- \*\*Construction\*\*\s*:\s*(.+)$/m)?.[1] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]),
    }))
    .filter((c) => c.nom && c.état);
}

/** La valeur d'I9 : chaque cible active se construit à chaque push sur `main`. */
function ciblesActivesConstruitesSurMain(catalogue, yaml) {
  const cibles = lireCibles(catalogue);
  const actives = cibles.filter((c) => c.état === 'active');
  assert.ok(actives.length, `${CIBLES} : aucune cible active lue`);
  const joués = jouer(yaml, push('refs/heads/main')).flatMap((job) => job.joués.map((é) => commande(é)));
  for (const c of actives) {
    assert.ok(c.commandes.length, `${CIBLES} : la cible active « ${c.nom} » ne dit pas ce qui la construit`);
    for (const cmd of c.commandes) {
      assert.ok(joués.some((j) => j.includes(cmd)), `${CI} : sur un push de main, rien ne lance \`${cmd}\`, qui construit la cible active « ${c.nom} »`);
    }
  }
}

test('I9 · chaque cible active du catalogue se construit à chaque push sur main', () => {
  ciblesActivesConstruitesSurMain(lire(CIBLES), lire(CI));
});

test("témoin rouge · un catalogue qui active l'APK sans que main la construise", () => {
  const catalogue = lire(CIBLES);
  const cassé = catalogue.replace(/(## APK Android\n[\s\S]*?- \*\*État\*\*\s*:\s*)de côté/, '$1active');
  assert.notEqual(cassé, catalogue, 'le catalogue n’a pas pu être cassé : le harnais de I9 est à relire');
  assert.throws(() => ciblesActivesConstruitesSurMain(cassé, lire(CI)), /assembleRelease.*APK Android/);
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
// seul ce second déclencheur rend le verdict indépendant de ce que la PR propose. Le job vit dans le
// workflow de son choix, seul à y porter ce nom : partagé avec les tests, un même workflow montrerait
// chacun sauté dans l'exécution de l'autre (#150, B1). La garde de main lit la tête de la PR sans
// l'exécuter ni l'extraire : `cli.mjs pr --base <b> --tete <t>` juge le commit <t>, quel que soit
// l'arbre d'où elle s'exécute.

const VALIDATION = 'Validation';
// Au seul passage en Ready (#150).
const ACTIONS_VALIDATION = ACTIONS_PR;
const NOM_WORKFLOW = 'CI et livraison';
const cible = (action, draft = false, workflow = NOM_WORKFLOW) => ({
  github: {
    event_name: 'pull_request_target',
    workflow,
    ref: 'refs/heads/main',
    event: { action, pull_request: { number: NUMÉRO, draft, head: { sha: 'a'.repeat(40) }, base: { sha: 'b'.repeat(40) } } },
  },
  vars: { ...RECETTE },
  secrets: { ...SECRETS_RECETTE },
  inputs: {},
});
const nomAffiché = (job) => scalaire(job.lignes, /^ {4}name:/).replace(/^(['"])(.*)\1$/, '$2');
function jobValidation(yaml) {
  const trouvés = [...jobs(yaml).values()].filter((j) => nomAffiché(j) === VALIDATION);
  assert.equal(trouvés.length, 1, `${CI} : il faut un seul job nommé « ${VALIDATION} », il y en a ${trouvés.length}`);
  return trouvés[0];
}

/** Le workflow qui porte « Validation », `ci.yml` ou un autre (#150) : un seul. */
function workflowDeValidation() {
  const dossier = '.github/workflows';
  const où = readdirSync(join(RACINE, dossier))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => `${dossier}/${f}`)
    .filter((f) => [...jobs(lire(f)).values()].some((j) => nomAffiché(j) === VALIDATION));
  assert.equal(où.length, 1, `un seul workflow doit porter le job « ${VALIDATION} » ; le portent : ${où.join(', ') || 'aucun'}`);
  return où[0];
}
const nomDuWorkflow = (yaml) => (yaml.match(/^name:\s*(.+)$/m)?.[1] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');

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
      assert.ok(!/pull_request\.|head_ref|base_ref|refs\/pull|\bmerge\b/.test(c), `${où} : actions/checkout extrait un commit que la PR désigne (sa tête ou sa base) ; sans \`ref\`, GitHub donne main, la version même du workflow`);
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
  validationDepuisMain(lire(workflowDeValidation()));
});

test('#159 · « Validation » ne lance rien de la PR : lecture seule, aucun secret, aucun pnpm, aucune extraction de la tête', () => {
  validationSansRienDeLaPR(lire(workflowDeValidation()));
});

test('#159 · un push ne range pas la validation et les tests dans le même groupe de concurrence', () => {
  const yV = lire(workflowDeValidation());
  const yT = lire(CI);
  const nommé = (ctx, yaml) => ({ ...ctx, github: { ...ctx.github, workflow: nomDuWorkflow(yaml) } });
  for (const a of ACTIONS_VALIDATION) {
    const tests = groupeDuWorkflow(yT, nommé(pr(a, true), yT));
    if (tests !== null) assert.notEqual(groupeDuWorkflow(yV, cible(a, false, nomDuWorkflow(yV))), tests, `${CI} : sur « ${a} », la validation et les tests partagent le groupe « ${tests} » et s'annuleraient`);
  }
});

test('#159 · témoin rouge · des jobs sans condition tourneraient aussi sur pull_request_target', () => {
  // Un job sans condition ajouté au workflow de la validation : il tournerait avec elle.
  const cassé = `${lire(workflowDeValidation()).replace(/\s*$/, '')}\n  intrus:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo intrus\n`;
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
