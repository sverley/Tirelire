/**
 * Harnais d'audit de #248, composé par #285 parmi les tests du codeur (D83) : un test qui porte
 * sa propre marque est retenu à ce niveau ; les autres restent au niveau 4.
 *
 * #248 · Un workflow déclenché par `pull_request_target` n'exécute rien de la PR ; il peut en lire les
 * données (D83, « Workflows »). Il tourne avec les droits du dépôt et ses secrets : extraire la tête
 * de la PR, ou sa référence de fusion, y ferait tourner les scripts de la PR avec eux : un secret
 * serait exposé.
 *
 * Les workflows se lisent dans `.github/workflows/`, sans être nommés : un workflow ajouté plus tard
 * est lu comme les autres. Le lecteur est `rien-de-la-pr.mjs`.
 *
 * L'échec attendu d'un témoin rouge tient dans une assertion : `node:test` n'a pas de `test.fails`
 * (docs/gardes.md, #66).
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { describe } from 'node:test';
import { RACINE } from './gardes.mjs';
import { déclenchéParPullRequestTarget, extractionsSurPullRequestTarget } from './rien-de-la-pr.mjs';

const DOSSIER = '.github/workflows';
const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');
const workflows = () =>
  readdirSync(join(RACINE, DOSSIER))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ fichier: `${DOSSIER}/${f}`, yaml: lire(`${DOSSIER}/${f}`) }));

/** Ajoute une étape en tête des étapes du premier job. */
function avecÉtape(yaml, étape) {
  const i = yaml.search(/^ {4}steps:\s*$/m);
  assert.ok(i >= 0, 'aucune liste d’étapes où ajouter l’extraction');
  const fin = yaml.indexOf('\n', i) + 1;
  return `${yaml.slice(0, fin)}${étape}\n${yaml.slice(fin)}`;
}
const checkout = (ref) => `      - uses: actions/checkout@v4\n        with:\n          ref: ${ref}`;

/** Les extractions de la PR que le témoin fait faire à chaque workflow. */
const EXTRACTIONS = [
  ['la tête de la PR', checkout('${{ github.event.pull_request.head.sha }}')],
  ['la tête de la PR, `with:` en mappage sur une ligne', '      - uses: actions/checkout@v4\n        with: { ref: "${{ github.event.pull_request.head.sha }}" }'],
  ['la référence de fusion, `with:` en mappage sur une ligne', '      - uses: actions/checkout@v4\n        with: { fetch-depth: 0, ref: refs/pull/${{ github.event.pull_request.number }}/merge }'],
  ['la branche de la PR', checkout('${{ github.head_ref }}')],
  ['la référence de fusion', checkout('refs/pull/${{ github.event.pull_request.number }}/merge')],
  ['la tête de la PR, par git', '      - run: git checkout "${{ github.event.pull_request.head.sha }}"'],
  ['la PR, par gh', '      - run: gh pr checkout "${{ github.event.pull_request.number }}"'],
];

describe('[niveau 4] D83, « Workflows » : un workflow déclenché par pull_request_target n’exécute rien de la PR (#248)', () => {
  test('[niveau 0] #248 · aucun workflow déclenché par pull_request_target n’extrait la PR : il la lit comme une donnée', () => {
    const lus = workflows().filter(({ yaml }) => déclenchéParPullRequestTarget(yaml));
    assert.ok(lus.length > 0, `aucun workflow déclenché par pull_request_target dans ${DOSSIER}`);
    assert.deepEqual(lus.flatMap(({ fichier, yaml }) => extractionsSurPullRequestTarget(fichier, yaml)), [], 'un workflow déclenché par pull_request_target extrait la PR');
  });

  test('[niveau 0] #248 · témoin rouge · la tête de la PR, ou sa référence de fusion, extraite par un workflow d’aujourd’hui', () => {
    const aujourdhui = ['apercu.yml', 'depot-apercu.yml', 'pret.yml', 'suivi.yml', 'validation.yml'].map((f) => `${DOSSIER}/${f}`);
    const lus = new Map(workflows().filter(({ yaml }) => déclenchéParPullRequestTarget(yaml)).map(({ fichier, yaml }) => [fichier, yaml]));
    for (const fichier of aujourdhui) {
      const yaml = lus.get(fichier);
      assert.ok(yaml, `${fichier} n’est pas lu comme déclenché par pull_request_target`);
      for (const [quoi, étape] of EXTRACTIONS) {
        assert.notDeepEqual(extractionsSurPullRequestTarget(fichier, avecÉtape(yaml, étape)), [], `${fichier} : ${quoi} extraite, rien ne rougit`);
      }
      // La mutation de l'auditeur de #243 : `ref: main` remplacé par la tête de la PR.
      if (/^\s+ref:\s*main\s*$/m.test(yaml)) {
        const muté = yaml.replace(/^(\s+ref:\s*)main\s*$/gm, '$1${{ github.event.pull_request.head.sha }}');
        assert.notDeepEqual(extractionsSurPullRequestTarget(fichier, muté), [], `${fichier} : \`ref: main\` remplacé par la tête de la PR, rien ne rougit`);
      }
    }
  });

  const inventé = (on, étapes) => `name: Inventé\n\n${on}\n\npermissions:\n  contents: read\n\njobs:\n  lire:\n    runs-on: ubuntu-latest\n    steps:\n${étapes}\n`;
  const LIRE_LA_PR = [
    '      - uses: actions/checkout@v4',
    '        with:',
    '          fetch-depth: 0',
    '      - run: git show "${{ github.event.pull_request.head.sha }}:README.md"',
    '      - run: gh pr view "${{ github.event.pull_request.number }}" --json body --jq .body',
  ].join('\n');

  test('[niveau 0] #248 · témoin rouge · un workflow inventé, déclenché par pull_request_target, qui extrait la PR', () => {
    for (const on of ['on:\n  pull_request_target:\n    types: [opened]', 'on: [push, pull_request_target]', 'on: pull_request_target']) {
      const sain = inventé(on, LIRE_LA_PR);
      assert.ok(déclenchéParPullRequestTarget(sain), `« ${on} » : non lu comme déclenché par pull_request_target`);
      for (const [quoi, étape] of EXTRACTIONS) {
        assert.notDeepEqual(extractionsSurPullRequestTarget('inventé.yml', avecÉtape(sain, étape)), [], `« ${on} » : ${quoi} extraite, rien ne rougit`);
      }
    }
  });

  test('#248 · témoin vert · lire la PR comme une donnée reste permis', () => {
    // Extraire main, lire la tête par git, lire la description par l'API : rien n'est extrait.
    assert.deepEqual(extractionsSurPullRequestTarget('inventé.yml', inventé('on:\n  pull_request_target:', LIRE_LA_PR)), []);
    assert.deepEqual(extractionsSurPullRequestTarget('inventé.yml', inventé('on:\n  pull_request_target:', checkout('main'))), []);
    assert.deepEqual(extractionsSurPullRequestTarget('inventé.yml', inventé('on:\n  pull_request_target:', '      - uses: actions/checkout@v4\n        with: { ref: main, fetch-depth: 0 }')), []);
  });
});
