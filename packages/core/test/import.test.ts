import { describe, expect, it } from 'vitest';
import {
  operationKey,
  applyPatchToLedger,
  bankMultiAccountProfile,
  decodeBytes,
  detectDelimiter,
  tirelireBalance,
  tirelireComponents,
  euros,
  exampleLedger,
  guessColumns,
  indexLedger,
  matchAccountByNumber,
  matchTirelireTransfers,
  missingFlows,
  newProfileFromRows,
  normalizeAccountNumber,
  pairInternalTransfers,
  parseCsv,
  parseRows,
  prepareImport,
  proposeMatches,
  applyMatch,
  applyAutomations,
  runPipeline,
  suggestPattern,
  unallocated,
  type Account,
  type Ledger,
  type Patch,
} from '../src/index.js';

// Relevé inventé, dans la forme de l'export bancaire (latin-1, point-virgule, deux dates, deux libellés).
const CSV = [
  'Date transaction;Date comptabilisation;Num Compte;Libellé Compte;Libellé opération;Libellé complet;Catégorie;Sous-Catégorie;Montant;Pointée;',
  '28/08/2026;28/08/2026;00011111111;Compte Joint;VIR RECU DE: EMPLOYEUR SA;VIR RECU 123456789S DE: EMPLOYEUR SA MOTIF: SALAIRE AOUT REF: 1D0;Revenus du travail;Salaires;3400,00;Non;',
  '28/08/2026;28/08/2026;00011111111;Compte Joint;VIR PERM TIRELIRE LIVRET A;VIR PERM 000123 TIRELIRE LIVRET A;Mouvements internes débiteurs;;-100,00;Non;',
  '28/08/2026;28/08/2026;00011111111;Compte Joint;VIR PERM TIRELIRE CARTE ENFANTS;VIR PERM 000124 TIRELIRE CARTE ENFANTS;Mouvements internes débiteurs;;-200,00;Non;',
  '05/09/2026;05/09/2026;00011111111;Compte Joint;ECHEANCE PRET 0001234;ECHEANCE PRET 0001234 CAPITAL 700 INTERETS 250;Logement;Prêt;-950,00;Non;',
  '07/09/2026;07/09/2026;00011111111;Compte Joint;VIR RECU DE: CAF DU DEPARTEMENT;VIR RECU 6593641146S DE: CAF DU DEPARTEMENT MOTIF: 2070401CXXX REF: 831;Allocations;Allocations familiales;100,00;Non;',
  '03/09/2026;03/09/2026;00011111111;Compte Joint;CARTE X2009 02/09 SUPERMARCHE LYON;CARTE X2009 02/09 SUPERMARCHE LYON;Vie quotidienne;Alimentation;-85,40;Non;',
  '03/09/2026;03/09/2026;00011111111;Compte Joint;CARTE X2009 02/09 SUPERMARCHE LYON;CARTE X2009 02/09 SUPERMARCHE LYON;Vie quotidienne;Alimentation;-85,40;Non;',
  '04/09/2026;04/09/2026;00011111111;Compte Joint;PRELEVEMENT EUROPEEN DE: EAU DU VILLAGE;PRELEVEMENT EUROPEEN 6303920409 DE: EAU DU VILLAGE MOTIF: Facture;Logement;Eau;-76,00;Non;',
  '01/09/2026;01/09/2026;00022222222;Compte Enfant;CARTE X3001 31/08 LIBRAIRIE;CARTE X3001 31/08 LIBRAIRIE;Education et Famille;Fournitures;-24,90;Non;',
].join('\r\n');

function latin1(s: string): Uint8Array {
  return new Uint8Array([...s].map((c) => c.charCodeAt(0) & 0xff));
}

function ledgerWithBank(): { ledger: Ledger; profile: ReturnType<typeof bankMultiAccountProfile> } {
  const ledger = exampleLedger();
  ledger.operations = [];
  ledger.allocations = [];
  const profile = bankMultiAccountProfile('prof-bank');
  profile.accountMap = { '00011111111': 'acc-principal' };
  return { ledger, profile };
}

describe('lecture CSV', () => {
  it('décode le latin-1 et détecte le point-virgule', () => {
    const text = decodeBytes(latin1(CSV));
    expect(text).toContain('Libellé opération');
    expect(detectDelimiter(text)).toBe(';');
    const rows = parseCsv(text);
    expect(rows.length).toBe(10);
    expect(rows[0]!.length).toBe(11);
  });

  it('devine les colonnes et le format de date', () => {
    const rows = parseCsv(decodeBytes(latin1(CSV)));
    const cols = guessColumns(rows[0]!);
    expect(cols.date).toBe('Date transaction');
    expect(cols.account).toBe('Num Compte');
    expect(cols.label).toBe('Libellé opération');
    expect(cols.fullLabel).toBe('Libellé complet');
    expect(cols.amount).toBe('Montant');
    expect(cols.category).toBe('Catégorie');
    expect(cols.subCategory).toBe('Sous-Catégorie');
    const p = newProfileFromRows('p', 'test', rows);
    expect(p.dateFormat).toBe('DMY');
    expect(p.headerRow).toBe(0);
  });

  it('lit les lignes avec le profil banque', () => {
    const rows = parseCsv(decodeBytes(latin1(CSV)));
    const res = parseRows(rows, bankMultiAccountProfile('p'));
    expect(res.errors).toEqual([]);
    expect(res.rows.length).toBe(9);
    expect(res.rows[0]).toMatchObject({ date: '2026-08-28', amount: euros(3400), accountKey: '00011111111', suggestedCategory: 'Revenus du travail / Salaires' });
    expect(res.rows[6]!.amount).toBe(euros(-85.4));
  });
});

describe('préparation de l’import', () => {
  it('clés déterministes, rang pour les identiques, comptes non mappés', () => {
    const { ledger, profile } = ledgerWithBank();
    const rows = parseRows(parseCsv(decodeBytes(latin1(CSV))), profile).rows;
    const prep = prepareImport(ledger, rows, profile);
    expect(prep.unmappedAccounts).toEqual(['00022222222']);
    expect(prep.counts.new).toBe(8);
    const twins = prep.candidates.filter((c) => c.operation.amount === euros(-85.4));
    expect(twins.length).toBe(2);
    expect(twins[0]!.operation.id).not.toBe(twins[1]!.operation.id);
    const t0 = twins[0]!.operation;
    // Le rang parmi les identiques du jour n'entre que dans la clé (D09) : 0 puis 1.
    expect(twins.map((t) => t.operation.id)).toEqual([0, 1].map((rang) => operationKey(t0.accountId, t0.date, t0.amount, t0.normalizedLabel, rang)));
    expect(twins[0]!.operation.details).toBeUndefined(); // libellé complet identique : rien à garder
    expect(prep.candidates.find((c) => c.operation.amount === euros(-950))!.operation.details).toContain('CAPITAL 700');
  });

  it('réimporter le même fichier : tout est en doublon exact', () => {
    const { ledger, profile } = ledgerWithBank();
    const rows = parseRows(parseCsv(decodeBytes(latin1(CSV))), profile).rows;
    const first = prepareImport(ledger, rows, profile);
    const l2 = { ...ledger, operations: first.candidates.map((c) => c.operation) };
    const second = prepareImport(l2, rows, profile);
    expect(second.counts.exact).toBe(8);
    expect(second.counts.new).toBe(0);
  });

  it('doublon probable : même montant à ±3 jours, libellé réécrit', () => {
    const { ledger, profile } = ledgerWithBank();
    const rows = parseRows(parseCsv(decodeBytes(latin1(CSV))), profile).rows;
    const first = prepareImport(ledger, rows, profile);
    const l2 = { ...ledger, operations: first.candidates.map((c) => c.operation) };
    // Même prélèvement d'eau vu par une autre source : date décalée d'un jour, libellé simplifié.
    const again = prepareImport(l2, [{ line: 2, date: '2026-09-05', label: 'Eau du village', amount: euros(-76), accountKey: '00011111111' }], profile);
    expect(again.counts.probable).toBe(1);
    expect(again.candidates[0]!.probable?.amount).toBe(euros(-76));
  });
});

describe('rapprochement', () => {
  function imported(): Ledger {
    const { ledger, profile } = ledgerWithBank();
    const rows = parseRows(parseCsv(decodeBytes(latin1(CSV))), profile).rows;
    const prep = prepareImport(ledger, rows, profile);
    return { ...ledger, operations: prep.candidates.filter((c) => !c.exact).map((c) => c.operation) };
  }

  it('virements « TIRELIRE <COMPTE> » reconnus par compte et répartis par l’ordre de financement (D21)', () => {
    const l = imported();
    const patch = matchTirelireTransfers(l);
    expect(patch.operations.length).toBe(2);
    const l2 = applyPatchToLedger(l, patch);
    const idx = indexLedger(l2);
    // 100 € vers le livret : le plancher de la taxe foncière (rattrapage 150) passe avant tout ; le solde ne bouge pas.
    const tf = tirelireComponents(idx.tireliresById.get('env-tf')!, idx, '2026-09-06');
    expect(tf.get('acc-livret')).toBe(euros(1000));
    expect(tf.get('acc-principal')).toBe(euros(50));
    expect(tirelireBalance(idx.tireliresById.get('env-tf')!, idx, '2026-09-06')).toBe(euros(1050));
    // 200 € vers la carte enfants : dotation déplacée là (aucune dépense saisie dans ce test)
    const enfants = tirelireComponents(idx.tireliresById.get('env-enfants')!, idx, '2026-09-06');
    expect(enfants.get('acc-enfants')).toBe(euros(200));
    expect(tirelireBalance(idx.tireliresById.get('env-enfants')!, idx, '2026-09-06')).toBe(euros(200));
    const op = l2.operations.find((o) => o.normalizedLabel.includes('LIVRET A'))!;
    expect(op.state).toBe('reconciled');
    expect(op.transferAccountId).toBeDefined();
    expect(op.transferAccountId).toBe('acc-livret');
  });

  it('rapprochement de flux : automatique quand libellé et montant concordent', () => {
    const l = imported();
    const proposals = proposeMatches(l, '2026-08-01', '2026-09-30');
    const byFlow = new Map(proposals.map((p) => [p.flowId, p]));
    expect(byFlow.get('flow-credit')?.auto).toBe(true); // ECHEANCE PRET, montant exact
    expect(byFlow.get('flow-caf')?.auto).toBe(true); // CAF, 100 exact, fenêtre 5 j
    // Salaire : variable → proposé, jamais automatique
    const sal = byFlow.get('flow-salaire');
    expect(sal).toBeDefined();
    expect(sal!.auto).toBe(false);
    // Une occurrence par opération : les deux courses ne sont pas des flux
    expect(proposals.length).toBe(3);
  });

  it('applyMatch pose le statut, le flux et la ventilation', () => {
    const l = imported();
    const m = proposeMatches(l, '2026-08-01', '2026-09-30').find((p) => p.flowId === 'flow-credit')!;
    const l2 = applyPatchToLedger(l, applyMatch(l, m));
    const op = l2.operations.find((o) => o.id === m.operationId)!;
    expect(op.state).toBe('reconciled');
    expect(op.plannedFlowId).toBe('flow-credit');
    expect(l2.allocations.find((a) => a.operationId === op.id)?.categoryId).toBe('cat-logement');
    // La même occurrence n'est plus proposée.
    expect(proposeMatches(l2, '2026-08-01', '2026-09-30').some((p) => p.flowId === 'flow-credit')).toBe(false);
  });

  it('règles : motif → catégorie et tirelire du budget', () => {
    const l = imported();
    l.automations.push({ id: 'r1', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim', state: 'reconcile' }, rank: 'm' });
    const patch = applyAutomations(l);
    expect(patch.operations.length).toBe(2);
    expect(patch.allocations[0]!.tirelireId).toBe('env-alim');
    const l2 = applyPatchToLedger(l, patch);
    const idx = indexLedger(l2);
    expect(tirelireBalance(idx.tireliresById.get('env-alim')!, idx, '2026-09-06')).toBe(euros(900 - 170.8));
    expect(suggestPattern(l.operations.find((o) => o.normalizedLabel.includes('EAU'))!)).toBe('EAU.*VILLAGE');
  });

  it('pipeline complet et flux manquants', () => {
    let l = imported();
    l.automations.push({ id: 'r1', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim', state: 'reconcile' }, rank: 'm' });
    const report = runPipeline(l, '2026-08-01', '2026-09-30', (p: Patch) => (l = applyPatchToLedger(l, p)));
    expect(report.tirelireTransfers).toBe(2);
    expect(report.autoMatched).toBe(2);
    expect(report.ruled).toBe(2);
    expect(report.proposals.map((p) => p.flowId)).toEqual(['flow-salaire']);
    const pending = l.operations.filter((o) => o.state === 'untreated');
    // Restent : salaire (à confirmer) et l'eau (aucune règle)
    expect(pending.length).toBe(2);
    // Le loyer locatif du 5 septembre n'est pas arrivé (fenêtre 5 j écoulée au 20 septembre)
    const missing = missingFlows(l, '2026-08-01', '2026-09-20');
    expect(missing.map((m) => m.flowId)).toContain('flow-loyer');
    expect(missing.map((m) => m.flowId)).not.toContain('flow-credit');
    // Non affecté du compte principal : solde bancaire − composantes portées, dotations non encore virées comprises
    // (taxe foncière 150 − 100 virés, assurance auto 50, vacances 200, précaution 300, budgets du compte principal).
    const idx = indexLedger(l);
    const principal = idx.accountsById.get('acc-principal')!;
    const bank = 2340 + 3400 - 100 - 200 - 950 + 100 - 170.8 - 76;
    const reserved = 50 + 50 + 200 + 300 + (900 - 170.8) + 200 + 250 + 100;
    expect(unallocated(principal, l, idx, '2026-09-20')).toBe(euros(bank - reserved));
  });

  it('virements internes appariés entre deux comptes importés', () => {
    const l = imported();
    l.operations.push({
      id: 'op-livret-in',
      accountId: 'acc-livret',
      origin: 'imported',
      date: '2026-08-29',
      label: 'VIR TIRELIRE LIVRET A',
      normalizedLabel: 'VIR TIRELIRE LIVRET A',
      amount: euros(100),
      state: 'untreated',
    });
    const patch = pairInternalTransfers(l);
    expect(patch.operations.length).toBe(2);
    expect(patch.operations.every((o) => o.state === 'reconciled' && o.transferAccountId)).toBe(true);
    // Puis le virement est ventilé côté principal, sans double compte côté livret.
    let l2 = applyPatchToLedger(l, patch);
    l2 = applyPatchToLedger(l2, matchTirelireTransfers(l2));
    const idx = indexLedger(l2);
    const tf = tirelireComponents(idx.tireliresById.get('env-tf')!, idx, '2026-09-06');
    expect(tf.get('acc-livret')).toBe(euros(1000));
    expect(tirelireBalance(idx.tireliresById.get('env-tf')!, idx, '2026-09-06')).toBe(euros(1050));
  });
});

describe('correspondance des comptes par numéro', () => {
  const principal: Account = { id: 'acc-principal', name: 'Principal', kind: 'principal', openingBalance: 0, openingDate: '2026-01-01', accountNumber: 'FR76 1234 5678 9012 3456 7890 123' };
  const livret: Account = { id: 'acc-livret', name: 'Livret', kind: 'epargne', openingBalance: 0, openingDate: '2026-01-01', accountNumber: '00012345678' };
  const sansNumero: Account = { id: 'acc-autre', name: 'Autre', kind: 'epargne', openingBalance: 0, openingDate: '2026-01-01' };
  const accounts = [principal, livret, sansNumero];

  it('normalise en retirant espaces et ponctuation, insensible à la casse', () => {
    expect(normalizeAccountNumber('fr76 1234-5678.9012')).toBe('FR76123456789012');
  });

  it('retrouve un compte par IBAN malgré les espaces', () => {
    expect(matchAccountByNumber(accounts, 'FR7612345678901234567890123')?.id).toBe('acc-principal');
  });

  it('retrouve un compte quand seuls les derniers chiffres sont fournis', () => {
    expect(matchAccountByNumber(accounts, '5678')?.id).toBe('acc-livret');
  });

  it('ignore les valeurs trop courtes pour être fiables', () => {
    expect(matchAccountByNumber(accounts, '78')).toBeUndefined();
  });

  it("ne renvoie rien si aucun compte n'a de numéro mémorisé correspondant", () => {
    expect(matchAccountByNumber(accounts, '999999999999')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Témoins rouges des harnais U3 et U5 (docs/gardes.md) : les assertions du rapprochement et des
// doublons, rejouées sur des versions volontairement cassées du besoin. Ils doivent échouer ;
// `it.fails` tient l'échec attendu, et `pnpm test` rougit s'ils se mettaient à passer (#66).
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Le relevé inventé, importé sur le grand livre d'exemple — comme dans « rapprochement ». */
function importé(): Ledger {
  const { ledger, profile } = ledgerWithBank();
  const rows = parseRows(parseCsv(decodeBytes(latin1(CSV))), profile).rows;
  const prep = prepareImport(ledger, rows, profile);
  return { ...ledger, operations: prep.candidates.filter((c) => !c.exact).map((c) => c.operation) };
}

it.fails('témoin rouge · un virement reconnu versé en entier à une seule tirelire', () => {
  const l = importé();
  const patch = matchTirelireTransfers(l);
  // Version cassée : le libellé est bien reconnu, mais le virement n'est pas réparti par l'ordre
  // de financement (D21) — tout tombe dans la première tirelire venue.
  const cassé: Patch = { ...patch, allocations: patch.allocations.map((a) => ({ ...a, tirelireId: 'env-vac' })) };
  const idx = indexLedger(applyPatchToLedger(l, cassé));

  const tf = tirelireComponents(idx.tireliresById.get('env-tf')!, idx, '2026-09-06');
  expect(tf.get('acc-livret')).toBe(euros(1000));
  expect(tf.get('acc-principal')).toBe(euros(50));
  expect(tirelireBalance(idx.tireliresById.get('env-tf')!, idx, '2026-09-06')).toBe(euros(1050));
});

it.fails('témoin rouge · un import qui ne cherche les doublons que dans le fichier', () => {
  const { ledger, profile } = ledgerWithBank();
  const rows = parseRows(parseCsv(decodeBytes(latin1(CSV))), profile).rows;
  const l2 = { ...ledger, operations: prepareImport(ledger, rows, profile).candidates.map((c) => c.operation) };
  // Version cassée : le grand livre n'est pas consulté. Ni doublon exact au réimport, ni doublon
  // probable quand une autre source réécrit le libellé et décale la date.
  const oublieuse = (lignes: Parameters<typeof prepareImport>[1]) => prepareImport({ ...l2, operations: [] }, lignes, profile);

  const encore = oublieuse([{ line: 2, date: '2026-09-05', label: 'Eau du village', amount: euros(-76), accountKey: '00011111111' }]);
  expect(encore.counts.probable).toBe(1);
  expect(oublieuse(rows).counts.exact).toBe(8);
});
