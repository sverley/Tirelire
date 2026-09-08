import { describe, expect, it } from 'vitest';
import { activeAt, alive, computePlan, euros, exampleLedger, type Ledger } from '../src/index.js';

/**
 * D51 : le jeu d'exemple porte des changements datés — une révision déjà faite, deux à venir, un
 * besoin qui apparaît, une charge qui s'arrête. Ce test dit ce qu'on doit voir à chaque période, et
 * sert de garde-fou dans les deux sens : il échoue si quelqu'un retire ces changements, et il
 * échoue aussi si l'un d'eux déborde sur la période en cours, ce qui rendrait faux tout le reste de
 * `plan.test.ts`.
 *
 * Les périodes commencent le 28 (D02, D44) :
 *   septembre = 28/08 → 27/09 · octobre = 28/09 → 27/10 · novembre = 28/10 → 27/11
 *   décembre  = 28/11 → 27/12 · janvier  = 28/12 → 27/01
 */
const l: Ledger = exampleLedger();

/** Montant demandé par un besoin dans la période contenant `asOf` ; `undefined` si la ligne n'existe pas. */
function demande(asOf: string, needId: string): number | undefined {
  return computePlan(l, asOf).lines.find((x) => x.needId === needId)?.requested;
}

const AU_MILIEU = {
  septembre: '2026-09-06',
  octobre: '2026-10-06',
  novembre: '2026-11-06',
  decembre: '2026-12-06',
  janvier: '2027-01-06',
};

describe('changements datés du jeu d’exemple (D51)', () => {
  it('la période en cours est intacte : une seule version de chaque budget', () => {
    const plan = computePlan(l, AU_MILIEU.septembre);
    expect(plan.period.label).toBe('septembre 2026');
    // Ce total est celui de l'analyse ; s'il bouge, c'est qu'un changement daté a débordé.
    expect(plan.totals.requested).toBe(euros(2350));
    expect(plan.totals.incomes).toBe(euros(4200));
    // Deux besoins portent « Alimentation » dans les données, un seul demande quelque chose.
    expect(l.needs.filter((n) => n.tirelireId === 'env-alim').length).toBe(2);
    expect(plan.lines.filter((x) => x.tirelireId === 'env-alim').length).toBe(1);
  });

  it('une révision déjà faite ne dote plus rien, et n’a jamais rien doté ici', () => {
    // « Divers et sorties » est passé de 300 à 250 € au 28 août, avant la première période dotée.
    expect(activeAt(l.needs.find((n) => n.id === 'need-divers-avant')!, AU_MILIEU.septembre)).toBe(false);
    expect(demande(AU_MILIEU.septembre, 'need-divers-avant')).toBeUndefined();
    expect(demande(AU_MILIEU.septembre, 'need-divers')).toBe(euros(250));
  });

  it('une révision à venir attend sa date, puis prend la place de l’ancienne', () => {
    expect(demande(AU_MILIEU.septembre, 'need-alim')).toBe(euros(900));
    expect(demande(AU_MILIEU.octobre, 'need-alim')).toBe(euros(900));
    // Novembre : l'ancien besoin a disparu du plan, le nouveau le remplace au centime près.
    expect(demande(AU_MILIEU.novembre, 'need-alim')).toBeUndefined();
    expect(demande(AU_MILIEU.novembre, 'need-alim-apres')).toBe(euros(950));
  });

  it('un besoin peut apparaître en cours d’année sans toucher au passé', () => {
    expect(demande(AU_MILIEU.octobre, 'need-piano')).toBeUndefined();
    expect(demande(AU_MILIEU.novembre, 'need-piano')).toBe(euros(45));
    // La tirelire porte alors deux besoins (D28), qui se lisent séparément dans le plan.
    const lignes = computePlan(l, AU_MILIEU.novembre).lines.filter((x) => x.tirelireId === 'env-enfants');
    expect(lignes.length).toBe(2);
  });

  it('un revenu daté change de montant à sa date', () => {
    expect(computePlan(l, AU_MILIEU.octobre).totals.incomes).toBe(euros(4200));
    expect(computePlan(l, AU_MILIEU.novembre).totals.incomes).toBe(euros(4350));
    // Un seul salaire est compté à la fois : les deux versions ne s'additionnent jamais.
    const revenus = computePlan(l, AU_MILIEU.novembre).incomes.filter((x) => x.name === 'Salaire');
    expect(revenus.length).toBe(1);
  });

  it('une charge fixe s’arrête à sa dernière échéance', () => {
    const credit = (asOf: string) => computePlan(l, asOf).fixedCharges.find((f) => f.name === 'Crédit immobilier');
    expect(credit(AU_MILIEU.novembre)?.amount).toBe(euros(-950));
    // Dernière échéance le 5 décembre : elle tombe encore dans la période de décembre, plus après.
    expect(credit(AU_MILIEU.decembre)?.amount).toBe(euros(-950));
    expect(credit(AU_MILIEU.janvier)).toBeUndefined();
    expect(computePlan(l, AU_MILIEU.janvier).totals.fixedCharges).toBe(euros(45 + 75 + 150));
  });

  it('l’épargne reprend la mensualité que le crédit libère', () => {
    expect(demande(AU_MILIEU.decembre, 'need-precaution')).toBe(euros(300));
    expect(demande(AU_MILIEU.janvier, 'need-precaution')).toBeUndefined();
    expect(demande(AU_MILIEU.janvier, 'need-precaution-apres')).toBe(euros(800));
  });

  it('chaque besoin daté a un successeur ou un prédécesseur : aucune tirelire ne reste sans budget', () => {
    for (const n of alive(l.needs).filter((x) => x.activeTo)) {
      const suite = alive(l.needs).filter(
        (x) => x.id !== n.id && x.tirelireId === n.tirelireId && x.activeFrom && x.activeFrom > n.activeTo!,
      );
      expect(suite.length, `le besoin ${n.id} se clôt sans successeur`).toBeGreaterThan(0);
    }
  });
});
