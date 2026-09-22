/**
 * Verdict du pré-commit (#127). Chaque paquet a été joué une fois ; ce script trie ses échecs
 * par fichier :
 * - un fichier du harnais du besoin (`harnais-du-besoin.sh`) est joué et affiché sans bloquer, sauf
 *   une erreur de syntaxe, qui bloque ; un import introuvable est signalé à part, en nommant le
 *   module (Q2 de #127) ;
 * - tout autre échec est une régression et refuse le commit, en citant l'erreur : test rouge, fichier
 *   qui ne se charge pas, ou erreur hors de tout test (promesse rejetée non rattrapée, sortie en
 *   échec). Une erreur non attrapée sans fichier d'origine, ou un paquet en échec sans rapport lisible
 *   (script absent, configuration cassée), refuse aussi le commit.
 * À la livraison (#121), `livraison.sh` le réutilise : `TIRELIRE_NIVEAU` nomme le crochet
 * (`pré-fusion`, `pré-push`), et `TIRELIRE_HARNAIS=bloque` fait bloquer tout échec du harnais du
 * besoin. Le lanceur `typecheck` n'a pas de rapport par fichier : son échec est une régression.
 * L'état du harnais (`vert` ou `rouge`) est écrit dans `<journaux>/harnais.etat`.
 * Usage : node verdict.mjs <racine> <journaux> <début en s> <nom:dossier:lanceur>…
 * Sortie : 0 si le commit passe, 1 sinon.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const [racineBrute, journaux, debut, ...lances] = process.argv.slice(2);
const niveau = process.env.TIRELIRE_NIVEAU || 'pré-commit';
const commit = niveau === 'pré-commit';
const harnaisBloque = process.env.TIRELIRE_HARNAIS === 'bloque';
const reel = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
const lire = (f) => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return null;
  }
};
const racine = reel(racineBrute);
const chemin = (f) => relative(racine, reel(f)).split('\\').join('/');
const ligne = (t) => String(t ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';

const harnais = new Set((lire(join(journaux, 'harnais.txt')) ?? '').split('\n').filter(Boolean));
const note = (lire(join(journaux, 'harnais.note')) ?? '').trim();

/**
 * Échecs d'un rapport `node --test` : { echecs: Map fichier → entrée, orphelins }, ou null.
 * Entrée : { tests, chargement, horsTest } — tests rouges ; texte d'un fichier qui ne s'est pas
 * chargé ; erreurs survenues hors de tout test dans un fichier chargé.
 */
function echecsNode(texte) {
  const echecs = new Map();
  const sorties = new Map();
  const diagnostics = new Map();
  const charges = new Set();
  const niveauFichier = new Set();
  let orphelins = 0;
  const ajoute = (m, cle, t) => m.set(cle, (m.get(cle) ?? '') + t);
  const entree = (f) => {
    if (!echecs.has(f)) echecs.set(f, { tests: [], chargement: null, horsTest: [] });
    return echecs.get(f);
  };
  for (const l of texte.split('\n')) {
    if (!l) continue;
    let e;
    try {
      e = JSON.parse(l);
    } catch {
      return null;
    }
    if (e.type === 'stderr') ajoute(sorties, e.file, e.message);
    else if (e.type === 'diagnostic') ajoute(diagnostics, e.file, `${e.message}\n`);
    else if (e.type === 'passe') charges.add(e.file);
    else if (!e.file) {
      orphelins++;
      refus.push(`✗ non-régression (${nomCourant}) — échec hors de tout fichier : « ${e.name} »${e.message ? ` (${ligne(e.message)})` : ''}`);
    }
    else if (e.fichier) {
      niveauFichier.add(e.file);
      entree(chemin(e.file));
    } else {
      charges.add(e.file);
      if (e.sorte !== 'subtestsFailed') entree(chemin(e.file)).tests.push(`« ${e.name} »${e.message ? ` (${ligne(e.message)})` : ''}`);
    }
  }
  for (const absolu of niveauFichier) {
    const e = entree(chemin(absolu));
    const diag = diagnostics.get(absolu) ?? '';
    const sortie = sorties.get(absolu) ?? '';
    if (charges.has(absolu)) e.horsTest.push(erreurHorsTest(diag) ?? (ligne(sortie.split('\n').find((l) => /Error|erreur|refus/i.test(l)) ?? sortie) || 'le fichier sort en échec'));
    else e.chargement = sortie || diag || 'échec au chargement';
  }
  return { echecs, orphelins };
}

/** L'erreur que Node rattache à un test après sa fin, ou le premier diagnostic. */
function erreurHorsTest(diag) {
  const m = diag.match(/Test "(.+?)" at .*? generated asynchronous activity after the test ended\. This activity created the error "(.+?)"/s);
  if (m) return `${m[2]} (après la fin du test « ${m[1]} »)`;
  return diag.trim() ? ligne(diag).slice(0, 300) : null;
}

/** Échecs d'un rapport JSON de vitest, même forme ; le journal donne les erreurs non attrapées. */
function echecsVitest(texte, journal, dossier) {
  let d;
  try {
    d = JSON.parse(texte);
  } catch {
    return null;
  }
  const echecs = new Map();
  const entree = (f) => {
    if (!echecs.has(f)) echecs.set(f, { tests: [], chargement: null, horsTest: [] });
    return echecs.get(f);
  };
  for (const r of d.testResults ?? []) {
    const rouges = (r.assertionResults ?? []).filter((a) => a.status === 'failed');
    if (rouges.length) {
      entree(chemin(r.name)).tests.push(
        ...rouges.map((a) => `« ${a.fullName ?? a.title} »${a.failureMessages?.length ? ` (${ligne(a.failureMessages[0])})` : ''}`),
      );
    } else if (r.status === 'failed') {
      entree(chemin(r.name)).chargement = r.message || 'échec au chargement';
    }
  }
  // Vitest ne met pas les erreurs non attrapées dans son rapport JSON : son journal les liste, chacune
  // avec le fichier de test qui tournait. Une erreur sans fichier d'origine compte comme orpheline.
  const lignes = journal.split('\n');
  let orphelins = 0;
  let trouvees = 0;
  for (let i = 0; i < lignes.length; i++) {
    if (!/^⎯+ Unhandled (Rejection|Error) ⎯+/.test(lignes[i].trim())) continue;
    trouvees++;
    let erreur = '';
    let origine = null;
    for (let j = i + 1; j < lignes.length && !/^⎯+( Unhandled .*⎯+)?$/.test(lignes[j].trim()); j++) {
      if (!erreur && lignes[j].trim()) erreur = lignes[j].trim();
      const m = lignes[j].match(/This error originated in "([^"]+)" test file/);
      if (m) origine = m[1];
    }
    const texteErreur = `${erreur || 'erreur sans message'} (non attrapée)`;
    if (origine) entree(chemin(resolve(racine, dossier, origine))).horsTest.push(texteErreur);
    else {
      orphelins++;
      refus.push(`✗ non-régression (${nomCourant}) — erreur hors d'un test, sans fichier d'origine : ${texteErreur}`);
    }
  }
  const annoncees = Number(journal.match(/Vitest caught (\d+) unhandled error/)?.[1] ?? 0);
  if (annoncees > trouvees) {
    orphelins++;
    refus.push(`✗ non-régression (${nomCourant}) : ${annoncees} erreur(s) non attrapée(s) annoncée(s), ${trouvees} lue(s) dans le journal`);
  }
  return { echecs, orphelins };
}

/** Nature d'un échec de chargement : import introuvable, syntaxe, ou autre. */
function nature(texte) {
  let m = texte.match(/requested module '([^']+)' does not provide an export named '([^']+)'/);
  if (m) return { sorte: 'import', module: `${m[1]} (export ${m[2]})` };
  m = texte.match(/Cannot find (?:module|package) '([^']+)'/) ?? texte.match(/Failed to (?:load url|resolve import) "?([^\s"]+)/);
  if (m) return { sorte: 'import', module: m[1] };
  const detail = ligne(texte.split('\n').find((l) => /SyntaxError|ERROR:|Error/.test(l)) ?? texte).slice(0, 200);
  if (/ERR_MODULE_NOT_FOUND/.test(texte)) return { sorte: 'import', module: detail };
  if (/SyntaxError|Transform failed/.test(texte)) return { sorte: 'syntaxe', detail };
  return { sorte: 'chargement', detail };
}

function extrait(journal) {
  const lignes = journal.split('\n');
  const utiles = lignes.filter((l) => /^\s*not ok|FAIL|✗|×|AssertionError|ERR_PNPM|error TS\d|^Error/.test(l)).slice(0, 40);
  return [...utiles, '  … fin du journal :', ...lignes.slice(-30)].join('\n');
}

const refus = [];
// Un échec compté comme régression bloque, même si aucun motif n'a été écrit pour lui.
let bloque = false;
const affiches = [];
const journauxRefuses = [];
const joues = [];
let nomCourant = '';
let harnaisRouge = false;
for (const lance of lances) {
  const [nom, dossier, lanceur] = lance.split(':');
  nomCourant = nom;
  joues.push({ nom, dossier });
  const journal = lire(join(journaux, `${nom}.log`)) ?? '';
  for (const l of journal.split('\n')) if (/# SKIP/.test(l)) console.log(`${niveau} : test sauté (${nom}) : ${l.trim()}`);
  const code = (lire(join(journaux, `${nom}.code`)) ?? '1').trim();
  if (code === '0') continue;
  if (lanceur === 'typecheck') {
    bloque = true;
    refus.push(`✗ non-régression (${nom}) : le typecheck est en échec (code ${code}).`);
    journauxRefuses.push(`\n✗ ${nom} (code ${code}) :\n${extrait(journal)}`);
    continue;
  }
  const rapport = lire(join(journaux, `${nom}.rapport`));
  const lu = rapport === null ? null : lanceur === 'vitest' ? echecsVitest(rapport, journal, dossier) : echecsNode(rapport);
  let regression = !lu || lu.orphelins > 0 || lu.echecs.size === 0;
  if (!lu || (lu.orphelins === 0 && lu.echecs.size === 0)) refus.push(`✗ ${nom} : échec sans rapport lisible par fichier (code ${code}).`);
  for (const [f, e] of lu?.echecs ?? []) {
    const n = e.chargement ? nature(e.chargement) : null;
    const hors = e.horsTest.map((t) => `erreur hors d'un test : ${t}`);
    if (!harnais.has(f)) {
      regression = true;
      const causes = [...e.tests, ...hors, ...(n ? [`ne se charge pas : ${n.module ?? n.detail}`] : [])];
      refus.push(`✗ non-régression (${nom}) — ${f} : ${causes.join(' ; ')}`);
      continue;
    }
    harnaisRouge = true;
    if (harnaisBloque) {
      regression = true;
      const causes = [...e.tests, ...hors, ...(n ? [`ne se charge pas : ${n.module ?? n.detail}`] : [])];
      refus.push(`✗ harnais du besoin (${nom}) — ${f} : ${causes.join(' ; ')}`);
      continue;
    }
    if (n?.sorte === 'syntaxe') refus.push(`✗ harnais du besoin (${nom}), erreur de syntaxe — ${f} : ${n.detail}`);
    else if (n?.sorte === 'import') affiches.push(`◦ harnais du besoin (${nom}), import introuvable — module ${n.module}, importé par ${f}`);
    else if (n) affiches.push(`◦ harnais du besoin (${nom}), ne se charge pas — ${f} : ${n.detail}`);
    if (e.tests.length || hors.length) affiches.push(`◦ harnais du besoin (${nom}), rouge — ${f} : ${[...e.tests, ...hors].join(' ; ')}`);
  }
  if (regression) bloque = true;
  if (regression) journauxRefuses.push(`\n✗ tests ${nom} (code ${code}) :\n${extrait(journal)}`);
}

const duree = Math.max(0, Math.round(Date.now() / 1000) - Number(debut));
const noms = joues.map((j) => j.nom).join(' ');
const horsJeu = [...harnais].filter((f) => !joues.some((j) => f.startsWith(`${j.dossier}/`)));
try {
  writeFileSync(join(journaux, 'harnais.etat'), harnaisRouge ? 'rouge' : 'vert');
} catch {
  // l'état ne sert qu'au registre des arbres vérifiés
}
if (note) console.log(`${niveau} : ${note}.`);
if (affiches.length) {
  console.log(
    commit
      ? 'pré-commit : harnais du besoin en échec, affiché sans bloquer (la livraison le bloquera, #121) :'
      : `${niveau} : harnais du besoin en échec, affiché sans bloquer (ce qui arrive n'apporte pas de code) :`,
  );
  for (const a of affiches) console.log(`  ${a}`);
}
if (commit && horsJeu.length) console.log(`pré-commit : harnais du besoin non joué au commit (CI) : ${horsJeu.join(', ')}.`);
if (refus.length || bloque) {
  if (!refus.length) refus.push('✗ non-régression : échec sans motif lisible (voir le journal ci-dessus).');
  for (const j of journauxRefuses) console.error(j);
  console.error('');
  for (const r of refus) console.error(r);
  console.error(
    commit
      ? `pré-commit refusé : la non-régression ou la syntaxe d'un harnais est en échec — ${noms} (${duree} s).`
      : `${niveau} refusé${harnaisBloque ? ' : la non-régression ou le harnais du besoin est en échec' : ' : la non-régression est en échec'} — ${noms} (${duree} s).`,
  );
  process.exit(1);
}
console.log(`${niveau} : non-régression verte — ${noms || 'rien à jouer'} (${duree} s)${affiches.length ? ` ; harnais du besoin : ${affiches.length} fichier(s) en échec, non bloquant(s)` : ''}.`);
