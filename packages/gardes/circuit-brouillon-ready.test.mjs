/**
 * Harnais de #150 — le brouillon ne coûte rien, le Ready joue tout une fois, tout changement renvoie
 * en brouillon, et aucun vert trompeur (B1, B2, B4, B6).
 *
 * Seule la CI a un harnais : la garde et la documentation se vérifient en relisant (B8).
 *
 * Les workflows de `.github/workflows/` sont joués à blanc (`workflow-a-blanc.mjs`) : pour chaque
 * événement, quels jobs passent leur condition. Un job qui tourne compte avec toutes ses étapes, même
 * celles qu'une condition d'exécution pourrait sauter. Un job sauté par sa condition s'affiche sur la
 * PR comme « skipped », que GitHub compte réussi : c'est le trou de #149.
 *
 * Une modification d'issue ne dit pas si une PR prête la cite par `Close #n` : l'étiquette « en
 * validation », posée sur l'issue au passage en Ready et retirée au retour en brouillon comme à la
 * fermeture de la PR, le dit sans démarrer de machine (porteur, 21/09). Hors d'atteinte d'une lecture
 * statique : ce qu'un job décide à l'exécution.
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

const NUMÉRO = 158;
const ISSUE = 150;
const BRANCHE = 'outillage/150-brouillon-ready';
const RECETTE = { TIRELIRE_DEV_FTP_DOSSIER: 'recette', TIRELIRE_DEV_SITE_URL: 'https://recette.example' };
const PR = (draft) => ({
  number: NUMÉRO,
  draft,
  body: `Close #${ISSUE}`,
  labels: [],
  head: { sha: 'a'.repeat(40), ref: BRANCHE },
  base: { sha: 'b'.repeat(40), ref: 'main' },
});
const ISSUE_DE_PR = (draft) => ({ number: NUMÉRO, draft, labels: [], pull_request: { url: `https://api.github.com/repos/o/r/pulls/${NUMÉRO}` } });
const ÉTIQUETTE = 'en validation';
const ISSUE_SEULE = { number: ISSUE, labels: [], pull_request: null, body: 'Le besoin.' };
const ISSUE_EN_VALIDATION = { ...ISSUE_SEULE, labels: [{ name: ÉTIQUETTE }] };
const AVIS = { body: 'Un avis.' };

/** Un événement : [nom GitHub, charge utile]. `pull_request_target` et les événements d'issue se lisent sur main. */
const contexte = ([nom, event]) => ({
  github: {
    event_name: nom,
    ref: /^pull_request(?:_review(?:_comment)?)?$/.test(nom) ? `refs/pull/${NUMÉRO}/merge` : 'refs/heads/main',
    event,
  },
  vars: { ...RECETTE },
  secrets: {},
  inputs: {},
});
const surLaPR = (action, draft, extra = {}) =>
  ['pull_request', 'pull_request_target'].map((nom) => [nom, { action, pull_request: PR(draft), ...extra }]);

/** Les exécutions que GitHub lance pour ces événements : une par workflow déclenché, avec tous ses jobs. */
const exécutions = (événements) =>
  événements.flatMap((é) =>
    workflows()
      .filter(({ yaml }) => lancé(déclencheurs(yaml), é[0], é[1].action))
      .map(({ nom, yaml }) => ({
        workflow: nom,
        événement: é[0],
        jobs: jouer(yaml, contexte(é)).map((j) => ({
          ...j,
          clé: `${nom} › ${j.nom}`,
          commandes: étapes(j.lignes).map(commande),
          // Le nom de l'étiquette peut venir de l'`env` du job ou du workflow.
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
/** Un commentaire sur la PR ou l'issue ; ceux d'un commit (`commits/<sha>/comments`) n'en sont pas. */
const COMMENTAIRE = /\bgh\s+(?:pr|issue)\s+comment\b|\bcreateComment\b|\baddComment\b|\bissues\/[^\s'"/]+\/comments\b/;
const NOM_DE_L_ÉTIQUETTE = /en(?:%20|\s|\+)validation/;
const AJOUT = /--add-label\b|\baddLabels\b|\bissues\/[^\s'"/]+\/labels(?!\/)/;
const RETRAIT = /--remove-label\b|\bremoveLabel\b|\bissues\/[^\s'"/]+\/labels\//;
/** Les jobs qui agissent sur l'étiquette « en validation » avec ce verbe. */
const surLÉtiquette = (jobs, verbe) => jobs.filter((j) => NOM_DE_L_ÉTIQUETTE.test(j.texte) && j.commandes.some((c) => verbe.test(c)));
const LOURDS = [
  ['le typecheck', TYPECHECK],
  ['toute la suite', SUITE],
  ['le build', BUILD],
  ['la garde', GARDE],
  ['le dépôt de la version de dev', DÉPÔT_DE_LA_VERSION_DE_DEV],
];

/** Passages en Ready : `ready_for_review`, et une PR ouverte ou rouverte hors brouillon (précisions de #150). */
const PASSAGES = ['ready_for_review', 'opened', 'reopened'];

/** Les changements d'une PR prête (B6), chacun avec les événements que GitHub lance ensemble. */
const CHANGEMENTS_DE_LA_PR = [
  ['un commit', surLaPR('synchronize', false)],
  ['une édition de la description', surLaPR('edited', false, { changes: { body: { from: 'Avant.' } } })],
  ['une édition du titre', surLaPR('edited', false, { changes: { title: { from: 'Avant' } } })],
  ...['created', 'edited', 'deleted'].map((a) => [`un commentaire (${a})`, [['issue_comment', { action: a, issue: ISSUE_DE_PR(false), comment: AVIS }]]]),
  ...['submitted', 'edited'].map((a) => [`une revue (${a})`, [['pull_request_review', { action: a, pull_request: PR(false), review: { state: 'commented', ...AVIS } }]]]),
  ...['created', 'edited', 'deleted'].map((a) => [
    `un commentaire de revue (${a})`,
    [['pull_request_review_comment', { action: a, pull_request: PR(false), comment: AVIS }]],
  ]),
];
const CHANGEMENTS_DE_L_ISSUE = [
  ["une édition de l'issue", [['issues', { action: 'edited', issue: ISSUE_EN_VALIDATION, changes: { body: { from: 'Avant.' } } }]]],
  ...['created', 'edited', 'deleted'].map((a) => [
    `un commentaire sur l'issue (${a})`,
    [['issue_comment', { action: a, issue: ISSUE_EN_VALIDATION, comment: AVIS }]],
  ]),
  ["le retrait à la main de l'étiquette", [['issues', { action: 'unlabeled', label: { name: ÉTIQUETTE }, issue: ISSUE_SEULE }]]],
];
/** Les mêmes modifications sur une issue sans l'étiquette : aucune PR prête ne la cite. */
const HORS_VALIDATION = [
  ['issues', { action: 'edited', issue: ISSUE_SEULE, changes: { body: { from: 'Avant.' } } }],
  ...['created', 'edited', 'deleted'].map((a) => ['issue_comment', { action: a, issue: ISSUE_SEULE, comment: AVIS }]),
  ['issues', { action: 'unlabeled', label: { name: 'besoin' }, issue: ISSUE_SEULE }],
];
/** Ce qui arrive à une PR sans la changer : elle reste prête, rien ne doit s'afficher sauté (B1). */
const SANS_CHANGEMENT = ['labeled', 'unlabeled', 'assigned', 'unassigned', 'review_requested', 'review_request_removed', 'converted_to_draft'];

/** Les jobs qui tournent au passage en Ready, toutes exécutions confondues. */
const jobsDuReady = () => new Set(PASSAGES.flatMap((a) => clés(tournent(exécutions(surLaPR(a, false))))));

// ─── B2 · rien en brouillon ──────────────────────────────────────────────────────────────────────

test('#150 · B2 · sur un brouillon, ni ouverture, ni commit, ni édition, ni commentaire, ni revue ne lance un job', () => {
  const événements = [
    ...['opened', 'synchronize', 'reopened', 'edited', 'converted_to_draft'].flatMap((a) => surLaPR(a, true)),
    ...['submitted', 'edited'].map((a) => ['pull_request_review', { action: a, pull_request: PR(true), review: { state: 'commented', ...AVIS } }]),
    ...['created', 'edited', 'deleted'].map((a) => ['pull_request_review_comment', { action: a, pull_request: PR(true), comment: AVIS }]),
    // Un commentaire sur la PR arrive comme commentaire d'issue ; il dit si elle est en brouillon.
    ...['created', 'edited', 'deleted'].map((a) => ['issue_comment', { action: a, issue: ISSUE_DE_PR(true), comment: AVIS }]),
  ];
  for (const é of événements) {
    assert.deepEqual(clés(tournent(exécutions([é]))), [], `brouillon, ${é[0]} (${é[1].action}) : ces jobs tournent`);
  }
});

// ─── B2, B4, B7 · le Ready joue tout, une fois ───────────────────────────────────────────────────

test('#150 · B2, B4 · le passage en Ready lance toute la CI et la version de dev, sans commenter la PR ni l’issue', () => {
  const référence = clés(tournent(exécutions(surLaPR('ready_for_review', false))));
  for (const a of PASSAGES) {
    const jobs = tournent(exécutions(surLaPR(a, false)));
    for (const [quoi, motif] of [
      ['le typecheck', TYPECHECK],
      ['toute la suite (pnpm test)', SUITE],
      ['le build', BUILD],
      ['la garde', GARDE],
      ['le dépôt de la version de dev', DÉPÔT_DE_LA_VERSION_DE_DEV],
    ]) {
      assert.ok(fait(jobs, motif), `passage en Ready (${a}) : aucun job ne joue ${quoi}`);
    }
    assert.ok(!fait(jobs, COMMENTAIRE), `passage en Ready (${a}) : un job commente la PR ou l'issue, ce qui la renverrait en brouillon (B6)`);
    const pose = surLÉtiquette(jobs, AJOUT);
    assert.ok(pose.length, `passage en Ready (${a}) : aucun job ne pose l'étiquette « ${ÉTIQUETTE} » sur l'issue`);
    for (const j of pose) {
      assert.ok(!/continue-on-error:\s*true/.test(j.lignes.join('\n')), `${j.clé} : un échec de la pose de l'étiquette ne doit pas passer vert`);
    }
    assert.deepEqual(clés(jobs), référence, `une PR ${a} hors brouillon ne lance pas les mêmes jobs qu'un passage en Ready`);
  }
});

test('#150 · B2 · au passage en Ready, chaque job ne tourne qu’une fois', () => {
  for (const a of PASSAGES) {
    const vus = clés(tournent(exécutions(surLaPR(a, false))));
    const doubles = vus.filter((c, i) => vus.indexOf(c) !== i);
    assert.deepEqual(doubles, [], `passage en Ready (${a}) : ces jobs tournent deux fois`);
  }
});

// ─── B1 · aucun vert trompeur ────────────────────────────────────────────────────────────────────

test('#150 · B1 · au passage en Ready, aucune exécution ne montre sauté un job qu’une autre joue', () => {
  for (const a of PASSAGES) {
    const exé = exécutions(surLaPR(a, false));
    const joués = new Set(clés(tournent(exé)));
    for (const x of exé) {
      const masques = x.jobs.filter((j) => !j.tourne && joués.has(j.clé)).map((j) => j.clé);
      assert.deepEqual(masques, [], `passage en Ready (${a}) : l'exécution ${x.événement} de ${x.workflow} montre sautés des jobs qu'une autre exécution joue`);
    }
  }
});

test('#150 · B1 · sur une PR prête, ce qui ne la change pas ne montre sauté aucun job du Ready', () => {
  const duReady = jobsDuReady();
  for (const a of SANS_CHANGEMENT) {
    for (const x of exécutions(surLaPR(a, false))) {
      const masques = x.jobs.filter((j) => !j.tourne && duReady.has(j.clé)).map((j) => j.clé);
      assert.deepEqual(masques, [], `${a} (${x.événement}) : ${x.workflow} montre sautés des jobs du Ready`);
    }
  }
});

// ─── B6 · tout changement renvoie en brouillon ───────────────────────────────────────────────────

/** Un changement : un job renvoie la PR en brouillon et le dit en commentaire, rien de lourd ne tourne. */
function renvoieEnBrouillon(quoi, événements) {
  const jobs = tournent(exécutions(événements));
  assert.ok(fait(jobs, EN_BROUILLON), `${quoi} : aucun job ne renvoie la PR en brouillon ; tournent : ${clés(jobs).join(', ') || 'aucun'}`);
  assert.ok(fait(jobs, COMMENTAIRE), `${quoi} : aucun job ne dit en commentaire le retour en brouillon`);
  assert.ok(surLÉtiquette(jobs, RETRAIT).length, `${quoi} : aucun job ne retire l'étiquette « ${ÉTIQUETTE} » de l'issue`);
  for (const [nom, motif] of LOURDS) assert.ok(!fait(jobs, motif), `${quoi} : un job joue ${nom}, qui attend le prochain Ready`);
}

test('#150 · B6 · tout changement d’une PR prête la renvoie en brouillon, avec un commentaire, sans rien lancer d’autre', () => {
  for (const [quoi, événements] of CHANGEMENTS_DE_LA_PR) renvoieEnBrouillon(`PR prête, ${quoi}`, événements);
});

test('#150 · B6 · tout changement de l’issue citée renvoie sa PR en brouillon, avec un commentaire, sans rien lancer d’autre', () => {
  for (const [quoi, événements] of CHANGEMENTS_DE_L_ISSUE) renvoieEnBrouillon(quoi, événements);
});

test('#150 · B2 · une modification d’une issue sans l’étiquette « en validation » ne lance aucun job', () => {
  for (const é of HORS_VALIDATION) {
    assert.deepEqual(clés(tournent(exécutions([é]))), [], `issue hors validation, ${é[0]} (${é[1].action}) : ces jobs tournent`);
  }
});

test('#150 · à la fermeture de la PR, fusionnée ou non, l’étiquette « en validation » est retirée de l’issue', () => {
  for (const merged of [true, false]) {
    const jobs = tournent(exécutions(surLaPR('closed', false, { pull_request: { ...PR(false), merged } })));
    assert.ok(surLÉtiquette(jobs, RETRAIT).length, `PR fermée (${merged ? 'fusionnée' : 'sans fusion'}) : aucun job ne retire l'étiquette`);
  }
});
