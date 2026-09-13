/**
 * Harnais de C1 — « Aucun geste technique pour l'utilisateur » (issue #73, chantier de #38,
 * objectif primaire #58). Jusqu'ici, seule une vérification manuelle (`VM-C1-sans-geste`) le
 * tenait, à relire à chaque PR.
 *
 * C1 : « Installer, mettre à jour, sauvegarder et synchroniser ne demandent ni ligne de commande,
 * ni serveur à lancer, ni réglage réseau, ni adresse technique à saisir. » Ce harnais garde la part
 * programmable : aucun fichier de l'interface (`apps/web/src`) ne porte, dans son texte, une des
 * formes concrètes que prendrait un tel geste (nom d'outil de ligne de commande, invite à ouvrir un
 * terminal, adresse locale technique…).
 *
 * Limite assumée : seule l'interface de l'application est balayée aujourd'hui, faute de
 * documentation dédiée à l'utilisateur dans le dépôt (`docs/hebergement-web.md` s'adresse à qui
 * héberge le serveur privé, pas à qui tient son budget — D07). Le jour où un tel document ou un
 * écran d'aide apparaît, il rejoint le balayage ci-dessous ; la revue manuelle (`VM-C1-sans-geste`)
 * reste la garde de l'esprit de C1 (voie avancée tolérée à côté d'une voie simple), que ce balayage
 * littéral ne juge pas.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RACINE } from './harnais.js';

const SOURCE = join(RACINE, 'src');

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

/** Fichiers d'un dossier, en profondeur, dont le nom finit par l'un des suffixes donnés. */
function fichiers(dossier: string, suffixes: string[]): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) return fichiers(chemin, suffixes);
    return suffixes.some((s) => e.name.endsWith(s)) ? [chemin] : [];
  });
}

/** Les motifs d'un geste technique trouvés dans `contenu`, vide si aucun. */
export function gestesTechniquesTrouvés(contenu: string): string[] {
  return MOTIFS_GESTE_TECHNIQUE.filter((motif) => motif.test(contenu)).map((motif) => motif.source);
}

describe('C1 · aucun geste technique dans les textes de l’interface (issue #73)', () => {
  it('aucun fichier de apps/web/src ne porte un des motifs interdits', () => {
    const fautifs: string[] = [];
    for (const chemin of fichiers(SOURCE, ['.svelte'])) {
      const trouvés = gestesTechniquesTrouvés(readFileSync(chemin, 'utf8'));
      if (trouvés.length) fautifs.push(`${relative(RACINE, chemin)} : ${trouvés.join(', ')}`);
    }
    expect(fautifs, `geste technique trouvé dans l'interface :\n${fautifs.join('\n')}`).toEqual([]);
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
