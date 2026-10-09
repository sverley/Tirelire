// @vitest-environment jsdom
/**
 * Harnais d'audit de #417, composé parmi les tests du codeur :
 * ce que vérifiait `navigateur/assistant-tirelires-exemple-harnais.test.ts` (harnais d'audit
 * de #336, « L'assistant propose toutes les tirelires de l'exemple, leurs besoins, leur placement et l'ordre
 * permanent »), sans navigateur : l'application montée sous jsdom (`ecran.ts`), au jour des tests (20 septembre 2026),
 * sur un dépôt en mémoire. Chaque titre dit le point du « Fait quand » de #336 qu'il vérifie, et le numéro du test
 * retiré dans la table de #417.
 *
 * Ce qui se lit ici est ce que les étapes Budgets, Pas tous les mois, Épargne et le Résumé montrent, et ce que la
 * validation enregistre — le projet que le dépôt relit, et les écrans Plan, Tirelires et Flux prévus qui le montrent.
 * Les données elles-mêmes — tirelires, versions, placements, ordre — sont lues côté cœur par
 * `packages/core/test/suggestions-tirelires-harnais.test.ts` (« #336 · 1 » à « #336 · 7 et 10 »). Les tirelires
 * retrouvées dans Tirelires (I11) sont tenues par `navigateur/assistant-equivalent.test.ts`, harnais du registre.
 *
 * Niveaux (D83) : ceux des tests retirés, que la table de #417 recopie. 1 pour les points 7 et 10 (tirelires 5 et 8,
 * I10, I11). Rouges sur deux mutations : l'ordre de l'exemple n'est plus posé (5) ; le × de l'ordre est sans effet
 * (8). 2 pour les autres : D43, D46, D51, D40, D38 et D60 sont des décisions.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { alive, euros, MAIN_ACCOUNT_ID, standingOrderTarget } from '@tirelire/core';
import { allerA, arriverAuxComptes, cliquer, ecran, etape, ouvrirLApplication, presser, projet, saisir, t, tous } from './ecran';

/** Le texte de l'écran, les noms des champs compris (la carte de l'assistant et de Tirelires, #369, les écrit dans des champs). */
const texteAvecLesChamps = () => {
  const m = document.querySelector('main')!.cloneNode(true) as HTMLElement;
  for (const i of tous<HTMLInputElement>('input.nom, input.besoin', m)) i.replaceWith(document.createTextNode(` ${i.value} `));
  return t(m);
};

interface Carte {
  nom: string;
  deja: string;
  garder: boolean | null;
  besoins: Array<{ nom: string; montants: string[]; suite: string }>;
  prelevement: string;
}

/** Ce qu'une étape montre de ses tirelires : une carte par tirelire, ses besoins dessous. */
const cartes = (): Carte[] =>
  tous('main .card.tirelire').map((c) => {
    const tete = c.querySelector('.ligne-tirelire')!;
    const garde = tete.querySelector('.garde input') as HTMLInputElement | null;
    return {
      nom: (tete.querySelector('input.nom') as HTMLInputElement).value,
      deja: (tete.querySelector('.deja input') as HTMLInputElement).value,
      garder: garde ? garde.checked : null,
      besoins: tous('.ligne', c).map((l) => ({
        nom: (l.querySelector('input.besoin') as HTMLInputElement | null)?.value ?? '',
        montants: tous<HTMLInputElement>('input', l).filter((i) => !i.classList.contains('besoin')).map((i) => i.value),
        suite: tous('.suite', l).map(t).join(' / '),
      })),
      prelevement: t(c.querySelector('.prelevement')),
    };
  });

const raccourcis = () => tous('main .propositions .prop .n').map((n) => t(n).replace(/^\+\s*/, ''));

/** Le placement que le résumé montre pour chaque tirelire : le compte choisi, par son nom. */
const placements = () =>
  Object.fromEntries(
    tous<HTMLSelectElement>('main select')
      .filter((s) => [...s.options].some((o) => t(o) === 'Peu importe'))
      .map((s) => [t(s.closest('.card')?.querySelector('.label strong')), t(s.selectedOptions[0])]),
  );

/** Les ordres que le résumé propose : nom, montant saisi, ce qu'il en dit. */
const ordres = () =>
  tous('main .card.ordre').map((c) => ({ nom: t(c.querySelector('strong')), montant: (c.querySelector('input.mt') as HTMLInputElement).value, texte: t(c) }));

async function retirer(selecteur: string, nom: string) {
  const c = tous<HTMLInputElement>(selecteur).find((i) => i.value.trim() === nom);
  const b = c?.parentElement?.querySelector('button.danger') as HTMLButtonElement | null | undefined;
  expect(b, `« ${nom} » : pas de bouton pour le retirer`).toBeTruthy();
  await presser(b!);
}

/** La carte du Plan d'un compte d'accueil : ses lignes, libellé et montant. */
const carteDuPlan = (compte: string) => {
  const c = tous('main .card').find((x) => t(x.querySelector(':scope > .row .label strong')) === compte);
  if (!c) return null;
  return tous(':scope > .row', c).map((r) => [t(r.querySelector('.label')), t(r.querySelector(':scope > .num, :scope > div:last-child'))] as const);
};

/** Les ordres permanents que le projet enregistré porte : nom, compte d'accueil, montant exécuté. */
const ordresDuProjet = () => {
  const p = projet();
  return alive(p.plannedFlows)
    .map((f) => ({ f, cible: standingOrderTarget(f, MAIN_ACCOUNT_ID) }))
    .filter((x) => x.cible)
    .map(({ f, cible }) => ({ nom: f.name, vers: alive(p.accounts).find((a) => a.id === cible)?.name, montant: Math.abs(f.amount) }));
};

/** Le placement enregistré d'une tirelire du projet : les noms des comptes de ses parts. */
const placementDuProjet = (nom: string) => {
  const p = projet();
  const e = alive(p.tirelires).find((x) => x.name === nom)!;
  return e.placement.map((x) => alive(p.accounts).find((a) => a.id === x.accountId)?.name);
};

describe('#417 · #336 — un projet vierge parcouru sans rien changer, sans navigateur', () => {
  beforeAll(async () => {
    await ouvrirLApplication();
    await arriverAuxComptes();
  });

  it('[niveau 2] #336 points 1, 2, 3 (table #417, tirelires 1) — Budgets montre les cinq tirelires de son genre, la date de chaque ligne bornée, le piano sous sa tirelire, et aucune priorité', async () => {
    expect(await etape('Budgets')).toBe(true);
    const vu = cartes();
    expect(vu.map((c) => [c.nom, c.garder, c.deja])).toEqual([
      ['Alimentation', false, '0,00'],
      ['Essence', false, '0,00'],
      ['Divers et sorties', false, '0,00'],
      ['Enfants et loisirs', true, '0,00'],
      ['Santé', false, '0,00'],
    ]);
    const alimentation = vu.find((c) => c.nom === 'Alimentation')!.besoins;
    expect(alimentation.map((b) => b.montants[0])).toEqual(['900,00', '950,00']);
    expect(alimentation[0]!.suite).toMatch(/jusqu’au 27 oct\S* 2026/);
    expect(alimentation[1]!.suite).toMatch(/à partir du 28 oct\S* 2026/);
    const divers = vu.find((c) => c.nom === 'Divers et sorties')!.besoins;
    expect(divers.map((b) => b.montants[0])).toEqual(['300,00', '250,00']);
    expect(divers[0]!.suite).toMatch(/clos/);
    expect(vu.find((c) => c.nom === 'Enfants et loisirs')!.besoins.map((b) => [b.nom, b.montants[0]])).toEqual([
      ['', '200,00'],
      ['Cours de piano', '45,00'],
    ]);
    expect(/priorit/i.test(t(document.querySelector('main')))).toBe(false);
    expect(raccourcis()).toEqual([]);
  });

  it('[niveau 2] #336 points 1, 3, 4 (table #417, tirelires 2) — Pas tous les mois montre trois échéances, leur déjà de côté, et dit le prélèvement attendu de la seule taxe foncière', async () => {
    expect(await etape('Pas tous les mois')).toBe(true);
    const vu = cartes();
    expect(vu.map((c) => [c.nom, c.deja, c.besoins.map((b) => b.montants)])).toEqual([
      ['Taxe foncière', '900,00', [['1200,00', '2026-10-15']]],
      ['Assurance auto', '300,00', [['600,00', '2027-03-05']]],
      ['Vacances', '400,00', [['2400,00', '2027-07-01']]],
    ]);
    const prelevement = Object.fromEntries(vu.map((c) => [c.nom, c.prelevement]));
    expect(prelevement['Taxe foncière']).toMatch(/Prélèvement attendu : « Taxe foncière \(prélèvement\) », 1 200,00 € sur Compte courant/);
    expect(prelevement['Assurance auto']).toBe('Aucun prélèvement attendu');
    expect(prelevement['Vacances']).toBe('Aucun prélèvement attendu');
  });

  it('[niveau 2] #336 points 1, 2, 3 (table #417, tirelires 3) — Épargne montre l’épargne de précaution, ses deux versions et ses 3 200 € déjà de côté', async () => {
    expect(await etape('Épargne')).toBe(true);
    expect(cartes().map((c) => [c.nom, c.deja, c.besoins.map((b) => b.montants)])).toEqual([
      ['Épargne de précaution', '3200,00', [['300,00', '6000,00'], ['800,00', '12000,00']]],
    ]);
  });

  it('[niveau 2] #336 points 5, 6 (table #417, tirelires 4) — le Résumé montre chaque tirelire placée comme dans l’exemple, et, à côté de l’ordre vers Livret A, ce que le budget demande (650,00 €)', async () => {
    expect(await etape('Résumé')).toBe(true);
    expect(placements()).toEqual({
      'Taxe foncière': 'Livret A',
      'Assurance auto': 'Livret A',
      Vacances: 'Livret A',
      'Épargne de précaution': 'Livret A',
      Alimentation: 'Compte courant',
      Essence: 'Compte courant',
      'Divers et sorties': 'Compte courant',
      'Enfants et loisirs': 'Carte enfants',
      Santé: 'Compte courant',
    });
    const o = ordres();
    expect(o.map((x) => [x.nom, x.montant])).toEqual([['Virement Livret A', '600,00']]);
    expect(o[0]!.texte).toMatch(/Le 28 de chaque mois, de Compte courant vers Livret A/);
    expect(o[0]!.texte).toMatch(/TIRELIRE LIVRET A/);
    expect(o[0]!.texte).toMatch(/budget demande 650,00 € par mois pour Livret A/);
  });

  it('[niveau 1] #336 points 7, 10, I10, I11 (table #417, tirelires 5) — validé tel quel : le prélèvement et l’ordre s’enregistrent et se retrouvent dans Flux prévus, où ils se modifient, l’ordre avec « Voir dans le Plan » ; l’ordre se corrige depuis le Plan ; « Cours de piano » est un besoin d’« Enfants et loisirs » dans Tirelires', async () => {
    expect(await cliquer('Valider mon budget')).toBe(true);

    // Ce que la validation enregistre : l'ordre à 600 €, ce que la banque exécute (D60), et le prélèvement de la taxe foncière.
    expect(ordresDuProjet()).toEqual([{ nom: 'Virement Livret A', vers: 'Livret A', montant: euros(600) }]);
    const p = projet();
    const prelevement = alive(p.plannedFlows).find((f) => f.name === 'Taxe foncière (prélèvement)');
    expect(prelevement?.kind).toBe('dueDate');
    expect(prelevement && Math.abs(prelevement.amount)).toBe(euros(1200));
    const enfants = alive(p.tirelires).find((e) => e.name === 'Enfants et loisirs')!;
    expect(alive(p.needs).filter((n) => n.tirelireId === enfants.id).map((n) => n.name ?? '')).toContain('Cours de piano');
    expect(alive(p.tirelires).some((e) => e.name === 'Cours de piano'), 'le piano n’est pas une tirelire à part (D28)').toBe(false);

    // L'ordre se corrige hors de l'assistant, depuis le Plan (I11, D60).
    await allerA('Plan');
    const livret = tous('main .card').find((c) => t(c.querySelector(':scope > .row .label strong')) === 'Livret A');
    expect(tous('button', livret ?? document.createElement('div')).some((b) => t(b) === 'Corriger mon ordre'), 'pas de « Corriger mon ordre » sur la carte Livret A du Plan').toBe(true);

    expect(await ecran('Tirelires')).toBe(true);
    const texte = texteAvecLesChamps();
    expect(texte).toMatch(/Enfants et loisirs Déjà de côté[^]*?voulu : [^]*?Cours de piano[^]*?Ajouter un besoin d'un autre type Modifier/);
    expect(texte).not.toMatch(/Cours de piano Déjà de côté/);

    expect(await ecran('Flux prévus')).toBe(true);
    const flux = tous('main .row')
      .filter((r) => r.querySelector('.label strong'))
      .map((r) => [t(r.querySelector('.label strong')), tous('button', r).map(t).filter((b) => b !== 'Supprimer').join(' / ')] as const);
    expect(flux.filter(([n]) => n === 'Taxe foncière (prélèvement)')).toEqual([['Taxe foncière (prélèvement)', 'Modifier']]);
    expect(flux.filter(([n]) => n === 'Virement Livret A')).toEqual([['Virement Livret A', 'Voir dans le Plan / Modifier']]);
  });
});

describe('#417 · #336 — corrigé sur place, sans navigateur', () => {
  it('[niveau 2] #336 points 3, 5, 6 (table #417, tirelires 6) — chaque correction s’enregistre à la validation : 500 € de côté pour Vacances, Santé sur Livret A, l’ordre à 620 €', async () => {
    await ouvrirLApplication();
    await arriverAuxComptes();
    await etape('Budgets');
    await etape('Pas tous les mois');
    const vacances = tous('main .card.tirelire').find((x) => (x.querySelector('.ligne-tirelire input.nom') as HTMLInputElement | null)?.value === 'Vacances');
    const deja = vacances?.querySelector('.deja input') as HTMLInputElement | null | undefined;
    expect(deja, 'pas de « Déjà de côté » pour Vacances').toBeTruthy();
    await saisir(deja!, '500,00');
    await etape('Épargne');
    await etape('Résumé');
    const sante = tous('main .card').find((c) => t(c.querySelector('.label strong')) === 'Santé');
    const sel = sante?.querySelector('select') as HTMLSelectElement | null | undefined;
    const livretA = sel && [...sel.options].find((x) => t(x) === 'Livret A');
    expect(livretA, 'pas de placement « Livret A » à choisir pour Santé').toBeTruthy();
    await saisir(sel!, livretA!.value);
    await saisir(document.querySelector('main .card.ordre input.mt') as HTMLInputElement, '620,00');
    expect(placements()['Santé']).toBe('Livret A');
    expect(ordres().map((x) => x.montant)).toEqual(['620,00']);

    expect(await cliquer('Valider mon budget')).toBe(true);
    const p = projet();
    const vac = alive(p.tirelires).find((e) => e.name === 'Vacances')!;
    expect(vac.openingBalance).toBe(euros(500));
    expect(placementDuProjet('Santé')).toEqual(['Livret A']);
    expect(ordresDuProjet()).toEqual([{ nom: 'Virement Livret A', vers: 'Livret A', montant: euros(620) }]);

    await allerA('Plan');
    expect(carteDuPlan('Livret A')?.find(([l]) => l.startsWith('Ordre permanent chez la banque'))?.[1]).toBe('620,00 €');
    expect(await ecran('Tirelires')).toBe(true);
    const texte = texteAvecLesChamps();
    expect(texte).toMatch(/Vacances Déjà de côté[^]*?voulu : le reste sur Livret A réel : 500,00 € sur Livret A/);
    expect(texte).toMatch(/Santé Déjà de côté[^]*?voulu : le reste sur Livret A/);
  });
});

describe('#417 · #336 — ordre retiré, puis réouverture sur le projet existant, sans navigateur', () => {
  beforeAll(async () => {
    await ouvrirLApplication();
    await arriverAuxComptes();
    await etape('Budgets');
    await retirer('main .card.tirelire input.nom', 'Santé');
    await etape('Résumé');
    const b = document.querySelector('main .card.ordre button.danger') as HTMLButtonElement | null;
    expect(b, 'pas de bouton pour retirer l’ordre').toBeTruthy();
    await presser(b!);
    expect(await cliquer('Valider mon budget')).toBe(true);
  });

  it('[niveau 1] #336 point 7, I10 (table #417, tirelires 8) — retiré, aucun ordre n’est enregistré, et le Plan n’en montre aucun', async () => {
    expect(ordresDuProjet()).toEqual([]);
    await allerA('Plan');
    expect(carteDuPlan('Livret A')?.some(([l]) => l.startsWith('Ordre permanent chez la banque')) ?? false).toBe(false);
  });

  it('[niveau 2] #336 point 8 (table #417, tirelires 9) — rouvert, un raccourci apporte « Santé » avec son placement, et celui de l’ordre l’apporte tant qu’aucun flux ne porte son nom', async () => {
    await allerA('Plus');
    expect(await cliquer('Lancer'), 'pas de bouton « Lancer » pour ouvrir l’assistant').toBe(true);
    await etape('Budgets');
    expect(raccourcis()).toEqual(['Santé']);
    expect(await cliquer('+ Santé')).toBe(true);
    expect(raccourcis()).toEqual([]);
    const sante = cartes().find((c) => c.nom === 'Santé')!;
    expect([sante.garder, sante.besoins.map((b) => b.montants[0])]).toEqual([false, ['100,00']]);

    await etape('Résumé');
    expect(placements()['Santé']).toBe('Compte courant');
    expect(ordres()).toEqual([]);
    expect(raccourcis()).toEqual(['Virement Livret A']);
    expect(await cliquer('+ Virement Livret A')).toBe(true);
    expect(ordres().map((x) => [x.nom, x.montant])).toEqual([['Virement Livret A', '600,00']]);
    expect(raccourcis()).toEqual([]);
  });
});
