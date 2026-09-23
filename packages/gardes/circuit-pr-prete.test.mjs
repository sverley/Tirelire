/**
 * Circuit de la PR (#168, qui amende #150) : le brouillon ne coûte rien, le Ready joue toute la CI
 * une fois, la fusion vaut validation, et un changement après le Ready se signale en commentaire,
 * sans rien bloquer ni rien lancer de lourd. Aucun vert trompeur (B1).
 *
 * Les workflows de `.github/workflows/` sont joués à blanc (`workflow-a-blanc.mjs`) : pour chaque
 * événement, quels jobs passent leur condition. Un job qui tourne compte avec toutes ses étapes. Ce
 * qu'un job décide à l'exécution (le corps exact du commentaire, la différence entre deux
 * descriptions, les PR lues par l'API) est hors d'atteinte de cette lecture statique.
 *
 * L'étiquette « PR prête », posée sur l'issue au Ready, dit sans démarrer de machine qu'une
 * modification de cette issue est à signaler.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { RACINE } from './gardes.mjs';
import { commande, jouer, étapes } from './workflow-a-blanc.mjs';

const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');
const DOSSIER = '.github/workflows';
const workflows = () =>
  readdirSync(join(RACINE, DOSSIER))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ nom: `${DOSSIER}/${f}`, yaml: lire(`${DOSSIER}/${f}`) }));

// ─── Déclencheurs ────────────────────────────────────────────────────────────────────────────────

const sansGuillemets = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2');
const valeurs = (v) => v.replace(/^\[|\]$/g, '').split(',').map(sansGuillemets).filter(Boolean);

/** Le bloc `on:` : événement → { types }. Formes lues : `on: x`, `on: [x, y]`, bloc renfoncé de deux espaces. */
function déclencheurs(yaml) {
  const lignes = yaml
    .split(/\njobs:\s*\n/)[0]
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '').replace(/\s+$/, ''));
  const i = lignes.findIndex((l) => /^(?:on|'on'|"on"):/.test(l));
  assert.ok(i >= 0, 'bloc `on:` introuvable');
  const événements = new Map();
  const enLigne = lignes[i].replace(/^[^:]+:/, '').trim();
  if (enLigne) {
    for (const e of valeurs(enLigne)) événements.set(e, {});
    return événements;
  }
  const bloc = [];
  for (const l of lignes.slice(i + 1)) {
    if (/^\S/.test(l)) break;
    bloc.push(l);
  }
  let courant;
  bloc.forEach((l, k) => {
    const n = l.search(/\S/);
    const m = l.trim().match(/^([\w-]+):\s*(.*)$/);
    if (n < 0 || !m) return;
    if (n === 2) événements.set(m[1], (courant = {}));
    else if (courant && n === 4 && m[1] === 'types') {
      if (m[2]) courant.types = valeurs(m[2]);
      else {
        courant.types = [];
        for (const suite of bloc.slice(k + 1)) {
          const t = suite.match(/^\s{6,}-\s+(.+)$/);
          if (!t) break;
          courant.types.push(sansGuillemets(t[1]));
        }
      }
    }
  });
  return événements;
}

/** Sans `types`, GitHub ne déclenche `pull_request(_target)` que sur opened, synchronize et reopened ; les autres événements, sur toute action. */
const lancé = (décl, événement, action) => {
  const e = décl.get(événement);
  if (!e) return false;
  const défaut = /^pull_request(?:_target)?$/.test(événement) ? ['opened', 'synchronize', 'reopened'] : [action];
  return (e.types ?? défaut).includes(action);
};

// ─── Événements ──────────────────────────────────────────────────────────────────────────────────

const NUMÉRO = 174;
const ISSUE = 168;
const ÉTIQUETTE = 'PR prête';
const CONTEXTE = 'Toute la CI sur ce commit';
// L'adresse de recette est un secret (#156), le dossier une variable.
const RECETTE = { TIRELIRE_DEV_FTP_DOSSIER: 'recette' };
const SECRETS_RECETTE = { TIRELIRE_DEV_SITE_URL: 'https://recette.example' };
const PR = (draft) => ({
  number: NUMÉRO,
  draft,
  body: `Close #${ISSUE}`,
  labels: [{ name: 'besoin' }],
  head: { sha: 'a'.repeat(40), ref: 'audit/168-validation-commentaire' },
  base: { sha: 'b'.repeat(40), ref: 'main' },
});
const ISSUE_DE_PR = (draft) => ({ number: NUMÉRO, draft, labels: [], pull_request: { url: `https://api.github.com/repos/o/r/pulls/${NUMÉRO}` } });
const ISSUE_SEULE = (prête) => ({ number: ISSUE, labels: prête ? [{ name: 'besoin' }, { name: ÉTIQUETTE }] : [{ name: 'besoin' }], pull_request: null, body: 'Le besoin.' });
const AVIS = { id: 1, body: 'Un avis.', author_association: 'OWNER', created_at: '2026-09-23T10:00:00Z' };

/** `extra` : ce qu'un job décide à l'exécution, donné en hypothèse (`needs.<job>.outputs`). */
const contexte = ([nom, event], extra = {}) => ({
  github: {
    event_name: nom,
    ref: /^pull_request(?:_review(?:_comment)?)?$/.test(nom) ? `refs/pull/${NUMÉRO}/merge` : 'refs/heads/main',
    event,
  },
  vars: { ...RECETTE },
  secrets: { ...SECRETS_RECETTE },
  inputs: {},
  ...extra,
});
const surLaPR = (action, draft, extra = {}) =>
  ['pull_request', 'pull_request_target'].map((nom) => [nom, { action, pull_request: PR(draft), ...extra }]);

const exécutions = (événements, extra) =>
  événements.flatMap((é) =>
    workflows()
      .filter(({ yaml }) => lancé(déclencheurs(yaml), é[0], é[1].action))
      .map(({ nom, yaml }) => ({
        workflow: nom,
        événement: é[0],
        jobs: jouer(yaml, contexte(é, extra)).map((j) => ({
          ...j,
          clé: `${nom} › ${j.nom}`,
          commandes: étapes(j.lignes).map(commande),
          texte: `${yaml.split(/\njobs:\s*\n/)[0]}\n${j.lignes.join('\n')}`,
        })),
      })),
  );
const tournent = (exé) => exé.flatMap((x) => x.jobs.filter((j) => j.tourne));
const fait = (jobs, motif) => jobs.some((j) => j.commandes.some((c) => motif.test(c)));
const clés = (jobs) => jobs.map((j) => j.clé).sort();

const TYPECHECK = /\bpnpm\s+(?:-r\s+)?typecheck\b/;
const SUITE = /^\s*(?:-\s+)?run:\s*pnpm\s+(?:-r\s+)?test\s*$/m;
const BUILD = /\bpnpm\s+(?:-r\s+)?(?:run\s+)?build\b/;
const GARDE = /packages\/gardes\/cli\.mjs/;
const DÉPÔT_DE_LA_VERSION_DE_DEV = /apercu\.sh\s+deposer/;
const EN_BROUILLON = /convertPullRequestToDraft|\bgh\s+pr\s+ready\b[^\n]*--undo/;
const COMMENTAIRE = /\bgh\s+(?:pr|issue)\s+comment\b|\bcreateComment\b|\baddComment\b|\bissues\/[^\s'"/]+\/comments\b/;
const STATUT_DE_COMMIT = /\bstatuses\/[^\s'"]+/;
const AJOUT = /--add-label\b/;
const RETRAIT = /--remove-label\b|\bremoveLabel\b/;
/** Les jobs qui posent le statut de toute la CI : son nom vient de leur `env` ou de celui du workflow. */
const surLeStatut = (jobs) => jobs.filter((j) => j.texte.includes(CONTEXTE) && j.commandes.some((c) => STATUT_DE_COMMIT.test(c)));
const LOURDS = [
  ['le typecheck', TYPECHECK],
  ['toute la suite', SUITE],
  ['le build', BUILD],
  ['la garde', GARDE],
  ['le dépôt de la version de dev', DÉPÔT_DE_LA_VERSION_DE_DEV],
];
const PASSAGES = ['ready_for_review', 'opened', 'reopened'];
const SANS_CHANGEMENT = ['labeled', 'unlabeled', 'assigned', 'unassigned', 'review_requested', 'review_request_removed'];
const COMMENTAIRES = (issue) => ['created', 'edited', 'deleted'].map((a) => ['issue_comment', { action: a, issue, comment: AVIS }]);
const léger = (quoi, jobs) => {
  for (const [nom, motif] of LOURDS) assert.ok(!fait(jobs, motif), `${quoi} : un job joue ${nom}`);
  assert.ok(!fait(jobs, EN_BROUILLON), `${quoi} : un job renvoie la PR en brouillon`);
};

// ─── Le brouillon ne coûte rien ──────────────────────────────────────────────────────────────────

test('#168 · aucun workflow ne convertit une PR en brouillon', () => {
  for (const { nom, yaml } of workflows()) assert.ok(!EN_BROUILLON.test(yaml), `${nom} convertit une PR en brouillon`);
});

test('#150 · sur un brouillon, ni ouverture, ni commit, ni édition, ni commentaire, ni revue ne lance un job', () => {
  const événements = [
    ...['opened', 'synchronize', 'reopened', 'edited'].flatMap((a) => surLaPR(a, true)),
    ...['submitted', 'edited'].map((a) => ['pull_request_review', { action: a, pull_request: PR(true), review: { state: 'commented', ...AVIS } }]),
    ...['created', 'edited', 'deleted'].map((a) => ['pull_request_review_comment', { action: a, pull_request: PR(true), comment: AVIS }]),
    ...COMMENTAIRES(ISSUE_DE_PR(true)),
  ];
  for (const é of événements) assert.deepEqual(clés(tournent(exécutions([é]))), [], `brouillon, ${é[0]} (${é[1].action}) : ces jobs tournent`);
});

// ─── Le Ready joue toute la CI, une fois ─────────────────────────────────────────────────────────

test('#150 · le passage en Ready lance toute la CI et assemble la version de dev, sans la déposer ni commenter', () => {
  const référence = clés(tournent(exécutions(surLaPR('ready_for_review', false))));
  for (const a of PASSAGES) {
    const jobs = tournent(exécutions(surLaPR(a, false)));
    for (const [quoi, motif] of LOURDS.filter(([, m]) => m !== DÉPÔT_DE_LA_VERSION_DE_DEV)) {
      assert.ok(fait(jobs, motif), `passage en Ready (${a}) : aucun job ne joue ${quoi}`);
    }
    // Le dépôt de l'aperçu est une action du porteur, par la case de l'aperçu (#175).
    assert.ok(!fait(jobs, DÉPÔT_DE_LA_VERSION_DE_DEV), `passage en Ready (${a}) : un job dépose l'aperçu sans que la case soit cochée`);
    assert.ok(!fait(jobs, COMMENTAIRE), `passage en Ready (${a}) : un job commente la PR ou l'issue`);
    assert.deepEqual(clés(jobs), référence, `une PR ${a} hors brouillon ne lance pas les mêmes jobs qu'un passage en Ready`);
    const vus = clés(jobs);
    assert.deepEqual(vus.filter((c, i) => vus.indexOf(c) !== i), [], `passage en Ready (${a}) : des jobs tournent deux fois`);
  }
});

test('#168 · au passage en Ready, l’issue reçoit l’étiquette « PR prête » et le statut de toute la CI est posé', () => {
  for (const a of PASSAGES) {
    const jobs = tournent(exécutions(surLaPR(a, false)));
    assert.ok(fait(jobs, AJOUT), `passage en Ready (${a}) : aucun job ne pose l'étiquette « ${ÉTIQUETTE} »`);
    assert.ok(surLeStatut(jobs).length >= 2, `passage en Ready (${a}) : le statut « ${CONTEXTE} » n'est pas posé puis terminé`);
  }
});

// ─── #175 · la case de l'aperçu ──────────────────────────────────────────────────────────────────

const CASE = (boîte) => `Close #${ISSUE}\n\n- [${boîte}] Aperçu du dernier commit en recette — en ligne : rien <!-- apercu: -->`;
/** Le porteur coche la case : la description passe de la case vide à la case cochée. */
/** Ce que décide le job `demande` à l'exécution : la CI verte (le site à déposer), ou une raison de refuser. */
const TENUE = { needs: { demande: { outputs: { run: '1', sha: 'a'.repeat(40), raison: '' } } } };
const REFUSÉE = { needs: { demande: { outputs: { run: '', sha: 'a'.repeat(40), raison: 'la CI n’est pas verte' } } } };
const cocher = (draft) =>
  surLaPR('edited', draft, { pull_request: { ...PR(draft), body: CASE('x') }, changes: { body: { from: CASE(' ') } } });

test('#175 · cocher la case de l’aperçu sur une PR prête lance le dépôt, lu sur main', () => {
  const exé = exécutions(cocher(false), TENUE);
  const jobs = tournent(exé);
  assert.ok(fait(jobs, DÉPÔT_DE_LA_VERSION_DE_DEV), 'case cochée sur une PR prête : aucun job ne dépose l’aperçu');
  for (const x of exé.filter((e) => e.jobs.some((j) => j.tourne && fait([j], DÉPÔT_DE_LA_VERSION_DE_DEV)))) {
    assert.equal(x.événement, 'pull_request_target', `${x.workflow} : le dépôt tourne sur ${x.événement}, lu dans la branche`);
  }
  for (const [quoi, motif] of LOURDS.filter(([, m]) => m !== DÉPÔT_DE_LA_VERSION_DE_DEV)) {
    assert.ok(!fait(jobs, motif), `case cochée : un job joue ${quoi}`);
  }
});

test('#175 · CI pas verte ou brouillon : la case cochée ne dépose rien, se décoche et la PR dit pourquoi', () => {
  for (const [quoi, é, décision] of [
    ['CI pas verte', cocher(false), REFUSÉE],
    ['brouillon', cocher(true), REFUSÉE],
    ['brouillon, même CI verte', cocher(true), TENUE],
  ]) {
    const jobs = tournent(exécutions(é, décision));
    assert.ok(!fait(jobs, DÉPÔT_DE_LA_VERSION_DE_DEV), `${quoi} : un job dépose l’aperçu`);
    if (décision === REFUSÉE) {
      assert.ok(fait(jobs, COMMENTAIRE), `${quoi} : aucun commentaire ne dit pourquoi rien n’est déposé`);
      assert.ok(fait(jobs, /case-apercu\.sh\s+refusee/), `${quoi} : la case n’est pas décochée`);
    }
  }
});

test('#175 · un commit sur un brouillon décoche la case cochée, sans rien d’autre ; sans case cochée, rien ne tourne', () => {
  const commit = (boîte) => surLaPR('synchronize', true, { pull_request: { ...PR(true), body: CASE(boîte) }, after: 'c'.repeat(40) });
  const jobs = tournent(exécutions(commit('x')));
  assert.ok(fait(jobs, /case-apercu\.sh\s+rafraichir/), 'commit sur un brouillon, case cochée : la case n’est pas remise à jour');
  // Les étapes jouées seulement : sur un brouillon, l'étape qui signale le commit est écartée.
  const joué = (motif) => jobs.some((j) => j.joués.map(commande).some((c) => motif.test(c)));
  assert.ok(!joué(COMMENTAIRE), 'commit sur un brouillon : un job commente');
  assert.ok(!joué(STATUT_DE_COMMIT), 'commit sur un brouillon : un job touche le statut de toute la CI');
  léger('commit sur un brouillon, case cochée', jobs);
  assert.deepEqual(clés(tournent(exécutions(commit(' ')))), [], 'commit sur un brouillon, case vide : des jobs tournent');
});

test('#175 · sans la case cochée, une édition ne dépose rien', () => {
  for (const [quoi, é] of [
    ['case décochée', surLaPR('edited', false, { pull_request: { ...PR(false), body: CASE(' ') }, changes: { body: { from: CASE('x') } } })],
    ['titre seul', surLaPR('edited', false, { pull_request: { ...PR(false), body: CASE('x') }, changes: { title: { from: 'Avant' } } })],
    ['description sans case', surLaPR('edited', false, { changes: { body: { from: 'Avant.' } } })],
  ]) {
    assert.ok(!fait(tournent(exécutions(é, TENUE)), DÉPÔT_DE_LA_VERSION_DE_DEV), `${quoi} : un job dépose l’aperçu`);
  }
});

// ─── B1 · aucun vert trompeur ────────────────────────────────────────────────────────────────────

test('#150 · B1 · au passage en Ready, aucune exécution ne montre sauté un job qu’une autre joue', () => {
  for (const a of PASSAGES) {
    const exé = exécutions(surLaPR(a, false));
    const joués = new Set(clés(tournent(exé)));
    for (const x of exé) {
      const masques = x.jobs.filter((j) => !j.tourne && joués.has(j.clé)).map((j) => j.clé);
      assert.deepEqual(masques, [], `passage en Ready (${a}) : ${x.événement} de ${x.workflow} montre sautés des jobs qu'une autre exécution joue`);
    }
  }
});

test('#150 · B1 · sur une PR prête, ce qui ne la change pas ne montre sauté aucun job du Ready', () => {
  const duReady = new Set(PASSAGES.flatMap((a) => clés(tournent(exécutions(surLaPR(a, false))))));
  for (const a of SANS_CHANGEMENT) {
    for (const x of exécutions(surLaPR(a, false))) {
      const masques = x.jobs.filter((j) => !j.tourne && duReady.has(j.clé)).map((j) => j.clé);
      assert.deepEqual(masques, [], `${a} (${x.événement}) : ${x.workflow} montre sautés des jobs du Ready`);
    }
  }
});

test('#168 · B1 · aucun job ne porte le nom du statut de toute la CI : sauté, il passerait pour elle', () => {
  for (const { nom, yaml } of workflows()) {
    for (const j of jouer(yaml, contexte(surLaPR('ready_for_review', false)[1]))) {
      const affiché = (j.lignes.find((l) => /^ {4}name:/.test(l)) ?? '').replace(/^ {4}name:\s*/, '').replace(/^(['"])(.*)\1$/, '$2');
      assert.notEqual(affiché, CONTEXTE, `${nom} : le job « ${j.nom} » porte le nom du statut « ${CONTEXTE} »`);
    }
  }
});

// ─── Un changement après le Ready se signale, sans rien bloquer ──────────────────────────────────

test('#168 · un commit sur une PR prête passe le statut en échec et dit quoi faire, sans rien lancer de lourd', () => {
  const jobs = tournent(exécutions(surLaPR('synchronize', false)));
  assert.ok(surLeStatut(jobs).length, `commit sur une PR prête : le statut « ${CONTEXTE} » n'est pas touché`);
  assert.ok(fait(jobs, COMMENTAIRE), 'commit sur une PR prête : aucun commentaire ne le signale');
  léger('commit sur une PR prête', jobs);
});

test('#168 · une édition d’une PR prête, ou de son issue, se signale en commentaire, sans rien lancer de lourd', () => {
  for (const [quoi, é] of [
    ['édition de la PR', surLaPR('edited', false, { changes: { body: { from: 'Avant.' } } })],
    ["édition de l'issue", [['issues', { action: 'edited', issue: ISSUE_SEULE(true), changes: { body: { from: 'Avant.' } } }]]],
  ]) {
    const jobs = tournent(exécutions(é));
    assert.ok(fait(jobs, COMMENTAIRE), `${quoi} : aucun commentaire ne la signale`);
    léger(quoi, jobs);
  }
});

test('#168 · modifier une issue sans PR prête, ou commenter, ne lance rien', () => {
  const événements = [
    ['issues', { action: 'edited', issue: ISSUE_SEULE(false), changes: { body: { from: 'Avant.' } } }],
    ...['labeled', 'unlabeled'].map((a) => ['issues', { action: a, label: { name: 'besoin' }, issue: ISSUE_SEULE(true) }]),
    ...COMMENTAIRES(ISSUE_SEULE(true)),
    ...COMMENTAIRES(ISSUE_DE_PR(false)),
  ];
  for (const é of événements) assert.deepEqual(clés(tournent(exécutions([é]))), [], `${é[0]} (${é[1].action}) : ces jobs tournent`);
});

test('#168 · au retour en brouillon ou à la fermeture, l’étiquette « PR prête » quitte l’issue, sans rien lancer de lourd', () => {
  for (const [quoi, é] of [
    ['retour en brouillon', surLaPR('converted_to_draft', true)],
    ...[true, false].map((merged) => [`fermeture (${merged ? 'fusionnée' : 'sans fusion'})`, surLaPR('closed', false, { pull_request: { ...PR(false), merged } })]),
  ]) {
    const jobs = tournent(exécutions(é));
    assert.ok(fait(jobs, RETRAIT), `${quoi} : aucun job ne retire l'étiquette`);
    assert.ok(!fait(jobs, COMMENTAIRE), `${quoi} : un job commente`);
    léger(quoi, jobs);
  }
});

test('témoin · le lecteur de conditions suit le filtre d’objets `.*` comme GitHub', () => {
  const yaml = `name: t\non: issues\njobs:\n  j:\n    if: contains(github.event.issue.labels.*.name, 'PR prête')\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo j\n`;
  const joue = (prête) => jouer(yaml, contexte(['issues', { action: 'edited', issue: ISSUE_SEULE(prête) }]))[0].tourne;
  assert.equal(joue(true), true);
  assert.equal(joue(false), false);
});
