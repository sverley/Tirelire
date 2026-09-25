/**
 * Harnais d'I7 — « Les données restent en local » (issue #72, #38). L'invariant :
 * « Les données sont stockées en local, sur les appareils, et non sur un serveur. […] Une seule
 * exception : le stockage temporaire de paquets chiffrés sur un relais, pour la synchronisation
 * asynchrone (I8), que l'utilisateur accepte après avoir été averti. » Jusqu'ici, seule une
 * vérification manuelle (`VM-I7-reseau`) le tenait, à la main dans l'onglet Réseau.
 *
 * Analyse du code (13 septembre 2026) : dans tout `apps/web/src`, deux `fetch()` seulement — les
 * deux dans `relay.ts`, chiffrés AES-GCM avant envoi. Aucun autre appel réseau n'existe dans
 * l'application. Ce harnais le garde en deux temps :
 *
 * 1. Un parcours complet sans toucher à la synchronisation (exemple, Opérations, Bilan, import
 *    d'un relevé inventé, export) : le journal réseau du navigateur doit rester vide.
 * 2. Le relais activé : seules des requêtes vers l'adresse renseignée partent, leur corps ne porte
 *    que `{ site, iv, blob }` (aucun champ en clair de plus), et `blob` ne se relit pas comme
 *    du JSON en clair.
 *
 * Portée tranchée avec le porteur le 13 septembre 2026 : remplir l'adresse, le salon et la phrase
 * puis cliquer sur « Synchroniser maintenant » vaut l'acceptation, avertissement compris (le
 * paragraphe permanent au-dessus du formulaire), sans exiger de geste de consentement distinct.
 * Le harnais vérifie donc seulement qu'aucune requête ne part avant ce clic explicite, pas
 * l'existence d'un accusé de réception séparé.
 *
 * Ce harnais répond à #72 en gardant I7, pas #72 lui-même : #72 est une méta-issue d'outillage
 * (« I7 et I11 n'ont aucun harnais »), sans comportement propre à vérifier. L'entrée du registre
 * se déclare donc sous `## I7`, et non sous un identifiant qui n'existe pas dans `docs/invariants.md`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/**
 * Relevé inventé, écrit dans un répertoire temporaire plutôt que versionné : `*.csv` est
 * ignoré du dépôt, même inventé, pour qu'aucun réflexe n'y range un jour un vrai relevé.
 */
function écrireCsvInventé(): string {
  const lignes = [
    'Date transaction;Date comptabilisation;Num Compte;Libellé Compte;Libellé opération;Libellé complet;Catégorie;Sous-Catégorie;Montant;Pointée;',
    '01/09/2026;01/09/2026;00099999999;Compte Test Harnais;CARTE ACHAT TEST HARNAIS;CARTE ACHAT TEST HARNAIS I7;Vie quotidienne;Alimentation;-12,34;Non;',
  ];
  const chemin = join(mkdtempSync(join(tmpdir(), 'tirelire-i7-')), 'releve-invente.csv');
  writeFileSync(chemin, lignes.join('\r\n'), 'latin1');
  return chemin;
}

/** Une adresse de relais qui n'existe pas : les requêtes vers elle sont interceptées, jamais envoyées. */
const RELAIS = 'https://maison.exemple.fr/tirelire';

// ---------------------------------------------------------------------------
// Ce qu'on exige de chaque temps, et les témoins rouges qui les gardent
// ---------------------------------------------------------------------------

function vérifierParcoursSansSynchro(requêtes: string[]) {
  expect(requêtes, `des requêtes réseau sont parties hors synchronisation : ${requêtes.join(', ')}`).toEqual([]);
}

/**
 * Témoin rouge : la même assertion rejouée sur un journal volontairement non vide — une requête
 * qui serait partie pendant le parcours. Doit échouer ; `it.fails` tient l'échec attendu (#66).
 */
describe('[niveau 0] harnais du registre', () => {
  it.fails('témoin rouge · une requête réseau partie pendant un parcours sans synchronisation', () => {
    vérifierParcoursSansSynchro(['https://un-serveur-quelconque.exemple/inventé']);
  });
});

interface RequêteRelais {
  méthode: string;
  url: string;
  corps: string | undefined;
}

function vérifierRelaisChiffré(avantAccord: RequêteRelais[], aprèsAccord: RequêteRelais[]) {
  expect(avantAccord, `une requête part avant l'accord explicite (remplissage + clic) : ${JSON.stringify(avantAccord)}`).toEqual([]);
  expect(aprèsAccord.length, 'aucune requête n’est partie après le clic explicite sur « Synchroniser maintenant »').toBeGreaterThan(0);
  expect(
    aprèsAccord.filter((r) => r.méthode === 'POST' && r.corps).length,
    `aucun dépôt (POST) n’est parti vers le relais : rien du paquet envoyé n’a pu être vérifié (${aprèsAccord.map((r) => r.méthode).join(', ')})`,
  ).toBeGreaterThan(0);
  for (const r of aprèsAccord) {
    expect(r.url.startsWith(RELAIS), `requête vers une adresse imprévue : ${r.url}`).toBe(true);
    if (r.méthode !== 'POST' || !r.corps) continue;
    const corps = JSON.parse(r.corps) as Record<string, unknown>;
    expect(Object.keys(corps).sort(), `le paquet envoyé ne porte pas exactement site/iv/blob : ${Object.keys(corps).join(', ')}`).toEqual(['blob', 'iv', 'site']);
    const enClair = JSON.stringify(corps);
    for (const motPossible of ['Alimentation', 'Compte principal', 'Assurance', 'TIRELIRE']) {
      expect(enClair.includes(motPossible), `le paquet envoyé contient « ${motPossible} » en clair`).toBe(false);
    }
    expect(() => JSON.parse(atob(corps['blob'] as string)), 'le contenu du paquet se relit comme du JSON en clair : il n’est pas chiffré').toThrow();
  }
}

/**
 * Témoin rouge : la même vérification rejouée sur un paquet volontairement en clair — un `blob`
 * qui contient du JSON lisible, avec le nom d'une tirelire de l'exemple. Doit échouer.
 */
describe('[niveau 0] harnais du registre', () => {
  it.fails('témoin rouge · un paquet envoyé au relais dont le contenu se relit en clair', () => {
    const enClair = JSON.stringify({ tirelire: 'Alimentation', montant: -1234 });
    const corps = JSON.stringify({ site: 's1', iv: 'abc', blob: btoa(enClair) });
    vérifierRelaisChiffré([], [{ méthode: 'POST', url: `${RELAIS}/r/salon`, corps }]);
  });
});

// ---------------------------------------------------------------------------
// Mesures dans le navigateur
// ---------------------------------------------------------------------------

/** Remplit les trois champs du relais par leur `placeholder` ou leur type — sans les enregistrer. */
async function remplirRelais(page: Page, url: string, salon: string, phrase: string): Promise<void> {
  await page.evaluate(
    (url: string, salon: string, phrase: string) => {
      const définir = (input: HTMLInputElement | undefined, v: string) => {
        if (!input) return;
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const entrées = [...document.querySelectorAll('input')] as HTMLInputElement[];
      définir(entrées.find((i) => i.placeholder === 'https://maison.exemple.fr/tirelire'), url);
      définir(entrées.find((i) => i.placeholder === 'identifiant secret'), salon);
      définir(entrées.find((i) => i.type === 'password'), phrase);
    },
    url,
    salon,
    phrase,
  );
}

describe('[niveau 0] harnais du registre', () => {
  describe.skipIf(!navigateur)('I7 · les données restent en local (issue #72)', () => {
    let site: Site;

    beforeAll(async () => {
      site = await ouvrirLeSite();
    }, 120_000);

    afterAll(async () => {
      await site?.fermer();
    });

    it('un parcours complet sans synchronisation ne fait sortir aucune donnée de l’appareil', async () => {
      const page = await ouvrirLExemple(site);
      const requêtes: string[] = [];
      page.on('request', (req) => requêtes.push(req.url()));

      await allerÀ(page, 'Opérations');
      await pause(150);
      await allerÀ(page, 'Bilan');
      await pause(150);

      await allerÀ(page, 'Import');
      await pause(150);
      const champFichier = await page.$('input[type=file]');
      expect(champFichier, "l'écran Import ne présente aucun sélecteur de fichier").not.toBeNull();
      await champFichier!.uploadFile(écrireCsvInventé());
      await pause(400);

      await allerÀ(page, 'Plus');
      await cliquer(page, 'Réglages');
      await pause(150);
      await cliquer(page, 'Exporter le fichier SQLite');
      await pause(300);

      await page.close();
      vérifierParcoursSansSynchro(requêtes);
    }, 60_000);

    it('avec un relais renseigné, seuls des paquets chiffrés partent, et seulement après le remplissage et le clic explicites', async () => {
      const page = await ouvrirLExemple(site);
      await allerÀ(page, 'Plus');
      await cliquer(page, 'Synchronisation');
      await pause(200);

      const avantAccord: RequêteRelais[] = [];
      const aprèsAccord: RequêteRelais[] = [];
      let accordé = false;

      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url();
        if (!url.startsWith(RELAIS)) {
          void req.continue();
          return;
        }
        // Le relais factice répond comme un vrai relais d'une autre origine : en CORS, preflight
        // compris. Sans cela, le retrait échoue dans la page et aucun dépôt ne part.
        const cors = {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
        };
        if (req.method() === 'OPTIONS') {
          void req.respond({ status: 204, headers: cors, body: '' });
          return;
        }
        const entrée = { méthode: req.method(), url, corps: req.postData() };
        (accordé ? aprèsAccord : avantAccord).push(entrée);
        void req.respond({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: req.method() === 'GET' ? JSON.stringify({ records: [] }) : JSON.stringify({ id: 1 }),
        });
      });

      await remplirRelais(page, RELAIS, 'salon-invente-harnais-i7', 'phrase de test suffisamment longue et inventée');
      await pause(150);

      accordé = true;
      await cliquer(page, 'Synchroniser maintenant');
      // Le dépôt suit le retrait et le chiffrement (dérivation de clé) : l'attendre, sans s'y fier.
      for (let i = 0; i < 50 && !aprèsAccord.some((r) => r.méthode === 'POST'); i++) await pause(100);
      await pause(200);

      await page.close();
      vérifierRelaisChiffré(avantAccord, aprèsAccord);
    }, 60_000);
  });
});
