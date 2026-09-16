/**
 * Verdict du pré-commit (#127, D75). Chaque paquet a été joué une fois ; ce script trie ses échecs
 * par fichier :
 * - un fichier du harnais du besoin (`harnais-du-besoin.sh`) est joué et affiché sans bloquer, sauf
 *   une erreur de syntaxe, qui bloque ; un import introuvable est signalé à part, en nommant le
 *   module (Q2 de #127) ;
 * - tout autre échec est une régression et refuse le commit, comme un paquet en échec sans rapport
 *   lisible (script absent, configuration cassée).
 * Usage : node verdict.mjs <racine> <journaux> <début en s> <nom:dossier:lanceur>…
 * Sortie : 0 si le commit passe, 1 sinon.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const [racineBrute, journaux, debut, ...lances] = process.argv.slice(2);
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

/** Échecs d'un rapport `node --test` : Map fichier → { tests, chargement }, ou null. */
function echecsNode(texte) {
  const echecs = new Map();
  const stderr = new Map();
  let orphelins = 0;
  for (const l of texte.split('\n')) {
    if (!l) continue;
    let e;
    try {
      e = JSON.parse(l);
    } catch {
      return null;
    }
    if (e.type === 'stderr') {
      stderr.set(e.file, (stderr.get(e.file) ?? '') + e.message);
      continue;
    }
    if (!e.file) {
      orphelins++;
      continue;
    }
    const f = chemin(e.file);
    const entree = echecs.get(f) ?? { tests: [], chargement: null, absolu: e.file };
    if (e.fichier) entree.chargement = 'échec au chargement';
    else if (e.sorte !== 'subtestsFailed') entree.tests.push(`« ${e.name} »${e.message ? ` (${ligne(e.message)})` : ''}`);
    echecs.set(f, entree);
  }
  for (const e of echecs.values()) if (e.chargement) e.chargement = stderr.get(e.absolu) || e.chargement;
  return { echecs, orphelins };
}

/** Échecs d'un rapport JSON de vitest, même forme. */
function echecsVitest(texte) {
  let d;
  try {
    d = JSON.parse(texte);
  } catch {
    return null;
  }
  const echecs = new Map();
  for (const r of d.testResults ?? []) {
    const rouges = (r.assertionResults ?? []).filter((a) => a.status === 'failed');
    if (rouges.length) {
      const tests = rouges.map((a) => `« ${a.fullName ?? a.title} »${a.failureMessages?.length ? ` (${ligne(a.failureMessages[0])})` : ''}`);
      echecs.set(chemin(r.name), { tests, chargement: null });
    } else if (r.status === 'failed') {
      echecs.set(chemin(r.name), { tests: [], chargement: r.message || 'échec au chargement' });
    }
  }
  return { echecs, orphelins: 0 };
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
  const utiles = lignes.filter((l) => /^\s*not ok|FAIL|✗|×|AssertionError|ERR_PNPM/.test(l)).slice(0, 40);
  return [...utiles, '  … fin du journal :', ...lignes.slice(-30)].join('\n');
}

const refus = [];
const affiches = [];
const journauxRefuses = [];
const joues = [];
for (const lance of lances) {
  const [nom, dossier, lanceur] = lance.split(':');
  joues.push({ nom, dossier });
  const journal = lire(join(journaux, `${nom}.log`)) ?? '';
  for (const l of journal.split('\n')) if (/# SKIP/.test(l)) console.log(`pré-commit : test sauté (${nom}) : ${l.trim()}`);
  const code = (lire(join(journaux, `${nom}.code`)) ?? '1').trim();
  if (code === '0') continue;
  const rapport = lire(join(journaux, `${nom}.rapport`));
  const lu = rapport === null ? null : lanceur === 'vitest' ? echecsVitest(rapport) : echecsNode(rapport);
  let regression = !lu || lu.orphelins > 0 || lu.echecs.size === 0;
  if (regression) refus.push(`✗ ${nom} : échec sans rapport lisible par fichier (code ${code}).`);
  for (const [f, e] of lu?.echecs ?? []) {
    const n = e.chargement ? nature(e.chargement) : null;
    if (!harnais.has(f)) {
      regression = true;
      refus.push(`✗ non-régression (${nom}) — ${f} : ${n ? `ne s'exécute pas : ${n.module ?? n.detail}` : e.tests.join(' ; ')}`);
    } else if (n?.sorte === 'syntaxe') {
      refus.push(`✗ harnais du besoin (${nom}), erreur de syntaxe — ${f} : ${n.detail}`);
    } else if (n?.sorte === 'import') {
      affiches.push(`◦ harnais du besoin (${nom}), import introuvable — module ${n.module}, importé par ${f}`);
    } else if (n) {
      affiches.push(`◦ harnais du besoin (${nom}), ne s'exécute pas — ${f} : ${n.detail}`);
    } else {
      affiches.push(`◦ harnais du besoin (${nom}), rouge — ${f} : ${e.tests.join(' ; ')}`);
    }
  }
  if (regression) journauxRefuses.push(`\n✗ tests ${nom} (code ${code}) :\n${extrait(journal)}`);
}

const duree = Math.max(0, Math.round(Date.now() / 1000) - Number(debut));
const noms = joues.map((j) => j.nom).join(' ');
const horsJeu = [...harnais].filter((f) => !joues.some((j) => f.startsWith(`${j.dossier}/`)));
if (note) console.log(`pré-commit : ${note}.`);
if (affiches.length) {
  console.log('pré-commit : harnais du besoin en échec, affiché sans bloquer (la livraison le bloquera, #121) :');
  for (const a of affiches) console.log(`  ${a}`);
}
if (horsJeu.length) console.log(`pré-commit : harnais du besoin non joué au commit (CI) : ${horsJeu.join(', ')}.`);
if (refus.length) {
  for (const j of journauxRefuses) console.error(j);
  console.error('');
  for (const r of refus) console.error(r);
  console.error(`pré-commit refusé : la non-régression ou la syntaxe d'un harnais est en échec — ${noms} (${duree} s).`);
  process.exit(1);
}
console.log(`pré-commit : non-régression verte — ${noms} (${duree} s)${affiches.length ? ` ; harnais du besoin : ${affiches.length} fichier(s) en échec, non bloquant(s)` : ''}.`);
