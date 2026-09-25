/**
 * Parcours de bout en bout de **U2 · budget et virements permanents** (#13, #70).
 *
 * L'usage : le budget construit, l'application propose la mise en place des virements permanents ;
 * l'utilisateur les crée lui-même chez sa banque, et s'il valide leur mise en place, ils sont
 * enregistrés ici avec leur ventilation sur les tirelires. Le parcours part d'une base vide, écrit
 * le budget, lit l'ordre proposé, le valide, relit la base après redémarrage, et vérifie que
 * l'ordre est bien enregistré comme un **fait** que le plan compare à ce que le budget demande.
 *
 * Ce qu'il ajoute aux harnais unitaires : ceux-ci éprouvent le calcul d'un ordre sur un grand livre
 * déjà constitué ; ici l'ordre naît d'un budget écrit depuis rien, il est validé, persisté, puis
 * relu. Ce qu'il ne garde pas : l'étape de l'assistant qui l'affiche et le bouton qui l'enregistre
 * — cela reste à `VM-U2-ordres` et aux harnais d'interface.
 */
import { describe, expect, it } from 'vitest';
import {
  computePlan,
  euros,
  standingOrderFlow,
  standingTransferFlow,
  transferLabel,
  type Cents,
  type Ledger,
  type Plan,
} from '../src/index.js';
import { AS_OF, LIVRET, PRINCIPAL, baseVide, ecrireLeBudget, relire } from './parcours.js';

const virementDuLivret = (plan: Plan) => plan.transfers.find((t) => t.accountId === LIVRET);

/**
 * Ce que l'ordre validé doit être une fois enregistré : un flux dérivé, un seul par couple de
 * comptes (D21), qui porte le fait bancaire — montant, libellé à recopier — et non la ventilation,
 * laquelle se rejoue au plan (D60).
 */
function lOrdreEstEnregistré(ledger: Ledger, plan: Plan, permanent: Cents): void {
  const flux = standingOrderFlow(ledger.plannedFlows, LIVRET);
  expect(flux, 'aucun ordre permanent enregistré vers le Livret A').toBeDefined();
  expect(flux!.kind).toBe('transfer');
  expect(flux!.origin).toBe('derived');
  expect(flux!.accountId).toBe(PRINCIPAL);
  expect(flux!.counterpartAccountId).toBe(LIVRET);
  expect(flux!.labelPattern).toBe(transferLabel('Livret A'));
  expect(flux!.amount).toBe(-permanent);
  // La ventilation ne se fige pas dans le flux : le plan la recalcule.
  expect(flux!.tirelireId).toBeUndefined();

  const virement = virementDuLivret(plan);
  expect(virement, 'le Livret A a disparu du plan').toBeDefined();
  expect(virement!.bankOrder?.amount).toBe(permanent);
  expect(virement!.bankOrder?.drift).toBe(0);
  expect(virement!.breakdown.map((b) => b.tirelireName).sort()).toEqual(['Taxe foncière', 'Vacances']);
  expect(virement!.breakdown.reduce((s, b) => s + b.cruise, 0)).toBe(permanent);
  expect(plan.warnings.filter((w) => w.code === 'bankOrderDrift')).toEqual([]);
}

describe('[niveau 1] harnais du registre', () => {
  describe('U2 · budget et virements permanents, de bout en bout (#13)', () => {
    it('parcours U2 · du budget aux ordres permanents enregistrés avec leur ventilation', async () => {
      const store = await baseVide('parcours-u2');
      ecrireLeBudget(store);

      const avant = computePlan(store.load(), AS_OF);
      const virement = virementDuLivret(avant);
      expect(virement, 'aucun virement permanent proposé').toBeDefined();
      expect(virement!.label).toBe(transferLabel('Livret A'));
      expect(virement!.label.length).toBeLessThanOrEqual(35);
      const permanent = virement!.permanent;
      expect(permanent).toBe(euros(300));

      // Rien ne s'enregistre d'office (I10) : tant que l'utilisateur n'a pas validé, aucun ordre.
      expect(standingOrderFlow(store.load().plannedFlows, LIVRET)).toBeUndefined();
      expect(virement!.bankOrder).toBeUndefined();

      // L'utilisateur valide la mise en place chez sa banque.
      const flux = standingTransferFlow(avant, virement!, PRINCIPAL, 'flux-ordre-livret');
      expect(flux, 'aucun flux dérivé à enregistrer').toBeDefined();
      store.upsert('plannedFlows', flux!);

      const ledger = await relire(store, 'parcours-u2');
      store.close();
      lOrdreEstEnregistré(ledger, computePlan(ledger, AS_OF), permanent);
    });

    it('un ordre posé plus court que le budget ne se réécrit pas : le plan dit lequel changer', async () => {
      const store = await baseVide('parcours-u2-écart');
      ecrireLeBudget(store);
      const avant = computePlan(store.load(), AS_OF);
      const virement = virementDuLivret(avant)!;
      const posé = virement.permanent - euros(20);

      // Ce que la banque exécute, et non ce que le budget demande (D60).
      store.upsert('plannedFlows', standingTransferFlow(avant, virement, PRINCIPAL, 'flux-ordre-livret', posé)!);
      const ledger = await relire(store, 'parcours-u2-écart');
      store.close();

      const après = virementDuLivret(computePlan(ledger, AS_OF))!;
      expect(après.bankOrder?.amount).toBe(posé);
      expect(après.permanent).toBe(virement.permanent);
      expect(après.bankOrder?.drift).toBe(virement.permanent - posé);
      expect(computePlan(ledger, AS_OF).warnings.filter((w) => w.code === 'bankOrderDrift')).toHaveLength(1);
    });

    it.fails('témoin rouge · un ordre validé qui ne laisse aucune trace dans la base', async () => {
      const store = await baseVide('parcours-u2-témoin');
      ecrireLeBudget(store);
      const ledger = store.load();
      store.close();
      // Version volontairement cassée : l'application propose l'ordre, l'utilisateur le valide, et
      // rien n'est écrit — l'ordre ne sera reconnu à aucun import, sa ventilation nulle part.
      const plan = computePlan(ledger, AS_OF);
      lOrdreEstEnregistré(ledger, plan, virementDuLivret(plan)!.permanent);
    });
  });
});
