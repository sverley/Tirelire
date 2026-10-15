/**
 * Tests du codeur de #488, second tour — le point 8 amendé (porteur, 16/10) : les 20 % tolérés ne
 * couvrent que la fin coupée, et plusieurs ordres qui ne reconnaissent un libellé que souplement n'en
 * font la destination d'aucun compte. Tous de niveau 4 : l'auditeur choisit parmi eux le harnais.
 *
 * Données inventées (D84) : un compte principal, deux comptes enfants, « Léa » et « Thomas », et les
 * libellés du « piège des ordres d'une famille » de l'issue.
 */
import { describe, expect, it } from 'vitest';
import {
  applyPatchToLedger,
  emptyLedger,
  euros,
  labelCutScore,
  labelMatcher,
  labelRecognizer,
  labelScore,
  matchTirelireTransfers,
  normalizeLabel,
  proposeInternalTransfers,
  proposeMatches,
  runPipeline,
  type Ledger,
  type Operation,
  type PlannedFlow,
} from '../src/index.js';

const CC = 'acc-principal';
const LEA = 'acc-lea';
const THOMAS = 'acc-thomas';
const MOTIF_LEA = 'VIR SEPA ARGENT POCHE LEA';
const MOTIF_THOMAS = 'VIR SEPA ARGENT POCHE THOMAS';
const COUPE = 'VIR SEPA ARGENT POCHE';

function op(id: string, accountId: string, date: string, label: string, amount: number): Operation {
  return { id, accountId, origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount, state: 'untreated' };
}

function ordre(id: string, vers: string, motif: string): PlannedFlow {
  return { id, name: `Virement ${vers}`, kind: 'transfer', amount: -euros(20), accountId: CC, counterpartAccountId: vers, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-01' }, dateWindowDays: 5, labelPattern: motif, amountTolerance: { pct: 20 } };
}

/** Les comptes, et les ordres demandés : `lea`, `thomas`. */
function famille(...ordres: Array<'lea' | 'thomas'>): Ledger {
  const l = emptyLedger();
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(2000), openingDate: '2025-12-31' },
    { id: LEA, name: 'Léa', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
    { id: THOMAS, name: 'Thomas', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
  );
  if (ordres.includes('lea')) l.plannedFlows.push(ordre('ordre-lea', LEA, MOTIF_LEA));
  if (ordres.includes('thomas')) l.plannedFlows.push(ordre('ordre-thomas', THOMAS, MOTIF_THOMAS));
  return l;
}

const avec = (l: Ledger, ...ops: Operation[]): Ledger => ({ ...l, operations: [...l.operations, ...ops] });

function importer(l: Ledger): Ledger {
  let out = l;
  runPipeline(out, '2026-03-25', '2026-04-10', (p) => (out = applyPatchToLedger(out, p)));
  return out;
}

const crédits = () => [op('c-lea', LEA, '2026-04-01', 'VIR RECU', euros(20)), op('c-thomas', THOMAS, '2026-04-02', 'VIR RECU', euros(20))];

describe('#488 · 8. les 20 % tolérés ne couvrent que la fin coupée', () => {
  it('[niveau 4] le score de la fin coupée, sur les exemples du « Fait quand »', () => {
    // Coupé par la source : 4 mots sur 5, oui.
    expect(labelCutScore(MOTIF_LEA, COUPE)).toBe(0.8);
    expect(labelCutScore(MOTIF_THOMAS, COUPE)).toBe(0.8);
    // Un autre mot à la place du mot absent : non, alors que la part des mots présents est 0,8.
    expect(labelScore(MOTIF_THOMAS, MOTIF_LEA)).toBe(0.8);
    expect(labelCutScore(MOTIF_THOMAS, MOTIF_LEA)).toBe(0);
    // Un mot du motif absent au milieu ou au début du texte : non.
    expect(labelCutScore(MOTIF_LEA, 'VIR SEPA POCHE LEA')).toBe(0);
    expect(labelCutScore(MOTIF_LEA, 'SEPA ARGENT POCHE LEA')).toBe(0);
    // Un suffixe ajouté après la fin coupée : le texte ne s'arrête plus avant le mot absent.
    expect(labelCutScore(MOTIF_LEA, `${COUPE} REF 9`)).toBe(0);
    // 3 mots sur 4, même coupés : sous le seuil.
    expect(labelCutScore('A B C D', 'X A B C')).toBe(0.75);
    // Ce que la reconnaissance tolérait déjà reste : préfixe, suffixe, deux mots insérés, dernier mot tronqué.
    expect(labelCutScore(MOTIF_LEA, `PRLV 12 ${MOTIF_LEA} REF 9`)).toBe(1);
    expect(labelCutScore('A B C', 'A X Y B C')).toBe(1);
    expect(labelCutScore('A B C', 'A X Y Z B C')).toBe(0);
    expect(labelCutScore('ARGENT POCHE MENSUEL', 'VIR ARGENT POCHE MEN')).toBe(1);
    expect(labelCutScore('TIRELIRE LEA', 'TIRELIRE TOM')).toBe(0);
  });

  it('[niveau 4] la reconnaissance du motif : exacte, souple ou aucune', () => {
    const lit = (motif: string, label: string) => labelRecognizer(motif)(op('x', CC, '2026-04-01', label, -euros(20)));
    expect(lit(MOTIF_LEA, `PRLV ${MOTIF_LEA}`)).toBe('exact');
    expect(lit(MOTIF_LEA, 'vir sepa argent poche léa')).toBe('exact');
    expect(lit(MOTIF_LEA, COUPE)).toBe('souple');
    expect(lit(MOTIF_THOMAS, MOTIF_LEA)).toBeUndefined();
    expect(labelMatcher(MOTIF_THOMAS)(op('x', CC, '2026-04-01', MOTIF_LEA, -euros(20)))).toBe(false);
    // Une expression régulière garde sa seule lecture.
    expect(lit('VIR SEPA (ARGENT|AP) POCHE LEA', 'VIR SEPA ARGENT POCHE LEA')).toBe('exact');
    expect(lit('VIR SEPA (ARGENT|AP) POCHE LEA', COUPE)).toBeUndefined();
  });
});

describe('#488 · 8. le piège des ordres d’une famille', () => {
  it('[niveau 4] chaque virement s’apparie à son crédit, aucune fausse paire', () => {
    const l = importer(avec(famille('lea', 'thomas'), op('d-lea', CC, '2026-04-01', MOTIF_LEA, -euros(20)), op('d-thomas', CC, '2026-04-04', MOTIF_THOMAS, -euros(20)), ...crédits()));
    const lien = (id: string) => l.operations.find((o) => o.id === id)?.transferOperationId;
    expect([lien('d-lea'), lien('d-thomas')]).toEqual(['c-lea', 'c-thomas']);
    expect([lien('c-lea'), lien('c-thomas')]).toEqual(['d-lea', 'd-thomas']);
    expect(l.operations.find((o) => o.id === 'd-lea')?.plannedFlowId).toBe('ordre-lea');
    expect(l.operations.find((o) => o.id === 'd-thomas')?.plannedFlowId).toBe('ordre-thomas');
  });

  it('[niveau 4] le libellé coupé n’a pas de destination connue : il se propose avec chaque crédit, rien ne s’apparie seul ni ne se rapproche d’office', () => {
    const avant = avec(famille('lea', 'thomas'), op('d', CC, '2026-04-01', COUPE, -euros(20)), ...crédits());
    expect(matchTirelireTransfers(avant).operations).toEqual([]);
    expect(proposeMatches(avant, '2026-03-25', '2026-04-10').filter((p) => p.operationId === 'd' && p.auto)).toEqual([]);
    const l = importer(avant);
    const d = l.operations.find((o) => o.id === 'd')!;
    expect(d.transferOperationId).toBeUndefined();
    expect(d.transferAccountId).toBeUndefined();
    expect(d.plannedFlowId).toBeUndefined();
    expect(proposeInternalTransfers(l).filter((p) => p.debitId === 'd').map((p) => p.creditId).sort()).toEqual(['c-lea', 'c-thomas']);
  });

  it('[niveau 4] avec le seul ordre de Thomas, le virement « … LEA » n’est pas rapproché de lui', () => {
    const avant = avec(famille('thomas'), op('d', CC, '2026-04-01', MOTIF_LEA, -euros(20)), ...crédits());
    expect(matchTirelireTransfers(avant).operations).toEqual([]);
    expect(proposeMatches(avant, '2026-03-25', '2026-04-10').filter((p) => p.operationId === 'd')).toEqual([]);
    const d = importer(avant).operations.find((o) => o.id === 'd')!;
    expect([d.plannedFlowId, d.transferAccountId, d.transferOperationId]).toEqual([undefined, undefined, undefined]);
  });

  it('[niveau 4] un seul ordre reconnaît le libellé coupé : son compte en est la destination', () => {
    const avant = avec(famille('lea'), op('d', CC, '2026-04-01', COUPE, -euros(20)), ...crédits());
    expect(matchTirelireTransfers(avant).operations.map((o) => [o.id, o.transferAccountId])).toEqual([['d', LEA]]);
    const d = importer(avant).operations.find((o) => o.id === 'd')!;
    expect([d.transferAccountId, d.transferOperationId]).toEqual([LEA, 'c-lea']);
  });

  it('[niveau 4] l’exacte l’emporte sur la souple, même d’un motif plus long', () => {
    const l = famille('lea');
    // Un ordre vers Thomas au motif plus long, qui ne reconnaît le libellé que souplement (fin coupée).
    l.plannedFlows.push(ordre('ordre-thomas', THOMAS, `${COUPE} THOMAS MENSUEL`));
    l.plannedFlows[0] = { ...l.plannedFlows[0]!, labelPattern: COUPE };
    const avant = avec(l, op('d', CC, '2026-04-01', `${COUPE} THOMAS`, -euros(20)));
    expect(labelRecognizer(`${COUPE} THOMAS MENSUEL`)(avant.operations[0]!)).toBe('souple');
    expect(labelRecognizer(COUPE)(avant.operations[0]!)).toBe('exact');
    expect(matchTirelireTransfers(avant).operations.map((o) => o.transferAccountId)).toEqual([LEA]);
    const auto = proposeMatches(avant, '2026-03-25', '2026-04-10').filter((p) => p.operationId === 'd');
    expect(auto.map((p) => p.flowId)).toEqual(['ordre-lea']);
  });
});
