/**
 * Harnais d'audit de #436 : le parcours de bout en bout de **U3 · budget sans virements validés,
 * puis import** (#40), au registre (I3), avec son témoin rouge.
 *
 * L'usage : le budget construit, l'utilisateur ne valide aucun des virements permanents proposés ;
 * il importe ensuite un relevé du compte principal où figure le virement qu'il fait déjà vers un
 * compte d'accueil, à son propre libellé et à son propre montant. Ce virement n'est reconnu vers
 * aucun compte ; l'utilisateur le désigne comme « Virement vers » ce compte, et l'application
 * propose d'en faire l'ordre permanent : au montant constaté, ventilé comme le plan le propose pour
 * ce montant, ancré sur le virement, au motif tiré de son libellé (#434, #435). Enregistré, l'ordre
 * reprend le virement, que le plan compare à ce que le budget demande, et reprend seul le virement
 * du mois suivant.
 *
 * Le parcours part d'une base vide et écrit tout comme l'application l'écrit (D89) : le budget de
 * l'assistant (`ecrireLeBudget`), l'import comme l'écran Import (lecture, préparation, écriture,
 * puis la chaîne automatique), la désignation et l'enregistrement de l'ordre comme l'écran
 * Opérations. Il relit la base après chaque redémarrage.
 *
 * Ce qu'il ne garde pas : ce que montrent les écrans — cela reste à `VM-I3-u3-rapprochement` et aux
 * harnais d'interface de #435. Les deux autres façons dont un virement est reconnu (le libellé tiré
 * du nom du compte, l'appariement au crédit du même montant) restent au harnais de #434.
 */
import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  alive,
  bankMultiAccountProfile,
  componentsOnAccount,
  computePlan,
  euros,
  indexLedger,
  orderFromTransfer,
  parseCsv,
  parseRows,
  prepareImport,
  recordOrderFromTransfer,
  resumeFirstOccurrence,
  runPipeline,
  standingTransferFlow,
  suggestPattern,
  tirelireComponents,
  transferLabel,
  unallocated,
  unallocatedAmount,
  type Cents,
  type ISODate,
  type Ledger,
  type LedgerStore,
  type Patch,
  type PipelineReport,
  type PlannedFlow,
} from '../src/index.js';
import { AS_OF, LIVRET, PRINCIPAL, baseVide, ecrire, ecrireLeBudget, relire } from './parcours.js';

const NUMÉRO = '00012345678';
const ID_ORDRE = 'flux-ordre-u3';

/** Le libellé que la banque donne au virement : ni « TIRELIRE … » (D11), ni aucun nom de compte. */
const LIBELLÉ = 'VIR SEPA EMIS VERS M DUPONT MOTIF EPARGNE MENSUELLE';
/** Ce que l'utilisateur vire chaque mois : 250 €, quand le budget en demande 300 € pour le Livret A. */
const MONTANT = euros(250);
const DATE_VIREMENT = '2026-09-02';
const DATE_SUIVANT = '2026-10-02';

const ENTÊTE = 'Date transaction;Date comptabilisation;Num Compte;Libellé Compte;Libellé opération;Libellé complet;Catégorie;Sous-Catégorie;Montant;Pointée;';
const ligne = (date: string, libellé: string, montant: string) => {
  const [a, m, j] = date.split('-');
  return `${j}/${m}/${a};${j}/${m}/${a};${NUMÉRO};Compte Courant;${libellé};${libellé};;;${montant};Non;`;
};

/** Relevés inventés du compte principal, dans la forme des exports bancaires français (aucune donnée réelle). */
const RELEVÉ = [
  ENTÊTE,
  ligne('2026-08-28', 'VIR RECU DE EMPLOYEUR SA', '2400,00'),
  ligne(DATE_VIREMENT, LIBELLÉ, '-250,00'),
  ligne('2026-09-05', 'PRELEVEMENT DE AGENCE LOGEMENT LOYER', '-750,00'),
  ligne('2026-09-10', 'CARTE X2009 SUPERMARCHE', '-85,40'),
].join('\r\n');
const RELEVÉ_SUIVANT = [ENTÊTE, ligne('2026-09-28', 'VIR RECU DE EMPLOYEUR SA', '2400,00'), ligne(DATE_SUIVANT, LIBELLÉ, '-250,00')].join('\r\n');

const profil = () => {
  const p = bankMultiAccountProfile('prof-releve');
  p.accountMap = { [NUMÉRO]: PRINCIPAL };
  return p;
};

/**
 * Importe un relevé comme l'écran Import (`Import.svelte`) : lecture, préparation, écriture des
 * opérations nouvelles, puis la chaîne automatique sur leurs dates — appariement, virements reconnus,
 * reprises sans confirmation, automatismes.
 */
function importer(store: LedgerStore, relevé: string): PipelineReport {
  const p = profil();
  const lu = parseRows(parseCsv(relevé), p);
  expect(lu.errors).toEqual([]);
  const préparé = prepareImport(store.load(), lu.rows, p);
  expect(préparé.unmappedAccounts).toEqual([]);
  const ops = préparé.candidates.filter((c) => !c.exact && !c.probable).map((c) => c.operation);
  expect(ops).toHaveLength(lu.rows.length);
  store.upsert('importProfiles', p);
  for (const o of ops) store.upsert('operations', o);
  const dates = ops.map((o) => o.date).sort();
  const lendemain = (d: ISODate) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return runPipeline(store.load(), dates[0]!, lendemain(dates.at(-1)!), (patch) => {
    ecrire(store, patch);
    return store.load();
  });
}

const virementDe = (ledger: Ledger, date: ISODate) => {
  const op = alive(ledger.operations).find((o) => o.accountId === PRINCIPAL && o.date === date && o.amount === -MONTANT);
  expect(op, `le virement du ${date} n'a pas été importé`).toBeDefined();
  return op!;
};
const livretAuPlan = (ledger: Ledger) => computePlan(ledger, AS_OF).transfers.find((t) => t.accountId === LIVRET);
const ordresVersLeLivret = (ledger: Ledger) => alive(ledger.plannedFlows).filter((f) => f.kind === 'transfer' && f.counterpartAccountId === LIVRET);
const partsDe = (ledger: Ledger, opId: string) =>
  alive(ledger.subOperations)
    .filter((s) => s.operationId === opId)
    .map((s) => [s.tirelireId, s.share]);
const surLeLivret = (ledger: Ledger, date: ISODate) => {
  const idx = indexLedger(ledger);
  return Object.fromEntries(alive(ledger.tirelires).map((t) => [t.id, tirelireComponents(t, idx, date).get(LIVRET) ?? 0]));
};

/** La ventilation que le plan propose pour 250 € : l'échéance d'abord, puis l'objectif (D06 ; #393, point 9). */
const VENTILATION_POUR_LE_VIREMENT = [
  { tirelireId: 'tir-taxe', share: { kind: 'fixed', amount: -euros(100) } },
  { tirelireId: 'tir-vacances', share: { kind: 'fixed', amount: -euros(150) } },
];

/**
 * Le geste « Enregistrer mon ordre permanent » de l'écran Opérations (#435, point 4) : la
 * proposition lue à la date de lecture, écrite telle quelle, l'ordre et la reprise dans le même geste.
 * Le témoin rouge lui substitue une version cassée.
 */
type Enregistrer = (ledger: Ledger, operationId: string) => { flow: PlannedFlow; patch: Patch } | undefined;
const enregistrerCommeLÉcran: Enregistrer = (ledger, operationId) => recordOrderFromTransfer(ledger, operationId, AS_OF, ID_ORDRE);

async function parcoursU3(site: string, enregistrer: Enregistrer): Promise<void> {
  // ─── 1. Le budget, sans virement validé ──────────────────────────────────────────────────────
  const store = await baseVide(site);
  ecrireLeBudget(store);
  const budget = store.load();
  const proposé = livretAuPlan(budget);
  expect(proposé, 'le plan ne propose aucun ordre vers le Livret A').toBeDefined();
  expect(proposé!.proposal, 'le plan ne propose aucun ordre vers le Livret A').toBeDefined();
  const demandé: Cents = proposé!.permanent;
  expect(demandé).toBe(euros(300));
  // Le compte d'accueil héberge au moins deux tirelires.
  expect(proposé!.breakdown.map((b) => b.tirelireId).sort()).toEqual(['tir-taxe', 'tir-vacances']);
  // Aucun ordre validé, et la lecture du plan n'en écrit aucun (I10).
  const avantLecture = store.export();
  computePlan(store.load(), AS_OF);
  expect(store.export()).toEqual(avantLecture);
  expect(ordresVersLeLivret(store.load())).toEqual([]);

  // ─── 2. L'import ─────────────────────────────────────────────────────────────────────────────
  // Le virement diffère de ce que le budget demande de plus que le pas d'arrondi des ordres.
  expect(Math.abs(demandé - MONTANT)).toBeGreaterThan(budget.settings.orderRounding);
  expect(LIBELLÉ).not.toContain(transferLabel('Livret A'));
  importer(store, RELEVÉ);
  let ledger = await relire(store, site);
  const importé = virementDe(ledger, DATE_VIREMENT);
  expect(importé.origin).toBe('imported');
  expect(importé.transferAccountId, 'le virement est reconnu sans que l’utilisateur le désigne').toBeUndefined();
  expect(importé.plannedFlowId).toBeUndefined();

  // ─── 3. La désignation ───────────────────────────────────────────────────────────────────────
  // « Virement interne vers… » de l'écran Opérations : une modification manuelle, qui verrouille (D22).
  store.upsert('operations', { ...importé, state: 'locked', transferAccountId: LIVRET });
  ledger = await relire(store, site);
  const désigné = virementDe(ledger, DATE_VIREMENT);
  expect(désigné.transferAccountId).toBe(LIVRET);
  expect(désigné.plannedFlowId, 'la désignation a fait reprendre une occurrence').toBeUndefined();
  expect(partsDe(ledger, désigné.id), 'la désignation a ventilé le virement d’office').toEqual([]);
  {
    const idx = indexLedger(ledger);
    // Tout le montant du virement reste non affecté (D21, D29) : aucune tirelire n'en reçoit rien.
    expect(unallocatedAmount(désigné, idx)).toBe(-MONTANT);
    expect(surLeLivret(ledger, AS_OF)).toEqual({ 'tir-courses': 0, 'tir-taxe': 0, 'tir-vacances': 0 });
  }

  // ─── 4. La proposition ───────────────────────────────────────────────────────────────────────
  const avantProposition = store.export();
  const proposition = orderFromTransfer(store.load(), désigné.id, AS_OF, ID_ORDRE);
  expect(proposition, 'aucune proposition d’en faire l’ordre permanent').toBeDefined();
  expect(proposition!.kind).toBe('transfer');
  expect(proposition!.accountId).toBe(PRINCIPAL);
  expect(proposition!.counterpartAccountId).toBe(LIVRET);
  expect(proposition!.amount).toBe(-MONTANT);
  // Ventilée comme le plan le propose pour ce montant, et non comme le budget le demande.
  const commeLeBudget = standingTransferFlow(computePlan(ledger, AS_OF), proposé!, PRINCIPAL, 'x')!.action?.allocation;
  expect(proposition!.action?.allocation).toEqual(VENTILATION_POUR_LE_VIREMENT);
  expect(proposition!.action?.allocation).not.toEqual(commeLeBudget);
  expect(proposition!.periodicity).toEqual({ interval: 1, unit: 'month', anchorDate: DATE_VIREMENT });
  expect(proposition!.labelPattern).toBe(suggestPattern(désigné));
  expect(new RegExp(proposition!.labelPattern!, 'i').test(désigné.normalizedLabel)).toBe(true);
  // La lire n'écrit rien (I10).
  expect(store.export()).toEqual(avantProposition);

  // ─── 5. L'enregistrement ─────────────────────────────────────────────────────────────────────
  const geste = enregistrer(store.load(), désigné.id);
  expect(geste, 'aucun ordre à enregistrer').toBeDefined();
  // `ecrireOrdre` de l'écran Opérations : l'ordre, puis le patch de la reprise.
  store.upsert('plannedFlows', geste!.flow);
  ecrire(store, geste!.patch);
  ledger = await relire(store, site);
  {
    const [ordre, ...autres] = ordresVersLeLivret(ledger);
    expect(autres).toEqual([]);
    expect(ordre!.id).toBe(ID_ORDRE);
    expect(ordre!.amount).toBe(-MONTANT);
    expect(ordre!.action?.allocation).toEqual(VENTILATION_POUR_LE_VIREMENT);
    expect(ordre!.labelPattern).toBe(proposition!.labelPattern);
    const repris = virementDe(ledger, DATE_VIREMENT);
    expect([repris.plannedFlowId, repris.plannedDate]).toEqual([ID_ORDRE, DATE_VIREMENT]);
    expect(partsDe(ledger, repris.id)).toEqual(VENTILATION_POUR_LE_VIREMENT.map((l) => [l.tirelireId, l.share]));
    expect(surLeLivret(ledger, AS_OF)).toEqual({ 'tir-courses': 0, 'tir-taxe': euros(100), 'tir-vacances': euros(150) });
    // I2 : le solde de chaque compte est la somme de ses composantes et du non affecté, au centime près.
    const idx = indexLedger(ledger);
    for (const a of idx.accountsById.values()) {
      expect(componentsOnAccount(a, idx, AS_OF) + unallocated(a, ledger, idx, AS_OF), a.id).toBe(accountBalance(a, ledger, AS_OF));
    }
    // Les parts absorbent tout le virement : il n'en reste rien de non affecté.
    expect(unallocatedAmount(repris, idx)).toBe(0);
  }

  // ─── 6. Le plan ──────────────────────────────────────────────────────────────────────────────
  {
    const ordreAvant = structuredClone(ordresVersLeLivret(ledger));
    const avantPlan = store.export();
    const plan = computePlan(ledger, AS_OF);
    const livret = plan.transfers.find((t) => t.accountId === LIVRET)!;
    expect(livret.bankOrder?.flowId).toBe(ID_ORDRE);
    expect(livret.bankOrder?.amount).toBe(MONTANT);
    expect(livret.permanent).toBe(demandé);
    expect(livret.bankOrder?.drift).toBe(demandé - MONTANT);
    expect(livret.bankOrder?.signaled).toBe(true);
    const écarts = plan.warnings.filter((w) => w.code === 'bankOrderDrift');
    expect(écarts.map((w) => w.accountId)).toEqual([LIVRET]);
    expect(écarts[0]!.message).toContain('250,00');
    expect(écarts[0]!.message).toContain('300,00');
    // Sans réécrire l'ordre (D60, I10).
    expect(ordresVersLeLivret(ledger)).toEqual(ordreAvant);
    expect(store.export()).toEqual(avantPlan);
  }

  // ─── 7. L'import suivant ─────────────────────────────────────────────────────────────────────
  const rapport = importer(store, RELEVÉ_SUIVANT);
  ledger = await relire(store, site);
  store.close();
  const suivant = virementDe(ledger, DATE_SUIVANT);
  expect(rapport.proposals.filter((p) => p.operationId === suivant.id), 'la reprise demande une confirmation').toEqual([]);
  expect([suivant.plannedFlowId, suivant.plannedDate]).toEqual([ID_ORDRE, DATE_SUIVANT]);
  expect(suivant.transferAccountId).toBe(LIVRET);
  expect(partsDe(ledger, suivant.id)).toEqual(VENTILATION_POUR_LE_VIREMENT.map((l) => [l.tirelireId, l.share]));
  expect(surLeLivret(ledger, '2026-10-20')).toEqual({ 'tir-courses': 0, 'tir-taxe': euros(200), 'tir-vacances': euros(300) });
}

describe('[niveau 1] harnais du registre · I3 (U3)', () => {
  describe('U3 · budget sans virements validés, puis import, de bout en bout (#40, #436)', () => {
    it('parcours U3 · du budget sans virement validé à l’ordre fait d’un virement importé', async () => {
      await parcoursU3('parcours-u3', enregistrerCommeLÉcran);
    });

    it.fails('témoin rouge · un ordre ventilé comme le budget le demande, et non comme le plan le propose pour le montant du virement', async () => {
      // Version volontairement cassée — ce que `VM-I3-u3-rapprochement` disait jusqu'ici : l'ordre
      // prend le montant du virement, mais reprend la ventilation prévue par le budget.
      await parcoursU3('parcours-u3-témoin', (ledger, operationId) => {
        const proposé = orderFromTransfer(ledger, operationId, AS_OF, ID_ORDRE);
        const t = livretAuPlan(ledger);
        if (!proposé || !t) return undefined;
        const commeLeBudget = standingTransferFlow(computePlan(ledger, AS_OF), t, PRINCIPAL, ID_ORDRE)!.action!.allocation!;
        const flow: PlannedFlow = { ...proposé, action: { ...proposé.action, allocation: commeLeBudget } };
        return { flow, patch: resumeFirstOccurrence(ledger, operationId, flow) };
      });
    });
  });
});
