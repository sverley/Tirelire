/**
 * Cohérence du plan d'une période à l'autre (D52).
 *
 * Le bloc « Virements à faire depuis le compte principal » et le bloc « Tirelires » doivent dire
 * la même chose : pour une période donnée, ce qu'on vire vers un compte d'accueil est exactement
 * ce que les tirelires placées là demandent pour cette période. Jusqu'au 8 septembre 2026, le
 * premier lisait la position réelle du jour — dotations des périodes précédentes comprises,
 * puisque rien ne les avait encore virées — pendant que le second simulait période par période.
 * Les deux blocs divergeaient donc dès la période suivante, et la divergence grossissait.
 */
import { describe, expect, it } from 'vitest';
import { computePlan, euros, exampleLedger, periodsAround, type Plan } from '../src/index.js';

/** Date à laquelle les soldes bancaires sont connus, dans la période « septembre 2026 » (28/08 → 27/09). */
const AUJOURD_HUI = '2026-09-08';

const SEPTEMBRE = '2026-09-08';
const OCTOBRE = '2026-09-28';
const NOVEMBRE = '2026-10-28';

const plan = (asOf: string): Plan => computePlan(exampleLedger(), asOf, AUJOURD_HUI);

/** Somme des dotations demandées par les tirelires placées sur un compte. */
function demande(p: Plan, accountId: string): number {
  return p.lines.filter((l) => l.accountId === accountId).reduce((s, l) => s + l.requested, 0);
}

/** Somme des virements proposés vers ce compte, part permanente et complément exceptionnel. */
function vire(p: Plan, accountId: string): number {
  const t = p.transfers.find((x) => x.accountId === accountId);
  return t ? t.standing + t.exceptional : 0;
}

function ordre(p: Plan, accountId: string, tirelireId: string) {
  return p.transfers.find((x) => x.accountId === accountId)?.orders.find((o) => o.tirelireId === tirelireId);
}

describe('les deux blocs du plan découlent du même calcul (D52)', () => {
  it('septembre 2026 : la période courante était déjà cohérente', () => {
    const p = plan(SEPTEMBRE);
    expect(p.period.label).toBe('septembre 2026');
    // Épargne de précaution 300 + Vacances 200 + Taxe foncière 150 + Assurance auto 50.
    expect(demande(p, 'acc-livret')).toBe(euros(700));
    expect(vire(p, 'acc-livret')).toBe(euros(700));
  });

  it('octobre 2026 : le virement ne redemande plus la dotation de septembre', () => {
    const p = plan(OCTOBRE);
    expect(p.period.label).toBe('octobre 2026');
    expect(demande(p, 'acc-livret')).toBe(euros(700));
    // Avant correction : 1 400 €, soit les dotations de septembre et d'octobre cumulées.
    expect(vire(p, 'acc-livret')).toBe(euros(700));
    // Taxe foncière : 100 € de croisière et 50 € de rattrapage, pas 300 €.
    const o = ordre(p, 'acc-livret', 'env-tf')!;
    expect(o.amount).toBe(euros(150));
    expect(o.standing).toBe(euros(100));
    expect(o.exceptional).toBe(euros(50));
  });

  it('novembre 2026 : une tirelire en avance ne demande rien, donc ne fait plus virer', () => {
    const p = plan(NOVEMBRE);
    expect(p.period.label).toBe('novembre 2026');
    const tf = p.lines.find((l) => l.needId === 'need-tf')!;
    expect(tf.status).toBe('ahead');
    expect(tf.requested).toBe(0);
    // Avant correction : le plan disait « rien à mettre de côté » et « vire 300 € » en même temps.
    expect(ordre(p, 'acc-livret', 'env-tf')).toBeUndefined();
    expect(demande(p, 'acc-livret')).toBe(euros(550));
    expect(vire(p, 'acc-livret')).toBe(euros(550));
  });

  it('« retenu » est le solde simulé au début de la période affichée, pas le solde du jour', () => {
    // Taxe foncière : 900 € au livret, puis les dotations de 150 € de septembre et d'octobre.
    expect(plan(SEPTEMBRE).lines.find((l) => l.needId === 'need-tf')!.held).toBe(euros(900));
    expect(plan(OCTOBRE).lines.find((l) => l.needId === 'need-tf')!.held).toBe(euros(1050));
    expect(plan(NOVEMBRE).lines.find((l) => l.needId === 'need-tf')!.held).toBe(euros(1200));
  });

  it('le total net à sortir suit : demandé moins ce qu’on rapatrie du non affecté', () => {
    for (const asOf of [SEPTEMBRE, OCTOBRE, NOVEMBRE]) {
      const p = plan(asOf);
      const t = p.transfers.find((x) => x.accountId === 'acc-livret')!;
      // 15 € dorment sur le livret sans appartenir à personne : ils reviennent au compte principal.
      expect(t.surplus).toBe(euros(15));
      expect(t.net).toBe(demande(p, 'acc-livret') - t.surplus);
    }
  });

  /**
   * La garde contre la régression : sur toute la fenêtre de navigation de l'écran Plan, chaque
   * virement proposé vaut exactement ce que les tirelires de ce compte demandent pour la période.
   */
  it('garde : l’égalité tient sur toutes les périodes de la fenêtre de navigation', () => {
    const ledger = exampleLedger();
    for (const p of periodsAround(ledger, AUJOURD_HUI, 1, 4)) {
      const asOf = p.start <= AUJOURD_HUI ? AUJOURD_HUI : p.start;
      const courant = computePlan(ledger, asOf, AUJOURD_HUI);
      for (const t of courant.transfers) {
        if (t.settlement !== 0) continue; // un compte tiers se règle, il ne se dote pas.
        expect({ periode: p.label, compte: t.accountName, montant: t.standing + t.exceptional }).toEqual({
          periode: p.label,
          compte: t.accountName,
          montant: demande(courant, t.accountId),
        });
      }
    }
  });
});
