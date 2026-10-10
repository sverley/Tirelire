/**
 * Harnais d'audit de #431 : la nuit verte se dit dans l'issue de la nuit, même quand d'autres
 * commentaires suivent le dernier message de la nuit. Composé par l'auditeur, de bout en bout : le
 * script `nuit.mjs signaler` joue contre un GitHub de poche, et ce qu'il écrit est ce qui se
 * vérifie. Les tests du codeur (`nuit-verte-malgre-commentaires.test.mjs`) restent au niveau 4.
 *
 * « Fait quand » 1 : la nuit verte se dit malgré les commentaires. 2 : le reste ne change pas. 3 : #411
 * telle qu'elle est. Les textes de la nuit (point 2) se relisent dans le diff : il ne les touche pas.
 * Niveau 2 : une règle de l'outillage de la nuit (D83) donnerait un résultat faux, l'usage restant possible.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, test } from 'node:test';
import { RACINE } from './gardes.mjs';
import { MARQUE, ROUGE, TITRE, VERTE, texteRouge, texteVert } from './nuit.mjs';

const commit = 'c'.repeat(40);
const execution = 'https://exemple.invalid/run/1';
const corpsRouge = `${MARQUE}\n${ROUGE}\nNuit rouge`;

describe('[niveau 2] #431 · ce que la nuit écrit dans l’issue de la nuit', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'harnais-431-'));
  const faux = join(dossier, 'fetch.mjs');
  // Un GitHub de poche : il répond d'après `STUB_REPONSES` (par chemin, commentaires par pages de 100)
  // et note chaque écriture (méthode, chemin, corps).
  writeFileSync(faux, [
    "import { appendFileSync } from 'node:fs';",
    'const reponses = JSON.parse(process.env.STUB_REPONSES);',
    'globalThis.fetch = async (url, options = {}) => {',
    '  const u = new URL(url);',
    "  const chemin = decodeURIComponent(u.pathname).split('/repos/o/r/')[1];",
    "  const methode = options.method ?? 'GET';",
    "  if (methode !== 'GET') appendFileSync(process.env.STUB_JOURNAL, JSON.stringify({ methode, chemin, corps: JSON.parse(options.body ?? '{}') }) + String.fromCharCode(10));",
    "  const page = Number(u.searchParams.get('page') ?? 1);",
    "  const r = methode === 'GET' ? (reponses[chemin] ?? []) : { number: 12 };",
    "  const rendu = methode === 'GET' && chemin.endsWith('/comments') ? r.slice((page - 1) * 100, page * 100) : r;",
    "  return { ok: true, status: 200, json: async () => rendu, text: async () => '' };",
    '};',
    '',
  ].join('\n'));
  const rapport = join(dossier, 'rapport.json');
  writeFileSync(rapport, JSON.stringify({ testResults: [] }));

  const commentaires = (...corps) => corps.map((body) => ({ body }));
  /** L'issue de la nuit n° 9, ouverte, avec ses commentaires ; `corps` : son corps. */
  const ouverte = (liste, corps = corpsRouge) => ({ issues: [{ number: 9, title: TITRE, body: corps, comments: liste.length }], 'issues/9/comments': commentaires(...liste) });
  /** Les écritures d'une nuit `verdict` contre `reponses`. */
  const nuit = (verdict, reponses) => {
    const journal = join(dossier, `journal-${Math.random().toString(36).slice(2)}`);
    writeFileSync(journal, '');
    const r = spawnSync('node', ['--import', pathToFileURL(faux).href, 'nuit.mjs', 'signaler', verdict, commit, rapport, execution], {
      cwd: join(RACINE, 'packages/gardes'),
      encoding: 'utf8',
      env: { ...process.env, GH_TOKEN: 't', GH_REPO: 'o/r', STUB_REPONSES: JSON.stringify(reponses), STUB_JOURNAL: journal },
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return readFileSync(journal, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  const verteDansLIssue = [{ methode: 'POST', chemin: 'issues/9/comments', corps: { body: texteVert({ commit, execution }) } }];

  test('#411 telle qu’elle est — la nuit rouge dans son corps, puis un seul commentaire, sans marque — : la nuit verte se dit en commentaire', () => {
    assert.deepEqual(nuit('vert', ouverte(['Renvoi à #408 : la correction est là-bas'])), verteDansLIssue);
  });

  test('des commentaires d’une session et du porteur après la nuit rouge, dans son corps ou en commentaire : la nuit verte se dit', () => {
    assert.deepEqual(nuit('vert', ouverte(['une session', 'le porteur', 'une session encore'])), verteDansLIssue);
    assert.deepEqual(nuit('vert', ouverte([texteRouge({ commit, rouges: ['a.test.mjs'], execution }), 'une session', 'le porteur'])), verteDansLIssue);
  });

  test('le dernier message de la nuit décide : verte, puis commentaires, ne dit rien ; rouge après verte, puis commentaires, dit', () => {
    assert.deepEqual(nuit('vert', ouverte([texteRouge({ commit, rouges: [], execution }), texteVert({ commit, execution }), 'une session', 'le porteur'])), []);
    assert.deepEqual(nuit('vert', ouverte([texteVert({ commit, execution }), texteRouge({ commit, rouges: [], execution }), 'une session'])), verteDansLIssue);
  });

  test('plus de cent commentaires : le dernier message de la nuit se cherche sur toutes les pages', () => {
    const suite = (n) => Array.from({ length: n }, (_, i) => `commentaire ${i}`);
    assert.deepEqual(nuit('vert', ouverte([ROUGE, ...suite(249)])), verteDansLIssue);
    assert.deepEqual(nuit('vert', ouverte([ROUGE, VERTE, ...suite(198)])), [], '200 commentaires, la nuit verte au deuxième');
    assert.deepEqual(nuit('vert', ouverte([VERTE, ...suite(99), ROUGE])), verteDansLIssue, '101 commentaires, la nuit rouge au dernier, sur la deuxième page');
  });

  test('le reste ne change pas : rouge ouvre l’issue ou la complète ; verte sans issue, ou après une verte, ne dit rien ; rien ne ferme l’issue', () => {
    assert.deepEqual(nuit('rouge', {}).map((e) => [e.methode, e.chemin]), [['POST', 'issues']]);
    assert.equal(nuit('rouge', {})[0].corps.title, TITRE);
    assert.deepEqual(nuit('rouge', ouverte(['une session'])), [{ methode: 'POST', chemin: 'issues/9/comments', corps: { body: texteRouge({ commit, rouges: [], execution }) } }]);
    assert.deepEqual(nuit('vert', {}), []);
    assert.deepEqual(nuit('vert', ouverte([VERTE, 'une session'])), []);
    assert.deepEqual(nuit('vert', ouverte([VERTE], `${MARQUE}\n${VERTE}\nsans nuit rouge`)), []);
  });
});
