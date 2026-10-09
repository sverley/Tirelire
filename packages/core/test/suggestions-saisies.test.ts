import { describe, expect, it } from 'vitest';
import { alive, entrySuggestions, exampleLedger } from '../src/index.js';

/**
 * Tests du codeur de #214 — « Les aides des champs viennent de l'exemple » : la lecture des
 * opérations saisies de l'exemple par `entrySuggestions` (`src/suggestions.ts`), de quoi donner aux
 * champs du formulaire de Saisie les valeurs d'une même ligne, sans navigateur. Ce qui se voit à
 * l'écran — les aides de chaque formulaire — est dans `apps/web/test/aides-exemple.test.ts` et
 * `apps/web/test/aides-exemple-ecran.test.ts`, sur l'application montée sans navigateur (#417).
 *
 * Chaque test dit, dans son titre, le point du « Fait quand » qu'il vérifie.
 */
const exemple = exampleLedger();
const saisies = alive(exemple.operations).filter((o) => o.origin === 'manual' && o.amount !== 0);
const lues = entrySuggestions();

describe('[niveau 4] #214 · 3 — la Saisie lit ses aides dans les opérations saisies de l’exemple, et dans elles seules', () => {
  it('une lecture par opération saisie de l’exemple qui a un montant, dans l’ordre de l’exemple, avec son libellé', () => {
    expect(saisies.length).toBeGreaterThan(0);
    expect(lues.map((l) => l.label)).toEqual(saisies.map((o) => o.label));
  });

  it('le montant lu est positif : le sens appartient à la nature de la saisie', () => {
    expect(lues.map((l) => l.amount)).toEqual(saisies.map((o) => Math.abs(o.amount)));
    for (const l of lues) expect(l.amount, l.label).toBeGreaterThan(0);
  });

  it('une opération à zéro, comme le lissage de la taxe foncière, et une opération dérivée ne sont pas lues : aucune saisie ne les porte', () => {
    const exclues = alive(exemple.operations).filter((o) => o.origin !== 'manual' || o.amount === 0);
    expect(exclues.length).toBeGreaterThan(0);
    for (const o of exclues) expect(lues.map((l) => l.label), o.label).not.toContain(o.label);
  });

  it('la nature est celle que Saisie donne : un virement vers un compte, sinon une dépense ou un revenu selon le signe', () => {
    for (const o of saisies) {
      const nature = lues.find((l) => l.label === o.label)!.nature;
      expect(nature, o.label).toBe(o.transferAccountId ? 'transfer' : o.amount < 0 ? 'expense' : 'income');
    }
    // Les trois natures sont portées par l'exemple : aucun formulaire de Saisie n'est laissé sans aide.
    expect(new Set(lues.map((l) => l.nature))).toEqual(new Set(['expense', 'income', 'transfer']));
  });

  it('la catégorie lue est celle de la seule part de l’opération, par son nom : « Dentiste (payé par Marie) » est en « Santé »', () => {
    expect(lues.find((l) => l.label === 'Dentiste (payé par Marie)')).toMatchObject({ amount: 8000, nature: 'expense', categoryName: 'Santé' });
    expect(lues.find((l) => l.label === 'VIR SALAIRE AOUT')).toMatchObject({ amount: 340000, nature: 'income', categoryName: 'Salaire' });
  });

  it('un virement porte sa catégorie « Virement interne » : « VIR PERM TIRELIRE CARTE ENFANTS » est lu comme un virement', () => {
    expect(lues.find((l) => l.label === 'VIR PERM TIRELIRE CARTE ENFANTS')).toMatchObject({ amount: 20000, nature: 'transfer', categoryName: 'Virement interne' });
  });

  it('la lecture ne change pas l’exemple : deux lectures donnent la même chose', () => {
    expect(entrySuggestions()).toEqual(lues);
  });
});
