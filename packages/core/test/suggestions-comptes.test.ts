import { describe, expect, it } from 'vitest';
import { alive, budgetSuggestions, euros, exampleLedger } from '../src/index.js';

/**
 * Tests du codeur de #211 — « L'assistant propose les comptes de l'exemple » : la lecture des
 * comptes de l'exemple par `budgetSuggestions` (`src/suggestions.ts`), sans navigateur. Ce qui se voit
 * à l'écran — l'étape Comptes, les raccourcis, la validation — est dans
 * `apps/web/test/navigateur/assistant-comptes-exemple.test.ts`.
 *
 * Chaque test dit, dans son titre, le point du « Fait quand » qu'il vérifie.
 */
const exemple = exampleLedger();
const comptes = alive(exemple.accounts);
const principal = comptes.find((a) => a.kind === 'principal')!;
const autres = comptes.filter((a) => a.kind !== 'principal');
// La date compte pour le budget (D51), pas pour les comptes : elle est fixée comme dans `suggestions.test.ts`.
const s = budgetSuggestions('2026-09-06');

describe('[niveau 4] #211 · 1 — tous les comptes de l’exemple sont proposés, chacun avec son nom, son type et son solde', () => {
  it('« Livret A », « Carte enfants », « Compte de Marie » et « Livret jeune », dans l’ordre de l’exemple : le compte clos et les comptes tiers y sont', () => {
    expect(s.accounts.map((a) => a.name)).toEqual(['Livret A', 'Carte enfants', 'Compte de Marie', 'Livret jeune']);
  });

  it('chacun avec le type et le solde que l’exemple lui donne', () => {
    for (const p of s.accounts) {
      const dans = autres.find((a) => a.name === p.name)!;
      expect({ nom: p.name, kind: p.kind, balance: p.balance }).toEqual({ nom: dans.name, kind: dans.kind, balance: dans.openingBalance });
    }
    expect(s.accounts.find((a) => a.name === 'Livret A')).toMatchObject({ kind: 'epargne', balance: euros(4815) });
    expect(s.accounts.find((a) => a.name === 'Livret jeune')).toMatchObject({ kind: 'epargne', balance: 0 });
  });

  it('le compte principal n’est pas proposé comme un autre compte : l’assistant le renseigne, il ne le crée pas', () => {
    expect(s.accounts.some((a) => (a.kind as string) === 'principal')).toBe(false);
    expect(s.accounts.map((a) => a.name)).not.toContain(principal.name);
  });

  it('les comptes proposés ne dépendent pas de la date de lecture : l’exemple a plusieurs versions du budget, pas des comptes', () => {
    expect(budgetSuggestions('2026-11-15').accounts).toEqual(s.accounts);
    expect(budgetSuggestions('2027-01-15').mainAccount).toEqual(s.mainAccount);
  });
});

describe('[niveau 4] #211 · 2 — le compte principal arrive avec ce que l’exemple en dit : le nom « Compte courant » et le solde 2 340,00 €', () => {
  it('le nom et le solde du compte principal sont ceux de l’exemple', () => {
    expect(s.mainAccount).toEqual({ name: 'Compte courant', balance: euros(2340) });
    expect(s.mainAccount).toEqual({ name: principal.name, balance: principal.openingBalance });
  });
});

describe('[niveau 4] #211 · 3 — un compte tiers porte le suivi de son solde à régler, le compte clos sa clôture', () => {
  it('« Carte enfants » et « Compte de Marie » portent le seuil et le sens que l’exemple leur donne : 10,00 €, dans les deux sens', () => {
    for (const nom of ['Carte enfants', 'Compte de Marie']) {
      const p = s.accounts.find((a) => a.name === nom)!;
      const dans = autres.find((a) => a.name === nom)!;
      expect(p.settlement, nom).toEqual({ threshold: dans.settlementThreshold, direction: dans.settlementDirection });
      expect(p.settlement, nom).toEqual({ threshold: euros(10), direction: 'both' });
    }
  });

  it('un compte qui ne suit pas de solde à régler n’en porte pas : « Livret A » et « Livret jeune » ne sont pas tiers', () => {
    for (const nom of ['Livret A', 'Livret jeune']) expect(s.accounts.find((a) => a.name === nom)!.settlement, nom).toBeUndefined();
  });

  it('seul « Livret jeune », que l’exemple dit clos, est proposé clos', () => {
    expect(s.accounts.filter((a) => a.closed).map((a) => a.name)).toEqual(['Livret jeune']);
    for (const p of s.accounts) expect(p.closed === true, p.name).toBe(autres.find((a) => a.name === p.name)!.activeTo !== undefined);
  });

  it('la clôture n’est pas une date copiée de l’exemple : la proposition dit « clos », la date se calcule à l’assistant', () => {
    const clos = s.accounts.find((a) => a.name === 'Livret jeune')!;
    expect(JSON.stringify(clos)).not.toContain('2026-06-30');
    expect(Object.keys(clos).sort()).toEqual(['balance', 'closed', 'kind', 'name']);
  });
});

describe('[niveau 4] #211 · 5 — ces propositions viennent de l’exemple et de lui seul', () => {
  it('chaque compte proposé, et le compte principal renseigné, figurent dans l’exemple, par leur nom', () => {
    const connus = new Set(comptes.map((a) => a.name));
    for (const p of s.accounts) expect(connus, p.name).toContain(p.name);
    expect(connus).toContain(s.mainAccount.name);
  });

  it('l’exemple est proposé en entier, et rien de plus : autant de comptes proposés que d’autres comptes dans l’exemple', () => {
    expect(s.accounts).toHaveLength(autres.length);
    expect(new Set(s.accounts.map((a) => a.name)).size).toBe(autres.length);
  });

  it('une proposition ne porte que ce que l’exemple dit : son nom, son type, son solde, son suivi de règlement, sa clôture', () => {
    const permis = new Set(['name', 'kind', 'balance', 'settlement', 'closed']);
    // L'exemple ne dit ni banque ni numéro : l'assistant n'en invente pas.
    for (const p of s.accounts) for (const cle of Object.keys(p)) expect(permis, `${p.name} : ${cle}`).toContain(cle);
    expect(Object.keys(s.mainAccount).sort()).toEqual(['balance', 'name']);
  });
});
