/**
 * Garde du projet (#58).
 *
 * Deux vérifications, sans dépendance :
 *
 * - **Couverture.** Chaque invariant de `docs/invariants.md` (I…, et les usages U… d'I3) et chaque
 *   contrainte de `docs/contraintes.md` (C…) a son entrée dans `docs/gardes.md`, gardée par au
 *   moins un harnais qui existe, une vérification manuelle décrite, ou un renvoi vers des entrées
 *   elles-mêmes gardées. Chaque harnais cite en plus son témoin rouge — ou porte « à bâtir » avec
 *   l'issue qui le doit (#66) ; qu'un témoin rouge sache vraiment échouer n'est pas du ressort de
 *   la couverture, mais de l'outil de test qui le fait tourner.
 * - **Demandes d'une PR.** L'issue qu'elle ferme (`Close #n`) déclare, dans sa section « Invariants
 *   et contraintes », les identifiants que la PR touche et ceux dont le lien pourrait être masqué ;
 *   les motifs `Chemins` du registre en imposent un plancher ; chaque vérification manuelle qui s'y
 *   rattache, et chaque garde retirée du registre, y figure avec sa consigne recopiée. Aucune case :
 *   la fusion de la PR vaut validation (#168).
 *
 * Tout travaille sur des textes et des listes de fichiers : les tests nourrissent ces fonctions de
 * documents inventés, `cli.mjs` de ceux du dépôt.
 */
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
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
  modele: '.github/ISSUE_TEMPLATE/besoin.md',
  description: 'docs/description-projet.md',
  glossaire: 'docs/glossaire.md',
});

/** Étiquettes admises en tête d'une ligne d'entrée du registre. */
export const ETIQUETTES = Object.freeze(['Harnais', 'Vérification manuelle', 'Couvert par', 'À bâtir']);

// ─── Règles primaires (#64) ──────────────────────────────────────────────────────────────────
// Changer une règle reste libre : toute PR peut ajouter une décision, faire évoluer la garde ou les
// règles des sessions. Ce qui se vérifie, c'est que la règle nouvelle ne contredit pas les règles
// primaires. La conformité porte sur le sens et ne se programme pas : l'auditeur la vérifie en
// relisant, et la fusion vaut validation (D82). Sur une PR, la garde qui juge
// est celle de la base, appliquée au contenu de la PR, qu'elle lit par git sans l'extraire (#159,
// `verifierCouvertureA`).

/**
 * Familles de chemins dont la modification ajoute ou change une règle. Une table à part du registre,
 * parce qu'une entrée du registre porte un invariant ou une contrainte, et que `CLAUDE.md`, les
 * décisions et la garde n'en sont pas. `docs/gardes.md` y figure depuis l'accord du porteur du
 * 12 septembre : `retraits()` voit une garde retirée du registre, pas une consigne affaiblie.
 */
/**
 * La garde elle-même, nommée à part : c'est cette famille-là qui demande en plus de dire ce qui
 * couvre ce qu'on y change (#89), là où la conformité aux règles primaires (#64) porte sur toutes.
 */
/**
 * Ce qui ne change qu'à la demande du porteur (#64) : les invariants, et la description du projet
 * qui les fonde — son texte, mot pour mot, que seul le porteur complète ou corrige (D77).
 * Son accord peut s'écrire dans une ligne « Accord du porteur : … » de la section : la garde la lit
 * (une seule par section) mais ne l'exige pas ; l'auditeur le vérifie en relisant.
 */

const G = DOCUMENTS.gardes;
const IDENTIFIANT = /\b([IUC]\d+)\b/g;
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
 * Une ligne qui prolonge « Chemins » : rien que des chemins entre accents graves et des virgules.
 * Tout le reste — une phrase, une étiquette, une ligne vide — ferme la liste.
 */
function suiteDeChemins(ligne) {
  return /^\s*`[^`]+`(\s*,\s*`[^`]+`)*\s*,?\s*$/.test(ligne);
}

/**
 * Lit `docs/gardes.md`. Une entrée commence à un titre dont le texte commence par un identifiant
 * (`## I7 · …`, `### U1 · …`) et finit au titre suivant ; un titre sans identifiant ne porte rien.
 */
export function lireRegistre(texte) {
  const entrees = new Map();
  const problemes = [];
  let entree = null;
  let suite = null; // élément qu'une ligne indentée prolonge
  let cheminsEnCours = null; // entrée dont la ligne « Chemins » se prolonge en dessous
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
        cheminsEnCours = entree;
        return;
      }
      // Une liste de chemins trop longue pour une ligne se prolonge en dessous : la ligne suivante
      // ne porte alors que des chemins entre accents graves et des virgules. La lire évite qu'un
      // chemin écrit au registre soit ignoré en silence, et le plancher de l'entrée s'en trouve
      // plus étroit que ce qu'elle annonce.
      if (cheminsEnCours === entree && suiteDeChemins(ligne)) {
        entree.chemins.push(...entreGraves(ligne));
        return;
      }
      cheminsEnCours = null;
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
  const sautsSousCondition = new Set();
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
      const rouge = temoinRouge(h.description);
      if (!rouge) {
        problemes.push(
          `${ou} : le harnais \`${h.chemins.join(', ')}\` ne cite pas de témoin rouge (assertions rejouées sur une version cassée du besoin) ni ne le porte « à bâtir » avec une issue (#66).`,
        );
      } else if (rouge.nom && lireFichier && presents.length) {
        const analyses = presents.map((c) => analyserTests(lireFichier(c) ?? ''));
        if (!analyses.some((a) => a.actifs.has(rouge.nom))) {
          const pourquoi = analyses.some((a) => a.inactifs.has(rouge.nom))
            ? 'il y figure sans tourner : désactivé, seulement prévu, dans une suite désactivée, ou suite sans test actif'
            : 'renommé, supprimé ou mis en commentaire ?';
          problemes.push(`${ou} : le témoin rouge « ${rouge.nom} » ne tourne dans aucun de ${presents.map((c) => `\`${c}\``).join(', ')} (${pourquoi}).`);
        }
      }
      for (const c of lireFichier ? presents : []) {
        if (!analyserTests(lireFichier(c) ?? '').conditionnels) continue;
        sautsSousCondition.add(c);
        if (!exigeSesOutils(c, lireFichier, existe)) {
          problemes.push(`${ou} : le harnais \`${c}\` se saute sous condition sans rendre son outil obligatoire en CI : lire \`TIRELIRE_STRICT\` et échouer quand l'outil manque (#59).`);
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
  // Un harnais qui se saute faute d'outil ne compte que parce que la CI rend l'outil obligatoire (#59).
  if (sautsSousCondition.size && !etapeTestsStricte(lireFichier(CI_WORKFLOW))) {
    problemes.push(
      `${CI_WORKFLOW} : l'étape « pnpm test » ne pose pas \`TIRELIRE_STRICT\`, alors que ${listeCourte([...sautsSousCondition].sort())} se sautent faute d'outil : ils passeraient pour verts en CI.`,
    );
  }
  return { problemes, ids, entrees };
}

export const CI_WORKFLOW = '.github/workflows/ci.yml';

/**
 * L'étape `pnpm test` du workflow pose-t-elle `TIRELIRE_STRICT` à une valeur vraie, dans son `env`,
 * celui de son job ou celui du workflow ? Lecture par renfoncement, commentaires retirés, sans
 * dépendance YAML : la forme du `ci.yml` du dépôt, pas toutes celles que YAML permet.
 */
export function etapeTestsStricte(yaml) {
  const lignes = String(yaml ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '').replace(/\s+$/, ''));
  const renfoncement = (l) => l.length - l.trimStart().length;
  const finDuBloc = (debut) => {
    let fin = debut + 1;
    while (fin < lignes.length && (!lignes[fin].trim() || renfoncement(lignes[fin]) > renfoncement(lignes[debut]))) fin++;
    return fin;
  };
  const posee = (debut, fin, niveau) => {
    for (let i = debut; i < fin; i++) {
      if (renfoncement(lignes[i]) !== niveau || !/^\s*env:$/.test(lignes[i])) continue;
      for (let j = i + 1; j < fin && (!lignes[j].trim() || renfoncement(lignes[j]) > niveau); j++) {
        const m = lignes[j].match(/^\s*TIRELIRE_STRICT\s*:\s*(.*)$/);
        if (m && !/^(?:['"]?(?:0|false)?['"]?)$/i.test(m[1].trim())) return true;
      }
    }
    return false;
  };
  // `pnpm test`, ou `pnpm test N` : les tests jusqu'au niveau N, de 0 à 4 (#238).
  const etape = lignes.findIndex((l) => /^\s*(?:-\s+)?run:\s*pnpm\s+(?:-r\s+)?test(?:\s+[0-4])?$/.test(l));
  if (etape < 0) return false;
  let tiret = etape;
  if (!/^\s*-\s/.test(lignes[etape])) {
    do tiret--;
    while (tiret >= 0 && !(/^\s*-\s/.test(lignes[tiret]) && renfoncement(lignes[tiret]) < renfoncement(lignes[etape])));
  }
  if (tiret < 0) return false;
  if (posee(tiret + 1, finDuBloc(tiret), renfoncement(lignes[tiret]) + 2)) return true;
  let steps = tiret;
  while (steps >= 0 && !(/^\s*steps:$/.test(lignes[steps]) && renfoncement(lignes[steps]) < renfoncement(lignes[tiret]))) steps--;
  if (steps >= 0) {
    let job = steps;
    while (job >= 0 && !(lignes[job].trim() && renfoncement(lignes[job]) < renfoncement(lignes[steps]))) job--;
    if (job >= 0 && posee(job + 1, finDuBloc(job), renfoncement(lignes[steps]))) return true;
  }
  return posee(0, lignes.length, 0);
}

/** Nom du test qu'une ligne « Harnais » désigne : entre guillemets, en tête de ce qu'elle garde (#59). */
export function testNomme(description) {
  const m = String(description ?? '').match(/^«\s*(.+?)\s*»/);
  return m ? m[1].replace(/\s+/g, ' ') : null;
}

/**
 * Témoin rouge cité en fin d'une ligne « Harnais » : `Témoin rouge : « nom du test »`, ou la dette
 * `Témoin rouge : à bâtir (#123)` (#66). `null` si la ligne n'en cite aucun.
 */
const TEMOIN_ROUGE = /Témoin rouge\s*:\s*(?:«\s*(.+?)\s*»|à\s+bâtir\s*\(#(\d+)\))\s*\.?\s*$/i;
export function temoinRouge(description) {
  const m = String(description ?? '').match(TEMOIN_ROUGE);
  if (!m) return null;
  return m[1] ? { nom: m[1].replace(/\s+/g, ' ') } : { aBatir: m[2] };
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

/**
 * Une suite dont le titre commence par un niveau, `[niveau N]` (N de 0 à 4), n'est qu'une enveloppe :
 * elle range les tests qu'elle englobe à ce niveau, et ne garde rien par elle-même (#238).
 */
export const ENVELOPPE_DE_NIVEAU = /^\[niveau [0-4]\](?:\s|$)/;

/**
 * Appels de tests d'un fichier, dans l'ordre du texte : titre (`null` s'il n'est pas écrit en toutes
 * lettres), suite ou test, désactivé, conditionnel, et les suites qui l'englobent, de la plus
 * lointaine à la plus proche (`englobantes`). Sert à `analyserTests`, et à la lecture des niveaux
 * (`niveaux.mjs`, #232).
 */
export function appelsDeTests(source) {
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
    let conditionnel = modificateurs.includes('skipIf') || modificateurs.includes('runIf');
    const options = chaine && masque.slice(chaine.fin + 1).match(/^\s*,\s*\{/);
    if (options) {
      const accolade = chaine.fin + options[0].length;
      const texteOptions = masque.slice(accolade, fermante(masque, accolade));
      // `{ skip: true }` ou `{ todo: 'raison' }` désactivent ; `{ skip: !php }` est conditionnel, comme skipIf.
      inactif ||= /\b(?:skip|todo)\s*:\s*(?:true\b|['"`])/.test(texteOptions);
      conditionnel ||= /\b(?:skip|todo)\s*:\s*(?!true\b|false\b|null\b|undefined\b|0\b|['"`])\S/.test(texteOptions);
    }
    const titre = chaine?.valeur == null ? null : chaine.valeur.replace(/\s+/g, ' ').trim();
    appels.push({ titre, suite: m[2] === 'describe' || m[2] === 'suite', inactif, conditionnel, debut: m.index, ouvrante, fin });
  }
  for (const a of appels) a.englobantes = appels.filter((b) => b !== a && b.suite && b.ouvrante < a.ouvrante && a.ouvrante < b.fin);
  return appels;
}

/**
 * Suites et tests d'un fichier, et les titres de ceux qui tournent ; `enveloppes` : les titres des
 * suites de niveau (`ENVELOPPE_DE_NIVEAU`), qui figurent aussi dans `actifs` ou `inactifs`.
 */
export function analyserTests(source) {
  const appels = appelsDeTests(source);
  const englobantes = (a) => a.englobantes;
  const tourne = (a) =>
    !a.inactif &&
    !englobantes(a).some((b) => b.inactif) &&
    (!a.suite || appels.some((t) => !t.suite && englobantes(t).includes(a) && tourne(t)));
  const actifs = new Set();
  const inactifs = new Set();
  const enveloppes = new Set();
  for (const a of appels) {
    if (a.titre === null) continue;
    (tourne(a) ? actifs : inactifs).add(a.titre);
    if (a.suite && ENVELOPPE_DE_NIVEAU.test(a.titre)) enveloppes.add(a.titre);
  }
  return { actifs, inactifs, enveloppes, conditionnels: appels.filter((a) => a.conditionnel).length };
}

/**
 * Un test qui se saute faute d'outil compte comme un test qui tourne, parce qu'en CI
 * `TIRELIRE_STRICT` rend l'outil obligatoire (#59). Le fichier, ou un module qu'il importe, doit
 * donc lire cette variable ailleurs qu'en commentaire.
 */
function exigeSesOutils(chemin, lireFichier, existe, vus = new Set()) {
  if (vus.has(chemin) || vus.size > 20) return false;
  vus.add(chemin);
  const source = lireFichier(chemin) ?? '';
  if (/\bTIRELIRE_STRICT\b/.test(masquer(source).masque)) return true;
  for (const m of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const cible = posix.join(posix.dirname(chemin), m[1]);
    const trouve = [cible, cible.replace(/\.[mc]?js$/, '.ts'), `${cible}.ts`, `${cible}.mjs`, `${cible}.js`, `${cible}/index.ts`].find((x) => existe.has(x));
    if (trouve && exigeSesOutils(trouve, lireFichier, existe, vus)) return true;
  }
  return false;
}

/** Titres des suites et des tests qui tournent, écrits en toutes lettres. */
export function titresDeTests(source) {
  return analyserTests(source).actifs;
}

/**
 * Couverture à partir d'une liste de fichiers et d'un lecteur, qui rend `null` pour un fichier absent.
 * `ou` situe ce qui est lu dans les messages : rien pour la copie de travail, le commit sinon.
 */
function couvertureDe({ fichiers, lireFichier, ou = '' }) {
  const manquants = [];
  const lire = (chemin) => {
    const texte = lireFichier(chemin);
    if (texte == null) manquants.push(`${chemin} est introuvable${ou}.`);
    return texte ?? '';
  };
  const gardes = lire(DOCUMENTS.gardes);
  const resultat = verifierCouvertureTextes({ invariants: lire(DOCUMENTS.invariants), contraintes: lire(DOCUMENTS.contraintes), gardes, fichiers, lireFichier });
  // Un registre présent dont cette version de la garde ne reconnaît aucune entrée : son format a changé,
  // ou il est illisible. Sur une PR, c'est la garde de la base qui ne sait pas lire ce que la PR propose (#159).
  if (gardes.trim() && !resultat.entrees.size) {
    manquants.push(`${DOCUMENTS.gardes}${ou} ne se lit pas : cette version de la garde n'y reconnaît aucune entrée. Si la PR change le format du registre, la garde de la base ne sait pas la juger : c'est au porteur de trancher.`);
  }
  resultat.problemes.unshift(...manquants);
  return resultat;
}

/** Couverture des documents du dépôt, tels que la copie de travail les porte. */
export function verifierCouverture(racine = RACINE) {
  return couvertureDe({
    fichiers: fichiersDuDepot(racine),
    lireFichier: (chemin) => {
      try {
        return readFileSync(join(racine, chemin), 'utf8');
      } catch {
        return null;
      }
    },
  });
}

/**
 * Couverture des documents d'un commit (#159) : registre, invariants, contraintes, harnais et workflow
 * se lisent par git dans `ref`, sans extraire l'arbre ni rien exécuter. La garde juge ainsi un arbre
 * qui n'est pas le sien : en CI, la garde de la base juge le commit de la PR.
 */
export function verifierCouvertureA(ref, depot = RACINE) {
  const git = (...a) => execFileSync('git', a, { cwd: depot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const fichiers = git('ls-tree', '-r', '-z', '--full-tree', ref)
    .split('\0')
    .filter(Boolean)
    .filter((ligne) => ligne.split('\t')[0].split(' ')[1] === 'blob')
    .map((ligne) => ligne.slice(ligne.indexOf('\t') + 1));
  const existe = new Set(fichiers);
  const lus = new Map();
  const lireFichier = (chemin) => {
    if (!existe.has(chemin)) return null;
    if (!lus.has(chemin)) lus.set(chemin, git('show', `${ref}:${chemin}`));
    return lus.get(chemin);
  };
  return couvertureDe({ fichiers, lireFichier, ou: ` dans le commit jugé (${ref.slice(0, 12)})` });
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

function demandes(entrees, entreesAvant, declares, fichiersModifies = []) {
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
/** Accord explicite du porteur sur un changement d'invariant (#64) : une ligne de la section. */
const ACCORD_PORTEUR = /^ {0,3}Accord\s+du\s+porteur\s*:/i;
const ETIQUETTES_PR = [
  ['Touchés', /^ {0,3}Touch[ée]s\s*:/i],
  ['Lien possible masqué', /^ {0,3}Liens?\s+possibles?\s+masqu[ée]s?\s*:/i],
  ['Accord du porteur', ACCORD_PORTEUR],
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

  const indicesAccord = section.flatMap((l, i) => (ACCORD_PORTEUR.test(l) ? [i] : []));
  if (indicesAccord.length > 1) problemes.push(`La ligne « Accord du porteur : » figure ${indicesAccord.length} fois : n'en garder qu'une.`);
  let accord = { absente: true, valeur: '' };
  if (indicesAccord.length) {
    const morceaux = [section[indicesAccord[0]].replace(ACCORD_PORTEUR, '')];
    for (let j = indicesAccord[0] + 1; j < section.length && !finDeDeclaration(section[j]); j++) morceaux.push(section[j]);
    accord = { absente: false, valeur: morceaux.map((m) => m.trim()).join(' ').trim() };
  }

  const items = [];
  let item = null;
  let dansTete = false;
  for (const ligne of section) {
    const tete = ligne.match(/^[-*]\s+(?:\[[ xX]\]\s+)?`([^`]+)`(.*)$/);
    if (tete) {
      item = { cle: tete[1].trim(), consigne: couper(tete[2])[1] };
      items.push(item);
      dansTete = true;
      continue;
    }
    if (!item) continue;
    if (/^\S/.test(ligne)) {
      item = null;
      continue;
    }
    if (dansTete && ligne.trim()) {
      // La consigne recopiée peut être coupée comme dans le registre, avant la première sous-puce.
      if (/^\s+[-*+]\s/.test(ligne)) dansTete = false;
      else item.consigne = `${item.consigne} ${ligne.trim()}`.trim();
    }
  }

  // Plus de case « Validée » (#150) : la fusion vaut validation (#168) ; une case restée là ne
  // compte pour rien, cochée ou non.
  return {
    touches: declaration(ETIQUETTES_PR[0]),
    masques: declaration(ETIQUETTES_PR[1]),
    accord,
    items,
    problemes,
  };
}

/** Deux consignes se comparent mot pour mot, espaces et coupures de ligne mis à part. */
const memeTexte = (a, b) => String(a ?? '').replace(/\s+/g, ' ').trim() === String(b ?? '').replace(/\s+/g, ' ').trim();

/**
 * Ce qu'une PR doit encore faire : `aCorriger`, ce qui manque ou est faux dans la section que porte
 * `corps` — l'issue que la PR ferme. Rien n'attend de case : la fusion vaut validation.
 */
export function verifierPr({ entrees, entreesAvant = new Map(), corps, fichiersModifies = [] }) {
  const aCorriger = [];
  const imposes = plancher(entrees, fichiersModifies);
  const pr = lireDescriptionPr(corps);
  if (!pr) {
    aCorriger.push(`L'issue n'a pas de section « ## Invariants et contraintes » : la reprendre du modèle \`${DOCUMENTS.modele}\` (\`demander\` l'écrit).`);
    return { aCorriger, declares: [], imposes, requises: new Map() };
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

  const requises = demandes(entrees, entreesAvant, declares, fichiersModifies);
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
    }
  }
  return { aCorriger, declares, imposes, requises };
}

/** Mots par lesquels GitHub fait fermer une issue par une PR (« Close #12 », « fixes: #12 »…). */
const FERMETURE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b/gi;

/** Les issues qu'une description de PR ferme, hors blocs de code et commentaires, sans doublon. */
export function issuesFermees(corps) {
  const texte = lignesHorsCode(corps).join('\n');
  return [...new Set([...texte.matchAll(FERMETURE)].map((m) => Number(m[1])))];
}

export function preparerSection({ entrees, entreesAvant = new Map(), fichiersModifies = [], ids = [] }) {
  const imposes = plancher(entrees, fichiersModifies);
  const touches = [...new Set([...imposes.keys(), ...ids])].sort(ordreIds);
  const requises = demandes(entrees, entreesAvant, touches, fichiersModifies);
  const lignes = [
    '## Invariants et contraintes',
    '',
    `Touchés : ${touches.length ? touches.join(', ') : 'à analyser'}`,
    'Lien possible masqué : à analyser',
  ];
  lignes.push('', '### Vérifications manuelles', '');
  if (!requises.size) lignes.push('Aucune pour les identifiants déclarés.');
  for (const r of requises.values()) lignes.push(`- \`${r.cle}\` · ${r.pourquoi} — ${r.description}`);
  if (imposes.size) lignes.push('', `Plancher des chemins : ${[...imposes].map(([id, f]) => `${id} ← ${listeCourte(f)}`).join(' ; ')}.`);
  return lignes.join('\n');
}

/** Bilan lisible, pour la console et le résumé de GitHub Actions. */
export function resumePr({ aCorriger, declares, imposes, requises }) {
  const l = ['### Invariants et contraintes', ''];
  l.push(`Déclarés : ${declares.length ? declares.join(', ') : 'aucun'}.`);
  if (imposes.size) l.push(`Imposés par les fichiers modifiés : ${[...imposes].map(([id, f]) => `${id} (${listeCourte(f)})`).join(' ; ')}.`);
  l.push('');
  if (aCorriger.length) l.push('**À corriger**', '', ...aCorriger.map((p) => `- ${p}`), '');
  if (!aCorriger.length) {
    l.push(
      requises.size
        ? `À constater par le porteur sur la version de dev, après le passage en Ready, avant la fusion : ${[...requises.keys()].map((c) => `\`${c}\``).join(', ')}.`
        : 'Aucune vérification manuelle demandée.',
    );
  }
  return l.join('\n');
}

// ── Lanceurs locaux sans sortie (#113) ─────────────────────────────────────────────────────

/** Le préchargement de la garde, et son branchement sur vitest, relatifs à la racine. */
export const SANS_SORTIE = 'packages/gardes/sans-sortie.mjs';
export const SANS_SORTIE_VITEST = 'packages/gardes/sans-sortie-vitest.mjs';

const CONFIGS_VITEST = ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'vitest.config.mjs'];

/** Paquets du workspace (`pnpm-workspace.yaml`, motifs `dossier/*` ou chemins simples). */
export function paquetsDuWorkspace(racine = RACINE) {
  const texte = readFileSync(join(racine, 'pnpm-workspace.yaml'), 'utf8');
  const bloc = /^packages:\s*\n((?:[ \t]+.*\n?|\s*\n)*)/m.exec(texte)?.[1] ?? '';
  const motifs = [...bloc.matchAll(/^\s*-\s*['"]?([^'"#\s]+)['"]?/gm)].map((m) => m[1]);
  const paquets = [];
  for (const motif of motifs) {
    const dossiers = motif.endsWith('/*')
      ? readdirSync(join(racine, motif.slice(0, -2)), { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => posix.join(motif.slice(0, -2), d.name))
      : [motif];
    for (const d of dossiers.sort()) if (estFichier(join(racine, d, 'package.json'))) paquets.push(d);
  }
  return paquets;
}

/** Le script `node … --test` précharge-t-il, depuis `dossier`, le fichier attendu ? */
function precharge(script, racine, dossier, attendu) {
  return [...script.matchAll(/--import(?:=|\s+)(['"]?)([^'"\s]+)\1/g)].some((m) => resolve(racine, dossier, m[2]) === resolve(racine, attendu));
}

/**
 * Chaque lanceur local — le script `test` de chaque paquet du workspace — est
 * branché sur la garde : `node --test` précharge `sans-sortie.mjs`, vitest le prend en `setupFiles`
 * par `sans-sortie-vitest.mjs`. Rend la liste des manques, chacun nommant son lanceur.
 */
export function verifierLanceursLocaux(racine = RACINE) {
  const problemes = [];
  const lanceur = (nom, script, dossier) => {
    if (/(^|[\s;&|])node\b[^;&|]*--test\b/.test(script)) {
      if (!precharge(script, racine, dossier, SANS_SORTIE)) {
        problemes.push(`${nom} : \`${script}\` ne précharge pas \`${SANS_SORTIE}\` (\`node --import … --test\`) ; une connexion hors de la machine y passerait inaperçue (#113).`);
      }
    } else if (/(^|[\s;&|])vitest\b/.test(script)) {
      const config = CONFIGS_VITEST.find((c) => estFichier(join(racine, dossier, c)));
      const texte = config ? readFileSync(join(racine, dossier, config), 'utf8').replace(/\/\/.*$/gm, '') : '';
      const bloc = /setupFiles\s*:\s*\[([^\]]*)\]/.exec(texte)?.[1] ?? '';
      const branche = [...bloc.matchAll(/['"]([^'"]+)['"]/g)].some((m) => resolve(racine, dossier, m[1]) === resolve(racine, SANS_SORTIE_VITEST));
      if (!branche) {
        problemes.push(`${nom} : vitest ne prend pas \`${SANS_SORTIE_VITEST}\` dans les \`setupFiles\` de ${config ? `\`${posix.join(dossier, config)}\`` : 'sa configuration (absente)'} ; une connexion hors de la machine y passerait inaperçue (#113).`);
      }
    } else {
      problemes.push(`${nom} : lanceur \`${script}\` inconnu de la garde de #113 ; le brancher sur \`${SANS_SORTIE}\` et l'apprendre à \`verifierLanceursLocaux\`.`);
    }
  };
  const lirePaquet = (d) => JSON.parse(readFileSync(join(racine, d, 'package.json'), 'utf8'));
  for (const d of paquetsDuWorkspace(racine)) {
    const { name = d, scripts = {} } = lirePaquet(d);
    if (scripts.test) lanceur(`\`${name}\` (script test)`, scripts.test, d);
  }
  const { scripts = {} } = lirePaquet('.');
  return problemes;
}
