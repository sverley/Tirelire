/**
 * Harnais d'audit de #66 (PR #63), écrit par la session d'audit.
 *
 * #66 étend la couverture de #59 : un harnais du registre ne cite plus seulement un test vert
 * (optionnel), il cite aussi son témoin rouge — ou porte « à faire » avec l'issue qui le doit. Ce
 * fichier montre, comme `livraison-de-la-garde.test.mjs` pour #59 à #61 : la couverture qui refuse un harnais
 * sans témoin rouge ni dette, celle qui refuse un témoin rouge cité qui n'existe pas ou ne tourne
 * pas, celle qui accepte la dette « à bâtir (#N) », et enfin — hors couverture, dans l'outil de
 * test lui-même — qu'un témoin rouge qui se met à passer fait échouer `pnpm test`, en le nommant.
 *
 * Les trois premiers cas tiennent sur des documents inventés ; le quatrième, sur une vraie copie
 * du dépôt (`copie-du-depot.mjs`), pour rester fidèle au format réel de `docs/gardes.md` du jour.
 * Le cinquième ne relit pas la couverture : il joue `node --test` sur un fichier synthétique, pour
 * montrer que c'est bien l'outil de test — pas la garde — qui tient l'échec attendu.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import * as V from '../packages/gardes/gardes.mjs';
import { copieDuDepot, modifie, problemes } from './test/copie-du-depot.mjs';

const texte = (p) => p.join('\n');

const INVARIANTS = '## I1 · Premier\n';
const CONTRAINTES = '';
const FICHIERS = ['a/un.test.ts'];

const gardeAvec = (harnaisLigne) => `## I1 · Premier\n\n- **Harnais** · ${harnaisLigne}\n`;

const couverture = (gardes, contenus = {}) =>
  V.verifierCouvertureTextes({
    invariants: INVARIANTS,
    contraintes: CONTRAINTES,
    gardes,
    fichiers: FICHIERS,
    lireFichier: (c) => contenus[c] ?? null,
  }).problemes;

// ─── #66 sur des documents inventés ─────────────────────────────────────────────────────────────

test('#66 · un harnais sans témoin rouge ni dette « à faire » fait échouer la couverture, en le nommant', () => {
  const p = couverture(gardeAvec('`a/un.test.ts` — garde le calcul.'));
  assert.match(texte(p), /le harnais `a\/un\.test\.ts` ne cite pas de témoin rouge .* ni ne le porte « à bâtir » avec une issue \(#66\)/);
});

test('#66 · « Témoin rouge : à bâtir (#N) » est une dette acceptée, sans problème', () => {
  const p = couverture(gardeAvec('`a/un.test.ts` — garde le calcul. Témoin rouge : à bâtir (#38).'));
  assert.deepEqual(p, []);
});

test('#66 · un témoin rouge cité qui tourne est accepté, sans problème', () => {
  const p = couverture(gardeAvec('`a/un.test.ts` — garde le calcul. Témoin rouge : « casse le calcul ».'), {
    'a/un.test.ts': "it('casse le calcul', () => {});",
  });
  assert.deepEqual(p, []);
});

test('#66 · un témoin rouge cité qui n\'existe pas ou ne tourne pas fait échouer la couverture, en le nommant', () => {
  const absent = couverture(gardeAvec('`a/un.test.ts` — garde le calcul. Témoin rouge : « casse le calcul ».'), {
    'a/un.test.ts': "it('autre chose', () => {});",
  });
  assert.match(texte(absent), /le témoin rouge « casse le calcul » ne tourne dans aucun de `a\/un\.test\.ts` \(renommé, supprimé ou mis en commentaire \?\)/);

  const desactive = couverture(gardeAvec('`a/un.test.ts` — garde le calcul. Témoin rouge : « casse le calcul ».'), {
    'a/un.test.ts': "it.skip('casse le calcul', () => {});",
  });
  assert.match(texte(desactive), /le témoin rouge « casse le calcul » ne tourne dans aucun de `a\/un\.test\.ts` \(il y figure sans tourner/);
});

// ─── #66 sur une copie du vrai dépôt ─────────────────────────────────────────────────────────────

test('#66 · sur une copie du dépôt, retirer la citation du témoin rouge d\'un harnais réel fait échouer la couverture', async () => {
  const racine = copieDuDepot();
  const p = await modifie(
    racine,
    'docs/gardes.md',
    // Les 22 harnais du registre citent leur témoin depuis #69 : on retire la citation du premier.
    (avant) => avant.replace(/\n {2}Témoin rouge : «[^»]*»(?=\n)/, ''),
    () => problemes(racine),
  );
  assert.ok(
    p.some((m) => /ne cite pas de témoin rouge/.test(m)),
    texte(p),
  );
});

test('#66 · sur une copie du dépôt, citer un témoin rouge introuvable pour un harnais réel fait échouer la couverture, en le nommant', async () => {
  const racine = copieDuDepot();
  const p = await modifie(
    racine,
    'docs/gardes.md',
    (avant) => {
      const m = avant.match(/\n {2}Témoin rouge : «[^»]*»(?=\n)/);
      if (!m) throw new Error("aucune ligne « Témoin rouge » trouvée : le harnais d'audit de #66 est à relire");
      return avant.replace(m[0], "\n  Témoin rouge : « ce test n'existe nulle part (#66) »");
    },
    () => problemes(racine),
  );
  assert.ok(
    p.some((m) => m.includes("le témoin rouge « ce test n'existe nulle part (#66) » ne tourne dans aucun")),
    texte(p),
  );
});

// ─── Ce que la couverture ne voit pas : l'outil de test tient l'échec attendu (#66) ──────────────

const dossiers = [];
after(() => {
  for (const d of dossiers) rmSync(d, { recursive: true, force: true });
});

// `NODE_TEST_CONTEXT`, hérité de ce fichier lancé par `node --test`, ferait rapporter l'enfant comme
// un sous-test au lieu d'un run isolé : son code de sortie ne refléterait alors plus son échec.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([cle]) => cle !== 'NODE_TEST_CONTEXT'));

/** Joue `node --test` sur un fichier synthétique isolé ; code de sortie et sortie combinée. */
function jouer(source) {
  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-temoin-rouge-'));
  dossiers.push(dossier);
  const fichier = join(dossier, 'temoin.test.mjs');
  writeFileSync(fichier, source);
  const r = spawnSync(process.execPath, ['--test', fichier], { encoding: 'utf8', env: ENV });
  return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test("#66 · un témoin rouge écrit avec `assert.throws` passe tant que le besoin reste cassé", () => {
  const source = [
    "import assert from 'node:assert/strict';",
    "import { test } from 'node:test';",
    'function calculCasse() { throw new Error("pas encore réparé"); }',
    "test('témoin rouge : calcul casse encore', () => {",
    '  assert.throws(() => calculCasse(), /pas encore réparé/);',
    '});',
  ].join('\n');
  const { code } = jouer(source);
  assert.equal(code, 0, "le témoin rouge doit rester vert tant qu'il constate bien l'échec attendu");
});

test("#66 · le même témoin rouge fait échouer `node --test`, en le nommant, si le besoin se met à passer", () => {
  const source = [
    "import assert from 'node:assert/strict';",
    "import { test } from 'node:test';",
    'function calculCasse() { return 42; } // réparé sans que le témoin rouge ait été mis à jour',
    "test('témoin rouge : calcul casse encore', () => {",
    '  assert.throws(() => calculCasse(), /pas encore réparé/);',
    '});',
  ].join('\n');
  const { code, sortie } = jouer(source);
  assert.notEqual(code, 0, "un témoin rouge qui se met à passer doit faire échouer `pnpm test`");
  assert.match(sortie, /témoin rouge : calcul casse encore/);
});
