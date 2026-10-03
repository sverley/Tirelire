import { describe, expect, it } from 'vitest';
import { activeAt, alive, budgetSuggestions, exampleLedger, euros, nextDueDate } from '../src/index.js';

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
      ...s.everyday.map((x) => x.name),
      ...s.periodic.map((x) => x.name),
      ...s.savings.map((x) => x.name),
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

  it("couvre les cinq questions du parcours à partir de l'exemple seul", () => {
    expect(s.incomes.length).toBeGreaterThan(0);
    expect(s.charges.length).toBeGreaterThan(0);
    expect(s.everyday.length).toBeGreaterThan(0);
    expect(s.periodic.length).toBeGreaterThan(0);
    expect(s.savings.length).toBeGreaterThan(0);
  });

  it('ne propose qu’une version de chaque besoin, celle en vigueur ; les flux se proposent avec toutes leurs versions (D51)', () => {
    const noms = [...s.everyday.map((x) => x.name), ...s.savings.map((x) => x.name)];
    expect(new Set(noms).size).toBe(noms.length);
    expect(s.everyday.find((x) => x.name === 'Alimentation')!.amount).toBe(euros(900));
    // Le salaire change à la paie de novembre : les deux versions sont proposées, chacune avec sa date.
    expect(s.incomes.filter((x) => x.name === 'Salaire').map((x) => [x.amount, x.activeFrom, x.activeTo])).toEqual([
      [euros(3400), undefined, '2026-10-27'],
      [euros(3550), '2026-10-28', undefined],
    ]);
  });

  it('suit la version en vigueur quand un besoin a changé ; les flux se proposent de même à toute date', () => {
    // Novembre : l'alimentation est passée à 950 et le piano est apparu.
    const apres = budgetSuggestions('2026-11-15');
    expect(apres.everyday.find((x) => x.name === 'Alimentation')!.amount).toBe(euros(950));
    expect(apres.everyday.filter((x) => x.name === 'Alimentation').length).toBe(1);
    // Les flux ne suivent pas la date : toutes leurs versions, en novembre comme en janvier, où le crédit est terminé.
    expect(apres.incomes).toEqual(s.incomes);
    expect(apres.charges).toEqual(s.charges);
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

    const tf = s.periodic.find((x) => x.name === 'Taxe foncière')!;
    expect({ interval: tf.interval, unit: tf.unit }).toEqual({ interval: 12, unit: 'month' });
    expect({ month: tf.month, day: tf.day }).toEqual({ month: 10, day: 15 });
  });

  it("date l'échéance proposée sur sa prochaine occurrence, sans demander l'année", () => {
    // Le 15 octobre est encore devant nous en septembre…
    expect(nextDueDate(10, 15, '2026-09-08')).toBe('2026-10-15');
    // …mais derrière nous en novembre, donc l'année suivante.
    expect(nextDueDate(10, 15, '2026-11-01')).toBe('2027-10-15');
    // Le jour même compte comme à venir.
    expect(nextDueDate(10, 15, '2026-10-15')).toBe('2026-10-15');
  });
});
