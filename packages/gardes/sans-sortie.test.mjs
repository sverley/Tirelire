/**
 * Harnais d'audit de #113, composé par #285 parmi les tests du codeur (D83) : un test qui porte
 * sa propre marque est retenu à ce niveau ; les autres restent au niveau 4.
 *
 * #113 : un harnais joué en local ne sort pas de la machine (D83, docs/gardes.md, « Dans chaque
 * lanceur local »).
 *
 * Sorti de `gardes.test.mjs` par #243 : il vérifie ce besoin, pas la garde elle-même (D81).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import * as V from './gardes.mjs';
import { RACINE } from './gardes.mjs';
import { cibleDe, designer, estLocal, message, tentatives, vider } from './sans-sortie.mjs';

describe('[niveau 4] D83 · un harnais joué en local ne sort pas de la machine (#113)', () => {
  const PRECHARGE = pathToFileURL(join(RACINE, V.SANS_SORTIE)).href;

  /** Joue `node --test` avec la garde préchargée, dans un dossier jetable garni de `fichiers`. */
  function jouerSousGarde(fichiers) {
    const dossier = mkdtempSync(join(tmpdir(), 'tirelire-113-'));
    try {
      for (const [nom, contenu] of Object.entries(fichiers)) writeFileSync(join(dossier, nom), contenu);
      // Sans ce retrait, le `node --test` enfant se croit dans celui-ci et ne joue rien.
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const r = spawnSync(process.execPath, ['--import', PRECHARGE, '--test'], { cwd: dossier, env, encoding: 'utf8', timeout: 30_000 });
      return { code: r.status, sortie: `${r.stdout}\n${r.stderr}` };
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  }

  test('#113 : la boucle locale est la machine, le reste non', () => {
    for (const h of [undefined, '', 'localhost', 'LOCALHOST.', 'app.localhost', '127.0.0.1', '127.8.0.3', '::1', '[::1]', '::ffff:127.0.0.1', '0.0.0.0', '::']) {
      assert.equal(estLocal(h), true, String(h));
    }
    // #118 : la même adresse écrite autrement reste la machine — l'analyseur d'URL réécrit
    // `[::ffff:127.0.0.1]` en `[::ffff:7f00:1]`, et `::1` s'écrit de plusieurs façons.
    for (const h of ['::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '[::ffff:7f00:1]', '0::1', '::0:1', '0:0:0:0:0:0:0:1', '::ffff:127.255.255.254']) {
      assert.equal(estLocal(h), true, h);
    }
    for (const h of ['::ffff:c000:20a', '::ffff:128.0.0.1', '2001:db8::1', 'ffff::1', '::1:0', ':::1', '1:2:3:4:5:6:7']) {
      assert.equal(estLocal(h), false, h);
    }
    for (const h of ['exemple.com', 'api.github.com', '10.0.0.1', '192.168.1.2', '128.0.0.1', '::2', 'localhost.exemple.com', '127.0.0.1.nip.io']) {
      assert.equal(estLocal(h), false, h);
    }
  });

  test('#113 : la cible se lit sous toutes les formes de connect, et un path vide n’est pas un socket de fichier', () => {
    assert.deepEqual(cibleDe([{ host: 'exemple.com', port: 443 }]), { hote: 'exemple.com', port: 443 });
    assert.deepEqual(cibleDe([[{ host: 'exemple.com', port: 80, path: null }, () => {}]]), { hote: 'exemple.com', port: 80 });
    assert.deepEqual(cibleDe([80, 'exemple.com', () => {}]), { hote: 'exemple.com', port: 80 });
    assert.deepEqual(cibleDe(['8080']), { hote: undefined, port: '8080' });
    assert.deepEqual(cibleDe(['/tmp/prise.sock']), { chemin: '/tmp/prise.sock' });
    assert.deepEqual(cibleDe([{ path: '/tmp/prise.sock' }]), { chemin: '/tmp/prise.sock' });
    assert.match(message([{ hote: 'exemple.com', port: 80 }, { hote: '2001:db8::1', port: 443 }]), /exemple\.com:80, \[2001:db8::1\]:443 \(#113/);
    assert.equal(designer({ hote: 'exemple.com' }), 'exemple.com');
    assert.equal(designer({ hote: '[::2]', port: 1 }), '[::2]:1');
  });

  test('#113 : dans ce processus même, la connexion sortante est refusée et retenue avant toute résolution, puis oubliée par vider', async () => {
    const avant = tentatives().length;
    const erreur = await new Promise((r) => net.connect({ host: 'retenue.invalid', port: 80 }).on('error', r).on('connect', () => r(null)));
    try {
      assert.equal(erreur?.code, 'ERR_TIRELIRE_HORS_MACHINE');
      assert.match(erreur.message, /retenue\.invalid:80/);
      assert.deepEqual(tentatives().slice(avant), [{ hote: 'retenue.invalid', port: 80 }]);
    } finally {
      // Oublier la sonde, sans quoi ce fichier sortirait en échec : c'est la garde qui le veut.
      vider();
    }
    assert.deepEqual(tentatives(), []);
  });

  test('[niveau 2] #113 : une connexion hors de la machine fait échouer node --test en nommant l’hôte, par fetch comme par node:http, depuis le code testé et erreur avalée', () => {
    const { code, sortie } = jouerSousGarde({
      'code.mjs': [
        "import http from 'node:http';",
        "export const parFetch = () => fetch('http://hors-machine.invalid:80/').then(() => 'passé', () => 'avalé');",
        "export const parHttp = () => new Promise((r) => http.get('http://autre-hors-machine.invalid:80/', { agent: false }, (x) => { x.resume(); r('passé'); }).on('error', () => r('avalé')));",
      ].join('\n'),
      'sonde.test.mjs': [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { parFetch, parHttp } from './code.mjs';",
        "test('fetch avalé', async () => assert.equal(await parFetch(), 'avalé'));",
        "test('http avalé', async () => assert.equal(await parHttp(), 'avalé'));",
      ].join('\n'),
    });
    assert.notEqual(code, 0, sortie);
    assert.match(sortie, /# pass 2/, 'les deux tests passent : c’est la garde, pas une assertion, qui fait échouer');
    assert.match(sortie, /hors-machine\.invalid:80/);
    assert.match(sortie, /autre-hors-machine\.invalid:80/);
  });

  test('#113 : témoin — la boucle locale passe sous la même garde, par fetch comme par node:http', () => {
    const { code, sortie } = jouerSousGarde({
      'boucle.test.mjs': [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import http from 'node:http';",
        "test('boucle locale', async () => {",
        "  const serveur = http.createServer((q, r) => r.end('ok')).listen(0, '127.0.0.1');",
        "  await new Promise((r) => serveur.once('listening', r));",
        "  const { port } = serveur.address();",
        "  for (const h of ['127.0.0.1', 'localhost']) assert.equal(await (await fetch(`http://${h}:${port}/`)).text(), 'ok');",
        "  const recu = await new Promise((r) => http.get(`http://127.0.0.1:${port}/`, { agent: false }, (x) => { let t = ''; x.on('data', (d) => (t += d)); x.on('end', () => r(t)); }));",
        "  assert.equal(recu, 'ok');",
        "  serveur.close();",
        "});",
      ].join('\n'),
    });
    assert.equal(code, 0, sortie);
    assert.match(sortie, /# pass 1\b/, 'le témoin a bien joué son test');
    assert.doesNotMatch(sortie, /hors de la machine/);
  });

  test('[niveau 2] #113 : chaque lanceur local du dépôt est branché sur la garde', () => {
    assert.ok(existsSync(join(RACINE, V.SANS_SORTIE)) && existsSync(join(RACINE, V.SANS_SORTIE_VITEST)));
    assert.deepEqual(V.paquetsDuWorkspace(), ['packages/core', 'packages/gardes', 'apps/hebergement', 'apps/relay', 'apps/web']);
    assert.deepEqual(V.verifierLanceursLocaux(), []);
  });

  test('[niveau 2] #113 : sous vitest aussi, une connexion hors de la machine fait échouer le fichier en nommant l’hôte, erreur avalée', () => {
    const vitest = join(RACINE, 'packages/core/node_modules/.bin/vitest');
    const dossier = mkdtempSync(join(tmpdir(), 'tirelire-113-vitest-'));
    try {
      const setup = JSON.stringify(join(RACINE, V.SANS_SORTIE_VITEST));
      writeFileSync(join(dossier, 'vitest.config.mjs'), `export default { test: { include: ['*.test.mjs'], setupFiles: [${setup}] } };\n`);
      writeFileSync(join(dossier, 'sonde.test.mjs'), [
        "import { describe, test, expect } from 'vitest';",
        "test('avalé', async () => expect(await fetch('http://vitest-hors-machine.invalid:80/').then(() => 'passé', () => 'avalé')).toBe('avalé'));",
      ].join('\n'));
      writeFileSync(join(dossier, 'boucle.test.mjs'), "import { test } from 'vitest';\ntest('rien ne sort', () => {});\n");
      const r = spawnSync(vitest, ['run', '--root', dossier], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, CI: '1', NO_COLOR: '1' } });
      const sortie = `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
      assert.notEqual(r.status, 0, sortie);
      assert.match(sortie, /vitest-hors-machine\.invalid:80/);
      assert.match(sortie, /1 failed \| 1 passed/, 'seul le fichier qui sort échoue');
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  test('[niveau 2] #113 : témoin — un lanceur non branché est nommé, qu’il soit node --test, vitest ou inconnu', () => {
    const racine = mkdtempSync(join(tmpdir(), 'tirelire-113-depot-'));
    try {
      const ecrire = (chemin, contenu) => {
        mkdirSync(dirname(join(racine, chemin)), { recursive: true });
        writeFileSync(join(racine, chemin), typeof contenu === 'string' ? contenu : JSON.stringify(contenu));
      };
      ecrire('pnpm-workspace.yaml', 'packages:\n  - paquets/*\n\nonlyBuiltDependencies:\n  - esbuild\n');
      ecrire('package.json', { scripts: {} });
      ecrire('paquets/branche/package.json', { name: 'branche', scripts: { test: 'node --import ../../packages/gardes/sans-sortie.mjs --test' } });
      ecrire('paquets/nu/package.json', { name: 'nu', scripts: { test: 'node --test' } });
      ecrire('paquets/ailleurs/package.json', { name: 'ailleurs', scripts: { test: 'node --import ./sans-sortie.mjs --test' } });
      ecrire('paquets/vite-branche/package.json', { name: 'vite-branche', scripts: { test: 'vitest run' } });
      ecrire('paquets/vite-branche/vitest.config.ts', "export default { test: { setupFiles: ['../../packages/gardes/sans-sortie-vitest.mjs'] } };");
      ecrire('paquets/vite-commente/package.json', { name: 'vite-commente', scripts: { test: 'vitest run' } });
      ecrire('paquets/vite-commente/vitest.config.ts', "export default { test: {\n // setupFiles: ['../../packages/gardes/sans-sortie-vitest.mjs'],\n} };");
      ecrire('paquets/vite-sans-config/package.json', { name: 'vite-sans-config', scripts: { test: 'vitest run' } });
      ecrire('paquets/jest/package.json', { name: 'jest', scripts: { test: 'jest' } });
      ecrire('paquets/sans-test/package.json', { name: 'sans-test', scripts: {} });
      const problemes = V.verifierLanceursLocaux(racine);
      const noms = problemes.map((p) => /^`([^`]+)`/.exec(p)?.[1]);
      assert.deepEqual(noms.sort(), ['ailleurs', 'jest', 'nu', 'vite-commente', 'vite-sans-config'], problemes.join('\n'));
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });
});
