/**
 * Harnais complémentaire à #61 (audit de la PR #63) : la relecture concurrente que la décision
 * « Plus de groupe de concurrence » attend (trois lectures, cinq secondes d'intervalle) pour
 * qu'une case en cours d'enregistrement par une vérification voisine ne soit pas décochée à tort.
 *
 * Ni `gardes.test.mjs` ni `meme-regle-github.test.mjs` n'exercent cette relecture : leurs faux
 * GitHub renvoient toujours le même état d'un appel à l'autre, et leur seul chemin qui coche une
 * case (l'événement `edited`) enregistre la validation dans le même appel, avant l'évaluation.
 * Le chemin où la relecture attend réellement — ou renonce après trois essais, ou s'arrête parce
 * que la PR a changé pendant l'attente — n'a donc aucun témoin aujourd'hui.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifierPrSurGithub } from './github.mjs';
import { AUTEUR_HORODATAGE, empreinteAnalyse, lireRegistre, texteHorodatage } from './gardes.mjs';

const GARDES = `# Gardes

## C1 · Une contrainte

Chemins : \`b/*.mjs\`

- **Vérification manuelle** · \`VM-C1-appareil\` — Sur un vrai téléphone, constater que l'écran touché reste lisible.
`;
const { entrees } = lireRegistre(GARDES);

const ANALYSE = "La PR change l'écran Plan : le regarder à 375 px.";
const TETE = 'a'.repeat(40);
const AUTRE_TETE = 'c'.repeat(40);

/** Description avec la case déjà cochée, comme après un événement `edited` antérieur. */
const corpsCoche = () =>
  [
    'Pour #1 : rien.', '', '## Ce qui change', '', 'Rien.', '', '## Invariants et contraintes', '',
    'Touchés : C1', 'Lien possible masqué : aucun', '', '### Vérifications manuelles', '',
    "- `VM-C1-appareil` · essai — Sur un vrai téléphone, constater que l'écran touché reste lisible.",
    `  - Analyse (agent, 2026-09-11) : ${ANALYSE}`,
    '  - [x] Validée par un développeur humain', '',
  ].join('\n');

const enregistrement = () =>
  texteHorodatage([{ cle: 'VM-C1-appareil', tete: TETE, cible: 'main', analyse: empreinteAnalyse(ANALYSE), par: 'sverley', date: '2026-09-11T10:42:00.000Z' }]);

/** Un faux GitHub dont les commentaires lus peuvent varier d'une lecture à l'autre. */
function githubDeCourse(commentairesParLecture, { tete = TETE } = {}) {
  let lecture = 0;
  const appels = [];
  const api = {
    lirePr: async () => ({ number: 7, body: corpsCoche(), head: { sha: tete }, base: { ref: 'main' } }),
    lireCommentaires: async () => {
      const corps = commentairesParLecture[Math.min(lecture, commentairesParLecture.length - 1)];
      lecture++;
      return corps.map((body) => ({ user: { login: AUTEUR_HORODATAGE }, body }));
    },
    commenter: async (_n, body) => void appels.push({ appel: 'commenter', body }),
    modifierDescription: async (_n, body) => void appels.push({ appel: 'modifierDescription', body }),
  };
  return { api, appels };
}

const evenement = (action, tete = TETE) => ({ action, sender: { login: 'sverley' }, pull_request: { number: 7, head: { sha: tete }, base: { ref: 'main' } } });

const jouer = (api, pauses, tete = TETE) =>
  verifierPrSurGithub({
    evenement: evenement('synchronize', tete),
    api,
    entrees,
    fichiersModifies: [],
    fichiersDepuis: () => [],
    attendre: async (ms) => void pauses.push(ms),
  });

test("une case en cours d'enregistrement par une vérification voisine est attendue, pas décochée à tort", async () => {
  // Le commentaire d'enregistrement n'apparaît qu'à la troisième lecture : une autre vérification,
  // déclenchée par le même push, est en train de l'écrire (décision « Plus de groupe de concurrence »).
  const { api, appels } = githubDeCourse([[], [], [enregistrement()]]);
  const pauses = [];
  const resultat = await jouer(api, pauses);
  assert.deepEqual(pauses, [5000, 5000], 'deux pauses de cinq secondes avant la troisième lecture');
  assert.deepEqual(resultat.validees, ['VM-C1-appareil']);
  assert.deepEqual(appels, [], "aucune décochage ni commentaire d'annulation : la case a fini par s'enregistrer");
});

test("faute d'enregistrement après trois lectures, la case est décochée et le dit", async () => {
  const { api, appels } = githubDeCourse([[]]);
  const pauses = [];
  const resultat = await jouer(api, pauses);
  assert.deepEqual(pauses, [5000, 5000], 'les trois lectures sont épuisées avant de renoncer');
  assert.deepEqual(resultat.validees, []);
  assert.equal(appels.filter((a) => a.appel === 'modifierDescription').length, 1);
  assert.ok(appels.some((a) => a.appel === 'commenter' && /case cochée sans validation enregistrée/.test(a.body)));
});

test('si la PR change pendant la relecture, on cesse d’attendre sans rien décocher à tort', async () => {
  const { api, appels } = githubDeCourse([[]]);
  // La deuxième lecture voit une nouvelle tête : un push a eu lieu pendant la pause.
  let n = 0;
  api.lirePr = async () => {
    const tete = n === 0 ? TETE : AUTRE_TETE;
    n++;
    return { number: 7, body: corpsCoche(), head: { sha: tete }, base: { ref: 'main' } };
  };
  const pauses = [];
  const resultat = await jouer(api, pauses);
  assert.deepEqual(pauses, [5000], 'une seule pause : la PR a changé, inutile de continuer à relire');
  assert.deepEqual(appels, [], 'rien ne se décoche pour un événement dépassé par un nouveau push');
  assert.match(resultat.enAttente.join('\n'), /vérification suivante fait foi/);
});
