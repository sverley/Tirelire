/**
 * Empreintes et attestation des tests (#237, #264, D83).
 *
 * Chaque ensemble de tests — garde, cœur, relais, hébergement, interface sans navigateur, interface
 * dans le navigateur, harnais du besoin — a une empreinte : l'état, dans l'arbre jugé, des chemins
 * qu'il lit. Elle couvre tout le dépôt, sauf les chemins que la liste de l'ensemble écarte, chacun
 * avec sa raison ; un chemin oublié de la liste fait jouer plus, jamais moins.
 *
 * Un ensemble ne se rejoue pas sur une empreinte déjà trouvée verte, à un seuil au moins égal : par
 * l'outillage sur la branche (un crochet, ou la demande des tests navigateur), par la CI sur une tête
 * de la branche dont toute la CI a fini verte au Ready, ou parce que `main` a la même (la branche ne
 * change rien de ce qu'il lit). L'attestation porte les empreintes trouvées vertes par l'outillage :
 * seul l'outillage l'écrit (`.githooks/attestation.mjs`), elle voyage sur `<branche>--attestation` et
 * s'enrichit d'un push et d'une session à l'autre. Le risque visé est l'erreur, pas la fraude
 * (porteur, 27/09).
 *
 * Ce module ne fait que lire et décider, sans git ni réseau :
 * - `ENSEMBLES`, `lit`, `empreinteDe`, `empreintes` : ce que chaque ensemble lit, et son empreinte ;
 * - `texteDeLAttestation`, `lireLAttestation`, `fusionner` : l'attestation, un message de commit ;
 * - `planifier` : ce qu'un crochet joue ou saute, et pourquoi ;
 * - `couvertureAuReady`, `couvertureApresFusion`, `couvre` : ce que la CI saute, par le fichier
 *   qu'elle passe à `pnpm test --attestation`, et la décision du lanceur (`lanceur.mjs`).
 */
import { createHash } from 'node:crypto';

export const VERSION = 2;
export const TITRE = 'Attestation de livraison de la branche';
/** Le statut que `apercu.yml` termine au Ready, sur la tête de la PR (#168). */
export const STATUT_DU_READY = 'Toute la CI sur ce commit';

// ─── Ce que chaque ensemble lit ─────────────────────────────────────────────────────────────────

const DOCUMENTATION = { motifs: ['docs/', '*.md', '.gitignore'], raison: 'la documentation : ses tests ne la lisent pas' };
const OUTILLAGE_CI = { motifs: ['.github/', '.githooks/'], raison: 'les workflows et les crochets lancent ses tests, qui ne les lisent pas' };
const LANCEUR = {
  motifs: ['packages/gardes/'],
  raison: 'la garde : ses tests la lisent par leur lanceur, mais le seuil 1 la joue toujours au Ready, sur chaque ensemble, par le même lanceur',
};

/**
 * Les ensembles de tests, hors harnais du besoin. `ecartes` : les chemins que l'ensemble ne lit pas,
 * ou dont ce qu'il lit est vérifié par ce qui se joue toujours, chacun avec sa raison. Syntaxe des
 * motifs, celle de `.gitignore` en plus petit : `dossier/` vaut pour tout ce qu'il contient, un motif
 * sans `/` vaut pour un nom de fichier partout, `*` ne franchit pas de `/`, et `!` réintègre un chemin
 * écarté ; le dernier motif qui s'applique décide.
 */
export const ENSEMBLES = Object.freeze([
  {
    id: 'garde',
    nom: 'garde',
    dossier: 'packages/gardes',
    ecartes: [
      {
        motifs: ['apps/', 'packages/core/'],
        raison:
          "le code et les tests de l'application : la garde n'en tire de verdict que par ses tests de niveau 0 et 1 (les harnais du registre, la règle des niveaux), que le seuil 1 joue toujours au Ready",
      },
      {
        motifs: ['!apps/*/package.json', '!apps/*/*.config.*', '!apps/*/tsconfig*.json', '!packages/core/package.json', '!packages/core/*.config.*', '!packages/core/tsconfig*.json'],
        raison: "réintégrée, la configuration des paquets : les tests de niveau 2 de la garde la copient pour y jouer l'outillage",
      },
    ],
  },
  {
    id: 'coeur',
    nom: 'cœur',
    dossier: 'packages/core',
    ecartes: [DOCUMENTATION, OUTILLAGE_CI, { motifs: ['apps/'], raison: "le cœur ne dépend d'aucune application (D84)" }, LANCEUR],
  },
  {
    id: 'relais',
    nom: 'relais',
    dossier: 'apps/relay',
    ecartes: [DOCUMENTATION, OUTILLAGE_CI, { motifs: ['apps/web/', 'apps/hebergement/', 'packages/core/'], raison: "le relais n'importe ni l'interface, ni l'hébergement, ni le cœur" }, LANCEUR],
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
      LANCEUR,
    ],
  },
  {
    // La liste du point 9 de #237, telle quelle.
    id: 'navigateur',
    nom: 'interface dans le navigateur',
    dossier: 'apps/web',
    navigateur: true,
    ecartes: [
      { motifs: ['docs/', '*.md', '.gitignore'], raison: 'la documentation : les tests navigateur ne la lisent pas' },
      OUTILLAGE_CI,
      { motifs: ['apps/hebergement/', 'apps/relay/'], raison: "les tests navigateur ne lisent ni l'hébergement ni le relais" },
      { motifs: ['packages/gardes/'], raison: "la garde : les tests navigateur la lisent par leur lanceur, mais le seuil 1 la joue sur l'interface, navigateur compris (D83)" },
    ],
  },
]);

export const HARNAIS = Object.freeze({ id: 'harnais', nom: 'harnais du besoin' });
/** Tous les ensembles, harnais du besoin compris, dans l'ordre où les moments les disent. */
export const TOUS = Object.freeze([...ENSEMBLES.map((e) => e.id), HARNAIS.id]);
export const nomDe = (id) => (id === HARNAIS.id ? HARNAIS.nom : (ENSEMBLES.find((e) => e.id === id)?.nom ?? id));
const ensemble = (id) => ENSEMBLES.find((e) => e.id === id);

/** Un motif s'applique-t-il à un chemin ? (`!` retiré par l'appelant.) */
export function correspond(motif, chemin) {
  const echappe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\?/g, '[^/]').replace(/\*/g, '[^/]*');
  if (motif.endsWith('/')) return new RegExp(`^${echappe(motif)}`).test(chemin);
  if (!motif.includes('/')) return new RegExp(`^${echappe(motif)}$`).test(chemin.split('/').at(-1));
  return new RegExp(`^${echappe(motif)}$`).test(chemin);
}

/** L'ensemble lit-il ce chemin ? Tout chemin qu'aucun motif n'écarte est lu. */
export function lit(ensembleOuId, chemin) {
  const e = typeof ensembleOuId === 'string' ? ensemble(ensembleOuId) : ensembleOuId;
  let lu = true;
  for (const { motifs } of e.ecartes) {
    for (const m of motifs) {
      const reintegre = m.startsWith('!');
      if (correspond(reintegre ? m.slice(1) : m, chemin)) lu = reintegre;
    }
  }
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
  if (a?.version !== VERSION) return { raison: `version d'attestation inconnue (${a?.version})` };
  if (!Array.isArray(a.verts)) return { raison: "l'attestation ne liste pas ses empreintes vertes" };
  const verts = a.verts.filter((v) => TOUS.includes(v?.ensemble) && /^[0-9a-f]{64}$/.test(v?.empreinte ?? '') && Number.isInteger(v?.seuil));
  return { attestation: { ...a, verts } };
}

/**
 * Réunit des listes d'empreintes vertes : une par ensemble et empreinte, au plus haut seuil trouvé,
 * les `GARDEES` plus récentes de chaque ensemble. Rien ne se perd d'un push ou d'une session à
 * l'autre, sinon les plus anciennes.
 */
export function fusionner(...listes) {
  const parCle = new Map();
  for (const v of listes.flat()) {
    if (!v) continue;
    const cle = `${v.ensemble} ${v.empreinte}`;
    const deja = parCle.get(cle);
    if (!deja || v.seuil > deja.seuil || (v.seuil === deja.seuil && String(v.date ?? '') > String(deja.date ?? ''))) parCle.set(cle, v);
  }
  const garde = [];
  for (const id of TOUS) {
    const siens = [...parCle.values()].filter((v) => v.ensemble === id).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
    garde.push(...siens.slice(0, GARDEES));
  }
  return garde;
}

const court = (sha) => String(sha ?? '').slice(0, 10);

/** Qui a trouvé cette empreinte verte, sur quoi, à quel seuil. */
export function raisonDuVert(v) {
  const sur = v.commit ? `le commit ${court(v.commit)}` : `l'arbre ${court(v.arbre)}`;
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
  const v = verts.filter((x) => x.ensemble === id && x.empreinte === empreinte && x.seuil >= seuil).sort((a, b) => b.seuil - a.seuil)[0];
  if (v) return raisonDuVert(v);
  if (id !== HARNAIS.id) {
    const r = references.find((x) => x.empreintes?.[id] === empreinte && x.seuil >= seuil);
    if (r) return r.raison;
  }
  return null;
}

// ─── Ce que joue un crochet ─────────────────────────────────────────────────────────────────────

/** Pourquoi les tests navigateur ne se jouent pas au crochet sans demande (point 6). */
export const SANS_DEMANDE = 'tests navigateur laissés au Ready faute de demande';

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

// ─── Ce que saute la CI ─────────────────────────────────────────────────────────────────────────

/** Les seuils que la CI joue au Ready, donc ceux qu'une tête verte au Ready couvre (D83). */
export const SEUILS_DU_READY = Object.freeze({ garde: 1, coeur: 1, relais: 1, hebergement: 1, interface: 1, navigateur: 2, harnais: 4 });
/** Le seuil jusqu'auquel une empreinte de `main` ou du premier parent compte comme verte : tout, hors tag. */
export const SEUIL_DE_MAIN = 3;

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

/** Pour chaque ensemble couvert, le plus haut seuil couvert et sa raison. */
function couvertureDe({ origine, arbre, toujours, empreintes: e, verts, references, harnais, ids }) {
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
  return { version: VERSION, origine, arbre, toujours, harnais: [...(harnais ?? [])].sort(), ensembles };
}

/**
 * Ce que la CI peut sauter au Ready (point 4) : le seuil 1 se joue toujours (`toujours: 1`) ; au-delà,
 * ce que l'attestation, une tête de la branche verte au Ready ou `main` couvre. `tetes` :
 * `[{ sha, statut, empreintes }]` ; `main` : `{ commit, empreintes }` ; `harnais` : ses fichiers.
 */
export function couvertureAuReady({ arbre, empreintes: e, verts = [], tetes = [], main = null, harnais = [] }) {
  const references = main ? [{ empreintes: main.empreintes, seuil: SEUIL_DE_MAIN, raison: `rien de ce qu'il lit n'a changé depuis main (${court(main.commit)})` }] : [];
  return couvertureDe({ origine: 'ready', arbre, toujours: 1, empreintes: e, verts: [...verts, ...tetes.flatMap(vertsDuReady)], references, harnais, ids: TOUS });
}

/**
 * Sur `main`, après la fusion (point 4) : un ensemble ne se rejoue pas si son empreinte est celle
 * qu'il a sur la tête d'une PR dont toute la CI a fini verte au Ready, ou sur le premier parent du
 * commit arrivé. Le harnais du besoin ne s'y joue pas.
 */
export function couvertureApresFusion({ arbre, empreintes: e, tetes = [], parent = null }) {
  const references = parent ? [{ empreintes: parent.empreintes, seuil: SEUIL_DE_MAIN, raison: `rien de ce qu'il lit n'a changé depuis le premier parent (${court(parent.commit)})` }] : [];
  return couvertureDe({ origine: 'main', arbre, toujours: -1, empreintes: e, verts: tetes.flatMap(vertsDuReady), references, harnais: [], ids: ENSEMBLES.map((x) => x.id) });
}

/** L'état du statut « Toute la CI sur ce commit » parmi les statuts d'un commit (API), ou `null`. */
export function etatDuStatut(statuts) {
  return (statuts ?? []).find((s) => s?.context === STATUT_DU_READY)?.state ?? null;
}

/** Options du lanceur qui prennent une valeur dans l'argument suivant. */
const AVEC_VALEUR = new Set(['--dir', '-t', '--testNamePattern', '--test-name-pattern', '--exclude', '--reporter', '--outputFile', '--config', '-c', '--root', '-r', '--project', '--test-reporter', '--test-reporter-destination', '--import']);

/** Les cibles d'un lancement : ses arguments qui ne sont ni des options, ni leurs valeurs. */
export function ciblesDesArguments(args) {
  const cibles = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-')) {
      if (AVEC_VALEUR.has(a)) i++;
      continue;
    }
    cibles.push(a.replace(/^\.\//, '').replace(/\/+$/, ''));
  }
  return cibles;
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
  if (demande.seuil <= couverture.toujours) return { couvert: false, raison: `le seuil ${demande.seuil} se joue toujours` };
  const ids = ensemblesDeLaDemande(demande, couverture.harnais ?? []);
  if (!ids) return { couvert: false, raison: `${demande.dossier} n'est le paquet d'aucun ensemble : tout se joue` };
  const manque = ids.filter((id) => !(couverture.ensembles?.[id]?.seuil >= demande.seuil));
  if (manque.length) return { couvert: false, raison: `${manque.map(nomDe).join(', ')} : aucune empreinte verte au seuil ${demande.seuil}, tout se joue` };
  return { couvert: true, raison: ids.map((id) => `${nomDe(id)} : ${couverture.ensembles[id].raison}`).join(' ; ') };
}

/** Les lignes qui disent, dans la CI, ce que la couverture permet de sauter, ensemble par ensemble. */
export function resume(couverture) {
  if (!couverture) return ['Aucune empreinte verte pour cet arbre : la CI joue tout ce que D83 prévoit.'];
  const lignes = [];
  if (couverture.toujours >= 1) lignes.push(`Le seuil ${couverture.toujours} se joue toujours, en entier, en mode strict, sur chaque ensemble hors navigateur.`);
  const ids = couverture.origine === 'main' ? ENSEMBLES.map((e) => e.id) : TOUS;
  for (const id of ids) {
    const c = couverture.ensembles?.[id];
    if (id === HARNAIS.id && !couverture.harnais?.length) lignes.push(`- ${nomDe(id)} : aucun.`);
    else if (c) lignes.push(`- ${nomDe(id)} : sauté jusqu'au seuil ${c.seuil} — ${c.raison}.`);
    else lignes.push(`- ${nomDe(id)} : se joue — aucune empreinte verte.`);
  }
  return lignes;
}
