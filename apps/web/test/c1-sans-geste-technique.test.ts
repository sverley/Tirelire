/**
 * Harnais de C1 — « Aucun geste technique pour l'utilisateur » (issue #73, #38,
 * #58). Jusqu'ici, seule une vérification manuelle (`VM-C1-sans-geste`) le
 * tenait, à relire à chaque PR.
 *
 * C1 : « Installer, mettre à jour, sauvegarder et synchroniser ne demandent ni ligne de commande,
 * ni serveur à lancer, ni réglage réseau, ni adresse technique à saisir. » Ce harnais garde la part
 * programmable : aucun des textes que l'application met sous les yeux de l'utilisateur ne porte une
 * des formes concrètes que prendrait un tel geste — nom d'outil de ligne de commande, invite à
 * ouvrir un terminal, adresse locale technique… Deux endroits, donc deux garanties :
 *
 * 1. **L'interface** (`apps/web/src`, `.svelte` et `.ts` : un message se fabrique aussi dans un
 *    module) ;
 * 2. **Ce qui s'affiche sans passer par `src`** : le titre de `index.html`, et du manifeste PWA de
 *    `vite.config.ts` le nom, le nom court et la description — ce que le système écrit sous
 *    l'icône. Du fichier de configuration, seuls ces trois textes sont lus : le reste est du
 *    réglage de construction, qu'un balayage de gestes techniques n'a pas à juger.
 *
 * Ce qu'il ne garde pas, tranché par le porteur le 14 septembre : la documentation destinée à
 * l'utilisateur. La garde vérifie que les règles de codage ne sont pas enfreintes ; un document
 * écrit pour qui tient son budget n'entre pas dans son périmètre. Il reste à la revue
 * `VM-C1-sans-geste`, qui le nomme déjà — comme l'esprit de C1, qu'un balayage littéral ne juge
 * pas : une voie avancée est tolérée, jamais seule.
 *
 * Ce que le contrôle exige est écrit dans une fonction à part (`vérifierBalayage`), pour que le
 * témoin rouge rejoue **les mêmes assertions** sur un jeu inventé, et non une détection voisine qui
 * passerait pour elles (#66, #69). L'assertion de non-vacuité la complète : un balayage qui ne lit
 * plus rien passerait sinon pour vert en ne gardant plus rien.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RACINE } from './harnais.js';

const SOURCE = join(RACINE, 'src');

/** Formes concrètes d'un geste technique qu'un texte de l'interface ne doit jamais porter. */
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

/** Fichiers d'un dossier, en profondeur, dont le nom finit par l'un des suffixes donnés. */
function fichiers(dossier: string, suffixes: string[]): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) return fichiers(chemin, suffixes);
    return suffixes.some((s) => e.name.endsWith(s)) ? [chemin] : [];
  });
}

/** Les textes du manifeste PWA que l'utilisateur lit, nommés pour le balayage. */
export function textesDuManifeste(source: string): Map<string, string> {
  const textes = new Map<string, string>();
  for (const champ of ['name', 'short_name', 'description']) {
    const trouvé = source.match(new RegExp(`\\b${champ}:\\s*'([^']*)'`));
    if (trouvé?.[1] !== undefined) textes.set(`vite.config.ts · manifest.${champ}`, trouvé[1]);
  }
  return textes;
}

/** Chemin relatif à `apps/web`, en séparateurs de chemin d'URL. */
const depuisLaRacine = (chemin: string) => relative(RACINE, chemin).split('\\').join('/');

/** Les motifs d'un geste technique trouvés dans `contenu`, vide si aucun. */
export function gestesTechniquesTrouvés(contenu: string): string[] {
  return MOTIFS_GESTE_TECHNIQUE.filter((motif) => motif.test(contenu)).map((motif) => motif.source);
}

/** Les fichiers fautifs d'un ensemble, chacun nommé avec les motifs qu'il porte. */
export function balayageDesGestes(textes: string[], lire: (texte: string) => string): string[] {
  return textes.flatMap((nom) => {
    const trouvés = gestesTechniquesTrouvés(lire(nom));
    return trouvés.length ? [`${nom} : ${trouvés.join(', ')}`] : [];
  });
}

/** Ce qu'on exige du balayage, à part du test pour que le témoin rouge rejoue les mêmes assertions. */
function vérifierBalayage(quoi: string, textes: string[], lire: (texte: string) => string): void {
  const fautifs = balayageDesGestes(textes, lire);
  expect(fautifs, `geste technique trouvé dans ${quoi} :\n${fautifs.join('\n')}`).toEqual([]);
}

describe('C1 · aucun geste technique dans les textes de l’interface (issue #73)', () => {
  it('aucun fichier de apps/web/src ne porte un des motifs interdits', () => {
    const balayés = fichiers(SOURCE, ['.svelte', '.ts']).map(depuisLaRacine);
    for (const suffixe of ['.svelte', '.ts'])
      expect(
        balayés.some((c) => c.endsWith(suffixe)),
        `aucun fichier ${suffixe} balayé : de ce côté, C1 ne garderait plus rien`,
      ).toBe(true);
    vérifierBalayage('l’interface', balayés, (c) => readFileSync(join(RACINE, c), 'utf8'));
  });

  it('ni index.html ni le manifeste de vite.config.ts ne portent un des motifs interdits', () => {
    const textes = new Map<string, string>([
      ['index.html', readFileSync(join(RACINE, 'index.html'), 'utf8')],
      ...textesDuManifeste(readFileSync(join(RACINE, 'vite.config.ts'), 'utf8')),
    ]);
    expect(
      [...textes.keys()],
      'le manifeste ne livre plus ses trois textes : champ renommé, guillemets changés ? de ce côté, C1 ne garderait plus rien',
    ).toEqual([
      'index.html',
      'vite.config.ts · manifest.name',
      'vite.config.ts · manifest.short_name',
      'vite.config.ts · manifest.description',
    ]);
    vérifierBalayage('un texte affiché hors de l’interface', [...textes.keys()], (nom) => textes.get(nom) ?? '');
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
 * Témoin rouge du second temps : les mêmes assertions rejouées sur un manifeste inventé dont la
 * description fait ouvrir un terminal. Doit échouer ; `it.fails` tient l'échec attendu (#66).
 */
it.fails('témoin rouge · un manifeste dont la description fait ouvrir un terminal', () => {
  vérifierBalayage(
    'un texte affiché hors de l’interface',
    ['vite.config.ts · manifest.description'],
    () => 'Comptes de la famille. Pour sauvegarder, ouvrez un terminal.',
  );
});
