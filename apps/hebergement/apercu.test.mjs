/**
 * Harnais du besoin #141 — l'aperçu web de chaque PR prête.
 *
 * Une PR prête dépose son site dans `<dossier de recette>/pr-<numéro>`, que `verifier.sh` vérifie en
 * ligne en constatant le commit servi ; sa fermeture retire ce sous-dossier, et seulement lui. Les
 * mêmes identifiants FTP que la production servent : une erreur de chemin effacerait la production
 * (D37). Ce harnais garde donc d'abord ce qui ne doit jamais arriver — déposer ou effacer ailleurs
 * que dans `<dossier>/pr-<numéro>` —, joué contre un vrai serveur FTP local (pyftpdlib), comme
 * `deposer.test.mjs`. Sauté si `lftp` ou `pyftpdlib` manquent, sauf avec `TIRELIRE_STRICT` (#59).
 *
 * Le contrat qu'il appelle est écrit dans l'issue (« Contrat appelé par le harnais ») :
 * `apercu.sh deposer|retirer`, `COMMIT_ATTENDU` pour `verifier.sh`, et ce que les workflows en
 * font. Un fichier de workflow ne peut pas accueillir de test : ce harnais les lit, comme
 * `distributions.test.mjs` (#69).
 *
 * Aucune adresse réelle ici : les adresses de test sont en `.test`, et l'adresse de recette ne
 * s'écrit dans aucun fichier suivi (#141).
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../..');
const APERCU = path.join(ICI, 'apercu.sh');
const WORKFLOWS = '.github/workflows';

const lftp = spawnSync('lftp', ['--version'], { stdio: 'ignore' }).status === 0;
const pyftpdlib = spawnSync('python3', ['-c', 'import pyftpdlib'], { stdio: 'ignore' }).status === 0;
const raison = !lftp ? 'lftp absent' : !pyftpdlib ? 'pyftpdlib absent' : false;
const strict = Boolean(process.env.TIRELIRE_STRICT);

// Distinct du port de `deposer.test.mjs` : `node --test` joue les fichiers en parallèle.
const PORT = 2122;

// ─── Outils ──────────────────────────────────────────────────────────────────────────────────────

function écrire(racine, rel, contenu) {
  mkdirSync(path.dirname(path.join(racine, rel)), { recursive: true });
  writeFileSync(path.join(racine, rel), contenu);
}

/** Tout ce que contient un dossier : chemin relatif → contenu (`''` pour un dossier). */
function instantané(racine) {
  const r = {};
  const parcourir = (d) => {
    for (const nom of readdirSync(d)) {
      const p = path.join(d, nom);
      const rel = path.relative(racine, p);
      if (statSync(p).isDirectory()) {
        r[`${rel}/`] = '';
        parcourir(p);
      } else r[rel] = readFileSync(p, 'utf8');
    }
  };
  parcourir(racine);
  return r;
}

const horsDe = (inst, préfixe) => Object.fromEntries(Object.entries(inst).filter(([k]) => !k.startsWith(préfixe)));

/** Ce que le serveur contient déjà : la production, la racine de recette, deux aperçus. */
function serveurDeTest(racine) {
  rmSync(racine, { recursive: true, force: true });
  écrire(racine, 'www/index.html', '<html>Tirelire production</html>');
  écrire(racine, 'www/donnees/salon-prod.jsonl', '{"id":1}\n');
  // Un chemin de production qui a la forme d'un aperçu : une erreur de dossier s'y verrait.
  écrire(racine, 'www/pr-12/index.html', '<html>à ne jamais toucher</html>');
  écrire(racine, 'recette/robots.txt', 'User-agent: *\nDisallow: /\n');
  écrire(racine, 'recette/pr-12/index.html', '<html>Tirelire pr-12 ancien</html>');
  écrire(racine, 'recette/pr-12/assets/vieux.js', '0');
  écrire(racine, 'recette/pr-12/donnees/salon-12.jsonl', '{"id":12}\n');
  écrire(racine, 'recette/pr-13/index.html', '<html>Tirelire pr-13</html>');
  écrire(racine, 'recette/pr-13/donnees/salon-13.jsonl', '{"id":13}\n');
  // Le dépôt précédent est plus ancien que le site qu'on dépose, comme en vrai : `mirror` compare
  // les dates, et un fichier distant plus récent ne serait pas remplacé.
  const avant = Date.now() / 1000 - 3600;
  for (const rel of Object.keys(instantané(racine))) if (!rel.endsWith('/')) utimesSync(path.join(racine, rel), avant, avant);
}

function siteDeTest(racine) {
  écrire(racine, 'index.html', '<html>Tirelire, l’aperçu neuf de la PR 12</html>');
  écrire(racine, 'relais.php', '<?php // relais');
  écrire(racine, '.htaccess', 'RewriteEngine On');
  écrire(racine, 'assets/index-neuf.js', 'console.log(1)');
}

function démarrerServeurFtp(racine) {
  const code = `
import sys
from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler
from pyftpdlib.servers import FTPServer
a = DummyAuthorizer()
a.add_user('simon', 'secret', sys.argv[1], perm='elradfmwMT')
h = FTPHandler
h.authorizer = a
FTPServer(('127.0.0.1', ${PORT}), h).serve_forever()
`;
  return spawn('python3', ['-c', code, racine], { stdio: 'ignore' });
}

/** Réglage d'un aperçu valide : la PR 12, un dossier de recette distinct de la production. */
const RECETTE = {
  NUMERO: '12',
  TIRELIRE_DEV_FTP_DOSSIER: 'recette',
  TIRELIRE_DEV_SITE_URL: 'https://recette.exemple.test',
  TIRELIRE_SITE_URL: 'https://production.exemple.test',
};

function apercu(action, env) {
  assert.ok(existsSync(APERCU), 'apps/hebergement/apercu.sh absent : rien ne dépose ni ne retire un aperçu (#141)');
  const complet = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    HOTE: `127.0.0.1:${PORT}`,
    UTILISATEUR: 'simon',
    MOTDEPASSE: 'secret',
    PROTOCOLE: 'ftp',
    ...env,
  };
  const r = spawnSync('bash', [APERCU, action], {
    env: Object.fromEntries(Object.entries(complet).filter(([, v]) => v !== undefined)),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Lance une commande sans bloquer la boucle : le serveur HTTP du test doit pouvoir répondre. */
function lancer(commande, args, env) {
  return new Promise((résoudre) => {
    const p = spawn(commande, args, { env: { ...process.env, ...env } });
    let sortie = '';
    p.stdout.on('data', (d) => (sortie += d));
    p.stderr.on('data', (d) => (sortie += d));
    p.on('close', (code) => résoudre({ code, sortie }));
  });
}

// ─── Dépôt et retrait, contre un vrai serveur FTP ───────────────────────────────────────────────

test('#141 · aperçu : déposé et retiré dans <dossier>/pr-<numéro>, jamais ailleurs', { skip: !strict && raison }, async (t) => {
  assert.equal(raison, false, `${raison}, alors que TIRELIRE_STRICT rend l'outil obligatoire`);
  const base = mkdtempSync(path.join(tmpdir(), 'apercu-'));
  const source = path.join(base, 'site');
  const distant = path.join(base, 'serveur');
  siteDeTest(source);
  serveurDeTest(distant);
  const serveur = démarrerServeurFtp(distant);
  await new Promise((r) => setTimeout(r, 600));

  const inchangé = (avant, message) => assert.deepEqual(instantané(distant), avant, message);

  try {
    await t.test('deposer : le site monte dans recette/pr-12, et rien d’autre ne bouge', () => {
      serveurDeTest(distant);
      const avant = instantané(distant);
      const r = apercu('deposer', { ...RECETTE, SOURCE: source });
      const après = instantané(distant);
      assert.equal(après['recette/pr-12/index.html'], '<html>Tirelire, l’aperçu neuf de la PR 12</html>', `le site n'est pas arrivé dans recette/pr-12 :\n${r.sortie}`);
      assert.equal(après['recette/pr-12/.htaccess'], 'RewriteEngine On', 'les fichiers cachés du site ne sont pas partis');
      assert.deepEqual(horsDe(après, 'recette/pr-12/'), horsDe(avant, 'recette/pr-12/'), 'un dépôt a touché hors de recette/pr-12');
    });

    for (const variable of ['TIRELIRE_DEV_FTP_DOSSIER', 'TIRELIRE_DEV_SITE_URL']) {
      await t.test(`deposer et retirer : sans ${variable}, rien ne bouge et la variable est nommée`, () => {
        for (const action of ['deposer', 'retirer']) {
          serveurDeTest(distant);
          const avant = instantané(distant);
          const r = apercu(action, { ...RECETTE, SOURCE: source, [variable]: undefined });
          inchangé(avant, `${action} sans ${variable} a modifié le serveur`);
          assert.match(r.sortie, new RegExp(variable), `${action} sans ${variable} ne le dit pas`);
        }
      });
    }

    const commeLaProduction = [
      ['dossier de recette = www, défaut de la production', { TIRELIRE_DEV_FTP_DOSSIER: 'www' }, 'TIRELIRE_DEV_FTP_DOSSIER'],
      ['dossier de recette = dossier de production, à la barre près', { TIRELIRE_FTP_DOSSIER: 'recette', TIRELIRE_DEV_FTP_DOSSIER: 'recette/' }, 'TIRELIRE_DEV_FTP_DOSSIER'],
      ['adresse de recette = adresse de production, à la barre près', { TIRELIRE_DEV_SITE_URL: `${RECETTE.TIRELIRE_SITE_URL}/` }, 'TIRELIRE_DEV_SITE_URL'],
    ];
    for (const [cas, réglage, variable] of commeLaProduction) {
      await t.test(`deposer et retirer : ${cas}, rien ne bouge`, () => {
        for (const action of ['deposer', 'retirer']) {
          serveurDeTest(distant);
          const avant = instantané(distant);
          const r = apercu(action, { ...RECETTE, SOURCE: source, ...réglage });
          inchangé(avant, `${action} (${cas}) a modifié le serveur`);
          assert.match(r.sortie, new RegExp(variable), `${action} (${cas}) ne nomme pas ${variable}`);
        }
      });
    }

    await t.test('deposer et retirer : un numéro qui n’est pas un entier positif ne fait rien', () => {
      for (const numéro of [undefined, '', '0', '-3', 'abc', '12/..', '../www', '12 13', '1e2']) {
        for (const action of ['deposer', 'retirer']) {
          serveurDeTest(distant);
          const avant = instantané(distant);
          apercu(action, { ...RECETTE, SOURCE: source, NUMERO: numéro });
          inchangé(avant, `${action} avec NUMERO=${JSON.stringify(numéro)} a modifié le serveur`);
        }
      }
    });

    await t.test('retirer : recette/pr-12 disparaît, paquets compris, et seulement lui', () => {
      serveurDeTest(distant);
      const avant = instantané(distant);
      const r = apercu('retirer', RECETTE);
      const après = instantané(distant);
      const restes = Object.keys(après).filter((k) => k.startsWith('recette/pr-12'));
      assert.deepEqual(restes, [], `recette/pr-12 n'est pas retiré :\n${r.sortie}`);
      assert.deepEqual(après, horsDe(avant, 'recette/pr-12'), 'le retrait a touché hors de recette/pr-12');
    });
  } finally {
    serveur.kill();
  }
});

// ─── Le commit servi ─────────────────────────────────────────────────────────────────────────────

test('#141 · verifier.sh constate le commit servi quand COMMIT_ATTENDU est donné', async (t) => {
  let page = '';
  const serveur = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  const adresse = `http://127.0.0.1:${serveur.address().port}/`;
  const verifier = (commit) => lancer('bash', [path.join(ICI, 'verifier.sh')], { ADRESSE_SITE: adresse, COMMIT_ATTENDU: commit });
  const lignesCommit = (sortie) => sortie.split('\n').filter((l) => /commit/i.test(l) && /[✓✗]/.test(l));
  const avecCommit = (c) => `<html><head><meta name="tirelire-commit" content="${c}"></head><body>Tirelire</body></html>`;

  try {
    await t.test('le commit servi est celui attendu : la ligne « commit » est réussie', async () => {
      page = avecCommit('abc1234');
      const { sortie } = await verifier('abc1234');
      const lignes = lignesCommit(sortie);
      assert.ok(lignes.some((l) => l.includes('✓')), `aucune ligne réussie ne parle du commit :\n${sortie}`);
      assert.ok(!lignes.some((l) => l.includes('✗')), `le bon commit est compté en échec :\n${sortie}`);
    });

    await t.test('un autre commit est servi : échec compté', async () => {
      page = avecCommit('abc1234');
      const { code, sortie } = await verifier('fff9999');
      assert.ok(lignesCommit(sortie).some((l) => l.includes('✗')), `un commit différent n'est pas relevé :\n${sortie}`);
      assert.notEqual(code, 0);
    });

    await t.test('la page ne dit pas son commit : échec compté', async () => {
      page = '<html><body>Tirelire</body></html>';
      const { sortie } = await verifier('abc1234');
      assert.ok(lignesCommit(sortie).some((l) => l.includes('✗')), `une page sans commit n'est pas relevée :\n${sortie}`);
    });
  } finally {
    serveur.close();
  }
});

// ─── Les workflows ───────────────────────────────────────────────────────────────────────────────

const lire = (rel) => readFileSync(path.join(RACINE, rel), 'utf8').replace(/\r\n?/g, '\n');

/** Les jobs d'un workflow : nom → texte de son bloc. `jobs:` est la dernière clé de premier niveau. */
function jobs(yaml) {
  const lignes = yaml.split('\n');
  const début = lignes.findIndex((l) => /^jobs:\s*$/.test(l));
  const blocs = new Map();
  if (début < 0) return blocs;
  let courant;
  for (let i = début + 1; i < lignes.length; i += 1) {
    const m = lignes[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (m) {
      courant = m[1];
      blocs.set(courant, []);
    } else if (courant && lignes[i].trim()) blocs.get(courant).push(lignes[i]);
  }
  return new Map([...blocs].map(([nom, l]) => [nom, l.join('\n')]));
}

function workflows() {
  return readdirSync(path.join(RACINE, WORKFLOWS))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => {
      const texte = lire(`${WORKFLOWS}/${f}`);
      const entête = texte.split('\njobs:')[0];
      const liste = entête.match(/^ {2}pull_request:\s*\n\s+types:\s*\[([^\]]*)\]/m);
      const types = liste
        ? liste[1].split(',').map((s) => s.trim())
        : /pull_request\b/.test(entête)
          ? ['opened', 'synchronize', 'reopened']
          : [];
      return { fichier: `${WORKFLOWS}/${f}`, texte, entête, types, jobs: jobs(texte) };
    });
}

const condition = (bloc) => bloc.match(/^ {4}if:\s*(.+)$/m)?.[1] ?? '';
const besoins = (bloc) => {
  const m = bloc.match(/^ {4}needs:\s*(.+)$/m);
  return m ? m[1].replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean) : [];
};

/** Le job est-il sauté quand `écarte` vaut pour sa condition, ou pour un job dont il dépend ? */
function sauté(w, nom, écarte, vus = new Set()) {
  if (vus.has(nom) || !w.jobs.has(nom)) return false;
  vus.add(nom);
  const bloc = w.jobs.get(nom);
  if (écarte(condition(bloc))) return true;
  if (/always\(\)/.test(condition(bloc))) return false;
  return besoins(bloc).some((n) => sauté(w, n, écarte, vus));
}

const horsDesPR = (si) => /event_name\s*!=\s*'pull_request'/.test(si) || /startsWith\(\s*github\.ref\s*,\s*'refs\/tags/.test(si);
const écarteBrouillon = (si) => horsDesPR(si) || /draft/.test(si);
const écarteFermeture = (si) =>
  horsDesPR(si) || /action\s*!=\s*'closed'/.test(si) || /state\s*==\s*'open'/.test(si) || /!\s*contains\([^)]*closed/.test(si);

/** Le job qui lance cette commande, avec son workflow. */
function trouver(motif) {
  for (const w of workflows()) for (const [nom, bloc] of w.jobs) if (motif.test(bloc)) return { w, nom, bloc };
  return null;
}

const voit = ({ w, bloc }, motif) => motif.test(bloc) || motif.test(w.entête);
const PUBLIE = /\/comments|gh\s+(pr|issue)\s+comment/;

test('#141 · workflows : le dépôt de l’aperçu, sur une PR prête', () => {
  const dépôt = trouver(/apercu\.sh\s+deposer/);
  assert.ok(dépôt, 'aucun job ne lance `apercu.sh deposer`');
  assert.ok(dépôt.w.types.length > 0, `${dépôt.w.fichier} : le job « ${dépôt.nom} » ne tourne pas sur les PR`);
  assert.ok(sauté(dépôt.w, dépôt.nom, écarteBrouillon), `${dépôt.w.fichier} : le job « ${dépôt.nom} » dépose aussi un brouillon`);
  for (const v of ['TIRELIRE_DEV_FTP_DOSSIER', 'TIRELIRE_DEV_SITE_URL', 'TIRELIRE_FTP_DOSSIER', 'TIRELIRE_SITE_URL']) {
    assert.ok(voit(dépôt, new RegExp(`vars\\.${v}\\b`)), `${dépôt.w.fichier} : le job « ${dépôt.nom} » ne reçoit pas \`vars.${v}\``);
  }
  assert.ok(voit(dépôt, /NUMERO:.*pull_request\.number/), `${dépôt.w.fichier} : le job « ${dépôt.nom} » ne passe pas le numéro de la PR dans NUMERO`);
  assert.ok(
    workflows().some((w) => /TIRELIRE_BASE:.*pull_request\.number/.test(w.texte)),
    'aucun job ne construit le site pour le sous-dossier de la PR (`TIRELIRE_BASE` avec le numéro de la PR)',
  );

  const vérif = trouver(/verifier\.sh[\s\S]*COMMIT_ATTENDU|COMMIT_ATTENDU[\s\S]*verifier\.sh/);
  assert.ok(vérif && voit(vérif, /vars\.TIRELIRE_DEV_SITE_URL\b/), 'aucun job ne lance `verifier.sh` sur l’aperçu avec `COMMIT_ATTENDU`');
  for (const j of [dépôt, vérif]) assert.doesNotMatch(j.bloc, PUBLIE, `${j.w.fichier} : le job « ${j.nom} » publie un commentaire`);
});

test('#141 · workflows : à la fermeture, le retrait seul', () => {
  const retrait = trouver(/apercu\.sh\s+retirer/);
  assert.ok(retrait, 'aucun job ne lance `apercu.sh retirer`');
  assert.ok(retrait.w.types.includes('closed'), `${retrait.w.fichier} : le workflow ne se déclenche pas à la fermeture d’une PR`);
  assert.ok(!sauté(retrait.w, retrait.nom, écarteFermeture), `${retrait.w.fichier} : le job « ${retrait.nom} » est sauté à la fermeture`);
  assert.ok(voit(retrait, /vars\.TIRELIRE_DEV_FTP_DOSSIER\b/), `${retrait.w.fichier} : le job « ${retrait.nom} » ne reçoit pas \`vars.TIRELIRE_DEV_FTP_DOSSIER\``);
  assert.doesNotMatch(retrait.bloc, PUBLIE, `${retrait.w.fichier} : le job « ${retrait.nom} » publie un commentaire`);

  const lourd = /pnpm (test|build|typecheck)\b|hebergement assembler|gradlew/;
  for (const w of workflows().filter((x) => x.types.includes('closed'))) {
    for (const [nom, bloc] of w.jobs) {
      if (lourd.test(bloc)) assert.ok(sauté(w, nom, écarteFermeture), `${w.fichier} : le job « ${nom} » relance tests ou build à la fermeture d’une PR (#131)`);
    }
  }
});

test('#141 · workflows : aucune adresse en dur en repli', () => {
  for (const w of workflows()) {
    assert.doesNotMatch(w.texte, /vars\.TIRELIRE_SITE_URL\s*\|\|/, `${w.fichier} : \`TIRELIRE_SITE_URL\` a encore une valeur de repli`);
    assert.doesNotMatch(w.texte, /vars\.TIRELIRE_DEV_[A-Z_]+\s*\|\|/, `${w.fichier} : une variable de recette a une valeur de repli`);
  }
});

// ─── #155 : les scripts de dépôt ne tournent jamais tels que la PR les propose ─────────────────────

test('#155 · workflows : `apercu.sh` et `deposer.sh` viennent de `main`, jamais de la branche de la PR', () => {
  // Que la PR les modifie ou non (c'est le point du besoin) : on cherche une source pinnée sur
  // `main`, pas une absence de modification du fichier lui-même.
  const sourceMain = /\bref:\s*['"]?main['"]?\b|\bgit\s+(?:show|checkout|fetch)\s+(?:origin\/)?main\b/;
  for (const motif of [/apercu\.sh\s+deposer/, /apercu\.sh\s+retirer/]) {
    const job = trouver(motif);
    assert.ok(job, `aucun job ne lance ${motif}`);
    assert.match(
      job.bloc,
      sourceMain,
      `${job.w.fichier} : le job « ${job.nom} » ne source rien depuis \`main\` — \`apercu.sh\`/\`deposer.sh\` y tournent tels que la branche de la PR les contient`,
    );
  }
});

test('#155 · workflows : les identifiants FTP ne sont visibles que des étapes qui déposent', () => {
  // Étendu à `apercu` seul : lui seul lance `pnpm install` et l'assemblage avec le code de la PR
  // avant tout dépôt ; `retrait-apercu` n'a qu'une étape après le checkout.
  const dépôt = trouver(/apercu\.sh\s+deposer/);
  assert.ok(dépôt, 'aucun job ne lance `apercu.sh deposer`');
  const envDeJob = dépôt.bloc.match(/^ {4}env:\n([\s\S]*?)\n {4}steps:/m)?.[1] ?? '';
  for (const secret of ['HOTE', 'UTILISATEUR', 'MOTDEPASSE']) {
    assert.doesNotMatch(
      envDeJob,
      new RegExp(`^\\s*${secret}:`, 'm'),
      `${dépôt.w.fichier} : le job « ${dépôt.nom} » expose ${secret} à toutes ses étapes — y compris \`pnpm install\` et l'assemblage, qui tournent avec le code de la PR avant tout dépôt`,
    );
  }
});

// ─── L'adresse de recette ────────────────────────────────────────────────────────────────────────

test('#141 · aucun fichier suivi ne nomme un autre hôte du domaine que la production', () => {
  // Le domaine de la production est public (`docs/`, #45) ; tout autre hôte de ce domaine serait
  // l'adresse de recette, qui ne s'écrit nulle part. Le motif ne la contient pas.
  const suivis = spawnSync('git', ['ls-files', '-z'], { cwd: RACINE, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
  const trouvés = [];
  for (const f of suivis) {
    const p = path.join(RACINE, f);
    if (!existsSync(p) || statSync(p).size > 2_000_000) continue;
    for (const [hôte] of readFileSync(p, 'utf8').matchAll(/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.sim-dev\.eu/gi)) {
      if (hôte.toLowerCase() !== 'tirelire.sim-dev.eu') trouvés.push(`${f} : ${hôte}`);
    }
  }
  assert.deepEqual(trouvés, [], 'un fichier suivi nomme un hôte qui n’est pas la production');
});
