/**
 * Tests du codeur de #307 : les tests navigateur de non-régression se jouent la nuit ; ceux de
 * l'issue, pendant toute la PR. Tous de niveau 4 (D83). L'auditeur en a déplacé une partie dans son
 * harnais, `nuit-et-tests-de-l-issue.test.mjs`, en les complétant ; ceux-ci restent, au niveau 4.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  SANS_DEMANDE,
  SEUILS_DU_READY,
  TOUS,
  couvertureApresFusion,
  couvertureAuReady,
  couvertureLocale,
  dejaVert,
  resume,
  vertsDuReady,
} from './attestation.mjs';
import { RACINE } from './gardes.mjs';
import { MARQUE, ROUGE, TITRE, VERTE, fichiersRouges, issueDeLaNuit, suiteDeLaNuit } from './nuit.mjs';

const lireFichier = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');
const E = (c) => Object.fromEntries(TOUS.map((id, i) => [id, `${c}${i}`.padEnd(64, c)]));
const A = 'a'.repeat(40);

// ─── Point 1 : ce que la couverture dit de la non-régression dans le navigateur ─────────────────

describe('[niveau 4] #307, point 1 · la couverture ne dit plus verte la non-régression dans le navigateur', () => {
  test('une tête verte au Ready, main ou le premier parent ne disent plus verte la non-régression dans le navigateur', () => {
    const e = E('v');
    assert.equal(SEUILS_DU_READY.navigateur, undefined);
    assert.ok(!vertsDuReady({ sha: A, statut: 'success', empreintes: e }).some((v) => v.ensemble === 'navigateur'));
    assert.equal(dejaVert({ id: 'navigateur', empreinte: e.navigateur, seuil: 2, references: [{ empreintes: e, seuil: 2, raison: 'main' }] }), null);
    assert.equal(dejaVert({ id: 'interface', empreinte: e.interface, seuil: 2, references: [{ empreintes: e, seuil: 2, raison: 'main' }] }), 'main', 'les autres ensembles, si');
    assert.ok(dejaVert({ id: 'navigateur', empreinte: e.navigateur, seuil: 2, verts: [{ ensemble: 'navigateur', empreinte: e.navigateur, seuil: 2, par: 'la nuit', commit: A }] }), 'ce que la nuit a trouvé vert, si');
  });

  test('la CI au Ready et sur main le dit, et la livraison sans demande aussi', () => {
    const e = E('r');
    const ready = resume(couvertureAuReady({ arbre: A, empreintes: e }));
    assert.ok(ready.some((l) => /^- interface dans le navigateur : non-régression non jouée — .*la nuit, sur main/.test(l)), ready.join('\n'));
    const main = resume(couvertureApresFusion({ arbre: A, empreintes: e }));
    assert.ok(main.some((l) => /^- interface dans le navigateur : non joué — .*la nuit, sur main/.test(l)), main.join('\n'));
    assert.match(SANS_DEMANDE, /la nuit sur main, sauf demande \(pnpm livraison --navigateur\)/);
  });
});

// ─── Point 4 : une nuit rouge se signale ─────────────────────────────────────────────────────────

describe('[niveau 4] #307, point 4 · une nuit rouge ouvre ou complète une issue ; la nuit verte qui suit le dit', () => {
  const base = { commit: 'c'.repeat(40), execution: 'https://exemple.invalid/run/1' };

  test('rouge sans issue ouverte : une issue, qui nomme les fichiers rouges et le commit', () => {
    const s = suiteDeLaNuit({ ...base, verdict: 'rouge', rouges: ['apps/web/test/navigateur/b.test.ts'] });
    assert.equal(s.action, 'creer');
    assert.equal(s.titre, TITRE);
    assert.ok(s.corps.includes(MARQUE) && s.corps.includes(ROUGE));
    assert.ok(s.corps.includes('`apps/web/test/navigateur/b.test.ts`') && s.corps.includes('c'.repeat(40)));
    assert.match(s.corps, /ne bloque aucune fusion/);
  });

  test('rouge avec une issue ouverte : elle se complète', () => {
    const s = suiteDeLaNuit({ ...base, verdict: 'rouge', rouges: null, issue: { number: 9 } });
    assert.equal(s.action, 'commenter');
    assert.match(s.corps, /ne se lisent pas/, 'un lancement sans rapport le dit');
  });

  test('vert : seule la nuit qui suit une nuit rouge le dit ; une nuit verte après une verte ne dit rien', () => {
    assert.equal(suiteDeLaNuit({ ...base, verdict: 'vert', issue: { number: 9 }, dernier: `${ROUGE}\nNuit rouge` }).action, 'commenter');
    assert.ok(suiteDeLaNuit({ ...base, verdict: 'vert', issue: { number: 9 }, dernier: `${ROUGE}\n` }).corps.includes(VERTE));
    assert.equal(suiteDeLaNuit({ ...base, verdict: 'vert', issue: { number: 9 }, dernier: `${VERTE}\nNuit verte` }).action, 'rien');
    assert.equal(suiteDeLaNuit({ ...base, verdict: 'vert' }).action, 'rien');
  });

  test('l’issue de la nuit se retrouve par son titre et sa marque, hors PR ; les fichiers rouges se lisent dans le rapport', () => {
    const issues = [{ number: 5, title: TITRE, body: 'sans marque' }, { number: 7, title: TITRE, body: `${MARQUE}\n…` }, { number: 3, title: TITRE, body: MARQUE, pull_request: {} }];
    assert.equal(issueDeLaNuit(issues).number, 7);
    assert.equal(issueDeLaNuit([]), null);
    const rapport = { testResults: [{ name: '/x/apps/web/test/navigateur/b.test.ts', status: 'failed' }, { name: '/x/apps/web/test/navigateur/a.test.ts', status: 'passed', assertionResults: [{ status: 'passed' }] }] };
    assert.deepEqual(fichiersRouges(rapport), ['apps/web/test/navigateur/b.test.ts']);
    assert.equal(fichiersRouges({}), null);
  });

  test('le workflow tient une nuit qui n’a pas pu jouer pour rouge', () => {
    assert.match(lireFichier('.github/workflows/nuit.yml'), /verdict=rouge\n\s+\[ "\$RESULTAT" = success \] && verdict=vert/);
  });
});

// ─── Point 6 : la durée attendue ─────────────────────────────────────────────────────────────────

describe('[niveau 4] #307, point 6 · la durée attendue de la livraison suit ce qu’elle joue', () => {
  test('les tests de l’issue comptent par fichier ; la non-régression demandée, toute la mesure', () => {
    const l = lireFichier('.githooks/livraison.sh');
    assert.match(l, /joue navigateur && attendue=\$\(\(attendue \+ 630\)\)/);
    assert.match(l, /\[ "\$issues" -gt 0 \] && attendue=\$\(\(attendue \+ 80 \+ 25 \* issues\)\)/);
    assert.match(l, /DUREE_FONCTIONNEL=30 DUREE_GARDE=50/);
    assert.ok(!/attendue \+ 270/.test(l), 'l’ancienne mesure du 25/09 ne vaut plus');
  });
});

// Couverture locale de la nuit : origine « nuit », sans référence à main.
test('[niveau 4] #307 · la couverture de la nuit ne doit rien à main', () => {
  const e = E('n');
  const c = couvertureLocale({ origine: 'nuit', arbre: A, empreintes: e, verts: [] });
  assert.equal(c.origine, 'nuit');
  assert.equal(c.ensembles.navigateur, undefined);
});

// ─── Point 8 : une nuit qui échoue avant son plan, sans le dépôt extrait ───────────────────────────

describe('[niveau 4] #307, point 8 · sans le dépôt extrait, la nuit rouge se signale par gh, sous la même issue', () => {
  /** Le script de l'étape du signal, tel que le workflow l'écrit. */
  const script = () => {
    const lignes = lireFichier('.github/workflows/nuit.yml').split('\n');
    const début = lignes.findIndex((l) => l.includes('- name: Une nuit rouge se signale'));
    const run = lignes.findIndex((l, i) => i > début && /^ {8}run: \|$/.test(l));
    const corps = [];
    for (const l of lignes.slice(run + 1)) {
      if (l.trim() && !l.startsWith(' '.repeat(10))) break;
      corps.push(l.slice(10));
    }
    return corps.join('\n');
  };
  /** Joue l'étape dans un dossier vide (rien d'extrait), avec un `gh` de poche qui note ses appels. */
  const signal = (ouverte) => {
    const d = mkdtempSync(join(tmpdir(), 'tirelire-307-signal-'));
    try {
      const gh = join(d, 'gh');
      writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${d}/appels"\n[ "$1 $2" = "issue list" ] && printf '%s\\n' '${ouverte}'\nexit 0\n`);
      chmodSync(gh, 0o755);
      const r = spawnSync('bash', ['-e', '-c', script()], { cwd: d, encoding: 'utf8', env: { PATH: `${d}:${process.env.PATH}`, RESULTAT: 'skipped', COMMIT: 'c'.repeat(40), EXECUTION: 'https://exemple.invalid/run/1', RUNNER_TEMP: d } });
      return { code: r.status, sortie: r.stdout + r.stderr, appels: readFileSync(join(d, 'appels'), 'utf8') };
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  };

  test('sans issue ouverte, une issue, avec le titre et la marque de nuit.mjs, qui nomme le commit', () => {
    const r = signal('');
    assert.equal(r.code, 0, r.sortie);
    assert.ok(r.appels.includes(`issue create --title ${TITRE} --body ${MARQUE}`), r.appels);
    assert.ok(r.appels.includes(ROUGE) && r.appels.includes('c'.repeat(40)), r.appels);
  });

  test('avec l’issue de la nuit ouverte, elle se complète', () => {
    const r = signal('12');
    assert.equal(r.code, 0, r.sortie);
    assert.match(r.appels, /^issue comment 12 --body <!-- nuit : rouge -->/m, r.appels);
    assert.doesNotMatch(r.appels, /issue create/);
  });
});
