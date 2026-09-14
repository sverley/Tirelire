/**
 * Harnais de C1 — « Aucun geste technique pour l'utilisateur » (issue #73, chantier de #38,
 * objectif primaire #58). Jusqu'ici, seule une vérification manuelle (`VM-C1-sans-geste`) le
 * tenait, à relire à chaque PR.
 *
 * C1 : « Installer, mettre à jour, sauvegarder et synchroniser ne demandent ni ligne de commande,
 * ni serveur à lancer, ni réglage réseau, ni adresse technique à saisir. » Ce harnais garde la part
 * programmable, en trois garanties, chacune nommée au registre (`docs/gardes.md`) :
 *
 * 1. **Les textes de l'interface** (`apps/web/src`, `.svelte` et `.ts` : un message se fabrique
 *    aussi dans un module) ne portent aucune des formes concrètes que prendrait un tel geste — nom
 *    d'outil de ligne de commande, invite à ouvrir un terminal, adresse locale technique…
 * 2. **Les documents du dépôt sont classés** : lus par un développeur ou par qui héberge le serveur
 *    privé, ou destinés à qui tient son budget. Un document neuf ne peut pas rester hors des deux
 *    listes, ni une liste citer un document disparu.
 * 3. **Les documents destinés à l'utilisateur passent le même balayage.** Aucun n'existe
 *    aujourd'hui — `docs/hebergement-web.md` s'adresse à qui héberge, pas à qui budgète (D07) —
 *    mais un guide écrit demain y tombe sans que personne ait à y penser.
 *
 * Ce que chaque contrôle exige est écrit dans une fonction à part (`vérifierBalayage`,
 * `vérifierClassement`), pour que les témoins rouges rejouent **les mêmes assertions** sur un jeu
 * inventé, et non une détection voisine qui passerait pour elles (#66, #69). Deux assertions de
 * non-vacuité complètent l'ensemble : un balayage qui ne lit plus rien, ou un inventaire qui ne
 * trouve plus aucun document, passerait sinon pour vert en ne gardant plus rien.
 *
 * Ce que ce harnais ne juge pas : l'esprit de C1 (une voie avancée tolérée, jamais seule), qui
 * reste à la revue manuelle `VM-C1-sans-geste`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RACINE } from './harnais.js';

const SOURCE = join(RACINE, 'src');
/** Racine du dépôt : `apps/web` remonte de deux crans. */
const DÉPÔT = join(RACINE, '..', '..');

/** Formes concrètes d'un geste technique qu'un texte destiné à l'utilisateur ne doit jamais porter. */
const MOTIFS_GESTE_TECHNIQUE: RegExp[] = [
  /\bpnpm\b/i,
  /\bnpm\s+(run|install|start|ci)\b/i,
  /\bnode\s+[\w./-]+\.(m?js|ts)\b/i,
  /\bgit\s+clone\b/i,
  /\bligne\s+de\s+commande\b/i,
  /\binvite\s+de\s+commande\b/i,
  /\bterminal\b/i,
  /\bcurl\s+https?:\/\//i,
  /localhost:\d+/i,
  /\bserveur\s+à\s+lancer\b/i,
  /\blancer\s+(?:le|un)\s+serveur\b/i,
];

/** Documents lus par un développeur ou par qui héberge le serveur privé : le balayage les ignore. */
const DOCUMENTS_TECHNIQUES = [
  'CLAUDE.md',
  'README.md',
  'docs/analyse-du-besoin.html',
  'docs/architecture.md',
  'docs/contraintes.md',
  'docs/decisions.md',
  'docs/description-projet.md',
  'docs/formats-import.md',
  'docs/gardes.md',
  'docs/hebergement-web.md',
  'docs/invariants.md',
  'docs/plan-sessions.md',
  'docs/reprise.md',
  'docs/synchronisation.md',
];

/**
 * Documents destinés à qui tient son budget : balayés comme les textes de l'interface. Aucun
 * aujourd'hui ; un guide ou un écran d'aide écrit demain vient ici, et C1 le tient aussitôt.
 */
const DOCUMENTS_UTILISATEUR: string[] = [];

/** Fichiers d'un dossier, en profondeur, dont le nom finit par l'un des suffixes donnés. */
function fichiers(dossier: string, suffixes: string[]): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) return fichiers(chemin, suffixes);
    return suffixes.some((s) => e.name.endsWith(s)) ? [chemin] : [];
  });
}

/** Chemin relatif à une racine, en séparateurs de chemin d'URL. */
const depuisLaRacine = (chemin: string, racine = DÉPÔT) => relative(racine, chemin).split('\\').join('/');

/** Les documents du dépôt : ceux de `docs/`, et ceux que la racine porte. */
function documentsDuDépôt(): string[] {
  const racine = ['CLAUDE.md', 'README.md'].filter((nom) => existsSync(join(DÉPÔT, nom)));
  const docs = fichiers(join(DÉPÔT, 'docs'), ['.md', '.html']).map((c) => depuisLaRacine(c));
  return [...racine, ...docs].sort();
}

/** Les motifs d'un geste technique trouvés dans `contenu`, vide si aucun. */
export function gestesTechniquesTrouvés(contenu: string): string[] {
  return MOTIFS_GESTE_TECHNIQUE.filter((motif) => motif.test(contenu)).map((motif) => motif.source);
}

/** Les textes fautifs d'un ensemble, chacun nommé avec les motifs qu'il porte. */
export function balayageDesGestes(textes: string[], lire: (texte: string) => string): string[] {
  return textes.flatMap((nom) => {
    const trouvés = gestesTechniquesTrouvés(lire(nom));
    return trouvés.length ? [`${nom} : ${trouvés.join(', ')}`] : [];
  });
}

/** Ce qu'on exige d'un balayage, à part du test pour que le témoin rouge rejoue les mêmes assertions. */
function vérifierBalayage(quoi: string, textes: string[], lire: (texte: string) => string): void {
  const fautifs = balayageDesGestes(textes, lire);
  expect(fautifs, `geste technique trouvé dans ${quoi} :\n${fautifs.join('\n')}`).toEqual([]);
}

/**
 * Les documents qu'aucune des deux listes ne range, et ceux qu'elles rangent sans qu'ils existent.
 * Écrite à part du test pour que le témoin rouge puisse la rejouer sur un jeu inventé.
 */
export function documentsMalClassés(
  documents: string[],
  classés: string[],
  existe: (d: string) => boolean,
): { nonClassés: string[]; disparus: string[] } {
  const connus = new Set(classés);
  return { nonClassés: documents.filter((d) => !connus.has(d)), disparus: classés.filter((d) => !existe(d)) };
}

/** Ce qu'on exige du classement, à part du test pour que le témoin rouge rejoue les mêmes assertions. */
function vérifierClassement(documents: string[], classés: string[], existe: (d: string) => boolean): void {
  expect(documents.length, "l'inventaire ne trouve aucun document : le classement ne garde plus rien").toBeGreaterThan(0);
  const { nonClassés, disparus } = documentsMalClassés(documents, classés, existe);
  expect(
    nonClassés,
    'document non classé : le ranger parmi les documents techniques, ou parmi ceux destinés à ' +
      `l'utilisateur — auquel cas C1 le balaie :\n${nonClassés.join('\n')}`,
  ).toEqual([]);
  expect(disparus, `document classé mais introuvable (renommé, supprimé ?) :\n${disparus.join('\n')}`).toEqual([]);
}

describe('C1 · aucun geste technique dans les textes de l’interface (issue #73)', () => {
  it('aucun fichier de apps/web/src ne porte un des motifs interdits', () => {
    const balayés = fichiers(SOURCE, ['.svelte', '.ts']).map((c) => depuisLaRacine(c, RACINE));
    for (const suffixe of ['.svelte', '.ts'])
      expect(
        balayés.some((c) => c.endsWith(suffixe)),
        `aucun fichier ${suffixe} balayé : de ce côté, C1 ne garderait plus rien`,
      ).toBe(true);
    vérifierBalayage('l’interface', balayés, (c) => readFileSync(join(RACINE, c), 'utf8'));
  });

  it('chaque document du dépôt est classé : technique, ou destiné à l’utilisateur', () => {
    vérifierClassement(documentsDuDépôt(), [...DOCUMENTS_TECHNIQUES, ...DOCUMENTS_UTILISATEUR], (d) => existsSync(join(DÉPÔT, d)));
  });

  it('aucun document destiné à l’utilisateur ne demande un geste technique', () => {
    vérifierBalayage('un document destiné à l’utilisateur', DOCUMENTS_UTILISATEUR, (d) => readFileSync(join(DÉPÔT, d), 'utf8'));
  });
});

/**
 * Témoin rouge du balayage de l'interface : les mêmes assertions rejouées sur un écran inventé qui
 * invite à ouvrir un terminal. Doit échouer ; `it.fails` tient l'échec attendu (#66).
 */
it.fails('témoin rouge · un texte d’interface qui invite à ouvrir un terminal', () => {
  vérifierBalayage('l’interface', ['src/views/Reglages.svelte'], () => '<p>Ouvrez un terminal et lancez `pnpm install` puis `node serveur.js`.</p>');
});

/**
 * Témoin rouge du classement : les mêmes assertions rejouées sur un dépôt inventé où un document
 * neuf n'est rangé d'aucun côté. Doit échouer ; `it.fails` tient l'échec attendu (#66).
 */
it.fails('témoin rouge · un document du dépôt laissé hors de tout classement', () => {
  vérifierClassement(['docs/guide-utilisateur.md', 'README.md'], ['README.md'], () => true);
});

/**
 * Témoin rouge du balayage des documents utilisateur : les mêmes assertions rejouées sur un guide
 * inventé qui fait lancer un serveur. Doit échouer ; `it.fails` tient l'échec attendu (#66).
 */
it.fails('témoin rouge · un document destiné à l’utilisateur qui fait lancer un serveur', () => {
  vérifierBalayage(
    'un document destiné à l’utilisateur',
    ['docs/guide-utilisateur.md'],
    () => '## Sauvegarder\n\nLancez le serveur avec `pnpm preview`, puis ouvrez http://localhost:4173.',
  );
});
