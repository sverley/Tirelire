/**
 * Lanceur des tests par seuil (#232, D83) : le script `test` de chaque paquet passe par lui.
 *
 *   node lanceur.mjs vitest run [N] [arguments de vitest…]
 *   node lanceur.mjs node --import ./sans-sortie.mjs --test [N] [arguments de node --test…]
 *
 * N, facultatif, est le seuil : seuls les tests de niveau inférieur ou égal se jouent (2 sans
 * entrée ; 4 joue tout). Il vient en premier après la commande du paquet, pour que `pnpm test N`
 * et `pnpm --dir <paquet> run test N …` le lui passent. Ce qui est écarté se compte et se dit sur
 * une ligne, après le verdict de l'exécuteur, dont le code de sortie est rendu tel quel.
 *
 * Un test appelé nommément (`-t` de vitest, `--test-name-pattern` de node) se joue quel que soit son
 * niveau : le seuil ne s'applique pas.
 *
 * Les tests navigateur (`test/navigateur/`, sous vitest) coûtent cher : ils ne se jouent que si
 * l'option `--navigateur` les active, après le seuil (`pnpm test 2 --navigateur`). Sans elle, ils
 * sont écartés et dits sur une ligne qui nomme le navigateur. Ils y sont comptés tels qu'ils sont
 * écrits dans leurs fichiers, sans les charger : un test écrit dans une boucle compte pour un, et la
 * ligne le dit, pour que ce nombre ne passe pas pour celui des tests exécutés (#232, point 3). Tout
 * paquet accepte l'option, puisque `pnpm test` la passe à chacun ; hors vitest, elle ne change rien.
 *
 * L'attestation, fichier par fichier (#237, #266, #302) :
 * - Tout lancement saute chaque fichier de test vert sur la même empreinte à un seuil au moins égal
 *   — attesté vert lui-même, ou couvert avec tout son ensemble —, atteste les fichiers qu'il joue
 *   verts, et dit, pour chaque ensemble, combien de fichiers il joue et combien il saute, et
 *   pourquoi ; le détail, fichier par fichier, se lit à la demande, et le lancement dit où (#352).
 *   Hors CI, chaque ensemble tient en une ligne de 160 caractères au plus — nom, seuil, verdict,
 *   fichiers joués, fichiers sautés comptés par raison —, sans nom de fichier de test ; un fichier
 *   rouge est nommé, avec chaque test en échec, son message et son endroit (`echecs.mjs`) ; un
 *   fichier qui a tourné sans être attesté est nommé, avec la raison. Le détail — chaque fichier joué
 *   ou sauté, ce qui couvre chaque fichier sauté (par qui, sur quel arbre ou quel commit, à quel
 *   seuil), et la sortie de l'exécuteur — s'écrit dans `<dossier git>/tirelire-detail/<paquet>.txt`,
 *   réécrit au lancement suivant ; un crochet passe `--detail <fichier>`, garde la sortie de
 *   l'exécuteur dans son journal, et conserve les deux jusqu'à son passage suivant. En CI —
 *   couverture écrite par elle (`ready`, `main`, `nuit`), ou `--complet` qu'elle passe —, tout se dit,
 *   fichier par fichier, comme avant (D83). Rien de ce comportement ne se lit de l'environnement
 *   (`CI`, `GITHUB_ACTIONS`) : qui lance le sert en option ou en fichier (#352, point 9). L'empreinte d'un fichier attesté est celle de ce qu'il lit (D83, #304,
 *   `empreintesDesFichiers`), calculée sur le contenu joué, copie de travail comprise
 *   (`attestation-git.mjs`, `arbreDeLaCopie`).
 * - `--attestation <fichier>`, que passent la CI et la livraison : ce qui couvre ce lancement, écrit
 *   par `.githooks/attestation.mjs` ; `--bilan <fichier>`, que passe la livraison : ce que chaque
 *   fichier joué a donné, pour qu'elle atteste un à un les fichiers verts d'un ensemble qui ne l'est
 *   pas. Un fichier absent vaut « aucune empreinte verte ». Sans elle, le
 *   lanceur lit lui-même ce que ce clone connaît : l'attestation de la branche extraite, locale et
 *   distante, et la base commune avec `main`, verte jusqu'au seuil 2 (D83). Sur une tête détachée ou
 *   une sous-branche, seule cette base commune couvre, et aucune attestation ne se lit (#314) ; sur
 *   `main`, rien ne se saute.
 * - Hors CI et hors livraison, c'est-à-dire sans `--attestation`, sur une branche qui n'est ni `main`
 *   ni une sous-branche, le lanceur atteste chaque fichier dont tous les tests de niveau au plus le
 *   seuil ont tourné et fini verts : le fichier, son ensemble, son seuil — 4 si aucun de ses tests
 *   n'a été écarté —, l'empreinte jouée. Rien n'est attesté pour un fichier rouge, ou dont un test
 *   s'est sauté faute d'outil, ni pour un ensemble dont un fichier lu a changé pendant le lancement.
 *   L'attestation part avec le push suivant, ou avec la demande (`pnpm livraison`).
 * - Un appel nommé se joue toujours, et n'atteste rien. La décision passe par les arguments, jamais
 *   par une variable d'environnement (D83).
 *
 * - vitest : le seuil devient un filtre de nom complet (`-t`), et un rapporteur de plus compte les
 *   tests écartés (`niveaux-vitest-rapport.mjs`) ; les fichiers sautés sont exclus (`--exclude`), et
 *   un autre rapporteur dit ce que chaque fichier a donné (`fichiers-vitest-rapport.mjs`).
 * - node --test : un préchargement (`niveaux-node.mjs`) substitue à `node:test` une enveloppe qui
 *   n'inscrit pas les tests au-dessus du seuil et les compte, fichier par fichier ; les fichiers
 *   joués sont nommés, et un rapporteur de plus (`rapport-fichiers.mjs`) dit ce que chacun a donné.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, createWriteStream, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciblesDesArguments, couvertureLocale, separerLesCibles, empreintes, empreintesDesFichiers, estUnFichierDeTest, ensembleDuFichier, fichiersCouverts, fichiersDuLancement, nomDe } from './attestation.mjs';
import { ajouterALAttestation, arbreDeLaCopie, baseAvecMain, brancheAttestable, entreesDe, essaie, harnaisDuBesoin, racineGit, vertsConnus } from './attestation-git.mjs';
import { appelsDeTests } from './gardes.mjs';
import { lignesDesEchecs } from './echecs.mjs';
import { NIVEAU_MAX, ligneEcartes, lireSeuil, motifDuSeuil } from './niveaux.mjs';

const ici = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const vitest = argv[0] === 'vitest';
const fin = vitest ? argv.indexOf('run') : argv[0] === 'node' ? argv.indexOf('--test') : -1;
if (fin < 0) {
  console.error('lanceur : usage « lanceur.mjs vitest run [N] … » ou « lanceur.mjs node … --test [N] … ».');
  process.exit(2);
}
const lu = lireSeuil(argv.slice(fin + 1));
const { seuil } = lu;
const navigateur = lu.reste.includes('--navigateur');
let fichierAttestation = null;
let fichierBilan = null;
let fichierDetail = null;
let complet = false;
const reste = [];
for (let i = 0; i < lu.reste.length; i++) {
  const a = lu.reste[i];
  if (a === '--navigateur') continue;
  if (a === '--complet') complet = true;
  else if (a === '--attestation') fichierAttestation = lu.reste[++i] ?? '';
  else if (a.startsWith('--attestation=')) fichierAttestation = a.slice('--attestation='.length);
  else if (a === '--bilan') fichierBilan = lu.reste[++i] ?? '';
  else if (a.startsWith('--bilan=')) fichierBilan = a.slice('--bilan='.length);
  else if (a === '--detail') fichierDetail = lu.reste[++i] ?? '';
  else if (a.startsWith('--detail=')) fichierDetail = a.slice('--detail='.length);
  else reste.push(a);
}
const nomme = reste.some((a) => (vitest ? /^(?:-t|--testNamePattern|--test-name-pattern)(?:=|$)/ : /^--test-name-pattern(?:=|$)/).test(a));
const filtre = !nomme && seuil < NIVEAU_MAX;

const travail = mkdtempSync(join(tmpdir(), 'tirelire-seuil-'));
const dire = (texte) => console.log(`attestation : ${texte}`);
/** Le détail du lancement (#352, point 3) : chaque fichier joué ou sauté, et pourquoi, puis la sortie de l'exécuteur. */
const detail = [];
const relatif = (racine, f) => relative(racine, f).split('\\').join('/');

// ─── Le contenu joué, et ce qui le couvre (#302) ────────────────────────────────────────────────

/** La racine du dépôt : celle de git, sinon le premier dossier parent qui porte l'espace de travail pnpm. */
function racineDuDepot(git) {
  if (git) return realpathSync(git);
  for (let d = realpathSync(process.cwd()); ; d = dirname(d)) {
    if (existsSync(join(d, 'pnpm-workspace.yaml'))) return d;
    if (dirname(d) === d) return null;
  }
}
const depotGit = racineGit(process.cwd());
const racine = racineDuDepot(depotGit);
const dossier = racine ? relatif(racine, realpathSync(process.cwd())) || '.' : null;
const demande = { dossier, seuil, navigateur, cibles: ciblesDesArguments(reste), nomme };

let couverture = null;
/** Les empreintes du contenu joué, `null` s'il ne se lit pas. */
let jouees = null;
/** Les empreintes des fichiers de test du contenu joué, chacun sur ce qu'il lit (#304), `null` sans. */
let fichiersJoues = null;
const empreintesDesTests = (entrees) => empreintesDesFichiers(entrees.map((x) => x.chemin).filter(estUnFichierDeTest), entrees);
/** L'arbre joué et ses chemins, pour attester. */
let copie = null;
/** Hors CI et hors livraison, sur une branche : ce qu'il faut pour attester. */
let attester = null;
const annonces = [];

if (fichierAttestation !== null) {
  couverture = essaie(() => JSON.parse(readFileSync(fichierAttestation, 'utf8')));
  if (!couverture) annonces.push('aucune empreinte verte pour cet arbre : tout se joue');
  else if (depotGit) {
    copie = arbreDeLaCopie(depotGit);
    if (copie) {
      jouees = empreintes(copie.entrees, couverture.harnais ?? []);
      fichiersJoues = empreintesDesTests(copie.entrees);
    }
    else {
      couverture = null;
      annonces.push('le contenu joué ne se lit pas : tout se joue');
    }
  } else if (couverture.origine !== 'livraison') {
    couverture = null;
    annonces.push('hors de tout dépôt git, le contenu joué ne se lit pas : tout se joue');
  }
} else if (depotGit && !nomme) {
  const b = brancheAttestable(depotGit);
  // Sur une tête détachée ou une sous-branche (#314) : seule la base commune avec `main` couvre ; on
  // n'y lit l'attestation d'aucune branche, et on n'y atteste rien. Sur `main`, rien ne se saute.
  const baseSeule = !b.branche && b.sorte !== 'main';
  copie = b.branche || baseSeule ? arbreDeLaCopie(depotGit) : null;
  if (!b.branche && !baseSeule) annonces.push(`${b.raison} : rien ne se saute ni ne s'atteste`);
  else if (!copie) annonces.push("le contenu joué ne se lit pas : rien ne se saute ni ne s'atteste");
  else {
    // Le harnais du besoin, jamais couvert par `main` : sur une tête détachée, tout fichier qui se dit
    // harnais d'audit, faute de numéro de branche (`.githooks/harnais-du-besoin.sh`).
    const harnais = harnaisDuBesoin(b.branche ?? b.extraite ?? '', depotGit);
    jouees = empreintes(copie.entrees, harnais);
    fichiersJoues = empreintesDesTests(copie.entrees);
    const base = baseAvecMain(depotGit);
    const main = base ? essaie(() => ({ commit: base, empreintes: empreintes(entreesDe(base, depotGit)) })) : null;
    const verts = baseSeule ? [] : vertsConnus(b.branche, depotGit);
    couverture = couvertureLocale({ arbre: copie.arbre, empreintes: jouees, fichiers: fichiersJoues, verts, main, harnais });
    if (baseSeule) {
      annonces.push(
        main
          ? `${b.raison} : seul se saute ce que couvre la base commune avec main (${base.slice(0, 10)}), jusqu'au seuil 2 ; aucune attestation n'est lue, rien ne s'atteste`
          : `${b.raison}, sans base commune avec origin/main : rien ne se saute ni ne s'atteste`,
      );
    } else attester = { branche: b.branche, harnais };
  }
} else if (!depotGit) annonces.push("hors de tout dépôt git : rien ne se saute ni ne s'atteste");
if (nomme) annonces.push("appel nommé : il se joue en entier, quel que soit l'attestation, et n'atteste rien");
/** Ce que chaque fichier a donné se lit pour attester, ou pour le bilan que demande la livraison (`--bilan`). */
/**
 * Hors CI, la sortie est courte (#352) : une ligne par ensemble, sans nom de fichier de test, et le
 * détail dans un fichier. La sortie complète, fichier par fichier, que demande la CI (D83), se demande
 * par ce qu'elle sert : `--complet`, ou ce qui couvre le lancement, écrit par elle (`ready`, `main`,
 * `nuit`) ; jamais par l'environnement (#352, point 9).
 */
const enCI = complet || ['ready', 'main', 'nuit'].includes(couverture?.origine);
const court = !enCI;
/** Ce que chaque fichier a donné se lit pour attester, pour le bilan que demande la livraison (`--bilan`), ou pour la sortie courte. */
const parFichier = Boolean(attester || (fichierBilan && !nomme) || court);

// ─── Les fichiers que le lancement jouerait ─────────────────────────────────────────────────────

/** Exécutable de vitest : celui du paquet ou d'un dossier parent, sinon celui du PATH. */
function binaireVitest() {
  for (let d = process.cwd(); ; d = dirname(d)) {
    const b = join(d, 'node_modules', '.bin', 'vitest');
    if (existsSync(b)) return b;
    if (dirname(d) === d) return 'vitest';
  }
}

/** Options de vitest qui prennent une valeur dans l'argument suivant, et qui ne disent pas quels fichiers jouer. */
const SANS_EFFET_SUR_LES_FICHIERS = /^(?:-t|--testNamePattern|--test-name-pattern|--reporter|--outputFile(?:\.[a-z]+)?)$/;
const SANS_EFFET_AVEC_VALEUR = /^(?:-t|--testNamePattern|--test-name-pattern|--reporter|--outputFile(?:\.[a-z]+)?)=/;

/** Les fichiers que vitest jouerait avec ces arguments (`vitest list`), chemins absolus ; `null` s'il ne le dit pas. */
function fichiersVitest(args) {
  const pour = [];
  for (let i = 0; i < args.length; i++) {
    if (SANS_EFFET_SUR_LES_FICHIERS.test(args[i])) i++;
    else if (!SANS_EFFET_AVEC_VALEUR.test(args[i])) pour.push(args[i]);
  }
  const sortie = join(travail, 'liste.json');
  const r = spawnSync(binaireVitest(), ['list', '--filesOnly', `--json=${sortie}`, ...pour], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) return null;
  return essaie(() => JSON.parse(readFileSync(sortie, 'utf8')).map((x) => x.file));
}

/** Motifs par défaut de `node --test` (Node 22), hors `node_modules`. */
const MOTIFS_NODE = ['**/*.test.{cjs,mjs,js}', '**/*-test.{cjs,mjs,js}', '**/*_test.{cjs,mjs,js}', '**/test-*.{cjs,mjs,js}', '**/test.{cjs,mjs,js}', '**/test/**/*.{cjs,mjs,js}'];
const horsNodeModules = (f) => !f.split(/[\\/]/).includes('node_modules');
/** Les fichiers que `node --test` jouerait pour ces cibles, chemins absolus ; `null` si une cible ne se résout pas. */
function fichiersNode(cibles) {
  const trouves = new Set();
  const decouvrir = (base) => {
    for (const m of MOTIFS_NODE) for (const f of globSync(m, { cwd: base })) if (horsNodeModules(f)) trouves.add(resolve(base, f));
  };
  if (!cibles.length) decouvrir(process.cwd());
  for (const c of cibles) {
    const chemin = resolve(c);
    const s = essaie(() => statSync(chemin));
    if (s?.isFile()) trouves.add(chemin);
    else if (s?.isDirectory()) decouvrir(chemin);
    else if (/[*?[{]/.test(c)) for (const f of globSync(c)) trouves.add(resolve(f));
    else return null;
  }
  return [...trouves].sort();
}

/** Arguments de vitest du lancement, avant l'exclusion des fichiers sautés. */
const argsVitest = vitest ? [...argv.slice(1, fin + 1), ...reste] : [];
/** Sans `--navigateur`, les tests navigateur sont écartés et comptés sans être chargés. */
function testsNavigateur() {
  const i = reste.findIndex((a) => a === '--dir' || a.startsWith('--dir='));
  const base = i < 0 ? process.cwd() : resolve(reste[i].startsWith('--dir=') ? reste[i].slice(6) : reste[i + 1]);
  const dossierNav = join(base, 'test', 'navigateur');
  if (!existsSync(dossierNav)) return null;
  const compte = { fichiers: 0, tests: 0 };
  for (const f of readdirSync(dossierNav, { recursive: true })) {
    if (!/\.test\.[cm]?[jt]s$/.test(f)) continue;
    compte.fichiers++;
    compte.tests += appelsDeTests(readFileSync(join(dossierNav, f), 'utf8')).filter((a) => !a.suite).length;
  }
  return compte;
}
const sansNavigateur = vitest && !navigateur ? testsNavigateur() : null;
if (sansNavigateur !== null) argsVitest.push('--exclude', 'test/navigateur/**');

/** Les cibles de node, telles qu'écrites, et ses autres arguments. */
const { options: optionsNode, cibles: ciblesNode } = vitest ? { options: [], cibles: [] } : separerLesCibles(reste);

let decisions = [];
let candidats = null;
if (couverture && !nomme && racine) {
  candidats = vitest ? fichiersVitest(argsVitest.slice(fin)) : fichiersNode(ciblesNode);
  if (!candidats) annonces.push('la liste des fichiers ne se lit pas : tout se joue');
  else {
    const dedans = candidats.filter((f) => !relatif(racine, f).startsWith('..'));
    const chemins = new Set(copie?.entrees.map((x) => x.chemin));
    // Un fichier que l'arbre joué ne porte pas (ignoré, hors du dépôt) se joue, et ne s'atteste pas.
    const lisibles = dedans.filter((f) => !copie || chemins.has(relatif(racine, f)));
    decisions = fichiersCouverts(couverture, demande, lisibles.map((f) => relatif(racine, f)), jouees, fichiersJoues);
  }
}

// ─── Ce qui se dit avant de jouer ───────────────────────────────────────────────────────────────

for (const a of annonces) dire(`${a}.`);
const sautes = decisions.filter((d) => d.couvert);
// L'emplacement du détail : `--detail`, que passent les crochets, sinon un fichier par paquet dans le
// dossier de git, réécrit à chaque lancement (#352, point 3).
// Un crochet passe `--detail` : son journal garde la sortie de l'exécuteur, qu'il lit, et le détail
// ne reçoit que les fichiers joués et sautés.
const detailDuCrochet = fichierDetail !== null;
if (court && !fichierDetail) {
  const g = depotGit ? spawnSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: depotGit, encoding: 'utf8' }) : null;
  const base = g?.status === 0 ? join(g.stdout.trim(), 'tirelire-detail') : join(tmpdir(), 'tirelire-detail');
  fichierDetail = join(base, `${(dossier ?? 'hors-depot').replace(/[\\/]/g, '_')}.txt`);
}
if (court) {
  essaie(() => mkdirSync(dirname(resolve(fichierDetail)), { recursive: true }));
  essaie(() => writeFileSync(fichierDetail, `Détail du lancement « test ${seuil}${navigateur ? ' --navigateur' : ''} » dans ${dossier}, ${new Date().toISOString()} (#352)\n`));
}
const auDetail = (texte) => court && essaie(() => appendFileSync(fichierDetail, `${texte}\n`));
const parEnsemble = new Map();
for (const d of decisions) {
  const id = d.ensemble ?? '-';
  if (!parEnsemble.has(id)) parEnsemble.set(id, []);
  parEnsemble.get(id).push(d);
}
const raccourci = (f) => f.slice((dossier === '.' ? '' : `${dossier}/`).length);
/** Ce qui couvre un fichier sauté, en quelques mots (#352, point 1). */
function sorteDuSaut(raison) {
  if (raison.startsWith('harnais du besoin')) return 'harnais vert sur son empreinte';
  if (raison.startsWith('fichier attesté vert')) return 'attesté(s) vert(s)';
  if (raison.startsWith('empreinte trouvée verte')) return 'ensemble vert sur son empreinte';
  if (raison.includes('depuis main')) return 'base commune avec main';
  if (raison.includes('premier parent')) return 'premier parent';
  return 'couvert(s) autrement';
}
/** Les comptes d'un ensemble : « X joué(s), Y sauté(s) (n raison, …) ». */
function comptes(ds) {
  const joues = ds.filter((d) => !d.couvert).length;
  const parSorte = new Map();
  for (const d of ds.filter((x) => x.couvert)) parSorte.set(sorteDuSaut(d.raison), (parSorte.get(sorteDuSaut(d.raison)) ?? 0) + 1);
  const sautesIci = ds.length - joues;
  return `${joues} joué(s), ${sautesIci} sauté(s)${parSorte.size ? ` (${[...parSorte].map(([r, n]) => `${n} ${r}`).join(', ')})` : ''}`;
}
const nomEnsemble = (id) => (id === '-' ? 'hors ensemble' : nomDe(id));
/** Une ligne par ensemble, de 160 caractères au plus (#352, point 1). */
function ligneEnsemble(id, verdict) {
  const l = `${nomEnsemble(id)}, seuil ${seuil} : ${verdict} — ${comptes(parEnsemble.get(id))}.`;
  return l.length > 160 - 'attestation : '.length ? `${l.slice(0, 160 - 'attestation : '.length - 2)}….` : l;
}
for (const [id, ds] of parEnsemble) {
  const nom = nomEnsemble(id);
  const joues = ds.filter((d) => !d.couvert);
  const sautesIci = ds.filter((d) => d.couvert);
  const parRaison = new Map();
  for (const d of sautesIci) parRaison.set(d.raison, [...(parRaison.get(d.raison) ?? []), raccourci(d.fichier)]);
  const lignes = [
    `${nom}, seuil ${seuil} : ${joues.length} fichier(s) joué(s), ${sautesIci.length} sauté(s)${jouees?.[id] ? ` (empreinte ${jouees[id].slice(0, 10)})` : ''}.`,
    ...[...parRaison].map(([raison, fs]) => `${nom} : sauté(s) — ${raison} : ${fs.join(', ')}.`),
    ...(joues.length ? [`${nom} : joué(s) : ${joues.map((d) => raccourci(d.fichier)).join(', ')}.`] : []),
  ];
  // En CI, tout se dit, fichier par fichier ; hors CI, au détail, et l'ensemble se dit après le verdict.
  if (court) for (const l of lignes) auDetail(l);
  else for (const l of lignes) if (!(l.includes(' : joué(s) : ') && !sautesIci.length)) dire(l);
}

/** Un fichier de rapport demandé par l'appelant est écrit même quand rien ne se joue. */
function rapportsVides() {
  if (vitest) {
    const json = reste.find((a) => a.startsWith('--outputFile.json='))?.slice('--outputFile.json='.length);
    if (json) writeFileSync(resolve(json), `${JSON.stringify({ numTotalTests: 0, testResults: [] })}\n`);
  } else {
    for (let i = 0; i < reste.length; i++) {
      const a = reste[i];
      const d = a.startsWith('--test-reporter-destination=') ? a.slice('--test-reporter-destination='.length) : a === '--test-reporter-destination' ? reste[i + 1] : null;
      if (d && d !== 'stdout' && d !== 'stderr') {
        mkdirSync(dirname(resolve(d)), { recursive: true });
        writeFileSync(resolve(d), '');
      }
    }
  }
}

if (candidats?.length && sautes.length === decisions.length && decisions.length === candidats.length) {
  dire(`sauté, seuil ${seuil}${navigateur ? ', tests navigateur' : ''}, ${dossier} — chaque fichier est vert sur son empreinte, à un seuil au moins égal.`);
  if (court) {
    for (const id of parEnsemble.keys()) dire(ligneEnsemble(id, 'vert'));
    if (!detailDuCrochet) dire(`détail : ${fichierDetail}`);
  }
  rapportsVides();
  if (fichierBilan) writeFileSync(fichierBilan, `${JSON.stringify({ lisible: true, fichiers: [] })}\n`);
  rmSync(travail, { recursive: true, force: true });
  process.exit(0);
}

// ─── Le lancement ───────────────────────────────────────────────────────────────────────────────

const compte = join(travail, 'ecartes');
const env = { ...process.env, TIRELIRE_ECARTES: compte };
delete env.TIRELIRE_SEUIL;
if (filtre) env.TIRELIRE_SEUIL = String(seuil);

const rapportVitest = join(travail, 'fichiers.json');
delete env.TIRELIRE_FICHIERS;
if (vitest && parFichier) env.TIRELIRE_FICHIERS = rapportVitest;
const rapportNode = join(travail, 'fichiers.jsonl');
const rapportEchecs = join(travail, 'echecs.jsonl');
delete env.TIRELIRE_ECHECS;
env.TIRELIRE_ECHECS = rapportEchecs;

let commande;
let args;
if (vitest) {
  commande = binaireVitest();
  args = [...argsVitest];
  for (const d of sautes) args.push('--exclude', relatif(realpathSync(process.cwd()), join(racine, d.fichier)));
  // Le rapporteur des fichiers dit ce que chacun a donné : il ne s'ajoute que pour attester, ou pour le bilan.
  if ((filtre || parFichier) && !reste.some((a) => /^--reporter(?:=|$)/.test(a))) args.push('--reporter=default');
  if (parFichier) args.push(`--reporter=${resolve(ici, 'fichiers-vitest-rapport.mjs')}`);
  args.push(`--reporter=${resolve(ici, 'echecs-vitest-rapport.mjs')}`);
  if (filtre) args.push(`--reporter=${resolve(ici, 'niveaux-vitest-rapport.mjs')}`, '-t', motifDuSeuil(seuil));
} else {
  commande = process.execPath;
  // Des fichiers sautés : les autres sont nommés un à un.
  const fichiers = sautes.length ? decisions.filter((d) => !d.couvert).map((d) => relatif(realpathSync(process.cwd()), join(racine, d.fichier))) : null;
  const hors = sautes.length && candidats ? candidats.filter((f) => !decisions.some((d) => join(racine, d.fichier) === f)).map((f) => relatif(realpathSync(process.cwd()), f)) : [];
  // Le rapporteur des fichiers ne s'ajoute que pour attester, ou pour le bilan ; il remplacerait sinon
  // celui que node prend par défaut.
  const rapporteurs = [];
  if (parFichier) {
    if (!reste.some((a) => /^--test-reporter(?:=|$)/.test(a))) rapporteurs.push(`--test-reporter=${process.stdout.isTTY ? 'spec' : 'tap'}`, '--test-reporter-destination=stdout');
    rapporteurs.push(`--test-reporter=${resolve(ici, 'rapport-fichiers.mjs')}`, `--test-reporter-destination=${rapportNode}`);
  }
  // Le rapporteur des échecs et des sauts, en CI comme hors CI (#352, point 8) ; node apparie ses rapporteurs
  // et leurs destinations : à des rapporteurs donnés sans destination, il ne s'ajoute pas.
  const sansDestination = reste.filter((a) => /^--test-reporter(?:=|$)/.test(a)).length > reste.filter((a) => /^--test-reporter-destination(?:=|$)/.test(a)).length;
  if (court || !sansDestination) {
    // Un rapporteur ajouté remplace celui que node prend par défaut : il se redit sur la sortie.
    if (!rapporteurs.length && !reste.some((a) => /^--test-reporter(?:=|$)/.test(a))) rapporteurs.push(`--test-reporter=${process.stdout.isTTY ? 'spec' : 'tap'}`, '--test-reporter-destination=stdout');
    rapporteurs.push(`--test-reporter=${resolve(ici, 'echecs-node-rapport.mjs')}`, `--test-reporter-destination=${rapportEchecs}`);
  }
  args = [
    ...(filtre ? ['--import', resolve(ici, 'niveaux-node.mjs')] : []),
    ...argv.slice(1, fin + 1),
    // Les options de node avant les fichiers : après un fichier, node ne les lit plus comme les siennes.
    ...rapporteurs,
    ...(fichiers ? [...optionsNode, ...fichiers, ...hors] : reste),
  ];
}

const avant = Date.now();
// Hors CI, la sortie de l'exécuteur va au détail (#352, point 3).
const versDetail = court && !detailDuCrochet ? essaie(() => createWriteStream(fichierDetail, { flags: 'a' })) : null;
if (versDetail) versDetail.write("\n─── Sortie de l'exécuteur ───\n");
const enfant = spawn(commande, args, { stdio: versDetail ? ['inherit', 'pipe', 'pipe'] : 'inherit', env });
if (versDetail) {
  enfant.stdout.pipe(versDetail, { end: false });
  enfant.stderr.pipe(versDetail, { end: false });
}
/** Attend que la sortie de l'exécuteur soit écrite au détail. */
const detailEcrit = () => new Promise((r) => (versDetail ? versDetail.end(r) : r()));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => enfant.kill(s));
enfant.on('error', (e) => {
  console.error(`lanceur : ${commande} ne se lance pas (${e.message}).`);
  rmSync(travail, { recursive: true, force: true });
  process.exit(1);
});
enfant.on('close', async (code, signal) => {
  await detailEcrit();
  let ecartes = 0;
  const ecartesParFichier = new Map();
  for (const l of (essaie(() => readFileSync(compte, 'utf8')) ?? '').split('\n').filter(Boolean)) {
    const [n, f] = l.split('\t');
    ecartes += Number(n) || 0;
    if (f) ecartesParFichier.set(resolve(f), (ecartesParFichier.get(resolve(f)) ?? 0) + (Number(n) || 0));
  }
  const sortie = signal ? 1 : (code ?? 1);
  // Hors CI : chaque test en échec, avec son message et son endroit (#352, point 4), puis une ligne par ensemble.
  const lus = (essaie(() => readFileSync(rapportEchecs, 'utf8')) ?? '').split('\n').filter(Boolean).map((l) => essaie(() => JSON.parse(l))).filter(Boolean);
  const echecs = lus.filter((x) => !x.saute);
  /** La raison réelle des tests sautés d'un fichier, s'il en a une (« lftp absent »). */
  const raisonsDuSaut = new Map();
  for (const x of lus.filter((y) => y.saute)) raisonsDuSaut.set(x.fichier, [...new Set([...(raisonsDuSaut.get(x.fichier) ?? []), x.raison])]);
  raisonDuSaut = (a) => {
    const raisons = raisonsDuSaut.get(a);
    return raisons ? `test(s) sauté(s) : ${raisons.join(' ; ')}` : "un test s'est sauté, faute d'outil par exemple";
  };
  const resultats = parFichier && !signal ? lireResultats(sortie, ecartesParFichier) : null;
  if (court) {
    for (const l of lignesDesEchecs(echecs)) console.log(l);
    const rougesParEnsemble = new Map();
    for (const e of echecs) {
      const id = racine && e.fichier.startsWith('/') ? (ensembleDuFichier(relatif(racine, e.fichier)) ?? '-') : '-';
      rougesParEnsemble.set(id, new Set([...(rougesParEnsemble.get(id) ?? []), e.fichier]));
    }
    // Sans décision (rien n'est couvert ni lu), les fichiers joués se comptent sur ce qu'ils ont donné.
    if (!parEnsemble.size && resultats) {
      for (const [absolu] of resultats) {
        const f = racine ? relatif(racine, absolu) : absolu;
        const id = racine ? (ensembleDuFichier(f) ?? '-') : '-';
        if (!parEnsemble.has(id)) parEnsemble.set(id, []);
        parEnsemble.get(id).push({ fichier: f, ensemble: id, couvert: false });
      }
    }
    for (const [id, ds] of parEnsemble) {
      const rouges = rougesParEnsemble.get(id)?.size ?? 0;
      const sautesFauteDOutil = resultats ? ds.filter((d) => !d.couvert && [...resultats].some(([a, r]) => racine && relatif(racine, a) === d.fichier && r.etat === 'sauté')).length : 0;
      const verdict = rouges ? `rouge (${rouges} fichier(s) rouge(s), ${ds.filter((d) => !d.couvert).length - rouges} vert(s))` : sortie !== 0 ? 'rouge' : sautesFauteDOutil ? "vert, des tests sautés faute d'outil" : 'vert';
      dire(ligneEnsemble(id, verdict));
    }
    if (!parEnsemble.size) dire(`${dossier ?? 'lancement'}, seuil ${seuil} : ${sortie === 0 ? 'vert' : 'rouge'}.`);
    if (resultats) {
      for (const [a, r] of resultats) {
        if (r.etat !== 'sauté') continue;
        dire(`${raccourci(racine ? relatif(racine, a) : a)} : non attesté — ${raisonDuSaut(a)}.`);
      }
    }
  }
  console.log(ligneEcartes(seuil, ecartes, nomme));
  if (sansNavigateur !== null) {
    const { fichiers, tests } = sansNavigateur;
    console.log(
      `navigateur : ${tests} test(s) écrits écarté(s), dans ${fichiers} fichier(s) de test/navigateur/, ` +
        `lus sans être exécutés (un test écrit dans une boucle compte pour un) ; l'option --navigateur les active.`,
    );
  }
  if (parFichier && !signal) attesterLeLancement(resultats);
  if (court && !detailDuCrochet) dire(`détail : ${fichierDetail}`);
  rmSync(travail, { recursive: true, force: true });
  process.exit(sortie);
});

/** La raison d'un fichier non attesté parce qu'un test s'y est sauté : la réelle si elle est donnée (#352, point 8). */
let raisonDuSaut = () => "un test s'est sauté, faute d'outil par exemple";

/** Ce que chaque fichier a donné, `null` s'il ne se lit pas (`fichiersDuLancement`). */
function lireResultats(code, ecartesParFichier) {
  const lignes = vitest ? [] : (essaie(() => readFileSync(rapportNode, 'utf8')) ?? '').split('\n').filter(Boolean).map((l) => essaie(() => JSON.parse(l))).filter(Boolean);
  const rapport = vitest ? essaie(() => JSON.parse(readFileSync(rapportVitest, 'utf8'))) : null;
  return fichiersDuLancement({ code, sorte: vitest ? 'vitest' : 'node', rapport, lignes, ecartes: ecartesParFichier, seuil });
}

/** Ajoute à l'attestation locale les fichiers joués verts sur le contenu, s'il n'a pas changé (#302, points 1 et 2). */
function attesterLeLancement(resultats) {
  if (fichierBilan) {
    const fichiers = resultats && racine ? [...resultats].map(([f, r]) => ({ fichier: relatif(racine, f), ensemble: ensembleDuFichier(relatif(racine, f)), ...r })) : [];
    essaie(() => writeFileSync(fichierBilan, `${JSON.stringify({ lisible: Boolean(resultats), fichiers })}\n`));
  }
  if (!attester) return;
  if (!resultats) {
    dire("le lancement ne se lit pas fichier par fichier : rien n'est attesté.");
    // Hors CI, chaque fichier joué est nommé, avec la raison (#352, point 5).
    if (court) for (const d of decisions.filter((x) => !x.couvert)) dire(`${raccourci(d.fichier)} : non attesté — le rapport du lancement ne se lit pas.`);
    return;
  }
  const apres = arbreDeLaCopie(depotGit);
  const fichiersApres = apres ? empreintesDesTests(apres.entrees) : null;
  const chemins = new Set(copie.entrees.map((x) => x.chemin));
  const nouveaux = [];
  const refuses = new Map();
  const changes = new Set();
  const date = new Date(avant).toISOString();
  const par = `le lancement « test ${seuil}${navigateur ? ' --navigateur' : ''} » dans ${dossier}`;
  for (const [absolu, r] of resultats) {
    const fichier = relatif(racine, absolu);
    const ensemble = ensembleDuFichier(fichier);
    if (!ensemble || !chemins.has(fichier)) continue;
    // Ce qu'il lit a changé pendant le lancement : il n'est pas attesté (#302, point 2 ; #304).
    if (!fichiersJoues?.[fichier] || !fichiersApres || fichiersApres[fichier] !== fichiersJoues[fichier]) {
      changes.add(nomDe(ensemble));
      if (court && r.etat === 'vert') refuses.set(fichier, "un fichier qu'il lit a changé pendant le lancement");
      continue;
    }
    if (r.etat !== 'vert') {
      // Hors CI, un fichier sauté faute d'outil est déjà dit ; un fichier rouge l'est avec ses échecs.
      if (!court) refuses.set(fichier, r.etat === 'rouge' ? 'rouge' : raisonDuSaut(absolu));
      else if (r.etat === 'rouge') refuses.set(fichier, 'rouge');
      continue;
    }
    nouveaux.push({ ensemble, fichier, empreinte: fichiersJoues[fichier], seuil: r.seuil, par, arbre: copie.arbre, date });
  }
  if (changes.size) dire(`${[...changes].join(', ')} : un fichier qu'il lit a changé pendant le lancement, rien n'en est attesté.`);
  for (const [f, pourquoi] of refuses) dire(`${raccourci(f)} : non attesté — ${pourquoi}.`);
  if (!nouveaux.length) return;
  const ecrit = ajouterALAttestation({ branche: attester.branche, nouveaux, cwd: depotGit });
  const seuils = [...new Set(nouveaux.map((v) => v.seuil))].sort().join(' ou ');
  if (ecrit) dire(`${nouveaux.length} fichier(s) attesté(s) vert(s) au seuil ${seuils}, sur l'arbre ${copie.arbre.slice(0, 10)} (attestation locale de ${attester.branche}, envoyée au prochain push).`);
  else {
    dire(`l'attestation locale de ${attester.branche} ne s'écrit pas : rien n'est attesté.`);
    if (court) for (const v of nouveaux) dire(`${raccourci(v.fichier)} : non attesté — l'attestation ne s'écrit pas.`);
  }
}
