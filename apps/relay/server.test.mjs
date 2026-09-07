import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('push puis pull filtré par appareil', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'relay-'));
  const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '18787', TIRELIRE_RELAY_DATA: dir }, stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 500));
    const base = 'http://127.0.0.1:18787/r/salon-de-test-1234';
    const post = async (site) =>
      (await fetch(base, { method: 'POST', body: JSON.stringify({ site, upTo: 3, iv: 'aa', blob: 'bb' }) })).json();
    assert.equal((await post('A')).id, 1);
    assert.equal((await post('B')).id, 2);
    const forA = await (await fetch(`${base}?site=A&after=0`)).json();
    assert.deepEqual(forA.records.map((r) => r.site), ['B']);
    const forB = await (await fetch(`${base}?site=B&after=1`)).json();
    assert.equal(forB.records.length, 0);
    const bad = await fetch('http://127.0.0.1:18787/r/x');
    assert.equal(bad.status, 400);
  } finally {
    child.kill();
  }
});
