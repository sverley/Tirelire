/**
 * Harnais de #150 — le brouillon ne coûte rien, le passage en Ready joue toute la CI, et modifier la
 * description de la PR ou de son issue invalide toute validation : la PR repasse en brouillon, avec un
 * commentaire qui le dit (porteur, 21/09).
 *
 * Seule la CI a un harnais : la garde et la documentation se vérifient en relisant (complément du
 * porteur du 21/09 dans #150).
 *
 * Les workflows de `.github/workflows/` sont joués à blanc (`workflow-a-blanc.mjs`, repris de #153) :
 * pour chaque événement, quels jobs passent leur condition. Un job qui tourne compte avec toutes ses
 * étapes, même celles qu'une condition d'exécution (secret absent, sortie d'une étape) pourrait
 * sauter : ce qu'un job peut faire compte, pas seulement ce qu'il fait par défaut. Pas de petite CI :
 * l'auditeur et le codeur vérifient en local (porteur, 21/09).
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

/** Le bloc `on:` : événement → { types, inputs }. Formes lues : `on: x`, `on: [x, y]`, bloc renfoncé de deux espaces. */
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
    for (const e of valeurs(enLigne)) événements.set(e, { inputs: new Map() });
    return événements;
  }
  const bloc = [];
  for (const l of lignes.slice(i + 1)) {
    if (/^\S/.test(l)) break;
    bloc.push(l);
  }
  const liste = (k) => {
    const brut = bloc[k].replace(/^[^:]+:/, '').trim();
    if (brut) return valeurs(brut);
    const r = [];
    for (const l of bloc.slice(k + 1)) {
      if (!l.trim()) continue;
      const m = l.match(/^(\s*)-\s+(.+)$/);
      if (!m || m[1].length < bloc[k].search(/\S/)) break;
      r.push(sansGuillemets(m[2]));
    }
    return r;
  };
  let courant;
  let entrée;
  let dansInputs = false;
  bloc.forEach((l, k) => {
    const n = l.search(/\S/);
    const m = l.trim().match(/^([\w-]+):\s*(.*)$/);
    if (n < 0 || !m) return;
    if (n === 2) {
      événements.set(m[1], (courant = { inputs: new Map() }));
      dansInputs = false;
    } else if (courant && n === 4) {
      dansInputs = m[1] === 'inputs';
      if (m[1] === 'types') courant.types = liste(k);
    } else if (courant && dansInputs && n === 6) {
      courant.inputs.set(m[1], (entrée = {}));
    } else if (entrée && dansInputs && n === 8) {
      entrée[m[1]] = m[1] === 'options' ? liste(k) : sansGuillemets(m[2]);
    }
  });
  return événements;
}

const TYPES_PAR_DÉFAUT = ['opened', 'synchronize', 'reopened'];
const lancé = (décl, événement, action) => {
  const e = décl.get(événement);
  return !!e && (!action || (e.types ?? (/^pull_request/.test(événement) ? TYPES_PAR_DÉFAUT : [action])).includes(action));
};

// ─── Contextes ───────────────────────────────────────────────────────────────────────────────────

const NUMÉRO = 150;
const BRANCHE = 'outillage/150-brouillon-ready';
const RECETTE = { TIRELIRE_DEV_FTP_DOSSIER: 'recette', TIRELIRE_DEV_SITE_URL: 'https://recette.example' };
const contextePR = (événement, action, draft, changes = {}) => ({
  github: {
    event_name: événement,
    ref: `refs/pull/${NUMÉRO}/merge`,
    ref_name: `${NUMÉRO}/merge`,
    event: {
      action,
      changes,
      pull_request: {
        number: NUMÉRO,
        draft,
        body: `Close #${NUMÉRO}`,
        head: { sha: 'a'.repeat(40), ref: BRANCHE },
        base: { sha: 'b'.repeat(40), ref: 'main' },
      },
    },
  },
  vars: { ...RECETTE },
  secrets: {},
  inputs: {},
});
/** L'issue citée par `Close #n` de la PR, modifiée : l'événement `issues`, lu sur main. */
const contexteIssue = (action, changes) => ({
  github: {
    event_name: 'issues',
    ref: 'refs/heads/main',
    ref_name: 'main',
    event: { action, changes, issue: { number: NUMÉRO, body: 'Le besoin.', pull_request: null } },
  },
  vars: { ...RECETTE },
  secrets: {},
  inputs: {},
});

const avecCommandes = (nom) => (j) => ({ ...j, workflow: nom, commandes: étapes(j.lignes).map(commande) });

const ÉVÉNEMENTS_PR = ['pull_request', 'pull_request_target'];

/** Les jobs lancés, tous workflows confondus, par cet événement de PR. */
const lancésSurPR = (événement, action, draft, changes) =>
  workflows().flatMap(({ nom, yaml }) =>
    lancé(déclencheurs(yaml), événement, action)
      ? jouer(yaml, contextePR(événement, action, draft, changes)).filter((j) => j.tourne).map(avecCommandes(nom))
      : [],
  );

/** Les jobs lancés, tous workflows confondus, quand l'issue est modifiée. */
const lancésSurIssue = (action, changes) =>
  workflows().flatMap(({ nom, yaml }) =>
    lancé(déclencheurs(yaml), 'issues', action) ? jouer(yaml, contexteIssue(action, changes)).filter((j) => j.tourne).map(avecCommandes(nom)) : [],
  );

const nomDe = (j) => `${j.workflow} › ${j.nom}`;
const fait = (jobs, motif) => jobs.some((j) => j.commandes.some((c) => motif.test(c)));

const TYPECHECK = /\bpnpm\s+(?:-r\s+)?typecheck\b/;
/** Toute la suite, telle que le job de tests la joue. */
const SUITE = /^\s*(?:-\s+)?run:\s*pnpm\s+(?:-r\s+)?test\s*$/m;
const BUILD = /\bpnpm\s+(?:-r\s+)?(?:run\s+)?build\b/;
const GARDE = /packages\/gardes\/cli\.mjs/;
const DÉPÔT_DE_LA_VERSION_DE_DEV = /apercu\.sh\s+deposer/;
const EN_BROUILLON = /convertPullRequestToDraft|\bgh\s+pr\s+ready\b[^\n]*--undo/;
const COMMENTAIRE = /\bgh\s+(?:pr|issue)\s+comment\b|createComment|addComment|\/comments\b/;
/** Ce qu'une modification de description ne doit pas lancer : c'est au prochain Ready de le faire. */
const LOURDS = [
  ['le typecheck', TYPECHECK],
  ['toute la suite', SUITE],
  ['le build', BUILD],
  ['la garde', GARDE],
  ['le dépôt de la version de dev', DÉPÔT_DE_LA_VERSION_DE_DEV],
];
const CORPS_MODIFIÉ = { body: { from: 'Avant.' } };

/** Une modification invalide : un job repasse la PR en brouillon et le dit en commentaire, rien d'autre ne tourne. */
function invalide(jobs, quoi) {
  assert.ok(fait(jobs, EN_BROUILLON), `${quoi} : aucun job ne repasse la PR en brouillon ; tournent : ${jobs.map(nomDe).join(', ') || 'aucun'}`);
  assert.ok(fait(jobs, COMMENTAIRE), `${quoi} : aucun job n'ajoute de commentaire pour dire le passage en brouillon`);
  for (const [nom, motif] of LOURDS) assert.ok(!fait(jobs, motif), `${quoi} : un job joue ${nom}, qui attend le prochain Ready`);
}

// ─── Le circuit des PR ───────────────────────────────────────────────────────────────────────────

test('#150 · ouvrir un brouillon ou pousser dessus ne lance aucun job', () => {
  for (const événement of ÉVÉNEMENTS_PR) {
    for (const action of TYPES_PAR_DÉFAUT) {
      assert.deepEqual(lancésSurPR(événement, action, true).map(nomDe), [], `brouillon (${événement}, ${action}) : ces jobs tournent`);
    }
  }
});

test('#150 · modifier la description d’une PR prête la repasse en brouillon, avec un commentaire, sans rien lancer d’autre', () => {
  invalide(
    ÉVÉNEMENTS_PR.flatMap((e) => lancésSurPR(e, 'edited', false, CORPS_MODIFIÉ)),
    'description de la PR modifiée',
  );
});

test('#150 · modifier la description de l’issue repasse sa PR en brouillon, avec un commentaire, sans rien lancer d’autre', () => {
  invalide(lancésSurIssue('edited', CORPS_MODIFIÉ), 'description de l’issue modifiée');
});

test('#150 · sur un brouillon, modifier une description ne lance ni tests, ni garde, ni version de dev', () => {
  const jobs = ÉVÉNEMENTS_PR.flatMap((e) => lancésSurPR(e, 'edited', true, CORPS_MODIFIÉ));
  for (const [nom, motif] of LOURDS) assert.ok(!fait(jobs, motif), `brouillon modifié : un job joue ${nom}`);
});

test('#150 · le passage en Ready lance toute la CI, comme chaque push sur une PR prête', () => {
  // La validation peut tourner sur `pull_request_target` (#159) : les deux événements comptent.
  const surPR = (action) => ÉVÉNEMENTS_PR.flatMap((e) => lancésSurPR(e, action, false));
  const prêt = surPR('ready_for_review');
  for (const [quoi, motif] of [
    ['le typecheck', TYPECHECK],
    ['toute la suite (pnpm test)', SUITE],
    ['le build', BUILD],
    ['la garde', GARDE],
    ['le dépôt de la version de dev', DÉPÔT_DE_LA_VERSION_DE_DEV],
  ]) {
    assert.ok(fait(prêt, motif), `au passage en Ready, aucun job ne joue ${quoi}`);
  }
  const push = surPR('synchronize');
  assert.deepEqual(push.map(nomDe).sort(), prêt.map(nomDe).sort(), 'un push sur une PR prête ne lance pas les mêmes jobs que le passage en Ready');
});
