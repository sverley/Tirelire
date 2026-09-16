/**
 * Harnais de #124 — « Les sous-branches d'une PR sont supprimées à sa fusion ».
 *
 * Besoin d'outil : ce sont des tests (glossaire), placés ici faute d'application (D65).
 *
 * Le workflow `.github/workflows/sous-branches.yml` est lu, puis ses étapes `run` sont rejouées en
 * bash sur la machine, comme sur un exécuteur GitHub, avec un événement de fermeture fabriqué :
 * - `gh` est un faux qui transmet chaque appel à un GitHub factice servi sur la boucle locale (D71).
 *   Il tient un modèle : branches, commits et leurs parents, PR. `--jq` passe par le vrai `jq` ;
 * - `curl`, `wget` et `git` sont des faux qui refusent : aucun appel ne sort de la machine ;
 * - les expressions `${{ … }}` et les conditions `if:` sont évaluées sur ce contexte.
 * Un appel que le modèle ne connaît pas fait échouer le cas en le nommant : c'est au harnais de
 * s'étendre, à signaler en commentaire de la PR.
 *
 * Témoins : une version correcte du workflow passe tous les cas (témoin vert) ; des versions
 * cassées, chacune d'une erreur plausible, sont refusées (témoins rouges). `node:test` n'a pas de
 * `test.fails` : l'échec attendu tient dans une assertion (#66).
 *
 * Outils : bash (avec /dev/tcp) et jq. Sauté s'il en manque un, sauf si `TIRELIRE_STRICT` est posé, comme en
 * CI : il échoue alors (#59).
 *
 * Hors harnais (D62) : un YAML ou une expression d'une forme que ce lecteur ne connaît pas (le cas
 * échoue en le disant), un appel réseau par un autre programme que ceux interceptés, les
 * permissions réellement accordées par GitHub.
 */
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { RACINE } from './gardes.mjs';

const WORKFLOW = '.github/workflows/sous-branches.yml';
const DEPOT = 'sverley/Tirelire';
const TETE = 'feature/x';
const NUMERO = 42;
const CODEUR = `${TETE}--codeur`;
const AUDITEUR = `${TETE}--auditeur`;
const VOISINS = [`${TETE}--codeur-ancien`, 'feature/xy--codeur'];

const strict = Boolean(process.env.TIRELIRE_STRICT);
const chemin = (outil) => spawnSync('sh', ['-c', `command -v ${outil}`], { encoding: 'utf8' }).stdout.trim();
const manquant = ['bash', 'jq'].find((o) => !chemin(o));
const saut = !strict && manquant ? `${manquant} absent` : false;
const exigerOutils = () => assert.equal(manquant, undefined, `${manquant} absent, alors que TIRELIRE_STRICT rend l'outil obligatoire`);

// ─── Lecture du YAML (le sous-ensemble des workflows) ───────────────────────────────────────────

function scalaire(brut) {
  let s = brut.trim();
  if (s.startsWith("'")) return s.match(/^'((?:[^']|'')*)'/)[1].replace(/''/g, "'");
  if (s.startsWith('"')) return JSON.parse(`"${s.match(/^"((?:[^"\\]|\\.)*)"/)[1]}"`);
  s = s.replace(/(^|\s)#.*$/, '').trim();
  const liste = (x) => x.slice(1, -1).split(',').map((e) => e.trim()).filter(Boolean);
  if (s.startsWith('[')) return liste(s).map(scalaire);
  if (s.startsWith('{')) return Object.fromEntries(liste(s).map((e) => [scalaire(e.slice(0, e.indexOf(':'))), scalaire(e.slice(e.indexOf(':') + 1))]));
  if (s === 'true' || s === 'false') return s === 'true';
  if (s === '' || s === 'null' || s === '~') return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
}

function lireYaml(texte) {
  const l = texte.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const retrait = (x) => x.match(/^ */)[0].length;
  const tiret = (x) => /^-(\s|$)/.test(x);
  const cle = /^('[^']*'|"[^"]*"|[^'"\s][^:]*?):(?=\s|$)\s*(.*)$/;
  const sauter = () => {
    while (i < l.length && /^\s*(#.*)?$/.test(l[i])) i += 1;
  };
  const noeud = () => {
    sauter();
    if (i >= l.length) return null;
    const r = retrait(l[i]);
    return tiret(l[i].slice(r)) ? suite(r) : table(r);
  };
  function table(n) {
    const objet = {};
    for (sauter(); i < l.length; sauter()) {
      const r = retrait(l[i]);
      const t = l[i].slice(n);
      if (r < n || tiret(t)) break;
      const m = r === n && t.match(cle);
      if (!m) throw new Error(`YAML non lu par le harnais, ligne ${i + 1} : « ${l[i].trim()} »`);
      const k = scalaire(m[1]);
      const v = m[2];
      i += 1;
      if (v === '' || v.startsWith('#')) {
        sauter();
        const suivant = i < l.length ? l[i] : '';
        objet[k] = retrait(suivant) > n || (retrait(suivant) === n && tiret(suivant.slice(n))) ? noeud() : null;
      } else if (/^[|>][+-]?\s*(#.*)?$/.test(v)) {
        const bloc = [];
        while (i < l.length && (!l[i].trim() || retrait(l[i]) > n)) bloc.push(l[i++]);
        while (bloc.length && !bloc.at(-1).trim()) bloc.pop();
        const base = Math.min(...bloc.filter((x) => x.trim()).map(retrait));
        const lignes = bloc.map((x) => x.slice(base));
        objet[k] = (v.startsWith('>') ? lignes.join(' ') : lignes.join('\n')) + (v[1] === '-' ? '' : '\n');
      } else objet[k] = scalaire(v);
    }
    return objet;
  }
  function suite(n) {
    const liste = [];
    for (sauter(); i < l.length && retrait(l[i]) === n && tiret(l[i].slice(n)); sauter()) {
      const reste = l[i].slice(n + 1);
      const decal = n + 1 + retrait(reste);
      const contenu = reste.trimStart();
      if (!contenu || contenu.startsWith('#')) {
        i += 1;
        liste.push(noeud());
      } else if (cle.test(contenu) && !/^[[{]/.test(contenu)) {
        l[i] = ' '.repeat(decal) + contenu;
        liste.push(table(decal));
      } else {
        liste.push(scalaire(contenu));
        i += 1;
      }
    }
    return liste;
  }
  return noeud() ?? {};
}

// ─── Expressions ────────────────────────────────────────────────────────────────────────────────

function evaluer(expression, ctx, etat = { echec: false }) {
  let e = String(expression).trim();
  const m = e.match(/^\$\{\{([\s\S]*)\}\}$/);
  if (m) e = m[1];
  if (/\b(needs|matrix|strategy|hashFiles)\b/.test(e)) throw new Error(`expression non lue par le harnais : ${e}`);
  const js = e.replace(
    /'((?:[^']|'')*)'|\b(github|env|secrets|steps|job|runner|vars|inputs)((?:\.[A-Za-z_*][\w-]*)*)/g,
    (_, chaine, racine, suite) => (chaine !== undefined ? JSON.stringify(chaine.replace(/''/g, "'")) : `__v(${JSON.stringify(racine + suite)})`),
  );
  const v = (p) => {
    const [racine, ...parties] = p.split('.');
    return parties.reduce((o, k) => {
      if (o == null) return null;
      if (k === '*') return Array.isArray(o) ? o : Object.values(o);
      return Array.isArray(o) && !/^\d+$/.test(k) ? o.map((x) => x?.[k]) : o[k];
    }, ctx[racine]);
  };
  const bas = (x) => String(x ?? '').toLowerCase();
  const fonctions = {
    success: () => !etat.echec,
    failure: () => etat.echec,
    always: () => true,
    cancelled: () => false,
    contains: (a, b) => (Array.isArray(a) ? a.some((x) => bas(x) === bas(b)) : bas(a).includes(bas(b))),
    startsWith: (a, b) => bas(a).startsWith(bas(b)),
    endsWith: (a, b) => bas(a).endsWith(bas(b)),
    format: (f, ...x) => String(f).replace(/\{(\d+)\}/g, (_, n) => String(x[n] ?? '')),
    join: (a, s = ',') => (Array.isArray(a) ? a.join(s) : String(a ?? '')),
    toJSON: (x) => JSON.stringify(x, null, 2),
    fromJSON: (x) => JSON.parse(x),
  };
  try {
    return new Function('__v', ...Object.keys(fonctions), `return (${js});`)(v, ...Object.values(fonctions));
  } catch (err) {
    throw new Error(`expression non lue par le harnais : ${e} (${err.message})`);
  }
}

const condition = (si, ctx, etat) => {
  if (si === undefined || si === null) return !etat.echec;
  const e = String(si).replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, '$1');
  return Boolean(evaluer(/\b(success|failure|always|cancelled)\s*\(/.test(e) ? e : `success() && (${e})`, ctx, etat));
};
const remplacer = (texte, ctx) => String(texte ?? '').replace(/\$\{\{([\s\S]*?)\}\}/g, (_, e) => {
  const v = evaluer(e, ctx);
  return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
});

// ─── GitHub factice ─────────────────────────────────────────────────────────────────────────────

const sha = (nom) => createHash('sha1').update(nom).digest('hex');
const GRAPHE = { m0: [], h1: ['m0'], c1: ['m0'], h2: ['h1', 'c1'], a1: ['m0'], h3: ['h2', 'a1'], M: ['m0', 'h3'], c2: ['c1'], z1: ['m0'], z2: ['m0'] };

/** Un dépôt : la PR de `feature/x` a reçu c1 (codeur) et a1 (auditeur), puis a été fusionnée en M. */
function depot({ fusionnee = true, sousBranches = {}, teteSupprimee = false, disparues = [], pannes = {} } = {}) {
  const parents = Object.fromEntries(Object.entries(GRAPHE).map(([k, p]) => [sha(k), p.map(sha)]));
  const branches = new Map([['main', sha(fusionnee ? 'M' : 'm0')], [VOISINS[0], sha('z1')], [VOISINS[1], sha('z2')]]);
  if (!teteSupprimee) branches.set(TETE, sha('h3'));
  for (const [nom, commit] of Object.entries(sousBranches)) branches.set(nom, sha(commit));
  const pr = {
    number: NUMERO,
    state: 'closed',
    merged: fusionnee,
    title: 'Le besoin x',
    html_url: `https://github.com/${DEPOT}/pull/${NUMERO}`,
    head: { ref: TETE, sha: sha('h3'), repo: { full_name: DEPOT } },
    base: { ref: 'main', sha: sha('m0'), repo: { full_name: DEPOT } },
    merge_commit_sha: fusionnee ? sha('M') : null,
    merged_at: fusionnee ? '2026-09-16T12:00:00Z' : null,
    labels: [],
  };
  return { parents, branches, pulls: [pr], disparues: new Set(disparues), pannes, appels: [], nonModelises: [] };
}

function ancetres(etat, depart) {
  const vus = new Set();
  const pile = [depart];
  while (pile.length) {
    const s = pile.pop();
    if (!vus.has(s)) vus.add(s), pile.push(...(etat.parents[s] ?? []));
  }
  return vus;
}

function resoudre(etat, ref) {
  const nom = ref.replace(/^[\w.-]+:/, '').replace(/^refs\/heads\//, '');
  if (etat.branches.has(nom)) return etat.branches.get(nom);
  const complet = Object.keys(etat.parents).find((s) => s === ref || (ref.length >= 7 && s.startsWith(ref)));
  return complet ?? null;
}

const PAS_TROUVE = { statut: 404, json: { message: 'Not Found', status: '404' } };

function api(etat, methode, route, requete, corps) {
  const panne = etat.pannes[`${methode} ${route.split('/')[0]}`];
  if (panne) return panne;
  const ref = (nom) => ({ ref: `refs/heads/${nom}`, object: { sha: etat.branches.get(nom), type: 'commit' } });
  let m;
  if (methode === 'GET' && route === 'branches') return { statut: 200, json: [...etat.branches].map(([name, s]) => ({ name, commit: { sha: s } })) };
  if (methode === 'GET' && (m = route.match(/^branches\/(.+)$/)))
    return etat.branches.has(m[1]) ? { statut: 200, json: { name: m[1], commit: { sha: etat.branches.get(m[1]) } } } : { statut: 404, json: { message: 'Branch not found', status: '404' } };
  if (methode === 'GET' && (m = route.match(/^git\/refs?\/heads\/(.+)$/))) {
    if (etat.branches.has(m[1])) return { statut: 200, json: ref(m[1]) };
    const prefixe = route.startsWith('git/refs/') ? [...etat.branches.keys()].filter((b) => b.startsWith(m[1])) : [];
    return prefixe.length ? { statut: 200, json: prefixe.map(ref) } : PAS_TROUVE;
  }
  if (methode === 'GET' && (m = route.match(/^git\/matching-refs\/heads\/(.*)$/)))
    return { statut: 200, json: [...etat.branches.keys()].filter((b) => b.startsWith(m[1])).map(ref) };
  if (methode === 'DELETE' && (m = route.match(/^git\/refs\/heads\/(.+)$/))) {
    const present = etat.branches.has(m[1]) && !etat.disparues.has(m[1]);
    etat.branches.delete(m[1]);
    return present ? { statut: 204, json: null } : { statut: 422, json: { message: 'Reference does not exist', status: '422' } };
  }
  if (methode === 'GET' && (m = route.match(/^compare\/(.+?)\.\.\.(.+)$/))) {
    const [a, b] = [resoudre(etat, m[1]), resoudre(etat, m[2])];
    if (!a || !b) return PAS_TROUVE;
    const [da, db] = [ancetres(etat, a), ancetres(etat, b)];
    const avance = [...db].filter((s) => !da.has(s));
    const retard = [...da].filter((s) => !db.has(s));
    const status = !avance.length && !retard.length ? 'identical' : !avance.length ? 'behind' : !retard.length ? 'ahead' : 'diverged';
    return { statut: 200, json: { status, ahead_by: avance.length, behind_by: retard.length, total_commits: avance.length, commits: avance.map((s) => ({ sha: s })), merge_base_commit: { sha: [...db].find((s) => da.has(s)) } } };
  }
  if (methode === 'GET' && (m = route.match(/^commits\/(.+)$/))) {
    const s = resoudre(etat, m[1]);
    return s ? { statut: 200, json: { sha: s, parents: (etat.parents[s] ?? []).map((p) => ({ sha: p })) } } : { statut: 422, json: { message: `No commit found for SHA: ${m[1]}`, status: '422' } };
  }
  if (methode === 'GET' && route === 'pulls') {
    const etatVoulu = requete.get('state') ?? 'open';
    const tete = requete.get('head')?.replace(/^[\w.-]+:/, '');
    return {
      statut: 200,
      json: etat.pulls.filter((p) => (etatVoulu === 'all' || p.state === etatVoulu) && (!tete || p.head.ref === tete) && (!requete.get('base') || p.base.ref === requete.get('base'))),
    };
  }
  if (methode === 'GET' && (m = route.match(/^pulls\/(\d+)$/))) {
    const p = etat.pulls.find((x) => x.number === Number(m[1]));
    return p ? { statut: 200, json: p } : PAS_TROUVE;
  }
  if (methode === 'POST' && route === 'pulls') {
    const tete = String(corps.head ?? '').replace(/^[\w.-]+:/, '');
    if (!etat.branches.has(tete) || !etat.branches.has(String(corps.base ?? '')) || !corps.title)
      return { statut: 422, json: { message: 'Validation Failed', errors: [{ resource: 'PullRequest', code: 'invalid' }], status: '422' } };
    if (etat.pulls.some((p) => p.state === 'open' && p.head.ref === tete && p.base.ref === corps.base))
      return { statut: 422, json: { message: `Validation Failed: A pull request already exists for ${tete}.`, status: '422' } };
    const number = 100 + etat.pulls.length;
    const p = { number, state: 'open', merged: false, title: corps.title, body: corps.body ?? '', html_url: `https://github.com/${DEPOT}/pull/${number}`, head: { ref: tete, sha: etat.branches.get(tete) }, base: { ref: corps.base } };
    etat.pulls.push(p);
    return { statut: 201, json: p };
  }
  if ((m = route.match(/^issues\/(\d+)\/comments$/))) return methode === 'POST' ? { statut: 201, json: { id: 1, body: corps.body } } : { statut: 200, json: [] };
  return null;
}

/** Une ligne de commande `gh` → ce que le vrai `gh` écrirait et rendrait. */
function gh(etat, args, lireEntree) {
  const sortie = (code, stdout = '', stderr = '', jq = '') => ({ code, stdout, stderr, jq });
  if (args[0] !== 'api') {
    etat.nonModelises.push(`gh ${args.join(' ')}`);
    return sortie(1, '', `gh factice : seule « gh api » est modélisée (appelé : gh ${args[0]}).\n`);
  }
  let methode;
  let cible;
  let jq = '';
  let entree;
  let silencieux = false;
  const champs = {};
  const valeur = (brut, type) => {
    if (!type) return brut;
    if (brut === 'true' || brut === 'false') return brut === 'true';
    if (brut === 'null') return null;
    return /^-?\d+$/.test(brut) ? Number(brut) : brut.startsWith('@') ? readFileSync(brut.slice(1), 'utf8') : brut;
  };
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    const [option, colle] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    const suivant = () => colle ?? args[++i];
    if (option === '-X' || option === '--method') methode = suivant().toUpperCase();
    else if (['-f', '--raw-field', '-F', '--field'].includes(option)) {
      const kv = suivant();
      champs[kv.slice(0, kv.indexOf('='))] = valeur(kv.slice(kv.indexOf('=') + 1), option === '-F' || option === '--field');
    } else if (option === '-q' || option === '--jq') jq = suivant();
    else if (option === '--input') entree = suivant();
    else if (option === '--silent') silencieux = true;
    else if (['-H', '--header', '--hostname', '--cache', '-p', '--preview'].includes(option)) suivant();
    else if (['--paginate', '--slurp', '--verbose'].includes(option)) continue;
    else if (option.startsWith('-')) {
      etat.nonModelises.push(`gh api … ${option}`);
      return sortie(1, '', `gh factice : option « ${option} » non modélisée.\n`);
    } else cible = a;
  }
  const [proprio, nom] = DEPOT.split('/');
  const url = new URL((cible ?? '').replace(/^\//, '').replaceAll('{owner}', proprio).replaceAll('{repo}', nom), 'http://api/');
  let corps = champs;
  if (entree !== undefined) corps = JSON.parse(entree === '-' ? lireEntree() : readFileSync(entree, 'utf8'));
  methode ??= Object.keys(champs).length || entree !== undefined ? 'POST' : 'GET';
  if (methode === 'GET') for (const [k, v] of Object.entries(champs)) url.searchParams.set(k, String(v));
  const chemin = decodeURIComponent(url.pathname.slice(1));
  const prefixe = `repos/${DEPOT}/`;
  const route = chemin.startsWith(prefixe) ? chemin.slice(prefixe.length) : null;
  etat.appels.push({ methode, route: route ?? chemin, corps });
  const r = route !== null ? api(etat, methode, route, url.searchParams, corps) : null;
  if (!r) {
    etat.nonModelises.push(`${methode} ${chemin}`);
    return sortie(1, JSON.stringify(PAS_TROUVE.json), `gh: Not Found (HTTP 404)\n`);
  }
  const texte = r.json === null ? '' : JSON.stringify(r.json);
  if (r.statut >= 400) return sortie(1, texte, `gh: ${r.json.message} (HTTP ${r.statut})\n`);
  return sortie(0, silencieux || !texte ? '' : `${texte}\n`, '', silencieux ? '' : jq);
}

// ─── Exécution du workflow ──────────────────────────────────────────────────────────────────────

const FAUX_GH = (port) => `#!/usr/bin/env bash
# Un seul processus par appel : fichiers écrits et lus par des commandes internes, requête par /dev/tcp.
p="\${TMPDIR:-/tmp}/gh.$$.$RANDOM"
printf '%s\\0' "$@" > "$p.args"
prec=''
for a in "$@"; do
  if [ "$prec" = --input ] && [ "$a" = - ]; then IFS= read -r -d '' e; printf '%s' "$e" > "$p.stdin"; fi
  prec=$a
done
exec 3<>/dev/tcp/127.0.0.1/${port} || { echo "gh factice : GitHub factice injoignable" >&2; exit 97; }
printf 'GET / HTTP/1.0\\r\\nX-Prefixe: %s\\r\\n\\r\\n' "$p" >&3
while IFS= read -r _ <&3; do :; done
exec 3<&-
for f in code stderr jq stdout; do IFS= read -r -d '' "v_$f" < "$p.$f"; done
[ -n "$v_stderr" ] && printf '%s' "$v_stderr" >&2
if [ "$v_code" = 0 ] && [ -n "$v_jq" ]; then jq -r "$v_jq" <<< "$v_stdout" || v_code=$?; else printf '%s' "$v_stdout"; fi
exit "$v_code"
`;
const FAUX_RESEAU = (journal) => `#!/bin/sh
echo "$(basename "$0") $*" >> '${journal}'
echo "$(basename "$0") : refusé par le harnais de #124 (tout appel à GitHub passe par gh api)" >&2
exit 1
`;

function evenement(etat) {
  const pr = etat.pulls[0];
  return { action: 'closed', number: pr.number, pull_request: pr, repository: { full_name: DEPOT, name: DEPOT.split('/')[1], owner: { login: DEPOT.split('/')[0] } }, sender: { login: 'sverley' } };
}

const lireCles = (texte) => {
  const r = {};
  const l = texte.split('\n');
  for (let i = 0; i < l.length; i += 1) {
    const h = l[i].match(/^([^=<]+)<<(.+)$/);
    if (h) {
      const v = [];
      for (i += 1; i < l.length && l[i] !== h[2]; i += 1) v.push(l[i]);
      r[h[1]] = v.join('\n');
    } else if (l[i].indexOf('=') > 0) r[l[i].slice(0, l[i].indexOf('='))] = l[i].slice(l[i].indexOf('=') + 1);
  }
  return r;
};

async function jouer(texteWorkflow, options) {
  const etat = depot(options);
  const dossier = mkdtempSync(join(tmpdir(), 'harnais-124-'));
  const serveur = createServer((req, res) => {
    const p = String(req.headers['x-prefixe']);
    const args = readFileSync(`${p}.args`, 'utf8').split('\0').slice(0, -1);
    const r = gh(etat, args, () => readFileSync(`${p}.stdin`, 'utf8'));
    for (const [f, v] of Object.entries({ code: String(r.code), stdout: r.stdout, stderr: r.stderr, jq: r.jq })) writeFileSync(`${p}.${f}`, v);
    res.end();
    req.resume();
  });
  await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok));
  const reseau = join(dossier, 'reseau.log');
  const faux = join(dossier, 'bin');
  const sorties = [];
  let code = 0;
  try {
    spawnSync('mkdir', ['-p', faux, join(dossier, 'travail'), join(dossier, 'tmp')]);
    const ecrire = (nom, texte) => (writeFileSync(join(faux, nom), texte), chmodSync(join(faux, nom), 0o755));
    ecrire('gh', FAUX_GH(serveur.address().port));
    for (const nom of ['curl', 'wget', 'git']) ecrire(nom, FAUX_RESEAU(reseau));
    const evt = join(dossier, 'evenement.json');
    writeFileSync(evt, JSON.stringify(evenement(etat)));
    writeFileSync(reseau, '');

    const w = lireYaml(texteWorkflow);
    const github = {
      event: evenement(etat), event_name: 'pull_request', repository: DEPOT, repository_owner: DEPOT.split('/')[0], token: 'jeton-factice',
      head_ref: TETE, base_ref: 'main', ref: `refs/pull/${NUMERO}/merge`, sha: etat.pulls[0].merge_commit_sha ?? sha('m0'),
      server_url: 'https://github.com', api_url: 'https://api.github.com', run_id: '1', run_number: '1', actor: 'sverley', workspace: join(dossier, 'travail'),
    };
    const base = {
      PATH: `${faux}:${process.env.PATH}`, HOME: dossier, TMPDIR: join(dossier, 'tmp'), LANG: 'C.UTF-8', CI: 'true', GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: evt, GITHUB_REPOSITORY: DEPOT, GITHUB_REPOSITORY_OWNER: github.repository_owner,
      GITHUB_HEAD_REF: TETE, GITHUB_BASE_REF: 'main', GITHUB_REF: github.ref, GITHUB_SHA: github.sha, GITHUB_WORKSPACE: github.workspace,
      GITHUB_SERVER_URL: github.server_url, GITHUB_API_URL: github.api_url, GITHUB_RUN_ID: '1', RUNNER_TEMP: join(dossier, 'tmp'),
      GITHUB_STEP_SUMMARY: join(dossier, 'resume.md'),
    };
    const ctx = { github, secrets: { GITHUB_TOKEN: 'jeton-factice' }, vars: {}, inputs: {}, runner: { os: 'Linux', temp: base.RUNNER_TEMP } };
    const envDe = (bloc, env) => Object.fromEntries(Object.entries(bloc ?? {}).map(([k, v]) => [k, remplacer(v, { ...ctx, env })]));
    const envW = envDe(w.env, {});
    for (const [nomJob, job] of Object.entries(w.jobs ?? {})) {
      if (job.uses || job.strategy || job.needs) throw new Error(`job ${nomJob} : forme non rejouée par le harnais (uses, strategy ou needs)`);
      const etatJob = { echec: false };
      let env = { ...envW };
      if (!condition(job.if, { ...ctx, env }, etatJob)) continue;
      env = { ...env, ...envDe(job.env, env) };
      const steps = {};
      let accumule = {};
      for (const [n, etape] of (job.steps ?? []).entries()) {
        const ici = { ...ctx, env: { ...env, ...accumule }, steps, job: { status: etatJob.echec ? 'failure' : 'success' } };
        if (etape.uses) {
          if (/^actions\/checkout@/.test(etape.uses)) continue;
          throw new Error(`étape « ${etape.name ?? n} » : uses ${etape.uses} n'est pas rejouée par le harnais`);
        }
        if (!condition(etape.if, ici, etatJob)) continue;
        if (etape.shell && !/^bash\b/.test(etape.shell)) throw new Error(`étape « ${etape.name ?? n} » : shell ${etape.shell} non rejoué par le harnais`);
        const script = join(dossier, `etape-${n}.sh`);
        const fichiers = { GITHUB_OUTPUT: join(dossier, `sortie-${n}`), GITHUB_ENV: join(dossier, `env-${n}`), GITHUB_PATH: join(dossier, `path-${n}`) };
        for (const f of Object.values(fichiers)) writeFileSync(f, '');
        writeFileSync(script, remplacer(etape.run, ici));
        const envEtape = { ...base, ...env, ...accumule, ...envDe(etape.env, ici.env), ...fichiers };
        const r = await new Promise((ok) =>
          execFile('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], { env: envEtape, cwd: github.workspace, timeout: 20000 }, (err, stdout, stderr) =>
            ok({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, sortie: `${stdout}${stderr}` }),
          ),
        );
        sorties.push(`── ${nomJob} · ${etape.name ?? n} (code ${r.code})\n${r.sortie}`);
        if (etape.id) steps[etape.id] = { outputs: lireCles(readFileSync(fichiers.GITHUB_OUTPUT, 'utf8')), outcome: r.code ? 'failure' : 'success' };
        accumule = { ...accumule, ...lireCles(readFileSync(fichiers.GITHUB_ENV, 'utf8')) };
        if (r.code && !etape['continue-on-error']) etatJob.echec = true;
      }
      if (etatJob.echec) code = 1;
    }
  } catch (err) {
    code = 'illisible';
    sorties.push(err.message);
  } finally {
    serveur.close();
  }
  const refusesReseau = readFileSync(reseau, 'utf8').trim();
  rmSync(dossier, { recursive: true, force: true });
  return {
    code,
    sortie: sorties.join('\n'),
    suppressions: etat.appels.filter((a) => a.methode === 'DELETE').map((a) => a.route.replace(/^git\/refs\/heads\//, '')),
    ouvertes: etat.pulls.slice(1),
    branches: etat.branches,
    nonModelises: etat.nonModelises,
    refusesReseau,
  };
}

// ─── Les cas ────────────────────────────────────────────────────────────────────────────────────

const memes = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const reussi = (r) => (r.code === 0 ? [] : [`le job devait réussir, il rend ${r.code}`]);
const echoue = (r) => (r.code !== 0 && r.code !== 'illisible' ? [] : [r.code === 'illisible' ? 'workflow illisible' : 'le job devait échouer, il réussit']);
const supprime = (r, attendu) => (memes(r.suppressions, attendu) ? [] : [`suppressions attendues : [${attendu.join(', ')}] ; demandées : [${r.suppressions.join(', ')}]`]);
const aucunePR = (r) => (r.ouvertes.length ? [`aucune PR ne devait s'ouvrir ; ouvertes : ${r.ouvertes.map((p) => p.head.ref).join(', ')}`] : []);
const voisinsIntacts = (r) => VOISINS.filter((v) => !r.branches.has(v)).map((v) => `la branche voisine ${v} a disparu`);

const CAS = [
  {
    nom: 'fusionnée, deux sous-branches livrées : les deux sont supprimées, les voisines restent',
    options: { sousBranches: { [CODEUR]: 'c1', [AUDITEUR]: 'a1' } },
    attendu: (r) => [...reussi(r), ...supprime(r, [CODEUR, AUDITEUR]), ...aucunePR(r), ...voisinsIntacts(r)],
  },
  {
    nom: 'fusionnée, sans sous-branche : rien à faire, pas d’erreur',
    options: {},
    attendu: (r) => [...reussi(r), ...supprime(r, []), ...aucunePR(r), ...voisinsIntacts(r)],
  },
  {
    nom: 'fusionnée, tête déjà supprimée, une seule sous-branche : elle est supprimée',
    options: { teteSupprimee: true, sousBranches: { [CODEUR]: 'c1' } },
    attendu: (r) => [...reussi(r), ...supprime(r, [CODEUR]), ...aucunePR(r)],
  },
  {
    nom: 'fermée sans fusion : les sous-branches restent, aucune PR',
    options: { fusionnee: false, sousBranches: { [CODEUR]: 'c1', [AUDITEUR]: 'a1' } },
    attendu: (r) => [
      ...reussi(r),
      ...supprime(r, []),
      ...aucunePR(r),
      ...[CODEUR, AUDITEUR].filter((b) => !r.branches.has(b)).map((b) => `${b} a disparu`),
    ],
  },
  {
    nom: 'fusionnée, codeur non intégré : il reste et une PR s’ouvre vers main, l’auditeur est supprimé',
    options: { sousBranches: { [CODEUR]: 'c2', [AUDITEUR]: 'a1' } },
    attendu: (r) => {
      const ecarts = [...reussi(r), ...supprime(r, [AUDITEUR])];
      if (!r.branches.has(CODEUR)) ecarts.push(`${CODEUR} a disparu alors qu'elle porte un commit non intégré`);
      const [pr, ...trop] = r.ouvertes;
      if (!pr || trop.length) ecarts.push(`une PR devait s'ouvrir ; ouvertes : ${r.ouvertes.length}`);
      else {
        if (pr.head.ref !== CODEUR) ecarts.push(`la PR ouverte part de ${pr.head.ref}, pas de ${CODEUR}`);
        if (pr.base.ref !== 'main') ecarts.push(`la PR ouverte vise ${pr.base.ref}, pas la base de la PR fusionnée (main)`);
        if (!`${pr.title}\n${pr.body}`.includes(`#${NUMERO}`)) ecarts.push(`la PR ouverte ne nomme pas #${NUMERO}`);
      }
      return ecarts;
    },
  },
  {
    nom: 'fusionnée, sous-branche disparue entre son examen et sa suppression : pas d’erreur',
    options: { sousBranches: { [CODEUR]: 'c1', [AUDITEUR]: 'a1' }, disparues: [CODEUR] },
    attendu: (r) => [...reussi(r), ...aucunePR(r)],
  },
  {
    nom: 'fusionnée, suppression en panne (HTTP 500) : le job échoue',
    options: { sousBranches: { [CODEUR]: 'c1' }, pannes: { 'DELETE git': { statut: 500, json: { message: 'Server Error', status: '500' } } } },
    attendu: (r) => echoue(r),
  },
  {
    nom: 'fusionnée, ouverture de PR refusée (HTTP 403) : le job échoue',
    options: {
      sousBranches: { [CODEUR]: 'c2' },
      pannes: { 'POST pulls': { statut: 403, json: { message: 'GitHub Actions is not permitted to create or approve pull requests.', status: '403' } } },
    },
    attendu: (r) => echoue(r),
  },
];

async function ecartsDu(texte, cas) {
  const r = await jouer(texte, cas.options);
  const ecarts = cas.attendu(r);
  if (r.nonModelises.length) ecarts.push(`appels non modélisés par le harnais (à signaler en commentaire de la PR) : ${r.nonModelises.join(' ; ')}`);
  if (r.refusesReseau) ecarts.push(`appels réseau hors de gh api, refusés : ${r.refusesReseau.replace(/\n/g, ' ; ')}`);
  return { ecarts, sortie: r.sortie };
}

// ─── Lecture de la structure ────────────────────────────────────────────────────────────────────

function structure(texte) {
  const ecarts = [];
  let w;
  try {
    w = lireYaml(texte);
  } catch (err) {
    return [err.message];
  }
  const on = w.on ?? w[true];
  const declencheurs = typeof on === 'string' ? { [on]: null } : Array.isArray(on) ? Object.fromEntries(on.map((x) => [x, null])) : on ?? {};
  const fermeture = ['pull_request', 'pull_request_target'].some((d) => d in declencheurs && [].concat(declencheurs[d]?.types ?? []).includes('closed'));
  if (!fermeture) ecarts.push('le workflow ne se déclenche pas à la fermeture d’une PR (pull_request, types: [closed])');
  const accorde = (p, cle) => p === 'write-all' || p?.[cle] === 'write';
  const jobs = Object.values(w.jobs ?? {});
  if (!jobs.length) ecarts.push('le workflow n’a aucun job');
  else if (!jobs.some((j) => ['contents', 'pull-requests'].every((c) => accorde(j.permissions ?? w.permissions, c))))
    ecarts.push('aucun job n’a les permissions contents: write et pull-requests: write');
  return ecarts;
}

// ─── Témoins ────────────────────────────────────────────────────────────────────────────────────

const TEMOIN_VERT = `name: Sous-branches

# - \`ranger\` est hors harnais.

on:
  pull_request:
    types: [closed]

permissions:
  contents: write
  pull-requests: write

jobs:
  ranger:
    if: github.event.pull_request.merged == true   # fermée sans fusion : rien
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Ranger les sous-branches
        env:
          GH_TOKEN: \${{ github.token }}
          TETE: \${{ github.event.pull_request.head.ref }}
          SHA: \${{ github.event.pull_request.head.sha }}
          BASE: \${{ github.event.pull_request.base.ref }}
          NUMERO: \${{ github.event.pull_request.number }}
        run: |
          set -euo pipefail
          for role in codeur auditeur; do
            b="$TETE--$role"
            if ! s=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/$b" --jq .object.sha 2>&1); then
              grep -q 'HTTP 404' <<< "$s" && continue
              echo "$s" >&2; exit 1
            fi
            statut=$(gh api "repos/$GITHUB_REPOSITORY/compare/$SHA...$s" --jq .status)
            if [ "$statut" = behind ] || [ "$statut" = identical ]; then
              if ! e=$(gh api --method DELETE "repos/$GITHUB_REPOSITORY/git/refs/heads/$b" 2>&1); then
                grep -q 'HTTP 422' <<< "$e" || { echo "$e" >&2; exit 1; }
              fi
            else
              gh api "repos/$GITHUB_REPOSITORY/pulls" -f head="$b" -f base="$BASE" \\
                -f title="Reste de $b" -f body="Partie non intégrée à #$NUMERO." --jq .html_url
            fi
          done
`;

const remplace = (avant, apres) => {
  assert.ok(TEMOIN_VERT.includes(avant), `témoin : « ${avant} » introuvable dans le témoin vert`);
  return TEMOIN_VERT.replace(avant, apres);
};

const TEMOINS_ROUGES = [
  { nom: 'supprime sans vérifier la fusion', cas: 3, texte: () => remplace('    if: github.event.pull_request.merged == true   # fermée sans fusion : rien\n', '') },
  { nom: 'avale les erreurs de suppression', cas: 6, texte: () => remplace(`grep -q 'HTTP 422' <<< "$e" || { echo "$e" >&2; exit 1; }`, ':') },
  { nom: 'supprime sans examiner le contenu', cas: 4, texte: () => remplace('if [ "$statut" = behind ] || [ "$statut" = identical ]; then', 'if true; then') },
  {
    nom: 'cherche les sous-branches par préfixe',
    cas: 0,
    texte: () =>
      remplace(
        'for role in codeur auditeur; do\n            b="$TETE--$role"',
        `for b in $(gh api "repos/$GITHUB_REPOSITORY/git/matching-refs/heads/$TETE--" --jq '.[].ref | sub("refs/heads/";"")'); do`,
      ),
  },
  { nom: 'ouvre la PR vers la tête fusionnée', cas: 4, texte: () => remplace('-f base="$BASE"', '-f base="$TETE"') },
  { nom: 'ne se déclenche pas à la fermeture', structure: true, texte: () => remplace('types: [closed]', 'types: [opened, synchronize]') },
  { nom: 'n’a pas le droit d’ouvrir une PR', structure: true, texte: () => remplace('  pull-requests: write\n', '') },
];

// ─── Tests ──────────────────────────────────────────────────────────────────────────────────────

const workflow = () => {
  const f = join(RACINE, WORKFLOW);
  assert.ok(existsSync(f), `${WORKFLOW} est absent`);
  return readFileSync(f, 'utf8');
};

describe('#124 · sous-branches rangées à la fusion', { concurrency: true }, () => {
  test(`${WORKFLOW} se déclenche à la fermeture d’une PR et peut supprimer et ouvrir`, () => {
    const ecarts = structure(workflow());
    assert.deepEqual(ecarts, [], ecarts.join('\n'));
  });

  for (const cas of CAS) {
    test(`${WORKFLOW} · ${cas.nom}`, { skip: saut }, async () => {
      exigerOutils();
      const { ecarts, sortie } = await ecartsDu(workflow(), cas);
      assert.deepEqual(ecarts, [], `${ecarts.join('\n')}\n\nSortie du job :\n${sortie}`);
    });
  }
});

describe('#124 · témoins du harnais', { concurrency: true }, () => {
  test('témoin vert : le workflow de référence passe la structure et tous les cas', { skip: saut }, async () => {
    exigerOutils();
    assert.deepEqual(structure(TEMOIN_VERT), []);
    const resultats = await Promise.all(CAS.map((c) => ecartsDu(TEMOIN_VERT, c)));
    const ecarts = resultats.flatMap((r, i) => r.ecarts.map((e) => `${CAS[i].nom} : ${e}\n${r.sortie}`));
    assert.deepEqual(ecarts, [], ecarts.join('\n'));
  });

  for (const t of TEMOINS_ROUGES) {
    test(`témoin rouge : un workflow qui ${t.nom} est refusé`, { skip: !t.structure && saut }, async () => {
      if (t.structure) return assert.notDeepEqual(structure(t.texte()), [], 'la structure cassée devait être refusée');
      exigerOutils();
      const { ecarts } = await ecartsDu(t.texte(), CAS[t.cas]);
      assert.notDeepEqual(ecarts, [], `le cas « ${CAS[t.cas].nom} » devait refuser ce workflow`);
    });
  }

  test('témoin : le lecteur YAML et les expressions lisent les formes courantes', () => {
    const w = lireYaml("on: [push]\nenv:\n  A: 'x # y'\njobs:\n  j:\n    steps:\n      - run: |-\n          echo a\n          echo b\n      -\n        name: n\n");
    assert.deepEqual(w, { on: ['push'], env: { A: 'x # y' }, jobs: { j: { steps: [{ run: 'echo a\necho b' }, { name: 'n' }] } } });
    const ctx = { github: { event: { pull_request: { merged: false, labels: [{ name: 'Besoin' }] } } } };
    assert.equal(condition('github.event.pull_request.merged', ctx, { echec: false }), false);
    assert.equal(condition("${{ contains(github.event.pull_request.labels.*.name, 'besoin') }}", ctx, { echec: false }), true);
    assert.equal(condition('always()', ctx, { echec: true }), true);
  });
});
