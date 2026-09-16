/**
 * Harnais d'audit de #82, écrit par la session d'audit de la PR #83.
 *
 * #82 veut les amorçages « hors du chemin courant : ni crochet, ni `pnpm test`, par
 * construction et non par convention », appelables par une commande, et déclenchés d'eux-mêmes sur
 * une PR qui touche aux règles. D65 fixe le vocabulaire ; D66 relève le budget du crochet à 30 s
 * pour ce déplacement. Rien de tout ça ne se garde en jouant `pnpm test` ou le crochet eux-mêmes,
 * puisque c'est justement d'eux qu'il s'agit : ce harnais lit la configuration qui les définit
 * (`pnpm-workspace.yaml`, `package.json`, les workflows) et vérifie qu'elle tient l'exclusion par
 * construction, pas seulement par une convention qu'un futur commit pourrait défaire sans qu'aucun
 * test ne le voie.
 *
 * « Par construction » se lit à quatre endroits : le workspace pnpm n'inclut aucun glob qui
 * atteindrait `amorcage/` (donc `pnpm -r test` ne peut pas y entrer, quel que soit son contenu) ;
 * `scripts.amorcage` de la racine appelle `node --test` directement sur ce dossier, hors du workspace
 * (l'audit de #113 y admet un préchargement `--import`, par où passe la garde de D71, et rien
 * d'autre) ;
 * le crochet de pré-commit ne le cite pas ; le workflow dédié ne tourne que sur `workflow_dispatch`
 * ou une PR dont les chemins touchent aux règles, jamais sur toute PR. Chaque assertion structurelle
 * a son témoin : une mutation qui réintroduirait amorcage dans le chemin courant, et que
 * l'assertion doit alors refuser de laisser passer.
 *
 * Le dépôt est copié une fois ; les témoins modifient un fichier de la copie, vérifient que la
 * détection mord, puis le rétablissent (`modifie`). Les deux dernières vérifications portent sur le
 * vocabulaire écrit une fois pour toutes (CLAUDE.md, docs/gardes.md) : une présence textuelle suffit,
 * sans mutation, pour ne pas multiplier les harnais sur de la prose (D62 : garder la garde simple).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appelleDirectementLesAmorcages, copieDuDepot, lire, lignesDe, modifie } from './test/copie-du-depot.mjs';

const RACINE = copieDuDepot();

const packageJson = (racine) => JSON.parse(lire(racine, 'package.json'));

/** Les entrées de la liste `packages:` d'un pnpm-workspace.yaml, sous forme de globs bruts. */
const globsDeWorkspace = (texte) =>
  lignesDe(texte)
    .filter((l) => /^\s*-\s+\S/.test(l))
    .map((l) => l.trim().replace(/^-\s+/, ''));

/** Un glob de workspace pnpm atteindrait-il amorcage/ ? Les seuls globs en usage ici sont des
 * préfixes littéraux suivis de `/*`, ou des jokers larges (`*`, `**`, `**\/*`) : pas besoin d'un
 * moteur de glob complet pour juger ceux-là. */
const globAtteintAmorcage = (glob) =>
  glob === 'amorcage' || glob.startsWith('amorcage/') || ['*', '**', '**/*'].includes(glob);

test('#82 · aucun glob du workspace pnpm n’atteint amorcage/', () => {
  const globs = globsDeWorkspace(lire(RACINE, 'pnpm-workspace.yaml'));
  assert.ok(globs.length, `pnpm-workspace.yaml ne liste aucun paquet, à relire : ${RACINE}`);
  const fautif = globs.find(globAtteintAmorcage);
  assert.equal(fautif, undefined, `le glob « ${fautif} » de pnpm-workspace.yaml atteindrait amorcage/, qui redeviendrait un paquet pnpm`);
});

test('#82 · témoin : ajouter amorcage au workspace pnpm est détecté', async () => {
  await modifie(RACINE, 'pnpm-workspace.yaml', (t) => `${t}  - amorcage\n`, async () => {
    const globs = globsDeWorkspace(lire(RACINE, 'pnpm-workspace.yaml'));
    const fautif = globs.find(globAtteintAmorcage);
    assert.notEqual(fautif, undefined, "l'ajout de amorcage au workspace n'est pas détecté : le témoin ne mord pas");
  });
});

test('#82 · « pnpm test » reste une récursion sur le workspace, qui ne peut pas atteindre amorcage/', () => {
  const { scripts } = packageJson(RACINE);
  assert.equal(scripts.test, 'pnpm -r test', `scripts.test a changé de forme dans package.json, à relire : ${scripts.test}`);
});

test('#82 · « pnpm amorcage » appelle node --test directement sur amorcage/, hors du workspace', () => {
  const { scripts } = packageJson(RACINE);
  assert.ok(
    appelleDirectementLesAmorcages(scripts.amorcage),
    `scripts.amorcage n'appelle plus node --test directement sur amorcage/*.test.mjs, avec pour seules options des préchargements : ${scripts.amorcage}`,
  );
});

test('#82 · témoin : l’appel direct admet un préchargement (#113), rien qui saute ou chaîne des amorçages', () => {
  for (const script of [
    'node --test amorcage/*.test.mjs',
    'node --import ./packages/gardes/sans-sortie.mjs --test amorcage/*.test.mjs',
    'node --import=./a.mjs --require ./b.cjs --test amorcage/*.test.mjs',
  ]) assert.ok(appelleDirectementLesAmorcages(script), `refusé à tort : ${script}`);
  for (const script of [
    'node --test --test-name-pattern=x amorcage/*.test.mjs',
    'node --test-only --test amorcage/*.test.mjs',
    'node --import --test-name-pattern=x --test amorcage/*.test.mjs',
    'node --test amorcage/*.test.mjs && echo',
    'pnpm -r exec node --test amorcage/*.test.mjs',
    'node --test packages/*/test',
    'node --import ./x.mjs --test amorcage/a.test.mjs',
  ]) assert.ok(!appelleDirectementLesAmorcages(script), `accepté à tort : ${script}`);
});

/** Le crochet lance-t-il les amorçages ? Depuis #120 (D73), il vit dans `.githooks/pre-commit`, et un
 * motif de chemin qui cite amorcage/ pour choisir les tests de la garde n'est pas un lancement. */
const lanceLesAmorcages = (crochet) => /\bpnpm\s+(run\s+)?amorcage\b|\bnode\b[^\n]*--test[^\n]*\bamorcage\//.test(crochet);
const crochetDePreCommit = (racine) => {
  try {
    return lire(racine, '.githooks/pre-commit');
  } catch {
    return '';
  }
};

test('#82 · le crochet de pré-commit ne joue pas les amorçages', () => {
  const crochet = crochetDePreCommit(RACINE);
  assert.ok(crochet.trim(), `aucun crochet de pré-commit dans .githooks : ${RACINE}`);
  assert.ok(!lanceLesAmorcages(crochet), `le crochet de pré-commit joue les amorçages, que D65 en sort pourtant : ${crochet}`);
});

test('#82 · témoin : ajouter les amorçages au crochet de pré-commit est détecté, un motif de chemin non', async () => {
  assert.ok(!lanceLesAmorcages('    packages/gardes/* | amorcage/*) garde=1 ;;'), 'un motif de chemin passe pour un lancement');
  await modifie(RACINE, '.githooks/pre-commit', (t) => `${t}\npnpm amorcage\n`, async () => {
    assert.ok(lanceLesAmorcages(crochetDePreCommit(RACINE)), "le témoin ne mord pas sur l'ajout de pnpm amorcage au crochet");
  });
  await modifie(RACINE, '.githooks/pre-commit', (t) => `${t}\nnode --import ./x.mjs --test amorcage/*.test.mjs\n`, async () => {
    assert.ok(lanceLesAmorcages(crochetDePreCommit(RACINE)), "le témoin ne mord pas sur l'ajout de node --test amorcage/ au crochet");
  });
});

test('#82 · le workflow des amorçages ne tourne pas sur toute PR, seulement sur les règles ou à la demande', () => {
  const texte = lire(RACINE, '.github/workflows/amorcage.yml');
  assert.match(texte, /workflow_dispatch/, "le workflow n'est plus appelable à la main");
  assert.match(
    texte,
    /pull_request:\s*\n\s*paths:\s*\n(?:\s*-\s*.+\n?)+/,
    "le workflow n'a pas de « paths » sous « pull_request » : il tournerait sur toute PR, pas seulement sur celles qui touchent aux règles",
  );
});

test('#82 · témoin : un déclenchement « pull_request » sans « paths » est détecté', async () => {
  await modifie(
    RACINE,
    '.github/workflows/amorcage.yml',
    (t) => t.replace(/pull_request:\s*\n\s*paths:\s*\n(?:\s*-\s*.+\n?)+/, 'pull_request:\n'),
    async () => {
      const texte = lire(RACINE, '.github/workflows/amorcage.yml');
      const m = texte.match(/pull_request:\s*\n\s*paths:\s*\n(?:\s*-\s*.+\n?)+/);
      assert.equal(m, null, "le témoin ne mord pas : un « pull_request » sans « paths » passerait toujours");
    },
  );
});

test('#82 · les workflows du chemin courant n’appellent pas « pnpm amorcage »', () => {
  for (const nom of ['ci.yml', 'verifications.yml']) {
    const texte = lire(RACINE, `.github/workflows/${nom}`);
    assert.ok(!/\bpnpm amorcage\b/.test(texte), `${nom} appelle pnpm amorcage : les amorçages rentreraient dans le chemin courant`);
  }
});

test('#82 · CLAUDE.md dit, une fois pour toutes, où poser le harnais qu’une session écrit (D65)', () => {
  const texte = lire(RACINE, 'CLAUDE.md');
  assert.match(texte, /D65/, "CLAUDE.md ne cite plus D65 : le renvoi au vocabulaire a disparu");
  assert.match(texte, /amorçage/, "CLAUDE.md ne nomme plus les amorçages");
  assert.match(texte, /amorcage\//, "CLAUDE.md ne dit plus dans quel dossier vit un amorçage");
});

test('#82 · docs/gardes.md dit que les amorçages restent hors du registre du produit', () => {
  const texte = lire(RACINE, 'docs/gardes.md');
  assert.match(texte, /amorçage/, 'docs/gardes.md ne nomme plus les amorçages');
  assert.match(texte, /#82/, 'docs/gardes.md ne cite plus #82');
});
