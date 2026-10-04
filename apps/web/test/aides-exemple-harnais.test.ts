/**
 * Harnais d'audit de #214 — « Les aides des champs viennent de l'exemple », sans navigateur : ce que les tests
 * d'écran (`navigateur/aides-exemple-harnais.test.ts`) ne voient pas. Le point 1 à d'autres dates de lecture que le
 * jour des tests, quand un revenu, un budget ou un objectif change de version : l'aide est celle que le raccourci
 * apporterait à cette date, version en vigueur comprise. Et le point 5 côté code : aucun écran n'écrit en dur une
 * aide qui propose une valeur (D43 : « aucun écran ne l'écrit en dur »).
 *
 * Retenus parmi les tests du codeur (`aides-exemple.test.ts`, d'où ils sont déplacés) : les trois du point 1 qui lisent
 * une autre date, et ceux du point 5, dont le contrôle des textes est complété (il ne voyait que `placeholder="…"` :
 * il voit aussi `placeholder='…'` et une valeur écrite dans une expression, `placeholder={'…'}`, `placeholder={a ? '…' : b}`,
 * que le premier laissait passer). Les autres tests du codeur, qui lisent la ligne d'aide et la reconnaissance du
 * formulaire par les fonctions de `src/lib/aides.ts`, restent dans son fichier, au niveau 4 : les tests d'écran
 * les couvrent.
 *
 * Niveau (D83) : 2 pour tous. D43 est une décision : une aide qui ne suit pas la version en vigueur, ou une aide
 * écrite en dur qui divergera de l'exemple, en est un cas faux, l'usage restant possible.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { budgetSuggestions } from '@tirelire/core';
import { aideCourant, aideEpargne, aideFlux, montantAide, parNom } from '../src/lib/aides';

const source = (chemin: string) => readFileSync(resolve(process.cwd(), 'src', chemin), 'utf8');

/** Le jour des tests : le Salaire y est à 3 400,00, sa hausse ne vient qu'au 28 octobre. */
const JOUR = '2026-09-20';
const APRES_LA_HAUSSE = '2026-11-15';
const s = budgetSuggestions(JOUR);
const revenus = parNom(s.incomes);
const epargnes = s.tirelires.filter((t) => !t.needs.some((n) => n.kind === 'dueDate') && t.needs.some((n) => n.kind === 'goal'));
const courants = s.tirelires.filter((t) => !t.needs.some((n) => n.kind === 'dueDate' || n.kind === 'goal'));

describe('[niveau 2] #214 · 1 — à une autre date de lecture, l’aide est celle que le raccourci apporterait à cette date, version en vigueur comprise', () => {
  it('revenus : 3 400,00 € au jour des tests, 3 550,00 € après la hausse du 28 octobre ; le nom et le jour sont ceux de la même ligne', () => {
    const avant = aideFlux(revenus, revenus, JOUR)!;
    const apres = aideFlux(revenus, revenus, APRES_LA_HAUSSE)!;
    expect(montantAide(avant.amount)).toBe('3 400,00');
    expect(montantAide(apres.amount)).toBe('3 550,00');
    expect(apres).toMatchObject({ name: 'Salaire', interval: 1, unit: 'month', day: 28 });
  });

  it('budgets : « Alimentation » à 900,00 € au jour des tests, 950,00 € après le 28 octobre', () => {
    expect(aideCourant(courants, courants, JOUR)).toMatchObject({ name: 'Alimentation', amount: 90000 });
    expect(aideCourant(courants, courants, APRES_LA_HAUSSE)).toMatchObject({ name: 'Alimentation', amount: 95000 });
  });

  it('épargne : « Épargne de précaution » à 300,00 € par mois pour 6 000,00 €, puis le besoin suivant, 800,00 € pour 12 000,00 €, à partir du 28 décembre — la mensualité et la cible du même besoin', () => {
    expect(aideEpargne(epargnes, epargnes, JOUR)).toMatchObject({ name: 'Épargne de précaution', monthly: 30000, target: 600000 });
    expect(aideEpargne(epargnes, epargnes, '2026-12-28')).toMatchObject({ name: 'Épargne de précaution', monthly: 80000, target: 1200000 });
  });
});

/** Les écrans dont les aides viennent de l'exemple : les formulaires de l'assistant, de Comptes, de Tirelires, de Flux prévus, de Catégories et de Saisie. */
const ECRANS = ['views/Wizard.svelte', 'views/Accounts.svelte', 'views/Tirelires.svelte', 'views/Flows.svelte', 'views/Categories.svelte', 'views/Entries.svelte'];
/** Les textes indicatifs qui nomment le champ ou son formulaire sans proposer de valeur (point 4) : les seuls qu'un écran peut encore écrire en dur. */
const INDICATIFS = ['Nom du compte', 'Banque', 'FR76 …', 'cible'];

/** Les textes écrits en dur dans les attributs `placeholder` d'un source : entre guillemets, ou dans une expression `{…}`. */
function litteraux(code: string): string[] {
  const textes: string[] = [];
  for (const [, guillemets, apostrophes, expression] of code.matchAll(/placeholder\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g)) {
    if (guillemets !== undefined) textes.push(guillemets);
    else if (apostrophes !== undefined) textes.push(apostrophes);
    else for (const [, , t] of expression!.matchAll(/(['"`])((?:(?!\1).)*)\1/g)) textes.push(t!);
  }
  return textes;
}

describe('[niveau 2] #214 · 5 — une aide qui propose une valeur sans venir de l’exemple fait échouer le test', () => {
  it('aucun écran n’écrit en dur un texte d’aide qui propose une valeur : ses aides sont lues par `lib/aides`, sauf les textes indicatifs du point 4', () => {
    for (const ecran of ECRANS) {
      for (const l of litteraux(source(ecran))) expect(INDICATIFS, `${ecran} : « ${l} » propose une valeur écrite en dur`).toContain(l);
    }
  });

  it('le contrôle n’est pas vide : il voit les textes indicatifs du point 4, et refuserait « Dentiste » écrit en dur de chaque manière', () => {
    expect(litteraux(source('views/Wizard.svelte'))).toEqual(expect.arrayContaining(['Banque', 'FR76 …', 'Nom du compte', 'cible']));
    expect(INDICATIFS).not.toContain('Dentiste');
    expect(INDICATIFS).not.toContain('2 400,00');
    for (const ecrit of [
      '<input placeholder="Dentiste" />',
      "<input placeholder='Dentiste' />",
      "<input placeholder={'Dentiste'} />",
      "<input placeholder={aide ? 'Dentiste' : undefined} />",
      '<input placeholder = {`Dentiste`} />',
    ]) {
      expect(litteraux(ecrit), ecrit).toEqual(['Dentiste']);
    }
    expect(litteraux('<input placeholder={aides.label} /><input placeholder={a ? montantAide(a.amount) : undefined} />')).toEqual([]);
  });

  it('chaque formulaire qui propose des valeurs lit `lib/aides` : aucun écran n’en écrit les valeurs lui-même', () => {
    for (const ecran of ECRANS) expect(source(ecran), ecran).toMatch(/from '\.\.\/lib\/aides'/);
  });
});
