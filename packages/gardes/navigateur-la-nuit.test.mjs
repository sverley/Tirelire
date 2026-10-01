/**
 * Tests du codeur de #307 : les tests navigateur de non-régression se jouent la nuit ; ceux de
 * l'issue, pendant toute la PR. Tous de niveau 4 (D83) ; l'auditeur choisit parmi eux le harnais.
 *
 * `node:test` n'a pas de `test.fails` : l'échec attendu d'un témoin tient dans une assertion.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
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
import { commande, jouer } from './workflow-a-blanc.mjs';

const lireFichier = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');
const h = (c) => c.repeat(64);
const E = (c) => Object.fromEntries(TOUS.map((id, i) => [id, `${c}${i}`.padEnd(64, c)]));
const A = 'a'.repeat(40);

const temporaires = [];
after(() => {
  for (const d of temporaires) rmSync(d, { recursive: true, force: true });
});

// ─── Point 1 : ni avant la fusion, ni à la CI d'une fusion sur main ─────────────────────────────

const ctx = (github, inputs = {}) => ({ github: { event: {}, ...github }, vars: {}, secrets: {}, inputs });
const AU_READY = ctx({ event_name: 'pull_request', ref: 'refs/pull/307/merge', event: { action: 'ready_for_review', pull_request: { number: 307, draft: false, head: { sha: A } } } });
const SUR_MAIN = ctx({ event_name: 'push', ref: 'refs/heads/main' });
const AU_TAG = ctx({ event_name: 'push', ref: 'refs/tags/v1.0.0' });
const FORCEE = ctx({ event_name: 'workflow_dispatch', ref: 'refs/heads/main' }, { version_forcee: true });
const commandes = (c) => jouer(lireFichier('.github/workflows/ci.yml'), c).flatMap((job) => job.joués.map((é) => commande(é)));

describe('[niveau 4] #307, point 1 · la CI ne joue la non-régression dans le navigateur ni au Ready ni après la fusion', () => {
  test('au Ready et sur main, aucune étape ne joue tout test/navigateur', () => {
    for (const [nom, c] of [['au Ready', AU_READY], ['sur main', SUR_MAIN]]) {
      const l = commandes(c);
      assert.ok(l.some((x) => /\bpnpm test 1\b/.test(x)), `${nom} : le seuil 1 se joue toujours`);
      assert.ok(!l.some((x) => /--navigateur[^\n]*\btest\/navigateur\b/.test(x)), `${nom} : la non-régression dans le navigateur ne se joue pas\n${l.join('\n')}`);
    }
  });

  test('au Ready, les tests navigateur de l’issue se jouent après le harnais du besoin ; sur main, non', () => {
    const l = commandes(AU_READY);
    const harnais = l.findIndex((x) => /harnais-du-besoin\.sh --jouer/.test(x));
    const issue = l.findIndex((x) => /tests-de-l-issue\.sh --jouer --attestation/.test(x));
    assert.ok(harnais >= 0 && issue > harnais, l.join('\n'));
    assert.ok(!commandes(SUR_MAIN).some((x) => /tests-de-l-issue/.test(x)), 'sur main, aucune issue');
  });

  test('au tag et pour une version forcée (point 5), tout se rejoue au seuil 3, tests navigateur compris, sans attestation', () => {
    for (const [nom, c] of [['au tag', AU_TAG], ['version forcée', FORCEE]]) {
      const l = commandes(c);
      assert.ok(l.some((x) => /pnpm --dir apps\/web run test 3 --navigateur test\/navigateur/.test(x)), `${nom}\n${l.join('\n')}`);
      assert.ok(!l.some((x) => /\btest\b[^\n]*--attestation/.test(x)), `${nom} : rien ne se saute`);
    }
  });

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

// ─── Point 2 : les tests navigateur de l'issue ───────────────────────────────────────────────────

/** Un dépôt avec `origin` et les crochets du dépôt : `git`, `écrire`, `commettre`. */
function dépôtFactice(nom) {
  const racine = mkdtempSync(join(tmpdir(), `tirelire-307-${nom}-`));
  temporaires.push(racine);
  const dépôt = join(racine, 'depot');
  const origine = join(racine, 'origine.git');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t.invalid', GIT_CONFIG_GLOBAL: '/dev/null', GITHUB_HEAD_REF: '' };
  const git = (...args) => execFileSync('git', args, { cwd: dépôt, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', origine], { env });
  mkdirSync(dépôt);
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', origine);
  cpSync(join(RACINE, '.githooks'), join(dépôt, '.githooks'), { recursive: true });
  cpSync(join(RACINE, 'packages/gardes'), join(dépôt, 'packages/gardes'), { recursive: true, filter: (s) => !s.includes('node_modules') });
  const écrire = (chemin, texte) => {
    mkdirSync(dirname(join(dépôt, chemin)), { recursive: true });
    writeFileSync(join(dépôt, chemin), texte);
  };
  const commettre = (message) => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  return { dépôt, env, git, écrire, commettre };
}

describe('[niveau 4] #307, point 2 · les tests navigateur de l’issue : ce que la branche ajoute ou modifie, hors harnais', () => {
  test('la liste commune : fichiers navigateur ajoutés ou modifiés depuis main, sans le harnais du besoin ni les autres tests', () => {
    const f = dépôtFactice('liste');
    for (const n of ['a', 'b', 'c']) f.écrire(`apps/web/test/navigateur/${n}.test.ts`, `// ${n}\n`);
    f.écrire('apps/web/test/w.test.ts', '// w\n');
    f.commettre('main');
    f.git('push', '-q', 'origin', 'main');
    f.git('fetch', '-q', 'origin');
    f.git('checkout', '-q', '-b', 'codage/307-essai');
    f.écrire('apps/web/test/navigateur/a.test.ts', '// a modifié\n');
    f.écrire('apps/web/test/navigateur/d.test.ts', '// nouveau\n');
    f.écrire('apps/web/test/navigateur/h.test.ts', '// Harnais d’audit de #307\n');
    f.écrire('apps/web/test/w.test.ts', '// w modifié\n');
    f.git('rm', '-q', 'apps/web/test/navigateur/c.test.ts');
    f.git('add', '-A');
    const liste = join(f.dépôt, '..', 'liste');
    const r = spawnSync('sh', ['-c', `. .githooks/tests-de-l-issue.sh && tests_de_l_issue '${liste}'`, '.githooks/tests-de-l-issue.sh'], { cwd: f.dépôt, env: f.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readFileSync(liste, 'utf8').split('\n').filter(Boolean), ['apps/web/test/navigateur/a.test.ts', 'apps/web/test/navigateur/d.test.ts']);
  });

  test('la livraison joue les tests de l’issue en entier, à part, dans le navigateur, les exclut de la non-régression demandée, et les dit', () => {
    const l = lireFichier('.githooks/livraison.sh');
    assert.match(l, /lance issue-navigateur apps\/web pnpm run test 4 \$\(couvert issue-navigateur\) --navigateur/);
    assert.match(l, /ajoute issue issue-navigateur apps\/web vitest/);
    assert.match(l, /\[ "\$id" = navigateur \] && for f in \$\(sed 's#\^apps\/web\/##' "\$journaux\/issue\.txt"\); do set -- "\$@" --exclude "\$f"; done/);
    const palier3 = l.slice(l.indexOf('# Palier 3'));
    assert.ok(palier3.indexOf('issue_nav') > 0 && palier3.indexOf('issue_nav') < palier3.indexOf('wait'), 'au palier 3, seulement si tout le reste est vert');
  });

  test('le bilan atteste les fichiers de l’issue un à un, jamais toute l’interface dans le navigateur', () => {
    const f = dépôtFactice('bilan');
    f.écrire('apps/web/test/navigateur/a.test.ts', '// a\n');
    f.écrire('apps/web/test/navigateur/b.test.ts', '// b\n');
    f.commettre('main');
    f.git('checkout', '-q', '-b', 'codage/307-bilan');
    const j = join(f.dépôt, '..', 'journaux');
    mkdirSync(j);
    writeFileSync(join(j, 'lances'), 'issue\tissue-navigateur\tvitest\n');
    writeFileSync(join(j, 'issue-navigateur.code'), '1\n');
    writeFileSync(join(j, 'issue-navigateur.log'), '');
    writeFileSync(join(j, 'issue-navigateur.rapport'), JSON.stringify({ testResults: [{ name: join(f.dépôt, 'apps/web/test/navigateur/a.test.ts'), status: 'passed', assertionResults: [] }, { name: join(f.dépôt, 'apps/web/test/navigateur/b.test.ts'), status: 'failed', assertionResults: [{ status: 'failed', title: '[niveau 4] b', ancestorTitles: [] }] }] }));
    writeFileSync(join(j, 'issue-navigateur.bilan'), JSON.stringify({ lisible: true, fichiers: [{ fichier: 'apps/web/test/navigateur/a.test.ts', ensemble: 'navigateur', etat: 'vert', seuil: 4 }, { fichier: 'apps/web/test/navigateur/b.test.ts', ensemble: 'navigateur', etat: 'rouge', seuil: 4 }] }));
    const plan = join(j, 'plan');
    writeFileSync(plan, `navigateur\t0\t2\t${h('n')}\tsans demande\n`);
    const verts = join(j, 'verts.json');
    writeFileSync(verts, '[]\n');
    const r = spawnSync('node', ['.githooks/attestation.mjs', 'bilan', plan, j, 'pré-push', f.git('rev-parse', 'HEAD^{tree}'), f.git('rev-parse', 'HEAD'), 'codage/307-bilan', verts, '--enregistrer'], { cwd: f.dépôt, env: f.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /pré-push : tests navigateur de l'issue : joués en entier : rouge\./, r.stdout);
    const message = f.git('log', '-1', '--format=%B', 'refs/attestations/codage/307-bilan');
    const attestés = JSON.parse(message.slice(message.indexOf('{'))).verts;
    assert.deepEqual(attestés.map((v) => [v.ensemble, v.fichier, v.seuil]), [['navigateur', 'apps/web/test/navigateur/a.test.ts', 4]], 'a seul, sur son empreinte, au seuil 4');
  });
});

// ─── Point 3 : la nuit ───────────────────────────────────────────────────────────────────────────

describe('[niveau 4] #307, point 3 · chaque nuit, vers 3 h à Paris, les tests navigateur sur main, sauf fichier vert sur son empreinte', () => {
  test('le workflow de la nuit : deux heures UTC, une seule à Paris, sur main, au seuil 2, avec l’attestation de la nuit', () => {
    const w = lireFichier('.github/workflows/nuit.yml');
    assert.match(w, /- cron: '7 1 \* \* \*'\n\s+- cron: '7 2 \* \* \*'/);
    assert.match(w, /"schedule:7 1 \* \* \*:\+0200" \| "schedule:7 2 \* \* \*:\+0100"\) jouer=oui/);
    assert.match(w, /ref: main/);
    assert.match(w, /node \.githooks\/attestation\.mjs nuit "\$NUIT"/);
    assert.match(w, /pnpm run test 2 --navigateur --attestation "\$NUIT\/couverture\.json" --bilan/);
    assert.match(w, /TIRELIRE_STRICT: '1'/);
    assert.match(w, /attestation\.mjs envoyer origin nuit attestation-de-la-nuit/);
    assert.match(w, /node packages\/gardes\/nuit\.mjs signaler/);
  });

  test('l’heure de Paris : le premier déclenchement joue l’été, le second l’hiver, le lancement manuel toujours', () => {
    const w = lireFichier('.github/workflows/nuit.yml');
    const cas = w.slice(w.indexOf('case "$GITHUB_EVENT_NAME'), w.indexOf('esac') + 4);
    const joue = (evt, planifié, décalage) => spawnSync('sh', ['-c', `GITHUB_EVENT_NAME='${evt}' PLANIFIE='${planifié}' decalage='${décalage}'; ${cas.replace(/\$PLANIFIE/g, '$PLANIFIE')}; echo $jouer`], { encoding: 'utf8' }).stdout.trim();
    assert.equal(joue('schedule', '7 1 * * *', '+0200'), 'oui');
    assert.equal(joue('schedule', '7 2 * * *', '+0200'), 'non');
    assert.equal(joue('schedule', '7 1 * * *', '+0100'), 'non');
    assert.equal(joue('schedule', '7 2 * * *', '+0100'), 'oui');
    assert.equal(joue('workflow_dispatch', '', '+0100'), 'oui');
  });

  test('ce qu’une nuit trouve vert vaut pour les suivantes ; une nuit sans changement ne joue rien et le dit ; un fichier rouge se rejoue', () => {
    const f = dépôtFactice('nuit');
    f.écrire('apps/web/src/x.ts', 'export const x = 1;\n');
    f.écrire('apps/web/test/navigateur/a.test.ts', '// a\n');
    f.écrire('apps/web/test/navigateur/b.test.ts', '// b\n');
    f.commettre('main');
    f.git('push', '-q', 'origin', 'main');
    const d = (n) => join(f.dépôt, '..', `nuit-${n}`);
    const nuit = (n) => {
      const r = spawnSync('node', ['.githooks/attestation.mjs', 'nuit', d(n)], { cwd: f.dépôt, env: f.env, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return { sortie: r.stdout, jouer: readFileSync(join(d(n), 'jouer'), 'utf8').trim(), couverture: JSON.parse(readFileSync(join(d(n), 'couverture.json'), 'utf8')) };
    };
    /** Un lancement simulé : les fichiers verts ou rouges, puis le bilan et l'envoi, comme dans `nuit.yml`. */
    const jouée = (n, états) => {
      const j = join(d(n), 'journaux');
      mkdirSync(j, { recursive: true });
      const rouge = Object.values(états).includes('rouge');
      writeFileSync(join(j, 'lances'), 'navigateur\tnavigateur\tvitest\n');
      writeFileSync(join(j, 'navigateur.code'), rouge ? '1\n' : '0\n');
      writeFileSync(join(j, 'navigateur.log'), '');
      writeFileSync(join(j, 'navigateur.rapport'), JSON.stringify({ testResults: Object.entries(états).map(([x, e]) => ({ name: join(f.dépôt, `apps/web/test/navigateur/${x}.test.ts`), status: e === 'vert' ? 'passed' : 'failed', assertionResults: [] })) }));
      writeFileSync(join(j, 'navigateur.bilan'), JSON.stringify({ lisible: true, fichiers: Object.entries(états).map(([x, e]) => ({ fichier: `apps/web/test/navigateur/${x}.test.ts`, ensemble: 'navigateur', etat: e, seuil: 2 })) }));
      const b = spawnSync('node', ['.githooks/attestation.mjs', 'bilan', join(d(n), 'plan'), j, 'la nuit', f.git('rev-parse', 'HEAD^{tree}'), f.git('rev-parse', 'HEAD'), 'nuit', join(d(n), 'verts.json'), '--enregistrer'], { cwd: f.dépôt, env: f.env, encoding: 'utf8' });
      assert.equal(b.status, 0, b.stderr);
      const e = spawnSync('node', ['.githooks/attestation.mjs', 'envoyer', 'origin', 'nuit', 'attestation-de-la-nuit'], { cwd: f.dépôt, env: f.env, encoding: 'utf8' });
      assert.match(e.stdout, /envoyée \(attestation-de-la-nuit\)/, e.stdout + e.stderr);
    };

    const première = nuit(1);
    assert.equal(première.jouer, 'oui', première.sortie);
    assert.match(première.sortie, /aucune attestation de la nuit lue/i);
    jouée(1, { a: 'vert', b: 'rouge' });

    const deuxième = nuit(2);
    assert.equal(deuxième.jouer, 'oui', 'une nuit rouge : la suivante rejoue');
    assert.deepEqual(Object.keys(deuxième.couverture.fichiers), ['apps/web/test/navigateur/a.test.ts'], 'a, vert, se saute ; b, rouge, se rejoue');
    jouée(2, { b: 'vert' });

    const troisième = nuit(3);
    assert.equal(troisième.jouer, 'non', troisième.sortie);
    assert.match(troisième.sortie, /rien ne se joue cette nuit — empreinte trouvée verte par la nuit, sur le commit [0-9a-f]{10}, au seuil 2 ; rien de ce qu'ils lisent n'a changé/);

    f.écrire('docs/note.md', 'rien que de la documentation\n');
    f.commettre('docs');
    assert.equal(nuit(4).jouer, 'non', 'la documentation : les tests navigateur ne la lisent pas');
    f.écrire('apps/web/src/x.ts', 'export const x = 2;\n');
    f.commettre('code');
    const cinquième = nuit(5);
    assert.equal(cinquième.jouer, 'oui', 'ce qu’ils lisent a changé : ils se rejouent');
    assert.deepEqual(cinquième.couverture.fichiers, {}, 'aucun fichier ne reste couvert');
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
    assert.match(l, /DUREE_FONCTIONNEL=30 DUREE_GARDE=40/);
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
