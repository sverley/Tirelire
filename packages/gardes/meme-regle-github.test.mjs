/**
 * Harnais d'audit de #60 : sur GitHub, une même règle quelle que soit la façon d'ouvrir la PR, relue
 * à chaque modification de la description.
 *
 * « Fait quand » de #60 : une PR sans déclaration a sa vérification rouge, et passe au vert quand la
 * déclaration et les vérifications demandées y sont (analysées puis validées : décision 6 de #63) ;
 * modifier la description relance la vérification ; une PR ouverte par une session et une PR ouverte
 * à la main suivent la même règle.
 *
 * L'amorçage juge la règle sur `pr --base` et le déclencheur dans `verifications.yml`. Ce harnais joue
 * la commande que lance la vérification elle-même, `pr --github`, sur un dépôt copié et un GitHub
 * simulé au niveau de `fetch`, comme l'amorçage. La même PR s'ouvre de trois façons : par l'API sans
 * description, par l'API avec une description sans section, et à la main depuis le modèle, avec les
 * fins de ligne CRLF qu'un formulaire du navigateur peut envoyer. Chaque étape modifie la description
 * ou pousse un commit ; les trois PR doivent recevoir la même suite de verdicts.
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
const REGISTRE = 'docs/gardes.md';
const MODELE = '.github/pull_request_template.md';
const ANALYSE = "Relu par la session d'audit de #60 : essai sur un dépôt copié, rien de réel n'est vérifié.";
const RELIRE = "le harnais d'audit de #60 est à relire";

/** Rien de la CI qui joue ce harnais n'atteint la garde lancée : ni résumé, ni annotations, ni jeton, ni git. */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([cle]) => !/^(GITHUB_|GIT_)/.test(cle) && !['CORPS', 'NODE_TEST_CONTEXT'].includes(cle)),
);

const temporaires = [];
after(() => {
  for (const d of temporaires) rmSync(d, { recursive: true, force: true });
});

const lire = (racine, fichier) => readFileSync(join(racine, fichier), 'utf8');

// ─── Dépôt copié ─────────────────────────────────────────────────────────────────────────────

/** Dépôt git copié, fichiers suivis et nouveaux sans les ignorés : `main` porte le dépôt tel quel, la PR travaille sur `pr`. */
function depotGit() {
  const racine = mkdtempSync(join(tmpdir(), 'tirelire-meme-regle-'));
  temporaires.push(racine);
  const liste = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: DEPOT, env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  for (const fichier of liste.split('\0').filter(Boolean)) {
    if (!existsSync(join(DEPOT, fichier))) continue;
    mkdirSync(dirname(join(racine, fichier)), { recursive: true });
    cpSync(join(DEPOT, fichier), join(racine, fichier));
  }
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=Audit', '-c', 'user.email=audit@exemple.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: racine, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const commit = (message, fichiers) => {
    for (const [fichier, texte] of Object.entries(fichiers)) writeFileSync(join(racine, fichier), texte);
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'main');
  const base = commit('Base', {});
  git('checkout', '-q', '-b', 'pr');
  return { racine, commit, base };
}

/**
 * Une entrée qui demande des vérifications sans renvoyer à d'autres, et un fichier que ses `Chemins`
 * sont seuls à désigner : le modifier impose de déclarer cette entrée, et elle seule.
 */
function entreeEtChemin(racine) {
  const entrees = [];
  let e = null;
  for (const ligne of lire(racine, REGISTRE).split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(ligne)) {
      const titre = ligne.match(/^#{2,3}\s+([IUC]\d+)\s+·/);
      e = titre ? { id: titre[1], chemins: [], vms: [], renvoie: false } : null;
      if (e) entrees.push(e);
      continue;
    }
    if (!e) continue;
    if (/^Chemins\s*:/.test(ligne)) e.chemins.push(...[...ligne.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
    const vm = ligne.match(/^[-*]\s+\*\*Vérification manuelle\*\*\s+·\s+`([^`]+)`/);
    if (vm) e.vms.push(vm[1]);
    if (/^[-*]\s+\*\*Couvert par\*\*/.test(ligne)) e.renvoie = true;
  }
  const motifs = entrees.flatMap((x) => x.chemins.map((motif) => ({ id: x.id, motif })));
  for (const entree of entrees.filter((x) => x.vms.length && !x.renvoie)) {
    for (const chemin of entree.chemins) {
      if (/[*?]/.test(chemin) || !existsSync(join(racine, chemin))) continue;
      const autres = motifs.filter(({ id, motif }) => id !== entree.id && (motif === chemin || (/[*?]/.test(motif) && chemin.startsWith(motif.split(/[*?]/)[0]))));
      if (!autres.length) return { entree, chemin };
    }
  }
  return assert.fail(`aucun chemin du registre n'est propre à une entrée qui demande des vérifications : ${RELIRE}`);
}

// ─── GitHub simulé ───────────────────────────────────────────────────────────────────────────

/** Même simulation que l'amorçage : adresse, jeton et API de la CI, remplacés au niveau de `fetch`. */
const FAUX_GITHUB = `
import { readFileSync, writeFileSync } from 'node:fs';
const fichier = process.env.FAUX_GITHUB;
const pause = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => pause(fn, ms >= 1000 ? 0 : ms, ...args);
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
  const [, repos, proprietaire, nom, genre, numero, commentaires, ...reste] = url.pathname.split('/');
  const connu = repos === 'repos' && proprietaire + '/' + nom === etat.depot && Number(numero) === etat.pr.number && !reste.length;
  if (!connu || (commentaires && commentaires !== 'comments')) return repondre(404, { message: 'Not Found' });
  const envoye = options.body ? JSON.parse(options.body) : {};
  if (genre === 'pulls' && !commentaires && methode === 'GET') return repondre(200, etat.pr);
  if (genre === 'pulls' && !commentaires && methode === 'PATCH') { etat.pr.body = envoye.body; return repondre(200, etat.pr); }
  if (genre === 'issues' && commentaires && methode === 'GET') {
    const page = Number(url.searchParams.get('page') || 1);
    const parPage = Number(url.searchParams.get('per_page') || 30);
    return repondre(200, etat.commentaires.slice((page - 1) * parPage, page * parPage));
  }
  if (genre === 'issues' && commentaires && methode === 'POST') {
    const commentaire = { id: etat.commentaires.length + 1, user: { login: 'github-actions[bot]', type: 'Bot' }, body: envoye.body, created_at: new Date().toISOString() };
    etat.commentaires.push(commentaire);
    return repondre(201, commentaire);
  }
  return repondre(405, { message: 'Non simulé' });
};
`;

function githubSimule(depot, pr) {
  const avant = join(depot.racine, '.git', 'faux-github.mjs');
  const fichier = join(depot.racine, '.git', 'faux-github.json');
  writeFileSync(avant, FAUX_GITHUB);
  writeFileSync(fichier, JSON.stringify({ depot: 'sverley/Tirelire', jeton: 'jeton-simule', pr, commentaires: [], appels: [] }));
  let n = 0;
  const etat = () => JSON.parse(readFileSync(fichier, 'utf8'));
  const modifier = (changer) => {
    const e = etat();
    changer(e);
    writeFileSync(fichier, JSON.stringify(e));
  };
  /** Lance la vérification comme la CI, sur l'événement de GitHub. */
  const evenement = (action, changes) => {
    const e = etat();
    const chemin = join(depot.racine, '.git', `evenement-${++n}.json`);
    writeFileSync(chemin, JSON.stringify({ action, number: e.pr.number, pull_request: structuredClone(e.pr), sender: { login: 'sverley', type: 'User' }, ...(changes ? { changes } : {}) }));
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(avant).href, join(depot.racine, CLI), 'pr', '--github'], {
      cwd: depot.racine,
      env: { ...ENV, GITHUB_EVENT_PATH: chemin, GITHUB_REPOSITORY: e.depot, GITHUB_TOKEN: e.jeton, FAUX_GITHUB: fichier },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  /** Quelqu'un modifie la description : GitHub envoie « edited » avec l'ancienne. */
  const editer = (nouvelle) => {
    const from = etat().pr.body;
    modifier((e) => {
      e.pr.body = typeof nouvelle === 'function' ? nouvelle(from) : nouvelle;
    });
    return evenement('edited', { body: { from } });
  };
  const pousser = (message, fichiers) => {
    const sha = depot.commit(message, fichiers);
    modifier((e) => {
      e.pr.head.sha = sha;
    });
    return evenement('synchronize');
  };
  return { etat, editer, evenement, pousser };
}

const rouge = (r, cas) => assert.equal(r.code, 1, `attendu rouge : ${cas}\n${r.sortie}`);
const vert = (r, cas) => assert.equal(r.code, 0, `attendu vert : ${cas}\n${r.sortie}`);
const nomme = (r, ...noms) => {
  for (const nom of noms) assert.ok(r.sortie.includes(nom), `« ${nom} » n'est pas nommé :\n${r.sortie}`);
};
const cocherTout = (texte) => texte.replace(/\[ \] Validée/g, '[x] Validée');
const cochee = (texte) => /\[[xX]\] Validée/.test(texte ?? '');
const duBot = (e, marque) => e.commentaires.filter((c) => c.user.login === 'github-actions[bot]' && c.body.includes(marque));

// ─── Trois façons d'ouvrir la même PR ────────────────────────────────────────────────────────

const LF = (texte) => texte;
const CRLF = (texte) => texte.replace(/\r?\n/g, '\r\n');
const items = (vms) => vms.flatMap((cle) => [`- \`${cle}\` · essai`, `  - Analyse (audit, 2026-09-11) : ${ANALYSE}`, '  - [ ] Validée par un développeur humain']);

/** Une session écrit la description entière, par l'API. */
const parSession = (touches, masques, vms) =>
  ["Pour #… : essai du harnais d'audit de #60.", '', '## Ce qui change', '', 'Essai.', '', '## Invariants et contraintes', '', `Touchés : ${touches}`, `Lien possible masqué : ${masques}`, '', '### Vérifications manuelles', '', ...items(vms), ''].join('\n');

/** À la main, on remplit le modèle là où il le demande. */
function aLaMain(racine) {
  const modele = lire(racine, MODELE);
  for (const attendu of ['Touchés : à analyser', 'Lien possible masqué : à analyser', '### Vérifications manuelles']) {
    assert.ok(modele.includes(attendu), `« ${attendu} » manque au modèle ${MODELE} : ${RELIRE}`);
  }
  return (touches, masques, vms) =>
    `${modele
      .replace('Touchés : à analyser', `Touchés : ${touches}`)
      .replace('Lien possible masqué : à analyser', `Lien possible masqué : ${masques}`)
      .trimEnd()}\n\n${items(vms).join('\n')}\n`;
}

const FACONS = [
  { nom: 'ouverte par une session sans description', fins: LF, ouverture: () => null, remplir: () => parSession },
  { nom: 'ouverte par une session, description sans section', fins: LF, ouverture: () => "Pour #… : essai.\n\n## Ce qui change\n\nEssai.\n", remplir: () => parSession },
  { nom: 'ouverte à la main depuis le modèle, fins de ligne CRLF', fins: CRLF, ouverture: (racine) => lire(racine, MODELE), remplir: aLaMain },
];

for (const facon of FACONS) {
  test(`#60 · sur GitHub, une PR ${facon.nom} : rouge sans déclaration, relue à chaque modification, verte déclarée et validée`, () => {
    const depot = depotGit();
    const { entree, chemin } = entreeEtChemin(depot.racine);
    const code = (note) => ({ [chemin]: `${lire(depot.racine, chemin)}\n// ${note}\n` });
    const h1 = depot.commit('Code touché', code('première modification'));
    const ouverture = facon.ouverture(depot.racine);
    const declarer = (touches, masques, vms = []) => facon.fins(facon.remplir(depot.racine)(touches, masques, vms));
    const gh = githubSimule(depot, {
      number: 7,
      body: ouverture === null ? null : facon.fins(ouverture),
      head: { sha: h1, ref: 'pr' },
      base: { sha: depot.base, ref: 'main' },
    });

    rouge(gh.evenement('opened'), 'ouverte sans déclaration');

    let r = gh.editer(declarer('aucun', 'aucun'));
    rouge(r, `description modifiée : « aucun » alors que la PR modifie ${chemin}`);
    nomme(r, entree.id);

    r = gh.editer(declarer(entree.id, 'aucun', entree.vms));
    rouge(r, `description modifiée : ${entree.id} déclaré, vérifications analysées mais pas validées`);
    nomme(r, ...entree.vms);

    vert(gh.editer(cocherTout), 'cases cochées après analyse');
    assert.equal(duBot(gh.etat(), 'Validation enregistrée').length, 1, 'la validation cochée n’a pas été enregistrée');

    rouge(gh.pousser('Code encore', code('deuxième modification')), 'commit de code après la validation');
    assert.ok(!cochee(gh.etat().pr.body), 'la case annulée est restée cochée');
    assert.ok(gh.etat().pr.body.includes(`Touchés : ${entree.id}`), 'la description a perdu sa déclaration en décochant');

    vert(gh.editer(cocherTout), 'cases recochées après relecture');

    rouge(gh.editer(ouverture === null ? '' : facon.fins(ouverture)), 'description modifiée : déclaration retirée');
  });
}
