import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Ce que le relais doit faire : accepter les dépôts, puis ne rendre à un appareil que ce que les
 * autres ont déposé, et refuser un salon invalide. Écrit à part pour être rejoué tel quel sur un
 * relais volontairement cassé : c'est le témoin rouge du harnais I8 (docs/gardes.md), plus bas.
 */
async function dépôtPuisRetraitFiltré(racine) {
  const base = `${racine}/r/salon-de-test-1234`;
  const post = async (site) =>
    (await fetch(base, { method: 'POST', body: JSON.stringify({ site, upTo: 3, iv: 'aa', blob: 'bb' }) })).json();
  assert.equal((await post('A')).id, 1);
  assert.equal((await post('B')).id, 2);
  const forA = await (await fetch(`${base}?site=A&after=0`)).json();
  assert.deepEqual(forA.records.map((r) => r.site), ['B']);
  const forB = await (await fetch(`${base}?site=B&after=1`)).json();
  assert.equal(forB.records.length, 0);
  const bad = await fetch(`${racine}/r/x`);
  assert.equal(bad.status, 400);
}

test('push puis pull filtré par appareil', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'relay-'));
  const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '18787', TIRELIRE_RELAY_DATA: dir }, stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 500));
    await dépôtPuisRetraitFiltré('http://127.0.0.1:18787');
  } finally {
    child.kill();
  }
});

/**
 * Le relais volontairement cassé : il enregistre tout, mais rend à chacun ce qu'il a lui-même
 * déposé — un appareil se resynchronise alors avec son propre passé, et le paramètre `site` ne sert
 * plus à rien. Les mêmes assertions doivent échouer ; faute de `test.fails` dans `node:test`,
 * l'échec attendu tient dans `assert.rejects` (docs/gardes.md, #66).
 */
function relaisSansFiltre() {
  const enregistrés = [];
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!/^\/r\/[a-z0-9-]{8,}$/.test(url.pathname)) {
      res.writeHead(400).end('{}');
      return;
    }
    if (req.method === 'POST') {
      const morceaux = [];
      req.on('data', (c) => morceaux.push(c));
      req.on('end', () => {
        const reçu = JSON.parse(Buffer.concat(morceaux).toString());
        enregistrés.push({ id: enregistrés.length + 1, ...reçu });
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: enregistrés.length }));
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ records: enregistrés }));
  });
}

test('témoin rouge · un relais qui rend à chaque appareil ce qu’il a lui-même déposé', async () => {
  const serveur = relaisSansFiltre();
  await new Promise((r) => serveur.listen(18789, '127.0.0.1', r));
  try {
    await assert.rejects(() => dépôtPuisRetraitFiltré('http://127.0.0.1:18789'), /Expected values to be strictly (?:deep-)?equal/);
  } finally {
    serveur.close();
  }
});
