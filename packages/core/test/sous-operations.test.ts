/**
 * Tests du codeur de #297 — « Une opération contient des sous-opérations, sur autant de niveaux
 * qu'on veut ». Tous de niveau 4 (D83) : l'auditeur choisit parmi eux le harnais.
 *
 * Chaque `describe` reprend un point du « Fait quand » sous son numéro. Les calculs se lisent par ce
 * que l'application appelle : `indexLedger` et les soldes de `balances.ts`, `reviewCategories` et
 * `reviewReplenishments`, `computePlan`, `editDivision`, `applyAutomations`, `applyBulkAction`, le
 * dépôt (`LedgerStore`) et la synchronisation (`runSync`, `exportBundle`, `importBundle`).
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import {
  FormatRefused,
  LedgerStore,
  alive,
  applyAutomations,
  applyBulkAction,
  applyPatchToLedger,
  budgetPeriodContaining,
  computePlan,
  countedLines,
  editDivision,
  EditError,
  euros,
  exampleLedger,
  exportBundle,
  importBundle,
  indexLedger,
  liveSubOperations,
  memoryTransportPair,
  reviewCategories,
  reviewReplenishments,
  runSync,
  tirelireBalance,
  tirelireComponents,
  unallocated,
  unlock,
  type Ledger,
  type Operation,
  type Share,
  type SubOperation,
} from '../src/index.js';

const SQL = await initSqlJs();
const LECTURE = '2026-09-06';
const PRINCIPAL = 'acc-principal';
const VACANCES = 'env-vac';
const RESTAURANT = 'cat-resto';

const fixe = (e: number): Share => ({ kind: 'fixed', amount: euros(e) });
const variable: Share = { kind: 'variable' };
const pct = (p: number): Share => ({ kind: 'percent', pct: p });

function sub(id: string, operationId: string, share: Share, more: Partial<SubOperation> = {}): SubOperation {
  return { id, operationId, share, ...more };
}

function operation(id: string, amount: number, more: Partial<Operation> = {}): Operation {
  return {
    id,
    accountId: PRINCIPAL,
    origin: 'manual',
    date: '2026-09-03',
    label: 'DEPENSE',
    normalizedLabel: 'DEPENSE',
    amount: euros(amount),
    state: 'locked',
    ...more,
  };
}

/** L'exemple, avec une catégorie « Restaurant ». */
function base(): Ledger {
  const l = exampleLedger();
  l.categories.push({ id: RESTAURANT, name: 'Restaurant', nature: 'expense' });
  return l;
}

/**
 * L'exemple du point 3 : une dépense de 100 € sur le compte courant, divisée en 60 € sur
 * « Vacances » et 40 € sans tirelire, les 60 € divisés à leur tour en 20 € « Restaurant » et
 * 40 € sans catégorie.
 */
function exempleDuPoint3(more: Partial<Operation> = {}): { ledger: Ledger; op: Operation } {
  const ledger = base();
  const op = operation('op-297', -100, more);
  ledger.operations.push(op);
  ledger.subOperations.push(
    sub('s-vac', op.id, fixe(-60), { tirelireId: VACANCES }),
    sub('s-reste', op.id, variable),
    sub('s-resto', op.id, fixe(-20), { parentId: 's-vac', categoryId: RESTAURANT }),
    sub('s-sans', op.id, variable, { parentId: 's-vac' }),
  );
  return { ledger, op };
}

function sansOperation(ledger: Ledger, opId: string): Ledger {
  return { ...ledger, operations: ledger.operations.filter((o) => o.id !== opId), subOperations: ledger.subOperations.filter((s) => s.operationId !== opId) };
}

function solde(ledger: Ledger, tirelireId: string, asOf = LECTURE): number {
  const idx = indexLedger(ledger);
  return tirelireBalance(idx.tireliresById.get(tirelireId)!, idx, asOf);
}

function nonAffecte(ledger: Ledger, accountId: string, asOf = LECTURE): number {
  const idx = indexLedger(ledger);
  return unallocated(idx.accountsById.get(accountId)!, ledger, idx, asOf);
}

function lignes(ledger: Ledger, opId: string) {
  const idx = indexLedger(ledger);
  return idx.linesByOperation.get(opId) ?? [];
}

describe('[niveau 4] #297 · 1. une opération se divise, et toute sous-opération à son tour', () => {
  it('trois niveaux : pourcentage du niveau qui contient, part variable par division, somme au centime', () => {
    const ledger = base();
    const op = operation('op-1', -200);
    ledger.operations.push(op);
    ledger.subOperations.push(
      sub('a', op.id, fixe(-50)),
      sub('b', op.id, variable),
      sub('c', op.id, pct(10), { parentId: 'b' }),
      sub('d', op.id, variable, { parentId: 'b' }),
      sub('e', op.id, pct(50), { parentId: 'd' }),
      sub('f', op.id, variable, { parentId: 'd' }),
    );
    const parLigne = new Map(lignes(ledger, op.id).map((l) => [l.id, l.amount]));
    // b = 150 ; c = 10 % de 150 ; d = 135 ; e = 50 % de 135, arrondi au centime ; f le reste.
    expect(Object.fromEntries(parLigne)).toEqual({ a: euros(-50), c: euros(-15), e: -6750, f: -6750 });
    expect([...parLigne.values()].reduce((s, x) => s + x, 0)).toBe(op.amount);
  });

  it('la part variable d’une division ne devient jamais négative, et une seule compte', () => {
    const { ledger, op } = exempleDuPoint3();
    ledger.subOperations.push(sub('s-trop', op.id, fixe(-70), { parentId: 's-vac' }), sub('s-var2', op.id, variable, { parentId: 's-vac' }));
    const l = lignes(ledger, op.id);
    expect(l.find((x) => x.id === 's-sans')!.amount).toBe(0);
    expect(l.find((x) => x.id === 's-var2')!.amount).toBe(0);
    // Ce qui dépasse reste visible : la somme des lignes est toujours le montant de l'opération.
    expect(l.reduce((s, x) => s + x.amount, 0)).toBe(op.amount);
  });

  it('l’édition refuse, à tout niveau, deux parts variables et des parts qui dépassent le niveau divisé', () => {
    const { ledger, op } = exempleDuPoint3();
    expect(() => editDivision(ledger, op.id, [{ share: variable }, { share: variable }], {}, 's-vac')).toThrow(EditError);
    expect(() => editDivision(ledger, op.id, [{ share: fixe(-61) }], {}, 's-vac')).toThrow(EditError);
    expect(() => editDivision(ledger, op.id, [{ share: fixe(-60) }], {}, 's-vac')).not.toThrow();
    expect(() => editDivision(ledger, op.id, [{ share: fixe(-10) }], {}, 'inconnue')).toThrow(EditError);
  });
});

describe('[niveau 4] #297 · 2. ce qu’une sous-opération ne porte pas, elle le prend du niveau qui la contient', () => {
  it('catégorie, tirelire et renflouement se prennent de proche en proche ; un niveau plus bas pose le sien', () => {
    const ledger = base();
    const op = operation('op-2', 100);
    ledger.operations.push(op);
    ledger.subOperations.push(
      sub('h', op.id, variable, { tirelireId: VACANCES, categoryId: 'cat-alloc', replenishment: 'external' }),
      sub('h1', op.id, fixe(30), { parentId: 'h' }),
      sub('h2', op.id, variable, { parentId: 'h', categoryId: 'cat-salaire', tirelireId: 'env-auto' }),
      sub('h21', op.id, fixe(10), { parentId: 'h2' }),
      sub('h22', op.id, variable, { parentId: 'h2', categoryId: 'cat-loyer' }),
    );
    const vu = Object.fromEntries(lignes(ledger, op.id).map((l) => [l.id, [l.amount, l.categoryId, l.tirelireId, l.replenishment]]));
    expect(vu).toEqual({
      h1: [euros(30), 'cat-alloc', VACANCES, 'external'],
      h21: [euros(10), 'cat-salaire', 'env-auto', 'external'],
      h22: [euros(60), 'cat-loyer', 'env-auto', 'external'],
    });
  });

  it('le reste d’une division que ses parts ne couvrent pas garde ce qui vaut pour le niveau divisé', () => {
    const { ledger, op } = exempleDuPoint3();
    ledger.subOperations = ledger.subOperations.filter((s) => s.id !== 's-sans');
    const reste = lignes(ledger, op.id).find((l) => !l.subOperationId)!;
    expect([reste.amount, reste.tirelireId, reste.categoryId]).toEqual([euros(-40), VACANCES, undefined]);
    expect(solde(ledger, VACANCES) - solde(sansOperation(ledger, op.id), VACANCES)).toBe(euros(-60));
  });
});

describe('[niveau 4] #297 · 3. tout ce qui lit la ventilation la lit à tous les niveaux, sans compter deux fois', () => {
  it('l’exemple de l’issue : « Vacances » −60, non affecté −40, « Restaurant » 20, 80 € sans catégorie', () => {
    const { ledger, op } = exempleDuPoint3();
    const avant = sansOperation(ledger, op.id);
    expect(solde(ledger, VACANCES) - solde(avant, VACANCES)).toBe(euros(-60));
    expect(nonAffecte(ledger, PRINCIPAL) - nonAffecte(avant, PRINCIPAL)).toBe(euros(-40));
    const l = lignes(ledger, op.id);
    expect(l.filter((x) => x.categoryId === RESTAURANT).reduce((s, x) => s + x.amount, 0)).toBe(euros(-20));
    expect(l.filter((x) => !x.categoryId).reduce((s, x) => s + x.amount, 0)).toBe(euros(-80));
    expect(l.reduce((s, x) => s + x.amount, 0)).toBe(op.amount);
    const periode = budgetPeriodContaining(op.date, ledger.settings.periodStartDay);
    const resto = reviewCategories(ledger, [periode]).find((r) => r.categoryId === RESTAURANT)!;
    expect(resto.periods[0]!.spent).toBe(euros(20));
  });

  it('la composante sort là où la dépense sort : le compte égale ses tirelires plus son non affecté (I2)', () => {
    const { ledger, op } = exempleDuPoint3();
    const idx = indexLedger(ledger);
    const vac = idx.tireliresById.get(VACANCES)!;
    const avantIdx = indexLedger(sansOperation(ledger, op.id));
    expect((tirelireComponents(vac, idx, LECTURE).get(PRINCIPAL) ?? 0) - (tirelireComponents(vac, avantIdx, LECTURE).get(PRINCIPAL) ?? 0)).toBe(euros(-60));
  });

  it('un virement interne divisé déplace la composante sans changer le solde de la tirelire', () => {
    const { ledger, op } = exempleDuPoint3({ transferAccountId: 'acc-livret' });
    const avant = sansOperation(ledger, op.id);
    expect(solde(ledger, VACANCES)).toBe(solde(avant, VACANCES));
    const idx = indexLedger(ledger);
    const avantIdx = indexLedger(avant);
    const vac = idx.tireliresById.get(VACANCES)!;
    const ecart = (compte: string) => (tirelireComponents(vac, idx, LECTURE).get(compte) ?? 0) - (tirelireComponents(vac, avantIdx, LECTURE).get(compte) ?? 0);
    expect([ecart(PRINCIPAL), ecart('acc-livret')]).toEqual([euros(-60), euros(60)]);
  });

  it('un renflouement posé à un niveau compte pour ce qu’il contient, et sort des moyennes', () => {
    const ledger = base();
    const op = operation('op-renfl', 100);
    ledger.operations.push(op);
    ledger.subOperations.push(
      sub('r', op.id, fixe(50), { tirelireId: VACANCES, replenishment: 'external' }),
      sub('r-reste', op.id, variable, { categoryId: 'cat-alloc' }),
      sub('r1', op.id, fixe(30), { parentId: 'r', categoryId: 'cat-salaire' }),
      sub('r2', op.id, variable, { parentId: 'r' }),
    );
    const periode = budgetPeriodContaining(op.date, ledger.settings.periodStartDay);
    const r = reviewReplenishments(ledger, [periode]).find((x) => x.tirelireId === VACANCES)!;
    expect([r.total, r.fromOutside]).toEqual([euros(50), euros(50)]);
    const sansRenfl = reviewCategories(sansOperation(ledger, op.id), [periode]);
    const avec = reviewCategories(ledger, [periode]);
    const recu = (rv: typeof avec, id: string) => rv.find((x) => x.categoryId === id)?.periods[0]!.spent ?? 0;
    expect(recu(avec, 'cat-salaire') - recu(sansRenfl, 'cat-salaire')).toBe(0);
    expect(recu(avec, 'cat-alloc') - recu(sansRenfl, 'cat-alloc')).toBe(euros(50));
  });

  it('le solde prévu d’une période à venir lit une saisie future divisée (D52)', () => {
    const { ledger, op } = exempleDuPoint3({ date: '2026-10-05' });
    const prevu = (l: Ledger) => computePlan(l, '2026-10-10', LECTURE).forecast!.tirelires.find((t) => t.id === VACANCES)!.end;
    expect(prevu(ledger) - prevu(sansOperation(ledger, op.id))).toBe(euros(-60));
  });
});

describe('[niveau 4] #297 · 4. une ventilation d’un seul niveau donne ce qu’elle donnait', () => {
  it('un niveau : les lignes comptées sont les lignes de ventilation, au centime', () => {
    const ledger = base();
    const op = operation('op-4', -100);
    ledger.operations.push(op);
    ledger.subOperations.push(sub('x', op.id, pct(30), { categoryId: RESTAURANT }), sub('y', op.id, fixe(-50), { tirelireId: VACANCES }));
    // Sans part variable, le reste de l'opération, sans rien qui vaille pour lui, est son non affecté.
    expect(countedLines(op, ledger.subOperations).map((l) => [l.id, l.amount, l.categoryId, l.tirelireId])).toEqual([
      ['x', euros(-30), RESTAURANT, undefined],
      ['y', euros(-50), undefined, VACANCES],
      [`${op.id}:reste`, euros(-20), undefined, undefined],
    ]);
  });
});

describe('[niveau 4] #297 · 5. une règle remplace la ventilation à tous ses niveaux ; une opération verrouillée garde les siens', () => {
  function avecRegle(state: Operation['state']): { ledger: Ledger; op: Operation } {
    const { ledger, op } = exempleDuPoint3({ origin: 'imported', label: 'RESTO PLAGE', normalizedLabel: 'RESTO PLAGE', state });
    ledger.automations.push({ id: 'r-resto', selection: { labelPattern: 'RESTO' }, action: { categoryId: RESTAURANT, state: 'reconcile' }, rank: 'm' });
    return { ledger, op };
  }

  it('une règle réécrit une seule division, et ce qu’elle contenait disparaît', () => {
    const { ledger, op } = avecRegle('untreated');
    const apres = applyPatchToLedger(ledger, applyAutomations(ledger));
    const vivantes = liveSubOperations(apres.subOperations).filter((s) => s.operationId === op.id);
    expect(vivantes.map((s) => [s.parentId, s.categoryId, s.share.kind])).toEqual([[undefined, RESTAURANT, 'variable']]);
  });

  it('une opération verrouillée garde tous ses niveaux', () => {
    const { ledger, op } = avecRegle('locked');
    const patch = applyAutomations(ledger);
    expect(patch.operations.find((o) => o.id === op.id)).toBeUndefined();
    expect(patch.subOperations.filter((s) => s.operationId === op.id)).toEqual([]);
  });

  it('une action groupée remplace aussi tous les niveaux', () => {
    const { ledger, op } = avecRegle('locked');
    const apres = applyPatchToLedger(ledger, applyBulkAction(ledger, [op.id], { categoryId: RESTAURANT }));
    expect(liveSubOperations(apres.subOperations).filter((s) => s.operationId === op.id).map((s) => s.parentId)).toEqual([undefined]);
  });

  it('déverrouillée, une opération divisée à la main est reprise par la règle', () => {
    const { ledger, op } = avecRegle('locked');
    const l = applyPatchToLedger(ledger, { operations: [unlock(op)], subOperations: [] });
    const apres = applyPatchToLedger(l, applyAutomations(l));
    expect(liveSubOperations(apres.subOperations).filter((s) => s.operationId === op.id)).toHaveLength(1);
  });
});

describe('[niveau 4] #297 · 6. modifier un niveau garde ce que contiennent les autres', () => {
  it('modifier la division de l’opération garde ce que contient une sous-opération gardée, et n’écrit que ce qui change', () => {
    const { ledger, op } = exempleDuPoint3();
    const patch = editDivision(ledger, op.id, [
      { id: 's-vac', tirelireId: VACANCES, share: fixe(-70) },
      { id: 's-reste', share: variable },
    ]);
    expect(patch.subOperations.map((s) => s.id)).toEqual(['s-vac']);
    expect(patch.removedSubOperations).toEqual([]);
    const apres = applyPatchToLedger(ledger, patch);
    expect(Object.fromEntries(lignes(apres, op.id).map((l) => [l.id, l.amount]))).toEqual({ 's-resto': euros(-20), 's-sans': euros(-50), 's-reste': euros(-30) });
  });

  it('modifier un niveau plus bas n’écrit aucune sous-opération du niveau au-dessus', () => {
    const { ledger, op } = exempleDuPoint3();
    const patch = editDivision(ledger, op.id, [{ id: 's-resto', categoryId: RESTAURANT, share: fixe(-25) }, { id: 's-sans', share: variable }], {}, 's-vac');
    expect(patch.subOperations.map((s) => [s.id, s.parentId])).toEqual([['s-resto', 's-vac']]);
    expect(patch.operations.map((o) => o.state)).toEqual(['locked']);
  });

  it('retirer une sous-opération retire ce qu’elle contient', () => {
    const { ledger, op } = exempleDuPoint3();
    const patch = editDivision(ledger, op.id, [{ id: 's-reste', share: variable }]);
    expect([...patch.removedSubOperations!].sort()).toEqual(['s-resto', 's-sans', 's-vac']);
    const apres = applyPatchToLedger(ledger, patch);
    expect(lignes(apres, op.id).map((l) => [l.id, l.amount])).toEqual([['s-reste', op.amount]]);
  });
});

describe('[niveau 4] #297 · 7. les sous-opérations se sauvegardent, se restaurent et se synchronisent', () => {
  async function instance(site: string): Promise<LedgerStore> {
    const s = await LedgerStore.create({ sqlJs: SQL, siteId: site });
    const { ledger, op } = exempleDuPoint3();
    for (const a of alive(ledger.accounts)) s.upsert('accounts', a);
    for (const e of ledger.tirelires) s.upsert('tirelires', e);
    for (const c of ledger.categories) s.upsert('categories', c);
    s.upsert('operations', op);
    for (const x of ledger.subOperations.filter((y) => y.operationId === op.id)) s.upsert('subOperations', x);
    return s;
  }

  function ecrire(store: LedgerStore, patch: ReturnType<typeof editDivision>): void {
    for (const o of patch.operations) store.upsert('operations', o);
    for (const a of patch.subOperations) store.upsert('subOperations', a);
    for (const id of patch.removedSubOperations ?? []) store.remove('subOperations', id);
  }

  async function synchroniser(a: LedgerStore, b: LedgerStore) {
    const [ta, tb] = memoryTransportPair();
    const [ra, rb] = await Promise.all([runSync(a, ta), runSync(b, tb)]);
    return [...ra.conflicts, ...rb.conflicts];
  }

  const vivantes = (s: LedgerStore) =>
    liveSubOperations(s.load().subOperations)
      .map((x) => JSON.stringify(x))
      .sort();

  it('un fichier sauvegardé se restaure avec tous les niveaux', async () => {
    const a = await instance('A');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B', bytes: a.export() });
    expect(b.load().subOperations.map((x) => [x.id, x.parentId]).sort()).toEqual([
      ['s-reste', undefined],
      ['s-resto', 's-vac'],
      ['s-sans', 's-vac'],
      ['s-vac', undefined],
    ]);
    expect(lignes(b.load(), 'op-297')).toEqual(lignes(a.load(), 'op-297'));
  });

  it('deux instances qui modifient deux niveaux différents d’une même opération convergent, sans conflit', async () => {
    const a = await instance('A');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    expect(await synchroniser(a, b)).toEqual([]);
    ecrire(a, editDivision(a.load(), 'op-297', [{ id: 's-vac', tirelireId: VACANCES, categoryId: RESTAURANT, share: fixe(-70) }, { id: 's-reste', share: variable }]));
    ecrire(b, editDivision(b.load(), 'op-297', [{ id: 's-resto', categoryId: RESTAURANT, share: fixe(-25) }, { id: 's-sans', share: variable }], {}, 's-vac'));
    expect(await synchroniser(a, b)).toEqual([]);
    expect(vivantes(a)).toEqual(vivantes(b));
    expect(Object.fromEntries(lignes(a.load(), 'op-297').map((l) => [l.id, l.amount]))).toEqual({ 's-resto': euros(-25), 's-sans': euros(-45), 's-reste': euros(-30) });
  });

  it('après synchronisation, aucune sous-opération ne reste sans le niveau qui la contient', async () => {
    const a = await instance('A');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    await synchroniser(a, b);
    // A retire « Vacances » et ce qu'elle contient ; B, sans le savoir, la divise davantage.
    ecrire(a, editDivision(a.load(), 'op-297', [{ id: 's-reste', share: variable }]));
    ecrire(b, editDivision(b.load(), 'op-297', [{ id: 's-resto', categoryId: RESTAURANT, share: fixe(-20) }, { id: 's-sans', share: fixe(-30) }, { id: 's-neuve', share: variable }], {}, 's-vac'));
    const conflits = await synchroniser(a, b);
    // La seule ligne modifiée des deux côtés est celle que B a réécrite et que A a retirée (D58).
    expect(conflits.map((c) => c.rowId).sort()).toEqual(['s-sans', 's-sans']);
    expect(await synchroniser(a, b)).toEqual([]);
    for (const s of [a, b]) {
      const lues = alive(s.load().subOperations);
      const ids = new Set(lues.map((x) => x.id));
      expect(lues.filter((x) => x.parentId && !ids.has(x.parentId))).toEqual([]);
      expect(lignes(s.load(), 'op-297').map((l) => [l.id, l.amount])).toEqual([['s-reste', euros(-100)]]);
    }
    expect(vivantes(a)).toEqual(vivantes(b));
  });

  it('un paquet par fichier porte tous les niveaux', async () => {
    const a = await instance('A');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    importBundle(b, exportBundle(a));
    expect(vivantes(b)).toEqual(vivantes(a));
  });
});

describe('[niveau 4] #297 · 8. le format change de version : la précédente est refusée en le disant', () => {
  it('un fichier de la version précédente est refusé, sans rien ouvrir ni écrire', async () => {
    const a = await LedgerStore.create({ sqlJs: SQL, siteId: 'A' });
    const db = new SQL.Database(a.export());
    db.run(`UPDATE meta SET value = '3' WHERE key = 'format_version'`);
    const avant = db.export();
    db.close();
    const copie = avant.slice();
    await expect(LedgerStore.create({ sqlJs: SQL, siteId: 'A', bytes: avant })).rejects.toBeInstanceOf(FormatRefused);
    expect(Buffer.from(avant).equals(Buffer.from(copie))).toBe(true);
  });

  it('un paquet de la version précédente est refusé, sans rien écrire', async () => {
    const a = await LedgerStore.create({ sqlJs: SQL, siteId: 'A' });
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    a.upsert('categories', { id: RESTAURANT, name: 'Restaurant', nature: 'expense' });
    const avant = Buffer.from(b.export());
    expect(() => importBundle(b, { ...exportBundle(a), version: 3 })).toThrow(/version antérieure/);
    expect(b.load().categories.find((c) => c.id === RESTAURANT)).toBeUndefined();
    expect(Buffer.from(b.export()).equals(avant)).toBe(true);
  });
});
