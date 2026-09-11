// Le script de dépôt (`deposer.sh`) transfère bien le site et laisse intact ce qui vit sur le
// serveur : paquets de synchronisation (`donnees/*.jsonl`) et configuration locale du relais.
// Joué contre un vrai serveur FTP local (pyftpdlib). Sauté si `lftp` ou `pyftpdlib` manquent, sauf si
// `TIRELIRE_STRICT` est posé, comme en CI : il échoue alors (#59).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const lftp = spawnSync('lftp', ['--version'], { stdio: 'ignore' }).status === 0;
const pyftpdlib = spawnSync('python3', ['-c', 'import pyftpdlib'], { stdio: 'ignore' }).status === 0;
const raison = !lftp ? 'lftp absent' : !pyftpdlib ? 'pyftpdlib absent' : false;
const strict = Boolean(process.env.TIRELIRE_STRICT);

const PORT = 2121;

function siteDeTest(dir) {
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  mkdirSync(path.join(dir, 'donnees'), { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), '<html>Tirelire</html>');
  writeFileSync(path.join(dir, 'relais.php'), '<?php // relais');
  writeFileSync(path.join(dir, '.htaccess'), 'RewriteEngine On');
  writeFileSync(path.join(dir, '.ovhconfig'), 'app.engine=php');
  writeFileSync(path.join(dir, 'assets/index-neuf.js'), 'console.log(1)');
  writeFileSync(path.join(dir, 'donnees/.htaccess'), 'Require all denied');
}

/** Ce que le serveur contient déjà : des paquets, une configuration locale, un ancien fichier. */
function serveurDeTest(dir) {
  mkdirSync(path.join(dir, 'www/donnees'), { recursive: true });
  mkdirSync(path.join(dir, 'www/assets'), { recursive: true });
  writeFileSync(path.join(dir, 'www/donnees/salon-1234.jsonl'), '{"id":1}\n');
  writeFileSync(path.join(dir, 'www/relais.config.php'), '<?php return [];');
  writeFileSync(path.join(dir, 'www/assets/index-vieux.js'), 'console.log(0)');
}

function demarrerServeur(racine) {
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

function deposer(source, racineDistante, env = {}) {
  const r = spawnSync('bash', [path.join(ici, 'deposer.sh')], {
    env: {
      ...process.env,
      HOTE: `127.0.0.1:${PORT}`,
      UTILISATEUR: 'simon',
      MOTDEPASSE: 'secret',
      PROTOCOLE: 'ftp',
      DOSSIER: 'www',
      SOURCE: source,
      ...env,
    },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `dépôt en échec : ${r.stderr}`);
  return r.stdout + r.stderr;
}

test('dépôt FTP : le site monte, les données du serveur restent', { skip: !strict && raison }, async (t) => {
  assert.equal(raison, false, `${raison}, alors que TIRELIRE_STRICT rend l'outil obligatoire`);
  const base = mkdtempSync(path.join(tmpdir(), 'depot-'));
  const source = path.join(base, 'site');
  const distant = path.join(base, 'serveur');
  siteDeTest(source);
  serveurDeTest(distant);
  const serveur = demarrerServeur(distant);
  await new Promise((r) => setTimeout(r, 600));

  try {
    await t.test('essai à blanc : rien ne bouge', () => {
      deposer(source, distant, { BLANC: '1' });
      assert.equal(existsSync(path.join(distant, 'www/index.html')), false);
    });

    await t.test('transfert : fichiers cachés compris, données intactes', () => {
      deposer(source, distant);
      for (const f of ['index.html', 'relais.php', '.htaccess', '.ovhconfig', 'assets/index-neuf.js', 'donnees/.htaccess']) {
        assert.ok(existsSync(path.join(distant, 'www', f)), `${f} manquant sur le serveur`);
      }
      assert.equal(readFileSync(path.join(distant, 'www/donnees/salon-1234.jsonl'), 'utf8'), '{"id":1}\n');
      assert.equal(readFileSync(path.join(distant, 'www/relais.config.php'), 'utf8'), '<?php return [];');
      // Sans nettoyage, l'ancien fichier reste : les appareils encore sur l'ancienne version
      // peuvent charger leurs ressources.
      assert.ok(existsSync(path.join(distant, 'www/assets/index-vieux.js')));
    });

    await t.test('nettoyage : les anciens fichiers partent, jamais les paquets ni la configuration', () => {
      deposer(source, distant, { NETTOYER: 'oui' });
      assert.equal(existsSync(path.join(distant, 'www/assets/index-vieux.js')), false);
      assert.ok(existsSync(path.join(distant, 'www/donnees/salon-1234.jsonl')));
      assert.ok(existsSync(path.join(distant, 'www/relais.config.php')));
      assert.ok(existsSync(path.join(distant, 'www/index.html')));
    });

    await t.test('adresse copiée avec un schéma ou un chemin : nettoyée', () => {
      const journal = deposer(source, distant, { HOTE: `ftp://127.0.0.1:${PORT}/www` });
      assert.match(journal, /ramenée à « 127\.0\.0\.1:2121 »/);
      assert.ok(existsSync(path.join(distant, 'www/index.html')));
    });

    await t.test('source qui n’est pas un site assemblé : refus', () => {
      const r = spawnSync('bash', [path.join(ici, 'deposer.sh')], {
        env: { ...process.env, HOTE: '127.0.0.1', UTILISATEUR: 'x', MOTDEPASSE: 'y', SOURCE: base },
        encoding: 'utf8',
      });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /site assemblé/);
    });
  } finally {
    serveur.kill();
  }
});
