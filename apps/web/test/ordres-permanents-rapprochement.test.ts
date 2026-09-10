/**
 * Harnais d'audit de #13 (PR #20), côté calcul : ce que le bouton de l'étape « Vos ordres
 * permanents » enregistre, et si la phrase qui l'accompagne dit vrai.
 *
 * L'issue demande un bouton qui enregistre le flux attendu « avec sa ventilation prévue », un
 * libellé montré « tel qu'il sera réellement », et une phrase qui annonce la suite : à l'import, la
 * ligne est reconnue par libellé et montant, la ventilation prévue s'applique si le montant
 * correspond, sinon l'ordre de financement est rejoué (D21, D06). Rien de cela ne se voit à l'écran,
 * et la garde de la PR ne le tient pas : elle regarde le libellé du bouton, pas ce qu'il écrit.
 *
 * On part du geste réel — le flux que fabrique `virementPermanent`, code partagé par le Plan et
 * l'assistant —, puis d'une ligne de relevé portant le libellé recopié, et du rapprochement du cœur.
 * Aucun navigateur : ces tests tournent partout.
 */
import { describe, expect, it } from 'vitest';
import {
  addDays,
  applyMatch,
  computePlan,
  distributeTransfer,
  exampleLedger,
  normalizeLabel,
  proposeMatches,
  type Ledger,
  type Operation,
  type PlannedFlow,
  type PlanTransfer,
} from '@tirelire/core';
import { fluxDuVirement, virementPermanent } from '../src/lib/virements';

/** La date que pose « Charger l'exemple » (`loadExample`). */
const JOUR = '2026-09-06';
const PRINCIPAL = 'acc-principal';
const LIVRET = 'acc-livret';

/**
 * Noms de compte à éprouver. Le dernier est un piège de la troncature : le 35ᵉ caractère de
 * « TIRELIRE ASSURANCE VIE DE SIMON ET MARIE » est un blanc.
 */
const NOMS = ['Livret A', 'Livret développement durable et solidaire', 'Assurance vie de Simon et Marie'];

const planDe = (ledger: Ledger) => computePlan(ledger, JOUR);

function virementVers(ledger: Ledger, compteId: string): PlanTransfer {
  const t = planDe(ledger).transfers.find((x) => x.accountId === compteId && x.standing > 0);
  if (!t) throw new Error(`aucun ordre permanent vers ${compteId} dans le plan de l'exemple`);
  return t;
}

const renommer = (ledger: Ledger, compteId: string, nom: string): Ledger => ({
  ...ledger,
  accounts: ledger.accounts.map((a) => (a.id === compteId ? { ...a, name: nom } : a)),
});

/** Le grand livre après un appui sur le bouton : le flux attendu est enregistré. */
function aprèsAppui(ledger: Ledger, t: PlanTransfer): { ledger: Ledger; flux: PlannedFlow } {
  const flux = virementPermanent(ledger, planDe(ledger), t, 'flux-audit');
  if (!flux) throw new Error("le bouton n'aurait rien enregistré");
  return { ledger: { ...ledger, plannedFlows: [...ledger.plannedFlows.filter((f) => f.id !== flux.id), flux] }, flux };
}

/**
 * La ligne du relevé une fois l'ordre posé : le libellé recopié depuis l'écran, précédé de ce que la
 * banque ajoute. Un relevé ne conserve pas les blancs de fin de champ.
 */
function ligneDuRelevé(libelléRecopié: string, montant: number, date: string): Operation {
  const label = `VIR SEPA ${libelléRecopié}`.trim();
  return { id: 'op-audit', accountId: PRINCIPAL, origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount: montant, state: 'untreated' };
}

/** Importe la ligne et applique le rapprochement proposé, comme l'écran Pointage. */
function importer(ledger: Ledger, op: Operation) {
  const avecLigne: Ledger = { ...ledger, operations: [...ledger.operations, op] };
  const proposition = proposeMatches(avecLigne, op.date, op.date).find((p) => p.operationId === op.id);
  return { avecLigne, proposition, patch: proposition ? applyMatch(avecLigne, proposition) : undefined };
}

/** Répartition par tirelire, en centimes signés. */
const parTirelire = (lignes: ReadonlyArray<{ tirelireId?: string; share: unknown }>) =>
  Object.fromEntries(lignes.map((l) => [l.tirelireId, (l.share as { amount?: number }).amount]));

/** La prochaine occurrence de l'ordre : le début de la période suivante, loin des opérations de l'exemple. */
const prochainPassage = (ledger: Ledger) => addDays(planDe(ledger).period.end, 1);

describe('#13 · ce que le bouton « Enregistrer ce virement attendu » écrit', () => {
  it('la part permanente, du compte principal vers le compte cible, avec la ventilation par tirelire', () => {
    const ledger = exampleLedger();
    const plan = planDe(ledger);
    const ordres = plan.transfers.filter((t) => t.standing > 0);
    expect(ordres.length, "l'exemple ne produit aucun ordre permanent : rien à auditer").toBeGreaterThan(0);

    for (const t of ordres) {
      const flux = virementPermanent(ledger, plan, t, 'flux-audit');
      expect(flux, `vers ${t.accountName} : rien à enregistrer`).toBeDefined();
      expect(flux!.kind).toBe('transfer');
      expect(flux!.accountId).toBe(PRINCIPAL);
      expect(flux!.counterpartAccountId).toBe(t.accountId);
      expect(flux!.amount, 'le flux doit porter la part permanente').toBe(-t.standing);
      if (t.exceptional > 0) expect(flux!.amount, 'le complément exceptionnel est fondu dans le permanent').not.toBe(-(t.standing + t.exceptional));
      expect(flux!.labelPattern, "le flux n'attend pas le libellé montré").toBe(t.label);
      const servies = t.orders.filter((o) => o.standing > 0);
      expect(parTirelire(flux!.plannedAllocation ?? [])).toEqual(Object.fromEntries(servies.map((o) => [o.tirelireId, -o.standing])));
    }
  });

  it("un second appui reprend le flux déjà enregistré au lieu d'en empiler un autre", () => {
    const { ledger, flux } = aprèsAppui(exampleLedger(), virementVers(exampleLedger(), LIVRET));
    const t = virementVers(ledger, LIVRET);
    expect(fluxDuVirement(ledger, t)?.id).toBe(flux.id);
    expect(virementPermanent(ledger, planDe(ledger), t, 'un-autre-identifiant')?.id).toBe(flux.id);
  });
});

describe("#13 · le libellé montré est celui qu'on copie, qu'on attend et qu'on reconnaît", () => {
  it.each(NOMS)('« %s » : 35 caractères au plus, sans blanc invisible à l’écran', (nom) => {
    const { label } = virementVers(renommer(exampleLedger(), LIVRET, nom), LIVRET);
    expect(label.length).toBeLessThanOrEqual(35);
    // L'écran ne montre pas un blanc de fin de ligne ; le bouton Copier le copie, et le flux l'attend.
    expect(label, `« ${label} » finit par un blanc : ce qu'on voit n'est pas ce qu'on copie`).toBe(label.trim());
  });

  it.each(NOMS)('« %s » : la ligne du relevé portant le libellé recopié est reconnue et reçoit la ventilation prévue', (nom) => {
    const départ = renommer(exampleLedger(), LIVRET, nom);
    const { ledger, flux } = aprèsAppui(départ, virementVers(départ, LIVRET));
    const op = ligneDuRelevé(flux.labelPattern!, flux.amount, prochainPassage(ledger));
    const { proposition, patch } = importer(ledger, op);

    expect(proposition?.flowId, `« ${op.label} » n'est pas rapprochée du virement attendu`).toBe(flux.id);
    expect(proposition?.reasons, `« ${op.label} » : libellé non reconnu`).toContain('libellé reconnu');
    expect(proposition?.auto, 'reconnue par libellé et montant, la ligne devrait se pointer seule (D12)').toBe(true);
    expect(parTirelire(patch!.allocations)).toEqual(parTirelire(flux.plannedAllocation!));
  });

  it("si le montant viré diffère, la répartition rejoue l'ordre de financement, pas la ventilation prévue", () => {
    const { ledger, flux } = aprèsAppui(exampleLedger(), virementVers(exampleLedger(), LIVRET));
    // 50 € de moins que prévu : dans la tolérance, mais plus le montant attendu.
    const op = ligneDuRelevé(flux.labelPattern!, flux.amount + 5_000, prochainPassage(ledger));
    const { avecLigne, proposition, patch } = importer(ledger, op);

    expect(proposition?.flowId).toBe(flux.id);
    const rejoué = distributeTransfer(avecLigne, LIVRET, op.amount, op.date);
    expect(parTirelire(patch!.allocations)).toEqual(Object.fromEntries(rejoué.map((p) => [p.tirelireId, -p.amount])));
    expect(parTirelire(patch!.allocations)).not.toEqual(parTirelire(flux.plannedAllocation!));
  });
});
