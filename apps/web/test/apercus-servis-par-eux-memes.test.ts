/**
 * #233 — à la racine de la recette, la version de développement (le site de `main`, construit pour
 * `/`) enregistre un service worker dont la portée couvre toute la recette, aperçus compris. Il ne
 * doit pas répondre aux navigations vers `pr-<numéro>` par sa propre page : chaque aperçu reste servi
 * par lui-même, puis par son propre service worker, de portée `/pr-<numéro>/`.
 *
 * Le service worker se génère ici depuis la configuration même du build (`vite.config.ts`, résolue
 * par Vite, puis vite-plugin-pwa et Workbox), pour une base donnée, sans construire l'application :
 * c'est ce qu'il contient qui se vérifie, pas une fonction qu'il pourrait ne plus employer. Workbox
 * répond à toute navigation par la page de l'application (`NavigationRoute`), sauf celles de sa
 * liste d'exclusion (`denylist`), qu'il compare au chemin suivi de la requête.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig, type Plugin } from 'vite';
import { describe, expect, test } from 'vitest';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Le service worker que produit la configuration du build pour cette base. */
async function serviceWorker(base: string): Promise<string> {
  const sortie = mkdtempSync(path.join(tmpdir(), 'tirelire-sw-'));
  const avant = process.env.TIRELIRE_BASE;
  try {
    writeFileSync(path.join(sortie, 'index.html'), '<!doctype html><title>Tirelire</title>');
    // `vite.config.ts` lit sa base dans TIRELIRE_BASE, comme l'assembleur la lui donne.
    process.env.TIRELIRE_BASE = base;
    const config = await resolveConfig({ root: WEB, configFile: path.join(WEB, 'vite.config.ts'), build: { outDir: sortie }, logLevel: 'silent' }, 'build', 'production');
    const pwa = config.plugins.find((p) => p.name === 'vite-plugin-pwa') as (Plugin & { api?: { generateSW(): Promise<unknown> } }) | undefined;
    if (!pwa?.api) throw new Error('vite.config.ts : plus de greffon vite-plugin-pwa');
    await pwa.api.generateSW();
    return readFileSync(path.join(sortie, 'sw.js'), 'utf8');
  } finally {
    if (avant === undefined) delete process.env.TIRELIRE_BASE;
    else process.env.TIRELIRE_BASE = avant;
    rmSync(sortie, { recursive: true, force: true });
  }
}

/** Le service worker laisse-t-il cette navigation au serveur, au lieu d'y répondre par sa page ? */
function laisséeAuServeur(sw: string, chemin: string): boolean {
  if (!/NavigationRoute\(/.test(sw)) return true;
  const liste = sw.match(/denylist:\s*(\[[\s\S]*?\])\s*\}\s*\)/)?.[1];
  if (!liste) return false;
  const motifs = new Function(`return ${liste};`)() as RegExp[];
  return motifs.some((m) => m.test(chemin));
}

// Niveau 2 (D83) : un cas de D83, « Livraison » (#233) — « chaque aperçu reste servi par lui-même ».
// S'il tombait, l'aperçu montrerait la version de développement : un résultat faux, sans donnée
// perdue, et sans usage, principe, invariant ni contrainte qui tombe.
describe('[niveau 2] D83, livraison (#233) · chaque aperçu reste servi par lui-même, pas par la version de développement', () => {
  test('à la racine, le service worker laisse au serveur les navigations vers un aperçu, et garde les siennes', async () => {
    const sw = await serviceWorker('/');
    expect(sw, 'le service worker ne répond plus aux navigations de la version de développement').toMatch(/NavigationRoute\(/);
    for (const chemin of ['/pr-12/', '/pr-12', '/pr-12/index.html', '/pr-307/budget', '/pr-12/?source=pwa', '/pr-12?x=1']) {
      expect(laisséeAuServeur(sw, chemin), `${chemin} : la version de développement répondrait à la place de l'aperçu`).toBe(true);
    }
    for (const chemin of ['/', '/index.html', '/?source=pwa', '/budget', '/pr-', '/pr-0/', '/pr-12x/', '/print']) {
      expect(laisséeAuServeur(sw, chemin), `${chemin} : la version de développement ne répondrait plus à sa propre navigation`).toBe(false);
    }
  });

  test('un aperçu, construit pour son sous-dossier, garde ses propres navigations', async () => {
    const sw = await serviceWorker('/pr-12/');
    for (const chemin of ['/pr-12/', '/pr-12/budget', '/pr-12/?source=pwa']) {
      expect(laisséeAuServeur(sw, chemin), `${chemin} : l'aperçu ne répondrait plus à sa propre navigation`).toBe(false);
    }
  });
});
