// @vitest-environment jsdom
/**
 * Harnais d'audit de #421, composé parmi les tests du codeur :
 * ce que vérifiait, dans le navigateur, le second fichier du harnais d'audit de #41
 * (`navigateur/sauvegarde-evidente-cas.test.ts`, « Sans serveur, la sauvegarde doit être évidente », la dernière phrase
 * du « Fait quand » : « Les textes vouvoient (D85). »), que #421 retire, se vérifie ici sans navigateur : l'application
 * montée sous jsdom (`ecran.ts`), au jour des tests. Le titre dit ce qu'il vérifie, et le numéro du test retiré dans la
 * table de #421 (« sauvegarde-evidente-cas 1 »). Les niveaux 0 et 1 de #41, que le registre cite sous C5, restent dans
 * `navigateur/sauvegarde-evidente.test.ts`.
 *
 * Les textes que #41 ajoute ou touche : le rappel de sauvegarde de l'accueil et la carte « Données » de Réglages, lus
 * comme dans le test retiré — un enfant direct de `main` qui parle de sauvegarde et porte un bouton ; l'élément qui suit
 * le titre « Données » —, persistance accordée (le navigateur de `ecran.ts` garde les données), l'exemple chargé puis
 * l'application rouverte. jsdom ne met rien en page : ce qui est rendu compte pour visible.
 *
 * Le tutoiement se repère aux formes que repérait le test retiré, son expression `TUTOIEMENT` recopiée : les pronoms
 * et possessifs de la deuxième personne du singulier et l'impératif suivi d'un pronom (« Exporte-le »). Les textes
 * sont lus tels que l'application les montre, nœud de texte par nœud de texte.
 *
 * Niveau (D83) : celui du test retiré, que la table de #421 recopie : 2 (D85, une décision).
 */
import { describe, expect, it } from 'vitest';
import { alive } from '@tirelire/core';
import { app, attendre, cliquer, ecran, ouvrirLApplication, rouvrirLApplication, tous } from './ecran';

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

/** Le texte du rappel : un enfant direct de `main` dont le texte parle de sauvegarde et qui porte un bouton, ou `null`. */
const lireLeRappel = (): string | null => {
  const b = [...(document.querySelector('main')?.children ?? [])].find((e) => /sauvegard/i.test(e.textContent ?? '') && !!e.querySelector('button'));
  return b ? texteLu(b) : null;
};

/** Le texte de la carte « Données » de Réglages : l'élément qui suit son titre, ou `null`. */
async function lireLaCarteDonnees(): Promise<string | null> {
  expect(await ecran('Réglages'), 'l’écran Réglages est introuvable').toBe(true);
  const titre = tous('main h1, main h2, main h3').find((h) => h.textContent?.trim() === 'Données');
  const carte = titre?.nextElementSibling;
  return carte ? texteLu(carte) : null;
}

describe('#421 · #41 — les textes de la sauvegarde vouvoient (D85), sans navigateur', () => {
  it('[niveau 2] #41, D85 (table #421, sauvegarde-evidente-cas 1) — persistance accordée, l’exemple chargé puis l’application rouverte : le rappel de l’accueil, s’il est là, et la carte « Données » de Réglages, qui doit l’être, ne tutoient pas', async () => {
    await ouvrirLApplication();
    expect(await cliquer('Charger l\'exemple')).toBe(true);
    await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A'), 'l’exemple');
    await rouvrirLApplication();
    await attendre(() => app.persistance === 'accordee', 'la persistance accordée');
    const rappel = lireLeRappel();
    // L'absence du rappel relève du harnais du registre (`navigateur/sauvegarde-evidente.test.ts`, point 3) ; ici,
    // seuls ses mots comptent.
    if (rappel !== null) verifierVouvoiement({ ou: 'accueil, rappel', texte: rappel });
    verifierVouvoiement({ ou: 'Réglages, carte « Données »', texte: await lireLaCarteDonnees() });
  });
});
