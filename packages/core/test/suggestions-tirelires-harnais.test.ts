/**
 * Harnais d'audit de #336 — « L'assistant propose toutes les tirelires de l'exemple, leurs besoins,
 * leur placement et l'ordre permanent », côté cœur : la lecture de l'exemple par `budgetSuggestions`,
 * et ce qu'en font `suggestedTirelire` et `suggestedOrder`, que l'assistant appelle tels quels.
 *
 * Retenus parmi les tests du codeur (`suggestions-tirelires.test.ts`, déplacé ici en entier). Ce qui
 * se voit dans l'assistant est dans `apps/web/test/navigateur/assistant-tirelires-exemple-harnais.test.ts` ;
 * le point 9 est tranché par `suggestions.test.ts`, que le codeur a étendu aux tirelires et aux ordres ;
 * le point 11 (D40, D51, D60) est de la documentation, vérifiée à la relecture.
 *
 * Niveaux (D83), par phrase du « Fait quand » :
 *  - 2 pour les points 1 à 6 et la fin du point 10 (« avec tout ce que l'exemple en dit ») : D43, D46,
 *    D51, D40, D38, D60 sont des décisions ; une proposition absente ou fausse en est un cas faux,
 *    l'usage restant possible.
 *  - 1 pour le point 7 au 6 septembre 2026 : l'ordre enregistré reste ce que la banque exécute, et le
 *    plan en signale l'écart « sans le réécrire » (I10, tel qu'il est écrit). Rouge sur une mutation
 *    du code de la PR : `suggestedOrder` qui perd l'origine `derived` de l'ordre.
 */
import { describe, expect, it } from 'vitest';
import {
  alive,
  budgetSuggestions,
  computePlan,
  defaultMainAccount,
  emptyLedger,
  euros,
  exampleLedger,
  suggestedOrder,
  suggestedTirelire,
  MAIN_ACCOUNT_ID,
  type Ledger,
} from '../src/index.js';

const exemple = exampleLedger();
const s = budgetSuggestions('2026-09-20');
const DEBUT = '2026-08-28';

/**
 * Le projet que laisse l'assistant validé tel quel, pour ce que #336 en propose : le compte
 * principal de toute base, les autres comptes de l'exemple, puis les tirelires et l'ordre, comme
 * l'assistant les écrit. `sans` retire des comptes, comme l'utilisateur à l'étape Comptes.
 */
function valideTelQuel(sans: string[] = []): Ledger {
  const l = emptyLedger({ periodStartDay: 28 });
  l.accounts.push(defaultMainAccount());
  for (const a of s.accounts.filter((x) => !sans.includes(x.name))) {
    l.accounts.push({ id: `acc-${a.name}`, name: a.name, kind: a.kind, openingBalance: a.balance, openingDate: DEBUT });
  }
  let n = 0;
  const compte = (nom: string) => l.accounts.find((a) => a.name === nom)?.id;
  for (const p of s.tirelires) {
    const t = suggestedTirelire(p, { id: `t-${p.name}`, newId: () => `id-${n++}`, openingDate: DEBUT, principalId: MAIN_ACCOUNT_ID, compte });
    l.tirelires.push(t.tirelire);
    l.needs.push(...t.needs);
    l.plannedFlows.push(...t.flows);
  }
  for (const o of s.orders) {
    const f = suggestedOrder(o, { id: `o-${o.name}`, principalId: MAIN_ACCOUNT_ID, compte });
    if (f) l.plannedFlows.push(f);
  }
  return l;
}

const nomDuCompte = (l: Ledger, id?: string) => {
  const a = l.accounts.find((x) => x.id === id);
  return a?.kind === 'principal' ? 'principal' : a?.name;
};
const nomDeLaTirelire = (l: Ledger, id?: string) => l.tirelires.find((t) => t.id === id)?.name;

describe('[niveau 2] #336 · 1 — toutes les tirelires et tous leurs besoins, et eux seuls, versions datées comprises', () => {
  it('neuf tirelires, dans l’ordre de l’exemple', () => {
    expect(s.tirelires.map((t) => t.name)).toEqual([
      'Taxe foncière',
      'Assurance auto',
      'Vacances',
      'Épargne de précaution',
      'Alimentation',
      'Essence',
      'Divers et sorties',
      'Enfants et loisirs',
      'Santé',
    ]);
  });

  it('treize besoins, chacun sous sa tirelire', () => {
    expect(Object.fromEntries(s.tirelires.map((t) => [t.name, t.needs.length]))).toEqual({
      'Taxe foncière': 1,
      'Assurance auto': 1,
      Vacances: 1,
      'Épargne de précaution': 2,
      Alimentation: 2,
      Essence: 1,
      'Divers et sorties': 2,
      'Enfants et loisirs': 2,
      Santé: 1,
    });
  });

  it('les mêmes propositions à toute date de lecture : rien ne se filtre plus sur la version en vigueur', () => {
    for (const date of ['2026-01-15', '2026-09-06', '2026-11-15', '2027-02-01']) expect(budgetSuggestions(date), date).toEqual(s);
  });
});

describe('[niveau 2] #336 · 2 — chaque besoin arrive avec ce que l’exemple en dit', () => {
  it('les versions datées, le second besoin nommé et la priorité', () => {
    const besoins = (nom: string) => s.tirelires.find((t) => t.name === nom)!.needs;
    expect(besoins('Alimentation').map((n) => [n.amount, n.activeFrom ?? null, n.activeTo ?? null])).toEqual([
      [euros(900), null, '2026-10-27'],
      [euros(950), '2026-10-28', null],
    ]);
    expect(besoins('Divers et sorties').map((n) => [n.amount, n.priority, n.activeFrom ?? null, n.activeTo ?? null])).toEqual([
      [euros(300), 40, null, '2026-08-27'],
      [euros(250), 40, '2026-08-28', null],
    ]);
    expect(besoins('Enfants et loisirs').map((n) => [n.name ?? null, n.amount, n.activeFrom ?? null])).toEqual([
      [null, euros(200), null],
      ['Cours de piano', euros(45), '2026-10-28'],
    ]);
    expect(besoins('Épargne de précaution').map((n) => [n.monthlyAmount, n.amount, n.activeFrom ?? null, n.activeTo ?? null])).toEqual([
      [euros(300), euros(6000), null, '2026-12-27'],
      [euros(800), euros(12000), '2026-12-28', null],
    ]);
    expect(besoins('Taxe foncière')).toEqual([
      { kind: 'dueDate', amount: euros(1200), periodicity: { interval: 12, unit: 'month', anchorDate: '2026-10-15' }, priority: 10 },
    ]);
  });
});

describe('[niveau 2] #336 · 3 — reliquat et déjà mis de côté', () => {
  it('le reliquat gardé ou non, et ce qui y est déjà mis de côté', () => {
    const lu = Object.fromEntries(s.tirelires.map((t) => [t.name, [t.rollover?.mode ?? 'unlimited', t.openingBalance]]));
    expect(lu).toEqual({
      'Taxe foncière': ['unlimited', euros(900)],
      'Assurance auto': ['unlimited', euros(300)],
      Vacances: ['unlimited', euros(400)],
      'Épargne de précaution': ['unlimited', euros(3200)],
      Alimentation: ['none', 0],
      Essence: ['none', 0],
      'Divers et sorties': ['none', 0],
      'Enfants et loisirs': ['unlimited', 0],
      Santé: ['none', 0],
    });
  });
});

describe('[niveau 2] #336 · 4 — le prélèvement attendu, et lui seul', () => {
  it('« Taxe foncière (prélèvement) » sous la taxe foncière, aucun ailleurs', () => {
    expect(Object.fromEntries(s.tirelires.map((t) => [t.name, t.payments.map((f) => f.name)]))).toMatchObject({
      'Taxe foncière': ['Taxe foncière (prélèvement)'],
      'Assurance auto': [],
      Vacances: [],
    });
    expect(s.tirelires.flatMap((t) => t.payments)).toHaveLength(1);
    const l = valideTelQuel();
    const f = alive(l.plannedFlows).find((x) => x.name === 'Taxe foncière (prélèvement)')!;
    const dans = alive(exemple.plannedFlows).find((x) => x.id === 'flow-tf')!;
    expect({ ...f, id: dans.id, accountId: dans.accountId, action: dans.action }).toEqual(dans);
    expect([nomDuCompte(l, f.accountId), nomDeLaTirelire(l, f.action?.tirelireId)]).toEqual(['principal', 'Taxe foncière']);
  });
});

describe('[niveau 2] #336 · 5 — chaque tirelire arrive placée comme dans l’exemple, et sans placement sur un compte retiré', () => {
  it('les réserves sur Livret A, Enfants et loisirs sur Carte enfants, les autres budgets sur le compte principal', () => {
    const l = valideTelQuel();
    expect(Object.fromEntries(l.tirelires.map((t) => [t.name, t.placement.map((p) => nomDuCompte(l, p.accountId))]))).toEqual({
      'Taxe foncière': ['Livret A'],
      'Assurance auto': ['Livret A'],
      Vacances: ['Livret A'],
      'Épargne de précaution': ['Livret A'],
      Alimentation: ['principal'],
      Essence: ['principal'],
      'Divers et sorties': ['principal'],
      'Enfants et loisirs': ['Carte enfants'],
      Santé: ['principal'],
    });
  });

  it('Livret A retiré : les réserves arrivent sans placement', () => {
    const l = valideTelQuel(['Livret A']);
    expect(l.tirelires.filter((t) => t.placement.length === 0).map((t) => t.name)).toEqual([
      'Taxe foncière',
      'Assurance auto',
      'Vacances',
      'Épargne de précaution',
    ]);
  });
});

describe('[niveau 2] #336 · 6 — l’ordre permanent de l’exemple, et aucun si Livret A est retiré', () => {
  it('« Virement Livret A », 600 € le 28, tous les mois, de Compte courant vers Livret A, avec sa fenêtre, sa tolérance et son libellé', () => {
    const l = valideTelQuel();
    const f = alive(l.plannedFlows).find((x) => x.kind === 'transfer')!;
    const dans = alive(exemple.plannedFlows).find((x) => x.id === 'flow-vir-livret')!;
    expect({ ...f, id: dans.id, accountId: dans.accountId, counterpartAccountId: dans.counterpartAccountId }).toEqual(dans);
    expect([nomDuCompte(l, f.accountId), nomDuCompte(l, f.counterpartAccountId)]).toEqual(['principal', 'Livret A']);
  });

  it('Livret A retiré : aucun ordre', () => {
    expect(alive(valideTelQuel(['Livret A']).plannedFlows).filter((x) => x.kind === 'transfer')).toEqual([]);
  });
});

describe('#336 · 7 et 10 — validé tel quel, le plan montre l’ordre et son écart, sans le réécrire', () => {
  it('[niveau 1] 600 € contre 650 € au 6 septembre 2026, et le montant enregistré reste 600 €', () => {
    const l = valideTelQuel();
    const plan = computePlan(l, '2026-09-06');
    const livret = plan.transfers.find((t) => t.accountName === 'Livret A')!;
    expect([livret.permanent, livret.bankOrder?.amount, livret.bankOrder?.drift]).toEqual([euros(650), euros(600), euros(50)]);
    expect(plan.warnings.some((w) => w.code === 'bankOrderDrift')).toBe(true);
    expect(alive(l.plannedFlows).find((x) => x.kind === 'transfer')!.amount).toBe(-euros(600));
  });

  it('[niveau 2] le projet porte les neuf tirelires, leurs treize besoins, le prélèvement et l’ordre, comme l’exemple (identités et ouverture mises à part)', () => {
    const l = valideTelQuel();
    const cle = (x: Ledger) => ({
      tirelires: alive(x.tirelires).map(({ id: _i, openingDate: _d, placement, ...t }) => ({ ...t, placement: placement.map((p) => [nomDuCompte(x, p.accountId), p.share]) })),
      besoins: alive(x.needs).map(({ id: _i, tirelireId, ...n }) => ({ ...n, tirelire: nomDeLaTirelire(x, tirelireId) })),
      flux: alive(x.plannedFlows)
        .filter((f) => f.kind === 'dueDate' || f.kind === 'transfer')
        .map(({ id: _i, accountId, counterpartAccountId, action, ...f }) => ({
          ...f,
          compte: nomDuCompte(x, accountId),
          vers: nomDuCompte(x, counterpartAccountId) ?? null,
          tirelire: nomDeLaTirelire(x, action?.tirelireId) ?? null,
        })),
    });
    // Une empreinte par objet, aux clés triées : l'ordre où un champ s'écrit ne dit rien de lui.
    const canon = (x: unknown): unknown =>
      Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canon(v)])) : x;
    const trie = <T>(xs: T[]) => xs.map((x) => JSON.stringify(canon(x))).sort();
    const a = cle(l);
    const b = cle(exemple);
    expect(trie(a.tirelires)).toEqual(trie(b.tirelires));
    expect(trie(a.besoins)).toEqual(trie(b.besoins));
    expect(trie(a.flux)).toEqual(trie(b.flux));
  });
});
