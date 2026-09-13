/**
 * Harnais d'audit de #82, écrit par la session d'audit de la PR #83.
 *
 * #82 veut les méta-harnais « hors du chemin courant : ni crochet, ni `pnpm test`, par
 * construction et non par convention », appelables par une commande, et déclenchés d'eux-mêmes sur
 * une PR qui touche aux règles. D65 fixe le vocabulaire ; D66 relève le budget du crochet à 30 s
 * pour ce déplacement. Rien de tout ça ne se garde en jouant `pnpm test` ou le crochet eux-mêmes,
 * puisque c'est justement d'eux qu'il s'agit : ce harnais lit la configuration qui les définit
 * (`pnpm-workspace.yaml`, `package.json`, les workflows) et vérifie qu'elle tient l'exclusion par
 * construction, pas seulement par une convention qu'un futur commit pourrait défaire sans qu'aucun
 * test ne le voie.
 *
 * « Par construction » se lit à quatre endroits : le workspace pnpm n'inclut aucun glob qui
 * atteindrait `meta-harnais/` (donc `pnpm -r test` ne peut pas y entrer, quel que soit son contenu) ;
 * `scripts.meta` de la racine appelle `node --test` directement sur ce dossier, hors du workspace ;
 * le crochet de pré-commit ne le cite pas ; le workflow dédié ne tourne que sur `workflow_dispatch`
 * ou une PR dont les chemins touchent aux règles, jamais sur toute PR. Chaque assertion structurelle
 * a son témoin : une mutation qui réintroduirait meta-harnais dans le chemin courant, et que
 * l'assertion doit alors refuser de laisser passer.
 *
 * Le dépôt est copié une fois ; les témoins modifient un fichier de la copie, vérifient que la
 * détection mord, puis le rétablissent (`modifie`). Les deux dernières vérifications portent sur le
 * vocabulaire écrit une fois pour toutes (CLAUDE.md, docs/gardes.md) : une présence textuelle suffit,
 * sans mutation, pour ne pas multiplier les harnais sur de la prose (D62 : garder la garde simple).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copieDuDepot, lire, lignesDe, modifie } from './test/copie-du-depot.mjs';

const RACINE = copieDuDepot();

const packageJson = (racine) => JSON.parse(lire(racine, 'package.json'));

/** Les entrées de la liste `packages:` d'un pnpm-workspace.yaml, sous forme de globs bruts. */
const globsDeWorkspace = (texte) =>
  lignesDe(texte)
    .filter((l) => /^\s*-\s+\S/.test(l))
    .map((l) => l.trim().replace(/^-\s+/, ''));

/** Un glob de workspace pnpm atteindrait-il meta-harnais/ ? Les seuls globs en usage ici sont des
 * préfixes littéraux suivis de `/*`, ou des jokers larges (`*`, `**`, `**\/*`) : pas besoin d'un
 * moteur de glob complet pour juger ceux-là. */
const globAtteintMetaHarnais = (glob) =>
  glob === 'meta-harnais' || glob.startsWith('meta-harnais/') || ['*', '**', '**/*'].includes(glob);

test('#82 · aucun glob du workspace pnpm n’atteint meta-harnais/', () => {
  const globs = globsDeWorkspace(lire(RACINE, 'pnpm-workspace.yaml'));
  assert.ok(globs.length, `pnpm-workspace.yaml ne liste aucun paquet, à relire : ${RACINE}`);
  const fautif = globs.find(globAtteintMetaHarnais);
  assert.equal(fautif, undefined, `le glob « ${fautif} » de pnpm-workspace.yaml atteindrait meta-harnais/, qui redeviendrait un paquet pnpm`);
});

test('#82 · témoin : ajouter meta-harnais au workspace pnpm est détecté', async () => {
  await modifie(RACINE, 'pnpm-workspace.yaml', (t) => `${t}  - meta-harnais\n`, async () => {
    const globs = globsDeWorkspace(lire(RACINE, 'pnpm-workspace.yaml'));
    const fautif = globs.find(globAtteintMetaHarnais);
    assert.notEqual(fautif, undefined, "l'ajout de meta-harnais au workspace n'est pas détecté : le témoin ne mord pas");
  });
});

test('#82 · « pnpm test » reste une récursion sur le workspace, qui ne peut pas atteindre meta-harnais/', () => {
  const { scripts } = packageJson(RACINE);
  assert.equal(scripts.test, 'pnpm -r test', `scripts.test a changé de forme dans package.json, à relire : ${scripts.test}`);
});

test('#82 · « pnpm meta » appelle node --test directement sur meta-harnais/, hors du workspace', () => {
  const { scripts } = packageJson(RACINE);
  assert.equal(scripts.meta, 'node --test meta-harnais/*.test.mjs', `scripts.meta n'appelle plus meta-harnais/*.test.mjs directement : ${scripts.meta}`);
});

test('#82 · le crochet de pré-commit ne joue pas les méta-harnais', () => {
  const pkg = packageJson(RACINE);
  const crochet = pkg['simple-git-hooks']?.['pre-commit'] ?? '';
  assert.ok(crochet, `aucun crochet de pré-commit dans package.json : ${RACINE}`);
  assert.ok(!/\bpnpm meta\b|meta-harnais/.test(crochet), `le crochet de pré-commit joue les méta-harnais, que D65 en sort pourtant : ${crochet}`);
});

test('#82 · témoin : ajouter les méta-harnais au crochet de pré-commit est détecté', async () => {
  await modifie(RACINE, 'package.json', (t) => t.replace('"pre-commit":', '"pre-commit-avec-meta":').replace('"pre-commit-avec-meta": "', '"pre-commit-avec-meta": "pnpm meta && '), async () => {
    const pkg = packageJson(RACINE);
    const crochet = pkg['simple-git-hooks']?.['pre-commit-avec-meta'] ?? '';
    assert.ok(/\bpnpm meta\b/.test(crochet), "le témoin ne mord pas sur l'ajout de pnpm meta au crochet");
  });
});

test('#82 · le workflow des méta-harnais ne tourne pas sur toute PR, seulement sur les règles ou à la demande', () => {
  const texte = lire(RACINE, '.github/workflows/meta-harnais.yml');
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
    '.github/workflows/meta-harnais.yml',
    (t) => t.replace(/pull_request:\s*\n\s*paths:\s*\n(?:\s*-\s*.+\n?)+/, 'pull_request:\n'),
    async () => {
      const texte = lire(RACINE, '.github/workflows/meta-harnais.yml');
      const m = texte.match(/pull_request:\s*\n\s*paths:\s*\n(?:\s*-\s*.+\n?)+/);
      assert.equal(m, null, "le témoin ne mord pas : un « pull_request » sans « paths » passerait toujours");
    },
  );
});

test('#82 · les workflows du chemin courant n’appellent pas « pnpm meta »', () => {
  for (const nom of ['ci.yml', 'verifications.yml']) {
    const texte = lire(RACINE, `.github/workflows/${nom}`);
    assert.ok(!/\bpnpm meta\b/.test(texte), `${nom} appelle pnpm meta : les méta-harnais rentreraient dans le chemin courant`);
  }
});

test('#82 · CLAUDE.md dit, une fois pour toutes, où poser le harnais qu’une session écrit (D65)', () => {
  const texte = lire(RACINE, 'CLAUDE.md');
  assert.match(texte, /D65/, "CLAUDE.md ne cite plus D65 : le renvoi au vocabulaire a disparu");
  assert.match(texte, /méta-harnais/, "CLAUDE.md ne nomme plus les méta-harnais");
  assert.match(texte, /meta-harnais\//, "CLAUDE.md ne dit plus dans quel dossier vit un méta-harnais");
});

test('#82 · docs/gardes.md dit que les méta-harnais restent hors du registre du produit', () => {
  const texte = lire(RACINE, 'docs/gardes.md');
  assert.match(texte, /méta-harnais/, 'docs/gardes.md ne nomme plus les méta-harnais');
  assert.match(texte, /#82/, 'docs/gardes.md ne cite plus #82');
});
