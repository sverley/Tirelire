/**
 * La règle des harnais (D81), lue par les tests de la garde (`gardes.test.mjs`) : les tests de la garde
 * et les harnais du registre ne portent que les niveaux 0 et 1 (D83). Ce n'est pas une logique de
 * l'outil : seuls les tests de la garde l'appliquent.
 *
 * Les tests de la garde sont ceux qui vérifient la garde elle-même : ses trois vérifications et cette
 * règle (D81). Ils vivent dans `TESTS_DE_LA_GARDE`. Tout autre test de `packages/gardes` appartient
 * au harnais d'un besoin, et se joue à son niveau ; la règle ne le voit que si le registre le nomme.
 *
 * Le niveau se lit dans le fichier, sans l'exécuter : marque `[niveau N]` du test, sinon de la suite
 * la plus proche qui l'englobe, sinon 2.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RACINE, lireRegistre, temoinRouge, testNomme } from './gardes.mjs';

/** Le fichier des tests de la garde (D81). */
export const TESTS_DE_LA_GARDE = 'packages/gardes/gardes.test.mjs';

const MARQUE = /\[niveau ([0-4])\]/;
const DÉFAUT = 2;
const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');

/** Commentaires effacés, intérieurs des chaînes et des expressions régulières masqués. */
function masquer(s) {
  const sortie = s.split('');
  const chaines = new Map();
  const effacer = (a, b) => {
    for (let k = a; k < b && k < s.length; k++) if (sortie[k] !== '\n') sortie[k] = ' ';
  };
  let dernier = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') {
      const fin = s.indexOf('\n', i);
      effacer(i, fin < 0 ? s.length : fin);
      i = fin < 0 ? s.length : fin;
    } else if (c === '/' && s[i + 1] === '*') {
      const fin = s.indexOf('*/', i + 2);
      effacer(i, fin < 0 ? s.length : fin + 2);
      i = fin < 0 ? s.length : fin + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < s.length && s[j] !== c && (c === '`' || s[j] !== '\n')) {
        if (s[j] === '\\') j += 2;
        else if (c === '`' && s[j] === '$' && s[j + 1] === '{') {
          let p = 1;
          for (j += 2; j < s.length && p; j++) p += s[j] === '{' ? 1 : s[j] === '}' ? -1 : 0;
        } else j++;
      }
      chaines.set(i, s.slice(i + 1, j));
      effacer(i + 1, j);
      i = j + 1;
      dernier = 'a';
    } else if (c === '/' && ('(,=:[!&|?{};+-*%<>~^'.includes(dernier) || /\b(?:return|typeof|case|in|of)\s*$/.test(s.slice(Math.max(0, i - 10), i)))) {
      let j = i + 1;
      let classe = false;
      while (j < s.length && s[j] !== '\n' && (classe || s[j] !== '/')) {
        if (s[j] === '\\') j++;
        else if (s[j] === '[') classe = true;
        else if (s[j] === ']') classe = false;
        j++;
      }
      effacer(i + 1, j);
      i = j + 1;
      dernier = 'a';
    } else {
      if (!/\s/.test(c)) dernier = c;
      i++;
    }
  }
  return { masque: sortie.join(''), chaines };
}

function fermante(masque, ouvrante) {
  let p = 0;
  for (let i = ouvrante; i < masque.length; i++) {
    if ('([{'.includes(masque[i])) p++;
    else if (')]}'.includes(masque[i]) && --p === 0) return i;
  }
  return masque.length;
}

/**
 * Les appels de test d'un fichier (suites comprises) et leur niveau : marque du test, sinon de la
 * suite la plus proche qui l'englobe, sinon 2. Une suite porte aussi la liste de ses tests.
 */
export function niveauxDesTests(source) {
  const { masque, chaines } = masquer(String(source));
  const appels = [];
  for (const m of masque.matchAll(/(?<![\w$.])(describe|suite|it|test)((?:\s*\.\s*[A-Za-z]+)*)\s*\(/g)) {
    if (/\bfunction\s*$/.test(masque.slice(Math.max(0, m.index - 12), m.index))) continue;
    let ouvrante = m.index + m[0].length - 1;
    let fin = fermante(masque, ouvrante);
    const premier = (o) => o + 1 + masque.slice(o + 1).match(/^\s*/)[0].length;
    const curry = !chaines.has(premier(ouvrante)) && masque.slice(fin + 1).match(/^\s*\(/);
    if (curry) {
      ouvrante = fin + curry[0].length;
      fin = fermante(masque, ouvrante);
    }
    const titre = chaines.get(premier(ouvrante));
    if (titre === undefined) continue;
    appels.push({ titre: titre.replace(/\s+/g, ' ').trim(), suite: m[1] === 'describe' || m[1] === 'suite', ouvrante, fin });
  }
  const parents = (a) => appels.filter((b) => b.suite && b !== a && b.ouvrante < a.ouvrante && a.ouvrante < b.fin).sort((x, y) => y.ouvrante - x.ouvrante);
  const marque = (a) => (MARQUE.test(a.titre) ? Number(a.titre.match(MARQUE)[1]) : undefined);
  const niveau = (a) => marque(a) ?? parents(a).map(marque).find((n) => n !== undefined) ?? DÉFAUT;
  return appels.map((a) => ({
    titre: a.titre,
    suite: a.suite,
    niveau: niveau(a),
    tests: a.suite ? appels.filter((t) => !t.suite && a.ouvrante < t.ouvrante && t.ouvrante < a.fin).map((t) => ({ titre: t.titre, niveau: niveau(t) })) : undefined,
    parents: parents(a).map((p) => ({ titre: p.titre, niveau: niveau(p) })),
  }));
}

// ─── La règle des harnais ─────────────────────────────────────────────────────────────

const GARDÉ = (n) => n === 0 || n === 1;

/**
 * Les manquements des tests de la garde ou d'un harnais du registre : un test hors des niveaux 0 et 1.
 * Sans nom, la règle vaut pour tout le fichier ; avec des noms (le test que nomme la ligne `Harnais`, et
 * son témoin), pour ces tests, leurs suites et, quand un nom désigne une suite, tous ses tests.
 */
export function manquements(source, { fichier, noms = [] } = {}) {
  const tout = niveauxDesTests(source);
  const hors = (t) => `${fichier} : « ${t.titre} » est de niveau ${t.niveau} ; un test de la garde ou d'un harnais du registre est de niveau 0 ou 1 (D81).`;
  if (!noms.length) return tout.filter((t) => !t.suite && !GARDÉ(t.niveau)).map(hors);
  const vus = new Map();
  for (const nom of noms) {
    for (const a of tout.filter((t) => t.titre === nom)) {
      for (const t of [a, ...a.parents, ...(a.tests ?? [])]) if (!GARDÉ(t.niveau)) vus.set(t.titre, hors(t));
    }
  }
  return [...vus.values()];
}

/** Les tests de la garde (leur fichier entier) et les harnais du registre (selon la portée de chaque ligne `Harnais`). */
export function harnais() {
  const liste = [];
  const { entrees } = lireRegistre(lire('docs/gardes.md'));
  for (const e of entrees.values()) {
    for (const h of e.harnais) {
      const nommé = testNomme(h.description);
      const témoin = temoinRouge(h.description)?.nom;
      const noms = nommé ? [nommé, ...(témoin ? [témoin] : [])] : [];
      for (const c of h.chemins.filter((c) => /\.test\.[cm]?[jt]s$/.test(c) && existsSync(join(RACINE, c)))) liste.push({ fichier: c, noms, source: e.id });
    }
  }
  liste.push({ fichier: TESTS_DE_LA_GARDE, noms: [], source: 'garde' });
  return liste;
}
