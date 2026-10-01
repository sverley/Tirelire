/**
 * Test du codeur de #302, point 8 (niveau 4) : un lancement des tests de l'interface ne construit le
 * site qu'une fois, quel que soit le nombre de fichiers qui l'ouvrent ; le dossier du site disparaît
 * à la fin du lancement.
 *
 * Un lancement de vitest est joué dans le paquet, sur trois fichiers inventés qui demandent chacun le
 * site du lancement (`siteDuLancement`, `harnais.ts`) en même temps et notent ce qu'ils reçoivent.
 * Il construit vraiment le site : quelques secondes.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { RACINE } from './harnais';

const relatif = `.site-302-${process.pid}`;
const dossier = join(RACINE, relatif);
const témoin = join(mkdtempSync(join(tmpdir(), 'site-302-')), 'temoin');

afterAll(() => rmSync(dossier, { recursive: true, force: true }));

function lancer(): Promise<{ code: number | null; sortie: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, TEMOIN_302: témoin };
  for (const k of Object.keys(env)) if (k.startsWith('VITEST') || k === 'NODE_OPTIONS' || k.startsWith('TIRELIRE_')) delete env[k];
  env.TEMOIN_302 = témoin;
  return new Promise((fini) => {
    const p = spawn(join(RACINE, 'node_modules/.bin/vitest'), ['run', '--dir', relatif], { cwd: RACINE, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    p.stdout.on('data', (d) => (sortie += d));
    p.stderr.on('data', (d) => (sortie += d));
    p.on('close', (code) => fini({ code, sortie }));
  });
}

describe('[niveau 4] #302, point 8 · le site des tests navigateur se construit une fois par lancement', () => {
  test('trois fichiers le demandent en même temps : un seul le construit, tous reçoivent le même ; il disparaît à la fin', async () => {
    mkdirSync(join(dossier, 'test'), { recursive: true });
    writeFileSync(témoin, '');
    for (const n of ['a', 'b', 'c']) {
      writeFileSync(
        join(dossier, 'test', `${n}.test.ts`),
        [
          "import { appendFileSync, existsSync } from 'node:fs';",
          "import { join } from 'node:path';",
          "import { test } from 'vitest';",
          "import { siteDuLancement } from '../../test/harnais';",
          `test('${n} [niveau 4]', async () => {`,
          '  const s = await siteDuLancement();',
          "  appendFileSync(process.env.TEMOIN_302!, JSON.stringify({ ...s, index: !!s && existsSync(join(s.sortie, 'index.html')) }) + '\\n');",
          '});',
          '',
        ].join('\n'),
      );
    }
    const r = await lancer();
    expect(r.code, r.sortie).toBe(0);
    const reçus = readFileSync(témoin, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { sortie: string; construit: boolean; index: boolean });
    expect(reçus, r.sortie).toHaveLength(3);
    expect(reçus.filter((x) => x.construit), 'un seul fichier construit le site').toHaveLength(1);
    expect(new Set(reçus.map((x) => x.sortie)).size, 'tous servent le même site').toBe(1);
    expect(reçus.every((x) => x.index), 'le site est construit quand chacun le reçoit').toBe(true);
    expect(existsSync(reçus[0]!.sortie), 'le dossier du site disparaît à la fin du lancement').toBe(false);
  }, 300_000);
});
