import { describe, expect, it } from 'vitest';
import {
  applyPatchToLedger,
  bankMultiAccountProfile,
  decodeBytes,
  detectDelimiter,
  envelopeBalance,
  euros,
  exampleLedger,
  guessColumns,
  indexLedger,
  matchAccountByNumber,
  matchEnvelopeTransfers,
  missingFlows,
  newProfileFromRows,
  normalizeAccountNumber,
  pairInternalTransfers,
  parseCsv,
  parseRows,
  prepareImport,
  proposeMatches,
  applyMatch,
  applyRules,
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
  '28/08/2026;28/08/2026;00011111111;Compte Joint;VIR PERM TIRELIRE TAXE FONCIERE;VIR PERM 000123 TIRELIRE TAXE FONCIERE;Mouvements internes débiteurs;;-100,00;Non;',
  '28/08/2026;28/08/2026;00011111111;Compte Joint;VIR PERM TIRELIRE ENFANTS ET LOISIRS;VIR PERM 000124 TIRELIRE ENFANTS ET LOISIRS;Mouvements internes débiteurs;;-200,00;Non;',
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
  profile.accountMap = { '00011111111': 'acc-pivot' };
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
    expect(twins.map((t) => t.operation.rank)).toEqual([0, 1]);
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

  it('virements « TIRELIRE » reconnus par le libellé de l’enveloppe', () => {
    const l = imported();
    const patch = matchEnvelopeTransfers(l);
    expect(patch.operations.length).toBe(2);
    const l2 = applyPatchToLedger(l, patch);
    const idx = indexLedger(l2);
    // 900 initial + 100 viré
    expect(envelopeBalance(idx.envelopesById.get('env-tf')!, idx, '2026-09-06')).toBe(euros(1000));
    // budget enfants sur compte tiers : +200 (aucune dépense saisie dans ce test)
    expect(envelopeBalance(idx.envelopesById.get('env-enfants')!, idx, '2026-09-06')).toBe(euros(200));
    const tf = l2.operations.find((o) => o.normalizedLabel.includes('TAXE FONCIERE'))!;
    expect(tf.status).toBe('transfer');
    expect(tf.transferAccountId).toBe('acc-livret');
  });

  it('pointage des flux prévus : automatique quand libellé et montant concordent', () => {
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
    expect(op.status).toBe('matched');
    expect(op.plannedFlowId).toBe('flow-credit');
    expect(l2.allocations.find((a) => a.operationId === op.id)?.categoryId).toBe('cat-logement');
    // La même occurrence n'est plus proposée.
    expect(proposeMatches(l2, '2026-08-01', '2026-09-30').some((p) => p.flowId === 'flow-credit')).toBe(false);
  });

  it('règles : motif → catégorie et enveloppe du budget', () => {
    const l = imported();
    l.rules.push({ id: 'r1', pattern: 'SUPERMARCHE', categoryId: 'cat-alim', priority: 10 });
    const patch = applyRules(l);
    expect(patch.operations.length).toBe(2);
    expect(patch.allocations[0]!.envelopeId).toBe('env-alim');
    const l2 = applyPatchToLedger(l, patch);
    const idx = indexLedger(l2);
    expect(envelopeBalance(idx.envelopesById.get('env-alim')!, idx, '2026-09-06')).toBe(euros(900 - 170.8));
    expect(suggestPattern(l.operations.find((o) => o.normalizedLabel.includes('EAU'))!)).toBe('EAU.*VILLAGE');
  });

  it('pipeline complet et flux manquants', () => {
    let l = imported();
    l.rules.push({ id: 'r1', pattern: 'SUPERMARCHE', categoryId: 'cat-alim', priority: 10 });
    const report = runPipeline(l, '2026-08-01', '2026-09-30', (p: Patch) => (l = applyPatchToLedger(l, p)));
    expect(report.envelopeTransfers).toBe(2);
    expect(report.autoMatched).toBe(2);
    expect(report.ruled).toBe(2);
    expect(report.proposals.map((p) => p.flowId)).toEqual(['flow-salaire']);
    const pending = l.operations.filter((o) => o.status === 'pending');
    // Restent : salaire (à confirmer) et l'eau (aucune règle)
    expect(pending.length).toBe(2);
    // Le loyer locatif du 5 septembre n'est pas arrivé (fenêtre 5 j écoulée au 20 septembre)
    const missing = missingFlows(l, '2026-08-01', '2026-09-20');
    expect(missing.map((m) => m.flowId)).toContain('flow-loyer');
    expect(missing.map((m) => m.flowId)).not.toContain('flow-credit');
    // Non affecté du pivot : 2340 + 3400 − 100 − 200 − 950 + 100 − 170,8 − 76 − (900−170,8 + 200 + 250 + 100)
    const idx = indexLedger(l);
    const pivot = idx.accountsById.get('acc-pivot')!;
    expect(unallocated(pivot, l, idx, '2026-09-20')).toBe(euros(2340 + 3400 - 100 - 200 - 950 + 100 - 170.8 - 76 - (900 - 170.8) - 200 - 250 - 100));
  });

  it('virements internes appariés entre deux comptes importés', () => {
    const l = imported();
    l.operations.push({
      id: 'op-livret-in',
      accountId: 'acc-livret',
      origin: 'imported',
      date: '2026-08-29',
      label: 'VIR TIRELIRE TAXE FONCIERE',
      normalizedLabel: 'VIR TIRELIRE TAXE FONCIERE',
      amount: euros(100),
      status: 'pending',
    });
    const patch = pairInternalTransfers(l);
    expect(patch.operations.length).toBe(2);
    expect(patch.operations.every((o) => o.status === 'transfer')).toBe(true);
    // Puis l'enveloppe est reconnue côté pivot, sans double compte côté livret.
    let l2 = applyPatchToLedger(l, patch);
    l2 = applyPatchToLedger(l2, matchEnvelopeTransfers(l2));
    const idx = indexLedger(l2);
    expect(envelopeBalance(idx.envelopesById.get('env-tf')!, idx, '2026-09-06')).toBe(euros(1000));
  });
});

describe('correspondance des comptes par numéro', () => {
  const pivot: Account = { id: 'acc-pivot', name: 'Pivot', kind: 'pivot', openingBalance: 0, openingDate: '2026-01-01', accountNumber: 'FR76 1234 5678 9012 3456 7890 123' };
  const livret: Account = { id: 'acc-livret', name: 'Livret', kind: 'holding', openingBalance: 0, openingDate: '2026-01-01', accountNumber: '00012345678' };
  const sansNumero: Account = { id: 'acc-autre', name: 'Autre', kind: 'holding', openingBalance: 0, openingDate: '2026-01-01' };
  const accounts = [pivot, livret, sansNumero];

  it('normalise en retirant espaces et ponctuation, insensible à la casse', () => {
    expect(normalizeAccountNumber('fr76 1234-5678.9012')).toBe('FR76123456789012');
  });

  it('retrouve un compte par IBAN malgré les espaces', () => {
    expect(matchAccountByNumber(accounts, 'FR7612345678901234567890123')?.id).toBe('acc-pivot');
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
