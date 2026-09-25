/**
 * Niveaux des tests (#232, D83).
 *
 * Le niveau d'un test dit le risque pris à ne pas le jouer, de 0 (l'irréparable) à 4 (rien de
 * garanti). Il se déclare par la marque `[niveau N]` dans le titre du test, sinon dans celui de la
 * suite la plus proche qui l'englobe ; sans marque, il est de niveau 2. Il se lit donc dans le
 * fichier, sans l'exécuter (`niveauxDuFichier`).
 *
 * Un lancement vérifie à un seuil : il ne joue que les tests de niveau inférieur ou égal
 * (`lanceur.mjs`). Ce module est partagé par le lanceur, par ses deux branchements (`node --test`,
 * vitest) et par la règle des harnais (`regles-des-harnais.test.mjs`).
 */
import { appelsDeTests, lireRegistre, temoinRouge, testNomme } from './gardes.mjs';

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
 * Tests et suites d'un fichier, avec leur niveau, lu sans exécuter : `{ titre, suite, niveau,
 * chaine, debut, fin }`, où `chaine` liste les titres des suites englobantes puis le sien. Un titre
 * qui n'est pas écrit en toutes lettres (gabarit) garde sa forme brute entre accents graves.
 */
export function niveauxDuFichier(source) {
  return appelsDeTests(source).map((a) => {
    const titres = [...a.englobantes.map((b) => b.titre ?? ''), a.titre ?? ''];
    return { titre: a.titre, suite: a.suite, niveau: niveauDesTitres(titres), chaine: titres, debut: a.debut, fin: a.fin, appel: a };
  });
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

// ─── Règle des harnais (#232, point 10) ─────────────────────────────────────────────────────────

/** Les harnais de la garde : ses fichiers de test. */
export const HARNAIS_DE_LA_GARDE = /^packages\/gardes\/[^/]+\.test\.[cm]?js$/;

/**
 * Portée de la règle « 0 ou 1 » : par fichier, `true` pour tout le fichier, ou l'ensemble des titres
 * nommés (test ou suite, et témoin rouge). Une ligne `Harnais` du registre qui nomme un test porte sur
 * ce test, sa suite et son témoin ; une ligne qui ne cite que des fichiers, sur tout le fichier ; un
 * fichier de test de la garde, sur tout le fichier.
 */
export function porteeDesHarnais(registre, fichiers) {
  const portee = new Map();
  const ajouter = (chemin, nom) => {
    if (portee.get(chemin) === true) return;
    if (nom === true) portee.set(chemin, true);
    else portee.set(chemin, new Set([...(portee.get(chemin) ?? []), nom]));
  };
  for (const f of fichiers) if (HARNAIS_DE_LA_GARDE.test(f)) ajouter(f, true);
  for (const entree of lireRegistre(registre).entrees.values()) {
    for (const h of entree.harnais) {
      const tests = h.chemins.filter((c) => /\.test\.[^/]+$/.test(c));
      const nomme = testNomme(h.description);
      const temoin = temoinRouge(h.description)?.nom;
      for (const c of tests) {
        if (!nomme) ajouter(c, true);
        else for (const n of [nomme, temoin].filter(Boolean)) ajouter(c, n);
      }
    }
  }
  return portee;
}

/**
 * Tests et suites d'un harnais de la garde ou du registre qui ne sont pas de niveau 0 ou 1. Pour un
 * titre nommé : lui, ce qu'il contient, et les suites qui l'englobent. Rend des messages.
 */
export function niveauxHorsDesHarnais({ registre, fichiers, lireFichier }) {
  const problemes = [];
  for (const [chemin, noms] of porteeDesHarnais(registre, fichiers)) {
    const source = lireFichier(chemin);
    if (source == null) continue; // un harnais absent : la couverture le dit déjà
    const lus = niveauxDuFichier(source);
    let concernes = lus;
    if (noms !== true) {
      const nommes = lus.filter((l) => l.titre !== null && noms.has(l.titre));
      concernes = lus.filter((l) => nommes.some((n) => n === l || l.appel.englobantes.includes(n.appel) || n.appel.englobantes.includes(l.appel)));
    }
    for (const l of concernes) {
      if (l.niveau > 1) problemes.push(`${chemin} : « ${l.titre ?? '(titre calculé)'} » est de niveau ${l.niveau} ; un test d'un harnais de la garde ou du registre est de niveau 0 ou 1 (#232).`);
    }
  }
  return problemes;
}
