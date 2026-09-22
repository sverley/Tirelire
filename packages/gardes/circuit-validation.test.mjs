/**
 * Circuit de validation (#168, qui amende #150) : le brouillon ne coûte rien et ne valide rien, le
 * Ready joue toute la CI une fois, le porteur valide par un commentaire « Validé », que tout
 * changement annule, et aucun vert trompeur (B1).
 *
 * Les workflows de `.github/workflows/` sont joués à blanc (`workflow-a-blanc.mjs`) : pour chaque
 * événement, quels jobs passent leur condition. Un job qui tourne compte avec toutes ses étapes. Ce
 * qu'un job décide à l'exécution (le corps exact du commentaire, la tête lue par l'API) est hors
 * d'atteinte de cette lecture statique.
 *
 * L'étiquette « validée », posée sur la PR et son issue à la validation, dit sans démarrer de machine
 * qu'il y a une validation à annuler.
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
const ÉTIQUETTE = 'validée';
const CONTEXTE = 'Validé par le porteur';
const RECETTE = { TIRELIRE_DEV_FTP_DOSSIER: 'recette', TIRELIRE_DEV_SITE_URL: 'https://recette.example' };
const étiquettes = (validée) => (validée ? [{ name: 'besoin' }, { name: ÉTIQUETTE }] : [{ name: 'besoin' }]);
const PR = (draft, validée = false) => ({
  number: NUMÉRO,
  draft,
  body: `Close #${ISSUE}`,
  labels: étiquettes(validée),
  head: { sha: 'a'.repeat(40), ref: 'audit/168-validation-commentaire' },
  base: { sha: 'b'.repeat(40), ref: 'main' },
});
const ISSUE_DE_PR = (draft, validée = false) => ({ number: NUMÉRO, draft, labels: étiquettes(validée), pull_request: { url: `https://api.github.com/repos/o/r/pulls/${NUMÉRO}` } });
const ISSUE_SEULE = (validée = false) => ({ number: ISSUE, labels: étiquettes(validée), pull_request: null, body: 'Le besoin.' });
const AVIS = { id: 1, body: 'Un avis.', author_association: 'OWNER', created_at: '2026-09-23T10:00:00Z' };
const VALIDÉ = (association = 'OWNER') => ({ ...AVIS, body: 'Validé', author_association: association });

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
const surLaPR = (action, draft, validée = false, extra = {}) =>
  ['pull_request', 'pull_request_target'].map((nom) => [nom, { action, pull_request: PR(draft, validée), ...extra }]);

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
const COMMENTAIRE = /\bgh\s+(?:pr|issue)\s+comment\b|\bcreateComment\b|\baddComment\b|\bissues\/[^\s'"/]+\/comments\b(?![^\n]*since=)/;
const STATUT_DE_COMMIT = /\bstatuses\/[^\s'"]+/;
const RETRAIT = /--remove-label\b|\bremoveLabel\b/;
/** Les jobs qui posent le statut de validation : il vient de leur `env` ou de celui du workflow. */
const surLeStatut = (jobs, état) =>
  jobs.filter((j) => j.texte.includes(CONTEXTE) && j.commandes.some((c) => STATUT_DE_COMMIT.test(c) && new RegExp(`\\b${état}\\b`).test(c)));
const LOURDS = [
  ['le typecheck', TYPECHECK],
  ['toute la suite', SUITE],
  ['le build', BUILD],
  ['la garde', GARDE],
  ['le dépôt de la version de dev', DÉPÔT_DE_LA_VERSION_DE_DEV],
];
const PASSAGES = ['ready_for_review', 'opened', 'reopened'];

const CHANGEMENTS_DE_LA_PR = (validée) => [
  ['un commit', surLaPR('synchronize', false, validée)],
  ['une édition de la description', surLaPR('edited', false, validée, { changes: { body: { from: 'Avant.' } } })],
  ...['created', 'edited', 'deleted'].map((a) => [`un commentaire (${a})`, [['issue_comment', { action: a, issue: ISSUE_DE_PR(false, validée), comment: AVIS }]]]),
  [`un « Validé » modifié`, [['issue_comment', { action: 'edited', issue: ISSUE_DE_PR(false, validée), comment: VALIDÉ() }]]],
  ...['submitted', 'edited'].map((a) => [`une revue (${a})`, [['pull_request_review', { action: a, pull_request: PR(false, validée), review: { state: 'commented', ...AVIS } }]]]),
  ...['created', 'deleted'].map((a) => [`un commentaire de revue (${a})`, [['pull_request_review_comment', { action: a, pull_request: PR(false, validée), comment: AVIS }]]]),
];
const CHANGEMENTS_DE_L_ISSUE = (validée) => [
  ["une édition de l'issue", [['issues', { action: 'edited', issue: ISSUE_SEULE(validée), changes: { body: { from: 'Avant.' } } }]]],
  ...['created', 'edited', 'deleted'].map((a) => [`un commentaire sur l'issue (${a})`, [['issue_comment', { action: a, issue: ISSUE_SEULE(validée), comment: AVIS }]]]),
];
const SANS_CHANGEMENT = ['labeled', 'unlabeled', 'assigned', 'unassigned', 'review_requested', 'review_request_removed'];
const jobsDuReady = () => new Set(PASSAGES.flatMap((a) => clés(tournent(exécutions(surLaPR(a, false))))));

// ─── Le brouillon ne valide rien ─────────────────────────────────────────────────────────────────

test('#168 · aucun workflow ne convertit une PR en brouillon', () => {
  for (const { nom, yaml } of workflows()) assert.ok(!EN_BROUILLON.test(yaml), `${nom} convertit une PR en brouillon`);
});

test('#150 · sur un brouillon sans validation, ni ouverture, ni commit, ni édition, ni commentaire, ni revue ne lance un job', () => {
  const événements = [
    ...['opened', 'synchronize', 'reopened', 'edited'].flatMap((a) => surLaPR(a, true)),
    ...['submitted', 'edited'].map((a) => ['pull_request_review', { action: a, pull_request: PR(true), review: { state: 'commented', ...AVIS } }]),
    ...['created', 'edited', 'deleted'].map((a) => ['pull_request_review_comment', { action: a, pull_request: PR(true), comment: AVIS }]),
    ...['created', 'edited', 'deleted'].map((a) => ['issue_comment', { action: a, issue: ISSUE_DE_PR(true), comment: AVIS }]),
  ];
  for (const é of événements) assert.deepEqual(clés(tournent(exécutions([é]))), [], `brouillon, ${é[0]} (${é[1].action}) : ces jobs tournent`);
});

// ─── Le Ready joue toute la CI, une fois ─────────────────────────────────────────────────────────

test('#150 · le passage en Ready lance toute la CI et la version de dev, sans valider ni commenter', () => {
  const référence = clés(tournent(exécutions(surLaPR('ready_for_review', false))));
  for (const a of PASSAGES) {
    const jobs = tournent(exécutions(surLaPR(a, false)));
    for (const [quoi, motif] of LOURDS) assert.ok(fait(jobs, motif), `passage en Ready (${a}) : aucun job ne joue ${quoi}`);
    assert.ok(!fait(jobs, COMMENTAIRE), `passage en Ready (${a}) : un job commente la PR ou l'issue`);
    assert.deepEqual(surLeStatut(jobs, 'success'), [], `passage en Ready (${a}) : un job valide la PR à la place du porteur`);
    assert.deepEqual(clés(jobs), référence, `une PR ${a} hors brouillon ne lance pas les mêmes jobs qu'un passage en Ready`);
    const vus = clés(jobs);
    assert.deepEqual(vus.filter((c, i) => vus.indexOf(c) !== i), [], `passage en Ready (${a}) : des jobs tournent deux fois`);
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
  const duReady = jobsDuReady();
  for (const a of SANS_CHANGEMENT) {
    for (const x of exécutions(surLaPR(a, false))) {
      const masques = x.jobs.filter((j) => !j.tourne && duReady.has(j.clé)).map((j) => j.clé);
      assert.deepEqual(masques, [], `${a} (${x.événement}) : ${x.workflow} montre sautés des jobs du Ready`);
    }
  }
});

test('#168 · B1 · aucun job ne porte le nom du statut de validation : sauté, il passerait pour elle', () => {
  for (const { nom, yaml } of workflows()) {
    for (const j of jouer(yaml, contexte(['issue_comment', { action: 'created', issue: ISSUE_DE_PR(false), comment: AVIS }]))) {
      const affiché = (j.lignes.find((l) => /^ {4}name:/.test(l)) ?? '').replace(/^ {4}name:\s*/, '').replace(/^(['"])(.*)\1$/, '$2');
      assert.notEqual(affiché, CONTEXTE, `${nom} : le job « ${j.nom} » porte le nom du statut « ${CONTEXTE} »`);
    }
  }
});

// ─── « Validé » valide ───────────────────────────────────────────────────────────────────────────

test('#168 · « Validé » du porteur sur la PR pose le statut de validation, sans rien lancer de lourd', () => {
  for (const draft of [false, true]) {
    const jobs = tournent(exécutions([['issue_comment', { action: 'created', issue: ISSUE_DE_PR(draft), comment: VALIDÉ() }]]));
    assert.ok(surLeStatut(jobs, 'success').length, `« Validé » (${draft ? 'brouillon' : 'prête'}) : aucun job ne pose le statut « ${CONTEXTE} » en succès`);
    for (const [nom, motif] of LOURDS) assert.ok(!fait(jobs, motif), `« Validé » : un job joue ${nom}`);
  }
});

test('#168 · « Validé » écrit par un autre que le propriétaire du dépôt ne lance rien', () => {
  for (const association of ['COLLABORATOR', 'CONTRIBUTOR', 'MEMBER', 'NONE']) {
    const é = ['issue_comment', { action: 'created', issue: ISSUE_DE_PR(false), comment: VALIDÉ(association) }];
    assert.deepEqual(clés(tournent(exécutions([é]))), [], `« Validé » de ${association} : ces jobs tournent`);
  }
});

// ─── Tout changement annule ──────────────────────────────────────────────────────────────────────

function annule(quoi, événements) {
  const jobs = tournent(exécutions(événements));
  assert.ok(surLeStatut(jobs, 'failure').length, `${quoi} : aucun job ne passe le statut « ${CONTEXTE} » en échec ; tournent : ${clés(jobs).join(', ') || 'aucun'}`);
  assert.ok(fait(jobs, COMMENTAIRE), `${quoi} : aucun job ne dit en commentaire pourquoi la validation est annulée`);
  assert.ok(fait(jobs, RETRAIT), `${quoi} : aucun job ne retire l'étiquette « ${ÉTIQUETTE} »`);
  assert.ok(!fait(jobs, EN_BROUILLON), `${quoi} : un job renvoie la PR en brouillon`);
  for (const [nom, motif] of LOURDS) assert.ok(!fait(jobs, motif), `${quoi} : un job joue ${nom}`);
}

test('#168 · tout changement d’une PR validée annule la validation et le dit', () => {
  for (const [quoi, événements] of CHANGEMENTS_DE_LA_PR(true)) annule(`PR validée, ${quoi}`, événements);
});

test('#168 · tout changement de l’issue d’une PR validée annule la validation et le dit', () => {
  for (const [quoi, événements] of CHANGEMENTS_DE_L_ISSUE(true)) annule(quoi, événements);
  annule("le retrait à la main de l'étiquette", [['issues', { action: 'unlabeled', label: { name: ÉTIQUETTE }, issue: ISSUE_SEULE() }]]);
});

test('#168 · sans validation en cours, changer une PR prête ou son issue ne lance rien', () => {
  const événements = [...CHANGEMENTS_DE_LA_PR(false), ...CHANGEMENTS_DE_L_ISSUE(false)].flatMap(([, é]) => é);
  événements.push(['issues', { action: 'unlabeled', label: { name: 'besoin' }, issue: ISSUE_SEULE() }]);
  for (const é of événements) {
    const jobs = tournent(exécutions([é])).filter((j) => !jobsDuReady().has(j.clé));
    assert.deepEqual(clés(jobs), [], `sans validation, ${é[0]} (${é[1].action}) : ces jobs tournent`);
  }
});

test('#168 · à la fermeture d’une PR validée, l’étiquette « validée » est retirée, sans commentaire', () => {
  for (const merged of [true, false]) {
    const jobs = tournent(exécutions(surLaPR('closed', false, true, { pull_request: { ...PR(false, true), merged } })));
    assert.ok(fait(jobs, RETRAIT), `PR fermée (${merged ? 'fusionnée' : 'sans fusion'}) : aucun job ne retire l'étiquette`);
  }
});

test('témoin · le lecteur de conditions suit le filtre d’objets `.*` et `startsWith` comme GitHub', () => {
  const yaml = `name: t\non: issue_comment\njobs:\n  j:\n    if: contains(github.event.issue.labels.*.name, 'validée') || startsWith(github.event.comment.body, 'Validé')\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo j\n`;
  const joue = (labels, body) => jouer(yaml, contexte(['issue_comment', { action: 'created', issue: { ...ISSUE_SEULE(), labels }, comment: { body } }]))[0].tourne;
  assert.equal(joue(étiquettes(true), 'x'), true);
  assert.equal(joue(étiquettes(false), 'x'), false);
  assert.equal(joue([], 'validé'), true);
});
