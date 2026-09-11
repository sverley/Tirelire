/**
 * Garde de l'objectif primaire (#58, D61).
 *
 * Deux vérifications, sans dépendance :
 *
 * - **Couverture.** Chaque invariant de `docs/invariants.md` (I…, et les usages U… d'I3) et chaque
 *   contrainte de `docs/contraintes.md` (C…) a son entrée dans `docs/gardes.md`, gardée par au
 *   moins un harnais qui existe, une vérification manuelle décrite, ou un renvoi vers des entrées
 *   elles-mêmes gardées.
 * - **Demandes d'une PR.** La description déclare les identifiants que la PR touche et ceux dont le
 *   lien pourrait être masqué ; les motifs `Chemins` du registre en imposent un plancher ; chaque
 *   vérification manuelle qui s'y rattache, et chaque garde retirée du registre, y figure avec une
 *   analyse et une case « Validée » cochée par un développeur humain.
 *
 * Tout travaille sur des textes et des listes de fichiers : les tests nourrissent ces fonctions de
 * documents inventés, `cli.mjs` de ceux du dépôt.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Racine du dépôt. */
export const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Documents lus, relatifs à la racine. */
export const DOCUMENTS = Object.freeze({
  invariants: 'docs/invariants.md',
  contraintes: 'docs/contraintes.md',
  gardes: 'docs/gardes.md',
  modele: '.github/pull_request_template.md',
});

/** Étiquettes admises en tête d'une ligne d'entrée du registre. */
export const ETIQUETTES = Object.freeze(['Harnais', 'Vérification manuelle', 'Couvert par', 'À bâtir']);

const G = DOCUMENTS.gardes;
const IDENTIFIANT = /\b([IUC]\d+)\b/g;
/** Ce que contient une analyse laissée telle que le modèle ou `demander` l'ont écrite. */
const ANALYSE_VIDE = /^(?:…|\.\.\.|à écrire|à compléter|à analyser)?\.?$/i;
const RANG = { I: 0, U: 1, C: 2 };

/** Ordre de lecture : invariants, usages, contraintes, chacun par numéro. */
export const ordreIds = (a, b) => RANG[a[0]] - RANG[b[0]] || Number(a.slice(1)) - Number(b.slice(1));

// ─── Fichiers et motifs de chemin ────────────────────────────────────────────────────────────

// `*` et `?` restent dans un dossier ; `**` en traverse autant qu'il faut, aucun compris :
// « apps/web/src/**/*.svelte » désigne aussi « apps/web/src/App.svelte ».
export function globVersRegex(motif) {
  let re = '';
  for (let i = 0; i < motif.length; i++) {
    const c = motif[i];
    if (c === '*' && motif[i + 1] === '*') {
      if (motif[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', '.gradle']);

/** Fichiers du dépôt, suivis ou nouveaux mais pas ignorés, en chemins `/` relatifs à la racine. */
export function fichiersDuDepot(racine = RACINE) {
  try {
    const sortie = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: racine,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return [...new Set(sortie.split('\0').filter(Boolean))].filter((f) => estFichier(join(racine, f)));
  } catch {
    return parcourir(racine, racine);
  }
}

function parcourir(racine, dossier) {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((d) => {
    if (IGNORES.has(d.name)) return [];
    const chemin = join(dossier, d.name);
    return d.isDirectory() ? parcourir(racine, chemin) : [relative(racine, chemin).split('\\').join('/')];
  });
}

function estFichier(chemin) {
  try {
    return statSync(chemin).isFile();
  } catch {
    return false;
  }
}

function listeCourte(elements, n = 3) {
  if (elements.length <= n) return elements.join(', ');
  const reste = elements.length - n;
  return `${elements.slice(0, n).join(', ')} et ${reste} autre${reste > 1 ? 's' : ''}`;
}

const entreGraves = (texte) => [...texte.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());

/** Coupe au premier tiret cadratin entouré d'espaces : ce qui est désigné, puis ce qu'on en dit. */
function couper(texte) {
  const m = texte.match(/^(.*?)\s+—\s+(.*)$/);
  return m ? [m[1], m[2].trim()] : [texte, ''];
}

// ─── Documents sources ───────────────────────────────────────────────────────────────────────

/** Identifiants définis : titres `## I…` et usages `- **U… · …**` des invariants, titres `## C…` des contraintes. */
/** Forme d'une définition, par famille : ce qui s'ouvre sur un identifiant sans elle est refusé (#59). */
const DEFINITIONS = {
  I: { nature: 'un invariant', document: DOCUMENTS.invariants, forme: (id) => `« ## ${id} · Titre »` },
  U: { nature: 'un usage', document: DOCUMENTS.invariants, forme: (id) => `« - **${id} · Titre.** », dans la liste d'I3` },
  C: { nature: 'une contrainte', document: DOCUMENTS.contraintes, forme: (id) => `« ## ${id} · Titre »` },
};
/**
 * Un titre, ou un élément de liste (puce ou numéro) dont le gras ou l'italique commence par un
 * identifiant : GitHub l'affiche comme une définition, la garde doit donc le lire ou le refuser.
 */
const OUVRE_TITRE = /^ {0,3}#{1,6}\s+[*_]*\s*([IUC]\d+)\b/i;
const OUVRE_GRAS = /^\s*(?:[-*+]|\d+[.)])\s+[*_]{1,2}\s*([IUC]\d+)\b/i;

/** Message pour une ligne qui s'ouvre sur un identifiant sans avoir la forme de sa définition. */
function formeRefusee(id, ligne, source) {
  const { nature, document, forme } = DEFINITIONS[id[0]];
  return `${id} n'est pas lu : « ${ligne.trim()} » (${source}) s'ouvre sur un identifiant sans en avoir la forme ; ${nature} s'écrit ${forme(id)} dans ${document}.`;
}

export function lireIdentifiants(invariants, contraintes) {
  const ids = new Map();
  const doublons = [];
  const illisibles = [];
  const ajouter = (id, titre, source) => {
    if (ids.has(id)) doublons.push(`${id} est défini deux fois (${ids.get(id).source}, ${source}).`);
    else ids.set(id, { id, titre: titre.trim(), source });
  };
  const lire = (texte, source) => {
    for (const ligne of String(texte).split(/\r?\n/)) {
      const dansInvariants = source === DOCUMENTS.invariants;
      const invariant = dansInvariants && ligne.match(/^##\s+(I\d+)\s+·\s+(.+?)\s*$/);
      if (invariant) {
        ajouter(invariant[1], invariant[2], source);
        continue;
      }
      const usage = dansInvariants && ligne.match(/^\s*[-*]\s+\*\*(U\d+)\s+·\s+(.+?)\.?\*\*/);
      if (usage) {
        ajouter(usage[1], usage[2], source);
        continue;
      }
      const contrainte = !dansInvariants && ligne.match(/^##\s+(C\d+)\s+·\s+(.+?)\s*$/);
      if (contrainte) {
        ajouter(contrainte[1], contrainte[2], source);
        continue;
      }
      const voisine = ligne.match(OUVRE_TITRE) ?? ligne.match(OUVRE_GRAS);
      if (voisine) illisibles.push(formeRefusee(voisine[1].toUpperCase(), ligne, source));
    }
  };
  lire(invariants, DOCUMENTS.invariants);
  lire(contraintes, DOCUMENTS.contraintes);
  return { ids, doublons, illisibles };
}

// ─── Registre ────────────────────────────────────────────────────────────────────────────────

/**
 * Lit `docs/gardes.md`. Une entrée commence à un titre dont le texte commence par un identifiant
 * (`## I7 · …`, `### U1 · …`) et finit au titre suivant ; un titre sans identifiant ne porte rien.
 */
export function lireRegistre(texte) {
  const entrees = new Map();
  const problemes = [];
  let entree = null;
  let suite = null; // élément qu'une ligne indentée prolonge
  String(texte)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((ligne, i) => {
      const ou = `${G}:${i + 1}`;
      const titre = ligne.match(/^#{1,6}\s+(.*?)\s*$/);
      if (titre) {
        suite = null;
        const m = titre[1].match(/^([IUC]\d+)\s+·\s+(.+)$/);
        if (!m) {
          const voisine = titre[1].match(/^\**\s*([IUC]\d+)\b/i);
          if (voisine) problemes.push(`${ou} : ${voisine[1].toUpperCase()} n'est pas lu ; une entrée s'écrit « ## ${voisine[1].toUpperCase()} · Titre ».`);
          entree = null;
        } else if (entrees.has(m[1])) {
          problemes.push(`${ou} : ${m[1]} a déjà une entrée.`);
          entree = entrees.get(m[1]);
        } else {
          entree = { id: m[1], titre: m[2], ligne: i + 1, chemins: [], harnais: [], verifications: [], couvertPar: [], aBatir: [] };
          entrees.set(m[1], entree);
        }
        return;
      }
      if (!entree) return;
      const chemins = ligne.match(/^Chemins\s*:\s*(.*)$/);
      if (chemins) {
        entree.chemins.push(...entreGraves(chemins[1]));
        suite = null;
        return;
      }
      const element = ligne.match(/^[-*]\s+\*\*([^*]+)\*\*\s*·\s*(.*)$/);
      if (!element) {
        if (/^[-*]\s+\*\*/.test(ligne)) problemes.push(`${ou} · ${entree.id} : une ligne d'entrée s'écrit « - **Étiquette** · … ».`);
        else if (suite && /^\s+\S/.test(ligne)) suite.description = `${suite.description} ${ligne.trim()}`.trim();
        else if (ligne.trim()) suite = null;
        return;
      }
      suite = null;
      const etiquette = element[1].trim();
      const [avant, apres] = couper(element[2]);
      if (etiquette === 'Harnais') {
        const harnais = { chemins: entreGraves(avant), description: apres, ligne: i + 1 };
        if (!harnais.chemins.length || !apres) problemes.push(`${ou} · ${entree.id} : un harnais s'écrit \`chemin\` — ce qu'il garde.`);
        entree.harnais.push(harnais);
        suite = harnais;
      } else if (etiquette === 'Vérification manuelle') {
        const [id, ...autres] = entreGraves(avant);
        if (!id || autres.length || !apres) {
          problemes.push(`${ou} · ${entree.id} : une vérification manuelle s'écrit \`VM-${entree.id}-nom\` — ce qu'on fait, sur quoi, et ce qu'on doit constater.`);
        } else {
          const verification = { id, description: apres, ligne: i + 1, entree: entree.id };
          entree.verifications.push(verification);
          suite = verification;
        }
      } else if (etiquette === 'Couvert par') {
        const ids = [...avant.matchAll(IDENTIFIANT)].map((m) => m[1]);
        if (!ids.length || !apres) problemes.push(`${ou} · ${entree.id} : un renvoi s'écrit I2, I3 — pourquoi.`);
        entree.couvertPar.push(...ids);
      } else if (etiquette === 'À bâtir') {
        entree.aBatir.push(element[2].trim());
      } else {
        problemes.push(`${ou} · ${entree.id} : étiquette inconnue « ${etiquette} » (attendues : ${ETIQUETTES.join(', ')}).`);
      }
    });
  return { entrees, problemes };
}

/** Une entrée est gardée par un harnais, une vérification manuelle, ou des renvois tous gardés, sans boucle. */
function estGardee(id, entrees, enCours = new Set()) {
  const e = entrees.get(id);
  if (!e || enCours.has(id)) return false;
  if (e.harnais.some((h) => h.chemins.length) || e.verifications.length) return true;
  if (!e.couvertPar.length) return false;
  enCours.add(id);
  const gardee = e.couvertPar.every((c) => estGardee(c, entrees, enCours));
  enCours.delete(id);
  return gardee;
}

// ─── Couverture ──────────────────────────────────────────────────────────────────────────────

export function verifierCouvertureTextes({ invariants, contraintes, gardes, fichiers, lireFichier }) {
  const { ids, doublons, illisibles } = lireIdentifiants(invariants, contraintes);
  const { entrees, problemes } = lireRegistre(gardes);
  problemes.unshift(...doublons, ...illisibles);
  const existe = new Set(fichiers);

  for (const { id, titre, source } of ids.values()) {
    if (!entrees.has(id)) {
      problemes.push(`${id} · ${titre} (${source}) n'a pas d'entrée dans ${G} : lui donner un harnais, une vérification manuelle ou un renvoi.`);
    }
  }

  const definies = new Map();
  for (const e of entrees.values()) {
    const ou = `${G}:${e.ligne} · ${e.id}`;
    if (!ids.has(e.id)) problemes.push(`${ou} : ${e.id} n'existe ni dans ${DOCUMENTS.invariants} ni dans ${DOCUMENTS.contraintes}.`);
    for (const motif of e.chemins) {
      const re = globVersRegex(motif);
      if (!fichiers.some((f) => re.test(f))) problemes.push(`${ou} : le motif \`${motif}\` ne désigne aucun fichier.`);
    }
    for (const h of e.harnais) {
      for (const chemin of h.chemins) {
        if (!existe.has(chemin)) problemes.push(`${ou} : le harnais \`${chemin}\` n'existe pas (renommé ou supprimé ?).`);
      }
      const nom = testNomme(h.description);
      const presents = h.chemins.filter((c) => existe.has(c));
      if (nom && lireFichier && presents.length) {
        const analyses = presents.map((c) => analyserTests(lireFichier(c) ?? ''));
        if (!analyses.some((a) => a.actifs.has(nom))) {
          const pourquoi = analyses.some((a) => a.inactifs.has(nom))
            ? 'il y figure sans tourner : désactivé, seulement prévu, dans une suite désactivée, ou suite sans test actif'
            : 'renommé, supprimé ou mis en commentaire ?';
          problemes.push(`${ou} : le test « ${nom} » ne tourne dans aucun de ${presents.map((c) => `\`${c}\``).join(', ')} (${pourquoi}).`);
        }
      }
    }
    const nom = new RegExp(`^VM-${e.id}-[a-z0-9]+(?:-[a-z0-9]+)*$`);
    for (const v of e.verifications) {
      if (!nom.test(v.id)) problemes.push(`${ou} : \`${v.id}\` doit s'écrire VM-${e.id}-nom (minuscules, chiffres, tirets).`);
      if (definies.has(v.id)) problemes.push(`${ou} : \`${v.id}\` est déjà définie en ${definies.get(v.id)}.`);
      else definies.set(v.id, e.id);
      if (v.description.length < 40) problemes.push(`${ou} : \`${v.id}\` doit dire ce qu'on fait, sur quoi, et ce qu'on doit constater.`);
    }
    for (const c of e.couvertPar) {
      if (c === e.id) problemes.push(`${ou} : une entrée ne se couvre pas elle-même.`);
      else if (!entrees.has(c)) problemes.push(`${ou} : renvoi vers ${c}, qui n'a pas d'entrée.`);
    }
    if (!estGardee(e.id, entrees)) problemes.push(`${ou} : ni harnais, ni vérification manuelle, ni renvoi vers des entrées gardées.`);
  }
  return { problemes, ids, entrees };
}

/** Nom du test qu'une ligne « Harnais » désigne : entre guillemets, en tête de ce qu'elle garde (#59). */
export function testNomme(description) {
  const m = String(description ?? '').match(/^«\s*(.+?)\s*»/);
  return m ? m[1].replace(/\s+/g, ' ') : null;
}

// ─── Tests nommés : ce qui tourne vraiment ────────────────────────────────────────────────────
// Tranché dans #59 : un test nommé mis en commentaire, désactivé (`.skip`) ou seulement prévu
// (`.todo`) compte comme absent, comme un test dans une suite désactivée ou une suite sans test actif.

const APPEL_DE_TEST = /(?<![\w$.])(x?)(describe|suite|it|test)((?:\s*\.\s*[A-Za-z]+)*)\s*\(/g;
const AVANT_EXPRESSION_REGULIERE = '(,=:[!&|?{};+-*%<>~^';

/**
 * Commentaires effacés ; intérieurs des chaînes, gabarits et expressions régulières masqués. Les
 * parenthèses et les appels se cherchent alors sans se tromper ; chaque chaîne garde sa valeur.
 */
function masquer(source) {
  const s = String(source);
  const sortie = s.split('');
  const chaines = new Map();
  const effacer = (debut, fin) => {
    for (let k = debut; k < fin && k < s.length; k++) if (sortie[k] !== '\n') sortie[k] = ' ';
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
      let valeur = '';
      let gabarit = false;
      while (j < s.length && s[j] !== c && (c === '`' || s[j] !== '\n')) {
        if (s[j] === '\\') {
          valeur += s[j + 1] ?? '';
          j += 2;
        } else if (c === '`' && s[j] === '$' && s[j + 1] === '{') {
          gabarit = true;
          let profondeur = 1;
          for (j += 2; j < s.length && profondeur; j++) profondeur += s[j] === '{' ? 1 : s[j] === '}' ? -1 : 0;
        } else {
          valeur += s[j++];
        }
      }
      chaines.set(i, { valeur: gabarit ? null : valeur, fin: j });
      effacer(i + 1, j);
      i = j + 1;
      dernier = 'a';
    } else if (c === '/' && (AVANT_EXPRESSION_REGULIERE.includes(dernier) || /\b(?:return|typeof|case|in|of|void|yield|await)\s*$/.test(s.slice(Math.max(0, i - 12), i)))) {
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
  let profondeur = 0;
  for (let i = ouvrante; i < masque.length; i++) {
    if ('([{'.includes(masque[i])) profondeur++;
    else if (')]}'.includes(masque[i]) && --profondeur === 0) return i;
  }
  return masque.length;
}

/** Suites et tests d'un fichier, et les titres de ceux qui tournent. */
export function analyserTests(source) {
  const { masque, chaines } = masquer(source);
  const appels = [];
  for (const m of masque.matchAll(APPEL_DE_TEST)) {
    if (/\bfunction\s*$/.test(masque.slice(Math.max(0, m.index - 12), m.index))) continue;
    let ouvrante = m.index + m[0].length - 1;
    let fin = fermante(masque, ouvrante);
    const premier = (o) => o + 1 + masque.slice(o + 1).match(/^\s*/)[0].length;
    // `it.skipIf(condition)('titre', …)`, `test.each([…])('titre', …)` : le titre est dans le second appel.
    const curry = !chaines.has(premier(ouvrante)) && masque.slice(fin + 1).match(/^\s*\(/);
    if (curry) {
      ouvrante = fin + curry[0].length;
      fin = fermante(masque, ouvrante);
    }
    const chaine = chaines.get(premier(ouvrante));
    const modificateurs = m[3].replace(/\s/g, '').split('.');
    let inactif = m[1] === 'x' || modificateurs.includes('skip') || modificateurs.includes('todo');
    const options = chaine && masque.slice(chaine.fin + 1).match(/^\s*,\s*\{/);
    if (options) {
      const accolade = chaine.fin + options[0].length;
      // `{ skip: true }` ou `{ todo: 'raison' }` désactivent ; `{ skip: !php }` est conditionnel, comme skipIf.
      inactif ||= /\b(?:skip|todo)\s*:\s*(?:true\b|['"`])/.test(masque.slice(accolade, fermante(masque, accolade)));
    }
    const titre = chaine?.valeur == null ? null : chaine.valeur.replace(/\s+/g, ' ').trim();
    appels.push({ titre, suite: m[2] === 'describe' || m[2] === 'suite', inactif, ouvrante, fin });
  }
  const englobantes = (a) => appels.filter((b) => b !== a && b.suite && b.ouvrante < a.ouvrante && a.ouvrante < b.fin);
  const tourne = (a) =>
    !a.inactif &&
    !englobantes(a).some((b) => b.inactif) &&
    (!a.suite || appels.some((t) => !t.suite && englobantes(t).includes(a) && tourne(t)));
  const actifs = new Set();
  const inactifs = new Set();
  for (const a of appels) if (a.titre !== null) (tourne(a) ? actifs : inactifs).add(a.titre);
  return { actifs, inactifs };
}

/** Titres des suites et des tests qui tournent, écrits en toutes lettres. */
export function titresDeTests(source) {
  return analyserTests(source).actifs;
}

/** Couverture des documents du dépôt. */
export function verifierCouverture(racine = RACINE) {
  const manquants = [];
  const lire = (chemin) => {
    try {
      return readFileSync(join(racine, chemin), 'utf8');
    } catch {
      manquants.push(`${chemin} est introuvable.`);
      return '';
    }
  };
  const resultat = verifierCouvertureTextes({
    invariants: lire(DOCUMENTS.invariants),
    contraintes: lire(DOCUMENTS.contraintes),
    gardes: lire(DOCUMENTS.gardes),
    fichiers: fichiersDuDepot(racine),
    lireFichier: (chemin) => {
      try {
        return readFileSync(join(racine, chemin), 'utf8');
      } catch {
        return null;
      }
    },
  });
  resultat.problemes.unshift(...manquants);
  return resultat;
}

// ─── Demandes d'une PR ───────────────────────────────────────────────────────────────────────

/** Vérifications manuelles d'une entrée et, de proche en proche, des entrées qui la couvrent. */
export function verificationsDe(id, entrees, vues = new Set()) {
  const e = entrees.get(id);
  if (!e || vues.has(id)) return [];
  vues.add(id);
  return [...e.verifications, ...e.couvertPar.flatMap((c) => verificationsDe(c, entrees, vues))];
}

/** Identifiants imposés par les fichiers modifiés, avec les fichiers qui les imposent. */
export function plancher(entrees, fichiersModifies) {
  const imposes = new Map();
  for (const e of entrees.values()) {
    const motifs = e.chemins.map(globVersRegex);
    const touches = fichiersModifies.filter((f) => motifs.some((re) => re.test(f)));
    if (touches.length) imposes.set(e.id, touches);
  }
  return new Map([...imposes].sort(([a], [b]) => ordreIds(a, b)));
}

/** Gardes présentes dans le registre de la base et absentes de celui de la PR. */
export function retraits(avant, apres) {
  const restantes = new Set([...apres.values()].flatMap((e) => e.verifications.map((v) => v.id)));
  const retirees = [];
  for (const e of avant.values()) {
    for (const v of e.verifications) {
      if (!restantes.has(v.id)) retirees.push({ cle: v.id, genre: 'vérification manuelle retirée', description: v.description });
    }
    const harnaisApres = new Set((apres.get(e.id)?.harnais ?? []).flatMap((h) => h.chemins));
    for (const h of e.harnais) {
      for (const chemin of h.chemins) {
        if (!harnaisApres.has(chemin)) retirees.push({ cle: `${e.id} · ${chemin}`, genre: 'harnais retiré', description: h.description });
      }
    }
  }
  return retirees;
}

function demandes(entrees, entreesAvant, declares) {
  const requises = new Map();
  for (const id of declares) {
    for (const v of verificationsDe(id, entrees)) {
      if (!requises.has(v.id)) requises.set(v.id, { cle: v.id, pourquoi: v.entree === id ? id : `${id}, par ${v.entree}`, description: v.description, consigne: v.description });
    }
  }
  for (const r of retraits(entreesAvant, entrees)) {
    if (!requises.has(r.cle)) requises.set(r.cle, { cle: r.cle, pourquoi: r.genre, description: r.description, ...(r.genre === 'vérification manuelle retirée' ? { consigne: r.description } : {}) });
  }
  return requises;
}

/**
 * Lignes d'une description telles que GitHub les montre en texte : commentaires HTML retirés, blocs
 * de code clôturés (trois accents graves ou tildes ou plus) vidés. Un exemple de section cité en code
 * n'est donc jamais lu comme la déclaration de la PR (#60).
 */
function lignesHorsCode(corps) {
  let cloture = null;
  return String(corps ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((ligne) => {
      const m = ligne.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (cloture) {
        if (m && m[1][0] === cloture[0] && m[1].length >= cloture.length && !m[2].trim()) cloture = null;
        return '';
      }
      if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
        cloture = m[1];
        return '';
      }
      return ligne;
    });
}

/**
 * Titres et étiquettes ne se lisent qu'à trois espaces de renfoncement au plus : au-delà, GitHub
 * affiche un bloc de code.
 */
const TITRE_SECTION = /^ {0,3}##\s+Invariants et contraintes\s*#*\s*$/i;
const ETIQUETTES_PR = [
  ['Touchés', /^ {0,3}Touch[ée]s\s*:/i],
  ['Lien possible masqué', /^ {0,3}Liens?\s+possibles?\s+masqu[ée]s?\s*:/i],
];
/** Plage d'identifiants : « U1 à U3 », « U1–U3 », « U1-U3 ». */
const PLAGE = /\b([IUC])(\d+)\s*(?:à|au|–|—|-)\s*([IUC])(\d+)\b/gi;
const IDENTIFIANT_PR = /\b([IUC]\d+)\b/gi;

/** Identifiants d'une déclaration, en majuscules, plages dépliées ; une plage incohérente est refusée. */
function lireIdsDeclares(valeur, nom, problemes) {
  const ids = [];
  const reste = valeur.replace(PLAGE, (tout, l1, n1, l2, n2) => {
    const [a, b] = [Number(n1), Number(n2)];
    if (l1.toUpperCase() !== l2.toUpperCase() || b <= a) {
      problemes.push(`« ${nom} : » : « ${tout} » n'est pas une plage d'une même famille dans l'ordre (écrire par exemple U1 à U3, ou énumérer).`);
    } else {
      for (let n = a; n <= b; n++) ids.push(`${l1.toUpperCase()}${n}`);
    }
    return ' ';
  });
  for (const m of reste.matchAll(IDENTIFIANT_PR)) ids.push(m[1].toUpperCase());
  return ids;
}

/**
 * Lit la section « ## Invariants et contraintes » d'une description de PR ; `null` si elle manque.
 * `problemes` : ce que la lecture refuse plutôt que de le deviner (section ou ligne en double, plage
 * incohérente).
 */
export function lireDescriptionPr(corps) {
  const lignes = lignesHorsCode(corps);
  const debuts = lignes.flatMap((l, i) => (TITRE_SECTION.test(l) ? [i] : []));
  if (!debuts.length) return null;
  const problemes = [];
  if (debuts.length > 1) problemes.push(`La section « ## Invariants et contraintes » figure ${debuts.length} fois : n'en garder qu'une.`);
  const debut = debuts[0];
  const fin = lignes.findIndex((l, i) => i > debut && /^ {0,3}#{1,2}(\s|$)/.test(l));
  const section = lignes.slice(debut + 1, fin < 0 ? undefined : fin);

  // Une déclaration se poursuit sur les lignes suivantes, comme GitHub l'affiche, jusqu'à une ligne
  // vide, une puce, un titre ou l'autre étiquette.
  const finDeDeclaration = (l) =>
    !l.trim() || /^\s*(?:[-*+]|\d+[.)])\s/.test(l) || /^ {0,3}#{1,6}(\s|$)/.test(l) || ETIQUETTES_PR.some(([, e]) => e.test(l));
  const declaration = ([nom, etiquette]) => {
    const indices = section.flatMap((l, i) => (etiquette.test(l) ? [i] : []));
    if (!indices.length) return { absente: true, ids: [], aucun: false };
    if (indices.length > 1) problemes.push(`La ligne « ${nom} : » figure ${indices.length} fois : tout déclarer sur une seule.`);
    const morceaux = [section[indices[0]].replace(etiquette, '')];
    for (let j = indices[0] + 1; j < section.length && !finDeDeclaration(section[j]); j++) morceaux.push(section[j]);
    const valeur = morceaux.map((m) => m.trim()).join(' ').trim();
    const avant = problemes.length;
    const ids = lireIdsDeclares(valeur, nom, problemes);
    return { absente: false, ids, aucun: !ids.length && problemes.length === avant && /^aucun[es]*\.?$/i.test(valeur) };
  };

  const items = [];
  let item = null;
  let dansAnalyse = false;
  let dansTete = false;
  for (const ligne of section) {
    const tete = ligne.match(/^[-*]\s+(?:\[[ xX]\]\s+)?`([^`]+)`(.*)$/);
    if (tete) {
      item = { cle: tete[1].trim(), consigne: couper(tete[2])[1], analyse: '', validee: false };
      items.push(item);
      dansAnalyse = false;
      dansTete = true;
      continue;
    }
    if (!item) continue;
    if (/^\S/.test(ligne)) {
      item = null;
      continue;
    }
    const analyse = ligne.match(/^\s+[-*]\s+Analyse\b[^:]*:\s*(.*)$/i);
    const validation = ligne.match(/^\s+[-*]\s+\[([ xX])\]\s+Valid[ée]e/i);
    if (analyse) {
      item.analyse = analyse[1].trim();
      dansAnalyse = true;
      dansTete = false;
    } else if (validation) {
      item.validee = validation[1] !== ' ';
      dansAnalyse = false;
      dansTete = false;
    } else if (dansAnalyse && ligne.trim()) {
      item.analyse = `${item.analyse} ${ligne.trim()}`.trim();
    } else if (dansTete && ligne.trim()) {
      // La consigne recopiée peut être coupée comme dans le registre, avant la première sous-puce.
      if (/^\s+[-*+]\s/.test(ligne)) dansTete = false;
      else item.consigne = `${item.consigne} ${ligne.trim()}`.trim();
    }
  }

  return {
    touches: declaration(ETIQUETTES_PR[0]),
    masques: declaration(ETIQUETTES_PR[1]),
    items,
    problemes,
  };
}

/** Deux consignes se comparent mot pour mot, espaces et coupures de ligne mis à part. */
const memeTexte = (a, b) => String(a ?? '').replace(/\s+/g, ' ').trim() === String(b ?? '').replace(/\s+/g, ' ').trim();

/**
 * Ce qu'une PR doit encore faire. `aCorriger` : la description est incomplète ou fausse ;
 * `enAttente` : une vérification analysée attend la validation d'un développeur humain.
 */
export function verifierPr({ entrees, entreesAvant = new Map(), corps, fichiersModifies = [], validations }) {
  const aCorriger = [];
  const enAttente = [];
  const validees = [];
  const annulees = [];
  const nonEnregistrees = [];
  const imposes = plancher(entrees, fichiersModifies);
  const pr = lireDescriptionPr(corps);
  if (!pr) {
    aCorriger.push(`La description n'a pas de section « ## Invariants et contraintes » : la reprendre du modèle \`${DOCUMENTS.modele}\`.`);
    return { aCorriger, enAttente, validees, annulees, nonEnregistrees, declares: [], imposes, requises: new Map() };
  }

  aCorriger.push(...pr.problemes);
  for (const [nom, d] of [
    ['Touchés', pr.touches],
    ['Lien possible masqué', pr.masques],
  ]) {
    if (d.absente) aCorriger.push(`La ligne « ${nom} : » manque dans la section.`);
    else if (!d.ids.length && !d.aucun) aCorriger.push(`« ${nom} : » à remplir : des identifiants (I…, U…, C…) ou « aucun ».`);
  }

  const declares = [...new Set([...pr.touches.ids, ...pr.masques.ids])].sort(ordreIds);
  for (const id of declares) if (!entrees.has(id)) aCorriger.push(`${id} est déclaré mais n'a pas d'entrée dans ${G}.`);
  for (const [id, fichiers] of imposes) {
    if (!declares.includes(id)) {
      aCorriger.push(`${id} n'est pas déclaré alors que la PR modifie ${listeCourte(fichiers)} : l'ajouter à « Touchés » ou à « Lien possible masqué ».`);
    }
  }

  const requises = demandes(entrees, entreesAvant, declares);
  const connues = new Set([...requises.keys(), ...[...entrees.values()].flatMap((e) => e.verifications.map((v) => v.id))]);
  const listees = new Map();
  for (const item of pr.items) {
    if (listees.has(item.cle)) aCorriger.push(`\`${item.cle}\` figure deux fois.`);
    else if (!connues.has(item.cle)) aCorriger.push(`\`${item.cle}\` n'est ni une vérification manuelle de ${G} ni une garde retirée par la PR.`);
    else listees.set(item.cle, item);
  }
  for (const r of requises.values()) {
    if (!listees.has(r.cle)) aCorriger.push(`\`${r.cle}\` (${r.pourquoi}) est demandée mais ne figure pas sous « Vérifications manuelles ».`);
  }
  for (const item of listees.values()) {
    const consigne = requises.get(item.cle)?.consigne;
    if (consigne !== undefined && !memeTexte(item.consigne, consigne)) {
      // Tranché dans #60 : la consigne se recopie, pour que qui valide la lise dans la PR.
      aCorriger.push(
        item.consigne.trim()
          ? `\`${item.cle}\` : la consigne diffère de celle de ${G} ; la recopier mot pour mot après le tiret cadratin (\`demander\` l'écrit).`
          : `\`${item.cle}\` : consigne à recopier de ${G} après le tiret cadratin (\`demander\` l'écrit).`,
      );
      continue;
    }
    if (ANALYSE_VIDE.test(item.analyse)) aCorriger.push(`\`${item.cle}\` : analyse à écrire, par un développeur ou un agent.`);
    else if (!item.validee) enAttente.push(`\`${item.cle}\` : analysée, en attente de validation par un développeur humain.`);
    else if (!validations) validees.push(item.cle); // hors GitHub : rien pour dire quand la case a été cochée
    else {
      const v = etatValidation(item, validations);
      if (v.etat === 'validee') validees.push(item.cle);
      else if (v.etat === 'annulee') {
        annulees.push({ cle: item.cle, raisons: v.raisons });
        enAttente.push(`\`${item.cle}\` : validation annulée, ${v.raisons.join(' ; ')}. Relire, puis cocher de nouveau.`);
      } else {
        nonEnregistrees.push(item.cle);
        enAttente.push(`\`${item.cle}\` : case cochée sans validation enregistrée pour l'état actuel de la PR : la décocher, puis la cocher de nouveau.`);
      }
    }
  }
  return { aCorriger, enAttente, validees, annulees, nonEnregistrees, declares, imposes, requises };
}

// ─── Validations (#61) ──────────────────────────────────────────────────────────────────────────
// Une case « Validée » vaut pour le code de la PR au moment où elle est cochée (tranché, puis limité
// le 11 septembre). La vérification l'enregistre alors dans un commentaire que seul le compte de
// GitHub Actions écrit : tête et branche cible. Un commit qui modifie le code, ou un changement de
// branche cible, rend l'enregistrement caduc ; documentation, harnais et analyse, non.

/** Auteur des commentaires qui enregistrent les validations : un agent ne peut pas l'imiter. */
export const AUTEUR_HORODATAGE = 'github-actions[bot]';
const MARQUE_VALIDATION = /<!-- tirelire-validation (\[[\s\S]*?\]) -->/g;
const court = (sha) => String(sha).slice(0, 7);

export const analyseEcrite = (analyse) => !ANALYSE_VIDE.test(String(analyse ?? ''));

/** Empreinte de l'analyse, gardée pour mémoire : la réécrire n'annule pas la validation. */
export function empreinteAnalyse(analyse) {
  return createHash('sha256').update(String(analyse).replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);
}

/** Cases cochées d'une description. */
export function cochees(corps) {
  return new Set((lireDescriptionPr(corps ?? '')?.items ?? []).filter((i) => i.validee).map((i) => i.cle));
}

/** Validations enregistrées, dans l'ordre des commentaires ; les autres auteurs sont ignorés. */
export function lireHorodatages(commentaires) {
  const horodatages = [];
  for (const c of commentaires ?? []) {
    if (c?.user?.login !== AUTEUR_HORODATAGE) continue;
    for (const m of String(c.body ?? '').matchAll(MARQUE_VALIDATION)) {
      try {
        for (const h of JSON.parse(m[1])) {
          if (['cle', 'tete', 'cible', 'analyse'].every((k) => typeof h?.[k] === 'string')) horodatages.push(h);
        }
      } catch {
        // marque illisible : elle ne valide rien
      }
    }
  }
  return horodatages;
}

export function texteHorodatage(horodatages) {
  const [h] = horodatages;
  return [
    `**Validation enregistrée** par ${h.par}, le ${h.date.slice(0, 10)} à ${h.date.slice(11, 16)} UTC, sur \`${court(h.tete)}\` vers \`${h.cible}\` :`,
    '',
    ...horodatages.map((v) => `- \`${v.cle}\``),
    '',
    "Un commit qui modifie le code, ou un changement de branche cible, l'annulera ; documentation et harnais, non.",
    '',
    `<!-- tirelire-validation ${JSON.stringify(horodatages)} -->`,
  ].join('\n');
}

export function texteAnnulation(annulees, nonEnregistrees = []) {
  return [
    '**Validation annulée** : la PR a changé depuis.',
    '',
    ...annulees.map((a) => `- \`${a.cle}\` : ${a.raisons.join(' ; ')}.`),
    ...nonEnregistrees.map((cle) => `- \`${cle}\` : case cochée sans validation enregistrée pour l'état actuel de la PR.`),
    '',
    'Relire, puis cocher de nouveau la case.',
  ].join('\n');
}

/** Ce qui n'est pas du code : modifié après une validation, cela ne l'annule pas (#61). */
export const SANS_EFFET = Object.freeze({
  documentation: Object.freeze(['docs/**', '**/*.md']),
  harnais: Object.freeze(['**/test/**', '**/*.test.*']),
});
const SANS_EFFET_REGEX = [...SANS_EFFET.documentation, ...SANS_EFFET.harnais].map(globVersRegex);
export const fichiersDeCode = (fichiers) => fichiers.filter((f) => !SANS_EFFET_REGEX.some((r) => r.test(f)));
const SHA = /^[0-9a-f]{40}$/;

/**
 * Fichiers modifiés par les commits apportés depuis la validation, sans ceux de la branche cible :
 * une fusion propre de la cible n'ajoute rien, une résolution de conflit ajoute ses fichiers.
 * `null` quand on ne peut pas comparer, par exemple si la branche a été réécrite.
 */
export function fichiersDepuisValidation({ ancienne, base, tete, racine = RACINE }) {
  if (![ancienne, base, tete].every((sha) => SHA.test(String(sha)))) return null;
  const env = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('GIT_')));
  const git = (...a) => execFileSync('git', a, { cwd: racine, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  try {
    git('cat-file', '-e', `${ancienne}^{commit}`);
  } catch {
    try {
      git('fetch', '-q', 'origin', ancienne);
    } catch {
      return null;
    }
  }
  try {
    const sortie = git('log', '-z', '--format=', '--name-only', '--diff-merges=dense-combined', `^${ancienne}`, `^${base}`, tete);
    return [...new Set(sortie.split('\0').map((f) => f.trim()).filter(Boolean))];
  } catch {
    return null;
  }
}

/** Où en est la case cochée d'une vérification : validée, annulée (et pourquoi), ou non enregistrée. */
export function etatValidation(item, { tete, cible, horodatages, fichiersDepuis = () => null }) {
  const dernier = horodatages.filter((h) => h.cle === item.cle).at(-1);
  if (!dernier) return { etat: 'non-enregistree' };
  if (dernier.cible !== cible) return { etat: 'annulee', raisons: [`branche cible changée, de ${dernier.cible} à ${cible}`] };
  if (dernier.tete === tete) return { etat: 'validee' };
  const de = `de ${court(dernier.tete)} à ${court(tete)}`;
  const fichiers = fichiersDepuis(dernier.tete, tete);
  if (!fichiers) return { etat: 'annulee', raisons: [`nouveaux commits depuis la validation, ${de}, impossibles à comparer`] };
  const code = fichiersDeCode(fichiers);
  if (code.length) return { etat: 'annulee', raisons: [`code modifié depuis la validation, ${de} : ${listeCourte(code)}`] };
  return { etat: 'validee' };
}

/** Décoche la case « Validée » des vérifications désignées, sans rien toucher d'autre. */
export function decocher(corps, cles) {
  const lignes = String(corps ?? '').split('\n');
  let courante = null;
  for (let i = 0; i < lignes.length; i++) {
    const tete = lignes[i].match(/^\s*[-*]\s+`([^`]+)`/);
    if (tete) courante = tete[1];
    else if (/^#{1,6}\s/.test(lignes[i])) courante = null;
    else if (courante && cles.includes(courante)) lignes[i] = lignes[i].replace(/^(\s*[-*]\s+)\[[xX]\](?=\s+Validée)/, '$1[ ]');
  }
  return lignes.join('\n');
}

/** Section à coller dans la description : plancher des chemins et vérifications à analyser. */
export function preparerSection({ entrees, entreesAvant = new Map(), fichiersModifies = [], ids = [], auteur = 'agent', date }) {
  const imposes = plancher(entrees, fichiersModifies);
  const touches = [...new Set([...imposes.keys(), ...ids])].sort(ordreIds);
  const requises = demandes(entrees, entreesAvant, touches);
  const lignes = [
    '## Invariants et contraintes',
    '',
    `Touchés : ${touches.length ? touches.join(', ') : 'à analyser'}`,
    'Lien possible masqué : à analyser',
    '',
    '### Vérifications manuelles',
    '',
  ];
  if (!requises.size) lignes.push('Aucune pour les identifiants déclarés.');
  for (const r of requises.values()) {
    lignes.push(`- \`${r.cle}\` · ${r.pourquoi} — ${r.description}`, `  - Analyse (${auteur}, ${date}) : à écrire`, '  - [ ] Validée par un développeur humain');
  }
  if (imposes.size) lignes.push('', `Plancher des chemins : ${[...imposes].map(([id, f]) => `${id} ← ${listeCourte(f)}`).join(' ; ')}.`);
  return lignes.join('\n');
}

/** Bilan lisible, pour la console et le résumé de GitHub Actions. */
export function resumePr({ aCorriger, enAttente, validees, declares, imposes, requises }) {
  const l = ['### Invariants et contraintes', ''];
  l.push(`Déclarés : ${declares.length ? declares.join(', ') : 'aucun'}.`);
  if (imposes.size) l.push(`Imposés par les fichiers modifiés : ${[...imposes].map(([id, f]) => `${id} (${listeCourte(f)})`).join(' ; ')}.`);
  l.push('');
  if (aCorriger.length) l.push('**À corriger**', '', ...aCorriger.map((p) => `- ${p}`), '');
  if (enAttente.length) l.push('**En attente de validation humaine**', '', ...enAttente.map((p) => `- ${p}`), '');
  if (validees.length) l.push('**Validées**', '', ...validees.map((c) => `- \`${c}\``), '');
  if (!aCorriger.length && !enAttente.length) {
    l.push(requises.size ? 'Toutes les vérifications demandées sont validées.' : 'Aucune vérification manuelle demandée.');
  }
  return l.join('\n');
}
