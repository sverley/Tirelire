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
 *   — attesté vert lui-même, ou couvert avec tout son ensemble —, et dit, pour chaque ensemble, les
 *   fichiers joués et les fichiers sautés, avec ce qui les couvre : par qui, sur quel arbre ou quel
 *   commit, à quel seuil. L'empreinte est celle de l'ensemble du fichier, calculée sur le contenu
 *   joué, copie de travail comprise (`attestation-git.mjs`, `arbreDeLaCopie`).
 * - `--attestation <fichier>`, que passent la CI et la livraison : ce qui couvre ce lancement, écrit
 *   par `.githooks/attestation.mjs` ; `--bilan <fichier>`, que passe la livraison : ce que chaque
 *   fichier joué a donné, pour qu'elle atteste un à un les fichiers verts d'un ensemble qui ne l'est
 *   pas. Un fichier absent vaut « aucune empreinte verte ». Sans elle, le
 *   lanceur lit lui-même ce que ce clone connaît : l'attestation de la branche extraite, locale et
 *   distante, et la base commune avec `main`, verte jusqu'au seuil 2 (D83). Sur `main`, sans branche
 *   ou sur une sous-branche, rien ne se saute.
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
import { existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciblesDesArguments, couvertureLocale, separerLesCibles, empreintes, ensembleDuFichier, fichiersCouverts, fichiersDuLancement, nomDe } from './attestation.mjs';
import { ajouterALAttestation, arbreDeLaCopie, baseAvecMain, brancheAttestable, entreesDe, essaie, harnaisDuBesoin, racineGit, vertsConnus } from './attestation-git.mjs';
import { appelsDeTests } from './gardes.mjs';
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
const reste = [];
for (let i = 0; i < lu.reste.length; i++) {
  const a = lu.reste[i];
  if (a === '--navigateur') continue;
  if (a === '--attestation') fichierAttestation = lu.reste[++i] ?? '';
  else if (a.startsWith('--attestation=')) fichierAttestation = a.slice('--attestation='.length);
  else if (a === '--bilan') fichierBilan = lu.reste[++i] ?? '';
  else if (a.startsWith('--bilan=')) fichierBilan = a.slice('--bilan='.length);
  else reste.push(a);
}
const nomme = reste.some((a) => (vitest ? /^(?:-t|--testNamePattern|--test-name-pattern)(?:=|$)/ : /^--test-name-pattern(?:=|$)/).test(a));
const filtre = !nomme && seuil < NIVEAU_MAX;

const travail = mkdtempSync(join(tmpdir(), 'tirelire-seuil-'));
const dire = (texte) => console.log(`attestation : ${texte}`);
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
    if (copie) jouees = empreintes(copie.entrees, couverture.harnais ?? []);
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
  copie = b.branche ? arbreDeLaCopie(depotGit) : null;
  if (!b.branche) annonces.push(`${b.raison} : rien ne se saute ni ne s'atteste`);
  else if (!copie) annonces.push("le contenu joué ne se lit pas : rien ne se saute ni ne s'atteste");
  else {
    const harnais = harnaisDuBesoin(b.branche, depotGit);
    jouees = empreintes(copie.entrees, harnais);
    const base = baseAvecMain(depotGit);
    const main = base ? essaie(() => ({ commit: base, empreintes: empreintes(entreesDe(base, depotGit)) })) : null;
    couverture = couvertureLocale({ arbre: copie.arbre, empreintes: jouees, verts: vertsConnus(b.branche, depotGit), main, harnais });
    attester = { branche: b.branche, harnais };
  }
} else if (!depotGit) annonces.push("hors de tout dépôt git : rien ne se saute ni ne s'atteste");
if (nomme) annonces.push("appel nommé : il se joue en entier, quel que soit l'attestation, et n'atteste rien");
/** Ce que chaque fichier a donné se lit pour attester, ou pour le bilan que demande la livraison (`--bilan`). */
const parFichier = Boolean(attester || (fichierBilan && !nomme));

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
    decisions = fichiersCouverts(couverture, demande, lisibles.map((f) => relatif(racine, f)), jouees);
  }
}

// ─── Ce qui se dit avant de jouer ───────────────────────────────────────────────────────────────

for (const a of annonces) dire(`${a}.`);
const sautes = decisions.filter((d) => d.couvert);
const parEnsemble = new Map();
for (const d of decisions) {
  const id = d.ensemble ?? '-';
  if (!parEnsemble.has(id)) parEnsemble.set(id, []);
  parEnsemble.get(id).push(d);
}
const court = (f) => f.slice((dossier === '.' ? '' : `${dossier}/`).length);
for (const [id, ds] of parEnsemble) {
  const nom = id === '-' ? 'hors ensemble' : nomDe(id);
  const joues = ds.filter((d) => !d.couvert);
  const sautesIci = ds.filter((d) => d.couvert);
  dire(`${nom}, seuil ${seuil} : ${joues.length} fichier(s) joué(s), ${sautesIci.length} sauté(s)${jouees?.[id] ? ` (empreinte ${jouees[id].slice(0, 10)})` : ''}.`);
  const parRaison = new Map();
  for (const d of sautesIci) parRaison.set(d.raison, [...(parRaison.get(d.raison) ?? []), court(d.fichier)]);
  for (const [raison, fs] of parRaison) dire(`${nom} : sauté(s) — ${raison} : ${fs.join(', ')}.`);
  if (joues.length && sautesIci.length) dire(`${nom} : joué(s) : ${joues.map((d) => court(d.fichier)).join(', ')}.`);
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

let commande;
let args;
if (vitest) {
  commande = binaireVitest();
  args = [...argsVitest];
  for (const d of sautes) args.push('--exclude', relatif(realpathSync(process.cwd()), join(racine, d.fichier)));
  // Le rapporteur des fichiers dit ce que chacun a donné : il ne s'ajoute que pour attester, ou pour le bilan.
  if ((filtre || parFichier) && !reste.some((a) => /^--reporter(?:=|$)/.test(a))) args.push('--reporter=default');
  if (parFichier) args.push(`--reporter=${resolve(ici, 'fichiers-vitest-rapport.mjs')}`);
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
  args = [
    ...(filtre ? ['--import', resolve(ici, 'niveaux-node.mjs')] : []),
    ...argv.slice(1, fin + 1),
    // Les options de node avant les fichiers : après un fichier, node ne les lit plus comme les siennes.
    ...rapporteurs,
    ...(fichiers ? [...optionsNode, ...fichiers, ...hors] : reste),
  ];
}

const avant = Date.now();
const enfant = spawn(commande, args, { stdio: 'inherit', env });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => enfant.kill(s));
enfant.on('error', (e) => {
  console.error(`lanceur : ${commande} ne se lance pas (${e.message}).`);
  rmSync(travail, { recursive: true, force: true });
  process.exit(1);
});
enfant.on('exit', (code, signal) => {
  let ecartes = 0;
  const ecartesParFichier = new Map();
  for (const l of (essaie(() => readFileSync(compte, 'utf8')) ?? '').split('\n').filter(Boolean)) {
    const [n, f] = l.split('\t');
    ecartes += Number(n) || 0;
    if (f) ecartesParFichier.set(resolve(f), (ecartesParFichier.get(resolve(f)) ?? 0) + (Number(n) || 0));
  }
  console.log(ligneEcartes(seuil, ecartes, nomme));
  if (sansNavigateur !== null) {
    const { fichiers, tests } = sansNavigateur;
    console.log(
      `navigateur : ${tests} test(s) écrits écarté(s), dans ${fichiers} fichier(s) de test/navigateur/, ` +
        `lus sans être exécutés (un test écrit dans une boucle compte pour un) ; l'option --navigateur les active.`,
    );
  }
  const sortie = signal ? 1 : (code ?? 1);
  if (parFichier && !signal) attesterLeLancement(sortie, ecartesParFichier);
  rmSync(travail, { recursive: true, force: true });
  process.exit(sortie);
});

/** Ajoute à l'attestation locale les fichiers joués verts sur le contenu, s'il n'a pas changé (#302, points 1 et 2). */
function attesterLeLancement(code, ecartesParFichier) {
  const lignes = vitest ? [] : (essaie(() => readFileSync(rapportNode, 'utf8')) ?? '').split('\n').filter(Boolean).map((l) => essaie(() => JSON.parse(l))).filter(Boolean);
  const rapport = vitest ? essaie(() => JSON.parse(readFileSync(rapportVitest, 'utf8'))) : null;
  const resultats = fichiersDuLancement({ code, sorte: vitest ? 'vitest' : 'node', rapport, lignes, ecartes: ecartesParFichier, seuil });
  if (fichierBilan) {
    const fichiers = resultats && racine ? [...resultats].map(([f, r]) => ({ fichier: relatif(racine, f), ensemble: ensembleDuFichier(relatif(racine, f)), ...r })) : [];
    essaie(() => writeFileSync(fichierBilan, `${JSON.stringify({ lisible: Boolean(resultats), fichiers })}\n`));
  }
  if (!attester) return;
  if (!resultats) {
    dire("le lancement ne se lit pas fichier par fichier : rien n'est attesté.");
    return;
  }
  const apres = arbreDeLaCopie(depotGit);
  const empreintesApres = apres ? empreintes(apres.entrees, attester.harnais) : null;
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
    if (!empreintesApres || empreintesApres[ensemble] !== jouees[ensemble]) {
      changes.add(nomDe(ensemble));
      continue;
    }
    if (r.etat !== 'vert') {
      refuses.set(fichier, r.etat === 'rouge' ? 'rouge' : "un test s'est sauté, faute d'outil par exemple");
      continue;
    }
    nouveaux.push({ ensemble, fichier, empreinte: jouees[ensemble], seuil: r.seuil, par, arbre: copie.arbre, date });
  }
  if (changes.size) dire(`${[...changes].join(', ')} : un fichier qu'il lit a changé pendant le lancement, rien n'en est attesté.`);
  for (const [f, pourquoi] of refuses) dire(`${court(f)} : non attesté — ${pourquoi}.`);
  if (!nouveaux.length) return;
  const ecrit = ajouterALAttestation({ branche: attester.branche, nouveaux, cwd: depotGit });
  const seuils = [...new Set(nouveaux.map((v) => v.seuil))].sort().join(' ou ');
  if (ecrit) dire(`${nouveaux.length} fichier(s) attesté(s) vert(s) au seuil ${seuils}, sur l'arbre ${copie.arbre.slice(0, 10)} (attestation locale de ${attester.branche}, envoyée au prochain push).`);
  else dire(`l'attestation locale de ${attester.branche} ne s'écrit pas : rien n'est attesté.`);
}
