import { describe, expect, it } from 'vitest';
import {
  applyTemplate,
  classify,
  classifySelection,
  euros,
  evaluate,
  exampleLedger,
  normalizeLabel,
  parseQuery,
  recallByLabel,
  searchOperations,
  suggestAllocation,
  suggestPending,
  templateOf,
  trainClassifier,
  type Allocation,
  type Ledger,
  type Operation,
} from '../src/index.js';

let seq = 0;
function op(l: Ledger, label: string, amount: number, date: string, extra: Partial<Operation> = {}): Operation {
  const o: Operation = {
    id: `op-${++seq}`,
    accountId: 'acc-pivot',
    origin: 'imported',
    date,
    label,
    normalizedLabel: normalizeLabel(label),
    amount: euros(amount),
    status: 'pending',
    ...extra,
  };
  l.operations.push(o);
  return o;
}

function classified(l: Ledger, label: string, amount: number, date: string, lines: [string | undefined, string | undefined, number?][], extra: Partial<Operation> = {}): Operation {
  const o = op(l, label, amount, date, { status: 'categorized', ...extra });
  let remaining = o.amount;
  lines.forEach(([categoryId, envelopeId, share], i) => {
    const amt = i === lines.length - 1 ? remaining : Math.round(o.amount * (share ?? 1));
    remaining -= amt;
    const a: Allocation = { id: `al-${o.id}-${i}`, operationId: o.id, amount: amt, ...(categoryId ? { categoryId } : {}), ...(envelopeId ? { envelopeId } : {}) };
    l.allocations.push(a);
  });
  return o;
}

/** Un historique inventé : courses, essence, pharmacie, salaire, un loyer ventilé. */
function history(): Ledger {
  const l = exampleLedger();
  l.operations = [];
  l.allocations = [];
  const months = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
  months.forEach((m, i) => {
    classified(l, `CARTE X1234 ${String(10 + i).padStart(2, '0')}/0${(i % 9) + 1} CARREFOUR MARKET VILLEJUIF`, -(60 + i * 7), `${m}-12`, [['cat-alim', 'env-alim']]);
    classified(l, `CARTE X1234 CARREFOUR DRIVE`, -(90 + i * 3), `${m}-20`, [['cat-alim', 'env-alim']]);
    classified(l, `CARTE X1234 TOTALENERGIES RELAIS A6`, -(55 + i), `${m}-05`, [[undefined, 'env-essence']]);
    classified(l, `CARTE X1234 PHARMACIE DU CENTRE`, -(12 + i), `${m}-15`, [['cat-sante', 'env-sante']]);
    classified(l, `VIR SEPA RECU EMPLOYEUR SAS SALAIRE`, 2650, `${m}-28`, [['cat-salaire', undefined]]);
    // Loyer perçu ventilé : 800 dont 100 de charges → 7/8 loyer, 1/8 logement (charges à reverser)
    classified(l, `VIR SEPA RECU LOCATAIRE DUPONT LOYER`, 800, `${m}-03`, [['cat-loyer', undefined, 0.875], ['cat-logement', undefined]]);
  });
  return l;
}

describe('gabarits de ventilation', () => {
  it('une opération simple donne un gabarit à une ligne, une ventilée des parts qui somment à 1', () => {
    const l = history();
    const loyer = l.operations.find((o) => o.label.includes('LOYER'))!;
    const t = templateOf(loyer, l.allocations.filter((a) => a.operationId === loyer.id))!;
    expect(t.map((x) => x.share)).toEqual([0.125, 0.875]);
    const applied = applyTemplate({ ...loyer, id: 'x', amount: euros(810) }, t);
    expect(applied.reduce((s, a) => s + a.amount, 0)).toBe(euros(810));
    expect(applied.find((a) => a.categoryId === 'cat-loyer')!.amount).toBe(euros(708.75));
  });
});

describe('recherche structurée', () => {
  it('analyse termes, exclusions, bornes et signe', () => {
    expect(parseQuery('carrefour market -drive >20 <150 -')).toEqual({ terms: ['carrefour', 'market'], excluded: ['drive'], minAmount: 2000, maxAmount: 15000, sign: 'debit' });
    expect(parseQuery('"vir sepa recu" +')).toEqual({ terms: ['vir sepa recu'], sign: 'credit' });
  });

  it('filtre sans accent ni casse, sur libellé et détails', () => {
    const l = history();
    op(l, 'CARTE X1234 BOULANGERIE PÂTISSERIE', -4.5, '2026-09-01', { details: 'Achat du 01/09' });
    expect(searchOperations(l, parseQuery('patisserie')).length).toBe(1);
    expect(searchOperations(l, parseQuery('carrefour -drive')).length).toBe(6);
    expect(searchOperations(l, parseQuery('carrefour <70'))).toHaveLength(2);
  });

  it('classe toute la sélection avec le même gabarit et remplace les anciennes lignes', () => {
    const l = history();
    op(l, 'CARTE X1234 LIDL', -32, '2026-09-02');
    op(l, 'CARTE X1234 LIDL', -48, '2026-09-04');
    const sel = searchOperations(l, parseQuery('lidl'));
    const patch = classifySelection(l, sel, [{ categoryId: 'cat-alim', envelopeId: 'env-alim', share: 1 }]);
    expect(patch.operations.every((o) => o.status === 'categorized')).toBe(true);
    expect(patch.allocations.filter((a) => !a.deletedAt).map((a) => a.amount)).toEqual([euros(-32), euros(-48)]);
    // Reclasser une opération déjà ventilée marque l'ancienne ligne supprimée.
    const loyer = l.operations.find((o) => o.label.includes('LOYER'))!;
    const p2 = classifySelection(l, [loyer], [{ categoryId: 'cat-loyer', share: 1 }]);
    expect(p2.allocations.filter((a) => a.deletedAt)).toHaveLength(2);
    expect(p2.allocations.filter((a) => !a.deletedAt)).toHaveLength(1);
    expect(p2.operations).toHaveLength(0);
  });
});

describe('mémoire des libellés', () => {
  it('retrouve la ventilation d’un libellé déjà vu, même ventilée en plusieurs lignes', () => {
    const l = history();
    const next = op(l, 'VIR SEPA RECU LOCATAIRE DUPONT LOYER', 800, '2026-09-03');
    const t = recallByLabel(l, next)!;
    expect(t.map((x) => x.categoryId)).toEqual(['cat-logement', 'cat-loyer']);
  });

  it('ignore un libellé connu dans l’autre sens et un libellé inconnu', () => {
    const l = history();
    expect(recallByLabel(l, op(l, 'VIR SEPA RECU LOCATAIRE DUPONT LOYER', -800, '2026-09-03'))).toBeUndefined();
    expect(recallByLabel(l, op(l, 'CARTE X1234 IKEA', -120, '2026-09-03'))).toBeUndefined();
  });
});

describe('Bayes naïf', () => {
  it('généralise à un libellé nouveau à partir des mots communs', () => {
    const l = history();
    const model = trainClassifier(l);
    const nouveau = op(l, 'CARTE X1234 CARREFOUR CITY PARIS 13', -23, '2026-09-05');
    const [best] = classify(model, nouveau);
    expect(best!.template[0]!.envelopeId).toBe('env-alim');
    expect(best!.probability).toBeGreaterThan(0.8);
    const s = suggestAllocation(l, model, nouveau)!;
    expect(s.source).toBe('bayes');
    expect(s.allocations[0]!.amount).toBe(euros(-23));
  });

  it('se tait quand rien ne ressemble', () => {
    const l = history();
    const model = trainClassifier(l);
    const inconnu = op(l, 'CARTE X1234 IKEA VILLIERS', -340, '2026-09-05');
    expect(suggestAllocation(l, model, inconnu)).toBeUndefined();
  });

  it('la catégorie suggérée par la source pèse même sans mot connu', () => {
    const l = history();
    for (let i = 0; i < 4; i++) classified(l, `CARTE X1234 MARCHAND ${i}`, -20, `2026-0${5 + i}-10`, [['cat-sante', 'env-sante']], { suggestedCategory: 'Santé' });
    const model = trainClassifier(l);
    const s = suggestAllocation(l, model, op(l, 'CARTE X1234 OPTIQUE LEROY', -90, '2026-09-06', { suggestedCategory: 'Santé' }));
    expect(s?.template[0]!.categoryId).toBe('cat-sante');
  });

  it('propose pour les opérations en attente et distingue mémoire et Bayes', () => {
    const l = history();
    op(l, 'CARTE X1234 CARREFOUR DRIVE', -101, '2026-09-20');
    op(l, 'CARTE X1234 TOTALENERGIES RELAIS A10', -58, '2026-09-05');
    op(l, 'CARTE X1234 IKEA VILLIERS', -340, '2026-09-05');
    const sugg = suggestPending(l);
    expect(sugg.map((s) => s.source).sort()).toEqual(['bayes', 'memoire']);
  });
});

describe('évaluation un contre tous', () => {
  it('mesure ce qui aurait été retrouvé, proposé juste ou faux, ou laissé à la main', () => {
    const l = history();
    const ev = evaluate(l);
    expect(ev.examples).toBe(36);
    // Chaque libellé revient cinq fois sans lui-même : tout est retrouvé par la mémoire.
    expect(ev.recalled).toBe(36);
    expect(ev.recalledCorrect).toBe(36);
    expect(ev.proposed + ev.silent).toBe(0);
  });

  it('un libellé vu une seule fois n’est pas retrouvé mais peut être proposé', () => {
    const l = history();
    classified(l, 'CARTE X1234 CARREFOUR CITY', -18, '2026-08-30', [['cat-alim', 'env-alim']]);
    const ev = evaluate(l);
    expect(ev.recalled).toBe(36);
    expect(ev.proposed).toBe(1);
    expect(ev.proposedCorrect).toBe(1);
  });
});
