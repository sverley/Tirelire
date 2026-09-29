/**
 * Harnais d'audit de #233, composé par #285 parmi les tests du codeur (D83) : un test qui porte
 * sa propre marque est retenu à ce niveau ; les autres restent au niveau 4.
 *
 * #233 — la version de développement, le site de `main`, se dépose à la racine de la recette
 * (`apercu.sh racine-deposer`). Cette racine porte aussi ce qui ne vient pas du site : les aperçus
 * des PR (`pr-<numéro>`), le `robots.txt` posé à la main, les paquets du relais de la recette et sa
 * configuration. Le dépôt les laisse en place, nettoyage compris (`NETTOYER=oui`, qui passe
 * `--delete` à lftp), et ne touche rien hors de la racine de la recette. Joué contre un vrai serveur
 * FTP local (pyftpdlib), comme `deposer.test.mjs` et `apercu.test.mjs` ; sauté si `lftp` ou
 * `pyftpdlib` manquent, sauf avec `TIRELIRE_STRICT` (#59).
 *
 * Où chaque événement dépose (points 1 et 2 de #233) se lit dans le workflow joué à blanc :
 * `packages/gardes/distributions.test.mjs`. Aucune adresse réelle ici (#141).
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { describe } from 'node:test';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const APERCU = path.join(ICI, 'apercu.sh');

const lftp = spawnSync('lftp', ['--version'], { stdio: 'ignore' }).status === 0;
const pyftpdlib = spawnSync('python3', ['-c', 'import pyftpdlib'], { stdio: 'ignore' }).status === 0;
const raison = !lftp ? 'lftp absent' : !pyftpdlib ? 'pyftpdlib absent' : false;
const strict = Boolean(process.env.TIRELIRE_STRICT);

// Distinct des ports de `deposer.test.mjs` et `apercu.test.mjs` : `node --test` joue les fichiers en parallèle.
const PORT = 2123;

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

const choisir = (inst, garder) => Object.fromEntries(Object.entries(inst).filter(([k]) => garder(k)));

/** Ce qui vit à la racine de la recette sans venir du site, et doit y rester. */
const À_GARDER = {
  'recette/robots.txt': 'User-agent: *\nDisallow: /\n',
  'recette/donnees/salon-dev.jsonl': '{"id":1}\n',
  'recette/relais.config.php': '<?php return [];',
  'recette/pr-12/index.html': '<html>Tirelire pr-12</html>',
  'recette/pr-12/.htaccess': 'RewriteEngine On',
  'recette/pr-12/assets/pr12.js': '12',
  'recette/pr-12/donnees/salon-12.jsonl': '{"id":12}\n',
  'recette/pr-307/index.html': '<html>Tirelire pr-307</html>',
};
const gardé = (k) => k.startsWith('recette/pr-') || Object.hasOwn(À_GARDER, k);

/** Le serveur avant le dépôt : la production, et la racine de la recette avec un ancien site. */
function serveurDeTest(racine) {
  rmSync(racine, { recursive: true, force: true });
  écrire(racine, 'www/index.html', '<html>Tirelire production</html>');
  écrire(racine, 'www/assets/prod.js', 'prod');
  écrire(racine, 'www/donnees/salon-prod.jsonl', '{"id":0}\n');
  écrire(racine, 'recette/index.html', '<html>Tirelire, ancienne version de développement</html>');
  écrire(racine, 'recette/assets/index-vieux.js', 'console.log(0)');
  for (const [rel, contenu] of Object.entries(À_GARDER)) écrire(racine, rel, contenu);
  // Le dépôt précédent est plus ancien que le site qu'on dépose : `mirror` compare les dates.
  const avant = Date.now() / 1000 - 3600;
  for (const rel of Object.keys(instantané(racine))) if (!rel.endsWith('/')) utimesSync(path.join(racine, rel), avant, avant);
}

/** Le site assemblé, tel que le produit `assembler.mjs` : son dossier `donnees/` n'a que son `.htaccess`. */
function siteDeTest(racine) {
  écrire(racine, 'index.html', '<html>Tirelire, version de développement neuve</html>');
  écrire(racine, 'relais.php', '<?php // relais');
  écrire(racine, '.htaccess', 'RewriteEngine On');
  écrire(racine, 'assets/index-neuf.js', 'console.log(1)');
  écrire(racine, 'donnees/.htaccess', 'Require all denied');
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

/** Réglages valides : un dossier de recette distinct de la production, une adresse de recette. */
const RECETTE = {
  TIRELIRE_DEV_FTP_DOSSIER: 'recette',
  TIRELIRE_DEV_SITE_URL: 'https://recette.exemple.test',
  TIRELIRE_SITE_URL: 'https://production.exemple.test',
};

function apercu(action, env) {
  const complet = { PATH: process.env.PATH, HOME: process.env.HOME, HOTE: `127.0.0.1:${PORT}`, UTILISATEUR: 'simon', MOTDEPASSE: 'secret', PROTOCOLE: 'ftp', ...env };
  const r = spawnSync('bash', [APERCU, action], {
    env: Object.fromEntries(Object.entries(complet).filter(([, v]) => v !== undefined)),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// Un cas de D83, « Livraison » (#233) — la version de développement se vérifie à la racine de la
// recette.
describe('[niveau 4] D83, livraison (#233) · l’adresse de la version de développement, sans numéro de PR', () => {
  test('[niveau 2] racine-reglages : l’adresse de la racine de la recette, sans numéro de PR', () => {
    const r = apercu('racine-reglages', { ...RECETTE, TIRELIRE_DEV_SITE_URL: 'https://Recette.Exemple.test/' });
    assert.equal(r.code, 0, r.sortie);
    assert.equal(r.sortie.trim(), 'adresse=https://recette.exemple.test/');
  });
});

// Même besoin que « témoin rouge · une CI qui dépose main en production »
// (packages/gardes/distributions.test.mjs, niveau 1) : D83, « Livraison » — « La production ne suit
// que les versions publiées : seul un tag v* la dépose ; ni un push sur main, ni un lancement manuel
// ne la touchent » —, ce que constate aussi `VM-C3-depot-main` au registre (C3). Les mêmes
// identifiants FTP servent : un dossier faux, avec le nettoyage, déposerait main en production et en
// effacerait ce qui n'est pas dans le site. Les autres cas du dépôt (aperçus, robots.txt et paquets
// laissés en place, adresse de recette manquante) vont avec, le démarrage du serveur FTP pesant seul.
describe('[niveau 4] D83, livraison (#233) · main se dépose à la racine de la recette, jamais en production', () => {
  test('[niveau 1] racine-deposer : le site monte à la racine de la recette ; aperçus, robots.txt et paquets du relais restent, nettoyage compris', { skip: !strict && raison }, async (t) => {
    assert.equal(raison, false, `${raison}, alors que TIRELIRE_STRICT rend l'outil obligatoire`);
    const base = mkdtempSync(path.join(tmpdir(), 'racine-recette-'));
    const source = path.join(base, 'site');
    const distant = path.join(base, 'serveur');
    siteDeTest(source);
    serveurDeTest(distant);
    const serveur = démarrerServeurFtp(distant);
    await new Promise((r) => setTimeout(r, 600));

    try {
      for (const nettoyer of ['oui', 'non']) {
        await t.test(`NETTOYER=${nettoyer}`, () => {
          serveurDeTest(distant);
          const avant = instantané(distant);
          // Un NUMERO resté dans l'environnement ne change rien : la racine n'est pas un aperçu.
          const r = apercu('racine-deposer', { ...RECETTE, SOURCE: source, NETTOYER: nettoyer, NUMERO: '12' });
          const après = instantané(distant);
          assert.equal(r.code, 0, r.sortie);
          assert.equal(après['recette/index.html'], '<html>Tirelire, version de développement neuve</html>', `le site n'est pas arrivé à la racine de la recette :\n${r.sortie}`);
          assert.equal(après['recette/.htaccess'], 'RewriteEngine On', 'les fichiers cachés du site ne sont pas partis');
          assert.equal(après['recette/assets/index-neuf.js'], 'console.log(1)');
          assert.deepEqual(choisir(après, gardé), choisir(avant, gardé), `le dépôt (NETTOYER=${nettoyer}) a touché aux aperçus, au robots.txt ou aux paquets du relais :\n${r.sortie}`);
          assert.deepEqual(choisir(après, (k) => !k.startsWith('recette/')), choisir(avant, (k) => !k.startsWith('recette/')), 'le dépôt a touché hors de la racine de la recette');
          assert.equal('recette/assets/index-vieux.js' in après, nettoyer === 'non', `NETTOYER=${nettoyer} : l'ancien fichier du site ${nettoyer === 'oui' ? 'reste' : 'a disparu'}`);
          assert.doesNotMatch(r.sortie, /recette\.exemple\.test/i, `le dépôt écrit l'adresse de recette au journal (#156) :\n${r.sortie}`);
        });
      }

      const refus = [
        ['sans TIRELIRE_DEV_FTP_DOSSIER', { TIRELIRE_DEV_FTP_DOSSIER: undefined }, 'TIRELIRE_DEV_FTP_DOSSIER'],
        ['sans TIRELIRE_DEV_SITE_URL', { TIRELIRE_DEV_SITE_URL: undefined }, 'TIRELIRE_DEV_SITE_URL'],
        ['dossier de recette = www, défaut de la production', { TIRELIRE_DEV_FTP_DOSSIER: 'www' }, 'TIRELIRE_DEV_FTP_DOSSIER'],
        ['production dans la racine de la recette', { TIRELIRE_FTP_DOSSIER: 'recette/www' }, 'TIRELIRE_FTP_DOSSIER'],
        ['adresse de recette = adresse de production', { TIRELIRE_DEV_SITE_URL: `${RECETTE.TIRELIRE_SITE_URL}/` }, 'TIRELIRE_DEV_SITE_URL'],
      ];
      for (const [cas, réglage, nommé] of refus) {
        await t.test(`${cas} : rien ne bouge, et le réglage est nommé`, () => {
          serveurDeTest(distant);
          const avant = instantané(distant);
          const r = apercu('racine-deposer', { ...RECETTE, SOURCE: source, NETTOYER: 'oui', ...réglage });
          assert.notEqual(r.code, 0, `${cas} : le dépôt aurait dû s'arrêter`);
          assert.deepEqual(instantané(distant), avant, `${cas} : le serveur a changé`);
          assert.match(r.sortie, new RegExp(nommé), `${cas} : ${nommé} n'est pas nommé`);
        });
      }
    } finally {
      serveur.kill();
      rmSync(base, { recursive: true, force: true });
    }
  });
});
