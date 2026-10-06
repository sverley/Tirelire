/**
 * Les échecs d'un lancement, dits court (#352, point 4) : pour chaque fichier rouge, chaque test en
 * échec, avec son message et l'endroit de l'échec. Les rapporteurs du lanceur
 * (`echecs-node-rapport.mjs`, `echecs-vitest-rapport.mjs`) en écrivent une ligne JSON par test,
 * `{ fichier, test, message, endroit }`, dans le fichier que nomme `TIRELIRE_ECHECS`.
 */
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** La première ligne non vide d'un message, coupée à 300 caractères. */
export const premiereLigne = (t) => (String(t ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '').slice(0, 300);

/** Le message d'une erreur : sa première ligne, et, pour une comparaison, ce qui est reçu et attendu. */
export function messageDe(erreur) {
  const base = premiereLigne(erreur?.message);
  if (!erreur || !('expected' in erreur) || !('actual' in erreur)) return base;
  const v = (x) => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })() ?? String(x)).replace(/\s+/g, ' ').slice(0, 80);
  return `${base.replace(/:$/, '')} — reçu ${v(erreur.actual)}, attendu ${v(erreur.expected)}`.slice(0, 300);
}

/**
 * L'endroit de l'échec, `chemin:ligne:colonne`, lu dans une pile d'appels : la première ligne qui
 * situe dans `fichier`, sinon la première hors de `node:` et de `node_modules` ; `null` sans.
 */
export function endroitDans(pile, fichier = null) {
  const lieux = [];
  for (const m of String(pile ?? '').matchAll(/(?:file:\/\/)?(\/[^\s():]+):(\d+):(\d+)/g)) {
    let chemin = m[1];
    if (m[0].startsWith('file://')) chemin = fileURLToPath(`file://${m[1]}`);
    lieux.push({ chemin, ligne: m[2], colonne: m[3] });
  }
  const dedans = fichier ? lieux.find((l) => l.chemin === fichier) : null;
  const l = dedans ?? lieux.find((x) => !x.chemin.split('/').includes('node_modules') && !/niveaux-node-enveloppe\.mjs$/.test(x.chemin));
  return l ? `${l.chemin}:${l.ligne}:${l.colonne}` : null;
}

/** Les lignes qui disent les fichiers rouges : un en-tête par fichier, une ligne par test. */
export function lignesDesEchecs(echecs, base = process.cwd()) {
  const parFichier = new Map();
  for (const e of echecs) {
    if (!parFichier.has(e.fichier)) parFichier.set(e.fichier, []);
    parFichier.get(e.fichier).push(e);
  }
  const court = (c) => (c && c.startsWith('/') ? relative(base, c) : c);
  const lignes = [];
  for (const [f, es] of parFichier) {
    lignes.push(`✗ ${court(f)} :`);
    for (const e of es) lignes.push(`  « ${e.test} » — ${e.message || 'échec sans message'}${e.endroit ? ` (${court(e.endroit)})` : ''}`);
  }
  return lignes;
}

/**
 * La ligne d'un ensemble au bilan d'un crochet : 160 caractères au plus quand les comptes du lanceur
 * la suivent (#352, point 1) ; au-delà, le verdict se coupe, jamais les comptes.
 */
export function ligneDEnsemble(moment, nom, verdict, comptes) {
  if (!comptes) return `${moment} : ${nom} : ${verdict}.`;
  const fin = ` — ${comptes}.`;
  let tete = `${moment} : ${nom} : ${verdict}`;
  if (tete.length + fin.length > 160) tete = `${tete.slice(0, Math.max(0, 160 - fin.length - 1))}…`;
  return `${tete}${fin}`.slice(0, 160);
}
