/**
 * Empreintes et attestation des tests (#237, #266, D83).
 *
 * Chaque ensemble de tests — garde, cœur, relais, hébergement, interface sans navigateur, interface
 * dans le navigateur, harnais du besoin — a une empreinte : l'état, dans l'arbre jugé, des chemins
 * qu'il lit. Elle couvre tout le dépôt, sauf les chemins que la liste de l'ensemble écarte, chacun
 * avec sa raison ; un chemin oublié de la liste fait jouer plus, jamais moins.
 *
 * Un ensemble ne se rejoue pas sur une empreinte déjà trouvée verte, à un seuil au moins égal : par
 * l'outillage sur la branche (un crochet, ou la demande du codeur ou de l'auditeur), par la CI sur une
 * tête de la branche dont toute la CI a fini verte au Ready, ou parce que `main` a la même (la branche
 * ne change rien de ce qu'il lit). Aucun moment ne fait exception (porteur, 28/09 : « si l'empreinte
 * est verte, on ne joue pas les tests, c'est universel ») : le seuil 1 du Ready non plus. L'attestation
 * porte les empreintes trouvées vertes par l'outillage : seul l'outillage l'écrit
 * (`.githooks/attestation.mjs`), elle voyage sur `<branche>--attestation` et s'enrichit d'un push et
 * d'une session à l'autre. Le risque visé est l'erreur, pas la fraude (porteur, 27/09).
 *
 * Ce module ne fait que lire et décider, sans git ni réseau :
 * - `ENSEMBLES`, `lit`, `empreinteDe`, `empreintes` : ce que chaque ensemble lit, et son empreinte ;
 * - `texteDeLAttestation`, `lireLAttestation`, `fusionner` : l'attestation, un message de commit ;
 * - `planifier`, `verdictDuLancement` : ce qu'un crochet joue ou saute, et pourquoi ; ce qu'un
 *   lancement a donné ;
 * - `couvertureAuReady`, `couvertureApresFusion`, `couvre` : ce que la CI saute, par le fichier
 *   qu'elle passe à `pnpm test --attestation`, et la décision du lanceur (`lanceur.mjs`).
 */
import { createHash } from 'node:crypto';
import { niveauDesTitres } from './niveaux.mjs';

/**
 * Version 3 (#302) : une empreinte verte peut porter un `fichier` — le fichier de test, depuis la
 * racine, que tout lancement de l'outil de test atteste quand tous ses tests de niveau au plus le
 * seuil ont tourné et fini verts ; sans `fichier`, elle vaut pour tout l'ensemble. Une attestation de
 * version 2 se lit encore : elle ne porte que des ensembles.
 */
export const VERSION = 3;
const VERSIONS_LUES = [2, VERSION];
export const TITRE = 'Attestation de livraison de la branche';
/** Le statut que `apercu.yml` termine au Ready, sur la tête de la PR (#168). */
export const STATUT_DU_READY = 'Toute la CI sur ce commit';

// ─── Ce que chaque ensemble lit ─────────────────────────────────────────────────────────────────

const DOCUMENTATION = { motifs: ['docs/', '*.md', '.gitignore'], raison: 'la documentation : ses tests ne la lisent pas' };
const OUTILLAGE_CI = { motifs: ['.github/', '.githooks/'], raison: 'les workflows et les crochets lancent ses tests, qui ne les lisent pas' };
/**
 * De la garde, un ensemble d'un autre paquet ne lit que son lanceur et ce que celui-ci charge
 * (`lanceur.mjs`, `niveaux*.mjs`, `sans-sortie*.mjs`, `gardes.mjs`…) : ces modules restent lus, et un
 * module que le lanceur chargerait demain l'est déjà. Seuls les tests de la garde et ses tests de
 * développement, qu'aucun lanceur ne charge, sont écartés.
 */
const TESTS_DE_LA_GARDE = {
  motifs: ['packages/gardes/*.test.mjs', 'packages/gardes/dev/'],
  raison: "les tests de la garde et ses tests de développement : il ne lit de la garde que son lanceur et ce que celui-ci charge, qui restent lus",
};

/**
 * Les ensembles de tests, hors harnais du besoin. `ecartes` : les chemins que l'ensemble ne lit pas,
 * ou dont ce qu'il lit est vérifié par ce qui se joue quand ils changent, chacun avec sa raison.
 * Syntaxe des motifs, celle de `.gitignore` en plus petit : `dossier/` vaut pour tout ce qu'il
 * contient, un motif sans `/` vaut pour un nom de fichier partout, `*` ne franchit pas de `/`, et `!`
 * réintègre un chemin écarté ; le dernier motif qui s'applique décide.
 */
export const ENSEMBLES = Object.freeze([
  {
    // Ses tests de niveau 0 et 1 — harnais du registre, règle des niveaux (D81) — lisent le code, les
    // tests et les documents de tout le dépôt : rien n'est écarté. Le seuil 1 du Ready ne se joue plus
    // toujours (#266, point 4) : tout ce qu'ils lisent doit changer leur empreinte.
    id: 'garde',
    nom: 'garde',
    dossier: 'packages/gardes',
    ecartes: [],
  },
  {
    id: 'coeur',
    nom: 'cœur',
    dossier: 'packages/core',
    ecartes: [DOCUMENTATION, OUTILLAGE_CI, { motifs: ['apps/'], raison: "le cœur ne dépend d'aucune application (D84)" }, TESTS_DE_LA_GARDE],
  },
  {
    id: 'relais',
    nom: 'relais',
    dossier: 'apps/relay',
    ecartes: [
      DOCUMENTATION,
      OUTILLAGE_CI,
      { motifs: ['apps/web/', 'apps/hebergement/', 'packages/core/'], raison: "le relais n'importe ni l'interface, ni l'hébergement, ni le cœur" },
      TESTS_DE_LA_GARDE,
    ],
  },
  {
    // Ses tests lisent les workflows et parcourent tous les fichiers suivis (#141) : rien n'est écarté.
    id: 'hebergement',
    nom: 'hébergement',
    dossier: 'apps/hebergement',
    ecartes: [],
  },
  {
    id: 'interface',
    nom: 'interface sans navigateur',
    dossier: 'apps/web',
    navigateur: false,
    ecartes: [
      { motifs: ['docs/', '*.md', '.gitignore', '!docs/decisions.md'], raison: 'la documentation, hors `docs/decisions.md`, que lit `stockage-domaine.test.ts`' },
      OUTILLAGE_CI,
      { motifs: ['apps/relay/', 'apps/hebergement/'], raison: "l'interface ne les importe pas ; ses tests tiennent le relais en mémoire" },
      { motifs: ['apps/web/test/navigateur/'], raison: 'les tests navigateur : sans navigateur, le lanceur les écarte' },
      TESTS_DE_LA_GARDE,
    ],
  },
  {
    // La liste du point 9 de #237, telle quelle (#266, point 1).
    id: 'navigateur',
    nom: 'interface dans le navigateur',
    dossier: 'apps/web',
    navigateur: true,
    ecartes: [
      { motifs: ['docs/', '*.md', '.gitignore'], raison: 'la documentation : les tests navigateur ne la lisent pas' },
      OUTILLAGE_CI,
      { motifs: ['apps/hebergement/', 'apps/relay/'], raison: "les tests navigateur ne lisent ni l'hébergement ni le relais" },
      {
        motifs: ['packages/gardes/'],
        raison:
          "la garde : les tests navigateur la lisent par leur lanceur, mais l'interface sans navigateur, qui la lit par le même lanceur, et la garde, qui lit tout, se rejouent quand elle change (D83)",
      },
    ],
  },
]);

export const HARNAIS = Object.freeze({ id: 'harnais', nom: 'harnais du besoin' });
/** Tous les ensembles, harnais du besoin compris, dans l'ordre où les moments les disent. */
export const TOUS = Object.freeze([...ENSEMBLES.map((e) => e.id), HARNAIS.id]);
export const nomDe = (id) => (id === HARNAIS.id ? HARNAIS.nom : (ENSEMBLES.find((e) => e.id === id)?.nom ?? id));
const ensemble = (id) => ENSEMBLES.find((e) => e.id === id);

const MOTIFS = new Map();
/** Un motif s'applique-t-il à un chemin ? (`!` retiré par l'appelant.) */
export function correspond(motif, chemin) {
  let m = MOTIFS.get(motif);
  if (!m) {
    const echappe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\?/g, '[^/]').replace(/\*/g, '[^/]*');
    const nom = !motif.endsWith('/') && !motif.includes('/');
    m = { nom, motif: new RegExp(motif.endsWith('/') ? `^${echappe(motif)}` : `^${echappe(motif)}$`) };
    MOTIFS.set(motif, m);
  }
  return m.motif.test(m.nom ? chemin.split('/').at(-1) : chemin);
}

const LUS = new WeakMap();
/** L'ensemble lit-il ce chemin ? Tout chemin qu'aucun motif n'écarte est lu. Mis en cache par ensemble. */
export function lit(ensembleOuId, chemin) {
  const e = typeof ensembleOuId === 'string' ? ensemble(ensembleOuId) : ensembleOuId;
  let cache = LUS.get(e);
  if (!cache) LUS.set(e, (cache = new Map()));
  let lu = cache.get(chemin);
  if (lu !== undefined) return lu;
  lu = true;
  for (const { motifs } of e.ecartes) {
    for (const m of motifs) {
      const reintegre = m.startsWith('!');
      if (correspond(reintegre ? m.slice(1) : m, chemin)) lu = reintegre;
    }
  }
  cache.set(chemin, lu);
  return lu;
}

const hache = (texte) => createHash('sha256').update(texte).digest('hex');
const ligneDEntree = (x) => `${x.mode} ${x.objet}\t${x.chemin}`;

/**
 * Les entrées d'un arbre, telles que `git ls-tree -r -z <arbre>` les écrit :
 * `<mode> <type> <objet>\t<chemin>`, séparées par NUL (ou par des retours à la ligne).
 */
export function lireLesEntrees(texte) {
  return String(texte ?? '')
    .split(/\0|\n/)
    .filter(Boolean)
    .map((l) => {
      const tab = l.indexOf('\t');
      const [mode, , objet] = l.slice(0, tab).split(' ');
      return { mode, objet, chemin: l.slice(tab + 1) };
    });
}

/** L'empreinte d'un ensemble : l'état des chemins qu'il lit, dans ces entrées. */
export function empreinteDe(ensembleOuId, entrees) {
  const e = typeof ensembleOuId === 'string' ? ensemble(ensembleOuId) : ensembleOuId;
  const lignes = entrees.filter((x) => lit(e, x.chemin)).map(ligneDEntree).sort();
  return hache(`${e.id}\n${lignes.join('\n')}\n`);
}

/** L'ensemble du paquet d'un fichier du harnais du besoin, ou `null` hors de tout paquet. */
export function ensembleDuFichier(chemin) {
  if (chemin.startsWith('apps/web/test/navigateur/')) return 'navigateur';
  return ENSEMBLES.find((e) => !e.navigateur && chemin.startsWith(`${e.dossier}/`))?.id ?? null;
}

/**
 * L'empreinte du harnais du besoin : ses fichiers, et ce que lisent les ensembles de leurs paquets ;
 * `null` sans harnais. Un fichier hors de tout paquet compte comme lisant tout le dépôt.
 */
export function empreinteDuHarnais(fichiers, entrees) {
  const liste = [...new Set(fichiers ?? [])].filter(Boolean).sort();
  if (!liste.length) return null;
  const ids = [...new Set(liste.map(ensembleDuFichier))].sort();
  const parties = ids.map((id) => `${id ?? 'tout'}=${id ? empreinteDe(id, entrees) : hache(entrees.map(ligneDEntree).sort().join('\n'))}`);
  return hache(`harnais\n${liste.join('\n')}\n${parties.join('\n')}\n`);
}

/** Les empreintes de tous les ensembles dans ces entrées : `{ id: empreinte }`, `harnais` compris (ou `null`). */
export function empreintes(entrees, harnais = []) {
  const r = {};
  for (const e of ENSEMBLES) r[e.id] = empreinteDe(e, entrees);
  r[HARNAIS.id] = empreinteDuHarnais(harnais, entrees);
  return r;
}

// ─── L'attestation ──────────────────────────────────────────────────────────────────────────────

/** Combien d'empreintes vertes l'attestation garde par ensemble : les plus récentes. */
export const GARDEES = 30;

/** Le message du commit d'attestation : un titre, puis l'attestation en JSON. */
export function texteDeLAttestation({ branche, verts }) {
  const corps = { version: VERSION, branche, verts: fusionner(verts ?? []) };
  return `${TITRE} ${branche}\n\n${JSON.stringify(corps, null, 2)}\n`;
}

/** Lit un message de commit d'attestation ; rend `{ attestation }`, ou `{ raison }` s'il ne se lit pas. */
export function lireLAttestation(message) {
  const texte = String(message ?? '');
  if (!texte.startsWith(TITRE)) return { raison: "le commit ne porte pas d'attestation de cette forme" };
  let a;
  try {
    a = JSON.parse(texte.slice(texte.indexOf('{')));
  } catch {
    return { raison: "l'attestation ne se lit pas (JSON)" };
  }
  if (!VERSIONS_LUES.includes(a?.version)) return { raison: `version d'attestation inconnue (${a?.version})` };
  if (!Array.isArray(a.verts)) return { raison: "l'attestation ne liste pas ses empreintes vertes" };
  const verts = a.verts.filter(
    (v) =>
      TOUS.includes(v?.ensemble) &&
      /^[0-9a-f]{64}$/.test(v?.empreinte ?? '') &&
      Number.isInteger(v?.seuil) &&
      // Un fichier n'est attesté que dans l'ensemble de son paquet, jamais dans le harnais du besoin.
      (v.fichier === undefined || (typeof v.fichier === 'string' && ensembleDuFichier(v.fichier) === v.ensemble)),
  );
  return { attestation: { ...a, verts } };
}

/** Combien d'empreintes vertes l'attestation garde par fichier de test : les plus récentes. */
export const GARDEES_PAR_FICHIER = 3;
/** Combien d'empreintes vertes de fichiers l'attestation garde par ensemble, au plus. */
export const FICHIERS_GARDES = 600;

/**
 * Réunit des listes d'empreintes vertes : une par ensemble, fichier (s'il y en a un) et empreinte, au
 * plus haut seuil trouvé ; les `GARDEES` plus récentes de chaque ensemble, et, pour les fichiers, les
 * `GARDEES_PAR_FICHIER` plus récentes de chacun, `FICHIERS_GARDES` au plus par ensemble. Rien ne se
 * perd d'un push ou d'une session à l'autre, sinon les plus anciennes.
 */
export function fusionner(...listes) {
  const parCle = new Map();
  for (const v of listes.flat()) {
    if (!v) continue;
    const cle = `${v.ensemble} ${v.fichier ?? ''} ${v.empreinte}`;
    const deja = parCle.get(cle);
    if (!deja || v.seuil > deja.seuil || (v.seuil === deja.seuil && String(v.date ?? '') > String(deja.date ?? ''))) parCle.set(cle, v);
  }
  const recents = (a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''));
  const garde = [];
  for (const id of TOUS) {
    const siens = [...parCle.values()].filter((v) => v.ensemble === id).sort(recents);
    garde.push(...siens.filter((v) => v.fichier === undefined).slice(0, GARDEES));
    const parFichier = new Map();
    const fichiers = [];
    for (const v of siens) {
      if (v.fichier === undefined) continue;
      const n = parFichier.get(v.fichier) ?? 0;
      if (n >= GARDEES_PAR_FICHIER) continue;
      parFichier.set(v.fichier, n + 1);
      fichiers.push(v);
    }
    garde.push(...fichiers.slice(0, FICHIERS_GARDES));
  }
  return garde;
}

const court = (sha) => String(sha ?? '').slice(0, 10);

/** Qui a trouvé cette empreinte verte, sur quoi, à quel seuil. */
export function raisonDuVert(v) {
  const sur = v.commit ? `le commit ${court(v.commit)}` : `l'arbre ${court(v.arbre)}`;
  if (v.fichier !== undefined) return `fichier attesté vert par ${v.par ?? "l'outillage"}, sur ${sur}, au seuil ${v.seuil}`;
  return `empreinte trouvée verte par ${v.par ?? "l'outillage"}, sur ${sur}, au seuil ${v.seuil}`;
}

/**
 * Une empreinte est-elle déjà trouvée verte, pour cet ensemble, à un seuil au moins égal ?
 * `verts` : les empreintes vertes (attestation, CI) ; `references` : `[{ empreintes, seuil, raison }]`,
 * des états dont chaque empreinte compte comme verte jusqu'à `seuil` — `main`, le premier parent. Le
 * harnais du besoin n'en a pas. Rend la raison du saut, ou `null` : l'ensemble se joue.
 */
export function dejaVert({ id, empreinte, seuil, verts = [], references = [] }) {
  if (!empreinte) return null;
  // Une empreinte verte d'un fichier ne vaut que pour lui (#302) : jamais pour tout l'ensemble.
  const v = verts.filter((x) => x.fichier === undefined && x.ensemble === id && x.empreinte === empreinte && x.seuil >= seuil).sort((a, b) => b.seuil - a.seuil)[0];
  if (v) return raisonDuVert(v);
  if (id !== HARNAIS.id) {
    const r = references.find((x) => x.empreintes?.[id] === empreinte && x.seuil >= seuil);
    if (r) return r.raison;
  }
  return null;
}

// ─── Ce que joue un crochet ─────────────────────────────────────────────────────────────────────

/** Pourquoi les tests navigateur de non-régression ne se jouent pas à la livraison sans demande (#264). */
export const SANS_DEMANDE = 'tests navigateur de non-régression laissés au Ready faute de demande (pnpm livraison --navigateur)';

/**
 * Ce qu'un crochet joue ou saute. `seuil` : celui du moment (0 au pré-commit, 2 à la livraison) ;
 * `navigateur` : les tests navigateur de non-régression sont-ils demandés ? ; `harnais` : les
 * fichiers du harnais du besoin. Rend `[{ id, nom, jouer, seuil, empreinte, raison }]`, dans l'ordre
 * de `TOUS` ; le harnais du besoin se joue en entier (seuil 4).
 */
export function planifier({ empreintes: e, seuil, verts = [], references = [], navigateur = false, harnais = [] }) {
  return TOUS.map((id) => {
    const s = id === HARNAIS.id ? 4 : seuil;
    const base = { id, nom: nomDe(id), seuil: s, empreinte: e[id] ?? null };
    if (id === HARNAIS.id && !harnais.length) return { ...base, jouer: false, raison: 'aucun harnais du besoin' };
    if (id === 'navigateur' && !navigateur) return { ...base, jouer: false, raison: SANS_DEMANDE };
    const raison = dejaVert({ id, empreinte: e[id], seuil: s, verts, references });
    return raison ? { ...base, jouer: false, raison } : { ...base, jouer: true, raison: '' };
  });
}

/**
 * Ce qu'un lancement a donné (#266, point 3) : `{ etat }`, `etat` valant `vert`, `rouge`, `sauté`
 * (des tests se sont sautés faute d'outil : `docs/gardes.md`, « Un test qui se saute faute d'outil
 * compte comme un test qui tourne », donc pas vert sur son empreinte) ou `illisible`. `sorte` :
 * `vitest` ou `node` ; `journal` : sa sortie ; `rapport` : le rapport JSON de vitest, lu ou `null` ;
 * `seuil` : celui du lancement. Sous vitest, un test sauté ne compte que s'il est de niveau au plus
 * le seuil : ceux que le seuil écarte passent pour sautés dans le rapport.
 */
export function verdictDuLancement({ code, sorte, journal = '', rapport = null, seuil }) {
  if (String(code).trim() !== '0') return { etat: 'rouge' };
  let sautes = 0;
  if (sorte === 'vitest') {
    if (!Array.isArray(rapport?.testResults)) return { etat: 'illisible' };
    for (const f of rapport.testResults) {
      for (const a of f.assertionResults ?? []) {
        if ((a.status === 'skipped' || a.status === 'pending') && niveauDesTitres([...(a.ancestorTitles ?? []), a.title]) <= seuil) sautes++;
      }
    }
  } else {
    // node --test, rapporteur TAP : « ok N - titre # SKIP raison ».
    sautes = (String(journal).match(/^\s*(?:not )?ok \d+ .*# SKIP\b/gm) ?? []).length;
  }
  return sautes ? { etat: 'sauté', sautes } : { etat: 'vert' };
}

// ─── Ce que saute la CI ─────────────────────────────────────────────────────────────────────────

/** Les seuils que la CI joue au Ready, donc ceux qu'une tête verte au Ready couvre (D83). */
export const SEUILS_DU_READY = Object.freeze({ garde: 1, coeur: 1, relais: 1, hebergement: 1, interface: 1, navigateur: 2, harnais: 4 });
/**
 * Le seuil jusqu'auquel l'empreinte de `main`, ou du premier parent sur `main`, compte comme verte :
 * 2, celui où tout ce qui y est arrivé a été vérifié avant la fusion — la livraison, l'auditeur, les
 * tests navigateur au Ready (D83). Au tag, le seuil 3 n'est donc jamais couvert par `main`.
 */
export const SEUIL_DE_MAIN = 2;

/**
 * Les empreintes vertes qu'apporte une tête dont toute la CI a fini verte au Ready : chaque ensemble
 * au seuil que la CI y joue (`SEUILS_DU_READY`). `tete` : `{ sha, statut, empreintes }`.
 */
export function vertsDuReady(tete) {
  if (tete?.statut !== 'success' || !tete.empreintes) return [];
  return TOUS.filter((id) => tete.empreintes[id]).map((id) => ({
    ensemble: id,
    empreinte: tete.empreintes[id],
    seuil: SEUILS_DU_READY[id],
    par: `la CI au Ready (statut « ${STATUT_DU_READY} » vert)`,
    commit: tete.sha,
  }));
}

/** Pour chaque ensemble couvert, le plus haut seuil couvert et sa raison ; pour chaque fichier attesté vert sur l'empreinte de son ensemble, de même (#302). */
function couvertureDe({ origine, arbre, empreintes: e, verts, references, harnais, ids }) {
  const ensembles = {};
  for (const id of ids) {
    for (const s of [4, 3, 2, 1, 0]) {
      const raison = dejaVert({ id, empreinte: e[id], seuil: s, verts, references });
      if (raison) {
        ensembles[id] = { seuil: s, raison };
        break;
      }
    }
  }
  const fichiers = {};
  for (const v of verts ?? []) {
    if (v.fichier === undefined || !ids.includes(v.ensemble) || !e[v.ensemble] || v.empreinte !== e[v.ensemble]) continue;
    if (fichiers[v.fichier]?.seuil >= v.seuil) continue;
    fichiers[v.fichier] = { ensemble: v.ensemble, seuil: v.seuil, raison: raisonDuVert(v) };
  }
  const empreintesLues = {};
  for (const id of ids) if (e[id]) empreintesLues[id] = e[id];
  return { version: VERSION, origine, arbre, harnais: [...(harnais ?? [])].sort(), empreintes: empreintesLues, ensembles, fichiers };
}

const referenceDe = (quoi, commit, e) => ({ empreintes: e, seuil: SEUIL_DE_MAIN, raison: `rien de ce qu'il lit n'a changé depuis ${quoi} (${court(commit)})` });

/**
 * Ce que la CI peut sauter au Ready (#266, point 4), seuil 1 compris : ce que l'attestation, une tête
 * de la branche verte au Ready ou `main` couvre. `tetes` : `[{ sha, statut, empreintes }]` ; `main` :
 * `{ commit, empreintes }` ; `harnais` : ses fichiers.
 */
export function couvertureAuReady({ arbre, empreintes: e, verts = [], tetes = [], main = null, harnais = [] }) {
  const references = main ? [referenceDe('main', main.commit, main.empreintes)] : [];
  return couvertureDe({ origine: 'ready', arbre, empreintes: e, verts: [...verts, ...tetes.flatMap(vertsDuReady)], references, harnais, ids: TOUS });
}

/**
 * Sur `main`, après la fusion (point 4) : un ensemble ne se rejoue pas si son empreinte est celle
 * qu'il a sur la tête d'une PR dont toute la CI a fini verte au Ready, ou sur le premier parent du
 * commit arrivé. Le harnais du besoin ne s'y joue pas.
 */
export function couvertureApresFusion({ arbre, empreintes: e, tetes = [], parent = null }) {
  const references = parent ? [referenceDe('le premier parent', parent.commit, parent.empreintes)] : [];
  return couvertureDe({ origine: 'main', arbre, empreintes: e, verts: tetes.flatMap(vertsDuReady), references, harnais: [], ids: ENSEMBLES.map((x) => x.id) });
}

/** L'état du statut « Toute la CI sur ce commit » parmi les statuts d'un commit (API), ou `null`. */
export function etatDuStatut(statuts) {
  return (statuts ?? []).find((s) => s?.context === STATUT_DU_READY)?.state ?? null;
}

/** Options du lanceur qui prennent une valeur dans l'argument suivant. */
const AVEC_VALEUR = new Set(['--dir', '-t', '--testNamePattern', '--test-name-pattern', '--exclude', '--reporter', '--outputFile', '--config', '-c', '--root', '-r', '--project', '--test-reporter', '--test-reporter-destination', '--import']);

/**
 * Sépare les arguments d'un lancement : `options`, les options et leurs valeurs, dans l'ordre ;
 * `cibles`, les autres, telles qu'écrites.
 */
export function separerLesCibles(args) {
  const options = [];
  const cibles = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-')) {
      options.push(a);
      if (AVEC_VALEUR.has(a) && i + 1 < args.length) options.push(args[++i]);
      continue;
    }
    cibles.push(a);
  }
  return { options, cibles };
}

/** Les cibles d'un lancement : ses arguments qui ne sont ni des options, ni leurs valeurs. */
export function ciblesDesArguments(args) {
  return separerLesCibles(args).cibles.map((a) => a.replace(/^\.\//, '').replace(/\/+$/, ''));
}

const sousNavigateur = (c) => c === 'test/navigateur' || c.startsWith('test/navigateur/');

/**
 * Les ensembles qu'un lancement joue : `demande` = `{ dossier, navigateur, cibles }`, le paquet
 * relatif à la racine. Des cibles qui sont toutes des fichiers du harnais du besoin le désignent ;
 * dans l'interface, `--navigateur` ajoute l'ensemble du navigateur, seul si toutes les cibles sont
 * sous `test/navigateur/`. Rend `null` pour un paquet qui n'est celui d'aucun ensemble.
 */
export function ensemblesDeLaDemande(demande, harnais = []) {
  const { dossier, navigateur, cibles } = demande;
  if (cibles.length && cibles.every((c) => harnais.includes(`${dossier}/${c}`))) return [HARNAIS.id];
  const paquet = ENSEMBLES.find((e) => e.dossier === dossier && !e.navigateur);
  if (!paquet) return null;
  if (dossier !== 'apps/web' || !navigateur) return [paquet.id];
  if (cibles.length && cibles.every(sousNavigateur)) return ['navigateur'];
  return [paquet.id, 'navigateur'];
}

/**
 * La décision du lanceur. `couverture` : le fichier de la CI, `null` sans fichier ; `demande` :
 * `{ arbre, dossier, seuil, navigateur, cibles, nomme }`. Rend `{ couvert, raison }` : couvert, le
 * lancement se saute.
 */
export function couvre(couverture, demande) {
  if (!couverture || couverture.version !== VERSION) return { couvert: false, raison: 'aucune empreinte verte pour cet arbre : tout se joue' };
  if (couverture.arbre !== demande.arbre) {
    return { couvert: false, raison: `les empreintes visent l'arbre ${court(couverture.arbre)}, l'arbre extrait est ${court(demande.arbre)} : tout se joue` };
  }
  if (demande.nomme) return { couvert: false, raison: 'appel nommé : il se joue' };
  const ids = ensemblesDeLaDemande(demande, couverture.harnais ?? []);
  if (!ids) return { couvert: false, raison: `${demande.dossier} n'est le paquet d'aucun ensemble : tout se joue` };
  const manque = ids.filter((id) => !(couverture.ensembles?.[id]?.seuil >= demande.seuil));
  if (manque.length) return { couvert: false, raison: `${manque.map(nomDe).join(', ')} : aucune empreinte verte au seuil ${demande.seuil}, tout se joue` };
  return { couvert: true, raison: ids.map((id) => `${nomDe(id)} : ${couverture.ensembles[id].raison}`).join(' ; ') };
}

/**
 * Ce qu'un lancement de l'outil de test hors CI saute (#302) : ce que l'attestation de la branche
 * (locale, et distante telle que le dernier crochet l'a lue) ou `main` — la base commune de la
 * branche avec `main` — couvre. `origine` : `local` pour un lancement à la main, `livraison` pour la
 * livraison, qui passe le fichier au lanceur. Mêmes entrées que `couvertureAuReady`, sans têtes.
 */
export function couvertureLocale({ origine = 'local', arbre, empreintes: e, verts = [], main = null, harnais = [] }) {
  const references = main ? [referenceDe('main', main.commit, main.empreintes)] : [];
  return couvertureDe({ origine, arbre, empreintes: e, verts, references, harnais, ids: TOUS });
}

/**
 * Ce qu'un lancement saute, fichier par fichier (#302, points 4 et 6). `couverture` : celle de la
 * CI, de la livraison ou du lancement local (`null` sans) ; `demande` : `{ dossier, seuil,
 * navigateur, cibles, nomme }` ; `fichiers` : les fichiers de test que le lancement jouerait, depuis
 * la racine ; `jouees` : les empreintes du contenu joué, ou `null` quand il ne se lit pas (la
 * livraison joue alors l'extraction de l'arbre qu'elle juge, et sa couverture vaut pour lui).
 *
 * Un fichier se saute s'il est vert sur la même empreinte à un seuil au moins égal : attesté vert
 * lui-même, ou couvert avec tout son ensemble (ce que D83 saute par ensemble vaut pour tous ses
 * fichiers). Dans un lancement du harnais du besoin, seul ce qui couvre le harnais, ou le fichier
 * lui-même, le couvre. Un appel nommé ne saute rien. Rend `[{ fichier, ensemble, couvert, raison }]`.
 */
export function fichiersCouverts(couverture, demande, fichiers, jouees = null) {
  const harnais = couverture?.harnais ?? [];
  const lancementDuHarnais = ensemblesDeLaDemande(demande, harnais)?.[0] === HARNAIS.id;
  return fichiers.map((fichier) => {
    const ensemble = ensembleDuFichier(fichier);
    const joue = (raison) => ({ fichier, ensemble, couvert: false, raison });
    const saute = (raison) => ({ fichier, ensemble, couvert: true, raison });
    if (demande.nomme) return joue('appel nommé : il se joue');
    if (!couverture || couverture.version !== VERSION) return joue('aucune empreinte verte');
    if (!ensemble) return joue("hors de tout ensemble : il se joue");
    if (jouees && couverture.empreintes?.[ensemble] !== jouees[ensemble]) return joue(`le contenu joué n'a pas l'empreinte des empreintes vertes (${nomDe(ensemble)})`);
    if (lancementDuHarnais) {
      const h = couverture.ensembles?.[HARNAIS.id];
      const memeHarnais = !jouees || couverture.empreintes?.[HARNAIS.id] === jouees[HARNAIS.id];
      if (h?.seuil >= demande.seuil && harnais.includes(fichier) && memeHarnais) return saute(`harnais du besoin : ${h.raison}`);
    } else {
      const c = couverture.ensembles?.[ensemble];
      if (c?.seuil >= demande.seuil) return saute(c.raison);
    }
    const f = couverture.fichiers?.[fichier];
    if (f && f.ensemble === ensemble && f.seuil >= demande.seuil) return saute(f.raison);
    return joue(`aucune empreinte verte au seuil ${demande.seuil}`);
  });
}

/**
 * Ce que chaque fichier a donné dans un lancement (#302, points 1 et 2) : `Map(fichier → { etat,
 * seuil })`, `etat` valant `vert`, `rouge` ou `sauté` (un test de niveau au plus le seuil s'est
 * sauté, faute d'outil par exemple : pas vert sur son empreinte) ; `seuil` : 4 si aucun de ses tests
 * n'a été écarté par le seuil (joué en entier, niveau 4 compris), sinon celui du lancement. Rend
 * `null` si le lancement ne se lit pas : rouge sans qu'aucun fichier le soit, ou rapport absent.
 *
 * - vitest : `rapport`, son rapport JSON ; un test `todo` ne compte pas, comme dans
 *   `verdictDuLancement`.
 * - node : `lignes`, celles du rapporteur `rapport-fichiers.mjs`, qui nomme chaque fichier lancé ;
 *   `ecartes`, `Map(fichier → nombre)` des tests que le seuil n'a pas inscrits.
 */
export function fichiersDuLancement({ code, sorte, rapport = null, lignes = [], ecartes = new Map(), seuil }) {
  const r = new Map();
  if (sorte === 'vitest') {
    if (!Array.isArray(rapport?.testResults)) return null;
    for (const f of rapport.testResults) {
      let etat = f.status === 'failed' ? 'rouge' : 'vert';
      let ecarte = 0;
      for (const a of f.assertionResults ?? []) {
        const niveau = niveauDesTitres([...(a.ancestorTitles ?? []), a.title]);
        if (a.status === 'failed') etat = 'rouge';
        else if (a.status === 'skipped' || a.status === 'pending') {
          if (niveau > seuil) ecarte++;
          else if (etat !== 'rouge') etat = 'sauté';
        }
      }
      r.set(f.name, { etat, seuil: ecarte ? seuil : 4 });
    }
  } else {
    for (const l of lignes) {
      if (l.type === 'lance' && !r.has(l.fichier)) r.set(l.fichier, { etat: 'vert', seuil: ecartes.get(l.fichier) ? seuil : 4 });
    }
    for (const l of lignes) {
      const x = r.get(l.fichier);
      if (!x) continue;
      if (l.type === 'echec') x.etat = 'rouge';
      else if (l.type === 'saute' && x.etat !== 'rouge') x.etat = 'sauté';
    }
  }
  if (String(code).trim() !== '0' && ![...r.values()].some((x) => x.etat === 'rouge')) return null;
  return r;
}

/** Les lignes qui disent, dans la CI, ce que la couverture permet de sauter, ensemble par ensemble. */
export function resume(couverture) {
  if (!couverture) return ['Aucune empreinte verte pour cet arbre : la CI joue tout ce que D83 prévoit.'];
  const lignes = [];
  const ids = couverture.origine === 'main' ? ENSEMBLES.map((e) => e.id) : TOUS;
  for (const id of ids) {
    const c = couverture.ensembles?.[id];
    // Les fichiers attestés verts un à un (#302) : le lanceur les saute, et dit lesquels.
    const attestes = Object.entries(couverture.fichiers ?? {}).filter(([f, x]) => x.ensemble === id || (id === HARNAIS.id && couverture.harnais?.includes(f)));
    const seuils = [...new Set(attestes.map(([, x]) => x.seuil))].sort();
    const fichiers = attestes.length ? ` ; ${attestes.length} fichier(s) attesté(s) vert(s) sur son empreinte, au seuil ${seuils.join(' ou ')}, que le lanceur saute en les nommant` : '';
    if (id === HARNAIS.id && !couverture.harnais?.length) lignes.push(`- ${nomDe(id)} : aucun.`);
    else if (c) lignes.push(`- ${nomDe(id)} : sauté jusqu'au seuil ${c.seuil} — ${c.raison}${fichiers}.`);
    else lignes.push(`- ${nomDe(id)} : se joue — aucune empreinte verte${attestes.length ? " pour tout l'ensemble" : ''}${fichiers}.`);
  }
  return lignes;
}
