/**
 * Niveaux des tests (#232, D83).
 *
 * Le niveau d'un test dit le risque pris à ne pas le jouer, de 0 (l'irréparable) à 4 (rien de
 * garanti). Il se déclare par la marque `[niveau N]` dans le titre du test, sinon dans celui de la
 * suite la plus proche qui l'englobe ; sans marque, il est de niveau 2. Il se lit donc dans le
 * fichier, sans l'exécuter.
 *
 * Un lancement vérifie à un seuil : il ne joue que les tests de niveau inférieur ou égal
 * (`lanceur.mjs`). Ce module est partagé par le lanceur et ses deux branchements (`node --test`,
 * vitest).
 */
export const NIVEAU_PAR_DEFAUT = 2;
export const NIVEAU_MAX = 4;

/** Niveau que porte un titre, la dernière marque s'il en a plusieurs ; `null` sans marque. */
export function niveauDuTitre(titre) {
  const marques = [...String(titre ?? '').matchAll(/\[niveau ([0-4])\]/g)];
  return marques.length ? Number(marques.at(-1)[1]) : null;
}

/**
 * Niveau d'un test d'après ses titres, de la suite la plus lointaine au test : la marque la plus
 * proche du test, sinon 2.
 */
export function niveauDesTitres(titres) {
  for (let i = titres.length - 1; i >= 0; i--) {
    const n = niveauDuTitre(titres[i]);
    if (n !== null) return n;
  }
  return NIVEAU_PAR_DEFAUT;
}

/**
 * Seuil demandé à un lanceur : le premier argument, s'il vaut 0 à 4, retiré des arguments ; 2 sans
 * entrée. Rend `{ seuil, reste }`.
 */
export function lireSeuil(args) {
  const [premier, ...reste] = args;
  if (/^[0-4]$/.test(premier ?? '')) return { seuil: Number(premier), reste };
  return { seuil: NIVEAU_PAR_DEFAUT, reste: [...args] };
}

/**
 * Motif de nom complet (suites puis test, séparés par des espaces, comme vitest les assemble) des
 * tests de niveau inférieur ou égal au seuil : la dernière marque du nom est au plus le seuil, ou,
 * dès le seuil 2, le nom n'en porte aucune.
 */
export function motifDuSeuil(seuil) {
  const dernier = `\\[niveau [0-${seuil}]\\](?!.*\\[niveau \\d\\])`;
  return seuil >= NIVEAU_PAR_DEFAUT ? `^(?!.*\\[niveau \\d\\])|${dernier}` : dernier;
}

/** Ligne qui dit ce qu'un lancement écarte. */
export function ligneEcartes(seuil, nombre, nomme = false) {
  if (nomme) return `seuil : appel nommé, joué quel que soit le niveau — ${nombre} test(s) écarté(s) par le seuil.`;
  if (seuil >= NIVEAU_MAX) return `seuil ${seuil} : ${nombre} test(s) écarté(s), tous les niveaux se jouent.`;
  return `seuil ${seuil} : ${nombre} test(s) écarté(s), de niveau supérieur à ${seuil}.`;
}

