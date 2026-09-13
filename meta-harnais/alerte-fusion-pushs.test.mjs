/**
 * Relecture d'audit de #62 (PR #75), le 12 septembre 2026 — la lecture du push.
 *
 * Les deux harnais précédents jugent la fusion sous toutes ses couleurs, et le push sur le seul cas
 * droit : des commits neufs, poussés en avant. Or « un push direct sur `main` vaut fusion non
 * vérifiée » (#62) ne dit rien de la forme du push. Ce fichier éprouve les pushs qui ne vont pas
 * tout droit.
 *
 * Deux cas tiennent depuis le début : un push forcé qui réécrit `main` alerte, la suppression de la
 * branche ne dit rien.
 *
 * Deux cas ne tenaient pas, et ont d'abord été marqués « à faire », le temps que la question 1 de
 * #62 soit tranchée. Elle l'a été le 12 septembre : « si ça fait partie du besoin 62, ça va dans 75
 * sans question ». Un changement de `main` qu'aucune PR n'explique est un push direct, qu'il soit
 * forcé ou glissé au milieu d'une fusion : les deux cas sont fermes, et rouges tant que la garde ne
 * les tient pas.
 *
 * Même méthode que les deux autres : boîte noire, dépôt copié, GitHub simulé au niveau de `fetch`,
 * et seuls comptent les issues ouvertes et le code de sortie.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = 'packages/gardes/cli.mjs';
const CIBLE = 'sverley/Tirelire';
const JETON = 'jeton-simule';

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
  const racine = mkdtempSync(join(tmpdir(), 'tirelire-pushs-'));
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

/** GitHub simulé, réduit à ce qu'un événement `push` fait lire : le rattachement des commits, les issues. */
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
  if (url.origin !== 'https://api.github.com') return repondre(404, { message: 'Hors de GitHub' });
  if ((options.headers || {}).Authorization !== 'Bearer ' + etat.jeton) return repondre(401, { message: 'Bad credentials' });
  const envoye = options.body ? JSON.parse(options.body) : {};
  const bouts = url.pathname.split('/').filter(Boolean);
  if (bouts[0] !== 'repos' || bouts[1] + '/' + bouts[2] !== etat.depot) return repondre(404, { message: 'Not Found' });
  const reste = bouts.slice(3);

  // Aucune vérification n'est simulée : un push n'en lit pas, et une lecture ratée vaut rouge.
  if (reste[0] === 'actions' && reste[1] === 'runs') return repondre(200, { total_count: 0, workflow_runs: [] });
  if (reste[0] === 'commits' && reste[2] === 'check-runs') return repondre(200, { total_count: 0, check_runs: [] });
  if (reste[0] === 'commits' && reste[2] === 'pulls') {
    const numeros = (etat.commits[reste[1]] || {}).pulls || [];
    return repondre(200, numeros.map((n) => etat.pulls[n]).filter(Boolean));
  }
  if (reste[0] === 'issues' && reste.length === 1 && methode === 'GET') {
    const etatDemande = url.searchParams.get('state') || 'open';
    return repondre(200, etat.issues.filter((i) => etatDemande === 'all' || i.state === etatDemande));
  }
  if (reste[0] === 'issues' && reste.length === 1 && methode === 'POST') {
    const numero = 900 + etat.issues.length;
    const issue = {
      number: numero,
      title: envoye.title || '',
      body: envoye.body || '',
      state: 'open',
      labels: (envoye.labels || []).map((l) => (typeof l === 'string' ? { name: l } : l)),
      html_url: 'https://github.com/' + etat.depot + '/issues/' + numero,
    };
    etat.issues.push(issue);
    return repondre(201, issue);
  }
  return repondre(405, { message: 'Non simulé : ' + methode + ' ' + url.pathname });
};
`;

/** Une scène : le dépôt copié, GitHub simulé, et de quoi jouer un push. */
function scene() {
  const racine = depotCopie();
  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-scene-push-'));
  temporaires.push(dossier);
  const avant = join(dossier, 'faux-github.mjs');
  const fichier = join(dossier, 'faux-github.json');
  writeFileSync(avant, FAUX_GITHUB);
  writeFileSync(fichier, JSON.stringify({ depot: CIBLE, jeton: JETON, pulls: {}, commits: {}, issues: [] }));
  let n = 0;
  const etat = () => JSON.parse(readFileSync(fichier, 'utf8'));

  /** Une PR déjà fusionnée dans `main`, et le commit de fusion qu'elle a laissé. */
  const fusionPassee = ({ numero = 63, fusion = 'mmm1111' } = {}) => {
    const e = etat();
    e.pulls[numero] = {
      number: numero,
      title: 'Une livraison',
      merged: true,
      merged_at: '2026-09-12T10:00:00Z',
      merge_commit_sha: fusion,
      head: { sha: 'aaa1111', ref: 'feature/essai' },
      base: { ref: 'main' },
      html_url: 'https://github.com/' + CIBLE + '/pull/' + numero,
    };
    e.commits[fusion] = { pulls: [numero] };
    writeFileSync(fichier, JSON.stringify(e));
    return { numero, fusion };
  };

  /** L'événement `push`, tel que GitHub l'écrit ; `portes` sont les commits de la plage, `tete` le dernier. */
  const push = ({ portes = ['ddd1111'], tete = portes.at(-1), forced = false, deleted = false, auteur = 'sverley' } = {}) => {
    const evenement = {
      ref: 'refs/heads/main',
      before: 'bbb0000',
      after: deleted ? '0'.repeat(40) : tete,
      created: false,
      deleted,
      forced,
      commits: portes.map((s) => ({ id: s, message: 'travail', author: { name: auteur, username: auteur } })),
      head_commit: deleted ? null : { id: tete, message: 'travail', author: { name: auteur, username: auteur } },
      pusher: { name: auteur },
      sender: { login: auteur },
      repository: { full_name: CIBLE, default_branch: 'main' },
    };
    const chemin = join(dossier, `evenement-${++n}.json`);
    writeFileSync(chemin, JSON.stringify(evenement));
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(avant).href, join(racine, CLI), 'alerte', '--github'], {
      cwd: racine,
      env: { ...ENV, GITHUB_EVENT_PATH: chemin, GITHUB_EVENT_NAME: 'push', GITHUB_REPOSITORY: CIBLE, GITHUB_TOKEN: JETON, FAUX_GITHUB: fichier },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}`, issues: etat().issues };
  };

  return { etat, fusionPassee, push };
}

const alerte = (r, cas) => {
  assert.notEqual(r.code, 2, `la garde ne connaît pas « alerte --github » : ${cas}\n${r.sortie}`);
  assert.equal(r.issues.length, 1, `une issue attendue : ${cas}\n${r.sortie}`);
  return r.issues[0];
};

const silence = (r, cas) => {
  assert.notEqual(r.code, 2, `la garde ne connaît pas « alerte --github » : ${cas}\n${r.sortie}`);
  assert.deepEqual(r.issues, [], `aucune issue attendue : ${cas}\n${r.sortie}`);
  assert.equal(r.code, 0, `attendu vert : ${cas}\n${r.sortie}`);
};

// ─── Ce que la lecture du push tient déjà ────────────────────────────────────────────────────

test("#62 · un push forcé qui réécrit `main` avec des commits neufs ouvre une issue", () => {
  const s = scene();
  s.fusionPassee();
  const issue = alerte(s.push({ portes: ['zzz1111'], forced: true }), 'push forcé, commits neufs');
  assert.ok(/push|poussé/i.test(`${issue.title}\n${issue.body}`), `l'alerte ne dit pas qu'il s'agit d'un push :\n${issue.title}`);
});

test("#62 · la suppression de `main` n'ouvre rien : la branche n'a pas été modifiée", () => {
  const s = scene();
  silence(s.push({ portes: [], deleted: true, tete: '0'.repeat(40) }), 'branche supprimée');
});

// ─── Tranché par le porteur le 12 septembre : ces deux cas font partie de #62 ────────────────
// « Si ça fait partie du besoin 62, ça va dans 75 sans question. » Un changement de `main` qu'aucune
// PR n'explique est un push direct, forcé ou glissé au milieu d'une fusion : il ouvre une issue. Les
// deux cas cessent d'être « à faire » et deviennent fermes.

test(
  "#62 · un push forcé qui ramène `main` en arrière ouvre une issue",
  () => {
    const s = scene();
    const { fusion } = s.fusionPassee();
    // `main` recule sur un commit de fusion déjà présent : aucun commit neuf dans la plage, et
    // pourtant la branche a changé sans qu'aucune PR ne l'ait dit — des fusions ont pu disparaître.
    alerte(s.push({ portes: [], tete: fusion, forced: true }), 'push forcé de retour en arrière');
  },
);

test(
  '#62 · un commit direct poussé par-dessus une fusion locale ouvre une issue',
  () => {
    const s = scene();
    const { fusion } = s.fusionPassee();
    // La plage porte la fusion faite en local, puis un commit qui n'est passé par aucune PR : le
    // second n'a été vérifié par personne, et voyage sous le couvert du premier.
    const issue = alerte(s.push({ portes: [fusion, 'ddd1111'] }), 'fusion locale puis commit direct');
    assert.ok(issue.body.includes('ddd1111'), `l'alerte ne nomme pas le commit non vérifié :\n${issue.body}`);
  },
);
