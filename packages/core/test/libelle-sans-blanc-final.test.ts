/**
 * Tests du codeur de #26 — « Un libellé de virement tronqué peut finir par un blanc, et la ligne n'est
 * plus reconnue ». Côté cœur ; ce que l'écran Plan montre et copie (point 2) est dans
 * `apps/web/test/libelle-sans-blanc-final-ecran.test.ts`.
 *
 * Données inventées (D84) : l'exemple, lu au 6 septembre 2026, son Livret A renommé « Assurance vie de
 * Simon et Marie » — le nom de l'issue, dont le libellé coupé à 35 caractères finissait par un blanc —,
 * et des opérations écrites ici. L'ordre de l'exemple vers ce compte part le 28 de chaque mois, 600 €,
 * fenêtre de 5 jours, tolérance de 20 %.
 */
import { describe, expect, it } from 'vitest';
import {
  applyPatchToLedger,
  computePlan,
  euros,
  exampleLedger,
  matchTirelireTransfers,
  normalizeLabel,
  proposeMatches,
  readLabelPattern,
  runPipeline,
  selects,
  standingTransferFlow,
  transferLabel,
  type Ledger,
  type Operation,
  type PlannedFlow,
} from '../src/index.js';

const PRINCIPAL = 'acc-principal';
const COMPTE = 'acc-livret';
const ORDRE = 'flow-vir-livret';
const LECTURE = '2026-09-06';
const NOM = 'Assurance vie de Simon et Marie';
/** Le libellé tel qu'il se montre : 34 caractères, sans blanc final. */
const LIBELLE = 'TIRELIRE ASSURANCE VIE DE SIMON ET';
/** Le motif qu'un ordre enregistré avant ce changement porte : le même, blanc final compris. */
const ANCIEN = `${LIBELLE} `;

function renomme(l: Ledger, id = COMPTE, nom = NOM): Ledger {
  return { ...l, accounts: l.accounts.map((a) => (a.id === id ? { ...a, name: nom } : a)) };
}
function sansOrdre(l: Ledger): Ledger {
  return { ...l, plannedFlows: l.plannedFlows.filter((f) => f.id !== ORDRE) };
}
function motifDeLOrdre(l: Ledger, motif: string | undefined): Ledger {
  return {
    ...l,
    plannedFlows: l.plannedFlows.map((f) => {
      if (f.id !== ORDRE) return f;
      const g: PlannedFlow = { ...f };
      if (motif === undefined) delete g.labelPattern;
      else g.labelPattern = motif;
      return g;
    }),
  };
}
/** Un débit du compte principal, sauf `compte` donné. */
function ligne(id: string, libelle: string, montant = euros(620), date = '2026-09-29', compte = PRINCIPAL): Operation {
  return { id, accountId: compte, origin: 'imported', date, label: libelle, normalizedLabel: normalizeLabel(libelle), amount: -montant, state: 'untreated' };
}
const avec = (l: Ledger, ...ops: Operation[]): Ledger => ({ ...l, operations: [...l.operations, ...ops] });
const virement = (l: Ledger, id = COMPTE) => computePlan(l, LECTURE).transfers.find((t) => t.accountId === id)!;
/** Importe : la chaîne complète du rapprochement, comme après un import ; rend le projet obtenu. */
function importer(l: Ledger): Ledger {
  let out = l;
  runPipeline(out, '2026-08-28', '2026-10-27', (p) => (out = applyPatchToLedger(out, p)));
  return out;
}

describe('[niveau 4] #26 · 1. le libellé proposé', () => {
  it('« Assurance vie de Simon et Marie » donne le libellé de l’issue, 34 caractères, sans blanc final', () => {
    expect(transferLabel(NOM)).toBe(LIBELLE);
    expect(LIBELLE.length).toBe(34);
  });

  it('un nom qui tient dans les 35 caractères garde son libellé d’aujourd’hui', () => {
    expect(transferLabel('Livret A')).toBe('TIRELIRE LIVRET A');
    expect(transferLabel('Livret d’épargne populaire famille Dupont')).toBe('TIRELIRE LIVRET D EPARGNE POPULAIRE');
  });

  it('pour tout nom : commence par TIRELIRE, ni blanc au début ni à la fin, 35 caractères au plus', () => {
    const noms = ['', '   ', 'A', ' Livret  A ', 'é', '!!!', NOM, 'Assurance vie de Simon et Paul', 'x'.repeat(60)];
    // Toutes les coupes possibles : un nom dont le 26ᵉ caractère, puis chacun des suivants, est un blanc.
    for (let i = 1; i <= 40; i++) noms.push(`${'A'.repeat(i)} ${'B'.repeat(40)}`, `${'A'.repeat(i)} - ${'B'.repeat(3)}`);
    for (const n of noms) {
      const l = transferLabel(n);
      expect(l, n).toMatch(/^TIRELIRE/);
      expect(l, n).toBe(l.trim());
      expect(l.length, n).toBeLessThanOrEqual(35);
    }
  });

  it('le plan le propose à recopier, et l’ordre à poser l’enregistre', () => {
    const l = renomme(sansOrdre(exampleLedger()));
    const plan = computePlan(l, LECTURE);
    const t = plan.transfers.find((x) => x.accountId === COMPTE)!;
    expect(t.labels).toEqual([LIBELLE]);
    expect(standingTransferFlow(plan, t, PRINCIPAL, 'nouvel-ordre')?.labelPattern).toBe(LIBELLE);
  });
});

describe('[niveau 4] #26 · 2. ce qu’on voit est ce qu’on copie — le plan', () => {
  it('un ordre enregistré avant, au motif qui finit par un blanc : le plan donne le libellé sans lui', () => {
    const l = motifDeLOrdre(renomme(exampleLedger()), ANCIEN);
    expect(virement(l).labels).toEqual([LIBELLE]);
  });

  it('un motif fait de blancs seuls ne donne aucun libellé, comme un ordre sans motif', () => {
    expect(virement(motifDeLOrdre(exampleLedger(), '   ')).labels).toEqual([]);
  });
});

describe('[niveau 4] #26 · 3. reconnu par l’ordre', () => {
  for (const [quand, motif] of [
    ['enregistré après ce changement', LIBELLE],
    ['enregistré avant, blanc final compris', ANCIEN],
  ] as const) {
    it(`ordre ${quand} : la ligne au libellé montré, dans la tolérance, est reprise sans proposition et reconnue vers son compte`, () => {
      const l = avec(motifDeLOrdre(renomme(exampleLedger()), motif), ligne('op-av', `VIR SEPA ${LIBELLE}`));
      const proposition = proposeMatches(l, '2026-08-28', '2026-10-27').find((p) => p.operationId === 'op-av' && p.flowId === ORDRE);
      expect(proposition?.reasons).toContain('libellé reconnu');
      expect(proposition?.auto).toBe(true);
      const op = importer(l).operations.find((o) => o.id === 'op-av')!;
      expect(op.plannedFlowId).toBe(ORDRE);
      expect(op.transferAccountId).toBe(COMPTE);
      expect(matchTirelireTransfers(l).operations.find((o) => o.id === 'op-av')?.transferAccountId).toBe(COMPTE);
    });
  }

  it('le libellé finissant la ligne, sans rien après : reconnu aussi', () => {
    const l = avec(motifDeLOrdre(renomme(exampleLedger()), ANCIEN), ligne('op-av', LIBELLE));
    expect(proposeMatches(l, '2026-08-28', '2026-10-27').find((p) => p.operationId === 'op-av' && p.flowId === ORDRE)?.auto).toBe(true);
  });
});

describe('[niveau 4] #26 · 4. reconnu sans ordre', () => {
  it('vers un compte sans ordre, la ligne au libellé tiré de son nom est un virement vers lui, son montant non affecté', () => {
    const l = avec(renomme(sansOrdre(exampleLedger())), ligne('op-av', `VIR ${LIBELLE}`));
    const patch = matchTirelireTransfers(l);
    expect(patch.operations.find((o) => o.id === 'op-av')?.transferAccountId).toBe(COMPTE);
    expect(patch.subOperations).toEqual([]);
    const apres = importer(l);
    expect(apres.operations.find((o) => o.id === 'op-av')?.transferAccountId).toBe(COMPTE);
    expect(apres.subOperations.filter((s) => s.operationId === 'op-av')).toEqual([]);
  });
});

describe('[niveau 4] #26 · 5. une seule lecture du motif', () => {
  const op = ligne('op-av', `VIR ${LIBELLE}`);

  it('readLabelPattern retire les blancs d’extrémité, et rien d’autre', () => {
    expect(readLabelPattern(ANCIEN)).toBe(LIBELLE);
    expect(readLabelPattern(`  ${LIBELLE}\t`)).toBe(LIBELLE);
    expect(readLabelPattern('VIR  .*SALAIRE')).toBe('VIR  .*SALAIRE');
    expect(readLabelPattern('   ')).toBeUndefined();
    expect(readLabelPattern('')).toBeUndefined();
    expect(readLabelPattern(undefined)).toBeUndefined();
  });

  it('un automatisme au motif qui finit (ou commence) par un blanc retient la ligne qui le porte sans blanc', () => {
    expect(selects({ labelPattern: ANCIEN }, op)).toBe(true);
    expect(selects({ labelPattern: ` ${LIBELLE}` }, op)).toBe(true);
    expect(selects({ labelPattern: LIBELLE }, op)).toBe(true);
    expect(selects({ labelPattern: 'TIRELIRE AUTRE CHOSE ' }, op)).toBe(false);
  });

  it('un motif de blancs seuls sélectionne comme aucun motif', () => {
    expect(selects({ labelPattern: '   ' }, op)).toBe(selects({}, op));
  });

  it('un flux qui n’est pas un ordre lit son motif de la même façon', () => {
    const flux: PlannedFlow = {
      id: 'flow-assurance',
      name: 'Assurance',
      kind: 'fixedCharge',
      amount: euros(-80),
      accountId: PRINCIPAL,
      periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-15' },
      dateWindowDays: 3,
      amountTolerance: { pct: 20 },
      labelPattern: 'PRLV ASSUREUR ',
    };
    const l: Ledger = { ...exampleLedger(), plannedFlows: [flux], operations: [ligne('op-ass', 'PRLV ASSUREUR', euros(85), '2026-09-15')] };
    const p = proposeMatches(l, '2026-08-28', '2026-10-27').find((x) => x.flowId === flux.id);
    expect(p?.reasons).toContain('libellé reconnu');
    expect(p?.auto).toBe(true);
  });
});

describe('[niveau 4] #26 · 6. rien ne se réécrit', () => {
  it('calculer le plan, importer et rapprocher laissent le motif enregistré tel quel, blanc compris', () => {
    const l = avec(motifDeLOrdre(renomme(exampleLedger()), ANCIEN), ligne('op-av', `VIR ${LIBELLE}`));
    const avant = structuredClone(l.plannedFlows);
    computePlan(l, LECTURE);
    const apres = importer(l);
    expect(l.plannedFlows).toEqual(avant);
    expect(apres.plannedFlows).toEqual(avant);
    expect(apres.plannedFlows.find((f) => f.id === ORDRE)?.labelPattern).toBe(ANCIEN);
  });

  it('l’ordre que le plan propose de confirmer garde le motif enregistré : seule la validation l’écrit', () => {
    const l = motifDeLOrdre(renomme(exampleLedger()), ANCIEN);
    const plan = computePlan(l, LECTURE);
    const t = plan.transfers.find((x) => x.accountId === COMPTE)!;
    const ordre = l.plannedFlows.find((f) => f.id === ORDRE)!;
    expect(standingTransferFlow(plan, t, PRINCIPAL, 'x', euros(650), ordre)?.labelPattern).toBe(ANCIEN);
  });
});

describe('[niveau 4] #26 · 7. deux comptes au même libellé : écarté', () => {
  it('vers deux comptes sans ordre au même libellé, la ligne n’est reconnue vers aucun', () => {
    const base = renomme(sansOrdre(exampleLedger()));
    const l: Ledger = avec(
      { ...base, accounts: [...base.accounts, { id: 'acc-av-paul', name: 'Assurance vie de Simon et Paul', kind: 'epargne', openingBalance: 0, openingDate: '2026-08-27' }] },
      ligne('op-av', `VIR ${LIBELLE}`),
    );
    expect(transferLabel('Assurance vie de Simon et Paul')).toBe(LIBELLE);
    expect(matchTirelireTransfers(l).operations.find((o) => o.id === 'op-av')).toBeUndefined();
  });
});
