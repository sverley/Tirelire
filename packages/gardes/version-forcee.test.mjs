/**
 * Harnais d'audit de #274, composé par #285 parmi les tests du codeur (D83) : un test qui porte
 * sa propre marque est retenu à ce niveau ; les autres restent au niveau 4.
 *
 * Tests de #274 : publier une version forcée du dernier `main`, d'un déclenchement manuel.
 *
 * **Rien ne se publie sur un rouge** — D83 (« Publication d'une version : 3, tests navigateur
 * activés ; rien ne se saute »), comme au tag poussé à la main (`niveaux-des-tests.test.mjs`,
 * `tests-lourds.test.mjs`) : une version forcée joue le seuil 3 en entier, et rien ne se publie —
 * ni tag, ni dépôt en production, ni APK, ni release — tant qu'il n'est pas vert ; le tag et le
 * dépôt viennent après.
 *
 * **Les règles de #274** : l'usage restant possible si elles tombaient : le nom (la base, le hash,
 * les versions forcées écartées, `v0.0` sans version publiée, jamais une version numérotée) ; rien
 * ne se publie sur un commit déjà publié, ni hors de `main`, et le déclenchement le dit ; le
 * déclenchement est manuel, sans autre saisie.
 *
 * `ci.yml` est joué à blanc (`workflow-a-blanc.mjs`) : une version forcée y arrive par
 * `workflow_call`, depuis `version-forcee.yml`, lancé à la main sur `main` ; le contexte `github` est
 * alors celui du déclenchement (`workflow_dispatch`, `refs/heads/main`).
 *
 * L'échec attendu d'un témoin rouge tient dans une assertion : `node:test` n'a pas de `test.fails`
 * (docs/gardes.md, #66).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { RACINE } from './gardes.mjs';
import { BASE_INITIALE, NUMÉROTÉE, base, décider, nomDeLaVersionForcée } from './version-forcee.mjs';
import { commande, interpoler, jobs, jouer, scalaire, étapes } from './workflow-a-blanc.mjs';

const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');
const CI = '.github/workflows/ci.yml';
const DÉCLENCHEMENT = '.github/workflows/version-forcee.yml';
const SCRIPT = join(RACINE, 'packages/gardes/version-forcee.mjs');

const SHA = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d';
const FORCÉE = {
  github: { event_name: 'workflow_dispatch', ref: 'refs/heads/main', repository: 'sverley/Tirelire', event: {} },
  vars: { TIRELIRE_FTP_DOSSIER: 'prod', TIRELIRE_DEV_FTP_DOSSIER: 'recette', TIRELIRE_BASE: '/prod/' },
  secrets: {},
  inputs: { version_forcee: true },
  // Les secrets FTP présents : les étapes de dépôt, que l'étape « pret » conditionne, se jouent.
  steps: { pret: { outputs: { pret: 'oui' } } },
};
const LANCEMENT = { ...FORCÉE, inputs: { deploiement: 'automatique' } };
const AU_TAG = { ...FORCÉE, github: { ...FORCÉE.github, event_name: 'push', ref: 'refs/tags/v0.2' }, inputs: {} };

// ─── Ce que font les étapes ──────────────────────────────────────────────────────────────────────

const POSE_TAG = /\/git\/refs\b|\bgit\s+tag\s+(?!-l\b|--list\b|--points-at\b)\S|\bgit\s+push\b[^\n]*(?:--tags|refs\/tags)/;
const PUBLIE = { 'un tag posé': POSE_TAG, 'un dépôt en production': /deposer\.sh/, "l'APK construit": /assembleRelease/, 'une release publiée': /action-gh-release/ };
const publications = (partie) =>
  partie.flatMap((job) => job.joués.flatMap((é) => Object.entries(PUBLIE).filter(([, m]) => m.test(commande(é))).map(([quoi]) => `${quoi} (« ${job.nom} »)`)));
const auSeuil3 = (é) => /\bpnpm\s+test\s+3\b/.test(commande(é));
const nomDeVersion = (é) => /version-forcee\.mjs\s+nom\b/.test(commande(é));
const lancementsDeTests = (partie) => partie.flatMap((j) => j.joués.flatMap((é) => commande(é).split('\n').filter((l) => /\bpnpm\b.*\btest\b|harnais-du-besoin\.sh --jouer/.test(l))));

/** Les jobs dont dépend `nom`, de proche en proche. */
function amonts(partie, nom, vus = new Set()) {
  for (const n of partie.find((j) => j.nom === nom)?.besoins ?? []) if (!vus.has(n)) vus.add(n), amonts(partie, n, vus);
  return vus;
}

/** Une étape ajoutée, ou une ligne changée, dans un job : de quoi casser `ci.yml` pour les témoins. */
function réécrireJob(yaml, nom, changer) {
  const lignes = yaml.split('\n');
  const job = jobs(yaml).get(nom);
  assert.ok(job, `${CI} : le job « ${nom} » manque ; le témoin est à relire`);
  lignes.splice(job.début + 1, job.lignes.length, ...changer(job.lignes));
  return lignes.join('\n');
}

// ─── Le seuil 3 en entier, puis le tag, puis la publication ─────────────────────────────────────

/** Ce que D83 demande à une version forcée, rejoué aussi sur des workflows cassés. */
function seuil3PuisPublication(yaml) {
  const partie = jouer(yaml, FORCÉE);
  const l = lancementsDeTests(partie);
  // Le seuil 3, puis les tests navigateur au seuil 3, en une étape ou en deux (#266 : le moins cher
  // d'abord, et `pnpm test 3` seul reste l'étape stricte que lit la garde).
  assert.ok(l.some((c) => /\bpnpm test 3\b/.test(c)) && l.some((c) => /\btest 3 --navigateur\b/.test(c)), `${CI} : une version forcée ne joue pas le seuil 3, tests navigateur compris\n${l.join('\n')}`);
  for (const c of l) assert.doesNotMatch(c, /--attestation/, `${CI} : pour une version forcée, rien ne se saute : « ${c.trim()} »`);

  const faites = publications(partie);
  for (const quoi of Object.keys(PUBLIE)) assert.ok(faites.some((f) => f.startsWith(quoi)), `${CI} : une version forcée, tout vert, ne fait pas ${quoi} ; faits : ${faites.join(', ') || 'rien'}`);

  // Sur un rouge avant la publication, rien ne se publie : ni tag, ni dépôt, ni APK, ni release.
  const test = partie.find((j) => j.nom === 'test');
  const rouges = test.joués.filter((é) => auSeuil3(é) || nomDeVersion(é) || /\bpnpm typecheck\b/.test(commande(é)));
  assert.ok(rouges.some(auSeuil3) && rouges.some(nomDeVersion), `${CI} : le job « test » ne joue plus le seuil 3 ou le nom de la version forcée ; le harnais de #274 est à relire`);
  for (const rouge of rouges) {
    const quand = jouer(yaml, FORCÉE, (é) => é.texte === rouge.texte);
    assert.deepEqual(publications(quand), [], `${CI} : pour une version forcée, un rouge à « ${rouge.lignes[0].trim()} » n'empêche pas de publier`);
  }

  // Le tag vient après le seuil 3, et le dépôt en production et la release après le tag.
  const poseurs = partie.filter((j) => j.joués.some((é) => POSE_TAG.test(commande(é))));
  assert.equal(poseurs.length, 1, `${CI} : une version forcée doit poser son tag dans un seul job ; le posent : ${poseurs.map((j) => j.nom).join(', ') || 'aucun'}`);
  const [poseur] = poseurs;
  assert.ok(amonts(partie, poseur.nom).has('test'), `${CI} : le job « ${poseur.nom} » pose le tag sans attendre le seuil 3 (« test »)`);
  for (const job of partie.filter((j) => j.joués.some((é) => /deposer\.sh|assembleRelease|action-gh-release/.test(commande(é))))) {
    assert.ok(amonts(partie, job.nom).has(poseur.nom), `${CI} : le job « ${job.nom} » publie sans attendre le tag (« ${poseur.nom} »)`);
  }
}

describe('[niveau 4] #274, D83 · une version forcée joue le seuil 3 en entier ; le tag et le dépôt ne viennent qu’après, et rien ne se publie sur un rouge', () => {
  test('[niveau 1] le seuil 3, tests navigateur compris, sans rien sauter ; puis le tag ; puis le dépôt en production, l’APK et la release', () => {
    seuil3PuisPublication(lire(CI));
  });

  test('témoin rouge · un tag posé sans attendre le seuil 3', () => {
    const cassé = réécrireJob(lire(CI), 'etiquette', (lignes) => lignes.filter((l) => !/^ {4}needs:/.test(l)));
    assert.notEqual(cassé, lire(CI), 'le workflow n’a pas pu être cassé : le témoin de #274 est à relire');
    assert.throws(() => seuil3PuisPublication(cassé), /n'empêche pas de publier|sans attendre le seuil 3/);
  });

  test('témoin rouge · un tag posé dans le job des tests, avant le seuil 3', () => {
    const pose = '      - run: gh api "repos/$GITHUB_REPOSITORY/git/refs" -f ref="refs/tags/v0.0-x" -f sha="$GITHUB_SHA"';
    const cassé = réécrireJob(lire(CI), 'test', (lignes) => {
      const i = lignes.findIndex((l) => /pnpm test 3/.test(l));
      const début = lignes.slice(0, i).findLastIndex((l) => /^ {6}- /.test(l));
      return [...lignes.slice(0, début), pose, ...lignes.slice(début)];
    });
    assert.throws(() => seuil3PuisPublication(cassé), /n'empêche pas de publier/);
  });

  test('témoin rouge · un seuil 3 qui saute ce que l’attestation couvre', () => {
    const cassé = lire(CI).replace(/pnpm test 3\b/, 'pnpm test 3 --attestation "$RUNNER_TEMP/attestation.json"');
    assert.notEqual(cassé, lire(CI), 'le workflow n’a pas pu être cassé : le témoin de #274 est à relire');
    assert.throws(() => seuil3PuisPublication(cassé), /rien ne se saute/);
  });

  test('le lancement manuel de ci.yml, lui, ne publie rien (#233)', () => {
    const faites = publications(jouer(lire(CI), LANCEMENT));
    assert.deepEqual(faites, [], `${CI} : lancé à la main sans version forcée, il publie : ${faites.join(', ')}`);
  });
});

// ─── Le nom, les refus, le déclenchement ────────────────────────────────────────────────────────

describe('[niveau 4] #274 · le nom d’une version forcée', () => {
  test('[niveau 2] le dernier numéro de version publié, un tiret, le hash court du commit', () => {
    assert.equal(nomDeLaVersionForcée(['v0.1', 'v0.2'], SHA), 'v0.2-1a2b3c4');
  });

  test('[niveau 2] le dernier numéro se compare nombre par nombre', () => {
    assert.equal(base(['v0.9', 'v0.10', 'v0.2.5', 'v0.10.0']), 'v0.10');
    assert.equal(base(['v1', 'v0.12.3']), 'v1');
    assert.equal(base(['v2.0.1', 'v2.0']), 'v2.0.1');
  });

  test('[niveau 2] une version forcée ne sert jamais de base, ni un tag qui n’est pas numéroté', () => {
    assert.equal(nomDeLaVersionForcée(['v0.2', 'v0.2-aaaaaaa', 'v9.9-bbbbbbb', 'v1.0-rc1', 'latest', 'v', 'v1.', 'vx.1'], SHA), 'v0.2-1a2b3c4');
  });

  test('[niveau 2] tant qu’aucune version numérotée n’est publiée, la base est v0.0', () => {
    assert.equal(BASE_INITIALE, 'v0.0');
    assert.equal(nomDeLaVersionForcée([], SHA), 'v0.0-1a2b3c4');
    assert.equal(nomDeLaVersionForcée(['latest', 'v0.0-aaaaaaa'], SHA), 'v0.0-1a2b3c4');
  });

  test('[niveau 2] le nom n’est jamais une version numérotée, et ne porte pas de « # »', () => {
    for (const tags of [[], ['v0.2'], ['v3.1.4', 'v3.1.4-1234567']]) {
      const nom = nomDeLaVersionForcée(tags, SHA);
      assert.doesNotMatch(nom, NUMÉROTÉE, `« ${nom} » serait une version numérotée`);
      assert.doesNotMatch(nom, /#/);
      assert.match(nom, /^v\d+(?:\.\d+)*-[0-9a-f]{7}$/);
    }
  });
});

describe('[niveau 4] #274 · rien ne se publie sur un commit déjà publié, ni hors de main, et le déclenchement le dit', () => {
  test('[niveau 2] un commit qui porte déjà une version, forcée ou numérotée, est refusé', () => {
    for (const tagsDuCommit of [['v0.2'], ['v0.2-1a2b3c4'], ['latest', 'v1.0-rc1']]) {
      const d = décider({ ref: 'refs/heads/main', sha: SHA, tags: ['v0.2', ...tagsDuCommit], tagsDuCommit });
      assert.equal(d.nom, undefined, `publié malgré ${tagsDuCommit.join(', ')}`);
      assert.match(d.refus, /porte déjà une version/);
    }
    assert.deepEqual(décider({ ref: 'refs/heads/main', sha: SHA, tags: ['v0.2', 'latest'], tagsDuCommit: ['latest'] }), { nom: 'v0.2-1a2b3c4' });
  });

  test('[niveau 2] un déclenchement qui ne vise pas main est refusé', () => {
    for (const ref of ['refs/heads/codage/274-x', 'refs/tags/v0.2', undefined]) {
      assert.match(décider({ ref, sha: SHA, tags: [], tagsDuCommit: [] }).refus ?? '', /dernier commit de main/, `publié depuis « ${ref} »`);
    }
  });

  let dossier;
  after(() => dossier && rmSync(dossier, { recursive: true, force: true }));
  const env = () => {
    const e = { ...process.env };
    for (const k of Object.keys(e)) if (k.startsWith('GIT_') || k.startsWith('GITHUB_') || k === 'NODE_TEST_CONTEXT') delete e[k];
    return { ...e, GIT_AUTHOR_NAME: 'Tests 274', GIT_AUTHOR_EMAIL: 'tests@exemple.invalid', GIT_COMMITTER_NAME: 'Tests 274', GIT_COMMITTER_EMAIL: 'tests@exemple.invalid' };
  };
  const git = (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...a], { cwd: dossier, env: env(), encoding: 'utf8' }).trim();
  /** Le script, dans un petit dépôt : `{ code, sortie, nom, résumé }`. */
  function lancer(ref, sha) {
    const sortie = join(dossier, `sortie-${Math.random().toString(36).slice(2)}`);
    const résumé = `${sortie}-résumé`;
    writeFileSync(sortie, '');
    writeFileSync(résumé, '');
    const r = spawnSync(process.execPath, [SCRIPT, 'nom'], { cwd: dossier, env: { ...env(), GITHUB_REF: ref, GITHUB_SHA: sha, GITHUB_OUTPUT: sortie, GITHUB_STEP_SUMMARY: résumé }, encoding: 'utf8' });
    return { code: r.status, sortie: r.stdout + r.stderr, nom: readFileSync(sortie, 'utf8').match(/^nom=(.*)$/m)?.[1], résumé: readFileSync(résumé, 'utf8') };
  }

  test('[niveau 2] en ligne de commande, dans un dépôt : le nom, puis le refus sur le commit déjà publié', () => {
    dossier = mkdtempSync(join(tmpdir(), 'version-forcee-274-'));
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'un');
    git('tag', 'v0.2');
    git('commit', '-q', '--allow-empty', '-m', 'deux');
    git('tag', 'v0.3-abcdef1');
    git('commit', '-q', '--allow-empty', '-m', 'trois');
    const sha = git('rev-parse', 'HEAD');

    const libre = lancer('refs/heads/main', sha);
    assert.equal(libre.code, 0, libre.sortie);
    assert.equal(libre.nom, `v0.2-${sha.slice(0, 7)}`, libre.sortie);
    assert.match(libre.résumé, new RegExp(`v0\\.2-${sha.slice(0, 7)}`));

    git('tag', libre.nom);
    const déjà = lancer('refs/heads/main', sha);
    assert.notEqual(déjà.code, 0, `le commit déjà publié n'est pas refusé\n${déjà.sortie}`);
    assert.equal(déjà.nom, undefined, 'un nom sort malgré le refus');
    assert.match(déjà.sortie + déjà.résumé, /porte déjà une version/, 'le déclenchement ne dit pas pourquoi rien ne se publie');

    const ailleurs = lancer('refs/heads/autre', git('rev-parse', 'HEAD~1'));
    assert.notEqual(ailleurs.code, 0, ailleurs.sortie);
    assert.match(ailleurs.résumé, /dernier commit de main/);
  });
});

describe('[niveau 4] #274 · le déclenchement : manuel, sans autre saisie, et le tag porte le nom trouvé', () => {
  test('[niveau 2] version-forcee.yml : un lancement manuel sans saisie, qui appelle ci.yml en version forcée', () => {
    const yaml = lire(DÉCLENCHEMENT);
    const entête = yaml.split('\njobs:')[0];
    const déclencheurs = [...(entête.match(/^on:\s*\n((?:(?: .*)?\n)*)/m)?.[1] ?? '').matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
    assert.deepEqual(déclencheurs, ['workflow_dispatch'], `${DÉCLENCHEMENT} : seul un lancement manuel le déclenche`);
    assert.doesNotMatch(entête, /^ {4}inputs:/m, `${DÉCLENCHEMENT} : le lancement ne demande aucune saisie`);
    const js = [...jobs(yaml).values()];
    assert.equal(js.length, 1, `${DÉCLENCHEMENT} : un seul job`);
    const [job] = js;
    assert.equal(scalaire(job.lignes, /^ {4}uses:/), './.github/workflows/ci.yml', `${DÉCLENCHEMENT} : le job n'appelle pas ci.yml`);
    assert.match(job.lignes.join('\n'), /^ {6}version_forcee:\s*true\s*$/m, `${DÉCLENCHEMENT} : ci.yml n'est pas appelé en version forcée`);
    assert.match(job.lignes.join('\n'), /^ {4}secrets:\s*inherit\s*$/m, `${DÉCLENCHEMENT} : ci.yml ne reçoit pas les secrets du dépôt, dont ceux du dépôt en production`);
    assert.match(scalaire(job.lignes, /^ {4}if:/), /^$/, `${DÉCLENCHEMENT} : une condition sauterait le job en silence ; ci.yml refuse lui-même, et le dit`);
  });

  test('[niveau 2] ci.yml : appelé avec version_forcee, un booléen ; nul autre ne le lance en version forcée', () => {
    const entête = lire(CI).split('\njobs:')[0];
    assert.match(entête, /^ {2}workflow_call:\s*\n {4}inputs:\s*\n {6}version_forcee:\s*\n(?: {8}.*\n)*? {8}type:\s*boolean\s*$/m, `${CI} : l'appel en version forcée n'est pas déclaré`);
    const dispatch = entête.split(/^ {2}workflow_call:/m)[0].split(/^ {2}workflow_dispatch:/m)[1] ?? '';
    assert.doesNotMatch(dispatch, /version_forcee/, `${CI} : son lancement manuel ne propose pas la version forcée`);
  });

  test('[niveau 2] le tag posé porte le nom relu par le script, le même que celui trouvé avant les tests', () => {
    const yaml = lire(CI);
    const partie = jouer(yaml, FORCÉE);
    const poseur = partie.find((j) => j.joués.some((é) => POSE_TAG.test(commande(é))));
    assert.ok(poseur, `${CI} : aucun job ne pose le tag d'une version forcée`);
    const pose = poseur.joués.find((é) => POSE_TAG.test(commande(é)));
    const nom = pose.texte.match(/refs\/tags\/\$\{?(\w+)\}?/)?.[1];
    assert.ok(nom, `${CI} : le tag posé n'est pas lu d'une variable`);
    const source = scalaire(pose.lignes, new RegExp(`^ {10}${nom}:`));
    const id = source.match(/steps\.(\w+)\.outputs\.nom/)?.[1];
    assert.ok(id, `${CI} : le nom du tag posé (« ${source} ») ne vient pas d'une étape du job`);
    const relu = poseur.joués.find((é) => new RegExp(`^ +id:\\s*${id}\\s*$`, 'm').test(é.texte));
    assert.ok(relu && nomDeVersion(relu), `${CI} : l'étape « ${id} » ne lance pas \`version-forcee.mjs nom\``);
    assert.match(commande(pose), /"\$NOM"\s*!=\s*"\$ATTENDU"/, `${CI} : le nom relu n'est pas comparé à celui trouvé avant les tests`);
    assert.match(scalaire(pose.lignes, /^ {10}ATTENDU:/), /needs\.test\.outputs\.version_forcee/);
    const test = partie.find((j) => j.nom === 'test');
    const i = test.joués.findIndex(nomDeVersion);
    assert.ok(i >= 0 && i < test.joués.findIndex(auSeuil3), `${CI} : le nom et le refus d'un commit déjà publié ne viennent pas avant le seuil 3`);
  });

  test('[niveau 2] le site de la version forcée s’assemble pour la production, pas pour la recette, et la recette n’est pas redéposée', () => {
    const partie = jouer(lire(CI), FORCÉE);
    const assemblage = partie.flatMap((j) => j.joués.filter((é) => /hebergement\s+assembler/.test(commande(é)))).at(0);
    assert.ok(assemblage, `${CI} : le site de la version forcée ne s'assemble pas`);
    assert.equal(interpoler(scalaire(assemblage.lignes, /^ {10}TIRELIRE_BASE:/), FORCÉE), '/prod/');
    const recette = partie.filter((j) => j.joués.some((é) => /apercu\.sh\s+racine-deposer/.test(commande(é))));
    assert.deepEqual(recette.map((j) => j.nom), [], `${CI} : une version forcée redépose la recette`);
  });

  test('[niveau 2] au tag poussé à la main, la release porte le tag poussé, après le même job', () => {
    const partie = jouer(lire(CI), AU_TAG);
    const étiquette = partie.find((j) => j.nom === 'etiquette');
    assert.ok(étiquette?.tourne, `${CI} : au tag poussé, le job « etiquette » ne tourne pas, et la release l'attend`);
    assert.deepEqual(publications([étiquette]), [], `${CI} : au tag poussé, un second tag se pose`);
    const nomme = étiquette.joués.find((é) => /GITHUB_REF_NAME/.test(commande(é)));
    assert.ok(nomme, `${CI} : au tag poussé, le job « etiquette » ne nomme pas le tag`);
    const release = partie.flatMap((j) => j.joués).find((é) => /action-gh-release/.test(commande(é)));
    assert.match(scalaire(release.lignes, /^ {10}tag_name:/), /needs\.etiquette\.outputs\.nom/);
  });
});

// Le témoin des règles de #274 : l'étape du nom, qui se laisserait échouer.
describe('[niveau 4] #274 · témoin rouge', () => {
  test('témoin rouge · une étape du nom qui se laisse échouer : le commit déjà publié se republierait', () => {
    const yaml = lire(CI);
    const cassé = réécrireJob(yaml, 'test', (lignes) => lignes.flatMap((l) => (/^ {8}run: node packages\/gardes\/version-forcee\.mjs nom/.test(l) ? [l, '        continue-on-error: true'] : [l])));
    assert.notEqual(cassé, yaml, 'le workflow n’a pas pu être cassé : le témoin de #274 est à relire');
    const rouge = étapes(jobs(cassé).get('test').lignes).find(nomDeVersion);
    assert.notDeepEqual(publications(jouer(cassé, FORCÉE, (é) => é.texte === rouge.texte)), [], 'témoin : une étape du nom qui se laisse échouer devrait laisser publier');
    assert.throws(() => seuil3PuisPublication(cassé), /n'empêche pas de publier/);
  });
});
