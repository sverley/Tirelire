/**
 * Harnais de C2 — « L'essentiel ne dépend d'aucune capacité propre à une plateforme » (issue #73,
 * #38, #58). C2 cite nommément la lecture de QR code par caméra comme
 * exemple de capacité qui varie d'un navigateur à l'autre ; jusqu'ici seule une vérification
 * manuelle (`VM-C2-equivalent`) et une ligne « À bâtir » le tenaient.
 *
 * Analyse du code (13 septembre 2026) : dans `apps/web/src`, la caméra et le QR code
 * (`BarcodeDetector`, `getUserMedia`) n'apparaissent que dans `views/Sync.svelte` et
 * `lib/webrtc.ts`, au service de la mise en relation directe entre appareils (I8) — jamais dans les
 * cinq usages U1 à U5 (budget, virements, rapprochement, reconstruction, import seul). Ce harnais
 * garde ce fait : aucun autre fichier de l'interface n'y fait appel. Le parcours équivalent sans
 * caméra à l'intérieur même de la synchronisation reste couvert par `VM-I8-deux-instances`
 * (« deux sessions d'ordinateur sans appareil photo ») et par `VM-C2-equivalent` pour toute
 * nouvelle capacité qu'une PR ajouterait.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RACINE } from './harnais.js';

const SOURCE = join(RACINE, 'src');

/** Fichiers où la caméra et le QR code sont tolérés : la mise en relation directe (I8). */
const FICHIERS_TOLÉRÉS = new Set(['src/views/Sync.svelte', 'src/lib/webrtc.ts']);

const MOTIFS_CAMÉRA: RegExp[] = [/BarcodeDetector/, /getUserMedia/, /\bcaméra\b/i, /\bappareil\s+photo\b/i, /\bQR\b/];

/** Fichiers d'un dossier, en profondeur, dont le nom finit par l'un des suffixes donnés. */
function fichiers(dossier: string, suffixes: string[]): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) return fichiers(chemin, suffixes);
    return suffixes.some((s) => e.name.endsWith(s)) ? [chemin] : [];
  });
}

/** Les motifs de caméra/QR trouvés dans `contenu`, vide si aucun. */
export function dépendanceCaméraTrouvée(contenu: string): string[] {
  return MOTIFS_CAMÉRA.filter((motif) => motif.test(contenu)).map((motif) => motif.source);
}

/** Les fichiers non tolérés qui font appel à la caméra ou au QR code, chacun avec ses motifs. */
export function dépendancesHorsTolérance(fichiers: string[], lire: (f: string) => string, tolérés: Set<string>): string[] {
  return fichiers.flatMap((nom) => {
    if (tolérés.has(nom)) return [];
    const trouvés = dépendanceCaméraTrouvée(lire(nom));
    return trouvés.length ? [`${nom} : ${trouvés.join(', ')}`] : [];
  });
}

/**
 * Ce qu'on exige du balayage, à part du test pour que le témoin rouge rejoue les mêmes assertions.
 * La non-vacuité en fait partie : un balayage qui ne lit plus aucun fichier passerait pour vert en
 * ne gardant plus rien.
 */
function vérifierAbsenceCaméra(fichiers: string[], lire: (f: string) => string, tolérés: Set<string>): void {
  expect(fichiers.length, 'aucun fichier balayé : C2 ne garderait plus rien').toBeGreaterThan(0);
  const fautifs = dépendancesHorsTolérance(fichiers, lire, tolérés);
  expect(fautifs, `dépendance caméra/QR trouvée hors synchronisation :\n${fautifs.join('\n')}`).toEqual([]);
}

describe('C2 · les parcours essentiels passent sans caméra ni QR code (issue #73)', () => {
  it('aucun fichier essentiel ne fait appel à la caméra ou au QR code, hors Sync.svelte et webrtc.ts', () => {
    const balayés = fichiers(SOURCE, ['.svelte', '.ts']).map((c) => relative(RACINE, c).split('\\').join('/'));
    vérifierAbsenceCaméra(balayés, (c) => readFileSync(join(RACINE, c), 'utf8'), FICHIERS_TOLÉRÉS);
  });
});

/**
 * Témoin rouge : les mêmes assertions rejouées sur un écran essentiel inventé — un Plan qui
 * appellerait `BarcodeDetector`. Doit échouer ; `it.fails` tient l'échec attendu (#66).
 */
it.fails('témoin rouge · un écran essentiel qui dépend de BarcodeDetector', () => {
  vérifierAbsenceCaméra(
    ['src/views/Plan.svelte'],
    () => "const détecteur = new BarcodeDetector({ formats: ['qr_code'] });",
    FICHIERS_TOLÉRÉS,
  );
});
