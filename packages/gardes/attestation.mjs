/**
 * Attestation de la livraison (#237, D83).
 *
 * Une livraison verte (pré-fusion, pré-push) atteste ce qu'elle a joué sur l'arbre qu'elle a jugé :
 * l'arbre, le seuil, les ensembles joués, le harnais du besoin et son état, la présence du
 * navigateur. Seul l'outillage la produit (`.githooks/attestation.mjs`, appelé par `livraison.sh`) ;
 * elle voyage avec le push, et la CI la lit pour ne jouer que ce qu'elle ne couvre pas. Le risque
 * visé est l'erreur, pas la fraude (porteur, 27/09).
 *
 * Ce module ne fait que lire et décider, sans git ni réseau :
 * - `texteDeLAttestation` / `lireLAttestation` : la forme de l'attestation, un message de commit ;
 * - `couvertureAuReady` / `couvertureApresFusion` : ce que la CI peut sauter, écrit dans un fichier
 *   qu'elle passe à `pnpm test` (`--attestation <fichier>`) ;
 * - `navigateurInutile` / `avecLesChemins` : les tests navigateur ne se jouent que si ce qui arrive
 *   peut les changer (point 9 de #237), même sans attestation ;
 * - `couvre` : la décision du lanceur (`lanceur.mjs`) pour un lancement donné.
 */

export const VERSION = 1;
export const TITRE = "Attestation de livraison de l'arbre";
/** Le statut que `apercu.yml` termine au Ready, sur la tête de la PR (#168). */
export const STATUT_DU_READY = 'Toute la CI sur ce commit';

const ARBRE = /^[0-9a-f]{40,64}$/;

/**
 * Ce que la livraison a lancé, une ligne par lancement (`livraison.sh`, fichier `joues`) :
 * `sorte<TAB>dossier<TAB>seuil<TAB>navigateur (0 ou 1)<TAB>fichiers séparés par des virgules`.
 * `sorte` : `non-regression` (les fichiers sont ceux du harnais, exclus du lancement), `harnais`
 * (les fichiers sont ceux joués) ou `typecheck`.
 */
export function lireLesLancements(texte) {
  const ensembles = [];
  const typecheck = [];
  for (const ligne of String(texte ?? '').split('\n')) {
    if (!ligne.trim()) continue;
    const [sorte, dossier, seuil, nav, fichiers = ''] = ligne.split('\t');
    const liste = fichiers.split(',').map((f) => f.trim()).filter(Boolean).sort();
    if (sorte === 'typecheck') typecheck.push(dossier);
    else if (sorte === 'non-regression') ensembles.push({ sorte, dossier, seuil: Number(seuil), navigateur: nav === '1', exclus: liste });
    else if (sorte === 'harnais') ensembles.push({ sorte, dossier, seuil: Number(seuil), navigateur: nav === '1', fichiers: liste });
    else throw new Error(`attestation : lancement illisible « ${ligne} »`);
  }
  return { ensembles, typecheck: [...new Set(typecheck)].sort() };
}

/** Le message du commit d'attestation : un titre, puis l'attestation en JSON. */
export function texteDeLAttestation({ arbre, seuil, navigateur, branche, harnais, ensembles, typecheck, date }) {
  if (!ARBRE.test(arbre ?? '')) throw new Error(`attestation : arbre invalide « ${arbre} »`);
  if (!['vert', 'rouge', 'aucun'].includes(harnais)) throw new Error(`attestation : état du harnais invalide « ${harnais} »`);
  const corps = { version: VERSION, arbre, seuil, navigateur: Boolean(navigateur), branche, harnais, ensembles, typecheck, date };
  return `${TITRE} ${arbre}\n\n${JSON.stringify(corps, null, 2)}\n`;
}

/**
 * Lit un message de commit d'attestation ; rend `{ attestation }`, ou `{ raison }` s'il ne se lit
 * pas. `arbre`, s'il est donné, est l'arbre du commit qui la porte : il doit être celui attesté.
 */
export function lireLAttestation(message, arbre) {
  const texte = String(message ?? '');
  if (!texte.startsWith(TITRE)) return { raison: "le commit ne porte pas d'attestation de livraison" };
  const debut = texte.indexOf('{');
  let a;
  try {
    a = JSON.parse(texte.slice(debut));
  } catch {
    return { raison: "l'attestation ne se lit pas (JSON)" };
  }
  if (a?.version !== VERSION) return { raison: `version d'attestation inconnue (${a?.version})` };
  if (!ARBRE.test(a.arbre ?? '')) return { raison: "l'attestation ne nomme pas d'arbre" };
  if (arbre && a.arbre !== arbre) return { raison: `l'attestation vise l'arbre ${a.arbre.slice(0, 10)}, porté par l'arbre ${arbre.slice(0, 10)}` };
  if (!Array.isArray(a.ensembles)) return { raison: "l'attestation ne liste pas ses ensembles" };
  return { attestation: a };
}

/**
 * Ce que la CI peut sauter au Ready, d'après l'attestation de la livraison. Le seuil 1 se joue
 * toujours (`toujours: 1`) ; le harnais du besoin ne compte que s'il était vert. Rend l'objet écrit
 * dans le fichier que la CI passe à `pnpm test --attestation`.
 */
export function couvertureAuReady(attestation) {
  const harnaisVert = attestation.harnais === 'vert';
  const ensembles = attestation.ensembles.filter((e) => e.sorte === 'non-regression' || (e.sorte === 'harnais' && harnaisVert));
  return {
    origine: 'livraison',
    arbre: attestation.arbre,
    toujours: 1,
    tout: false,
    ensembles,
    raison: `livraison de ${attestation.branche ?? 'la branche'} au seuil ${attestation.seuil}, navigateur ${attestation.navigateur ? 'présent' : 'absent'}, harnais du besoin ${attestation.harnais}`,
  };
}

/**
 * Après la fusion, sur `main` : l'arbre arrivé est-il celui d'une tête de PR que toute la CI a
 * trouvée verte au Ready ? `tetes` : `[{ sha, arbre, statut }]`, `statut` étant l'état du statut
 * « Toute la CI sur ce commit » sur cette tête. Rend la couverture (tout se saute), ou `null`.
 */
export function couvertureApresFusion(arbre, tetes) {
  const t = (tetes ?? []).find((h) => h.arbre === arbre && h.statut === 'success');
  if (!t) return null;
  return {
    origine: 'ready',
    arbre,
    toujours: -1,
    tout: true,
    ensembles: [],
    raison: `arbre trouvé vert au Ready, sur la tête ${t.sha.slice(0, 10)} (statut « ${STATUT_DU_READY} »)`,
  };
}

/** L'état du statut « Toute la CI sur ce commit » parmi les statuts d'un commit (API), ou `null`. */
export function etatDuStatut(statuts) {
  return (statuts ?? []).find((s) => s?.context === STATUT_DU_READY)?.state ?? null;
}

/**
 * Point 9 de #237 : les chemins que les tests navigateur ne lisent pas, et la garde, qu'ils lisent
 * mais que le seuil 1 joue sur l'interface, navigateur compris. Un chemin oublié fait jouer plus,
 * jamais moins.
 */
export const SANS_NAVIGATEUR = Object.freeze(['docs/', '.github/', '.githooks/', 'packages/gardes/', 'apps/hebergement/', 'apps/relay/']);

/** Les fichiers changés ne sont-ils que des chemins que les tests navigateur ne lisent pas ? */
export function navigateurInutile(fichiers) {
  return fichiers.every((f) => SANS_NAVIGATEUR.some((d) => f.startsWith(d)) || f.endsWith('.md') || f.split('/').at(-1) === '.gitignore');
}

/**
 * Ajoute à une couverture, ou à une couverture vide pour `arbre`, le saut des tests navigateur
 * quand les fichiers changés depuis `base` ne peuvent pas les changer (point 9). `toujours` : le
 * seuil joué quoi qu'il arrive (1 au Ready, -1 sur `main`). Rend la couverture inchangée sinon.
 */
export function avecLesChemins(couverture, { arbre, fichiers, base, toujours }) {
  if (!navigateurInutile(fichiers)) return couverture;
  const raison = `rien de ce qui change depuis ${base} n'est lu par les tests navigateur (${fichiers.length} fichier(s) sous ${SANS_NAVIGATEUR.join(', ')}, *.md ou .gitignore)`;
  return { ...(couverture ?? { origine: 'chemins', arbre, toujours, tout: false, ensembles: [], raison }), navigateurInutile: raison };
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

/** Une cible vise-t-elle les tests navigateur (`test/navigateur/`) ? Dans le doute, oui. */
const visesNavigateur = (cible) => cible === 'test' || cible === 'test/navigateur' || cible.startsWith('test/navigateur/') || !/\.test\.[cm]?[jt]s$/.test(cible);

/**
 * La décision du lanceur. `couverture` : le fichier de la CI (`couvertureAuReady` ou
 * `couvertureApresFusion`), `null` sans fichier ; `demande` : `{ arbre, dossier, seuil, navigateur,
 * cibles, nomme }`, l'arbre extrait et le paquet lancé, relatif à la racine du dépôt. Rend
 * `{ couvert, raison }` : couvert, le lancement se saute.
 */
export function couvre(couverture, demande) {
  if (!couverture) return { couvert: false, raison: 'aucune attestation pour cet arbre : tout se joue' };
  if (couverture.arbre !== demande.arbre) {
    return { couvert: false, raison: `l'attestation vise l'arbre ${String(couverture.arbre).slice(0, 10)}, l'arbre extrait est ${String(demande.arbre).slice(0, 10)} : tout se joue` };
  }
  if (demande.nomme) return { couvert: false, raison: 'appel nommé : il se joue' };
  if (demande.seuil <= couverture.toujours) return { couvert: false, raison: `le seuil ${demande.seuil} se joue toujours` };
  if (couverture.tout) return { couvert: true, raison: couverture.raison };
  const seulementNavigateur = demande.cibles.length && demande.cibles.every((c) => c === 'test/navigateur' || c.startsWith('test/navigateur/'));
  if (couverture.navigateurInutile && demande.navigateur && demande.dossier === 'apps/web' && seulementNavigateur) {
    return { couvert: true, raison: couverture.navigateurInutile };
  }

  const ensembles = couverture.ensembles.filter((e) => e.dossier === demande.dossier && e.seuil >= demande.seuil);
  const paquet = ensembles.filter((e) => e.sorte === 'non-regression');
  const harnais = ensembles.filter((e) => e.sorte === 'harnais');
  const navOk = (e, besoin) => !besoin || e.navigateur;
  const parLeHarnais = (f, besoin) => harnais.some((e) => e.fichiers.includes(f) && navOk(e, besoin));

  const manque = [];
  if (!demande.cibles.length) {
    const e = paquet.find((p) => navOk(p, demande.navigateur));
    if (!e) manque.push(`${demande.dossier} en entier${demande.navigateur ? ', tests navigateur compris' : ''}`);
    else for (const f of e.exclus) if (!parLeHarnais(f, demande.navigateur)) manque.push(`${demande.dossier}/${f}`);
  } else {
    for (const c of demande.cibles) {
      const besoin = demande.navigateur && visesNavigateur(c);
      const ok = paquet.some((p) => navOk(p, besoin) && !p.exclus.includes(c)) || parLeHarnais(c, besoin);
      if (!ok) manque.push(`${demande.dossier}/${c}${besoin ? ' (navigateur)' : ''}`);
    }
  }
  if (manque.length) return { couvert: false, raison: `l'attestation ne couvre pas ${manque.join(', ')} au seuil ${demande.seuil} : tout se joue` };
  return { couvert: true, raison: couverture.raison };
}

/** Les lignes qui disent, dans la CI, ce que la couverture permet de sauter. */
export function resume(couverture) {
  if (!couverture) return ["Aucune attestation pour cet arbre : la CI joue tout ce que D83 prévoit."];
  if (couverture.tout) return [`Tests sautés : ${couverture.raison}.`];
  const lignes = couverture.navigateurInutile ? [`Tests navigateur sautés : ${couverture.navigateurInutile}.`] : [];
  if (couverture.origine === 'chemins') return [...lignes, 'Aucune attestation pour cet arbre : le reste se joue.'];
  lignes.push(`Attestation : ${couverture.raison}.`, couverture.toujours >= 1 ? 'Le seuil 1 se joue toujours. Couvert par la livraison, donc sauté si la CI le demande :' : 'Couvert, donc sauté si la CI le demande :');
  for (const e of couverture.ensembles) {
    if (e.sorte === 'harnais') lignes.push(`- harnais du besoin, ${e.dossier} : ${e.fichiers.join(', ')} (seuil ${e.seuil}${e.navigateur ? ', navigateur' : ''})`);
    else lignes.push(`- ${e.dossier}, seuil ${e.seuil}${e.navigateur ? ', tests navigateur compris' : ''}${e.exclus.length ? ` (hors ${e.exclus.join(', ')})` : ''}`);
  }
  if (!couverture.ensembles.length) lignes.push('- rien');
  return lignes;
}
