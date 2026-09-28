/**
 * Les empreintes et l'attestation des tests (#237, #264, D83), côté git : les lire, décider, les
 * produire, les envoyer, les lire en CI. Les décisions sont dans `packages/gardes/attestation.mjs`.
 *
 *   node attestation.mjs verts <branche> <sortie> [<dépôt distant>]
 *       Les empreintes vertes de la branche : l'attestation locale (`refs/attestations/<branche>`),
 *       réunie à celle du dépôt distant (`<branche>--attestation`), lue sans bloquer. Écrit la liste
 *       en JSON dans `<sortie>`. Une autre session a son propre clone : ce qu'elle a trouvé vert
 *       arrive ainsi par le dépôt distant.
 *   node attestation.mjs plan <arbre> <seuil> <verts> <harnais> <main|-> <navigateur : oui|non> <sortie> <moment>
 *       Ce qu'un crochet joue ou saute : les empreintes de l'arbre, comparées aux vertes et à celles
 *       de `<main>` (la base commune avec `main`). Écrit une ligne par ensemble dans `<sortie>` :
 *       `id<TAB>1|0<TAB>seuil<TAB>empreinte<TAB>raison`, et dit ce qui ne se joue pas, et pourquoi.
 *   node attestation.mjs bilan <plan> <journaux> <moment> <arbre> <commit|-> <branche> <verts> [--enregistrer]
 *       Après les lancements : dit, pour chaque ensemble joué, son seuil et son verdict. Avec
 *       `--enregistrer`, ajoute à l'attestation locale les empreintes jouées vertes ; un ensemble
 *       rouge, ou dont un test s'est sauté faute d'outil, n'y entre pas. Seul l'outillage l'appelle ;
 *       aucune session ne l'écrit.
 *   node attestation.mjs envoyer <dépôt distant> <branche>
 *       Envoie l'attestation locale sur `<branche>--attestation`. Un échec se dit sans bloquer : la CI
 *       jouera alors ce que la table de D83 prévoit.
 *   node attestation.mjs ready <tête> <branche> <main> <sortie> [<résumé>] [--depot <propriétaire/dépôt>]
 *       La CI au Ready : si la tête ne contient pas `<main>`, la branche est à mettre à jour, et la
 *       commande échoue sans rien jouer. Sinon, écrit dans `<sortie>` ce que la CI peut sauter au-delà
 *       du seuil 1, qui se joue toujours : ce que l'attestation, une tête de la branche verte au Ready
 *       (lue par `gh` quand `--depot` est donné) ou `main` couvre.
 *   node attestation.mjs apres-fusion <commit> <dépôt GitHub> <sortie> [<résumé>]
 *       La CI sur `main` : un ensemble se saute si son empreinte est celle d'une tête de PR verte au
 *       Ready, ou celle du premier parent.
 *
 * `<sortie>` est le fichier que la CI passe à `pnpm test --attestation`. `<résumé>` reçoit, en plus
 * de la sortie standard, ce que la CI saute.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  couvertureApresFusion,
  couvertureAuReady,
  empreintes,
  etatDuStatut,
  fusionner,
  lireLAttestation,
  lireLesEntrees,
  nomDe,
  planifier,
  resume,
  SEUIL_DE_MAIN,
  texteDeLAttestation,
} from '../packages/gardes/attestation.mjs';

const git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, ...options }).trim();
const essaie = (f) => {
  try {
    return f();
  } catch {
    return null;
  }
};
const lire = (f) => essaie(() => readFileSync(f, 'utf8')) ?? '';
const REF = (branche) => `refs/attestations/${branche}`;
const DISTANTE = (branche) => `refs/attestations-distantes/${branche}`;
const BRANCHE_D_ATTESTATION = (branche) => `${branche}--attestation`;
const derniereLigne = (e) => String(e?.stderr || e?.message || e).trim().split('\n').at(-1);

/** Les empreintes d'un arbre ou d'un commit, harnais du besoin compris. */
const empreintesDe = (objet, harnais = []) => empreintes(lireLesEntrees(git(['ls-tree', '-r', '-z', '--full-tree', objet])), harnais);

/** Les empreintes vertes portées par un commit d'attestation, ou `[]`. */
function vertsDu(commit) {
  if (!commit) return [];
  return lireLAttestation(essaie(() => git(['log', '-1', '--format=%B', commit]))).attestation?.verts ?? [];
}

/** Les fichiers du harnais du besoin, par sa définition commune (`harnais-du-besoin.sh`). */
function harnaisDuBesoin(branche) {
  const dossier = mkdtempSync(join(tmpdir(), 'harnais-264-'));
  const liste = join(dossier, 'liste');
  try {
    const script = join(git(['rev-parse', '--show-toplevel']), '.githooks/harnais-du-besoin.sh');
    execFileSync('sh', ['-c', '. "$1" && harnais_du_besoin "$2" >/dev/null', 'harnais', script, liste], {
      env: { ...process.env, GITHUB_HEAD_REF: branche },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return lire(liste).split('\n').filter(Boolean);
  } catch {
    return [];
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

/** Écrit la couverture pour la CI, et dit ce qu'elle permet de sauter. */
function conclure(couverture, sortie, fichierResume, titre) {
  rmSync(sortie, { force: true });
  if (couverture) writeFileSync(sortie, `${JSON.stringify(couverture, null, 2)}\n`);
  const lignes = resume(couverture);
  for (const l of lignes) console.log(l);
  if (fichierResume) appendFileSync(fichierResume, `### ${titre}\n\n${lignes.join('\n')}\n`);
}

/**
 * Ce qu'un lancement a donné : vert, rouge, ou des tests sautés faute d'outil (`docs/gardes.md` :
 * « Un test qui se saute faute d'outil compte comme un test qui tourne »), qui ne le laissent pas vert
 * sur son empreinte (point 3).
 */
function verdictDuLancement(journaux, nom) {
  const code = lire(join(journaux, `${nom}.code`)).trim();
  if (code === '') return null;
  if (code === 'retenu') return { etat: 'retenu', retenu: lire(join(journaux, `${nom}.retenu`)).trim() };
  const journal = lire(join(journaux, `${nom}.log`));
  // node --test écrit « # SKIP » pour un test sauté ; vitest en compte plus que le seuil n'en écarte.
  let sautes = (journal.match(/# SKIP\b/g) ?? []).length;
  const rapport = essaie(() => JSON.parse(lire(join(journaux, `${nom}.rapport`))));
  if (rapport?.testResults) {
    const skipped = rapport.testResults.flatMap((r) => r.assertionResults ?? []).filter((a) => a.status === 'skipped' || a.status === 'pending').length;
    const ecartes = [...journal.matchAll(/^seuil [^:\n]*: (\d+) test\(s\) écarté\(s\)/gm)].reduce((s, m) => s + Number(m[1]), 0);
    sautes += Math.max(0, skipped - ecartes);
  }
  if (code !== '0') return { etat: 'rouge' };
  if (sautes > 0) return { etat: 'sauté', sautes };
  return { etat: 'vert' };
}

const [commande, ...args] = process.argv.slice(2);

if (commande === 'verts') {
  const [branche, sortie, distant] = args;
  const local = essaie(() => git(['rev-parse', '-q', '--verify', REF(branche)]));
  let lointain = null;
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
  console.log(`attestation : ${verts.length} empreinte(s) verte(s) connue(s) pour ${branche} — locale ${local ? 'lue' : 'absente'}${distant ? `, distante ${lointain ? 'lue' : 'absente'}` : ''}${pourquoi}.`);
} else if (commande === 'plan') {
  const [arbre, seuil, fichierVerts, fichierHarnais, main, nav, sortie, moment] = args;
  const harnais = lire(fichierHarnais).split('\n').filter(Boolean);
  const e = empreintesDe(arbre, harnais);
  const references = main && main !== '-' ? [{ empreintes: empreintesDe(main), seuil: SEUIL_DE_MAIN, raison: `rien de ce qu'il lit n'a changé depuis main (${main.slice(0, 10)})` }] : [];
  const verts = essaie(() => JSON.parse(lire(fichierVerts))) ?? [];
  const plan = planifier({ empreintes: e, seuil: Number(seuil), verts, references, navigateur: nav === 'oui', harnais });
  writeFileSync(sortie, `${plan.map((p) => [p.id, p.jouer ? 1 : 0, p.seuil, p.empreinte ?? '-', p.raison].join('\t')).join('\n')}\n`);
  for (const p of plan) if (!p.jouer) console.log(`${moment} : ${p.nom} : non joué — ${p.raison}.`);
} else if (commande === 'bilan') {
  const [fichierPlan, journaux, moment, arbre, commit, branche, fichierVerts, option] = args;
  const plan = lire(fichierPlan).split('\n').filter(Boolean).map((l) => {
    const [id, jouer, seuil, empreinte] = l.split('\t');
    return { id, jouer: jouer === '1', seuil: Number(seuil), empreinte };
  });
  const lances = lire(join(journaux, 'lances')).split('\n').filter(Boolean).map((l) => l.split('\t'));
  const nouveaux = [];
  const date = new Date().toISOString();
  for (const p of plan) {
    if (!p.jouer) continue;
    // Les lancements d'un ensemble, que la livraison note dans `lances` : `id<TAB>nom`.
    const verdicts = lances.filter(([id]) => id === p.id).map(([, nom]) => verdictDuLancement(journaux, nom)).filter(Boolean);
    const retenu = lire(join(journaux, `${p.id}.retenu`)).trim();
    let texte;
    let vert = false;
    if (!verdicts.length) texte = `non joué — ${retenu || 'aucun test à lancer'}`;
    else if (verdicts.some((v) => v.etat === 'retenu')) texte = `non joué en entier — ${verdicts.find((v) => v.etat === 'retenu').retenu}`;
    else if (verdicts.some((v) => v.etat === 'rouge')) texte = `joué au seuil ${p.seuil} : rouge`;
    else if (verdicts.some((v) => v.etat === 'sauté')) texte = `joué au seuil ${p.seuil} : ${verdicts.reduce((s, v) => s + (v.sautes ?? 0), 0)} test(s) sauté(s) faute d'outil, donc pas vert sur son empreinte`;
    else {
      texte = `joué au seuil ${p.seuil} : vert`;
      vert = true;
    }
    console.log(`${moment} : ${nomDe(p.id)} : ${texte}.`);
    if (vert && p.empreinte !== '-') nouveaux.push({ ensemble: p.id, empreinte: p.empreinte, seuil: p.seuil, par: moment, commit: commit === '-' ? null : commit, arbre, date });
  }
  if (option === '--enregistrer' && nouveaux.length) {
    const anciens = essaie(() => JSON.parse(lire(fichierVerts))) ?? [];
    const message = texteDeLAttestation({ branche, verts: [...nouveaux, ...anciens] });
    // L'outillage signe : l'attestation n'est l'œuvre de personne.
    const identite = { GIT_AUTHOR_NAME: 'Livraison Tirelire', GIT_AUTHOR_EMAIL: 'livraison@tirelire.invalid' };
    const env = { ...process.env, ...identite, GIT_COMMITTER_NAME: identite.GIT_AUTHOR_NAME, GIT_COMMITTER_EMAIL: identite.GIT_AUTHOR_EMAIL };
    const vide = git(['hash-object', '-t', 'tree', '-w', '--stdin'], { input: '' });
    git(['update-ref', REF(branche), git(['commit-tree', vide, '-F', '-'], { input: message, env })]);
    console.log(`${moment} : attestation locale de ${branche} : ${nouveaux.map((v) => `${nomDe(v.ensemble)} (seuil ${v.seuil})`).join(', ')} vert(s) sur leur empreinte.`);
  }
} else if (commande === 'envoyer') {
  const [distant, branche] = args;
  if (!essaie(() => git(['rev-parse', '-q', '--verify', REF(branche)]))) {
    console.log(`aucune attestation locale de ${branche} : rien à envoyer.`);
  } else {
    try {
      git(['push', '-q', '--no-verify', distant, `+${REF(branche)}:refs/heads/${BRANCHE_D_ATTESTATION(branche)}`]);
      console.log(`attestation de ${branche} envoyée (${BRANCHE_D_ATTESTATION(branche)}).`);
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
    const couverture = couvertureAuReady({ arbre, empreintes: empreintesDe(tete, harnais), verts, tetes, main: { commit: git(['rev-parse', main]), empreintes: empreintesDe(main) }, harnais });
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
} else {
  console.error('usage : attestation.mjs verts | plan | bilan | envoyer | ready | apres-fusion …');
  process.exit(2);
}
