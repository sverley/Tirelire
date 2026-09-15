/**
 * Harnais d'audit de #62 — « Une PR aux vérifications incomplètes ne se fusionne pas, ou sa fusion
 * se voit aussitôt », écrit par la session d'audit du 12 septembre 2026.
 *
 * L'offre gratuite refuse la protection de branche (#58, option B tranchée le 11 septembre) : rien
 * n'empêche une fusion ni un push. La garde est donc une alerte — une issue ouverte aussitôt — et
 * une règle écrite. Ce harnais part des deux « Fait quand » de #62, pas du code, et juge la garde en
 * boîte noire : il copie le dépôt, y joue les événements de GitHub Actions (`pull_request.closed`,
 * `push`) et simule GitHub au niveau de `fetch`, comme le fait `livraison-de-la-garde.test.mjs`. Seuls comptent
 * les issues ouvertes, leur contenu et le code de sortie.
 *
 * Contrat, décidé par l'audit et consigné dans la PR : la garde s'appelle
 * `node packages/gardes/cli.mjs alerte --github`, lit `GITHUB_EVENT_PATH`, `GITHUB_REPOSITORY` et
 * `GITHUB_TOKEN`, et ouvre l'issue par `POST /repos/{dépôt}/issues`. Pour lire la couleur d'une
 * vérification et rattacher un commit à sa PR, trois chemins sont simulés au choix
 * (`/commits/{sha}/check-runs`, `/commits/{sha}/status`, `/actions/runs?head_sha=…`, et
 * `/commits/{sha}/pulls`) : la garde en prend ce qu'elle veut.
 *
 * Tant que la garde n'existe pas, ce harnais est rouge, et c'est la PR de codage de #62 qui doit le
 * faire passer. Il tourne en CI, pas au commit (D62).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = 'packages/gardes/cli.mjs';
const WORKFLOWS = '.github/workflows';
const CIBLE = 'sverley/Tirelire';
const JETON = 'jeton-simule';

/** Rien de la CI qui joue ce harnais n'atteint la garde lancée : ni jeton, ni événement, ni résumé. */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([cle]) => !/^(GITHUB_|GIT_)/.test(cle) && !['CORPS', 'NODE_TEST_CONTEXT', 'FAUX_GITHUB'].includes(cle)),
);

const temporaires = [];
after(() => {
  for (const dossier of temporaires) rmSync(dossier, { recursive: true, force: true });
});

const lire = (racine, fichier) => readFileSync(join(racine, fichier), 'utf8');

/** Copie de l'arbre de travail, fichiers suivis et nouveaux : la garde telle qu'elle serait commitée. */
function copierDepot() {
  const racine = mkdtempSync(join(tmpdir(), 'tirelire-alerte-'));
  temporaires.push(racine);
  const liste = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: DEPOT, env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  for (const fichier of liste.split('\0').filter(Boolean)) {
    if (!existsSync(join(DEPOT, fichier))) continue; // supprimé dans l'arbre de travail
    mkdirSync(dirname(join(racine, fichier)), { recursive: true });
    cpSync(join(DEPOT, fichier), join(racine, fichier));
  }
  // Un dépôt git, au cas où la garde lise l'historique : une seule racine, réutilisée par tous les cas.
  const git = (...a) => execFileSync('git', a, { cwd: racine, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('-c', 'user.email=harnais@tirelire', '-c', 'user.name=harnais', 'commit', '-q', '-m', "copie pour le harnais d'audit de #62", '--no-verify');
  return racine;
}

let copie;
const depotCopie = () => (copie ??= copierDepot());

/** GitHub simulé au niveau de `fetch`, chargé avant la garde : même adresse, même jeton, même API qu'en CI. */
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

  // Recherche : les phrases entre guillemets doivent toutes figurer dans le titre.
  if (bouts[0] === 'search' && bouts[1] === 'issues') {
    const q = url.searchParams.get('q') || '';
    const phrases = (q.match(/"[^"]+"/g) || []).map((p) => p.slice(1, -1));
    const items = etat.issues.filter((i) => phrases.every((p) => i.title.includes(p)));
    return repondre(200, { total_count: items.length, incomplete_results: false, items });
  }
  if (bouts[0] !== 'repos' || bouts[1] + '/' + bouts[2] !== etat.depot) return repondre(404, { message: 'Not Found' });
  const reste = bouts.slice(3);

  // Couleur d'une vérification : « Vérifications manuelles » absente, verte ou rouge ; la CI toujours verte.
  const couleur = (sha) => etat.verification[sha] ?? null;
  const courses = (sha) => {
    const liste = [{ name: 'Tests et build web', status: 'completed', conclusion: 'success' }];
    if (couleur(sha)) liste.push({ name: 'Vérifications manuelles', status: 'completed', conclusion: couleur(sha) });
    return liste;
  };
  if (reste[0] === 'commits' && reste[2] === 'check-runs') {
    const liste = courses(reste[1]);
    return repondre(200, { total_count: liste.length, check_runs: liste });
  }
  if (reste[0] === 'commits' && reste[2] === 'status') {
    const c = couleur(reste[1]);
    return repondre(200, { state: c === 'failure' ? 'failure' : c === 'success' ? 'success' : 'pending', statuses: [], sha: reste[1] });
  }
  if (reste[0] === 'actions' && reste[1] === 'runs') {
    const sha = url.searchParams.get('head_sha');
    const liste = courses(sha).map((c) => ({ name: c.name, event: 'pull_request', status: c.status, conclusion: c.conclusion, head_sha: sha }));
    return repondre(200, { total_count: liste.length, workflow_runs: liste });
  }
  if (reste[0] === 'commits' && reste[2] === 'pulls') {
    const numeros = (etat.commits[reste[1]] || {}).pulls || [];
    return repondre(200, numeros.map((n) => etat.pulls[n]).filter(Boolean));
  }
  if (reste[0] === 'commits' && reste.length === 2) {
    const c = etat.commits[reste[1]];
    return c ? repondre(200, { sha: reste[1], author: { login: c.auteur }, commit: { message: c.message || '' } }) : repondre(404, { message: 'Not Found' });
  }
  if (reste[0] === 'pulls' && reste.length === 2) {
    const p = etat.pulls[reste[1]];
    return p ? repondre(200, p) : repondre(404, { message: 'Not Found' });
  }
  if (reste[0] === 'issues' && reste.length === 1 && methode === 'GET') {
    const etiquettes = (url.searchParams.get('labels') || '').split(',').filter(Boolean);
    const etatDemande = url.searchParams.get('state') || 'open';
    const liste = etat.issues.filter(
      (i) => (etatDemande === 'all' || i.state === etatDemande) && etiquettes.every((e) => i.labels.some((l) => l.name === e)),
    );
    return repondre(200, liste);
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
  if (reste[0] === 'issues' && reste[2] === 'comments' && methode === 'POST') {
    etat.commentaires.push({ issue: reste[1], body: envoye.body });
    return repondre(201, { id: etat.commentaires.length, body: envoye.body });
  }
  if (reste[0] === 'labels') return repondre(200, methode === 'POST' ? envoye : []);
  return repondre(405, { message: 'Non simulé : ' + methode + ' ' + url.pathname });
};
`;

/** Une scène : le dépôt copié, GitHub simulé, et de quoi jouer un événement. */
function scene() {
  const racine = depotCopie();
  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-scene-'));
  temporaires.push(dossier);
  const avant = join(dossier, 'faux-github.mjs');
  const fichier = join(dossier, 'faux-github.json');
  writeFileSync(avant, FAUX_GITHUB);
  writeFileSync(fichier, JSON.stringify({ depot: CIBLE, jeton: JETON, verification: {}, pulls: {}, commits: {}, issues: [], commentaires: [], appels: [] }));
  let n = 0;
  const etat = () => JSON.parse(readFileSync(fichier, 'utf8'));
  const modifier = (changer) => {
    const e = etat();
    changer(e);
    writeFileSync(fichier, JSON.stringify(e));
  };

  /**
   * Une PR fusionnée (ou seulement fermée), avec la couleur de sa vérification sur la tête fusionnée ;
   * `base` dit dans quelle branche elle est fusionnée.
   */
  const pr = ({ numero = 63, tete = 'aaa1111', fusion = 'mmm1111', verification = 'success', fusionnee = true, auteur = 'sverley', base = 'main' } = {}) => {
    modifier((e) => {
      e.pulls[numero] = {
        number: numero,
        title: 'Une livraison',
        merged: fusionnee,
        merged_at: fusionnee ? '2026-09-12T10:00:00Z' : null,
        merge_commit_sha: fusionnee ? fusion : null,
        merged_by: fusionnee ? { login: auteur } : null,
        user: { login: 'sverley' },
        head: { sha: tete, ref: 'feature/essai' },
        base: { ref: base },
        html_url: 'https://github.com/' + CIBLE + '/pull/' + numero,
      };
      if (verification) e.verification[tete] = verification;
      if (fusionnee) e.commits[fusion] = { pulls: [numero], auteur, message: 'Merge pull request #' + numero };
    });
    return { numero, tete, fusion };
  };

  /** L'événement `pull_request` de type `closed`, tel que GitHub l'écrit. */
  const fermeture = (numero) => jouer({ action: 'closed', number: Number(numero), pull_request: etat().pulls[numero], sender: { login: 'sverley' } }, 'pull_request');

  /** L'événement `push`, tel que GitHub l'écrit : `commits` du plus ancien au plus récent. */
  const push = ({ branche = 'main', shas = ['ddd1111'], auteur = 'sverley' } = {}) =>
    jouer(
      {
        ref: 'refs/heads/' + branche,
        before: '0000000',
        after: shas.at(-1),
        created: false,
        deleted: false,
        forced: false,
        commits: shas.map((s) => ({ id: s, message: 'travail', author: { name: auteur, username: auteur } })),
        head_commit: { id: shas.at(-1), message: 'travail', author: { name: auteur, username: auteur } },
        pusher: { name: auteur },
        sender: { login: auteur },
      },
      'push',
    );

  function jouer(evenement, nom) {
    const chemin = join(dossier, `evenement-${++n}.json`);
    writeFileSync(chemin, JSON.stringify({ ...evenement, repository: { full_name: CIBLE, default_branch: 'main' } }));
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(avant).href, join(racine, CLI), 'alerte', '--github'], {
      cwd: racine,
      env: { ...ENV, GITHUB_EVENT_PATH: chemin, GITHUB_EVENT_NAME: nom, GITHUB_REPOSITORY: CIBLE, GITHUB_TOKEN: JETON, GITHUB_SHA: evenement.after ?? '', FAUX_GITHUB: fichier },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}`, issues: etat().issues };
  }

  return { etat, modifier, pr, fermeture, push, jouer };
}

/** L'alerte est ouverte : une issue de plus, et la commande n'est pas tombée sur un usage inconnu. */
function alerte(r, cas) {
  assert.notEqual(r.code, 2, `la garde ne connaît pas « alerte --github » : ${cas}\n${r.sortie}`);
  assert.equal(r.issues.length, 1, `une issue attendue : ${cas}\n${r.sortie}`);
  return r.issues[0];
}

/** Rien ne s'est ouvert, et la garde est verte : le cas normal ne doit pas alerter. */
function silence(r, cas) {
  assert.notEqual(r.code, 2, `la garde ne connaît pas « alerte --github » : ${cas}\n${r.sortie}`);
  assert.deepEqual(r.issues, [], `aucune issue attendue : ${cas}\n${r.sortie}`);
  assert.equal(r.code, 0, `attendu vert : ${cas}\n${r.sortie}`);
}

const dit = (issue, ...morceaux) => {
  const texte = `${issue.title}\n${issue.body}`;
  for (const m of morceaux) assert.ok(texte.includes(m), `« ${m} » ne se lit pas dans l'alerte :\n${texte}`);
};

// ─── #62, point 1 · une fusion au rouge ouvre une issue ──────────────────────────────────────

test('#62 · une PR fusionnée alors que sa vérification est rouge ouvre aussitôt une issue qui le signale', () => {
  const s = scene();
  const { numero, tete } = s.pr({ verification: 'failure' });
  const issue = alerte(s.fermeture(numero), 'PR fusionnée au rouge');
  dit(issue, `#${numero}`);
  assert.ok(
    /rouge|non vérifiée|non validée|échec/i.test(`${issue.title}\n${issue.body}`),
    `l'alerte ne dit pas pourquoi elle s'ouvre :\n${issue.title}\n${issue.body}`,
  );
  assert.ok(issue.body.includes(tete) || issue.body.includes('Vérifications manuelles'), `l'alerte ne dit pas ce qui était rouge :\n${issue.body}`);
});

test("#62 · une vérification qui n'a jamais tourné sur la tête fusionnée vaut rouge", () => {
  const s = scene();
  const { numero } = s.pr({ verification: null });
  alerte(s.fermeture(numero), 'PR fusionnée sans vérification');
});

test('#62 · une PR fusionnée au vert n’ouvre rien', () => {
  const s = scene();
  const { numero } = s.pr({ verification: 'success' });
  silence(s.fermeture(numero), 'PR fusionnée au vert');
});

test('#62 · une PR fermée sans être fusionnée n’ouvre rien, même au rouge', () => {
  const s = scene();
  const { numero } = s.pr({ verification: 'failure', fusionnee: false });
  silence(s.fermeture(numero), 'PR fermée sans fusion');
});

// ─── #62, point 1 · un push direct sur main vaut fusion non vérifiée ─────────────────────────

test('#62 · un push direct sur main ouvre aussitôt une issue qui le signale', () => {
  const s = scene();
  const issue = alerte(s.push({ shas: ['ddd1111'] }), 'push direct sur main');
  dit(issue, 'ddd1111');
  assert.ok(/push|poussé/i.test(`${issue.title}\n${issue.body}`), `l'alerte ne dit pas qu'il s'agit d'un push :\n${issue.title}\n${issue.body}`);
});

test('#62 · la fusion d’une PR, qui est aussi un push sur main, n’ouvre pas une seconde issue', () => {
  const s = scene();
  const { fusion } = s.pr({ verification: 'success' });
  silence(s.push({ shas: [fusion] }), 'push de fusion, PR verte');
});

test('#62 · un push sur une autre branche que main n’ouvre rien', () => {
  const s = scene();
  silence(s.push({ branche: 'feature/essai', shas: ['eee1111'] }), 'push hors de main');
});

test('#62 · le même événement rejoué n’ouvre pas de doublon', () => {
  const s = scene();
  const { numero } = s.pr({ verification: 'failure' });
  alerte(s.fermeture(numero), 'première fusion au rouge');
  const rejoue = s.fermeture(numero);
  assert.equal(rejoue.issues.length, 1, `l'événement rejoué a ouvert une seconde issue :\n${rejoue.sortie}`);
});

// ─── #62 · cas ajoutés par l'audit du codage (PR #75) — mêmes « Fait quand », mêmes lectures ──
// Les exécutions multiples sur une même tête sont traitées à part, dans `alerte-fusion-relecture.test.mjs`.

test("#62 · une PR fusionnée ailleurs que dans main n’ouvre rien, même au rouge", () => {
  const s = scene();
  const { numero } = s.pr({ verification: 'failure', base: 'harnais/objectif-0-gardes' });
  silence(s.fermeture(numero), 'PR fusionnée dans une branche de travail');
});

test('#62 · une fusion au rouge ouvre une issue et une seule : le push qui la porte ne la double pas', () => {
  const s = scene();
  const { numero, fusion } = s.pr({ verification: 'failure' });
  alerte(s.fermeture(numero), 'fusion au rouge');
  const apres = s.push({ shas: [fusion] });
  assert.equal(apres.issues.length, 1, `la fusion au rouge a ouvert deux alertes, la fermeture puis le push :\n${apres.sortie}`);
  assert.equal(apres.code, 0, `le push d'une fusion déjà signalée devrait être vert :\n${apres.sortie}`);
});

test('#62 · deux pushs directs différents ouvrent chacun leur issue', () => {
  const s = scene();
  alerte(s.push({ shas: ['ddd1111'] }), 'premier push direct');
  const second = s.push({ shas: ['eee2222'] });
  assert.equal(second.issues.length, 2, `le second push direct n'a pas été signalé :\n${second.sortie}`);
  assert.notEqual(second.issues[0].title, second.issues[1].title, `les deux alertes portent le même titre :\n${second.issues.map((i) => i.title).join('\n')}`);
});

// ─── #62, point 1 · la garde est reliée aux événements de GitHub ─────────────────────────────

test('#62 · un workflow écoute la fermeture des PR et les pushs sur main, et peut ouvrir une issue', () => {
  const racine = depotCopie();
  const fichiers = readdirSync(join(racine, WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f));
  const candidats = fichiers
    .map((f) => ({ f, texte: lire(racine, `${WORKFLOWS}/${f}`) }))
    .filter(({ texte }) => {
      const on = texte.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1] ?? '';
      const ferme = /pull_request:[\s\S]*?types:[^\n]*closed/.test(on) || /pull_request:\s*\n\s+types:\s*\n(?:\s+-[^\n]*\n)*\s+-\s*closed/.test(on);
      const pousse = /push:[\s\S]*?branches:[^\n]*main/.test(on);
      return ferme && pousse;
    });
  assert.ok(
    candidats.length,
    `aucun workflow de ${WORKFLOWS} n'écoute à la fois « pull_request: [closed] » et « push » sur main : ${fichiers.join(', ')}`,
  );
  const { f, texte } = candidats[0];
  assert.match(texte, /issues:\s*write/, `${f} n'a pas le droit d'ouvrir une issue`);
  assert.match(texte, /cli\.mjs\s+alerte/, `${f} ne lance pas la garde d'alerte`);
});

// ─── #62, point 2 · la règle écrite dans CLAUDE.md ───────────────────────────────────────────

test('#62 · CLAUDE.md écrit la règle : un push direct sur main vaut fusion non vérifiée, et l’alerte ouvre une issue', () => {
  const texte = readFileSync(join(DEPOT, 'CLAUDE.md'), 'utf8');
  const i = texte.search(/push direct/i);
  assert.ok(i >= 0, "CLAUDE.md ne dit rien d'un push direct sur `main`");
  // La règle se lit d'un coup d'œil : ce qui l'énonce tient autour de « push direct », pas à l'autre bout du fichier.
  const fenetre = texte.slice(Math.max(0, i - 200), i + 300);
  assert.match(fenetre, /\bmain\b/, 'la règle sur le push direct ne nomme pas la branche `main`');
  assert.match(fenetre, /non vérifiée|sans vérification|vaut (une )?fusion/i, 'la règle ne dit pas qu’un push direct vaut fusion non vérifiée');
  assert.match(
    texte,
    /(ouvre|ouverte|s['’]ouvre|signale)[^.]{0,160}issue|issue[^.]{0,160}(ouvre|ouverte|signale)/i,
    "CLAUDE.md n'annonce pas l'alerte automatique",
  );
});
