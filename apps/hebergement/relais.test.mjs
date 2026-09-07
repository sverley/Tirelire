// Le relais PHP répond comme le relais Node (`apps/relay/server.test.mjs`).
// Sauté si `php` n'est pas installé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const phpPresent = spawnSync('php', ['-v'], { stdio: 'ignore' }).status === 0;

test('relais PHP : push puis pull filtré par appareil', { skip: !phpPresent && 'php absent' }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'relais-php-'));
  // Le serveur intégré de PHP joue le rôle d'Apache : relais.php lit le salon dans le chemin.
  const child = spawn('php', ['-S', '127.0.0.1:18788', '-t', 'serveur', 'serveur/relais.php'], {
    cwd: path.dirname(new URL(import.meta.url).pathname),
    env: { ...process.env, TIRELIRE_RELAIS_DONNEES: path.join(dir, 'donnees') },
    stdio: 'ignore',
  });
  try {
    await new Promise((r) => setTimeout(r, 700));
    const base = 'http://127.0.0.1:18788/r/salon-de-test-1234';
    const post = async (site) =>
      (await fetch(base, { method: 'POST', body: JSON.stringify({ site, upTo: 3, iv: 'aa', blob: 'bb' }) })).json();
    assert.equal((await post('A')).id, 1);
    assert.equal((await post('B')).id, 2);
    const forA = await (await fetch(`${base}?site=A&after=0`)).json();
    assert.deepEqual(forA.records.map((r) => r.site), ['B']);
    assert.equal(forA.records[0].blob, 'bb');
    const forB = await (await fetch(`${base}?site=B&after=1`)).json();
    assert.equal(forB.records.length, 0);
    const bad = await fetch('http://127.0.0.1:18788/r/x');
    assert.equal(bad.status, 400);
    const invalide = await fetch(base, { method: 'POST', body: '{"site":"A"}' });
    assert.equal(invalide.status, 400);
  } finally {
    child.kill();
  }
});
