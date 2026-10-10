/**
 * Tests du codeur de #431 : la nuit verte se dit dans l'issue de la nuit, même quand d'autres
 * commentaires suivent le dernier message de la nuit. Tous de niveau 4 (D83) ; sans navigateur.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, test } from 'node:test';
import { RACINE } from './gardes.mjs';
import { MARQUE, ROUGE, TITRE, VERTE, dernierMessageDeLaNuit, suiteDeLaNuit } from './nuit.mjs';

const base = { commit: 'c'.repeat(40), execution: 'https://exemple.invalid/run/1' };
const corpsRouge = `${MARQUE}\n${ROUGE}\nNuit rouge`;
const c = (...corps) => corps.map((body) => ({ body }));

describe('[niveau 4] #431 · le dernier message de la nuit', () => {
  test('le corps de l’issue vaut tant qu’aucun commentaire ne porte de marque', () => {
    assert.equal(dernierMessageDeLaNuit(corpsRouge, []), corpsRouge);
    assert.equal(dernierMessageDeLaNuit(corpsRouge, c('Renvoi à #408, sans marque')), corpsRouge, 'la forme de #411 : la nuit rouge dans le corps, puis un seul commentaire sans marque');
  });

  test('c’est le dernier message qui porte une marque, rouge ou verte ; les commentaires sans marque ne comptent pas', () => {
    const rouge = `${ROUGE}\nNuit rouge`;
    const verte = `${VERTE}\nNuit verte`;
    assert.equal(dernierMessageDeLaNuit(corpsRouge, c(verte, 'a', 'b', rouge, 'c', 'd')), rouge);
    assert.equal(dernierMessageDeLaNuit(corpsRouge, c(rouge, 'a', verte, 'b')), verte);
    assert.equal(dernierMessageDeLaNuit('sans marque', c('a', 'b')), '');
  });

  test('la nuit verte se dit après une nuit rouge suivie d’autres commentaires, et se tait après une nuit verte suivie d’autres commentaires', () => {
    const suite = (dernier) => suiteDeLaNuit({ ...base, verdict: 'vert', issue: { number: 9 }, dernier }).action;
    assert.equal(suite(dernierMessageDeLaNuit(corpsRouge, c('d’une session', 'du porteur'))), 'commenter');
    assert.equal(suite(dernierMessageDeLaNuit(corpsRouge, c(`${ROUGE}\n`, `${VERTE}\n`, 'd’une session'))), 'rien');
  });

  test('le reste ne change pas : rouge ouvre ou complète, vert sans issue ne dit rien', () => {
    assert.equal(suiteDeLaNuit({ ...base, verdict: 'rouge' }).titre, TITRE);
    assert.equal(suiteDeLaNuit({ ...base, verdict: 'rouge', issue: { number: 9 } }).action, 'commenter');
    assert.equal(suiteDeLaNuit({ ...base, verdict: 'vert' }).action, 'rien');
  });
});

describe('[niveau 4] #431 · ce que la nuit demande à GitHub', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'nuit-431-'));
  const faux = join(dossier, 'fetch.mjs');
  // Un GitHub de poche : il répond d'après `STUB_REPONSES` (par chemin, puis page) et note chaque appel.
  writeFileSync(faux, [
    "import { appendFileSync } from 'node:fs';",
    'const reponses = JSON.parse(process.env.STUB_REPONSES);',
    'globalThis.fetch = async (url, options = {}) => {',
    '  const u = new URL(url);',
    "  const chemin = decodeURIComponent(u.pathname).split('/repos/o/r/')[1];",
    "  const methode = options.method ?? 'GET';",
    '  appendFileSync(process.env.STUB_JOURNAL, JSON.stringify({ methode, chemin }) + String.fromCharCode(10));',
    "  const page = Number(u.searchParams.get('page') ?? 1);",
    "  const r = methode === 'GET' ? (reponses[chemin] ?? []) : { number: 12 };",
    "  const rendu = methode === 'GET' && chemin.endsWith('/comments') ? r.slice((page - 1) * 100, page * 100) : r;",
    "  return { ok: true, status: 200, json: async () => rendu, text: async () => '' };",
    '};',
    '',
  ].join('\n'));
  const rapport = join(dossier, 'rapport.json');
  writeFileSync(rapport, JSON.stringify({ testResults: [] }));
  const ouverte = (commentaires) => ({ issues: [{ number: 9, title: TITRE, body: corpsRouge, comments: commentaires.length }], 'issues/9/comments': c(...commentaires) });
  const nuit = (verdict, reponses) => {
    const journal = join(dossier, `journal-${Math.random().toString(36).slice(2)}`);
    writeFileSync(journal, '');
    const r = spawnSync('node', ['--import', pathToFileURL(faux).href, 'nuit.mjs', 'signaler', verdict, base.commit, rapport, base.execution], {
      cwd: join(RACINE, 'packages/gardes'),
      encoding: 'utf8',
      env: { ...process.env, GH_TOKEN: 't', GH_REPO: 'o/r', STUB_REPONSES: JSON.stringify(reponses), STUB_JOURNAL: journal },
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return readFileSync(journal, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.methode === 'POST').map((x) => x.chemin);
  };

  test('#411 telle qu’elle est — la nuit rouge dans son corps, un seul commentaire sans marque — : la nuit verte se dit en commentaire', () => {
    assert.deepEqual(nuit('vert', ouverte(['Renvoi à #408'])), ['issues/9/comments']);
  });

  test('des commentaires de session après la nuit rouge : la nuit verte se dit ; après une nuit verte : rien', () => {
    assert.deepEqual(nuit('vert', ouverte([ROUGE, 'une session', 'le porteur'])), ['issues/9/comments']);
    assert.deepEqual(nuit('vert', ouverte([ROUGE, VERTE, 'une session'])), []);
  });

  test('plus de cent commentaires : le dernier message de la nuit se cherche sur toutes les pages', () => {
    const beaucoup = (marque) => [marque, ...Array.from({ length: 150 }, (_, i) => `commentaire ${i}`)];
    assert.deepEqual(nuit('vert', ouverte(beaucoup(ROUGE))), ['issues/9/comments']);
    assert.deepEqual(nuit('vert', ouverte(beaucoup(VERTE))), []);
  });

  test('le reste ne change pas : rouge ouvre l’issue ou la complète ; vert sans issue ne dit rien', () => {
    assert.deepEqual(nuit('rouge', {}), ['issues']);
    assert.deepEqual(nuit('rouge', ouverte(['une session'])), ['issues/9/comments']);
    assert.deepEqual(nuit('vert', {}), []);
  });
});
