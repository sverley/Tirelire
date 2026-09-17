/**
 * Amorçage de #131, écrit par la session d'audit du 17 septembre 2026, avant le codage (D68).
 *
 * #131 (parent #119) : la CI reste le filet final, mais consomme moins de minutes Actions. Réponses
 * du porteur, 17 septembre (fil de #131) : #131 vient après #121 (Q1) ; la protection de `main` est
 * impossible, l'alerte de fusion juge aussi les tests (Q2) ; `verifications.yml` garde son
 * fonctionnement (Q3) ; « Les amorçages ne sont joués que si on touche à la garde et à ce qui est
 * gardé » (Q4) ; pas de mesure (Q5) ; pas de passage planifié, un lancement manuel (Q6).
 *
 * Ce que ce fichier juge, un test par point du « Fait quand » :
 *   1. brouillon : ni tests, ni build, ni installation, ni amorçages, ni site ;
 *   2. PR prête (ouverture, nouveau commit, réouverture, passage « prête ») : typecheck, tests et
 *      build tournent ;
 *   3. amorçages : joués seulement si la PR modifie un fichier absent de
 *      `packages/gardes/chemins-ignores`, liste lue et non recopiée ; aucun déclenchement planifié ;
 *      un lancement manuel les joue ;
 *   4. concurrence : chaque workflow de PR qui reçoit les nouveaux commits annule son run précédent
 *      sur la même PR, sans toucher aux autres PR ni aux autres workflows ; `verifications.yml` n'a
 *      aucun groupe ; un déploiement sur `main` n'est jamais annulé ;
 *   5. vérifications manuelles : ni sur un brouillon, ni sur une édition qui ne change ni le corps
 *      ni la branche cible ;
 *   6. push sur `main` : ni tests ni typecheck ; le site est assemblé, l'APK construit et publié, le
 *      déploiement reste atteignable ;
 *   7. site sur une PR : assemblé depuis le build des tests, sans installation ni build nouveaux ;
 *   8. après la fusion : un seul job, qui lance l'alerte et range les sous-branches ;
 *   9. règles écrites : glossaire, journal des décisions, `CLAUDE.md` et `README.md`.
 * Le reste du point « Alerte de fusion » (tests pas verts) se juge dans `alerte-fusion.test.mjs`.
 *
 * Méthode. Les workflows de la copie du dépôt sont lus (sous-ensemble de YAML) et joués par un
 * simulateur : déclencheurs, conditions `if:` en logique à trois valeurs (vrai, faux, inconnu),
 * `needs`, sorties de jobs, concurrence. Les jobs qui installent, testent, construisent, assemblent
 * ou jouent les amorçages sont rejoués pour de vrai dans une copie git du dépôt, avec un `origin`
 * local (D71) : les étapes `run` qui décident (sorties, `GITHUB_ENV`, identifiant cité) ou qui
 * appellent ces commandes s'exécutent, avec un faux `pnpm` qui les consigne sans les jouer (le build
 * dépose un `dist` factice, l'assembleur tourne pour de vrai). Les actions `upload-artifact` et
 * `download-artifact` sont émulées ; les autres actions passent.
 *
 * Témoins. Une solution fabriquée (workflows et assembleur) passe toutes les règles ; chacune de ses
 * variantes cassées fait échouer la règle visée. Le lecteur de YAML et l'évaluateur d'expressions ont
 * les leurs. Aucune lecture ne compare à la base de la PR (D70).
 *
 * Lectures retenues (consignées dans la PR) : une installation compte comme job lourd sur un
 * brouillon ; « chaque workflow déclenché par une PR » vise ceux qui reçoivent les nouveaux commits
 * (`synchronize`), pas ceux de la seule fermeture ; le push sur `main` publie aussi l'APK (D15) ; le
 * `README.md` suit, comme `CLAUDE.md`.
 *
 * Hors harnais (D62) : une condition ou une expression d'une forme que le simulateur ne sait pas
 * lire (le message le dit) ; les actions tierces, supposées réussir ; les tags `v*` ; les workflows
 * réutilisables ; le préfixe d'adresse d'un site assemblé depuis le build des tests.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { DEPOT, copieDuDepot } from './test/copie-du-depot.mjs';

const RELIRE = "l'amorçage de #131 est à relire";
const WORKFLOWS = '.github/workflows';
const CIBLE = 'sverley/Tirelire';
const LISTE = 'packages/gardes/chemins-ignores';

// ─── Lecture d'un sous-ensemble de YAML ─────────────────────────────────────────────────────────

const CLE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[\w$][\w.$/-]*)\s*:(?:[ ]+(.*))?$/;

function finGuillemet(s) {
  const q = s[0];
  for (let k = 1; k < s.length; k++) {
    if (q === '"' && s[k] === '\\') k++;
    else if (s[k] === q) {
      if (q === "'" && s[k + 1] === "'") k++;
      else return k;
    }
  }
  throw new Error(`guillemet non fermé : ${s}`);
}

function finFlux(s) {
  let profondeur = 0;
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '"' || s[k] === "'") k += finGuillemet(s.slice(k));
    else if (s[k] === '[' || s[k] === '{') profondeur++;
    else if ((s[k] === ']' || s[k] === '}') && --profondeur === 0) return k;
  }
  throw new Error(`collection non fermée : ${s}`);
}

function scalaire(v) {
  if (v.startsWith('"')) return JSON.parse(v.replace(/\\\//g, '/'));
  if (v.startsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('[') || v.startsWith('{')) return flux(v);
  if (/^(true|True|TRUE)$/.test(v)) return true;
  if (/^(false|False|FALSE)$/.test(v)) return false;
  if (/^(null|Null|NULL|~)$/.test(v)) return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function flux(s) {
  let p = 0;
  const blanc = () => {
    while (/\s/.test(s[p] ?? '')) p++;
  };
  function element(arrets) {
    blanc();
    if (s[p] === '[') {
      p++;
      const a = [];
      for (;;) {
        blanc();
        if (s[p] === ']') return p++, a;
        a.push(element(',]'));
        blanc();
        if (s[p] === ',') p++;
      }
    }
    if (s[p] === '{') {
      p++;
      const o = {};
      for (;;) {
        blanc();
        if (s[p] === '}') return p++, o;
        const cle = element(':,}');
        blanc();
        let v = null;
        if (s[p] === ':') {
          p++;
          v = element(',}');
        }
        o[String(cle)] = v;
        blanc();
        if (s[p] === ',') p++;
      }
    }
    if (s[p] === '"' || s[p] === "'") {
      const fin = finGuillemet(s.slice(p));
      const q = s.slice(p, p + fin + 1);
      p += fin + 1;
      return scalaire(q);
    }
    const debut = p;
    while (p < s.length && !arrets.includes(s[p])) p++;
    if (p === debut) throw new Error(`collection illisible : ${s}`);
    return scalaire(s.slice(debut, p).trim());
  }
  return element('');
}

/** Lit un workflow : tables, listes, blocs de texte, collections en ligne, commentaires. */
export function lireYaml(texte) {
  const l = texte.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const renf = (x) => x.length - x.trimStart().length;
  const vide = (x) => x.trim() === '' || /^\s*#/.test(x);
  const suivante = () => {
    while (i < l.length && vide(l[i])) i++;
    return i < l.length ? i : -1;
  };
  const estElement = (x) => /^-(\s|$)/.test(x.trimStart());
  const texteCle = (k) => (/^["']/.test(k) ? scalaire(k) : k);
  const nettoyer = (v) => {
    v = v.trim();
    if (v.startsWith('"') || v.startsWith("'")) return v.slice(0, finGuillemet(v) + 1);
    if (v.startsWith('[') || v.startsWith('{')) return v.slice(0, finFlux(v) + 1);
    const m = v.match(/(^|\s)#/);
    return (m ? v.slice(0, m.index) : v).trim();
  };

  function noeud(min) {
    const j = suivante();
    if (j < 0 || renf(l[j]) < min) return null;
    return estElement(l[j]) ? liste(renf(l[j])) : table(renf(l[j]));
  }
  function table(n) {
    const o = {};
    for (;;) {
      const j = suivante();
      if (j < 0 || renf(l[j]) < n || (renf(l[j]) === n && estElement(l[j]))) return o;
      if (renf(l[j]) > n) throw new Error(`renfoncement inattendu, ligne ${j + 1} : ${l[j].trim()}`);
      const m = l[j].slice(n).match(CLE);
      if (!m) throw new Error(`ligne ${j + 1} illisible : ${l[j].trim()}`);
      i = j + 1;
      o[texteCle(m[1])] = valeur(m[2], n);
    }
  }
  function liste(n) {
    const a = [];
    for (;;) {
      const j = suivante();
      if (j < 0 || renf(l[j]) !== n || !estElement(l[j])) return a;
      const reste = l[j].slice(n + 1);
      const decalage = n + 1 + renf(reste);
      if (reste.trim() === '') {
        i = j + 1;
        a.push(noeud(n + 1));
      } else if (CLE.test(reste.trim())) {
        l[j] = ' '.repeat(decalage) + reste.trim();
        i = j;
        a.push(table(decalage));
      } else {
        i = j + 1;
        a.push(scalaire(nettoyer(reste)));
      }
    }
  }
  function valeur(brut, n) {
    const v = nettoyer(brut ?? '');
    if (v === '') {
      const j = suivante();
      if (j >= 0 && renf(l[j]) === n && estElement(l[j])) return liste(n);
      return noeud(n + 1);
    }
    const bloc = v.match(/^([|>])([+-]?)\d*$/);
    if (bloc) return texteEnBloc(n, bloc[1], bloc[2]);
    return scalaire(v);
  }
  function texteEnBloc(n, style, chomp) {
    const lignes = [];
    while (i < l.length && (l[i].trim() === '' || renf(l[i]) > n)) lignes.push(l[i++]);
    while (lignes.length && lignes.at(-1).trim() === '') lignes.pop();
    if (!lignes.length) return '';
    const retrait = Math.min(...lignes.filter((x) => x.trim()).map(renf));
    const corps = lignes.map((x) => x.slice(retrait));
    const texte = style === '>' ? corps.join(' ').replace(/\s+/g, ' ').trim() : corps.join('\n');
    return chomp === '-' ? texte : `${texte}\n`;
  }

  const racine = noeud(0);
  if (suivante() >= 0) throw new Error(`ligne ${i + 1} illisible : ${l[i].trim()}`);
  return racine ?? {};
}

// ─── Expressions de GitHub Actions, en logique à trois valeurs ──────────────────────────────────

export const INCONNU = Symbol('inconnu');
const DEFAUT = Symbol('défaut');

function lexer(src) {
  const t = [];
  let p = 0;
  while (p < src.length) {
    const c = src[p];
    if (/\s/.test(c)) {
      p++;
      continue;
    }
    const deux = src.slice(p, p + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(deux)) {
      t.push({ op: deux });
      p += 2;
      continue;
    }
    if ('()[],.!<>*'.includes(c)) {
      t.push({ op: c });
      p++;
      continue;
    }
    if (c === "'") {
      let v = '';
      for (p++; ; p++) {
        if (p >= src.length) throw new Error(`chaîne non fermée : ${src}`);
        if (src[p] === "'") {
          if (src[p + 1] !== "'") break;
          p++;
        }
        v += src[p];
      }
      p++;
      t.push({ val: v });
      continue;
    }
    const n = src.slice(p).match(/^-?(?:0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?![\w])/i);
    if (n) {
      t.push({ val: Number(n[0]) });
      p += n[0].length;
      continue;
    }
    const id = src.slice(p).match(/^[A-Za-z_][\w-]*/);
    if (!id) throw new Error(`caractère inattendu « ${c} » dans « ${src} »`);
    t.push({ id: id[0] });
    p += id[0].length;
  }
  return t;
}

const ARBRES = new Map();
function analyser(src) {
  if (ARBRES.has(src)) return ARBRES.get(src);
  const t = lexer(src);
  let p = 0;
  const voir = (op) => t[p]?.op === op;
  const prendre = (op) => {
    if (!voir(op)) throw new Error(`« ${op} » attendu dans « ${src} »`);
    p++;
  };
  const ou = () => {
    let g = et();
    while (voir('||')) p++, (g = { ou: [g, et()] });
    return g;
  };
  const et = () => {
    let g = egal();
    while (voir('&&')) p++, (g = { et: [g, egal()] });
    return g;
  };
  const egal = () => {
    let g = compare();
    while (voir('==') || voir('!=')) g = { cmp: t[p++].op, g, d: compare() };
    return g;
  };
  const compare = () => {
    let g = unaire();
    while (['<', '<=', '>', '>='].some(voir)) g = { cmp: t[p++].op, g, d: unaire() };
    return g;
  };
  const unaire = () => (voir('!') ? (p++, { non: unaire() }) : suffixe());
  function suffixe() {
    let g = primaire();
    for (;;) {
      if (voir('.')) {
        p++;
        if (voir('*')) {
          p++;
          g = { etoile: g };
          continue;
        }
        const x = t[p++];
        if (!x?.id) throw new Error(`propriété attendue dans « ${src} »`);
        g = { prop: g, nom: x.id };
      } else if (voir('[')) {
        p++;
        const index = ou();
        prendre(']');
        g = { dans: g, index };
      } else return g;
    }
  }
  function primaire() {
    const x = t[p++];
    if (!x) throw new Error(`expression incomplète : « ${src} »`);
    if ('val' in x) return { lit: x.val };
    if (x.op === '(') {
      const e = ou();
      prendre(')');
      return e;
    }
    if (!x.id) throw new Error(`jeton inattendu dans « ${src} »`);
    const bas = x.id.toLowerCase();
    if (bas === 'true' || bas === 'false') return { lit: bas === 'true' };
    if (bas === 'null') return { lit: null };
    if (!voir('(')) return { racine: bas };
    p++;
    const args = [];
    while (!voir(')')) {
      args.push(ou());
      if (voir(',')) p++;
      else break;
    }
    prendre(')');
    return { appel: bas, args };
  }
  const arbre = ou();
  if (p !== t.length) throw new Error(`fin inattendue dans « ${src} »`);
  ARBRES.set(src, arbre);
  return arbre;
}

const vrai = (v) => (v === INCONNU ? INCONNU : !(v === false || v === 0 || v === '' || v === null || v === undefined || Number.isNaN(v)));
const nombre = (v) => (v === null || v === undefined ? 0 : typeof v === 'boolean' ? Number(v) : typeof v === 'number' ? v : typeof v === 'string' ? (v.trim() === '' ? 0 : Number(v)) : NaN);
const enTexte = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function egaux(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if ((a !== null && typeof a === 'object') || (b !== null && typeof b === 'object')) return a === b;
  if (typeof a === typeof b) return a === b;
  return nombre(a) === nombre(b);
}

function propriete(o, nom) {
  if (o === INCONNU) return INCONNU;
  if (o === null || typeof o !== 'object') return null;
  if (Array.isArray(o)) return typeof nom === 'number' ? (o[nom] ?? null) : null;
  const cle = Object.keys(o).find((k) => k.toLowerCase() === String(nom).toLowerCase());
  return cle === undefined ? (o[DEFAUT] ?? null) : o[cle];
}

function appeler(nom, args, ctx) {
  const statut = ctx.statut ?? {};
  if (nom === 'success') return statut.succes ?? true;
  if (nom === 'failure') return statut.echec ?? false;
  if (nom === 'cancelled') return false;
  if (nom === 'always') return true;
  if (nom === 'hashfiles') return INCONNU;
  if (args.includes(INCONNU)) return INCONNU;
  const [a, b] = args;
  switch (nom) {
    case 'contains':
      return Array.isArray(a) ? a.some((x) => egaux(x, b)) : enTexte(a).toLowerCase().includes(enTexte(b).toLowerCase());
    case 'startswith':
      return enTexte(a).toLowerCase().startsWith(enTexte(b).toLowerCase());
    case 'endswith':
      return enTexte(a).toLowerCase().endsWith(enTexte(b).toLowerCase());
    case 'format':
      return enTexte(a).replace(/\{(\d+)\}/g, (_, k) => enTexte(args[Number(k) + 1]));
    case 'join':
      return Array.isArray(a) ? a.map(enTexte).join(args.length > 1 ? enTexte(b) : ',') : enTexte(a);
    case 'tojson':
      return JSON.stringify(a);
    case 'fromjson':
      try {
        return JSON.parse(enTexte(a));
      } catch {
        return INCONNU;
      }
    default:
      throw new Error(`fonction inconnue : ${nom}()`);
  }
}

function valeurDe(n, ctx) {
  if ('lit' in n) return n.lit;
  if (n.racine) return propriete(ctx.racines, n.racine);
  if (n.prop) return propriete(valeurDe(n.prop, ctx), n.nom);
  if (n.dans) {
    const o = valeurDe(n.dans, ctx);
    const k = valeurDe(n.index, ctx);
    return k === INCONNU ? INCONNU : propriete(o, Array.isArray(o) ? nombre(k) : k);
  }
  if (n.etoile) return INCONNU;
  if (n.non) {
    const v = vrai(valeurDe(n.non, ctx));
    return v === INCONNU ? INCONNU : !v;
  }
  if (n.et || n.ou) {
    const [g, d] = n.et ?? n.ou;
    const a = valeurDe(g, ctx);
    const va = vrai(a);
    const arret = !!n.ou;
    if (va === arret) return a;
    const b = valeurDe(d, ctx);
    if (va !== INCONNU) return b;
    return vrai(b) === arret ? b : INCONNU;
  }
  if (n.cmp) {
    const a = valeurDe(n.g, ctx);
    const b = valeurDe(n.d, ctx);
    if (a === INCONNU || b === INCONNU) return INCONNU;
    if (n.cmp === '==') return egaux(a, b);
    if (n.cmp === '!=') return !egaux(a, b);
    const [x, y] = typeof a === 'string' && typeof b === 'string' ? [a.toLowerCase(), b.toLowerCase()] : [nombre(a), nombre(b)];
    return { '<': x < y, '<=': x <= y, '>': x > y, '>=': x >= y }[n.cmp];
  }
  if (n.appel) return appeler(n.appel, n.args.map((x) => valeurDe(x, ctx)), ctx);
  throw new Error(`nœud inconnu : ${RELIRE}`);
}

export const evaluer = (src, ctx) => valeurDe(analyser(src), ctx);
const SEULE = /^\s*\$\{\{([\s\S]*?)\}\}\s*$/;

/** Une valeur de workflow, expressions `${{ }}` remplacées ; `INCONNU` si l'une ne se lit pas. */
export function interpoler(v, ctx) {
  if (typeof v !== 'string') return v;
  const seule = v.match(SEULE);
  if (seule) return evaluer(seule[1], ctx);
  let inconnu = false;
  const r = v.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, e) => {
    const x = evaluer(e, ctx);
    if (x === INCONNU) inconnu = true;
    return x === INCONNU ? '' : enTexte(x);
  });
  return inconnu ? INCONNU : r;
}

/** Un booléen de workflow : `true`, `'false'`, ou `${{ }}`. */
export function booleen(v, ctx) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'boolean') return v;
  const x = interpoler(String(v), ctx);
  if (x === INCONNU) return INCONNU;
  return typeof x === 'string' ? x.trim().toLowerCase() === 'true' : vrai(x);
}

const STATUT = /\b(success|failure|always|cancelled)\s*\(/i;

/** Une condition `if:` : vrai, faux ou `INCONNU`, `success()` sous-entendu comme sur GitHub. */
export function condition(si, ctx) {
  if (si === undefined || si === null || si === '') return vrai(appeler('success', [], ctx));
  let src = String(si);
  const seule = src.match(SEULE);
  if (seule) src = seule[1];
  else if (src.includes('${{')) return vrai(interpoler(src, ctx));
  if (!STATUT.test(src)) src = `success() && (${src})`;
  return vrai(evaluer(src, ctx));
}

// ─── Modèle d'un workflow ───────────────────────────────────────────────────────────────────────

const listeDe = (v) => (v === undefined || v === null ? null : Array.isArray(v) ? v.map(String) : [String(v)]);

function motifEnRegex(motif) {
  let r = '';
  for (let k = 0; k < motif.length; k++) {
    const c = motif[k];
    if (c === '*' && motif[k + 1] === '*') {
      k++;
      if (motif[k + 1] === '/') {
        k++;
        r += '(?:.*/)?';
      } else r += '.*';
    } else if (c === '*') r += '[^/]*';
    else if (c === '?') r += '[^/]';
    else r += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${r}$`);
}

/** Filtre de GitHub : le dernier motif qui correspond l'emporte, `!` l'inverse. */
function retenu(motifs, valeur) {
  let garde = false;
  for (const m of motifs) {
    const non = m.startsWith('!');
    if (motifEnRegex(non ? m.slice(1) : m).test(valeur)) garde = !non;
  }
  return garde;
}

export function declencheurs(wf) {
  const on = wf.on;
  if (typeof on === 'string') return { [on]: {} };
  if (Array.isArray(on)) return Object.fromEntries(on.map((e) => [e, {}]));
  return Object.fromEntries(Object.entries(on ?? {}).map(([k, v]) => [k, v ?? {}]));
}

const TYPES_PR = ['opened', 'synchronize', 'reopened'];
export const typesPR = (wf) => listeDe(declencheurs(wf).pull_request?.types) ?? (declencheurs(wf).pull_request ? TYPES_PR : []);

export function seDeclenche(wf, sc) {
  const d = declencheurs(wf)[sc.evenement];
  if (d === undefined) return false;
  if (sc.evenement === 'pull_request') {
    if (!(listeDe(d.types) ?? TYPES_PR).includes(sc.action)) return false;
    if (d.branches && !retenu(listeDe(d.branches), 'main')) return false;
    if (d['branches-ignore'] && retenu(listeDe(d['branches-ignore']), 'main')) return false;
  }
  if (sc.evenement === 'push') {
    const tag = sc.ref.startsWith('refs/tags/');
    const nom = sc.ref.replace(/^refs\/(heads|tags)\//, '');
    const [oui, non] = tag ? [d.tags, d['tags-ignore']] : [d.branches, d['branches-ignore']];
    const [autreOui, autreNon] = tag ? [d.branches, d['branches-ignore']] : [d.tags, d['tags-ignore']];
    if (!oui && !non && (autreOui || autreNon)) return false;
    if (oui && !retenu(listeDe(oui), nom)) return false;
    if (non && retenu(listeDe(non), nom)) return false;
  }
  if (sc.evenement !== 'workflow_dispatch' && (d.paths || d['paths-ignore'])) {
    const f = sc.fichiers ?? [];
    if (d.paths && !f.some((x) => retenu(listeDe(d.paths), x))) return false;
    if (d['paths-ignore'] && f.every((x) => retenu(listeDe(d['paths-ignore']), x))) return false;
  }
  return true;
}

const OPTIONS_A_VALEUR = ['--filter', '-F', '-C', '--dir', '--reporter', '--workspace-root', '--loglevel'];

/** Ce que fait un appel de pnpm, options retirées : install, test, typecheck, build, amorcage, assembler… */
function sousCommande(mots) {
  const reste = [];
  for (let k = 0; k < mots.length; k++) {
    if (OPTIONS_A_VALEUR.includes(mots[k])) k++;
    else if (!mots[k].startsWith('-')) reste.push(mots[k]);
  }
  if (reste[0] === 'run' || reste[0] === 'run-script') reste.shift();
  if (reste[0] === 'exec' || reste[0] === 'dlx') reste.shift();
  if (reste[0] === 'vite') return reste[1] === 'build' ? 'build' : 'vite';
  const alias = { i: 'install', add: 'install', t: 'test' };
  return alias[reste[0]] ?? reste[0] ?? '';
}

const LOURDES = ['install', 'test', 'typecheck', 'build', 'amorcage', 'assembler'];

/** Les catégories d'une étape, lues dans son texte. */
export function categories(etape) {
  const c = new Set();
  if (etape.uses) {
    const nom = String(etape.uses).split('@')[0].toLowerCase();
    if (nom.endsWith('action-gh-release')) c.add('publication');
    return c;
  }
  const texte = String(etape.run ?? '')
    .split('\n')
    .filter((x) => !/^\s*#/.test(x))
    .join('\n');
  for (const m of texte.matchAll(/(?:^|[\s;&|(`])pnpm((?:[ \t]+[^\s;&|()`]+)*)/g)) {
    const s = sousCommande(m[1].trim().split(/[ \t]+/).filter(Boolean));
    if (LOURDES.includes(s)) c.add(s);
  }
  if (/\bvite\s+build\b/.test(texte)) c.add('build');
  if (/\bassembler\.mjs\b/.test(texte)) c.add('assembler');
  if (/\bgradlew\b/.test(texte)) c.add('apk');
  if (/\bdeposer\.sh\b/.test(texte)) c.add('depot');
  if (/cli\.mjs\s+pr\b/.test(texte)) c.add('verifications');
  if (/cli\.mjs\s+alerte\b/.test(texte)) c.add('alerte');
  return c;
}

const etapesDe = (job) => (Array.isArray(job?.steps) ? job.steps : []);
const categoriesDuJob = (job) => new Set(etapesDe(job).flatMap((e) => [...categories(e)]));

// ─── Faux outils et dépôt d'essai ───────────────────────────────────────────────────────────────

const temporaires = [];
after(() => {
  for (const d of temporaires) rmSync(d, { recursive: true, force: true });
});
const dossierTemporaire = (nom) => {
  const d = mkdtempSync(join(tmpdir(), `tirelire-131-${nom}-`));
  temporaires.push(d);
  return d;
};

const ENV_PROPRE = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^(GITHUB_|GIT_|RUNNER_|TIRELIRE_)/.test(k) && !['NODE_TEST_CONTEXT', 'CI', 'NODE_OPTIONS'].includes(k)),
);
const PNPM_REEL = spawnSync('bash', ['-c', 'command -v pnpm'], { encoding: 'utf8', env: ENV_PROPRE }).stdout.trim();

const FAUX_PNPM = `#!/usr/bin/env node
const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const OPTIONS_A_VALEUR = ${JSON.stringify(OPTIONS_A_VALEUR)};
const sousCommande = ${sousCommande.toString()};
const mots = process.argv.slice(2);
const sous = sousCommande(mots);
appendFileSync(process.env.JOURNAL_131, JSON.stringify({ outil: 'pnpm', mots, sous, etape: process.env.ETAPE_131 || '' }) + '\\n');
const racine = process.env.GITHUB_WORKSPACE;
if (sous === 'build') {
  const dist = mots.includes('vite') ? join(process.cwd(), 'dist') : join(racine, 'apps/web/dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!-- build simulé : ' + (process.env.ETAPE_131 || '') + ' -->\\n');
  process.exit(0);
}
if (sous === 'assembler') {
  const r = spawnSync(process.execPath, ['assembler.mjs'], { cwd: join(racine, 'apps/hebergement'), stdio: 'inherit', env: process.env });
  process.exit(r.status ?? 1);
}
if (['install', 'test', 'typecheck', 'amorcage', 'crochets'].includes(sous)) process.exit(0);
if (!process.env.PNPM_REEL_131) {
  console.error('pnpm ' + mots.join(' ') + " : appel que l'amorçage de #131 ne sait pas rejouer");
  process.exit(1);
}
process.exit(spawnSync(process.env.PNPM_REEL_131, mots, { stdio: 'inherit' }).status ?? 1);
`;

const FAUX_NPX = `#!/usr/bin/env bash
printf '{"outil":"npx","mots":["%s"],"sous":"%s","etape":"%s"}\\n' "$*" "$([[ " $* " == *" vite build "* ]] && echo build || echo npx)" "$ETAPE_131" >> "$JOURNAL_131"
if [[ " $* " == *" vite build "* ]]; then mkdir -p dist && echo '<!-- build simulé -->' > dist/index.html; fi
exit 0
`;
const FAUX_OUTIL = (nom, code) => `#!/usr/bin/env bash
printf '{"outil":"${nom}","sous":"${nom}","etape":"%s"}\\n' "$ETAPE_131" >> "$JOURNAL_131"
${code ? `echo "${nom} : sortie refusée par l'amorçage de #131 (D71)" >&2` : ''}
exit ${code}
`;

let outils;
function fauxOutils() {
  if (outils) return outils;
  outils = dossierTemporaire('outils');
  const fichiers = { pnpm: FAUX_PNPM, npx: FAUX_NPX, sudo: FAUX_OUTIL('sudo', 0), gh: FAUX_OUTIL('gh', 1), curl: FAUX_OUTIL('curl', 1), wget: FAUX_OUTIL('wget', 1) };
  for (const [nom, texte] of Object.entries(fichiers)) {
    writeFileSync(join(outils, nom), texte);
    chmodSync(join(outils, nom), 0o755);
  }
  return outils;
}

/** Une copie git du dépôt, avec un `origin` nu et local. */
function depotEssai() {
  const racine = copieDuDepot();
  const git = (...a) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...a], {
      cwd: racine,
      env: { ...ENV_PROPRE, GIT_AUTHOR_NAME: 'audit', GIT_AUTHOR_EMAIL: 'audit@tirelire', GIT_COMMITTER_NAME: 'audit', GIT_COMMITTER_EMAIL: 'audit@tirelire' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const origine = dossierTemporaire('origine');
  execFileSync('git', ['init', '-q', '--bare', origine]);
  git('remote', 'add', 'origin', origine);
  git('push', '-q', 'origin', 'main');
  git('fetch', '-q', 'origin');
  return { racine, git, main: git('rev-parse', 'HEAD'), n: 0 };
}

// Copié au chargement : une copie créée dans un test serait effacée à la fin de ce test.
const DEPOT_ESSAI = depotEssai();
const depotPartage = () => DEPOT_ESSAI;

const depotCharge = (sc) => ({ ...sc.charge, repository: { full_name: CIBLE, default_branch: 'main' }, sender: { login: 'sverley', type: 'User' } });

/**
 * Une PR de la branche `essai-131` vers `main`, extraite comme GitHub le fait : la fusion de la tête
 * dans la base. `liste` remplace `chemins-ignores` dans la base.
 */
export function scenarioPR(d, { fichiers = { 'docs/essai-131.md': 'essai\n' }, liste, action = 'synchronize', draft = false, changes, numero = 131, preparer = true } = {}) {
  const pr = (base, tete) => ({ number: numero, draft, state: 'open', merged: false, title: 'Essai', head: { ref: `essai-${numero}`, sha: tete }, base: { ref: 'main', sha: base } });
  const sc = { evenement: 'pull_request', action, ref: `refs/pull/${numero}/merge`, base: 'main', tete: `essai-${numero}`, fichiers: Object.keys(fichiers) };
  if (!preparer) return { ...sc, sha: 'f'.repeat(40), charge: { action, number: numero, pull_request: pr('b'.repeat(40), 'e'.repeat(40)), ...(changes ? { changes } : {}) } };
  const n = ++d.n;
  d.git('checkout', '-q', '-f', '--detach', d.main);
  d.git('clean', '-qfdx');
  if (liste !== undefined) {
    writeFileSync(join(d.racine, LISTE), liste);
    d.git('commit', '-q', '-am', 'liste');
  }
  const base = d.git('rev-parse', 'HEAD');
  d.git('checkout', '-q', '-b', `essai-${n}`);
  for (const [f, c] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(d.racine, f)), { recursive: true });
    writeFileSync(join(d.racine, f), c);
  }
  d.git('add', '-A');
  d.git('commit', '-q', '-m', 'essai');
  const tete = d.git('rev-parse', 'HEAD');
  d.git('checkout', '-q', '--detach', base);
  d.git('merge', '-q', '--no-ff', '--no-edit', tete);
  const fusion = d.git('rev-parse', 'HEAD');
  d.git('push', '-q', '-f', 'origin', `${base}:refs/heads/main`, `${tete}:refs/heads/essai-${numero}`);
  d.git('fetch', '-q', '--prune', 'origin');
  return { ...sc, sha: fusion, charge: { action, number: numero, pull_request: pr(base, tete), ...(changes ? { changes } : {}) } };
}

export function scenarioPush(d, { preparer = true } = {}) {
  let sha = 'a'.repeat(40);
  if (preparer) {
    d.git('checkout', '-q', '-f', '--detach', d.main);
    d.git('clean', '-qfdx');
    d.git('push', '-q', '-f', 'origin', `${d.main}:refs/heads/main`);
    sha = d.main;
  }
  const commit = { id: sha, message: 'Merge pull request #131', author: { name: 'sverley', username: 'sverley' } };
  return {
    evenement: 'push',
    ref: 'refs/heads/main',
    sha,
    fichiers: ['apps/web/src/essai.ts', 'docs/essai-131.md'],
    charge: { ref: 'refs/heads/main', before: '0'.repeat(40), after: sha, created: false, deleted: false, forced: false, commits: [commit], head_commit: commit, pusher: { name: 'sverley' } },
  };
}

export function scenarioManuel(d, { preparer = true } = {}) {
  const sc = scenarioPush(d, { preparer });
  return { evenement: 'workflow_dispatch', ref: 'refs/heads/main', sha: sc.sha, fichiers: [], charge: { ref: 'refs/heads/main', inputs: {} } };
}

export function scenarioFermeture({ fusionnee = true } = {}) {
  const pr = { number: 131, draft: false, state: 'closed', merged: fusionnee, title: 'Essai', head: { ref: 'essai-131', sha: 'e'.repeat(40) }, base: { ref: 'main', sha: 'b'.repeat(40) } };
  return { evenement: 'pull_request', action: 'closed', ref: 'refs/pull/131/merge', base: 'main', tete: 'essai-131', sha: 'f'.repeat(40), fichiers: [], charge: { action: 'closed', number: 131, pull_request: pr } };
}

// ─── Simulation ─────────────────────────────────────────────────────────────────────────────────

function lireCles(texte) {
  const r = {};
  const l = texte.split('\n');
  for (let k = 0; k < l.length; k++) {
    const doc = l[k].match(/^([^=<]+)<<(.+)$/);
    if (doc) {
      const v = [];
      for (k++; k < l.length && l[k] !== doc[2]; k++) v.push(l[k]);
      r[doc[1]] = v.join('\n');
      continue;
    }
    const m = l[k].match(/^([^=]+)=(.*)$/);
    if (m) r[m[1]] = m[2];
  }
  return r;
}

function interpolerTout(objet, ctx, ou) {
  const r = {};
  for (const [k, v] of Object.entries(objet ?? {})) {
    const x = interpoler(typeof v === 'string' ? v : enTexte(v), ctx);
    if (x === INCONNU) throw new Error(`${ou} : la valeur de « ${k} » ne se lit pas (${v}) — ${RELIRE}`);
    r[k] = enTexte(x);
  }
  return r;
}

function ordre(jobs) {
  const vus = new Set();
  const r = [];
  const visiter = (id, pile = []) => {
    if (vus.has(id)) return;
    if (pile.includes(id)) throw new Error(`dépendances circulaires : ${pile.join(' → ')}`);
    for (const b of listeDe(jobs[id]?.needs) ?? []) visiter(b, [...pile, id]);
    vus.add(id);
    r.push(id);
  };
  for (const id of Object.keys(jobs)) visiter(id);
  return r;
}

/**
 * Joue un workflow sur un scénario. Avec `executer`, les jobs qui comptent (installation, tests,
 * build, amorçages, site) et ceux dont ils dépendent sont rejoués dans `racine`.
 */
function jouerWorkflow(racine, fichier, wf, sc, { executer, journal, fraiche }) {
  const jobs = wf.jobs ?? {};
  const aRejouer = new Set();
  if (executer) {
    const ajouter = (id) => {
      if (aRejouer.has(id) || !jobs[id]) return;
      aRejouer.add(id);
      for (const b of listeDe(jobs[id].needs) ?? []) ajouter(b);
    };
    for (const [id, job] of Object.entries(jobs)) if ([...categoriesDuJob(job)].some((c) => LOURDES.includes(c))) ajouter(id);
  }
  const temp = executer ? dossierTemporaire('run') : '/tmp/tirelire-131-sans-execution';
  const inputs = {};
  if (sc.evenement === 'workflow_dispatch') {
    for (const [k, v] of Object.entries(declencheurs(wf).workflow_dispatch?.inputs ?? {})) inputs[k] = v?.default ?? (v?.type === 'boolean' ? false : '');
  }
  const github = {
    event_name: sc.evenement,
    event: depotCharge(sc),
    ref: sc.ref,
    ref_name: sc.evenement === 'pull_request' ? `${sc.charge.number}/merge` : sc.ref.replace(/^refs\/(heads|tags)\//, ''),
    sha: sc.sha,
    base_ref: sc.base ?? '',
    head_ref: sc.tete ?? '',
    repository: CIBLE,
    repository_owner: 'sverley',
    workflow: wf.name ?? fichier,
    run_id: String(sc.run ?? 4242),
    run_number: String(sc.run ?? 4242),
    run_attempt: '1',
    actor: 'sverley',
    token: 'jeton-simule-131',
    server_url: 'https://github.com',
    api_url: 'https://api.github.com',
    workspace: racine,
  };
  const communs = { github, vars: {}, secrets: { [DEFAUT]: '' }, inputs, runner: { temp, os: 'Linux', arch: 'X64', name: 'essai-131' }, [DEFAUT]: INCONNU };
  const artefacts = join(temp, 'artefacts');
  const res = {};
  let n = 0;
  for (const id of ordre(jobs)) {
    const job = jobs[id];
    const besoins = listeDe(job.needs) ?? [];
    const resultats = besoins.map((b) => res[b]?.resultat ?? 'skipped');
    const needs = Object.fromEntries(besoins.map((b) => [b, { result: res[b]?.resultat ?? 'skipped', outputs: res[b]?.sorties ?? {} }]));
    const succes = resultats.every((r) => r === 'success') ? true : resultats.some((r) => r !== INCONNU && r !== 'success') ? false : INCONNU;
    const statutJob = condition(job.if, { racines: { ...communs, needs }, statut: { succes, echec: resultats.includes('failure') } });
    const rejoue = aRejouer.has(id) && statutJob !== false;
    if (rejoue && statutJob === INCONNU) throw new Error(`${fichier} · job « ${id} » : condition illisible pour l'amorçage (${job.if}) — ${RELIRE}`);
    if (rejoue) fraiche();
    const cites = new Set([...JSON.stringify(job).matchAll(/steps\.([\w-]+)/g)].map((m) => m[1]));
    const pas = {};
    const envJob = {};
    const etapes = [];
    let echoue = false;
    let erreur = '';
    for (const [k, etape] of etapesDe(job).entries()) {
      const cats = categories(etape);
      const nom = etape.name ?? etape.uses ?? String(etape.run ?? '').split('\n')[0];
      if (statutJob === false) {
        etapes.push({ nom, cats, statut: false });
        continue;
      }
      const ctx = () => ({ racines: { ...communs, needs, steps: pas, env: { ...envJob }, job: { status: echoue ? 'failure' : 'success' } }, statut: { succes: !echoue, echec: echoue } });
      if (k === 0 && rejoue) Object.assign(envJob, interpolerTout(wf.env, ctx(), `${fichier} · env`), interpolerTout(job.env, ctx(), `${fichier} · ${id} · env`));
      const s = condition(etape.if, ctx());
      const info = { nom, cats, statut: s };
      etapes.push(info);
      if (s === false) {
        if (etape.id) pas[etape.id] = { outcome: 'skipped', conclusion: 'skipped', outputs: {} };
        continue;
      }
      const sensible = ['apk', 'depot', 'alerte', 'verifications'].some((c) => cats.has(c)) || /\bgit\s+push\b/.test(String(etape.run ?? ''));
      const decide = etape.run && !sensible && (/GITHUB_(OUTPUT|ENV)/.test(etape.run) || (etape.id && cites.has(etape.id)) || [...cats].some((c) => LOURDES.includes(c)));
      if (!rejoue || !(etape.uses || decide)) {
        if (etape.id) pas[etape.id] = s === true ? { outcome: 'success', conclusion: 'success', outputs: { [DEFAUT]: INCONNU } } : INCONNU;
        continue;
      }
      if (s === INCONNU) throw new Error(`${fichier} · ${id} · étape « ${nom} » : condition illisible pour l'amorçage (${etape.if}) — ${RELIRE}`);
      const ou = `${fichier} · ${id} · étape « ${nom} »`;
      const avec = interpolerTout(etape.with, ctx(), ou);
      let r;
      if (etape.uses) r = emuler(String(etape.uses), avec, { racine, artefacts });
      else {
        const script = interpoler(etape.run, ctx());
        if (script === INCONNU) throw new Error(`${ou} : le script contient une expression illisible — ${RELIRE}`);
        const coquille = etape.shell ?? job.defaults?.run?.shell ?? wf.defaults?.run?.shell ?? 'bash';
        if (!/^(bash|sh)\b/.test(coquille)) throw new Error(`${ou} : coquille « ${coquille} » non rejouée — ${RELIRE}`);
        const dossier = etape['working-directory'] ?? job.defaults?.run?.['working-directory'] ?? wf.defaults?.run?.['working-directory'] ?? '.';
        const f = (nomF) => join(temp, `${nomF}-${++n}`);
        const [fScript, fSortie, fEnv, fResume] = [f('script'), f('sortie'), f('env'), f('resume')];
        for (const x of [fSortie, fEnv, fResume]) writeFileSync(x, '');
        writeFileSync(fScript, script);
        const p = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', fScript], {
          cwd: resolve(racine, enTexte(interpoler(dossier, ctx()))),
          encoding: 'utf8',
          timeout: 60_000,
          maxBuffer: 16 * 1024 * 1024,
          env: {
            ...ENV_PROPRE,
            PATH: `${fauxOutils()}:${ENV_PROPRE.PATH}`,
            HOME: temp,
            CI: 'true',
            GITHUB_ACTIONS: 'true',
            GITHUB_EVENT_NAME: sc.evenement,
            GITHUB_EVENT_PATH: journal.evenement,
            GITHUB_REF: sc.ref,
            GITHUB_REF_NAME: github.ref_name,
            GITHUB_SHA: sc.sha,
            // Fabriquée pour les étapes rejouées : l'amorçage ne lit pas la base de la PR jugée (D70).
            [['GITHUB', 'BASE', 'REF'].join('_')]: github.base_ref,
            GITHUB_HEAD_REF: github.head_ref,
            GITHUB_REPOSITORY: CIBLE,
            GITHUB_WORKSPACE: racine,
            GITHUB_RUN_ID: github.run_id,
            GITHUB_RUN_NUMBER: github.run_number,
            GITHUB_WORKFLOW: github.workflow,
            GITHUB_OUTPUT: fSortie,
            GITHUB_ENV: fEnv,
            GITHUB_STEP_SUMMARY: fResume,
            RUNNER_TEMP: temp,
            RUNNER_OS: 'Linux',
            JOURNAL_131: journal.fichier,
            ETAPE_131: `${fichier}#${id}#${k}`,
            PNPM_REEL_131: PNPM_REEL,
            ...envJob,
            ...interpolerTout(etape.env, ctx(), ou),
          },
        });
        r = { ok: p.status === 0, sortie: `${p.stdout ?? ''}${p.stderr ?? ''}${p.error ? String(p.error) : ''}`, sorties: lireCles(readFileSync(fSortie, 'utf8')) };
        Object.assign(envJob, lireCles(readFileSync(fEnv, 'utf8')));
      }
      info.issue = r.ok ? 'success' : 'failure';
      const tolere = booleen(etape['continue-on-error'], ctx()) === true;
      if (etape.id) pas[etape.id] = { outcome: info.issue, conclusion: r.ok || tolere ? 'success' : 'failure', outputs: r.sorties ?? {} };
      if (!r.ok && !tolere) {
        echoue = true;
        erreur = `${ou} a échoué :\n${String(r.sortie).trim().split('\n').slice(-15).join('\n')}`;
      }
    }
    if (rejoue && existsSync(join(racine, 'apps/hebergement/dist/index.html'))) journal.site = true;
    const resultat = statutJob === false ? 'skipped' : statutJob === INCONNU ? INCONNU : echoue ? 'failure' : 'success';
    const sorties = {};
    for (const [k, v] of Object.entries(job.outputs ?? {})) {
      sorties[k] = statutJob === false ? '' : rejoue ? interpoler(v, { racines: { ...communs, needs, steps: pas, env: {} } }) : INCONNU;
    }
    res[id] = { id, job, statut: statutJob, resultat, sorties, etapes, rejoue, erreur };
  }
  return res;
}

function emuler(uses, avec, { racine, artefacts }) {
  const nom = uses.split('@')[0].toLowerCase();
  if (nom === 'actions/upload-artifact') {
    const chemins = (avec.path ?? '').split('\n').map((x) => x.trim()).filter(Boolean).map((x) => resolve(racine, x));
    const cible = join(artefacts, avec.name || 'artifact');
    for (const c of chemins.filter(existsSync)) {
      mkdirSync(cible, { recursive: true });
      cpSync(c, statSync(c).isDirectory() && chemins.length === 1 ? cible : join(cible, basename(c)), { recursive: true });
    }
    return { ok: true, sortie: '' };
  }
  if (nom === 'actions/download-artifact') {
    const dest = resolve(racine, avec.path || '.');
    const noms = avec.name ? [avec.name] : existsSync(artefacts) ? readdirSync(artefacts) : [];
    for (const a of noms) {
      if (!existsSync(join(artefacts, a))) return { ok: false, sortie: `artefact « ${a} » introuvable : aucun job de ce run ne l'a déposé` };
      cpSync(join(artefacts, a), avec.name ? dest : join(dest, a), { recursive: true });
    }
    return { ok: true, sortie: '' };
  }
  return { ok: true, sortie: '' };
}

/**
 * Joue tous les workflows de `racine` sur un scénario. `fichiers` remplace des fichiers le temps de la
 * simulation ; s'il contient des workflows, il remplace tout le dossier.
 */
export function simuler(d, sc, { executer = false, fichiers = {} } = {}) {
  const racine = d.racine;
  const sauves = new Map();
  const dossierWf = join(racine, WORKFLOWS);
  const remplaceWf = Object.keys(fichiers).some((f) => f.startsWith(`${WORKFLOWS}/`));
  if (remplaceWf) {
    for (const f of readdirSync(dossierWf)) {
      sauves.set(`${WORKFLOWS}/${f}`, readFileSync(join(dossierWf, f), 'utf8'));
      rmSync(join(dossierWf, f));
    }
  }
  for (const [f, texte] of Object.entries(fichiers)) {
    if (!sauves.has(f)) sauves.set(f, existsSync(join(racine, f)) ? readFileSync(join(racine, f), 'utf8') : null);
    writeFileSync(join(racine, f), texte);
  }
  const temp = dossierTemporaire('journal');
  const journal = { fichier: join(temp, 'journal.jsonl'), evenement: join(temp, 'evenement.json') };
  writeFileSync(journal.fichier, '');
  writeFileSync(journal.evenement, JSON.stringify(depotCharge(sc)));
  const gardes = [...new Set(Object.keys(fichiers).map((f) => (f.startsWith(`${WORKFLOWS}/`) ? WORKFLOWS : f)))];
  /** Chaque job part d'une extraction neuve, comme sur un runner, fichiers du témoin gardés. */
  const fraiche = () => {
    d.git('checkout', '-q', '-f', 'HEAD', '--', '.', ...gardes.map((f) => `:(exclude)${f}`));
    d.git('clean', '-qfdx', ...gardes.flatMap((f) => ['-e', f]));
  };
  try {
    const runs = readdirSync(dossierWf)
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()
      .map((fichier) => {
        const wf = lireYaml(readFileSync(join(dossierWf, fichier), 'utf8'));
        if (!seDeclenche(wf, sc)) return { fichier, wf, declenche: false, jobs: {} };
        return { fichier, wf, declenche: true, jobs: jouerWorkflow(racine, fichier, wf, sc, { executer, journal, fraiche }) };
      });
    const appels = readFileSync(journal.fichier, 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
    return { runs, appels, site: Boolean(journal.site) };
  } finally {
    for (const [f, texte] of sauves) {
      if (texte === null) rmSync(join(racine, f), { force: true });
      else writeFileSync(join(racine, f), texte);
    }
    if (remplaceWf) for (const f of readdirSync(dossierWf)) if (!sauves.has(`${WORKFLOWS}/${f}`) || sauves.get(`${WORKFLOWS}/${f}`) === null) rmSync(join(dossierWf, f));
    if (executer) {
      d.git('checkout', '-q', '-f', 'HEAD', '--', '.');
      d.git('clean', '-qfdx');
    }
  }
}

/** Les étapes qui peuvent tourner, avec leur job et leur workflow. */
function etapesPossibles(sim) {
  const r = [];
  for (const run of sim.runs) {
    for (const j of Object.values(run.jobs)) {
      if (j.statut === false) continue;
      for (const e of j.etapes) if (e.statut !== false) r.push({ ...e, fichier: run.fichier, job: j.id, ou: `${run.fichier} · ${j.id} · « ${e.nom} »` });
    }
  }
  return r;
}

/** Ce qui a vraiment été appelé, ou peut l'être dans un job non rejoué. */
function lourdsPossibles(sim, cats = LOURDES) {
  const r = [];
  for (const a of sim.appels) if (cats.includes(a.sous)) r.push(`${a.etape.replace(/#/g, ' · ')} appelle ${a.outil} ${a.sous}`);
  for (const run of sim.runs) {
    for (const j of Object.values(run.jobs)) {
      if (j.statut === false || j.rejoue) continue;
      for (const e of j.etapes) if (e.statut !== false) for (const c of e.cats) if (cats.includes(c)) r.push(`${run.fichier} · ${j.id} · « ${e.nom} » peut jouer ${c}`);
    }
  }
  return r;
}

const echecs = (sim) => Object.values(sim.runs.flatMap((r) => Object.values(r.jobs))).filter((j) => j.erreur).map((j) => j.erreur);

// ─── Les règles ─────────────────────────────────────────────────────────────────────────────────

const ORGANISATIONNEL = { 'docs/essai-131.md': 'essai\n' };
const FONCTIONNEL = { 'apps/web/src/essai-131.ts': 'export const essai = 131;\n' };

export function reglesBrouillon(d, fichiers) {
  const p = [];
  for (const [action, changes] of [['opened'], ['synchronize'], ['reopened'], ['edited', { body: { from: 'avant' } }]]) {
    const sc = scenarioPR(d, { fichiers: ORGANISATIONNEL, action, draft: true, changes });
    const sim = simuler(d, sc, { executer: true, fichiers });
    p.push(...lourdsPossibles(sim).map((x) => `brouillon (${action}) : ${x}`));
    p.push(...etapesPossibles(sim).filter((e) => e.cats.has('verifications')).map((e) => `brouillon (${action}) : ${e.ou} lance les vérifications manuelles`));
  }
  return p;
}

export function reglesPrete(d, fichiers) {
  const p = [];
  for (const action of ['opened', 'synchronize', 'reopened', 'ready_for_review']) {
    const sim = simuler(d, scenarioPR(d, { preparer: false, action }), { fichiers });
    const possibles = etapesPossibles(sim);
    for (const c of ['typecheck', 'test', 'build']) {
      if (!possibles.some((e) => e.cats.has(c))) p.push(`PR prête (${action}) : aucune étape ne joue ${c}`);
    }
  }
  return p;
}

export function reglesAmorcages(d, fichiers, arret = false) {
  const p = [];
  const dossierWf = join(d.racine, WORKFLOWS);
  const textes = Object.keys(fichiers).some((f) => f.startsWith(WORKFLOWS))
    ? Object.entries(fichiers).filter(([f]) => f.startsWith(WORKFLOWS))
    : readdirSync(dossierWf).map((f) => [f, readFileSync(join(dossierWf, f), 'utf8')]);
  for (const [f, texte] of textes) {
    const wf = lireYaml(texte);
    const joue = Object.values(wf.jobs ?? {}).some((j) => categoriesDuJob(j).has('amorcage'));
    if (joue && declencheurs(wf).schedule) p.push(`${basename(f)} joue les amorçages sur un déclenchement planifié`);
  }
  if (arret && p.length) return p;
  const manuel = simuler(d, scenarioManuel(d), { executer: true, fichiers });
  if (!manuel.appels.some((a) => a.sous === 'amorcage')) p.push(`lancement manuel : les amorçages ne sont pas joués${echecs(manuel).length ? `\n${echecs(manuel).join('\n')}` : ''}`);
  if (arret && p.length) return p;
  const cas = [
    ['fonctionnel', { fichiers: FONCTIONNEL }, false],
    ['organisationnel', { fichiers: ORGANISATIONNEL }, true],
    ['la liste lue : docs/ y est ajouté', { fichiers: ORGANISATIONNEL, liste: 'apps/\npackages/core/\ndocs/\n' }, false],
    ['la liste lue : apps/ en est retiré', { fichiers: FONCTIONNEL, liste: 'packages/core/\n' }, true],
    ['les deux côtés', { fichiers: { ...FONCTIONNEL, ...ORGANISATIONNEL } }, true],
  ];
  for (const [nom, options, attendu] of cas) {
    const actions = nom === 'organisationnel' ? ['synchronize', 'opened', 'reopened', 'ready_for_review'] : ['synchronize'];
    for (const action of actions) {
      const sim = simuler(d, scenarioPR(d, { ...options, action }), { executer: true, fichiers });
      const joue = sim.appels.some((a) => a.sous === 'amorcage');
      if (joue !== attendu) {
        p.push(`PR ${nom} (${action}) : les amorçages ${attendu ? 'ne sont pas joués' : 'sont joués'}${echecs(sim).length ? `\n${echecs(sim).join('\n')}` : ''}`);
        if (arret) return p;
      }
    }
  }
  return p;
}

const groupeDe = (conc) => (conc === undefined || conc === null ? null : typeof conc === 'string' ? { group: conc } : conc);

function concurrences(run, job, ctx) {
  const r = [];
  for (const [niveau, conc] of [['workflow', groupeDe(run.wf.concurrency)], [`job ${job.id}`, groupeDe(job.job.concurrency)]]) {
    if (!conc) continue;
    const groupe = interpoler(enTexte(conc.group), ctx);
    const annule = booleen(conc['cancel-in-progress'], ctx);
    r.push({ niveau, groupe, annule });
  }
  return r;
}

const contexteDe = (sc, wf, fichier) => ({
  racines: {
    github: { event_name: sc.evenement, event: depotCharge(sc), ref: sc.ref, sha: sc.sha, base_ref: sc.base ?? '', head_ref: sc.tete ?? '', workflow: wf.name ?? fichier, run_id: String(sc.run), repository: CIBLE },
    inputs: {},
    vars: {},
    needs: { [DEFAUT]: INCONNU },
    [DEFAUT]: INCONNU,
  },
});

export function reglesConcurrence(d, fichiers) {
  const p = [];
  const deux = [
    { ...scenarioPR(d, { preparer: false, numero: 131 }), sha: '1'.repeat(40), run: 1 },
    { ...scenarioPR(d, { preparer: false, numero: 131 }), sha: '2'.repeat(40), run: 2 },
    { ...scenarioPR(d, { preparer: false, numero: 132 }), sha: '3'.repeat(40), run: 3 },
  ];
  const sims = deux.map((sc) => simuler(d, sc, { fichiers }));
  const groupesParWorkflow = new Map();
  for (const [r, run] of sims[0].runs.entries()) {
    if (!run.declenche) continue;
    const verif = Object.values(run.jobs).some((j) => j.etapes.some((e) => e.cats.has('verifications')));
    const tous = [groupeDe(run.wf.concurrency), ...Object.values(run.jobs).map((j) => groupeDe(j.job.concurrency))].filter(Boolean);
    if (verif) {
      if (tous.length) p.push(`${run.fichier} : les vérifications manuelles ont un groupe de concurrence (Q3 : aucun)`);
      continue;
    }
    for (const j of Object.values(run.jobs)) {
      if (j.statut === false || ![...categoriesDuJob(j.job)].some((c) => LOURDES.includes(c))) continue;
      const lectures = deux.map((sc, k) => concurrences(sims[k].runs[r], sims[k].runs[r].jobs[j.id], contexteDe(sc, run.wf, run.fichier)));
      const annulant = lectures[0].findIndex((x, i) => x.annule === true && x.groupe !== INCONNU && x.groupe === lectures[1][i].groupe && x.groupe !== lectures[2][i].groupe);
      if (annulant < 0) {
        p.push(`${run.fichier} · ${j.id} : un nouveau commit sur la même PR n'annule pas le run précédent (groupe par PR, cancel-in-progress vrai)`);
        continue;
      }
      const g = lectures[0][annulant].groupe;
      if (!groupesParWorkflow.has(g)) groupesParWorkflow.set(g, new Set());
      groupesParWorkflow.get(g).add(run.fichier);
    }
  }
  for (const [g, wfs] of groupesParWorkflow) if (wfs.size > 1) p.push(`le groupe « ${g} » est partagé par ${[...wfs].join(', ')} : l'un annulerait l'autre`);
  const pushs = [
    { ...scenarioPush(d, { preparer: false }), sha: '4'.repeat(40), run: 4 },
    { ...scenarioPush(d, { preparer: false }), sha: '5'.repeat(40), run: 5 },
  ];
  const simsPush = pushs.map((sc) => simuler(d, sc, { fichiers }));
  for (const [r, run] of simsPush[0].runs.entries()) {
    for (const j of Object.values(run.jobs)) {
      if (!categoriesDuJob(j.job).has('depot')) continue;
      const a = concurrences(run, j, contexteDe(pushs[0], run.wf, run.fichier));
      const b = concurrences(simsPush[1].runs[r], simsPush[1].runs[r].jobs[j.id], contexteDe(pushs[1], run.wf, run.fichier));
      for (const [i, x] of a.entries()) {
        if (x.annule !== false && (x.groupe === INCONNU || x.groupe === b[i].groupe)) {
          p.push(`${run.fichier} · ${j.id} : un push sur main pourrait annuler un déploiement en cours (concurrence du ${x.niveau})`);
        }
      }
    }
  }
  return p;
}

export function reglesVerifications(d, fichiers) {
  const p = [];
  const cas = [
    ['brouillon ouvert', { action: 'opened', draft: true }, false],
    ['brouillon, nouveau commit', { action: 'synchronize', draft: true }, false],
    ['brouillon, corps modifié', { action: 'edited', draft: true, changes: { body: { from: 'x' } } }, false],
    ['titre seul modifié', { action: 'edited', changes: { title: { from: 'x' } } }, false],
    ['ouverture', { action: 'opened' }, true],
    ['nouveau commit', { action: 'synchronize' }, true],
    ['réouverture', { action: 'reopened' }, true],
    ['passage « prête »', { action: 'ready_for_review' }, true],
    ['corps modifié', { action: 'edited', changes: { body: { from: 'x' } } }, true],
    ['branche cible modifiée', { action: 'edited', changes: { base: { ref: { from: 'autre' }, sha: { from: 'c'.repeat(40) } } } }, true],
  ];
  for (const [nom, options, attendu] of cas) {
    const sim = simuler(d, scenarioPR(d, { preparer: false, ...options }), { fichiers });
    const lance = etapesPossibles(sim).some((e) => e.cats.has('verifications'));
    if (lance !== attendu) p.push(`${nom} : les vérifications manuelles ${attendu ? 'ne se lancent pas' : 'se lancent'}`);
  }
  return p;
}

export function reglesPush(d, fichiers) {
  const p = [];
  const sim = simuler(d, scenarioPush(d), { executer: true, fichiers });
  p.push(...lourdsPossibles(sim, ['test', 'typecheck', 'amorcage']).map((x) => `push sur main : ${x}`));
  const possibles = etapesPossibles(sim);
  const jobsEchoues = sim.runs.flatMap((r) => Object.values(r.jobs)).filter((j) => j.resultat === 'failure');
  if (!sim.appels.some((a) => a.sous === 'assembler') || !sim.site) p.push(`push sur main : le site n'est pas assemblé${echecs(sim).length ? `\n${echecs(sim).join('\n')}` : ''}`);
  for (const [cat, quoi] of [['apk', "l'APK n'est pas construit"], ['depot', "le déploiement n'est pas atteignable"], ['publication', "l'APK n'est pas publié (D15)"]]) {
    if (!possibles.some((e) => e.cats.has(cat))) p.push(`push sur main : ${quoi}`);
  }
  for (const j of jobsEchoues) if (!p.some((x) => x.includes(j.erreur))) p.push(`push sur main : ${j.erreur}`);
  return p;
}

export function reglesSite(d, fichiers) {
  const p = [];
  const sim = simuler(d, scenarioPR(d, { fichiers: FONCTIONNEL }), { executer: true, fichiers });
  const assemblage = sim.appels.filter((a) => a.sous === 'assembler');
  if (!assemblage.length || !sim.site) {
    p.push(`PR prête : le site n'est pas assemblé${echecs(sim).length ? `\n${echecs(sim).join('\n')}` : ''}`);
    return p;
  }
  for (const a of assemblage) {
    const [fichier, job] = a.etape.split('#');
    const run = sim.runs.find((r) => r.fichier === fichier);
    const avecTests = categoriesDuJob(run.jobs[job].job).has('test');
    const duJob = sim.appels.filter((x) => x.etape.startsWith(`${fichier}#${job}#`));
    for (const c of ['install', 'build']) {
      const n = duJob.filter((x) => x.sous === c).length;
      const permis = avecTests ? 1 : 0;
      if (n > permis) p.push(`PR prête : le job ${fichier} · ${job}, qui assemble le site, joue ${c} ${n} fois${avecTests ? ' (une seule avec les tests)' : ''} : le build des tests n'est pas réutilisé`);
    }
  }
  return p;
}

export function reglesFusion(d, fichiers) {
  const p = [];
  const sim = simuler(d, scenarioFermeture(), { fichiers });
  const jobs = sim.runs.flatMap((r) => Object.values(r.jobs).filter((j) => j.statut !== false).map((j) => ({ ...j, fichier: r.fichier })));
  if (jobs.length !== 1) {
    p.push(`PR fusionnée : ${jobs.length} jobs peuvent tourner (${jobs.map((j) => `${j.fichier} · ${j.id}`).join(', ') || 'aucun'}), un seul attendu`);
    return p;
  }
  const [j] = jobs;
  const possibles = j.etapes.filter((e) => e.statut !== false);
  if (!possibles.some((e) => e.cats.has('alerte'))) p.push(`PR fusionnée : ${j.fichier} · ${j.id} ne lance pas l'alerte de fusion`);
  const texte = etapesDe(j.job)
    .map((e) => String(e.run ?? ''))
    .join('\n');
  const scripts = [...texte.matchAll(/[\w./-]+\.(?:sh|mjs|js)\b/g)].map((m) => m[0]).filter((f) => existsSync(join(d.racine, f)) && !/cli\.mjs$/.test(f));
  const tout = [texte, ...scripts.map((f) => readFileSync(join(d.racine, f), 'utf8'))].join('\n');
  if (!/\bcodeur\b/.test(tout) || !/\bauditeur\b/.test(tout)) p.push(`PR fusionnée : ${j.fichier} · ${j.id} ne range pas les sous-branches --codeur et --auditeur`);
  return p;
}

// ─── Règles écrites ─────────────────────────────────────────────────────────────────────────────

const lireDepot = (f) => readFileSync(join(DEPOT, f), 'utf8');
const aplatir = (t) => t.replace(/\s+/g, ' ');
const DERNIERE_DECISION = 76;
export const PHRASE_PORTEUR = 'Les amorçages ne sont joués que si on touche à la garde et à ce qui est gardé';
const PHRASE_RETIREE = 'Les amorçages sont joués en CI sur chaque PR';
const ANCIENNES = {
  'CLAUDE.md': ['et tourne en CI sur chaque PR', 'tous les harnais et la garde : typecheck, `pnpm test`, build et `pnpm amorcage`'],
  'README.md': ['et en CI sur chaque PR, jamais par `pnpm test`', 'build et amorçages, en mode strict'],
};
const CHAQUE_PR = /amor[cç]ages?\b[^.;]{0,80}\b(?:tourne\w*|jou\w*)\s+en CI sur chaque PR\b(?! prête)/i;

export function entreesDe131(journal) {
  return journal.split(/^(?=## D\d+\b)/m).filter((x) => Number(x.match(/^## D(\d+)\b/)?.[1]) > DERNIERE_DECISION && /#131\b/.test(x));
}

export function reglesEcrites({ glossaire, decisions, claude, readme }) {
  const p = [];
  const g = aplatir(glossaire);
  if (!g.includes(PHRASE_PORTEUR)) p.push(`le glossaire ne porte pas, mot pour mot, la phrase du porteur : « ${PHRASE_PORTEUR} »`);
  if (g.includes(PHRASE_RETIREE)) p.push('le glossaire dit encore que les amorçages sont joués en CI sur chaque PR');
  const entrees = entreesDe131(decisions);
  if (!entrees.length) p.push(`aucune entrée postérieure à D${DERNIERE_DECISION} ne cite #131 dans le journal des décisions`);
  else if (!/\bD74\b/.test(entrees.join('\n'))) p.push("l'entrée de #131 ne nomme pas D74, dont elle remplace un passage");
  const numeros = entrees.map((x) => x.match(/^## (D\d+)\b/)[1]);
  for (const [nom, texte] of [['CLAUDE.md', claude], ['README.md', readme]]) {
    const plat = aplatir(texte);
    if (CHAQUE_PR.test(plat) || ANCIENNES[nom].some((x) => plat.includes(x))) p.push(`${nom} dit encore que les amorçages tournent en CI sur chaque PR`);
  }
  if (numeros.length && !numeros.some((n) => new RegExp(`\\b${n}\\b`).test(claude))) p.push(`CLAUDE.md ne cite pas la décision de #131 (${numeros.join(', ')})`);
  return p;
}

// ─── Solution fabriquée, pour les témoins ───────────────────────────────────────────────────────

const SOLUTION_CI = `name: CI et livraison

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  workflow_dispatch:
    inputs:
      deploiement:
        description: "Dépôt FTP sur l'hébergement"
        type: choice
        options: [automatique, essai-a-blanc, ignorer]
        default: automatique

permissions:
  contents: write

concurrency:
  group: ci-\${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}

jobs:
  test:
    name: Tests et build web
    if: github.event_name == 'pull_request' && !github.event.pull_request.draft
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4 # version lue dans package.json
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - name: Outils des tests
        run: |
          sudo apt-get update -qq
          php -v | head -n 1
      - run: pnpm test
        env:
          TIRELIRE_STRICT: '1'
      - run: pnpm build
      - name: Archiver le site
        uses: actions/upload-artifact@v4
        with:
          name: tirelire-web
          path: apps/web/dist

  hebergement:
    name: Site pour hébergement mutualisé
    needs: test
    if: \${{ !cancelled() && (needs.test.result == 'success' || needs.test.result == 'skipped' && github.event_name != 'pull_request') }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        if: github.event_name != 'pull_request'
      - run: pnpm install --frozen-lockfile
        if: github.event_name != 'pull_request'
      - name: Récupérer le build des tests
        if: github.event_name == 'pull_request'
        uses: actions/download-artifact@v4
        with:
          name: tirelire-web
          path: apps/web/dist
      - name: Assembler
        env:
          TIRELIRE_BASE: \${{ vars.TIRELIRE_BASE || '/' }}
          TIRELIRE_WEB_CONSTRUIT: \${{ github.event_name == 'pull_request' && '1' || '' }}
        run: pnpm --filter @tirelire/hebergement assembler
      - uses: actions/upload-artifact@v4
        with:
          name: tirelire-hebergement
          path: apps/hebergement/tirelire-hebergement.zip

  deploiement:
    name: Dépôt FTP sur l'hébergement
    needs: hebergement
    if: \${{ !cancelled() && needs.hebergement.result == 'success' && github.event_name != 'pull_request' && inputs.deploiement != 'ignorer' }}
    runs-on: ubuntu-latest
    concurrency:
      group: deploiement-ftp
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: tirelire-hebergement
          path: \${{ runner.temp }}/archive
      - name: Transférer
        run: bash apps/hebergement/deposer.sh

  android:
    name: APK Android
    needs: test
    if: \${{ !cancelled() && github.event_name != 'pull_request' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - name: Construire l'APK
        working-directory: apps/web/android
        run: ./gradlew --no-daemon assembleRelease
      - uses: actions/upload-artifact@v4
        with:
          name: tirelire-apk
          path: apps/web/android/app/build/outputs/apk/release/app-release.apk

  publication:
    name: Publication des releases
    needs: [hebergement, android]
    if: \${{ !cancelled() && github.event_name != 'pull_request' && needs.hebergement.result == 'success' && needs.android.result == 'success' }}
    runs-on: ubuntu-latest
    steps:
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: latest
`;

const SOLUTION_AMORCAGE = `name: Amorçages

on:
  workflow_dispatch:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read

concurrency:
  group: amorcage-\${{ github.event.pull_request.number || github.run_id }}
  cancel-in-progress: true

jobs:
  amorcage:
    name: Amorçages
    if: github.event_name != 'pull_request' || !github.event.pull_request.draft
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Nature de la PR
        id: nature
        env:
          BASE: \${{ github.event.pull_request.base.sha }}
        run: |
          if [ "$GITHUB_EVENT_NAME" != pull_request ]; then
            echo "organisationnel=oui" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          hors=$(git diff --name-only "$BASE"...HEAD \\
            | { git -c core.excludesFile=packages/gardes/chemins-ignores check-ignore --no-index -v -n --stdin || true; } \\
            | awk -F'\\t' '$1 !~ /chemins-ignores/ { print $2 }')
          if [ -n "$hors" ]; then echo "organisationnel=oui" >> "$GITHUB_OUTPUT"; else echo "organisationnel=non" >> "$GITHUB_OUTPUT"; fi
      - uses: pnpm/action-setup@v4
        if: steps.nature.outputs.organisationnel == 'oui'
      - run: pnpm install --frozen-lockfile
        if: steps.nature.outputs.organisationnel == 'oui'
      - run: pnpm amorcage
        if: steps.nature.outputs.organisationnel == 'oui'
        env:
          TIRELIRE_STRICT: '1'
`;

const SOLUTION_VERIFICATIONS = `name: Vérifications manuelles

on:
  pull_request:
    types: [opened, edited, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  issues: write
  pull-requests: write

jobs:
  verifications:
    name: Vérifications manuelles
    if: >-
      !github.event.pull_request.draft &&
      (github.event.action != 'edited' || github.event.changes.body != null || github.event.changes.base != null)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Invariants et contraintes de la PR
        run: node packages/gardes/cli.mjs pr --github
`;

const SOLUTION_ALERTE = `name: Après fusion

on:
  pull_request:
    types: [closed]
  push:
    branches: [main]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  alerte:
    name: Fusion non vérifiée, sous-branches
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Signaler une fusion non vérifiée ou un push direct
        run: node packages/gardes/cli.mjs alerte --github
      - name: Ranger les sous-branches
        if: \${{ !cancelled() && github.event_name == 'pull_request' && github.event.pull_request.merged }}
        run: |
          for suffixe in codeur auditeur; do echo "$suffixe"; done
`;

const ASSEMBLEUR = 'apps/hebergement/assembler.mjs';
const solution = () => ({
  [`${WORKFLOWS}/ci.yml`]: SOLUTION_CI,
  [`${WORKFLOWS}/amorcage.yml`]: SOLUTION_AMORCAGE,
  [`${WORKFLOWS}/verifications.yml`]: SOLUTION_VERIFICATIONS,
  [`${WORKFLOWS}/alerte-fusion.yml`]: SOLUTION_ALERTE,
  [`${WORKFLOWS}/etiquette-en-cours.yml`]: lireDepot(`${WORKFLOWS}/etiquette-en-cours.yml`),
  [ASSEMBLEUR]: lireDepot(ASSEMBLEUR).replace(/^execFileSync\('pnpm', \['exec', 'vite'/m, "if (!process.env.TIRELIRE_WEB_CONSTRUIT) execFileSync('pnpm', ['exec', 'vite'"),
});

/** La solution, un fichier modifié. */
function variante(fichier, avant, apres) {
  const s = solution();
  const chemin = fichier.includes('/') ? fichier : `${WORKFLOWS}/${fichier}`;
  if (apres === null) {
    delete s[chemin];
    return s;
  }
  if (avant === null) {
    s[chemin] = apres;
    return s;
  }
  const texte = s[chemin];
  if (!texte.includes(avant)) throw new Error(`variante introuvable dans ${chemin} : ${avant} — ${RELIRE}`);
  s[chemin] = texte.replace(avant, apres);
  return s;
}

const REGLES = {
  brouillon: reglesBrouillon,
  prete: reglesPrete,
  amorcages: reglesAmorcages,
  concurrence: reglesConcurrence,
  verifications: reglesVerifications,
  push: reglesPush,
  site: reglesSite,
  fusion: reglesFusion,
};

const VARIANTES = [
  ['brouillon', 'des tests sur un brouillon', variante('ci.yml', " && !github.event.pull_request.draft\n", '\n')],
  ['brouillon', 'des amorçages sur un brouillon', variante('amorcage.yml', "    if: github.event_name != 'pull_request' || !github.event.pull_request.draft\n", '')],
  ['brouillon', 'les vérifications sur un brouillon', variante('verifications.yml', '!github.event.pull_request.draft &&', '')],
  ['prete', 'le passage « prête » oublié', variante('ci.yml', 'types: [opened, synchronize, reopened, ready_for_review]', 'types: [opened, synchronize, reopened]')],
  ['amorcages', 'la liste recopiée dans le workflow', variante('amorcage.yml', "| { git -c core.excludesFile=packages/gardes/chemins-ignores check-ignore --no-index -v -n --stdin || true; } \\\n            | awk -F'\\t' '$1 !~ /chemins-ignores/ { print $2 }')", "| { grep -vE '^(apps|packages/core)/' || true; })")],
  ['amorcages', 'les amorçages sur toute PR', variante('amorcage.yml', "if [ -n \"$hors\" ]", 'if true')],
  ['amorcages', 'le lancement manuel retiré', variante('amorcage.yml', 'on:\n  workflow_dispatch:\n', 'on:\n')],
  ['amorcages', 'un passage planifié', variante('amorcage.yml', 'on:\n', "on:\n  schedule:\n    - cron: '0 3 * * 1'\n")],
  ['amorcages', 'une nature qui échoue au lancement manuel', variante('amorcage.yml', 'if [ "$GITHUB_EVENT_NAME" != pull_request ]; then', 'if false; then')],
  ['concurrence', 'sans annulation', variante('amorcage.yml', 'cancel-in-progress: true', 'cancel-in-progress: false')],
  ['concurrence', 'un groupe sans numéro de PR', variante('amorcage.yml', 'amorcage-${{ github.event.pull_request.number || github.run_id }}', 'amorcage')],
  ['concurrence', 'un groupe partagé entre workflows', variante('amorcage.yml', 'amorcage-${{ github.event.pull_request.number || github.run_id }}', 'ci-${{ github.event.pull_request.number || github.sha }}')],
  ['concurrence', 'un déploiement annulable', variante('ci.yml', "group: ci-${{ github.event.pull_request.number || github.sha }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}", 'group: ci-${{ github.ref }}\n  cancel-in-progress: true')],
  ['concurrence', 'des vérifications avec un groupe', variante('verifications.yml', 'jobs:\n', 'concurrency:\n  group: v-${{ github.event.pull_request.number }}\n\njobs:\n')],
  ['verifications', 'un titre modifié relance', variante('verifications.yml', " &&\n      (github.event.action != 'edited' || github.event.changes.body != null || github.event.changes.base != null)", '')],
  ['verifications', 'la branche cible oubliée', variante('verifications.yml', ' || github.event.changes.base != null', '')],
  ['verifications', 'le passage « prête » oublié', variante('verifications.yml', ', ready_for_review]', ']')],
  ['push', 'les tests rejoués sur main', variante('ci.yml', "    if: github.event_name == 'pull_request' && !github.event.pull_request.draft\n", '    if: ${{ !github.event.pull_request.draft }}\n')],
  ['push', 'le site perdu avec les tests sautés', variante('ci.yml', "    if: ${{ !cancelled() && (needs.test.result == 'success' || needs.test.result == 'skipped' && github.event_name != 'pull_request') }}\n", '')],
  ['push', "l'APK perdu avec les tests sautés", variante('ci.yml', "    if: ${{ !cancelled() && github.event_name != 'pull_request' }}\n", "    if: github.event_name != 'pull_request'\n")],
  ['push', 'le build des tests attendu sur main', variante('ci.yml', "        if: github.event_name == 'pull_request'\n        uses: actions/download-artifact@v4", '        uses: actions/download-artifact@v4')],
  ['site', 'une installation de plus', variante('ci.yml', "      - run: pnpm install --frozen-lockfile\n        if: github.event_name != 'pull_request'\n", '      - run: pnpm install --frozen-lockfile\n')],
  ['site', 'un build de plus', variante('ci.yml', "          TIRELIRE_WEB_CONSTRUIT: ${{ github.event_name == 'pull_request' && '1' || '' }}\n", '')],
  ['fusion', 'un second workflow à la fermeture', variante('sous-branches.yml', null, 'name: x\non:\n  pull_request:\n    types: [closed]\njobs:\n  ranger:\n    if: github.event.pull_request.merged == true\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo codeur auditeur\n')],
  ['fusion', 'les sous-branches oubliées', variante('alerte-fusion.yml', '        run: |\n          for suffixe in codeur auditeur; do echo "$suffixe"; done\n', '        run: echo rien\n')],
];

// ─── Témoins : lecture ──────────────────────────────────────────────────────────────────────────

test('#131 · témoin : le lecteur de YAML lit les workflows du dépôt et leurs formes', () => {
  const ci = lireYaml(lireDepot(`${WORKFLOWS}/ci.yml`));
  assert.deepEqual(Object.keys(ci.jobs), ['test', 'hebergement', 'deploiement', 'android', 'publication'], RELIRE);
  assert.equal(ci.jobs.deploiement.concurrency.group, 'deploiement-ftp', RELIRE);
  assert.equal(ci.jobs.deploiement.concurrency['cancel-in-progress'], false, RELIRE);
  assert.deepEqual(ci.on.push.tags, ['v*'], RELIRE);
  assert.equal(ci.on.pull_request, null, RELIRE);
  assert.match(ci.jobs.deploiement.steps.find((e) => e.name === 'Résumé').run, /### Site déposé/, RELIRE);
  assert.equal(ci.jobs.test.steps[0].uses, 'actions/checkout@v4', RELIRE);
  for (const f of readdirSync(join(DEPOT, WORKFLOWS))) assert.doesNotThrow(() => lireYaml(lireDepot(`${WORKFLOWS}/${f}`)), `${f} : ${RELIRE}`);
  const formes = lireYaml("on: [push, pull_request]\nx:\n  - a\n  - 'b c' # note\ny: { p: [docs/**, 'x'], q: {} }\nz: >-\n  un\n  deux\nw:\n- 1\n- true\n");
  assert.deepEqual(formes, { on: ['push', 'pull_request'], x: ['a', 'b c'], y: { p: ['docs/**', 'x'], q: {} }, z: 'un deux', w: [1, true] });
  assert.throws(() => lireYaml('a:\n  b: 1\n    c: 2\n'), /renfoncement/);
});

test('#131 · témoin : les expressions se lisent comme sur GitHub, en logique à trois valeurs', () => {
  const ctx = {
    racines: {
      github: { event_name: 'pull_request', event: { pull_request: { draft: false, number: 7 }, changes: { title: {} } }, ref: 'refs/heads/main' },
      needs: { test: { result: 'skipped', outputs: {} } },
      steps: { a: { outputs: { [DEFAUT]: INCONNU } } },
      inputs: {},
      [DEFAUT]: INCONNU,
    },
    statut: { succes: true, echec: false },
  };
  const cas = [
    ["github.event_name == 'PULL_REQUEST'", true],
    ['!github.event.pull_request.draft', true],
    ['github.event.changes.body != null', false],
    ["inputs.deploiement != 'ignorer'", true],
    ["needs.test.result == 'skipped' && github.event_name != 'push'", true],
    ["steps.a.outputs.x == 'oui'", INCONNU],
    ["steps.a.outputs.x == 'oui' && false", false],
    ["steps.a.outputs.x == 'oui' || true", true],
    ["format('pr-{0}', github.event.pull_request.number)", 'pr-7'],
    ['github.event.pull_request.number || github.sha', 7],
    ["startsWith(github.ref, 'refs/heads/')", true],
    ["contains(fromJSON('[\"a\",\"b\"]'), 'B')", true],
    ["matrix.os == 'x'", INCONNU],
    ["'it''s' == 'IT''S'", true],
    ['1 == true', true],
    ["'' == 0", true],
  ];
  for (const [src, attendu] of cas) assert.equal(evaluer(src, ctx), attendu, `${src} : ${RELIRE}`);
  assert.equal(condition("github.event_name == 'push'", ctx), false);
  assert.equal(condition("${{ github.event_name == 'push' }}", ctx), false);
  assert.equal(condition("${{ github.event_name == 'push' }} ", ctx), false);
  assert.equal(condition("draft ${{ github.event_name == 'push' }}", ctx), true, 'un texte autour de ${{ }} est toujours vrai');
  assert.equal(condition(undefined, { ...ctx, statut: { succes: false } }), false);
  assert.equal(condition('!cancelled()', { ...ctx, statut: { succes: false } }), true);
  assert.equal(condition("steps.a.outputs.x == 'oui'", ctx), INCONNU);
  assert.equal(interpoler('ci-${{ github.event.pull_request.number }}', ctx), 'ci-7');
  assert.equal(interpoler('${{ steps.a.outputs.x }}', ctx), INCONNU);
  assert.throws(() => evaluer('github.event_name ==', ctx));
});

test('#131 · témoin : les déclenchements suivent les filtres de GitHub', () => {
  const pr = (action) => scenarioPR(null, { preparer: false, action });
  const wf = (on) => lireYaml(`on:\n${on}jobs: {}\n`);
  assert.equal(seDeclenche(wf('  pull_request:\n'), pr('synchronize')), true);
  assert.equal(seDeclenche(wf('  pull_request:\n'), pr('ready_for_review')), false);
  assert.equal(seDeclenche(wf('  pull_request:\n    types: [ready_for_review]\n'), pr('ready_for_review')), true);
  assert.equal(seDeclenche(wf("  push:\n    branches: [main]\n    tags: ['v*']\n"), scenarioPush(null, { preparer: false })), true);
  assert.equal(seDeclenche(wf("  push:\n    tags: ['v*']\n"), scenarioPush(null, { preparer: false })), false);
  assert.equal(seDeclenche(wf("  push:\n    branches: [main]\n    paths: ['.github/**']\n"), scenarioPush(null, { preparer: false })), false);
  assert.equal(seDeclenche(wf("  push:\n    paths-ignore: ['docs/**']\n"), scenarioPush(null, { preparer: false })), true);
  assert.equal(seDeclenche(wf("  pull_request:\n    branches: ['!main']\n"), pr('opened')), false);
  assert.deepEqual([...categories({ run: 'pnpm --filter @tirelire/hebergement assembler' })], ['assembler']);
  assert.deepEqual([...categories({ run: 'pnpm install --frozen-lockfile && pnpm -r build\n# pnpm test' })], ['install', 'build']);
  assert.deepEqual([...categories({ run: 'echo pnpm-test; pnpm amorcage' })], ['amorcage']);
});

// ─── Témoins : la solution passe, chaque défaut est vu ──────────────────────────────────────────

test('#131 · témoin vert : une solution fabriquée passe toutes les règles', () => {
  const d = depotPartage();
  for (const [nom, regle] of Object.entries(REGLES)) {
    assert.deepEqual(regle(d, solution()), [], `la solution fabriquée échoue à « ${nom} » : ${RELIRE}`);
  }
});

for (const [regle, cas, fichiers] of VARIANTES) {
  test(`#131 · témoin rouge : ${cas} est vu (${regle})`, () => {
    assert.notDeepEqual(REGLES[regle](depotPartage(), fichiers, true), [], `${cas} passe inaperçu : ${RELIRE}`);
  });
}

test('#131 · témoin : les règles écrites', () => {
  const bon = {
    glossaire: `## Amorçages\n\nUn amorçage juge un codage. ${PHRASE_PORTEUR}.\n`,
    decisions: '## D76 · x\n\nRien.\n\n## D77 · 2026-09-17 · La CI économe\n\nRemplace un passage de D74 (#131).\n',
    claude: "Le harnais qu'un auditeur écrit est un amorçage, joué en CI si la PR touche la garde (D77).\n",
    readme: '- **CI** : sur chaque PR prête, typecheck, tests et build.\n',
  };
  assert.deepEqual(reglesEcrites(bon), [], RELIRE);
  for (const [cas, change] of [
    ['phrase absente', { glossaire: '## Amorçages\n\nRien.\n' }],
    ['ancienne phrase restée', { glossaire: `${bon.glossaire}Les amorçages sont joués en CI sur chaque PR, et en local.\n` }],
    ['entrée absente', { decisions: '## D76 · x\n\nCite #131.\n' }],
    ['D74 non nommée', { decisions: '## D77 · x\n\nCite #131.\n' }],
    ['CLAUDE.md sans la décision', { claude: 'Un amorçage tourne si la PR touche la garde.\n' }],
    ['CLAUDE.md inchangé', { claude: `${bon.claude}Il va dans amorcage/, s'appelle par pnpm amorcage, et tourne en CI sur chaque PR (D74).\n` }],
    ['README.md inchangé', { readme: '- **CI** : sur chaque PR, typecheck, tests (navigateur compris), build et amorçages, en mode strict.\n' }],
  ]) {
    assert.notDeepEqual(reglesEcrites({ ...bon, ...change }), [], `${cas} passe inaperçu : ${RELIRE}`);
  }
});

// ─── Le dépôt ───────────────────────────────────────────────────────────────────────────────────

const DU_JOUR = {
  brouillon: '#131 · un brouillon ne joue ni tests, ni build, ni amorçages, ni site, ni vérifications manuelles',
  prete: '#131 · une PR prête joue typecheck, tests et build, passage « prête » compris',
  amorcages: '#131 · les amorçages ne tournent que si la PR touche un fichier absent de chemins-ignores, et à la demande',
  concurrence: '#131 · un nouveau commit annule le run précédent de la même PR, sauf les vérifications, jamais un déploiement',
  verifications: '#131 · les vérifications manuelles ne se lancent ni sur un brouillon, ni pour un titre modifié',
  push: '#131 · un push sur main ne rejoue pas les tests, et construit, publie et déploie toujours',
  site: '#131 · sur une PR, le site est assemblé depuis le build des tests',
  fusion: '#131 · après la fusion, un seul job lance l’alerte et range les sous-branches',
};

for (const [regle, titre] of Object.entries(DU_JOUR)) {
  test(titre, () => {
    const p = REGLES[regle](depotPartage(), {});
    assert.deepEqual(p, [], `${p.join('\n')}`);
  });
}

test('#131 · le glossaire, le journal, CLAUDE.md et le README disent la règle nouvelle', () => {
  const p = reglesEcrites({ glossaire: lireDepot('docs/glossaire.md'), decisions: lireDepot('docs/decisions.md'), claude: lireDepot('CLAUDE.md'), readme: lireDepot('README.md') });
  assert.deepEqual(p, [], p.join('\n'));
});
