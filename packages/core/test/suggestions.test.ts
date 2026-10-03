import { describe, expect, it } from 'vitest';
import { activeAt, alive, budgetSuggestions, exampleLedger, euros } from '../src/index.js';

/**
 * Les propositions de l'assistant (D43) n'ont pas de contenu propre : elles sont une lecture du jeu
 * d'exemple. Ce test fige cet engagement — si quelqu'un ajoute une proposition écrite en dur, il
 * échoue, et c'est bien le but : c'est l'exemple qu'il faut étoffer.
 */
describe("[niveau 2] propositions de l'assistant (D43)", () => {
  // Date explicite : l'exemple porte plusieurs versions d'un même budget (D51) et les propositions
  // suivent celle qui est en vigueur. Sans date figée, ce test changerait de résultat tout seul.
  const asOf = '2026-09-06';
  const l = exampleLedger();
  const s = budgetSuggestions(asOf);

  it("ne propose rien qui ne vienne de l'exemple, et propose tous ses revenus et toutes ses charges fixes", () => {
    const connus = new Set([
      ...alive(l.plannedFlows).map((f) => f.name),
      ...alive(l.tirelires).map((t) => t.name),
      ...alive(l.accounts).map((a) => a.name),
    ]);
    const proposes = [
      ...s.incomes.map((x) => x.name),
      ...s.charges.map((x) => x.name),
      ...s.tirelires.map((x) => x.name),
      ...s.tirelires.flatMap((x) => x.payments.map((f) => f.name)),
      ...s.orders.map((x) => x.name),
      // Les comptes : le compte principal renseigné et les autres comptes proposés (#211).
      s.mainAccount.name,
      ...s.accounts.map((x) => x.name),
    ];
    expect(proposes.length).toBeGreaterThan(0);
    for (const nom of proposes) expect(connus).toContain(nom);

    // L'autre sens (#213) : un flux de revenu ou de charge fixe de l'exemple qui ne serait pas proposé
    // fait échouer ce test, version datée comprise — une proposition par flux, ni plus ni moins.
    const cle = (nom: string, montant: number, de?: string, a?: string) => `${nom}|${montant}|${de ?? ''}|${a ?? ''}`;
    const flux = alive(l.plannedFlows).filter((f) => f.kind === 'income' || f.kind === 'fixedCharge');
    expect([...s.incomes, ...s.charges].map((x) => cle(x.name, x.amount, x.activeFrom, x.activeTo)).sort()).toEqual(
      flux.map((f) => cle(f.name, Math.abs(f.amount), f.activeFrom, f.activeTo)).sort(),
    );
  });

  it("propose toutes les tirelires de l'exemple, tous leurs besoins, leurs prélèvements attendus et son ordre permanent, et eux seuls (#336)", () => {
    // Une empreinte par objet, faite de ce que l'exemple en dit : une proposition qui n'y serait pas,
    // ou un objet de l'exemple qui ne serait pas proposé, fait échouer ce test dans les deux sens.
    const nomDe = (id?: string) => {
      const a = alive(l.accounts).find((x) => x.id === id);
      return a?.kind === 'principal' ? undefined : a?.name;
    };
    const tirelire = (nom: string, reliquat: unknown, deCote: number, placement: unknown) => JSON.stringify([nom, reliquat ?? null, deCote, placement]);
    expect(s.tirelires.map((t) => tirelire(t.name, t.rollover, t.openingBalance, t.placement.map((p) => [p.accountName ?? null, p.share]))).sort()).toEqual(
      alive(l.tirelires).map((t) => tirelire(t.name, t.rollover, t.openingBalance, t.placement.map((p) => [nomDe(p.accountId) ?? null, p.share]))).sort(),
    );

    const besoin = (tirelireNom: string, n: { kind: string; name?: string; amount?: number; monthlyAmount?: number; periodicity?: unknown; priority: number; activeFrom?: string; activeTo?: string }) =>
      JSON.stringify([tirelireNom, n.kind, n.name ?? null, n.amount ?? null, n.monthlyAmount ?? null, n.periodicity ?? null, n.priority, n.activeFrom ?? null, n.activeTo ?? null]);
    const tirelireDe = (id: string) => alive(l.tirelires).find((t) => t.id === id)!.name;
    expect(s.tirelires.flatMap((t) => t.needs.map((n) => besoin(t.name, n))).sort()).toEqual(
      alive(l.needs).map((n) => besoin(tirelireDe(n.tirelireId), n)).sort(),
    );
    expect(alive(l.needs).length).toBe(13);

    const fluxCle = (f: { name: string; amount: number; accountName?: string | undefined; anchorDate: string; interval: number; unit: string; dateWindowDays: number; labelPattern?: string | undefined; amountTolerance?: unknown }, autre: unknown) =>
      JSON.stringify([f.name, Math.abs(f.amount), f.accountName ?? null, f.anchorDate, f.interval, f.unit, f.dateWindowDays, f.labelPattern ?? null, f.amountTolerance ?? null, autre]);
    const versFlux = (f: (typeof l.plannedFlows)[number]) => ({
      name: f.name, amount: f.amount, accountName: nomDe(f.accountId), anchorDate: f.periodicity.anchorDate, interval: f.periodicity.interval,
      unit: f.periodicity.unit, dateWindowDays: f.dateWindowDays, labelPattern: f.labelPattern, amountTolerance: f.amountTolerance,
    });
    // Les prélèvements attendus : chacun sous sa tirelire, ni plus ni moins que les flux d'échéance de l'exemple.
    expect(s.tirelires.flatMap((t) => t.payments.map((f) => fluxCle(f, t.name))).sort()).toEqual(
      alive(l.plannedFlows).filter((f) => f.kind === 'dueDate').map((f) => fluxCle(versFlux(f), tirelireDe(f.tirelireId!))).sort(),
    );
    // Les ordres : les virements dérivés de l'exemple, avec leur compte d'arrivée.
    expect(s.orders.map((o) => fluxCle(o, [o.toAccountName, o.origin ?? null])).sort()).toEqual(
      alive(l.plannedFlows)
        .filter((f) => f.kind === 'transfer' && f.origin === 'derived')
        .map((f) => fluxCle(versFlux(f), [nomDe(f.counterpartAccountId), f.origin])).sort(),
    );
  });

  it("couvre les cinq questions du parcours à partir de l'exemple seul", () => {
    const genres = new Set(s.tirelires.flatMap((t) => t.needs.map((n) => n.kind)));
    expect(s.incomes.length).toBeGreaterThan(0);
    expect(s.charges.length).toBeGreaterThan(0);
    expect([...genres].sort()).toEqual(['dueDate', 'goal', 'recurring']);
  });

  it('propose toutes les versions des besoins comme des flux, chacune avec ses dates, à toute date (D51)', () => {
    const alimentation = s.tirelires.find((t) => t.name === 'Alimentation')!;
    expect(alimentation.needs.map((n) => [n.amount, n.activeFrom, n.activeTo])).toEqual([
      [euros(900), undefined, '2026-10-27'],
      [euros(950), '2026-10-28', undefined],
    ]);
    // Le salaire change à la paie de novembre : les deux versions sont proposées, chacune avec sa date.
    expect(s.incomes.filter((x) => x.name === 'Salaire').map((x) => [x.amount, x.activeFrom, x.activeTo])).toEqual([
      [euros(3400), undefined, '2026-10-27'],
      [euros(3550), '2026-10-28', undefined],
    ]);
    // Rien ne suit la date de lecture : en novembre comme en janvier, les mêmes propositions.
    expect(budgetSuggestions('2026-11-15')).toEqual(s);
    expect(budgetSuggestions('2027-01-15').charges.some((x) => x.name === 'Crédit immobilier')).toBe(true);
  });

  it('reprend les montants et les rythmes tels que l’exemple les porte', () => {
    const salaire = s.incomes.find((x) => x.name === 'Salaire')!;
    const flux = alive(l.plannedFlows).find((f) => f.name === 'Salaire' && activeAt(f, asOf))!;
    // Le montant est proposé en positif : le signe appartient au genre du flux, pas à la saisie.
    expect(salaire.amount).toBe(Math.abs(flux.amount));
    expect({ interval: salaire.interval, unit: salaire.unit }).toEqual({ interval: flux.periodicity.interval, unit: flux.periodicity.unit });

    const credit = s.charges.find((x) => x.name === 'Crédit immobilier')!;
    expect(credit.amount).toBeGreaterThan(0);

    const tf = s.tirelires.find((x) => x.name === 'Taxe foncière')!.needs[0]!;
    expect(tf.periodicity).toEqual({ interval: 12, unit: 'month', anchorDate: '2026-10-15' });
  });
});
