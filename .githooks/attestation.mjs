/**
 * Les empreintes et l'attestation des tests (#237, #266, D83), côté git : les lire, décider, les
 * produire, les envoyer, les lire en CI. Les décisions sont dans `packages/gardes/attestation.mjs`.
 *
 *   node attestation.mjs verts <branche> <sortie> [<dépôt distant>]
 *       Les empreintes vertes de la branche : l'attestation locale (`refs/attestations/<branche>`),
 *       réunie à celle du dépôt distant (`<branche>--attestation`), lue sans bloquer ; sans dépôt
 *       distant, à ce que le dernier crochet en a lu. Écrit la liste en JSON dans `<sortie>`. Une autre session a son propre clone : ce qu'elle a trouvé vert
 *       arrive ainsi par le dépôt distant.
 *   node attestation.mjs plan <arbre> <seuil> <verts> <harnais> <main|-> <navigateur : oui|non> <sortie> <moment>
 *       Ce qu'un crochet joue ou saute : les empreintes de l'arbre, comparées aux vertes et à celles
 *       de `<main>` (la base commune avec `main`). Écrit une ligne par ensemble dans `<sortie>` :
 *       `id<TAB>1|0<TAB>seuil<TAB>empreinte<TAB>raison`, et dit ce qui ne se joue pas, et pourquoi.
 *   node attestation.mjs couverture <arbre> <verts> <harnais> <main|-> <sortie>
 *       Ce qui couvre les lancements de la livraison (#302) : le fichier qu'elle passe au lanceur
 *       (`--attestation`), qui y saute, fichier par fichier, ce qui est vert sur son empreinte — attesté
 *       vert lui-même, ou avec tout son ensemble, ou inchangé depuis `<main>`.
 *   node attestation.mjs bilan <plan> <journaux> <moment> <arbre> <commit|-> <branche> <verts> [--enregistrer]
 *       Après les lancements (`<journaux>/lances` : `id<TAB>nom<TAB>vitest|node`) : dit, pour chaque
 *       ensemble joué, son seuil et son verdict, et redit ce que le lanceur a dit de ses fichiers, joués
 *       ou sautés. Avec `--enregistrer`, ajoute à l'attestation locale les empreintes jouées vertes ; un
 *       ensemble rouge, ou dont un test s'est sauté faute d'outil, n'y entre pas, mais ses fichiers
 *       joués verts y entrent un à un (`<journaux>/<nom>.bilan`, écrit par le lanceur, #302). Seul
 *       l'outillage l'appelle ; aucune session ne l'écrit.
 *   node attestation.mjs envoyer <dépôt distant> <branche> [<branche distante>]
 *       Envoie l'attestation locale sur `<branche>--attestation`, ou sur `<branche distante>`. Un échec se dit sans bloquer : la CI
 *       jouera alors ce que la table de D83 prévoit.
 *   node attestation.mjs ready <tête> <branche> <main> <sortie> [<résumé>] [--depot <propriétaire/dépôt>]
 *       La CI au Ready : si la tête ne contient pas `<main>`, la branche est à mettre à jour, et la
 *       commande échoue sans rien jouer. Sinon, écrit dans `<sortie>` ce que la CI peut sauter, seuil 1
 *       compris : ce que l'attestation, une tête de la branche verte au Ready (lue par `gh` quand
 *       `--depot` est donné) ou `main` couvre.
 *   node attestation.mjs apres-fusion <commit> <dépôt GitHub> <sortie> [<résumé>]
 *       La CI sur `main` : un ensemble se saute si son empreinte est celle d'une tête de PR verte au
 *       Ready, ou celle du premier parent.
 *   node attestation.mjs nuit <dossier> [<résumé>]
 *       La nuit (#307, #383), sur le commit extrait de `main` : lit l'attestation de la nuit
 *       (`attestation-de-la-nuit` sur `origin`) et écrit dans `<dossier>` `verts.json`, `plan` (une
 *       ligne par ensemble de la suite, au seuil 2, que lit `bilan`), `lancer` (les ensembles à jouer :
 *       `id<TAB>dossier<TAB>vitest|node`), `jouer` (`oui` ou `non` : non, chaque ensemble est déjà
 *       trouvé vert sur son empreinte, rien de ce que lit la suite n'a changé) et `couverture.json`,
 *       que la nuit passe au lanceur (`--attestation`). Dit, pour chaque ensemble, ce qui se joue.
 *       `bilan … nuit <verts> --enregistrer`, puis `envoyer origin nuit attestation-de-la-nuit`,
 *       gardent ce qu'elle trouve vert pour les nuits suivantes.
 *
 * `<sortie>` est le fichier que la CI passe à `pnpm test --attestation`. `<résumé>` reçoit, en plus
 * de la sortie standard, ce que la CI saute.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ligneDEnsemble } from '../packages/gardes/echecs.mjs';
import {
  couvertureApresFusion,
  couvertureAuReady,
  couvertureLocale,
  empreintes,
  empreintesDesFichiers,
  estUnFichierDeTest,
  etatDuStatut,
  fusionner,
  lireLesEntrees,
  nomDe,
  planDeLaNuit,
  planifier,
  resume,
  SEUIL_DE_MAIN,
  SEUIL_DE_LA_NUIT,
  verdictDuLancement,
} from '../packages/gardes/attestation.mjs';
import { ajouterALAttestation, BRANCHE_D_ATTESTATION, BRANCHE_DE_LA_NUIT, DISTANTE, NUIT, essaie, harnaisDuBesoin as harnaisDe, REF, vertsDu as vertsDuCommit } from '../packages/gardes/attestation-git.mjs';

const git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, ...options }).trim();
const lire = (f) => essaie(() => readFileSync(f, 'utf8')) ?? '';
/** Les lancements des tests navigateur de l'issue, dans `<journaux>/lances` (#307). */
const ISSUE = 'issue';
const derniereLigne = (e) => String(e?.stderr || e?.message || e).trim().split('\n').at(-1);

/** Les empreintes d'un arbre ou d'un commit, harnais du besoin compris. */
const entreesDe = (objet) => lireLesEntrees(git(['ls-tree', '-r', '-z', '--full-tree', objet]));
const empreintesDe = (objet, harnais = []) => empreintes(entreesDe(objet), harnais);
/** Les empreintes des fichiers de test d'un arbre ou d'un commit, chacun sur ce qu'il lit (#304). */
const fichiersDe = (objet) => {
  const entrees = entreesDe(objet);
  return empreintesDesFichiers(entrees.map((x) => x.chemin).filter(estUnFichierDeTest), entrees);
};

/** Les empreintes vertes portées par un commit d'attestation, ou `[]`. */
const vertsDu = (commit) => vertsDuCommit(commit, process.cwd());

/** Les fichiers du harnais du besoin, par sa définition commune (`harnais-du-besoin.sh`). */
const harnaisDuBesoin = (branche) => essaie(() => harnaisDe(branche, git(['rev-parse', '--show-toplevel']))) ?? [];

/** Écrit la couverture pour la CI, et dit ce qu'elle permet de sauter. */
function conclure(couverture, sortie, fichierResume, titre) {
  rmSync(sortie, { force: true });
  if (couverture) writeFileSync(sortie, `${JSON.stringify(couverture, null, 2)}\n`);
  const lignes = resume(couverture);
  for (const l of lignes) console.log(l);
  if (fichierResume) appendFileSync(fichierResume, `### ${titre}\n\n${lignes.join('\n')}\n`);
}

/** Ce qu'un lancement a donné, d'après ses journaux : `null` s'il n'a pas eu lieu. */
function verdictDans(journaux, nom, sorte, seuil) {
  const code = lire(join(journaux, `${nom}.code`)).trim();
  if (code === '') return null;
  if (code === 'retenu') return { etat: 'retenu', retenu: lire(join(journaux, `${nom}.retenu`)).trim() };
  const rapport = sorte === 'vitest' ? essaie(() => JSON.parse(lire(join(journaux, `${nom}.rapport`)))) : null;
  return verdictDuLancement({ code, sorte, journal: lire(join(journaux, `${nom}.log`)), rapport, seuil });
}

/**
 * Les comptes que le lanceur donne, ensemble par ensemble, en une ligne (« X joué(s), Y sauté(s)
 * (…) », #352) : additionnés sur les lancements d'un même ensemble ; les autres lignes restent.
 * La ligne « sauté, seuil … — chaque fichier est vert », que le bilan dit déjà, ne se redit pas.
 */
function comptesDesDits(dits) {
  let joues = 0;
  let sautes = 0;
  let vus = false;
  const parSorte = new Map();
  const autres = [];
  for (const l of dits) {
    const m = l.match(/^attestation : .+?, seuil \d+ : [^—]+ — (\d+) joué\(s\), (\d+) sauté\(s\)(?: \((.*)\))?\.$/);
    if (!m) {
      if (!/^attestation : sauté, seuil /.test(l)) autres.push(l);
      continue;
    }
    vus = true;
    joues += Number(m[1]);
    sautes += Number(m[2]);
    for (const x of (m[3] ?? '').split(', ').filter(Boolean)) {
      const n = x.match(/^(\d+) (.*)$/);
      if (n) parSorte.set(n[2], (parSorte.get(n[2]) ?? 0) + Number(n[1]));
    }
  }
  const comptes = vus ? `${joues} joué(s), ${sautes} sauté(s)${parSorte.size ? ` (${[...parSorte].map(([r, n]) => `${n} ${r}`).join(', ')})` : ''}` : '';
  return { comptes, autres };
}

const [commande, ...args] = process.argv.slice(2);

if (commande === 'verts') {
  const [branche, sortie, distant] = args;
  const local = essaie(() => git(['rev-parse', '-q', '--verify', REF(branche)]));
  // Sans dépôt distant, ce que le dernier crochet en a lu, sans réseau.
  let lointain = distant ? null : essaie(() => git(['rev-parse', '-q', '--verify', DISTANTE(branche)]));
  let pourquoi = '';
  if (distant) {
    try {
      git(['fetch', '-q', '--no-tags', distant, `+refs/heads/${BRANCHE_D_ATTESTATION(branche)}:${DISTANTE(branche)}`]);
      lointain = git(['rev-parse', DISTANTE(branche)]);
    } catch (e) {
      pourquoi = ` (${BRANCHE_D_ATTESTATION(branche)} non lue : ${derniereLigne(e)})`;
    }
  }
  const verts = fusionner(vertsDu(local), vertsDu(lointain));
  writeFileSync(sortie, `${JSON.stringify(verts)}\n`);
  console.log(`attestation : ${verts.length} empreinte(s) verte(s) connue(s) pour ${branche} — locale ${local ? 'lue' : 'absente'}, distante ${lointain ? 'lue' : distant ? 'absente' : 'non lue (sans réseau)'}${pourquoi}.`);
} else if (commande === 'plan') {
  const [arbre, seuil, fichierVerts, fichierHarnais, main, nav, sortie, moment] = args;
  const harnais = lire(fichierHarnais).split('\n').filter(Boolean);
  const e = empreintesDe(arbre, harnais);
  const references = main && main !== '-' ? [{ empreintes: empreintesDe(main), seuil: SEUIL_DE_MAIN, raison: `rien de ce qu'il lit n'a changé depuis main (${main.slice(0, 10)})` }] : [];
  const verts = essaie(() => JSON.parse(lire(fichierVerts))) ?? [];
  const plan = planifier({ empreintes: e, seuil: Number(seuil), verts, references, navigateur: nav === 'oui', harnais });
  writeFileSync(sortie, `${plan.map((p) => [p.id, p.jouer ? 1 : 0, p.seuil, p.empreinte ?? '-', p.raison].join('\t')).join('\n')}\n`);
  for (const p of plan) if (!p.jouer) console.log(`${moment} : ${p.nom} : non joué — ${p.raison}.`);
} else if (commande === 'couverture') {
  const [arbre, fichierVerts, fichierHarnais, main, sortie] = args;
  const harnais = lire(fichierHarnais).split('\n').filter(Boolean);
  const verts = essaie(() => JSON.parse(lire(fichierVerts))) ?? [];
  const reference = main && main !== '-' ? { commit: git(['rev-parse', main]), empreintes: empreintesDe(main) } : null;
  const couverture = couvertureLocale({ origine: 'livraison', arbre, empreintes: empreintesDe(arbre, harnais), fichiers: fichiersDe(arbre), verts, main: reference, harnais });
  writeFileSync(sortie, `${JSON.stringify(couverture, null, 2)}\n`);
} else if (commande === 'bilan') {
  const [fichierPlan, journaux, moment, arbre, commit, branche, fichierVerts, option] = args;
  const plan = lire(fichierPlan).split('\n').filter(Boolean).map((l) => {
    const [id, jouer, seuil, empreinte] = l.split('\t');
    return { id, jouer: jouer === '1', seuil: Number(seuil), empreinte };
  });
  // Les lancements de chaque ensemble, que le crochet note dans `lances` : `id<TAB>nom<TAB>sorte`.
  const lances = lire(join(journaux, 'lances')).split('\n').filter(Boolean).map((l) => l.split('\t'));
  const nouveaux = [];
  const date = new Date().toISOString();
  /** Les fichiers joués verts de ces lancements, d'après le bilan du lanceur (`<nom>.bilan`, #302). */
  const fichiersVerts = (siens) => {
    const ef = essaie(() => fichiersDe(arbre)) ?? {};
    const r = [];
    for (const [, nom] of siens) {
      const b = essaie(() => JSON.parse(lire(join(journaux, `${nom}.bilan`))));
      if (!b?.lisible) continue;
      for (const f of b.fichiers ?? []) {
        const empreinte = ef[f.fichier];
        if (f.etat !== 'vert' || !empreinte) continue;
        r.push({ ensemble: f.ensemble, fichier: f.fichier, empreinte, seuil: f.seuil, par: moment, commit: commit === '-' ? null : commit, arbre, date });
      }
    }
    return r;
  };
  for (const p of plan) {
    if (!p.jouer) continue;
    const siens = lances.filter(([id]) => id === p.id);
    const verdicts = siens.map(([, nom, sorte]) => verdictDans(journaux, nom, sorte, p.seuil)).filter(Boolean);
    const retenu = lire(join(journaux, `${p.id}.retenu`)).trim();
    // Ce que le lanceur a dit de ses fichiers : joués, sautés, et pourquoi (#302, point 4).
    const dits = siens.flatMap(([, nom]) => lire(join(journaux, `${nom}.log`)).split('\n').filter((l) => l.startsWith('attestation : ')));
    const toutSaute = siens.length > 0 && siens.every(([, nom]) => /^attestation : sauté, seuil/m.test(lire(join(journaux, `${nom}.log`))));
    let texte;
    // Le verdict court, quand les comptes du lanceur suivent (#352, point 1) : ils disent le reste.
    let court = null;
    let vert = false;
    if (!verdicts.length) texte = `non joué — ${retenu || 'aucun test à lancer'}`;
    else if (verdicts.some((v) => v.etat === 'retenu')) texte = `non joué en entier — ${verdicts.find((v) => v.etat === 'retenu').retenu}`;
    else if (verdicts.some((v) => v.etat === 'rouge')) texte = `joué au seuil ${p.seuil} : rouge`;
    else if (verdicts.some((v) => v.etat === 'sauté')) {
      const n = verdicts.reduce((s, v) => s + (v.sautes ?? 0), 0);
      texte = `joué au seuil ${p.seuil} : ${n} test(s) sauté(s) faute d'outil, donc pas vert sur son empreinte`;
      court = `joué au seuil ${p.seuil} : pas vert, ${n} test(s) sauté(s) faute d'outil`;
    } else if (verdicts.some((v) => v.etat === 'illisible')) {
      texte = `joué au seuil ${p.seuil} : vert, mais son rapport ne se lit pas, donc pas compté vert sur son empreinte`;
      court = `joué au seuil ${p.seuil} : rapport illisible, pas compté vert`;
    } else {
      texte = toutSaute ? `non rejoué au seuil ${p.seuil} — chaque fichier est vert sur son empreinte : vert` : `joué au seuil ${p.seuil} : vert`;
      court = toutSaute ? `non rejoué au seuil ${p.seuil} : vert` : texte;
      vert = true;
    }
    // Le lanceur dit chaque ensemble en une ligne, avec ses comptes (#352, point 1) : ils rejoignent
    // celle du bilan, et le détail, fichier par fichier, est au détail du crochet.
    const { comptes, autres } = comptesDesDits(dits);
    console.log(ligneDEnsemble(moment, nomDe(p.id), comptes ? (court ?? texte) : texte, comptes));
    for (const l of autres) console.log(`${moment} : ${l.slice('attestation : '.length)}`);
    if (vert && p.empreinte !== '-') nouveaux.push({ ensemble: p.id, empreinte: p.empreinte, seuil: p.seuil, par: moment, commit: commit === '-' ? null : commit, arbre, date });
    // L'ensemble n'est pas vert : ses fichiers joués verts s'attestent un à un, chacun sur
    // l'empreinte de ce qu'il lit dans l'arbre jugé (#304).
    else if (verdicts.length) nouveaux.push(...fichiersVerts(siens));
  }
  // Les tests navigateur de l'issue (#307) : joués à part, en entier (seuil 4), ils ne disent rien de
  // toute la non-régression dans le navigateur ; leurs fichiers joués verts s'attestent un à un.
  const issue = lances.filter(([id]) => id === ISSUE);
  if (issue.length) {
    const verdicts = issue.map(([, nom, sorte]) => verdictDans(journaux, nom, sorte, 4)).filter(Boolean);
    const dits = issue.flatMap(([, nom]) => lire(join(journaux, `${nom}.log`)).split('\n').filter((l) => l.startsWith('attestation : ')));
    let texte;
    if (!verdicts.length) texte = 'non joués — aucun test à lancer';
    else if (verdicts.some((v) => v.etat === 'retenu')) texte = `non joués — ${verdicts.find((v) => v.etat === 'retenu').retenu}`;
    else if (verdicts.some((v) => v.etat === 'rouge')) texte = 'joués en entier : rouge';
    else if (verdicts.some((v) => v.etat === 'sauté')) texte = "joués en entier : des tests se sont sautés faute d'outil, leurs fichiers ne sont pas attestés";
    else texte = 'joués en entier, sauf fichier vert sur son empreinte : vert';
    const { comptes, autres } = comptesDesDits(dits);
    console.log(ligneDEnsemble(moment, "tests navigateur de l'issue", texte, comptes));
    for (const l of autres) console.log(`${moment} : ${l.slice('attestation : '.length)}`);
    if (verdicts.length) nouveaux.push(...fichiersVerts(issue));
  }
  if (option === '--enregistrer' && nouveaux.length) {
    const anciens = essaie(() => JSON.parse(lire(fichierVerts))) ?? [];
    ajouterALAttestation({ branche, nouveaux, anciens, cwd: process.cwd() });
    const ensembles = nouveaux.filter((v) => v.fichier === undefined);
    const fichiers = nouveaux.filter((v) => v.fichier !== undefined);
    const dit = [...ensembles.map((v) => `${nomDe(v.ensemble)} (seuil ${v.seuil})`), ...(fichiers.length ? [`${fichiers.length} fichier(s) d'un ensemble qui n'est pas vert`] : [])];
    console.log(`${moment} : attestation locale de ${branche} : ${dit.join(', ')} vert(s) sur leur empreinte.`);
  }
} else if (commande === 'envoyer') {
  const [distant, branche, destination = BRANCHE_D_ATTESTATION(branche)] = args;
  if (!essaie(() => git(['rev-parse', '-q', '--verify', REF(branche)]))) {
    console.log(`aucune attestation locale de ${branche} : rien à envoyer.`);
  } else {
    try {
      git(['push', '-q', distant, `+${REF(branche)}:refs/heads/${destination}`]);
      console.log(`attestation de ${branche} envoyée (${destination}).`);
    } catch (e) {
      console.log(`attestation de ${branche} non envoyée, la CI jouera ce que D83 prévoit : ${derniereLigne(e)}`);
    }
  }
} else if (commande === 'ready') {
  const i = args.indexOf('--depot');
  const depot = i >= 0 ? args[i + 1] : null;
  const [tete, branche, main, sortie, fichierResume] = i >= 0 ? [...args.slice(0, i), ...args.slice(i + 2)] : args;
  const titre = 'Empreintes vertes au Ready';
  if (!essaie(() => (git(['merge-base', '--is-ancestor', main, tete]), true))) {
    rmSync(sortie, { force: true });
    const m = `Branche à mettre à jour : ${tete.slice(0, 10)} ne contient pas le dernier main (${git(['rev-parse', '--short=10', main])}). Rien d'autre ne se joue ; mettez la branche à jour, puis repassez la PR en Ready.`;
    console.log(`::error title=Branche à mettre à jour::${m}`);
    if (fichierResume) appendFileSync(fichierResume, `### ${titre}\n\n${m}\n`);
    process.exit(1);
  }
  const arbre = git(['rev-parse', `${tete}^{tree}`]);
  const extrait = git(['rev-parse', 'HEAD^{tree}']);
  if (extrait !== arbre) {
    console.log(`L'arbre extrait (${extrait.slice(0, 10)}) n'est pas celui de la tête (${arbre.slice(0, 10)}) : rien ne se saute.`);
    conclure(null, sortie, fichierResume, titre);
  } else {
    const harnais = harnaisDuBesoin(branche);
    // L'attestation de la branche, écrite par l'outillage.
    let verts = [];
    try {
      git(['fetch', '-q', '--no-tags', 'origin', `+refs/heads/${BRANCHE_D_ATTESTATION(branche)}:${DISTANTE(branche)}`]);
      verts = vertsDu(git(['rev-parse', DISTANTE(branche)]));
      console.log(`Attestation lue sur ${BRANCHE_D_ATTESTATION(branche)} : ${verts.length} empreinte(s) verte(s).`);
    } catch (err) {
      console.log(`Aucune attestation lue sur ${BRANCHE_D_ATTESTATION(branche)} (${derniereLigne(err)}).`);
    }
    // Les têtes de la branche dont toute la CI a fini verte au Ready.
    const tetes = [];
    if (depot) {
      const commits = (essaie(() => git(['rev-list', '--max-count=30', tete, '--not', main])) ?? '').split('\n').filter(Boolean);
      for (const sha of commits) {
        const statut = etatDuStatut(essaie(() => JSON.parse(execFileSync('gh', ['api', `repos/${depot}/commits/${sha}/status`, '--jq', '.statuses'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))));
        if (statut === 'success') tetes.push({ sha, statut, empreintes: empreintesDe(sha, harnais) });
      }
      console.log(`Têtes de la branche vertes au Ready : ${tetes.map((t) => t.sha.slice(0, 7)).join(', ') || 'aucune'}.`);
    }
    const couverture = couvertureAuReady({ arbre, empreintes: empreintesDe(tete, harnais), fichiers: fichiersDe(tete), verts, tetes, main: { commit: git(['rev-parse', main]), empreintes: empreintesDe(main) }, harnais });
    conclure(couverture, sortie, fichierResume, titre);
  }
} else if (commande === 'apres-fusion') {
  const [commit, depot, sortie, fichierResume] = args;
  const arbre = git(['rev-parse', `${commit}^{tree}`]);
  const gh = (chemin, jq) => execFileSync('gh', ['api', `repos/${depot}/${chemin}`, '--jq', jq], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // Les têtes possibles : les parents fusionnés du commit, et la tête des PR qui l'ont apporté.
  const parents = git(['rev-list', '--parents', '-n', '1', commit]).split(' ').slice(2);
  const prs = (essaie(() => gh(`commits/${commit}/pulls`, '.[].head.sha')) ?? '').split('\n').filter(Boolean);
  const tetes = [...new Set([...parents, ...prs])].map((sha) => {
    if (essaie(() => git(['cat-file', '-e', `${sha}^{commit}`])) === null) essaie(() => git(['fetch', '-q', '--no-tags', 'origin', sha]));
    return { sha, statut: etatDuStatut(essaie(() => JSON.parse(gh(`commits/${sha}/status`, '.statuses')))), empreintes: essaie(() => empreintesDe(sha)) };
  });
  const premier = essaie(() => git(['rev-parse', '-q', '--verify', `${commit}^1`]));
  console.log(`Arbre ${arbre.slice(0, 10)} : têtes de PR ${tetes.map((t) => `${t.sha.slice(0, 7)} ${t.statut ?? 'sans statut'}`).join(', ') || 'aucune'}.`);
  const couverture = couvertureApresFusion({ arbre, empreintes: empreintesDe(commit), tetes, parent: premier ? { commit: premier, empreintes: empreintesDe(premier) } : null });
  conclure(couverture, sortie, fichierResume, 'Empreintes vertes après la fusion');
} else if (commande === 'nuit') {
  // La nuit (#307, #383) : la suite entière, chaque ensemble, sur le commit extrait de `main`, au
  // seuil 2, sauf ce que les nuits précédentes ont trouvé vert sur la même empreinte, ensemble ou
  // fichier.
  const [dossier, fichierResume] = args;
  mkdirSync(dossier, { recursive: true });
  const commit = git(['rev-parse', 'HEAD']);
  const arbre = git(['rev-parse', 'HEAD^{tree}']);
  let verts = [];
  let lu;
  try {
    git(['fetch', '-q', '--no-tags', 'origin', `+refs/heads/${BRANCHE_DE_LA_NUIT}:${DISTANTE(NUIT)}`]);
    verts = vertsDu(git(['rev-parse', DISTANTE(NUIT)]));
    lu = `attestation de la nuit lue sur ${BRANCHE_DE_LA_NUIT} : ${verts.length} empreinte(s) verte(s)`;
  } catch (err) {
    lu = `aucune attestation de la nuit lue sur ${BRANCHE_DE_LA_NUIT} (${derniereLigne(err)}) : tout se joue`;
  }
  writeFileSync(join(dossier, 'verts.json'), `${JSON.stringify(verts)}\n`);
  const e = empreintesDe(commit);
  const plan = planDeLaNuit({ empreintes: e, verts });
  writeFileSync(join(dossier, 'plan'), `${plan.map((p) => [p.id, p.jouer ? 1 : 0, p.seuil, p.empreinte ?? '-', p.raison].join('\t')).join('\n')}\n`);
  // Ce que la nuit lance : `id<TAB>dossier<TAB>vitest|node`, un ensemble par ligne.
  const sorteDe = (d) => (/vitest/.test(essaie(() => JSON.parse(lire(join(d, 'package.json'))).scripts?.test) ?? '') ? 'vitest' : 'node');
  const lances = plan.filter((p) => p.jouer).map((p) => [p.id, p.dossier, sorteDe(p.dossier)].join('\t'));
  writeFileSync(join(dossier, 'lancer'), lances.length ? `${lances.join('\n')}\n` : '');
  writeFileSync(join(dossier, 'jouer'), lances.length ? 'oui\n' : 'non\n');
  const couverture = couvertureLocale({ origine: 'nuit', arbre, empreintes: e, fichiers: fichiersDe(commit), verts });
  writeFileSync(join(dossier, 'couverture.json'), `${JSON.stringify(couverture, null, 2)}\n`);
  const lignes = [`- Commit de main jugé : ${commit.slice(0, 10)}.`, `- ${lu.charAt(0).toUpperCase()}${lu.slice(1)}.`];
  for (const p of plan) {
    const attestes = Object.values(couverture.fichiers).filter((f) => f.ensemble === p.id && f.seuil >= SEUIL_DE_LA_NUIT).length;
    lignes.push(
      p.jouer
        ? `- ${nomDe(p.id)}, seuil ${p.seuil} : se joue${attestes ? ` ; ${attestes} fichier(s) attesté(s) vert(s) sur leur empreinte, que le lanceur saute en les nommant` : ''}.`
        : `- ${nomDe(p.id)}, seuil ${p.seuil} : sauté — ${p.raison} ; rien de ce qu'il lit n'a changé.`,
    );
  }
  if (!lances.length) lignes.push("- Rien ne se joue cette nuit : rien de ce que lit la suite n'a changé depuis qu'une nuit l'a trouvée verte.");
  for (const l of lignes) console.log(l);
  if (fichierResume) appendFileSync(fichierResume, `### La suite de la nuit\n\n${lignes.join('\n')}\n`);
} else {
  console.error('usage : attestation.mjs verts | plan | couverture | bilan | envoyer | ready | apres-fusion | nuit …');
  process.exit(2);
}
