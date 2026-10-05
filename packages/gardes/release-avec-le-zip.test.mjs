/**
 * Tests du codeur de #289 : la release d'une version publiée porte son ZIP d'hébergement, même quand
 * l'APK n'a pas été construit.
 *
 * `ci.yml` est joué à blanc (`workflow-a-blanc.mjs`), au tag poussé à la main et pour une version
 * forcée (qui arrive par `workflow_call`, depuis `version-forcee.yml`). L'échec observé le 29/09 (run
 * 36555185939) est rejoué tel quel : l'étape `android-actions/setup-android` échoue.
 *
 * Ce qu'un test ne peut pas jouer : la création de la release par GitHub, ni ce que l'action fait d'une
 * release déjà créée à la main. Le test de la release nommée par le tag ne garde que le mécanisme ; le
 * reste se constate sur une vraie publication.
 *
 * L'échec attendu d'un témoin rouge tient dans une assertion : `node:test` n'a pas de `test.fails`
 * (docs/gardes.md, #66).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { RACINE } from './gardes.mjs';
import { jouer } from './workflow-a-blanc.mjs';

const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');
const CI = '.github/workflows/ci.yml';

const FORCÉE = {
  github: { event_name: 'workflow_dispatch', ref: 'refs/heads/main', repository: 'sverley/Tirelire', event: {} },
  vars: { TIRELIRE_FTP_DOSSIER: 'prod', TIRELIRE_DEV_FTP_DOSSIER: 'recette', TIRELIRE_BASE: '/prod/' },
  secrets: {},
  inputs: { version_forcee: true },
  steps: { pret: { outputs: { pret: 'oui' } } },
};
const AU_TAG = { ...FORCÉE, github: { ...FORCÉE.github, event_name: 'push', ref: 'refs/tags/v0.2' }, inputs: {} };
const CONTEXTES = { 'au tag poussé à la main': AU_TAG, 'pour une version forcée': FORCÉE };

// ─── Ce que font les étapes ──────────────────────────────────────────────────────────────────────

const RELEASE = /uses:\s*softprops\/action-gh-release@/;
const ZIP = /tirelire-hebergement\.zip/;
const APK = /\.apk\b/;

const CONFIGURATION_ANDROID = (é) => /android-actions\/setup-android/.test(é.texte);
const CONSTRUCTION_APK = (é) => /assembleRelease/.test(é.texte);
const ASSEMBLAGE_SITE = (é) => /@tirelire\/hebergement\s+assembler/.test(é.texte);
const TAG_POSÉ = (é) => /GITHUB_REF_NAME|\/git\/refs\b/.test(é.texte);

/** Les étapes de release jouées, avec le job qui les joue. */
const releases = (partie) => partie.flatMap((job) => job.joués.filter((é) => RELEASE.test(é.texte)).map((é) => ({ job: job.nom, texte: é.texte })));

/** Un résumé d'exécution qui dit que la release sort sans APK. */
const ditSansAPK = (partie) => partie.some((job) => job.joués.some((é) => /GITHUB_STEP_SUMMARY/.test(é.texte) && /sans APK/.test(é.texte)));

/** Les jobs dont dépend `nom`, de proche en proche. */
function amonts(partie, nom, vus = new Set()) {
  for (const n of partie.find((j) => j.nom === nom)?.besoins ?? []) if (!vus.has(n)) vus.add(n), amonts(partie, n, vus);
  return vus;
}

// ─── Ce que #289 demande à la CI, rejoué aussi sur des workflows cassés ─────────────────────────

/** « Fait quand » 1 : l'APK en échec ne retient pas la release, qui porte le ZIP. */
function leZipSortMalgréLÉchecDeLAPK(yaml) {
  for (const [quand, ctx] of Object.entries(CONTEXTES)) {
    for (const [échec, échoue] of [['la configuration d’Android', CONFIGURATION_ANDROID], ['la construction de l’APK', CONSTRUCTION_APK]]) {
      const partie = jouer(yaml, ctx, échoue);
      const android = partie.find((j) => j.nom === 'android');
      assert.ok(android?.tourne && !android.réussi, `${CI} : ${quand}, le témoin n'a pas fait échouer « APK Android » (${échec}) ; le test est à relire`);
      const faites = releases(partie);
      assert.ok(
        faites.some((r) => ZIP.test(r.texte)),
        `${CI} : ${quand}, quand ${échec} échoue, la release ne porte pas ${'tirelire-hebergement.zip'} ; releases jouées : ${faites.map((r) => r.job).join(', ') || 'aucune'}`,
      );
      assert.ok(
        faites.every((r) => !APK.test(r.texte)),
        `${CI} : ${quand}, quand ${échec} échoue, la release cherche un APK qui n'existe pas`,
      );
    }
  }
}

/** « Fait quand » 2, première moitié : l'APK construit, la release le porte aussi, après le ZIP. */
function leZipPuisLAPK(yaml) {
  for (const [quand, ctx] of Object.entries(CONTEXTES)) {
    const partie = jouer(yaml, ctx);
    const faites = releases(partie);
    const duZip = faites.filter((r) => ZIP.test(r.texte));
    const deLAPK = faites.filter((r) => APK.test(r.texte));
    assert.equal(duZip.length, 1, `${CI} : ${quand}, tout vert, le ZIP doit être joint une fois ; il l'est ${duZip.length} fois`);
    assert.equal(deLAPK.length, 1, `${CI} : ${quand}, tout vert, l'APK doit être joint une fois ; il l'est ${deLAPK.length} fois`);
    assert.ok(
      amonts(partie, deLAPK[0].job).has(duZip[0].job),
      `${CI} : ${quand}, l'APK est joint par « ${deLAPK[0].job} » sans attendre la release de « ${duZip[0].job} » : la release n'existe peut-être pas encore`,
    );
  }
}

/** « Fait quand » 2, seconde moitié : le résumé de l'exécution dit « sans APK » quand l'APK échoue, et seulement alors. */
function leRésuméDitSansAPK(yaml) {
  for (const [quand, ctx] of Object.entries(CONTEXTES)) {
    assert.ok(!ditSansAPK(jouer(yaml, ctx)), `${CI} : ${quand}, tout vert, le résumé dit que la release sort sans APK`);
    for (const [échec, échoue] of [['la configuration d’Android', CONFIGURATION_ANDROID], ['la construction de l’APK', CONSTRUCTION_APK]]) {
      assert.ok(ditSansAPK(jouer(yaml, ctx, échoue)), `${CI} : ${quand}, quand ${échec} échoue, le résumé de l'exécution ne dit pas que la release sort sans APK`);
    }
  }
}

// ─── Les tests ───────────────────────────────────────────────────────────────────────────────────

describe('[niveau 4] #289 · la release d’une version publiée porte son ZIP d’hébergement, que l’APK soit construit ou non', () => {
  test('« Fait quand » 1 · l’APK en échec ne retient pas la release : au tag comme pour une version forcée, elle porte le ZIP', () => {
    leZipSortMalgréLÉchecDeLAPK(lire(CI));
  });

  test('« Fait quand » 2 · l’APK construit, la release le porte aussi, une fois publiée par le job du ZIP', () => {
    leZipPuisLAPK(lire(CI));
  });

  test('« Fait quand » 2 · le résumé de l’exécution dit que la release sort sans APK quand l’APK échoue, et seulement alors', () => {
    leRésuméDitSansAPK(lire(CI));
  });

  test('« Fait quand » 4 · rien ne se publie quand le site ne s’assemble pas, ni quand le tag ne se pose pas', () => {
    for (const [quand, ctx] of Object.entries(CONTEXTES)) {
      for (const [échec, échoue] of [['l’assemblage du site', ASSEMBLAGE_SITE], ['la pose du tag', TAG_POSÉ]]) {
        const faites = releases(jouer(lire(CI), ctx, échoue));
        assert.deepEqual(faites, [], `${CI} : ${quand}, quand ${échec} échoue, une release se publie : ${faites.map((r) => r.job).join(', ')}`);
      }
    }
  });

  test('« Fait quand » 3 · la release visée est celle du tag posé par « Étiquette de la version » : créée, ou mise à jour si elle existe déjà', () => {
    const partie = jouer(lire(CI), AU_TAG);
    const faites = releases(partie);
    assert.ok(faites.length >= 2, `${CI} : les releases jouées au tag sont ${faites.length}, il en faut une pour le ZIP et une pour l'APK`);
    for (const r of faites) {
      assert.match(r.texte, /tag_name:\s*\$\{\{\s*needs\.etiquette\.outputs\.nom\s*\}\}/, `${CI} : « ${r.job} » ne vise pas le tag posé par « etiquette »`);
      assert.doesNotMatch(r.texte, /^\s*draft:\s*true\b/m, `${CI} : « ${r.job} » publie un brouillon : la release ne serait pas téléchargeable`);
      assert.ok(amonts(partie, r.job).has('etiquette'), `${CI} : « ${r.job} » ne dépend pas de « etiquette », dont il lit le tag`);
    }
  });

  test('« Fait quand » 5 · D83 et docs/hebergement-web.md disent que la release porte le ZIP, et l’APK s’il est construit', () => {
    const espaces = (t) => t.replace(/\s+/g, ' ');
    const d83 = espaces(lire('docs/methodes.md').split('- **Seul le porteur publie une version**')[1]?.split('\n- ')[0] ?? '');
    assert.ok(d83, 'docs/methodes.md : l’entrée « Seul le porteur publie une version » manque ; le test est à relire');
    assert.match(d83, /tirelire-hebergement\.zip/, 'D83 (« Seul le porteur publie une version ») ne dit pas que la release porte le ZIP');
    assert.match(d83, /avec l'APK s'il est construit/, 'D83 (« Seul le porteur publie une version ») ne dit pas que l’APK est joint s’il est construit');
    const hébergement = espaces(lire('docs/hebergement-web.md'));
    assert.match(hébergement, /tirelire-hebergement\.zip` à la release, avec l'APK s'il est construit/, 'docs/hebergement-web.md ne dit pas que la release porte le ZIP, et l’APK s’il est construit');
  });
});

describe('[niveau 4] #289 · témoins rouges', () => {
  test('témoin rouge · la release qui attend « APK Android » ne sort pas quand l’APK échoue (l’état d’avant #289)', () => {
    const cassé = lire(CI).replace('name: Publication des releases\n    needs: [hebergement, etiquette]', 'name: Publication des releases\n    needs: [hebergement, android, etiquette]');
    assert.notEqual(cassé, lire(CI), 'le workflow n’a pas pu être cassé : le témoin de #289 est à relire');
    assert.throws(() => leZipSortMalgréLÉchecDeLAPK(cassé), /ne porte pas tirelire-hebergement\.zip/);
  });

  test('témoin rouge · un APK joint sans attendre la release du ZIP', () => {
    const cassé = lire(CI).replace('needs: [etiquette, android, publication]', 'needs: [etiquette, android]');
    assert.notEqual(cassé, lire(CI), 'le workflow n’a pas pu être cassé : le témoin de #289 est à relire');
    assert.throws(() => leZipPuisLAPK(cassé), /sans attendre la release/);
  });

  test('témoin rouge · un résumé qui ne se joue pas quand l’APK échoue', () => {
    // `cancelled()` : le harnais ne le joue jamais, comme un résumé qui ne se déclencherait pas sur l'échec.
    const cassé = lire(CI).replace("- name: En cas d'échec, dire que la release sort sans APK\n        if: failure()", "- name: En cas d'échec, dire que la release sort sans APK\n        if: cancelled()");
    assert.notEqual(cassé, lire(CI), 'le workflow n’a pas pu être cassé : le témoin de #289 est à relire');
    assert.throws(() => leRésuméDitSansAPK(cassé), /ne dit pas que la release sort sans APK/);
  });
});
