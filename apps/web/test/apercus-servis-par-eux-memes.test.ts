/**
 * #233 — à la racine de la recette, la version de développement (le site de `main`, construit pour
 * `/`) enregistre un service worker dont la portée couvre toute la recette, aperçus compris. Il ne
 * doit pas répondre aux navigations vers `pr-<numéro>` par sa propre page : chaque aperçu reste servi
 * par lui-même, puis par son propre service worker, de portée `/pr-<numéro>/`. Le service worker que
 * produit vite-plugin-pwa répond à toute navigation par la page de l'application, sauf celles de
 * `navigateFallbackDenylist`, que Workbox compare au chemin suivi de la requête.
 */
import { describe, expect, test } from 'vitest';
import { navigationsLaisséesAuServeur } from '../vite.config';

const laisséeAuServeur = (base: string, chemin: string) => navigationsLaisséesAuServeur(base).some((r) => r.test(chemin));

describe('[niveau 2] #233 · chaque aperçu reste servi par lui-même, pas par la version de développement', () => {
  test('à la racine, les navigations vers un aperçu vont au serveur', () => {
    for (const chemin of ['/pr-12/', '/pr-12', '/pr-12/index.html', '/pr-307/budget', '/pr-12/?source=pwa', '/pr-12?x=1']) {
      expect(laisséeAuServeur('/', chemin), chemin).toBe(true);
    }
  });

  test('à la racine, les navigations de la version de développement restent les siennes', () => {
    for (const chemin of ['/', '/index.html', '/?source=pwa', '/budget', '/pr-', '/pr-0/', '/pr-12x/', '/print', '/r/salon']) {
      expect(laisséeAuServeur('/', chemin), chemin).toBe(false);
    }
  });

  test('un aperçu, ou un site en sous-dossier, garde ses propres navigations', () => {
    for (const chemin of ['/pr-12/', '/pr-12/budget', '/pr-12/?source=pwa']) expect(laisséeAuServeur('/pr-12/', chemin), chemin).toBe(false);
    for (const chemin of ['/tirelire/', '/tirelire/budget']) expect(laisséeAuServeur('/tirelire', chemin), chemin).toBe(false);
    expect(laisséeAuServeur('/tirelire/', '/tirelire/pr-4/')).toBe(true);
  });
});
