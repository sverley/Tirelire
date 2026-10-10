// @vitest-environment jsdom
/**
 * Harnais d'audit de #421, composé parmi les tests du codeur :
 * ce que vérifiait, dans le navigateur, le harnais d'audit de #369
 * (`navigateur/ecran-tirelires-harnais.test.ts`, « l'écran Tirelires emploie la section Tirelires de l'assistant »),
 * sauf le formulaire d'ajout mesuré à 375 px, que #421 retire du navigateur, se vérifie ici sans navigateur :
 * l'application montée sous jsdom (`ecran.ts`), au jour des tests, sur une base vide. Chaque titre dit le point du
 * « Fait quand » de #369 qu'il vérifie, et le numéro du test retiré dans la table de #421 (« ecran-tirelires 1 » à
 * « ecran-tirelires 8 »).
 *
 * Décor, comme dans le test retiré : une base vide ; les tests se suivent, et 5 à 8 portent sur la tirelire que le
 * premier raccourci y crée (le 4). Chaque test repart de l'écran Tirelires rouvert ; « l'écran rouvert » est ici
 * l'application rechargée (`rouvrirLApplication`), qui ne relit que ce qui est enregistré, puis l'écran rouvert.
 *
 * Ce qui se lit ici est ce que l'écran montre — ses cartes et leurs champs, ses raccourcis, son explication repliée,
 * ses panneaux nommés — et ce qu'il enregistre : le projet que le dépôt relit. Le texte de l'explication, écrit une fois,
 * et l'écran qui offre les raccourcis sont lus dans les sources par `ecran-tirelires-section.test.ts` ; le formulaire
 * d'ajout de la section, avec ses aides, et sa mesure à 375 px restent dans le navigateur
 * (`navigateur/ecran-tirelires-harnais.test.ts`).
 *
 * Niveaux (D83) : ceux des tests retirés, que la table de #421 recopie. 1 pour 1 (I10, D46 : rien de créé d'office),
 * 2 (I5 : l'écran vide dit ce qui le remplirait) et 5 (U1 : la carte corrigée s'écrit dans le projet), chacun vu rouge
 * à l'audit sur une mutation ciblée — un écran qui garnit d'office une base vide (1), un écran vide sans raccourcis
 * (2), un déjà de côté corrigé sur la carte qui ne s'écrit pas (5) ; 2 pour 4, 6, 7 et 8 (D46, D51, D59 : un
 * résultat faux, l'usage restant possible) ; 3 pour 3 (l'explication, moins lisible si elle manque).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { alive, type Need } from '@tirelire/core';
import { cliquer, ecran, ouvrirLApplication, presser, projet, rendu, rouvrirLApplication, saisir, t, tous } from './ecran';

/** Ouvre l'écran Tirelires, par le menu Plus. */
async function ouvrir(): Promise<void> {
  expect(await ecran('Tirelires'), 'l’écran Tirelires est introuvable').toBe(true);
  expect(t(document.querySelector('main h1'))).toBe('Tirelires');
}

/** Recharge l'application, puis rouvre l'écran Tirelires : ce qu'il montre vient de ce qui est enregistré. */
async function rouvrir(): Promise<void> {
  await rouvrirLApplication();
  await ouvrir();
}

const cartes = () => tous('main .card.tirelire').map((c) => (c.querySelector('input.nom') as HTMLInputElement).value);
const raccourcis = () => tous('main .prop .n').map((n) => t(n).replace(/^\+\s*/, ''));
const tireliresEnregistrees = () => alive(projet().tirelires);
const besoinsEnregistres = (tirelireId: string): Need[] => alive(projet().needs).filter((n) => n.tirelireId === tirelireId);

/** La première carte de tirelire de l'écran. */
const premiereCarte = () => document.querySelector('main .card.tirelire') as HTMLElement;

/** Corrige un champ de la première carte, comme au doigt : la valeur, puis `change`. */
async function corriger(selecteur: string, valeur: string): Promise<boolean> {
  const i = premiereCarte()?.querySelector(selecteur) as HTMLInputElement | null;
  if (!i) return false;
  i.value = valeur;
  i.dispatchEvent(new Event('change', { bubbles: true }));
  await rendu();
  return true;
}

/** Clique le bouton du pied de la première carte qui porte ce libellé (non celui d'une ligne de besoin). */
async function auPied(libelle: string): Promise<boolean> {
  const b = tous<HTMLButtonElement>(':scope > .actions button', premiereCarte()).find((x) => t(x).includes(libelle));
  if (b) await presser(b);
  return !!b;
}

describe('#421 · #369 — l’écran Tirelires emploie la section Tirelires, sur une base vide, sans navigateur', () => {
  /** La tirelire que le premier raccourci crée (le 4) : 5 à 8 portent sur elle. */
  let creee = '';

  beforeAll(async () => {
    await ouvrirLApplication();
  });

  it('[niveau 1] #369 point 3, I5, I10, D46 (table #421, ecran-tirelires 1) — sur une base vide, Tirelires ne montre aucune carte de tirelire, et le projet enregistré n’en porte aucune : rien n’est créé d’office', async () => {
    await ouvrir();
    expect(cartes(), 'rien n’est créé d’office').toEqual([]);
    expect(tireliresEnregistrees().map((x) => x.name), 'le projet enregistré porte une tirelire créée d’office').toEqual([]);
  });

  it('[niveau 1] #369 point 3, I5 (table #421, ecran-tirelires 2) — sur une base vide, l’écran porte au moins un raccourci, sous « Ajouter en un geste »', async () => {
    await ouvrir();
    expect(raccourcis().length, 'l’écran vide doit porter ce qui le remplirait').toBeGreaterThan(0);
    const titre = tous('main .eyebrow').find((e) => t(e) === 'Ajouter en un geste');
    expect(titre, 'pas de « Ajouter en un geste » à l’écran').toBeDefined();
    expect(titre!.nextElementSibling?.querySelector('.prop'), 'les raccourcis ne sont pas sous « Ajouter en un geste »').not.toBeNull();
  });

  it('[niveau 3] #369 point 4 (table #421, ecran-tirelires 3) — l’explication est repliée, sous le titre « Comment ça marche ? » ; un geste sur ce titre l’ouvre ; elle contient « Courses, essence », « C’est ici que les tirelires servent » et « Une épargne sans date »', async () => {
    await ouvrir();
    const d = document.querySelector('main details.explication') as HTMLDetailsElement | null;
    expect(d, 'pas de « Comment ça marche ? »').not.toBeNull();
    expect(t(d!.querySelector('summary'))).toBe('Comment ça marche ?');
    expect(d!.open, 'l’explication doit partir repliée').toBe(false);
    await presser(d!.querySelector('summary') as HTMLElement);
    expect(d!.open, 'un geste sur « Comment ça marche ? » doit ouvrir l’explication').toBe(true);
    for (const debut of ['Courses, essence', 'C’est ici que les tirelires servent', 'Une épargne sans date']) {
      expect(t(d).replace(/'/g, '’')).toContain(debut);
    }
  });

  it('[niveau 2] #369 point 3, D46 (table #421, ecran-tirelires 4) — le premier raccourci pressé, sa tirelire, au nom du raccourci, est à l’écran et dans le projet enregistré, l’écran rouvert la montre, et ce raccourci n’est plus offert', async () => {
    await ouvrir();
    const nom = raccourcis()[0]!;
    const b = document.querySelector('main .prop') as HTMLButtonElement | null;
    expect(b, 'pas de raccourci à presser').not.toBeNull();
    await presser(b!);
    expect(cartes()).toContain(nom);
    expect(raccourcis(), `le raccourci « ${nom} » doit disparaître`).not.toContain(nom);
    expect(tireliresEnregistrees().map((x) => x.name), 'le projet enregistré ne porte pas la tirelire du raccourci').toContain(nom);
    // Il est écrit dans le projet : l'écran rouvert la retrouve.
    await rouvrir();
    expect(cartes()).toContain(nom);
    expect(raccourcis(), `le raccourci « ${nom} » revient à la réouverture`).not.toContain(nom);
    creee = nom;
  });

  it('[niveau 1] #369 point 1, U1 (table #421, ecran-tirelires 5) — corrigés sur la carte, l’un après l’autre, le déjà de côté, le montant du besoin, le nom du besoin et celui de la tirelire s’écrivent dans le projet, et l’écran rouvert les montre', async () => {
    await ouvrir();
    expect(cartes()[0], 'la tirelire du raccourci n’est pas la première carte').toBe(creee);
    const tirelire = tireliresEnregistrees().find((x) => x.name === creee)!;
    const besoinNomme = !!premiereCarte().querySelector('.ligne input.besoin');
    // Une correction à la fois, comme au doigt : la carte se redessine entre deux champs.
    expect(await corriger('.deja input.mt', '45,00')).toBe(true);
    expect(tireliresEnregistrees().find((x) => x.id === tirelire.id)?.openingBalance, 'le déjà de côté corrigé ne s’écrit pas').toBe(4500);
    expect(await corriger('.ligne input.mt', '123,00')).toBe(true);
    expect(
      besoinsEnregistres(tirelire.id).some((n) => n.amount === 12300 || n.monthlyAmount === 12300),
      'le montant du besoin corrigé ne s’écrit pas',
    ).toBe(true);
    if (besoinNomme) {
      expect(await corriger('.ligne input.besoin', 'Besoin renommé')).toBe(true);
      expect(besoinsEnregistres(tirelire.id).map((n) => n.name), 'le nom du besoin corrigé ne s’écrit pas').toContain('Besoin renommé');
    }
    expect(await corriger('input.nom', 'Renommée en place')).toBe(true);
    expect(tireliresEnregistrees().find((x) => x.id === tirelire.id)?.name, 'le nom corrigé ne s’écrit pas').toBe('Renommée en place');

    await rouvrir();
    const c = tous('main .card.tirelire').find((x) => (x.querySelector('input.nom') as HTMLInputElement).value === 'Renommée en place');
    expect(c, `la tirelire « ${creee} » renommée sur la carte doit se retrouver`).toBeDefined();
    expect((c!.querySelector('.deja input.mt') as HTMLInputElement).value).toBe('45,00');
    expect((c!.querySelector('.ligne input.mt') as HTMLInputElement).value).toBe('123,00');
    if (besoinNomme) expect((c!.querySelector('.ligne input.besoin') as HTMLInputElement).value).toBe('Besoin renommé');
    creee = 'Renommée en place';
  });

  it('[niveau 2] #369 point 1 (table #421, ecran-tirelires 6) — « Besoin ajouté sur la carte », 12,00, ajouté par le formulaire d’ajout de la carte : la carte a une ligne de plus, l’écran rouvert aussi, et le projet enregistré porte ce besoin, avec son nom et son montant', async () => {
    await ouvrir();
    const lignes = () => premiereCarte().querySelectorAll('.ligne').length;
    const avant = lignes();
    const f = premiereCarte().querySelector('form.ajout-besoin') as HTMLFormElement | null;
    expect(f, 'la carte n’a pas de formulaire d’ajout d’un besoin').not.toBeNull();
    await saisir(f!.querySelector('input.besoin-nom') as HTMLInputElement, 'Besoin ajouté sur la carte');
    await saisir(f!.querySelector('input.mt') as HTMLInputElement, '12,00');
    await presser(f!.querySelector('button[type="submit"]') as HTMLButtonElement);
    expect(lignes()).toBe(avant + 1);
    const tirelire = tireliresEnregistrees().find((x) => x.name === creee)!;
    const ajoute = besoinsEnregistres(tirelire.id).find((n) => n.name === 'Besoin ajouté sur la carte');
    expect(ajoute, 'le projet enregistré ne porte pas le besoin ajouté').toBeDefined();
    expect(ajoute!.amount).toBe(1200);
    await rouvrir();
    expect(lignes()).toBe(avant + 1);
    expect(tous<HTMLInputElement>('.ligne input.besoin', premiereCarte()).some((i) => i.value === 'Besoin ajouté sur la carte')).toBe(true);
  });

  it('[niveau 2] #369 point 2, D51, D59 (table #421, ecran-tirelires 7) — la ligne du besoin dit « priorité N » et offre « Réviser » et « Modifier » ; la carte dit « voulu : » ; le panneau « Modifier » de la tirelire porte ses champs avancés, celui du besoin, la priorité et les dates de validité', async () => {
    await ouvrir();
    const ligne = premiereCarte().querySelector('.ligne .par-besoin') as HTMLElement | null;
    expect(ligne, 'la ligne du besoin ne dit rien de plus').not.toBeNull();
    expect(t(ligne)).toMatch(/priorité \d+/);
    expect(tous('button', ligne!).map(t)).toEqual(expect.arrayContaining(['Réviser', 'Modifier']));
    expect(t(premiereCarte())).toContain('voulu :');
    // Le panneau de la tirelire : placement en parts, solde initial et sa date, plafond du report.
    expect(await auPied('Modifier'), 'la carte n’a pas de « Modifier »').toBe(true);
    const panneau = t(document.querySelector('main form.edit'));
    for (const mot of ['Placement voulu', 'Solde initial', 'Date du solde initial', 'Excédent en fin de période']) expect(panneau).toContain(mot);
    expect(await cliquer('Annuler')).toBe(true);
    // Le panneau d'un besoin : priorité et dates de validité.
    const modifier = tous<HTMLButtonElement>('main .par-besoin button').find((x) => t(x) === 'Modifier');
    expect(modifier, 'la ligne du besoin n’a pas de « Modifier »').toBeDefined();
    await presser(modifier!);
    const besoin = t(document.querySelector('main form.edit')).replace(/'/g, '’');
    for (const mot of ['Priorité', 'En vigueur à partir du', 'En vigueur jusqu’au']) expect(besoin).toContain(mot);
    expect(await cliquer('Annuler')).toBe(true);
  });

  it('[niveau 2] #369 point 2, D59 (table #421, ecran-tirelires 8) — « Ajouter un besoin d’un autre type », sur la carte, ouvre un panneau dont le titre nomme la tirelire, et dont le choix du type offre au moins l’échéance, l’objectif et le versement', async () => {
    await ouvrir();
    expect(await auPied('autre type'), 'la carte n’offre pas « Ajouter un besoin d’un autre type »').toBe(true);
    const f = document.querySelector('main form.edit') as HTMLElement | null;
    expect(f, 'aucun panneau ne s’ouvre').not.toBeNull();
    expect(t(f!.querySelector('.titre-panneau'))).toContain(cartes()[0]!);
    const types = [...(f!.querySelector('select') as HTMLSelectElement).options].map((o) => o.value);
    expect(types).toEqual(expect.arrayContaining(['dueDate', 'goal', 'payout']));
    expect(await cliquer('Annuler')).toBe(true);
  });
});
