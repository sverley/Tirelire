/**
 * Un workflow GitHub Actions joué à blanc, événement par événement : quels jobs et quelles étapes
 * passent leur condition (`if`, `needs`). Repris tel quel de `distributions.test.mjs` (#153, #159)
 * pour servir aussi au harnais de #150. Lecture par renfoncement, sans dépendance YAML : la forme des
 * workflows du dépôt (deux espaces), pas toutes celles que YAML permet.
 */
import assert from 'node:assert/strict';

/** Préfixe des messages d'échec. */
const CI = 'workflow';

// ─── Lecture du workflow ─────────────────────────────────────────────────────────────────────────

/** Les jobs : nom → { début (ligne de l'en-tête), lignes }. `jobs:` est la dernière clé de premier niveau. */
export function jobs(yaml) {
  const lignes = yaml.split('\n');
  const début = lignes.findIndex((l) => /^jobs:\s*$/.test(l));
  assert.ok(début >= 0, `${CI} : aucune section \`jobs:\``);
  const blocs = new Map();
  let courant;
  for (let i = début + 1; i < lignes.length; i += 1) {
    const m = lignes[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (m) blocs.set((courant = m[1]), { nom: courant, début: i, lignes: [] });
    else if (courant) blocs.get(courant).lignes.push(lignes[i]);
  }
  return blocs;
}

export const CLÉ_ÉTAPE = (clé) => new RegExp(`^(?: {6}- | {8})${clé}:`);

/** Valeur d'une clé : sur sa ligne, ou repliée sur les lignes plus indentées qui suivent (`>-`, `|`). */
export function scalaire(lignes, motif) {
  const i = lignes.findIndex((l) => motif.test(l));
  if (i < 0) return '';
  const brut = lignes[i].replace(motif, '').trim();
  if (!/^[>|][-+]?$/.test(brut)) return brut;
  const colonne = lignes[i].search(/\S/) + (/^\s*- /.test(lignes[i]) ? 2 : 0);
  const suite = [];
  for (const l of lignes.slice(i + 1)) {
    if (l.trim() && l.search(/\S/) <= colonne) break;
    suite.push(l.trim());
  }
  return suite.join(' ');
}

/** Une condition, sans guillemets ni `${{ }}`. */
export const expression = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2').replace(/^\$\{\{([\s\S]*)\}\}$/, '$1').trim();

export function besoins(lignes) {
  const i = lignes.findIndex((l) => /^ {4}needs:/.test(l));
  if (i < 0) return [];
  const v = lignes[i].replace(/^ {4}needs:/, '').trim();
  if (v) return v.replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  const liste = [];
  for (const l of lignes.slice(i + 1)) {
    const m = l.match(/^ {6}- \s*(\S+)/);
    if (!m) break;
    liste.push(m[1]);
  }
  return liste;
}

/** Les étapes d'un job, sans les commentaires ; `k` : indice de leur première ligne dans le job. */
export function étapes(lignes) {
  const début = lignes.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  if (début < 0) return [];
  const liste = [];
  for (let k = début + 1; k < lignes.length; k += 1) {
    const l = lignes[k];
    if (/^ {0,4}\S/.test(l)) break;
    if (/^ {6}- /.test(l)) liste.push({ k, lignes: [l] });
    else if (liste.length && l.trim() && !l.trim().startsWith('#')) liste.at(-1).lignes.push(l);
  }
  return liste.map((é) => ({ ...é, texte: é.lignes.join('\n') }));
}

/** Ce que l'étape exécute : tout sauf son nom affiché. */
export const commande = (é) => é.lignes.filter((l) => !CLÉ_ÉTAPE('name').test(l)).join('\n');

// ─── Les expressions de GitHub Actions, le sous-ensemble utile ───────────────────────────────────

export function jetons(source) {
  const motif = /\s*(?:'((?:[^']|'')*)'|(\d+(?:\.\d+)?)\b|(==|!=|&&|\|\||<=|>=|[!()<>,])|([A-Za-z_][\w-]*(?:\.(?:[\w-]+|\*))*))/y;
  const liste = [];
  let m;
  while (motif.lastIndex < source.length && (m = motif.exec(source))) {
    if (m[1] !== undefined) liste.push({ t: 'v', v: m[1].replace(/''/g, "'") });
    else if (m[2] !== undefined) liste.push({ t: 'v', v: Number(m[2]) });
    else if (m[3] !== undefined) liste.push({ t: m[3] });
    else liste.push({ t: 'nom', v: m[4] });
  }
  assert.ok(m && motif.lastIndex === source.length, `${CI} : condition illisible par le harnais : ${source}`);
  return liste;
}

export const vrai = (x) => !(x === false || x === null || x === undefined || x === 0 || x === '' || Number.isNaN(x));
export const nombre = (x) =>
  x == null ? 0 : typeof x === 'boolean' ? Number(x) : typeof x === 'number' ? x : typeof x === 'string' ? (x.trim() ? Number(x) : 0) : NaN;
export function égal(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (typeof a === typeof b && a !== null && b !== null) return a === b;
  return nombre(a) === nombre(b);
}
/** Un chemin de propriétés ; `*` est le filtre d'objets de GitHub : `labels.*.name` donne la liste des noms. */
export function chemin(o, segments) {
  if (!segments.length) return o ?? null;
  const [k, ...reste] = segments;
  if (o == null) return null;
  if (k === '*') {
    const éléments = Array.isArray(o) ? o : typeof o === 'object' ? Object.values(o) : [];
    return éléments.flatMap((e) => {
      const v = chemin(e, reste);
      return v == null ? [] : [v];
    });
  }
  return chemin(o[k], reste);
}

export const STATUT = /\b(always|success|failure|cancelled)\s*\(/;

export function évaluer(source, ctx, échec = false) {
  const j = jetons(source.trim());
  let i = 0;
  const voit = (t) => j[i]?.t === t;
  const prend = (t) => {
    assert.ok(voit(t), `${CI} : « ${t} » attendu dans la condition ${source}`);
    i += 1;
  };
  const ou = () => {
    let a = et();
    while (voit('||')) (i += 1), (a = ((b) => (vrai(a) ? a : b))(et()));
    return a;
  };
  const et = () => {
    let a = comparaison();
    while (voit('&&')) (i += 1), (a = ((b) => (vrai(a) ? b : a))(comparaison()));
    return a;
  };
  const comparaison = () => {
    let a = unaire();
    while (['==', '!=', '<', '>', '<=', '>='].some(voit)) {
      const op = j[i++].t;
      const b = unaire();
      a = op === '==' ? égal(a, b) : op === '!=' ? !égal(a, b) : { '<': nombre(a) < nombre(b), '>': nombre(a) > nombre(b), '<=': nombre(a) <= nombre(b), '>=': nombre(a) >= nombre(b) }[op];
    }
    return a;
  };
  const unaire = () => (voit('!') ? ((i += 1), !vrai(unaire())) : primaire());
  const primaire = () => {
    const x = j[i++];
    assert.ok(x, `${CI} : condition incomplète : ${source}`);
    if (x.t === 'v') return x.v;
    if (x.t === '(') {
      const v = ou();
      prend(')');
      return v;
    }
    assert.equal(x.t, 'nom', `${CI} : condition illisible par le harnais : ${source}`);
    if (voit('(')) {
      i += 1;
      const args = [];
      while (!voit(')')) {
        args.push(ou());
        if (voit(',')) i += 1;
      }
      prend(')');
      const [a, b] = args.map((v) => (v == null ? '' : v));
      const f = {
        always: () => true,
        success: () => !échec,
        failure: () => échec,
        cancelled: () => false,
        startsWith: () => String(a).toLowerCase().startsWith(String(b).toLowerCase()),
        endsWith: () => String(a).toLowerCase().endsWith(String(b).toLowerCase()),
        contains: () => (Array.isArray(a) ? a.some((v) => égal(v, b)) : String(a).toLowerCase().includes(String(b).toLowerCase())),
      }[x.v];
      assert.ok(f, `${CI} : fonction « ${x.v} » inconnue du harnais`);
      return f();
    }
    if (['true', 'false', 'null'].includes(x.v)) return JSON.parse(x.v);
    return chemin(ctx, x.v.split('.'));
  };
  const v = ou();
  assert.equal(i, j.length, `${CI} : condition illisible par le harnais : ${source}`);
  return v;
}

export const interpoler = (v, ctx) =>
  v
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .replace(/\$\{\{([\s\S]*?)\}\}/g, (_, e) => {
      const x = évaluer(e, ctx);
      return x == null ? '' : String(x);
    });

// ─── Le workflow joué à blanc ────────────────────────────────────────────────────────────────────

/** Les jobs qui tournent pour cet événement, et leurs étapes jouées. `échoue(étape)` : l'étape échoue. */
export function jouer(yaml, ctx, échoue = () => false) {
  const blocs = jobs(yaml);
  const états = new Map();
  const état = (nom, pile = new Set()) => {
    if (états.has(nom)) return états.get(nom);
    assert.ok(blocs.has(nom), `${CI} : le job « ${nom} », attendu par un \`needs\`, n'existe pas`);
    assert.ok(!pile.has(nom), `${CI} : dépendance circulaire autour du job « ${nom} »`);
    pile.add(nom);
    const { lignes } = blocs.get(nom);
    const amont = besoins(lignes).map((n) => état(n, pile));
    const si = expression(scalaire(lignes, /^ {4}if:/));
    const amontOk = amont.every((a) => a.réussi);
    const amontÉchec = amont.some((a) => a.tourne && !a.réussi);
    const tourne = !si ? amontOk : STATUT.test(si) ? vrai(évaluer(si, ctx, amontÉchec)) : amontOk && vrai(évaluer(si, ctx));
    const joués = [];
    let échec = false;
    for (const é of tourne ? étapes(lignes) : []) {
      const c = expression(scalaire(é.lignes, CLÉ_ÉTAPE('if')));
      const passe = !c ? !échec : STATUT.test(c) ? vrai(évaluer(c, ctx, échec)) : !échec && vrai(évaluer(c, ctx));
      if (!passe) continue;
      joués.push(é);
      if (échoue(é) && !/^ +(?:- )?continue-on-error:\s*true/m.test(é.texte)) échec = true;
    }
    const r = { ...blocs.get(nom), besoins: amont.map((a) => a.nom), tourne, réussi: tourne && !échec, joués };
    états.set(nom, r);
    return r;
  };
  return [...blocs.keys()].map((n) => état(n));
}
