/**
 * Harnais de C1 — « Aucun geste technique pour l'utilisateur » (issue #73, chantier de #38,
 * objectif primaire #58). Jusqu'ici, seule une vérification manuelle (`VM-C1-sans-geste`) le
 * tenait, à relire à chaque PR.
 *
 * C1 : « Installer, mettre à jour, sauvegarder et synchroniser ne demandent ni ligne de commande,
 * ni serveur à lancer, ni réglage réseau, ni adresse technique à saisir. » Ce harnais garde la part
 * programmable, en deux temps :
 *
 * 1. **Les textes de l'interface** (`apps/web/src`, `.svelte` et `.ts` : un message se fabrique
 *    aussi dans un module) ne portent aucune des formes concrètes que prendrait un tel geste — nom
 *    d'outil de ligne de commande, invite à ouvrir un terminal, adresse locale technique…
 * 2. **Les documents du dépôt sont classés** : lus par un développeur ou par qui héberge le serveur
 *    privé, ou destinés à qui tient son budget. Les seconds passent le même balayage que
 *    l'interface. Aucun n'existe aujourd'hui — `docs/hebergement-web.md` s'adresse à qui héberge,
 *    pas à qui budgète (D07) — mais un document nouveau ne peut plus échapper à C1 en silence : non
 *    classé, il fait rougir ce harnais, et qui le classe « utilisateur » le soumet au balayage.
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

/** Formes concrètes d'un geste technique qu'un texte d'interface ne doit jamais porter. */
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

/** Chemin relatif à la racine du dépôt, en séparateurs de chemin d'URL. */
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

describe('C1 · aucun geste technique dans les textes de l’interface (issue #73)', () => {
  it('aucun fichier de apps/web/src ne porte un des motifs interdits', () => {
    const fautifs: string[] = [];
    for (const chemin of fichiers(SOURCE, ['.svelte', '.ts'])) {
      const trouvés = gestesTechniquesTrouvés(readFileSync(chemin, 'utf8'));
      if (trouvés.length) fautifs.push(`${depuisLaRacine(chemin, RACINE)} : ${trouvés.join(', ')}`);
    }
    expect(fautifs, `geste technique trouvé dans l'interface :\n${fautifs.join('\n')}`).toEqual([]);
  });

  it('chaque document du dépôt est classé : technique, ou destiné à l’utilisateur', () => {
    const classés = new Set([...DOCUMENTS_TECHNIQUES, ...DOCUMENTS_UTILISATEUR]);
    const nonClassés = documentsDuDépôt().filter((d) => !classés.has(d));
    expect(
      nonClassés,
      'document non classé : le ranger parmi les documents techniques, ou parmi ceux destinés à ' +
        `l'utilisateur — auquel cas C1 le balaie :\n${nonClassés.join('\n')}`,
    ).toEqual([]);
    const disparus = [...classés].filter((d) => !existsSync(join(DÉPÔT, d)));
    expect(disparus, `document classé mais introuvable (renommé, supprimé ?) :\n${disparus.join('\n')}`).toEqual([]);
  });

  it('aucun document destiné à l’utilisateur ne demande un geste technique', () => {
    const fautifs: string[] = [];
    for (const document of DOCUMENTS_UTILISATEUR) {
      const trouvés = gestesTechniquesTrouvés(readFileSync(join(DÉPÔT, document), 'utf8'));
      if (trouvés.length) fautifs.push(`${document} : ${trouvés.join(', ')}`);
    }
    expect(fautifs, `geste technique trouvé dans un document utilisateur :\n${fautifs.join('\n')}`).toEqual([]);
  });
});

/**
 * Témoin rouge : la même détection rejouée sur un texte d'interface volontairement fautif — une
 * invite à ouvrir un terminal. Doit échouer ; `it.fails` tient l'échec attendu (#66).
 */
it.fails('témoin rouge · un texte d’interface qui invite à ouvrir un terminal', () => {
  const texteFautif = '<p>Ouvrez un terminal et lancez `pnpm install` puis `node serveur.js`.</p>';
  expect(gestesTechniquesTrouvés(texteFautif), 'le motif fautif aurait dû être détecté').toEqual([]);
});

/**
 * Témoin rouge du second temps : un document rangé parmi ceux destinés à l'utilisateur, qui fait
 * lancer un serveur. Le balayage doit le voir ; `it.fails` tient l'échec attendu (#66).
 */
it.fails('témoin rouge · un document destiné à l’utilisateur qui fait lancer un serveur', () => {
  const guideFautif = '## Sauvegarder\n\nLancez le serveur avec `pnpm preview`, puis ouvrez http://localhost:4173.';
  expect(gestesTechniquesTrouvés(guideFautif), 'le guide fautif aurait dû être détecté').toEqual([]);
});
