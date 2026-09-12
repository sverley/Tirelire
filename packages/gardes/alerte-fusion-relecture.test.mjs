/**
 * Relecture d'audit de #62 (PR #75), le 12 septembre 2026.
 *
 * Le premier harnais (`alerte-fusion.test.mjs`) tient les deux « Fait quand » de #62, sur des cas où
 * la tête fusionnée n'a jamais qu'une exécution de « Vérifications manuelles ». La vie réelle d'une
 * PR n'est pas celle-là : elle rougit, on corrige, on coche, elle reverdit — la même tête porte alors
 * plusieurs exécutions, et une seule tranche. Ce fichier ajoute les erreurs plausibles par accident
 * que le premier ne pouvait pas voir (D62), et laisse le premier tel que la session d'audit de #74
 * l'a écrit.
 *
 * Quatre familles :
 * - plusieurs exécutions sur la même tête : c'est la plus récente terminée qui dit la couleur ;
 * - une exécution en cours n'efface pas une conclusion verte, mais seule elle vaut rouge ;
 * - une étiquette refusée par GitHub ne fait pas taire l'alerte ;
 * - l'idempotence tient au-delà de la première page d'issues (le dépôt en compte déjà plus de 75).
 *
 * Même méthode que le premier harnais : boîte noire, dépôt copié, GitHub simulé au niveau de `fetch`.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = 'packages/gardes/cli.mjs';
const CIBLE = 'sverley/Tirelire';
const JETON = 'jeton-simule';
const VERIFICATION = 'Vérifications manuelles';

const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([cle]) => !/^(GITHUB_|GIT_)/.test(cle) && !['CORPS', 'NODE_TEST_CONTEXT', 'FAUX_GITHUB'].includes(cle)),
);

const temporaires = [];
after(() => {
  for (const dossier of temporaires) rmSync(dossier, { recursive: true, force: true });
});

/** Copie de l'arbre de travail : la garde telle qu'elle serait commitée. Une seule, partagée. */
let copie;
function depotCopie() {
  if (copie) return copie;
  const racine = mkdtempSync(join(tmpdir(), 'tirelire-relecture-'));
  temporaires.push(racine);
  const liste = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: DEPOT, env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  for (const fichier of liste.split('\0').filter(Boolean)) {
    if (!existsSync(join(DEPOT, fichier))) continue;
    mkdirSync(dirname(join(racine, fichier)), { recursive: true });
    cpSync(join(DEPOT, fichier), join(racine, fichier));
  }
  return (copie = racine);
}

/**
 * GitHub simulé. Trois libertés de plus que dans le premier harnais : une tête porte une liste
 * d'exécutions, rendue du plus récent au plus ancien comme le fait l'API ; les issues se paginent
 * pour de bon ; et GitHub peut refuser une étiquette inconnue, comme il le fait sur un dépôt neuf.
 */
const FAUX_GITHUB = `
import { readFileSync, writeFileSync } from 'node:fs';
const fichier = process.env.FAUX_GITHUB;
globalThis.fetch = async (adresse, options = {}) => {
  const etat = JSON.parse(readFileSync(fichier, 'utf8'));
  const methode = options.method || 'GET';
  const url = new URL(adresse);
  const repondre = (statut, donnees) => {
    writeFileSync(fichier, JSON.stringify(etat));
    return new Response(JSON.stringify(donnees), { status: statut, headers: { 'Content-Type': 'application/json' } });
  };
  etat.appels.push(methode + ' ' + url.pathname + url.search);
  if (url.origin !== 'https://api.github.com') return repondre(404, { message: 'Hors de GitHub' });
  if ((options.headers || {}).Authorization !== 'Bearer ' + etat.jeton) return repondre(401, { message: 'Bad credentials' });
  const envoye = options.body ? JSON.parse(options.body) : {};
  const bouts = url.pathname.split('/').filter(Boolean);
  if (bouts[0] !== 'repos' || bouts[1] + '/' + bouts[2] !== etat.depot) return repondre(404, { message: 'Not Found' });
  const reste = bouts.slice(3);
  const courses = (sha) => etat.courses[sha] || [];

  if (reste[0] === 'actions' && reste[1] === 'runs') {
    const liste = courses(url.searchParams.get('head_sha'));
    return repondre(200, { total_count: liste.length, workflow_runs: liste });
  }
  if (reste[0] === 'commits' && reste[2] === 'check-runs') {
    const liste = courses(reste[1]);
    return repondre(200, { total_count: liste.length, check_runs: liste });
  }
  if (reste[0] === 'commits' && reste[2] === 'pulls') {
    const numeros = (etat.commits[reste[1]] || {}).pulls || [];
    return repondre(200, numeros.map((n) => etat.pulls[n]).filter(Boolean));
  }
  if (reste[0] === 'pulls' && reste.length === 2) {
    const p = etat.pulls[reste[1]];
    return p ? repondre(200, p) : repondre(404, { message: 'Not Found' });
  }
  if (reste[0] === 'issues' && reste.length === 1 && methode === 'GET') {
    const page = Number(url.searchParams.get('page') || 1);
    const parPage = Math.min(Number(url.searchParams.get('per_page') || 30), 100);
    return repondre(200, etat.issues.slice((page - 1) * parPage, page * parPage));
  }
  if (reste[0] === 'issues' && reste.length === 1 && methode === 'POST') {
    const demandees = (envoye.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
    const inconnue = demandees.find((l) => !etat.etiquettes.includes(l));
    if (inconnue) return repondre(422, { message: 'Validation Failed', errors: [{ resource: 'Label', code: 'invalid', field: inconnue }] });
    const numero = 900 + etat.issues.length;
    const issue = {
      number: numero,
      title: envoye.title || '',
      body: envoye.body || '',
      state: 'open',
      labels: demandees.map((name) => ({ name })),
      html_url: 'https://github.com/' + etat.depot + '/issues/' + numero,
    };
    etat.issues.push(issue);
    return repondre(201, issue);
  }
  return repondre(405, { message: 'Non simulé : ' + methode + ' ' + url.pathname });
};
`;

const course = (etat, conclusion = null) => ({ name: VERIFICATION, status: etat, conclusion, head_sha: '' });
/** La plus récente d'abord, comme l'API rend les exécutions. */
const verte = () => course('completed', 'success');
const rouge = () => course('completed', 'failure');
const enCours = () => course('in_progress');

function scene({ etiquettes = ['alerte', 'primaire'], issues = [] } = {}) {
  const racine = depotCopie();
  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-scene2-'));
  temporaires.push(dossier);
  const avant = join(dossier, 'faux-github.mjs');
  const fichier = join(dossier, 'faux-github.json');
  writeFileSync(avant, FAUX_GITHUB);
  writeFileSync(fichier, JSON.stringify({ depot: CIBLE, jeton: JETON, courses: {}, pulls: {}, commits: {}, issues, etiquettes, appels: [] }));
  let n = 0;
  const etat = () => JSON.parse(readFileSync(fichier, 'utf8'));
  const modifier = (changer) => {
    const e = etat();
    changer(e);
    writeFileSync(fichier, JSON.stringify(e));
  };

  /** Une PR fusionnée dans `main`, dont la tête porte la suite d'exécutions donnée. */
  const fusionner = ({ numero = 63, tete = 'aaa1111', fusion = 'mmm1111', executions = [verte()] } = {}) => {
    modifier((e) => {
      e.pulls[numero] = {
        number: numero,
        title: 'Une livraison',
        merged: true,
        merged_at: '2026-09-12T10:00:00Z',
        merge_commit_sha: fusion,
        merged_by: { login: 'sverley' },
        user: { login: 'sverley' },
        head: { sha: tete, ref: 'feature/essai' },
        base: { ref: 'main' },
        html_url: 'https://github.com/' + CIBLE + '/pull/' + numero,
      };
      e.courses[tete] = executions.map((c) => ({ ...c, head_sha: tete }));
      e.commits[fusion] = { pulls: [numero] };
    });
    const chemin = join(dossier, `evenement-${++n}.json`);
    writeFileSync(
      chemin,
      JSON.stringify({ action: 'closed', number: numero, pull_request: etat().pulls[numero], sender: { login: 'sverley' }, repository: { full_name: CIBLE, default_branch: 'main' } }),
    );
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(avant).href, join(racine, CLI), 'alerte', '--github'], {
      cwd: racine,
      env: { ...ENV, GITHUB_EVENT_PATH: chemin, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: CIBLE, GITHUB_TOKEN: JETON, FAUX_GITHUB: fichier },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}`, issues: etat().issues, appels: etat().appels };
  };

  return { etat, fusionner };
}

const neuves = (r, avant) => r.issues.slice(avant);
const alerte = (r, avant, cas) => {
  assert.notEqual(r.code, 2, `la garde ne connaît pas « alerte --github » : ${cas}\n${r.sortie}`);
  const ouvertes = neuves(r, avant);
  assert.equal(ouvertes.length, 1, `une alerte attendue : ${cas}\n${r.sortie}`);
  return ouvertes[0];
};
const silence = (r, avant, cas) => {
  assert.notEqual(r.code, 2, `la garde ne connaît pas « alerte --github » : ${cas}\n${r.sortie}`);
  assert.deepEqual(neuves(r, avant), [], `aucune alerte attendue : ${cas}\n${r.sortie}`);
  assert.equal(r.code, 0, `attendu vert : ${cas}\n${r.sortie}`);
};

// ─── La couleur se lit sur la dernière exécution, pas sur n'importe laquelle ──────────────────

test("#62 · une PR rouge puis corrigée et reverdie sur la même tête n'alerte pas", () => {
  // La vie normale d'une PR : elle rougit, on coche, elle reverdit. #63 a porté quatre exécutions
  // sur la même tête, la première rouge. Lire la mauvaise alerterait sur chaque PR jamais rouge.
  const s = scene();
  const r = s.fusionner({ executions: [verte(), verte(), rouge()] });
  silence(r, 0, 'rouge puis verte sur la même tête');
});

test('#62 · une PR verte puis repassée au rouge sur la même tête alerte', () => {
  const s = scene();
  const r = s.fusionner({ executions: [rouge(), verte()] });
  const issue = alerte(r, 0, 'verte puis rouge sur la même tête');
  assert.match(`${issue.title}\n${issue.body}`, /rouge|non vérifiée/i);
});

test("#62 · une exécution en cours n'efface pas la conclusion verte qui la précède", () => {
  // Cocher une case relance la vérification : au moment de la fusion, une exécution peut être en
  // vol au-dessus d'une conclusion verte. Alerter là serait un faux positif à chaque fusion rapide.
  const s = scene();
  silence(s.fusionner({ executions: [enCours(), verte()] }), 0, 'en cours par-dessus une verte');
});

test('#62 · une vérification seulement en cours, sans conclusion, vaut rouge', () => {
  const s = scene();
  alerte(s.fusionner({ executions: [enCours()] }), 0, 'en cours, aucune conclusion');
});

test('#62 · une exécution annulée vaut rouge, comme une absente', () => {
  const s = scene();
  const issue = alerte(s.fusionner({ executions: [course('completed', 'cancelled')] }), 0, 'exécution annulée');
  assert.ok(/annul|cancelled|rouge|non vérifiée/i.test(`${issue.title}\n${issue.body}`), `l'alerte ne dit pas ce qui clochait :\n${issue.body}`);
});

// ─── L'alerte passe avant son rangement ──────────────────────────────────────────────────────

test("#62 · une étiquette que le dépôt ne connaît pas ne fait pas taire l'alerte", () => {
  // Sur un dépôt neuf, ou si l'étiquette « alerte » est renommée, GitHub refuse la création en 422.
  const s = scene({ etiquettes: [] });
  const issue = alerte(s.fusionner({ executions: [rouge()] }), 0, 'étiquette refusée');
  assert.ok(issue.title.includes('#63'), `l'alerte ne nomme pas la PR :\n${issue.title}`);
});

// ─── L'idempotence ne tient pas qu'à la première page ────────────────────────────────────────

test("#62 · l'alerte déjà ouverte se retrouve au-delà de la première page d'issues", () => {
  // Le dépôt compte déjà plus de 75 issues et PR ; la centième arrive. Une relecture qui s'arrête à
  // la première page rouvrirait l'alerte à chaque rejeu.
  const anciennes = Array.from({ length: 120 }, (_, i) => ({ number: i + 1, title: `Une issue ordinaire ${i + 1}`, state: 'closed', labels: [] }));
  const deja = { number: 500, title: 'Fusion non vérifiée · PR #63', state: 'open', labels: [{ name: 'alerte' }] };
  const s = scene({ issues: [...anciennes, deja] });
  const avant = s.etat().issues.length;
  const r = s.fusionner({ executions: [rouge()] });
  assert.deepEqual(neuves(r, avant), [], `l'alerte a été rouverte alors qu'elle existait :\n${r.sortie}`);
  assert.ok(/#500/.test(r.sortie), `le bilan ne renvoie pas à l'alerte existante :\n${r.sortie}`);
});
