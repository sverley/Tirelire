/**
 * Amorçage de #122, écrit par la session d'audit du 16 septembre 2026.
 *
 * #122 (parent #119) : la CI joue tous les harnais et la garde sur chaque PR, en mode strict. Le
 * porteur l'a décidé le 16 septembre dans #119 : « on fait tourner tous les harnais et la garde en CI
 * avec crash si outil manquant ». Fait quand :
 *   - `amorcage.yml` n'a plus de filtre de chemins : tous les amorçages tournent sur chaque PR, avec
 *     `TIRELIRE_STRICT` ;
 *   - tous les harnais et la garde tournent en CI ; un outil manquant y fait échouer le job.
 *
 * Lecture retenue, consignée dans #122 : « tous les harnais » sont ceux qui lisent des fichiers
 * suivis (typecheck, `pnpm test` avec la couverture de la garde, build, `pnpm amorcage`) et, parmi
 * ceux qui lisent hors d'eux, la vérification des PR (`verifications.yml`). L'alerte de fusion et la
 * vérification du site en ligne ne peuvent pas tourner sur une PR (D71).
 *
 * Ce que ce fichier juge, sur l'arbre, sans rien comparer à la base (D70) :
 *   1. le déclenchement de `amorcage.yml`, `ci.yml` et `verifications.yml` atteint chaque PR :
 *      `pull_request` présent, sans `paths` ni `paths-ignore`, et des `types` qui gardent l'ouverture
 *      et les nouveaux commits ;
 *   2. les étapes qui jouent les harnais tournent sur une PR et y font échouer le job : ni `if:` qui
 *      écarte les PR, ni `continue-on-error`. `TIRELIRE_STRICT` est vrai pour `pnpm amorcage` et
 *      `pnpm test`, dans l'étape, le job ou le workflow ;
 *   3. un amorçage qui se saute sous condition lit `TIRELIRE_STRICT` : en CI, l'outil qui manque le
 *      fait échouer au lieu de le taire. La garde le vérifie pour le workspace, pas pour `amorcage/`,
 *      qui en est hors ;
 *   4. les règles écrites suivent. Le glossaire porte, à la place de l'ancienne, la phrase que le
 *      porteur a validée mot pour mot le 16 septembre (Q1 de #122). Une entrée du journal postérieure
 *      à D73 cite #122, dit que les amorçages tournent sur chaque PR, et nomme D65 et D72, dont elle
 *      remplace un passage (D64).
 *
 * Rouge sur `main` : 1 (filtre `paths` de `amorcage.yml`) et 4. Vert : 2 et 3, qui gardent ce qui
 * tient déjà.
 *
 * Témoins. Les lectures 1 à 3 sont des fonctions pures sur du texte, éprouvées sur des workflows et
 * des sources fabriqués. Un témoin vert retire le filtre du `amorcage.yml` du jour et constate que la
 * lecture passe. La prose de 4 n'a de témoin que pour le découpage du journal : une présence
 * textuelle suffit (D62).
 *
 * Hors harnais (D62) : un `if:` écrit sous une forme exotique, un workflow retiré par la PR même, un
 * filtre `branches` (toutes les PR visent `main`).
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEPOT, lignesDe } from './test/copie-du-depot.mjs';

const RELIRE = "l'amorçage de #122 est à relire";
const AMORCAGE = '.github/workflows/amorcage.yml';
const CI = '.github/workflows/ci.yml';
const VERIFICATIONS = '.github/workflows/verifications.yml';
const GLOSSAIRE = 'docs/glossaire.md';
const DECISIONS = 'docs/decisions.md';
const DOSSIER = 'amorcage';

/** La dernière décision écrite avant #122 : l'entrée attendue vient après. */
const DERNIERE_DECISION = 73;

/** Validée mot pour mot par le porteur le 16 septembre 2026 (Q1 de #122). */
const PHRASE_VALIDEE = 'Les amorçages sont joués en CI sur chaque PR, et en local à la demande (`pnpm amorcage`).';
const PHRASE_RETIREE = "Les amorçages n'ont pas à être joués autrement qu'en cas de codage dans la garde";

const lire = (fichier) => readFileSync(join(DEPOT, fichier), 'utf8');
const aplatir = (texte) => texte.replace(/\s+/g, ' ');

// --- Lecture d'un workflow, ligne à ligne ------------------------------------------------------

const renfoncement = (ligne) => ligne.length - ligne.trimStart().length;
const utile = (ligne) => ligne.trim() !== '' && !/^\s*#/.test(ligne);
const sansCommentaire = (ligne) => ligne.replace(/\s+#.*$/, '');
const sansGuillemets = (v) => v.trim().replace(/^["']|["']$/g, '');
const valeur = (ligne) => sansCommentaire(ligne).replace(/^[^:]*:\s*/, '').trim();
const cle = (ligne) => sansCommentaire(ligne).trim().replace(/^-\s+/, '').match(/^["']?([\w-]+)["']?\s*:/)?.[1];

/** Lignes utiles plus renfoncées qui suivent la ligne `i`. */
function bloc(l, i) {
  const base = renfoncement(l[i]);
  const r = [];
  for (let j = i + 1; j < l.length; j++) {
    if (!utile(l[j])) continue;
    if (renfoncement(l[j]) <= base) break;
    r.push(j);
  }
  return r;
}

/** Enfants directs de la ligne `i` : les lignes de son bloc au plus petit renfoncement. */
function enfants(l, i) {
  const b = bloc(l, i);
  if (!b.length) return [];
  const niveau = Math.min(...b.map((j) => renfoncement(l[j])));
  return b.filter((j) => renfoncement(l[j]) === niveau);
}

/** Valeurs d'une liste YAML, en ligne (`[a, b]`) ou en bloc (`- a`). */
function liste(l, i) {
  const v = valeur(l[i]);
  if (v) return v.replace(/^\[|\]$/g, '').split(',').map(sansGuillemets).filter(Boolean);
  return bloc(l, i).map((j) => sansGuillemets(sansCommentaire(l[j]).trim().replace(/^-\s*/, '')));
}

/** Ce qui empêche un workflow de se déclencher sur chaque PR ; vide s'il s'y déclenche. */
export function problemesDeDeclenchement(texte) {
  const l = lignesDe(texte);
  const on = l.findIndex((x) => /^["']?on["']?\s*:/.test(x));
  if (on < 0) return ['aucune clé « on: »'];
  const absent = ['« pull_request » est absent du déclenchement'];
  const enLigne = valeur(l[on]);
  if (enLigne) return enLigne.replace(/^\[|\]$/g, '').split(',').map(sansGuillemets).includes('pull_request') ? [] : absent;
  const pr = enfants(l, on).find((j) => /^(?:-\s*)?["']?pull_request["']?\s*(?::|$)/.test(sansCommentaire(l[j]).trim()));
  if (pr === undefined) return absent;
  if (/^\s*-/.test(l[pr])) return [];
  const v = valeur(l[pr]);
  if (v && !['null', '~', '{}'].includes(v)) {
    return /\bpaths(?:-ignore)?\s*:/.test(v) ? ['un filtre de chemins est écrit en ligne sous « pull_request »'] : [];
  }
  const problemes = [];
  for (const j of enfants(l, pr)) {
    const nom = cle(l[j]);
    if (nom === 'paths' || nom === 'paths-ignore') {
      problemes.push(`« ${nom} » sous « pull_request » : une PR hors de ces chemins ne joue rien`);
    }
    if (nom === 'types') {
      const types = liste(l, j);
      for (const attendu of ['opened', 'synchronize']) {
        if (!types.includes(attendu)) problemes.push(`« types » sous « pull_request » omet « ${attendu} »`);
      }
    }
  }
  return problemes;
}

/** Une condition `if:` qui écarte les PR, sous les formes plausibles. */
function ecarteLesPR(condition) {
  const c = condition.replace(/\s+/g, ' ');
  if (/event_name ?!= ?['"]pull_request['"]/.test(c)) return true;
  const egalites = [...c.matchAll(/event_name ?== ?['"]([\w-]+)['"]/g)].map((m) => m[1]);
  return egalites.length > 0 && !egalites.includes('pull_request') && !c.includes('||');
}

/** Un bloc `env:` pose-t-il `TIRELIRE_STRICT` à une valeur vraie ? */
function envStricte(l, iEnv) {
  if (iEnv === undefined || iEnv < 0) return false;
  const ligne = enfants(l, iEnv).find((j) => cle(l[j]) === 'TIRELIRE_STRICT');
  if (ligne === undefined) return false;
  return !['', '0', 'false', 'no', 'non', 'null', '~'].includes(sansGuillemets(valeur(l[ligne])).toLowerCase());
}

const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Ce qui empêche `commande` de juger chaque PR dans ce workflow ; vide si une étape au moins la joue
 * sur une PR, fait échouer le job quand elle rougit et, si `strict`, pose `TIRELIRE_STRICT`.
 */
export function problemesDEtape(texte, commande, { strict }) {
  const l = lignesDe(texte);
  const motif = new RegExp(`(?:^|[\\s;&|(])${echapper(commande)}(?=$|[\\s;&|)])`);
  const iJobs = l.findIndex((x) => /^jobs\s*:/.test(x));
  const iEnvWorkflow = l.findIndex((x) => /^env\s*:/.test(x));
  const problemes = [];
  let trouvee = false;
  for (const job of iJobs < 0 ? [] : enfants(l, iJobs)) {
    const champsJob = enfants(l, job);
    const duJob = (nom) => champsJob.find((j) => cle(l[j]) === nom);
    const iSteps = duJob('steps');
    for (const etape of iSteps === undefined ? [] : enfants(l, iSteps)) {
      const niveau = renfoncement(l[etape]) + 2;
      const champs = [etape, ...bloc(l, etape).filter((j) => renfoncement(l[j]) === niveau)];
      const deLEtape = (nom) => champs.find((j) => cle(l[j]) === nom);
      const iRun = deLEtape('run');
      if (iRun === undefined) continue;
      const script = [valeur(l[iRun])];
      for (const j of bloc(l, etape).filter((k) => k > iRun)) {
        if (renfoncement(l[j]) <= niveau) break;
        script.push(l[j].trim());
      }
      if (!script.some((x) => motif.test(x))) continue;
      trouvee = true;
      const ici = [];
      for (const [ou, i] of [['le job', duJob('if')], ["l'étape", deLEtape('if')]]) {
        if (i !== undefined && ecarteLesPR(valeur(l[i]))) ici.push(`${ou} qui joue « ${commande} » écarte les PR (${valeur(l[i])})`);
      }
      for (const [ou, i] of [['le job', duJob('continue-on-error')], ["l'étape", deLEtape('continue-on-error')]]) {
        if (i !== undefined && sansGuillemets(valeur(l[i])).toLowerCase() !== 'false') {
          ici.push(`${ou} qui joue « ${commande} » porte « continue-on-error » : un rouge n'y fait pas échouer le job`);
        }
      }
      if (strict && !envStricte(l, deLEtape('env')) && !envStricte(l, duJob('env')) && !envStricte(l, iEnvWorkflow)) {
        ici.push(`l'étape qui joue « ${commande} » ne pose pas TIRELIRE_STRICT à une valeur vraie (étape, job ou workflow) : un outil manquant y passerait pour vert`);
      }
      if (!ici.length) return [];
      problemes.push(...ici);
    }
  }
  return trouvee ? problemes : [`aucune étape ne joue « ${commande} »`];
}

// --- Sauts faute d'outil -----------------------------------------------------------------------

const SAUTS = [
  /(?<![\w.])(?:t|ctx|context|contexte)\.skip\s*\(/,
  /\.(?:skipIf|runIf)\s*\(/,
  /\bskip\s*:\s*(?!false\b|undefined\b)[^\s,}]/,
];

/** Une source qui se saute sous condition sans lire `TIRELIRE_STRICT` hors des commentaires. */
export function sauteSansStrict(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  return SAUTS.some((m) => m.test(code)) && !/\bTIRELIRE_STRICT\b/.test(code);
}

const sourcesDesAmorcages = () =>
  readdirSync(join(DEPOT, DOSSIER), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.mjs'))
    .sort();

// --- Journal des décisions ---------------------------------------------------------------------

/** Les entrées postérieures à D73 qui citent #122. */
export function entreesDe122(journal) {
  return journal.split(/^(?=## D\d+\b)/m).filter((partie) => {
    const numero = Number(partie.match(/^## D(\d+)\b/)?.[1]);
    return numero > DERNIERE_DECISION && /#122\b/.test(partie);
  });
}

// --- Témoins -----------------------------------------------------------------------------------

const workflow = (declenchement) =>
  `name: x\n\n${declenchement}\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm amorcage\n`;

test('#122 · témoin : les déclenchements qui atteignent chaque PR passent', () => {
  for (const d of [
    'on:\n  workflow_dispatch:\n  pull_request:\n',
    'on:\n  pull_request:\n    types: [opened, synchronize, reopened]\n',
    "on:\n  pull_request:\n    types:\n      - opened\n      - 'synchronize'\n",
    'on:\n  pull_request:\n    # paths:\n    #   - docs/**\n',
    'on:\n  pull_request:\n    branches: [main]\n',
    'on:\n  - push\n  - pull_request\n',
    'on: [pull_request, workflow_dispatch]\n',
    'on: pull_request\n',
  ]) {
    assert.deepEqual(problemesDeDeclenchement(workflow(d)), [], `déclenchement refusé à tort : ${RELIRE}\n${d}`);
  }
});

test('#122 · témoin : les déclenchements qui laissent passer une PR sont vus', () => {
  for (const [cas, d] of [
    ['filtre paths', "on:\n  workflow_dispatch:\n  pull_request:\n    paths:\n      - 'amorcage/**'\n"],
    ['filtre paths-ignore', "on:\n  pull_request:\n    paths-ignore: ['apps/**']\n"],
    ['filtre en ligne', 'on:\n  pull_request: { paths: [docs/**] }\n'],
    ['pull_request absent', 'on:\n  workflow_dispatch:\n  push:\n    branches: [main]\n'],
    ['pull_request_target seul', 'on:\n  pull_request_target:\n'],
    ['types sans synchronize', 'on:\n  pull_request:\n    types: [opened, closed]\n'],
    ['pull_request en commentaire', 'on:\n  workflow_dispatch:\n  # pull_request:\n'],
    ['liste en ligne sans PR', 'on: [push, workflow_dispatch]\n'],
  ]) {
    assert.notDeepEqual(problemesDeDeclenchement(workflow(d)), [], `${cas} passe inaperçu : ${RELIRE}`);
  }
});

test('#122 · témoin vert : le amorcage.yml du jour, sans filtre de chemins, se déclenche sur chaque PR', () => {
  const texte = lire(AMORCAGE);
  const sansFiltre = texte.replace(/(\n[ \t]*pull_request:[ \t]*\n)[ \t]+paths(?:-ignore)?:[ \t]*\n(?:[ \t]+-[^\n]*\n)+/, '$1');
  assert.deepEqual(problemesDeDeclenchement(sansFiltre), [], `le retrait du filtre ne suffit pas à la lecture : ${RELIRE}`);
});

const STRICT_ETAPE = "        env:\n          TIRELIRE_STRICT: '1'\n";
const job = ({ env = '', jobEnv = '', wfEnv = '', si = '', coe = '', run = '      - run: pnpm amorcage\n' } = {}) =>
  `name: x\n${wfEnv}on:\n  pull_request:\njobs:\n  a:\n    runs-on: ubuntu-latest\n${si}${coe}${jobEnv}    steps:\n` +
  `      - uses: actions/checkout@v4\n${run}${env}      - run: pnpm build\n`;
const etape = (texte) => problemesDEtape(texte, 'pnpm amorcage', { strict: true });

test('#122 · témoin : une étape stricte qui juge chaque PR passe', () => {
  for (const [cas, texte] of [
    ["strict dans l'étape", job({ env: STRICT_ETAPE })],
    ['strict dans le job', job({ jobEnv: "    env:\n      TIRELIRE_STRICT: '1'\n" })],
    ['strict dans le workflow', job({ wfEnv: 'env:\n  TIRELIRE_STRICT: true\n' })],
    ['script sur plusieurs lignes', job({ run: '      - name: Amorçages\n        run: |\n          set -e\n          pnpm amorcage\n', env: STRICT_ETAPE })],
    ['condition qui garde les PR', job({ env: STRICT_ETAPE, si: "    if: github.event_name == 'push' || github.event_name == 'pull_request'\n" })],
    ['continue-on-error faux', job({ env: STRICT_ETAPE, coe: '    continue-on-error: false\n' })],
    ['une autre étape exclue, celle-ci non', job({ run: "      - run: pnpm amorcage\n        if: github.event_name != 'pull_request'\n      - run: pnpm amorcage\n", env: STRICT_ETAPE })],
  ]) {
    assert.deepEqual(etape(texte), [], `${cas} refusé à tort : ${RELIRE}`);
  }
  assert.deepEqual(problemesDEtape(job(), 'pnpm build', { strict: false }), [], `une étape non stricte refusée à tort : ${RELIRE}`);
});

test('#122 · témoin : une étape qui ne juge pas, ou pas strictement, chaque PR est vue', () => {
  for (const [cas, texte] of [
    ['TIRELIRE_STRICT absent', job()],
    ['TIRELIRE_STRICT à 0', job({ env: "        env:\n          TIRELIRE_STRICT: '0'\n" })],
    ['TIRELIRE_STRICT en commentaire', job({ env: "        env:\n          # TIRELIRE_STRICT: '1'\n          AUTRE: x\n" })],
    ["TIRELIRE_STRICT sur l'étape suivante", job({ run: '      - run: pnpm amorcage\n      - run: pnpm autre\n', env: STRICT_ETAPE })],
    ['job écarté des PR', job({ env: STRICT_ETAPE, si: "    if: github.event_name != 'pull_request'\n" })],
    ['job réservé au push', job({ env: STRICT_ETAPE, si: "    if: ${{ github.event_name == 'push' }}\n" })],
    ['continue-on-error sur le job', job({ env: STRICT_ETAPE, coe: '    continue-on-error: true\n' })],
    ["continue-on-error sur l'étape", job({ run: '      - run: pnpm amorcage\n        continue-on-error: true\n', env: STRICT_ETAPE })],
    ['commande absente', job({ run: '      - run: pnpm amorcage:lent\n', env: STRICT_ETAPE })],
    ['commande en commentaire', job({ run: '      - run: echo rien # pnpm amorcage\n', env: STRICT_ETAPE })],
  ]) {
    assert.notDeepEqual(etape(texte), [], `${cas} passe inaperçu : ${RELIRE}`);
  }
});

test("#122 · témoin : un saut faute d'outil sans TIRELIRE_STRICT est vu, un saut qui le lit non", () => {
  for (const [cas, source] of [
    ['t.skip', "test('x', (t) => {\n  if (!php) return t.skip('php absent');\n});\n"],
    ['option skip calculée', "test('x', { skip: !navigateur }, () => {});\n"],
    ['skipIf', "it.skipIf(!outil)('x', () => {});\n"],
    ['TIRELIRE_STRICT cité en commentaire seulement', "// TIRELIRE_STRICT\ntest('x', (t) => { if (!git) t.skip('pas de git'); });\n"],
  ]) {
    assert.ok(sauteSansStrict(source), `${cas} passe inaperçu : ${RELIRE}`);
  }
  for (const [cas, source] of [
    ['saut qui lit TIRELIRE_STRICT', "const STRICT = Boolean(process.env.TIRELIRE_STRICT);\ntest('x', (t) => { if (!git) { assert.ok(!STRICT); return t.skip('x'); } });\n"],
    ['texte fabriqué dans une chaîne', "const source = \"it.skip('casse', () => {});\";\n"],
    ['saut non conditionnel', "test.skip('x', () => {});\n"],
    ['option skip à false', "test('x', { skip: false }, () => {});\n"],
    ['mot skip en commentaire', "// un test .skip compte comme désactivé\n"],
  ]) {
    assert.equal(sauteSansStrict(source), false, `${cas} refusé à tort : ${RELIRE}`);
  }
});

test('#122 · témoin : seule une entrée postérieure à D73 qui cite #122 compte', () => {
  const journal = (entrees) => `# Journal\n\n${entrees.join('\n')}`;
  assert.equal(entreesDe122(journal(['## D73 · x\n\nRien.\n'])).length, 0);
  assert.equal(entreesDe122(journal(['## D60 · x\n\nCite #122.\n', '## D74 · y\n\nCite #1220.\n'])).length, 0);
  assert.equal(entreesDe122(journal(['## D73 · x\n\nRien.\n', '## D74 · y\n\nBesoin #122.\n', '## D75 · z\n\nAutre.\n'])).length, 1);
});

// --- Le dépôt ----------------------------------------------------------------------------------

test('#122 · amorcage.yml se déclenche sur chaque PR, sans filtre de chemins', () => {
  assert.deepEqual(problemesDeDeclenchement(lire(AMORCAGE)), [], `${AMORCAGE} ne se déclenche pas sur chaque PR`);
});

test('#122 · amorcage.yml joue les amorçages en mode strict, et un rouge fait échouer le job', () => {
  assert.deepEqual(problemesDEtape(lire(AMORCAGE), 'pnpm amorcage', { strict: true }), []);
});

test('#122 · ci.yml joue typecheck, tests en mode strict et build sur chaque PR', () => {
  const texte = lire(CI);
  assert.deepEqual(
    [
      ...problemesDeDeclenchement(texte),
      ...problemesDEtape(texte, 'pnpm typecheck', { strict: false }),
      ...problemesDEtape(texte, 'pnpm test', { strict: true }),
      ...problemesDEtape(texte, 'pnpm build', { strict: false }),
    ],
    [],
    `${CI} ne joue plus tous les harnais du workspace sur chaque PR`,
  );
});

test('#122 · verifications.yml, la garde des PR, tourne sur chaque PR', () => {
  const texte = lire(VERIFICATIONS);
  assert.deepEqual(
    [...problemesDeDeclenchement(texte), ...problemesDEtape(texte, 'node packages/gardes/cli.mjs pr', { strict: false })],
    [],
    `${VERIFICATIONS} ne juge plus chaque PR`,
  );
});

test("#122 · un amorçage qui se saute faute d'outil lit TIRELIRE_STRICT", () => {
  const sources = sourcesDesAmorcages();
  assert.ok(sources.length > 1, `aucun amorçage trouvé dans ${DOSSIER}/ : ${RELIRE}`);
  const fautifs = sources.filter((f) => sauteSansStrict(lire(join(DOSSIER, f))));
  assert.deepEqual(fautifs, [], "ces amorçages se sautent sous condition sans lire TIRELIRE_STRICT : en CI, l'outil manquant passerait pour vert");
});

test('#122 · le glossaire porte la phrase validée par le porteur, et plus l’ancienne', () => {
  const texte = aplatir(lire(GLOSSAIRE));
  assert.ok(texte.includes(PHRASE_VALIDEE), `${GLOSSAIRE} ne porte pas, mot pour mot, la phrase validée le 16 septembre : « ${PHRASE_VALIDEE} »`);
  assert.ok(!texte.includes(PHRASE_RETIREE), `${GLOSSAIRE} dit encore que les amorçages ne se jouent qu'en cas de codage dans la garde`);
});

test('#122 · une entrée du journal dit que les amorçages tournent sur chaque PR, et ce qu’elle remplace', () => {
  const entrees = entreesDe122(lire(DECISIONS));
  assert.ok(entrees.length, `aucune entrée postérieure à D${DERNIERE_DECISION} ne cite #122 dans ${DECISIONS}`);
  const texte = aplatir(entrees.join('\n'));
  assert.match(texte, /chaque PR/, "l'entrée de #122 ne dit pas que les amorçages tournent sur chaque PR");
  assert.match(texte, /\bD65\b/, "l'entrée de #122 ne nomme pas D65, dont elle remplace le « Moment »");
  assert.match(texte, /\bD72\b/, "l'entrée de #122 ne nomme pas D72, dont elle remplace « ne tourne d'office que sur une PR qui touche aux règles »");
});
