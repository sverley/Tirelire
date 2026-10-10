// @vitest-environment jsdom
/**
 * Harnais d'audit de #421, composé parmi les tests du codeur :
 * ce que vérifiait, dans le navigateur, le second fichier du harnais d'audit de #42
 * (`navigateur/stockage-persistant-cas.test.ts`, « Les données du navigateur doivent être protégées de l'effacement »,
 * la dernière phrase du « Fait quand » : « Les textes vouvoient (D85). »), que #421 retire, se vérifie ici sans
 * navigateur : l'application montée sous jsdom (`ecran.ts`), au jour des tests, sur une base vide. Le titre dit ce qu'il
 * vérifie, et le numéro du test retiré dans la table de #421 (« stockage-persistant-cas 1 », joué pour les trois
 * réponses du navigateur). Les niveaux 0 et 1 de #42, que le registre cite sous C4, restent dans
 * `navigateur/stockage-persistant.test.ts`.
 *
 * Les textes que #42 ajoute ou touche : le signal de l'accueil, quand la persistance est refusée ou impossible, et la
 * carte « Données » de Réglages, sous les trois réponses. La réponse du navigateur se règle, comme dans le test retiré,
 * par `navigator.storage.persist()` et `navigator.storage.persisted()`, avant l'ouverture : accordée (la demande
 * l'obtient), refusée, impossible (le navigateur n'offre ni l'une ni l'autre). Le signal se lit comme dans le test
 * retiré : le plus petit élément, hors barre d'onglets, qui dit « effac… » et « navigateur », étendu au premier bloc
 * qui porte une commande ; la carte, l'élément qui suit le titre « Données ». jsdom ne met rien en page : ce qui est
 * rendu compte pour visible.
 *
 * Le tutoiement se repère aux formes que repérait le test retiré, son expression `TUTOIEMENT` recopiée. Les textes sont
 * lus tels que l'application les montre, nœud de texte par nœud de texte.
 *
 * Niveau (D83) : celui du test retiré, que la table de #421 recopie : 2 (D85, une décision).
 */
import { describe, expect, it } from 'vitest';
import { app, attendre, ecran, ouvrirLApplication, tous } from './ecran';

type Reponse = 'accordée' | 'refusée' | 'impossible';

interface Texte {
  ou: string;
  texte: string | null;
}

/** Les formes du tutoiement, recopiées du test retiré. */
const TUTOIEMENT = [
  /(?<![\p{L}\p{N}])(tu|te|toi|ton|ta|tes|tien|tienne|tiens|tiennes)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])t['’](?=\p{L})/iu,
  /(?<![\p{L}\p{N}])\p{L}+e-(le|la|les|lui|leur|moi|en|y)(?![\p{L}\p{N}])/iu,
];

function verifierVouvoiement(x: Texte): void {
  expect(x.texte, `${x.ou} : texte introuvable`).not.toBeNull();
  const formes = TUTOIEMENT.map((m) => x.texte!.match(m)?.[0]).filter((f): f is string => !!f);
  expect(formes, `${x.ou} : le texte tutoie (${formes.map((f) => `« ${f} »`).join(', ')}) : « ${x.texte} »`).toEqual([]);
}

/** Le texte d'un élément tel qu'il se lit : ses nœuds de texte, chacun séparé du suivant. */
function texteLu(e: Element): string {
  const parcours = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  const morceaux: string[] = [];
  for (let n = parcours.nextNode(); n; n = parcours.nextNode()) morceaux.push(n.textContent ?? '');
  return morceaux.join(' ').replace(/\s+/g, ' ').trim();
}

/** Règle ce que le navigateur répondra, avant l'ouverture (comme le test retiré). */
function regler(reponse: Reponse): void {
  let persistante = false;
  const stockage =
    reponse === 'impossible'
      ? {}
      : {
          persisted: async () => persistante,
          persist: async () => {
            if (reponse !== 'refusée') persistante = true;
            return persistante;
          },
        };
  Object.defineProperty(navigator, 'storage', { configurable: true, value: stockage });
}

/** Le texte du signal : le plus petit élément, hors barre d'onglets, qui dit « effac… » et « navigateur », ou `null`. */
function lireLeSignal(): string | null {
  const dit = (s: string) => /effac/i.test(s) && /navigateur/i.test(s);
  const candidats = [...document.body.querySelectorAll('*')].filter((e) => !e.closest('.tabbar, script, style, template') && dit(e.textContent ?? ''));
  const feuille = candidats.find((e) => ![...e.children].some((c) => dit(c.textContent ?? '')));
  if (!feuille) return null;
  // Le bloc du signal : on remonte tant qu'on reste sous `main`, l'en-tête ou le corps, jusqu'au premier bloc qui
  // porte une commande, pour lire aussi ses boutons.
  const bornes = new Set<Element | null>([document.body, document.documentElement, document.querySelector('main'), document.querySelector('header')]);
  for (let bloc: Element | null = feuille; bloc && !bornes.has(bloc); bloc = bloc.parentElement)
    if (bloc.querySelector('button, a[href], [role="button"]')) return texteLu(bloc);
  return texteLu(feuille);
}

/** Le texte de la carte « Données » de Réglages : l'élément qui suit son titre, ou `null`. */
async function lireLaCarteDonnees(): Promise<string | null> {
  expect(await ecran('Réglages'), 'l’écran Réglages est introuvable').toBe(true);
  const titre = tous('main h1, main h2, main h3').find((h) => h.textContent?.trim() === 'Données');
  const carte = titre?.nextElementSibling;
  return carte ? texteLu(carte) : null;
}

const ETAT = { accordée: 'accordee', refusée: 'refusee', impossible: 'impossible' } as const;

describe('#421 · #42 — les textes de la persistance vouvoient (D85), sans navigateur', () => {
  for (const reponse of ['accordée', 'refusée', 'impossible'] as const) {
    it(`[niveau 2] #42, D85 (table #421, stockage-persistant-cas 1) — persistance ${reponse} : le signal de l’accueil, s’il est là, et la carte « Données » de Réglages, qui doit l’être, ne tutoient pas`, async () => {
      regler(reponse);
      await ouvrirLApplication();
      await attendre(() => app.persistance === ETAT[reponse], `la persistance ${reponse}`);
      if (reponse !== 'accordée') {
        const signal = lireLeSignal();
        // L'absence du signal relève du harnais du registre (`navigateur/stockage-persistant.test.ts`, point 3) ; ici,
        // seuls ses mots comptent.
        if (signal !== null) verifierVouvoiement({ ou: `accueil, persistance ${reponse}`, texte: signal });
      }
      verifierVouvoiement({ ou: `Réglages, persistance ${reponse}`, texte: await lireLaCarteDonnees() });
    });
  }
});
