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
export function lireIdentifiants(invariants, contraintes) {
  const ids = new Map();
  const doublons = [];
  const ajouter = (id, titre, source) => {
    if (ids.has(id)) doublons.push(`${id} est défini deux fois (${ids.get(id).source}, ${source}).`);
    else ids.set(id, { id, titre: titre.trim(), source });
  };
  for (const ligne of String(invariants).split(/\r?\n/)) {
    const invariant = ligne.match(/^##\s+(I\d+)\s+·\s+(.+?)\s*$/);
    if (invariant) ajouter(invariant[1], invariant[2], DOCUMENTS.invariants);
    const usage = ligne.match(/^\s*[-*]\s+\*\*(U\d+)\s+·\s+(.+?)\.?\*\*/);
    if (usage) ajouter(usage[1], usage[2], DOCUMENTS.invariants);
  }
  for (const ligne of String(contraintes).split(/\r?\n/)) {
    const contrainte = ligne.match(/^##\s+(C\d+)\s+·\s+(.+?)\s*$/);
    if (contrainte) ajouter(contrainte[1], contrainte[2], DOCUMENTS.contraintes);
  }
  return { ids, doublons };
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

export function verifierCouvertureTextes({ invariants, contraintes, gardes, fichiers }) {
  const { ids, doublons } = lireIdentifiants(invariants, contraintes);
  const { entrees, problemes } = lireRegistre(gardes);
  problemes.unshift(...doublons);
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
      if (!requises.has(v.id)) requises.set(v.id, { cle: v.id, pourquoi: v.entree === id ? id : `${id}, par ${v.entree}`, description: v.description });
    }
  }
  for (const r of retraits(entreesAvant, entrees)) {
    if (!requises.has(r.cle)) requises.set(r.cle, { cle: r.cle, pourquoi: r.genre, description: r.description });
  }
  return requises;
}

/** Lit la section « ## Invariants et contraintes » d'une description de PR ; `null` si elle manque. */
export function lireDescriptionPr(corps) {
  const lignes = String(corps ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n');
  const debut = lignes.findIndex((l) => /^##\s+Invariants et contraintes\s*$/i.test(l.trim()));
  if (debut < 0) return null;
  const fin = lignes.findIndex((l, i) => i > debut && /^#{1,2}\s/.test(l));
  const section = lignes.slice(debut + 1, fin < 0 ? undefined : fin);

  const declaration = (etiquette) => {
    const ligne = section.find((l) => etiquette.test(l));
    if (ligne === undefined) return { absente: true, ids: [], aucun: false };
    const valeur = ligne.replace(etiquette, '').trim();
    const ids = [...valeur.matchAll(IDENTIFIANT)].map((m) => m[1]);
    return { absente: false, ids, aucun: !ids.length && /^aucun[es]*\.?$/i.test(valeur) };
  };

  const items = [];
  let item = null;
  let dansAnalyse = false;
  for (const ligne of section) {
    const tete = ligne.match(/^[-*]\s+(?:\[[ xX]\]\s+)?`([^`]+)`/);
    if (tete) {
      item = { cle: tete[1].trim(), analyse: '', validee: false };
      items.push(item);
      dansAnalyse = false;
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
    } else if (validation) {
      item.validee = validation[1] !== ' ';
      dansAnalyse = false;
    } else if (dansAnalyse && ligne.trim()) {
      item.analyse = `${item.analyse} ${ligne.trim()}`.trim();
    }
  }

  return {
    touches: declaration(/^\s*Touch[ée]s\s*:/i),
    masques: declaration(/^\s*Liens?\s+possibles?\s+masqu[ée]s?\s*:/i),
    items,
  };
}

/**
 * Ce qu'une PR doit encore faire. `aCorriger` : la description est incomplète ou fausse ;
 * `enAttente` : une vérification analysée attend la validation d'un développeur humain.
 */
export function verifierPr({ entrees, entreesAvant = new Map(), corps, fichiersModifies = [] }) {
  const aCorriger = [];
  const enAttente = [];
  const validees = [];
  const imposes = plancher(entrees, fichiersModifies);
  const pr = lireDescriptionPr(corps);
  if (!pr) {
    aCorriger.push(`La description n'a pas de section « ## Invariants et contraintes » : la reprendre du modèle \`${DOCUMENTS.modele}\`.`);
    return { aCorriger, enAttente, validees, declares: [], imposes, requises: new Map() };
  }

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
    if (ANALYSE_VIDE.test(item.analyse)) aCorriger.push(`\`${item.cle}\` : analyse à écrire, par un développeur ou un agent.`);
    else if (!item.validee) enAttente.push(`\`${item.cle}\` : analysée, en attente de validation par un développeur humain.`);
    else validees.push(item.cle);
  }
  return { aCorriger, enAttente, validees, declares, imposes, requises };
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
