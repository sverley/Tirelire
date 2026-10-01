/**
 * Harnais d'audit de #297 — « Une opération contient des sous-opérations, sur autant de niveaux
 * qu'on veut ». Côté cœur ; ce que les écrans Opérations et Saisie en font (point 6) est gardé par le
 * second fichier du harnais, `apps/web/test/navigateur/sous-operations-harnais.test.ts`.
 *
 * Composé après le codage (auditeur.md, étape 2) : pour chaque phrase du « Fait quand » qu'un test
 * tranche, le test du codeur quand il la tranche — repris de `sous-operations.test.ts`, qui garde
 * les siens non retenus, au niveau 4 —, sinon le mien. Sont de moi : la ventilation d'un seul niveau
 * comparée à l'ancien calcul (point 4) ; la conservation de chaque euro, à tous les niveaux et dans
 * tous les lecteurs, sur des arbres tirés au hasard (point 3, I2) ; le bilan qui ne compte pas deux
 * fois un niveau qui porte une catégorie ; le solde à régler d'un compte tiers, lecteur de la
 * ventilation que le « Fait quand » ne nommait pas (ajouté à l'issue) ; le rapprochement de flux ; un
 * niveau retiré avant toute synchronisation ; l'absence de toute table de l'ancien format (D30).
 *
 * Chaque `describe` reprend un point du « Fait quand » sous son numéro. Le point 9, la
 * documentation, est relu.
 *
 * Niveaux (D83), par le besoin que couvre chaque test :
 * - 0 · l'irréparable : un fichier sauvegardé qui se restaure avec tous ses niveaux ; une règle qui
 *   ne réécrit jamais ce que l'utilisateur a verrouillé (D22) ; modifier un niveau ne perd rien de ce
 *   que contiennent les autres ; un fichier du format précédent refusé sans être ouvert ni écrit.
 * - 1 · une promesse tombe : I2 à tous les niveaux, tel qu'il est écrit ; I8, deux instances qui
 *   modifient deux niveaux d'une même opération convergent, sans qu'aucune sous-opération reste sans
 *   le niveau qui la contient, et l'échange par fichier ; C8, un paquet du format précédent refusé.
 * - 2 · un cas est faux : les règles de D27 à chaque niveau, l'héritage, le calcul de chaque lecteur,
 *   ce que les règles et le rapprochement de flux écrivent.
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import {
  FormatRefused,
  LedgerStore,
  accountBalance,
  alive,
  applyAutomations,
  applyMatch,
  applyPatchToLedger,
  budgetPeriodContaining,
  computePlan,
  componentsOnAccount,
  editDivision,
  EditError,
  emptyLedger,
  euros,
  exampleLedger,
  exportBundle,
  importBundle,
  indexLedger,
  liveSubOperations,
  memoryTransportPair,
  proposeMatches,
  resolveShares,
  reviewCategories,
  reviewReplenishments,
  runSync,
  settlementBalance,
  tirelireBalance,
  tirelireComponents,
  unallocated,
  unallocatedAmount,
  type Account,
  type Ledger,
  type Operation,
  type Share,
  type SubOperation,
  type Tirelire,
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

/** Hasard déterministe (mulberry32) : les cas tirés sont toujours les mêmes. */
function alea(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('#297 · 1. une opération se divise, et toute sous-opération à son tour', () => {
  it('[niveau 2] trois niveaux : pourcentage du niveau qui contient, part variable par division, somme au centime', () => {
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
    // b = 150 ; c = 10 % de 150 ; d = 135 ; e = 50 % de 135 ; f le reste.
    expect(Object.fromEntries(parLigne)).toEqual({ a: euros(-50), c: euros(-15), e: -6750, f: -6750 });
    expect([...parLigne.values()].reduce((s, x) => s + x, 0)).toBe(op.amount);
  });

  it('[niveau 2] la part variable d’une division ne devient jamais négative, et une seule compte', () => {
    const { ledger, op } = exempleDuPoint3();
    ledger.subOperations.push(sub('s-trop', op.id, fixe(-70), { parentId: 's-vac' }), sub('s-var2', op.id, variable, { parentId: 's-vac' }));
    const l = lignes(ledger, op.id);
    expect(l.find((x) => x.id === 's-sans')!.amount).toBe(0);
    expect(l.find((x) => x.id === 's-var2')!.amount).toBe(0);
    // Ce qui dépasse reste visible : la somme des lignes est toujours le montant de l'opération.
    expect(l.reduce((s, x) => s + x.amount, 0)).toBe(op.amount);
  });

  it('[niveau 2] l’édition refuse, à tout niveau, deux parts variables et des parts qui dépassent le niveau divisé', () => {
    const { ledger, op } = exempleDuPoint3();
    expect(() => editDivision(ledger, op.id, [{ share: variable }, { share: variable }], {}, 's-vac')).toThrow(EditError);
    expect(() => editDivision(ledger, op.id, [{ share: fixe(-61) }], {}, 's-vac')).toThrow(EditError);
    expect(() => editDivision(ledger, op.id, [{ share: fixe(-60) }], {}, 's-vac')).not.toThrow();
    expect(() => editDivision(ledger, op.id, [{ share: fixe(-10) }], {}, 'inconnue')).toThrow(EditError);
  });
});

describe('#297 · 2. ce qu’une sous-opération ne porte pas, elle le prend du niveau qui la contient', () => {
  it('[niveau 2] catégorie, tirelire et renflouement se prennent de proche en proche ; un niveau plus bas pose le sien', () => {
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

  it('[niveau 2] le reste d’une division que ses parts ne couvrent pas garde ce qui vaut pour le niveau divisé', () => {
    const { ledger, op } = exempleDuPoint3();
    ledger.subOperations = ledger.subOperations.filter((s) => s.id !== 's-sans');
    const reste = lignes(ledger, op.id).find((l) => !l.subOperationId)!;
    expect([reste.amount, reste.tirelireId, reste.categoryId]).toEqual([euros(-40), VACANCES, undefined]);
    expect(solde(ledger, VACANCES) - solde(sansOperation(ledger, op.id), VACANCES)).toBe(euros(-60));
  });
});

describe('#297 · 3. tout ce qui lit la ventilation la lit à tous les niveaux, sans compter deux fois', () => {
  it('[niveau 2] l’exemple de l’issue : « Vacances » −60, non affecté −40, « Restaurant » 20, 80 € sans catégorie', () => {
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

  it('[niveau 1] I2 à tous les niveaux : chaque euro compte une fois, le compte égale ses tirelires plus son non affecté', () => {
    const hasard = alea(297);
    const choisir = <T>(xs: T[]): T => xs[Math.floor(hasard() * xs.length)]!;
    const compte = (id: string, kind: Account['kind']): Account => ({ id, name: id, kind, openingBalance: euros(1000), openingDate: '2026-01-01' });
    // Sans besoin ni libération en fin de période : seules les opérations font bouger composantes et non affecté.
    const pot = (id: string, compteId: string): Tirelire => ({ id, name: id, placement: [{ accountId: compteId, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-01-01', rollover: { mode: 'unlimited' } });
    const ledger = emptyLedger();
    ledger.accounts.push(compte('cc', 'principal'), compte('livret', 'epargne'));
    ledger.tirelires.push(pot('t1', 'cc'), pot('t2', 'livret'), pot('t3', 'cc'));
    const tirelires = ['t1', 't2', 't3'];
    const categories = ['c1', 'c2', 'c3'];
    for (const id of categories) ledger.categories.push({ id, name: id, nature: 'expense' });

    for (let i = 0; i < 60; i++) {
      const sens = hasard() < 0.7 ? -1 : 1;
      const accountId = choisir(['cc', 'livret']);
      const virement = hasard() < 0.25;
      const op: Operation = {
        id: `op-${i}`,
        accountId,
        origin: 'manual',
        date: '2026-03-15',
        label: 'T',
        normalizedLabel: 'T',
        amount: sens * (100 + Math.floor(hasard() * 50000)),
        state: 'locked',
        ...(virement ? { transferAccountId: accountId === 'cc' ? 'livret' : 'cc' } : {}),
      };
      ledger.operations.push(op);
      // Un arbre au hasard : jusqu'à trois niveaux, des parts fixes, en pourcentage et variables, qui
      // portent ou non une tirelire et une catégorie ; chaque division reste sous les 100 % de son niveau.
      let n = 0;
      const diviser = (parentId: string | undefined, niveau: number, montant: number): void => {
        const freres: SubOperation[] = [];
        let variablePose = false;
        for (let k = 0, parts = 1 + Math.floor(hasard() * 3); k < parts; k++) {
          const tirage = hasard();
          let share: Share;
          if (tirage < 0.3 && !variablePose) {
            share = variable;
            variablePose = true;
          } else if (tirage < 0.65) share = pct(Math.floor(hasard() * 30));
          else share = { kind: 'fixed', amount: sens * Math.floor(hasard() * Math.abs(montant) * 0.3) };
          freres.push(
            sub(`${op.id}-s${n++}`, op.id, share, {
              ...(parentId ? { parentId } : {}),
              ...(hasard() < 0.5 ? { tirelireId: choisir(tirelires) } : {}),
              ...(hasard() < 0.5 ? { categoryId: choisir(categories) } : {}),
            }),
          );
        }
        ledger.subOperations.push(...freres);
        const montants = resolveShares(montant, freres);
        if (niveau < 3) for (const f of freres) if (hasard() < 0.45) diviser(f.id, niveau + 1, montants.get(f.id) ?? 0);
      };
      if (hasard() < 0.85) diviser(undefined, 1, op.amount);
    }

    const idx = indexLedger(ledger);
    const asOf = '2026-12-31';
    const effetsDe = (opId: string) => [...idx.entriesByTirelire.values()].flat().filter((e) => e.operation.id === opId);
    for (const op of ledger.operations) {
      // Les lignes comptées couvrent le montant de l'opération une fois, au centime.
      expect(idx.linesByOperation.get(op.id)!.reduce((s, l) => s + l.amount, 0), op.id).toBe(op.amount);
      // Ce qui pèse sur une tirelire et le non affecté de l'opération : son montant, ni plus ni moins.
      if (!op.transferAccountId) expect(effetsDe(op.id).reduce((s, e) => s + e.effect, 0) + unallocatedAmount(op, idx), op.id).toBe(op.amount);
      // Un virement interne ne change le solde d'aucune tirelire.
      else expect(effetsDe(op.id).reduce((s, e) => s + e.effect, 0), op.id).toBe(0);
    }
    for (const t of idx.tireliresById.values()) {
      expect(tirelireBalance(t, idx, asOf), t.id).toBe([...tirelireComponents(t, idx, asOf).values()].reduce((s, v) => s + v, 0));
    }
    for (const a of idx.accountsById.values()) {
      expect(componentsOnAccount(a, idx, asOf) + unallocated(a, ledger, idx, asOf), a.id).toBe(accountBalance(a, ledger, asOf));
      // Le même non affecté, lu autrement : le solde d'ouverture, plus la part sans tirelire de chaque
      // opération du compte, plus, pour un virement qui y arrive, ce qu'il y déplace des tirelires (le
      // relevé de ce compte n'a pas sa propre ligne : son solde bancaire ne bouge pas).
      let attendu = a.openingBalance;
      for (const op of ledger.operations) {
        if (op.accountId === a.id) attendu += unallocatedAmount(op, idx);
        if (op.transferAccountId === a.id) attendu += op.amount - unallocatedAmount(op, idx);
      }
      expect(unallocated(a, ledger, idx, asOf), a.id).toBe(attendu);
    }
  });

  it('[niveau 2] un virement interne divisé déplace la composante sans changer le solde de la tirelire', () => {
    const { ledger, op } = exempleDuPoint3({ transferAccountId: 'acc-livret' });
    const avant = sansOperation(ledger, op.id);
    expect(solde(ledger, VACANCES)).toBe(solde(avant, VACANCES));
    const idx = indexLedger(ledger);
    const avantIdx = indexLedger(avant);
    const vac = idx.tireliresById.get(VACANCES)!;
    const ecart = (compte: string) => (tirelireComponents(vac, idx, LECTURE).get(compte) ?? 0) - (tirelireComponents(vac, avantIdx, LECTURE).get(compte) ?? 0);
    expect([ecart(PRINCIPAL), ecart('acc-livret')]).toEqual([euros(-60), euros(60)]);
  });

  it('[niveau 2] un renflouement posé à un niveau compte pour ce qu’il contient, et sort des moyennes', () => {
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

  it('[niveau 2] un niveau qui porte une catégorie et se divise compte son montant une fois au bilan', () => {
    const ledger = base();
    const op = operation('op-bilan', -100);
    ledger.operations.push(op);
    ledger.subOperations.push(
      sub('p', op.id, variable, { categoryId: RESTAURANT }),
      sub('p1', op.id, fixe(-30), { parentId: 'p' }),
      sub('p2', op.id, variable, { parentId: 'p', categoryId: RESTAURANT }),
    );
    const periode = budgetPeriodContaining(op.date, ledger.settings.periodStartDay);
    const resto = reviewCategories(ledger, [periode]).find((r) => r.categoryId === RESTAURANT)!;
    expect(resto.periods[0]!.spent).toBe(euros(100));
    expect(resto.periods[0]!.count).toBe(2);
  });

  it('[niveau 2] le solde prévu d’une période à venir lit une saisie future divisée (D52)', () => {
    const { ledger, op } = exempleDuPoint3({ date: '2026-10-05' });
    const prevu = (l: Ledger) => computePlan(l, '2026-10-10', LECTURE).forecast!.tirelires.find((t) => t.id === VACANCES)!.end;
    expect(prevu(ledger) - prevu(sansOperation(ledger, op.id))).toBe(euros(-60));
  });

  it('[niveau 2] le solde à régler d’un compte tiers lit la ventilation à tous les niveaux (D04)', () => {
    // Une dépense de 100 € sur la carte enfants : 70 € sur « Enfants et loisirs », placée sur cette
    // carte, divisés en 20 € et 50 € ; 30 € sans tirelire. Seuls ces 30 € se règlent avec le principal.
    const ledger = base();
    const op = operation('op-tiers', -100, { accountId: 'acc-enfants' });
    ledger.operations.push(op);
    ledger.subOperations.push(
      sub('t-a', op.id, fixe(-70), { tirelireId: 'env-enfants' }),
      sub('t-b', op.id, variable),
      sub('t-a1', op.id, fixe(-20), { parentId: 't-a', categoryId: 'cat-enfants' }),
      sub('t-a2', op.id, variable, { parentId: 't-a' }),
    );
    const du = (l: Ledger) => {
      const idx = indexLedger(l);
      return settlementBalance(idx.accountsById.get('acc-enfants')!, l, idx, LECTURE);
    };
    expect(du(ledger) - du(sansOperation(ledger, op.id))).toBe(euros(30));
  });
});

describe('#297 · 4. une ventilation d’un seul niveau donne ce qu’elle donnait', () => {
  it('[niveau 2] pour toute ventilation d’un niveau, les lignes sont celles de l’ancien calcul, au centime', () => {
    // L'ancien calcul de `main` (D27), recopié : une part fixe, un pourcentage du montant de
    // l'opération, la part variable qui prend le reste sans changer de signe, une seule.
    const ancien = (montant: number, parts: Share[]): number[] => {
      const sens = montant < 0 ? -1 : 1;
      const out: number[] = parts.map(() => 0);
      let utilise = 0;
      let variablePosee = false;
      let indexVariable = -1;
      parts.forEach((p, i) => {
        if (p.kind === 'variable') {
          if (!variablePosee) {
            variablePosee = true;
            indexVariable = i;
          }
          return;
        }
        out[i] = p.kind === 'fixed' ? p.amount : Math.round((montant * p.pct) / 100);
        utilise += out[i]!;
      });
      if (indexVariable >= 0) out[indexVariable] = sens * (montant - utilise) > 0 ? montant - utilise : 0;
      return out;
    };
    const hasard = alea(2970);
    for (let cas = 0; cas < 300; cas++) {
      const montant = (hasard() < 0.5 ? -1 : 1) * (1 + Math.floor(hasard() * 99999));
      const parts: Share[] = [];
      for (let k = 0, n = 1 + Math.floor(hasard() * 4); k < n; k++) {
        const t = hasard();
        parts.push(t < 0.3 ? variable : t < 0.65 ? pct(Math.floor(hasard() * 101)) : { kind: 'fixed', amount: Math.floor((hasard() * 2 - 0.5) * Math.abs(montant)) });
      }
      const op: Operation = { ...operation(`op-${cas}`, 0), amount: montant };
      const subs = parts.map((p, k) => sub(`s${k}`, op.id, p, k % 2 === 0 ? { tirelireId: VACANCES } : { categoryId: RESTAURANT }));
      const attendu = ancien(montant, parts);
      const vu = lignes({ ...base(), operations: [op], subOperations: subs }, op.id);
      subs.forEach((s, k) => expect(vu.find((l) => l.id === s.id)!.amount, `cas ${cas}, part ${k}`).toBe(attendu[k]));
      // Ce qu'aucune part ne couvre est le non affecté de l'opération, ni plus ni moins.
      const reste = montant - attendu.reduce((s, x) => s + x, 0);
      expect(vu.find((l) => !l.subOperationId)?.amount ?? 0, `cas ${cas}, reste`).toBe(reste);
    }
  });
});

describe('#297 · 5. une règle remplace la ventilation à tous ses niveaux ; une opération verrouillée garde les siens', () => {
  function avecRegle(state: Operation['state']): { ledger: Ledger; op: Operation } {
    const { ledger, op } = exempleDuPoint3({ origin: 'imported', label: 'RESTO PLAGE', normalizedLabel: 'RESTO PLAGE', state });
    ledger.automations.push({ id: 'r-resto', selection: { labelPattern: 'RESTO' }, action: { categoryId: RESTAURANT, state: 'reconcile' }, rank: 'm' });
    return { ledger, op };
  }

  it('[niveau 2] une règle réécrit une seule division, et ce qu’elle contenait disparaît', () => {
    const { ledger, op } = avecRegle('untreated');
    const apres = applyPatchToLedger(ledger, applyAutomations(ledger));
    const vivantes = liveSubOperations(apres.subOperations).filter((s) => s.operationId === op.id);
    expect(vivantes.map((s) => [s.parentId, s.categoryId, s.share.kind])).toEqual([[undefined, RESTAURANT, 'variable']]);
  });

  it('[niveau 0] une opération verrouillée garde tous ses niveaux : aucune règle ne la réécrit', () => {
    const { ledger, op } = avecRegle('locked');
    const patch = applyAutomations(ledger);
    expect(patch.operations.find((o) => o.id === op.id)).toBeUndefined();
    expect(patch.subOperations.filter((s) => s.operationId === op.id)).toEqual([]);
    expect(patch.removedSubOperations).toEqual([]);
  });

  it('[niveau 2] un rapprochement de flux pose la ventilation d’une opération qui n’en a pas, et ne réécrit jamais celle qu’elle a', () => {
    // Une opération bancaire que le flux « Mutuelle » reconnaît ; une seule par grand livre, car une
    // occurrence du flux ne se rapproche que d'une opération.
    const avecFlux = (subs: SubOperation[]): { ledger: Ledger; op: Operation } => {
      const ledger = base();
      ledger.plannedFlows.push({
        id: 'flow-297',
        name: 'Mutuelle',
        kind: 'fixedCharge',
        amount: euros(-50),
        accountId: PRINCIPAL,
        categoryId: 'cat-assurance',
        periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-03' },
        dateWindowDays: 3,
        labelPattern: 'MUTUELLE',
      });
      const op = operation('op-flux', -50, { origin: 'imported', label: 'MUTUELLE', normalizedLabel: 'MUTUELLE', state: 'untreated' });
      ledger.operations.push(op);
      ledger.subOperations.push(...subs);
      return { ledger, op };
    };
    const rapprocher = (ledger: Ledger, op: Operation) => applyMatch(ledger, proposeMatches(ledger, '2026-08-01', '2026-09-30').find((p) => p.operationId === op.id)!);

    const sans = avecFlux([]);
    const patchSans = rapprocher(sans.ledger, sans.op);
    expect(patchSans.subOperations.map((s) => [s.operationId, s.parentId, s.categoryId, s.share.kind])).toEqual([[sans.op.id, undefined, 'cat-assurance', 'variable']]);

    const divisee = avecFlux([sub('d1', 'op-flux', fixe(-30), { tirelireId: VACANCES }), sub('d2', 'op-flux', variable), sub('d11', 'op-flux', fixe(-10), { parentId: 'd1', categoryId: RESTAURANT })]);
    const patchDivisee = rapprocher(divisee.ledger, divisee.op);
    expect(patchDivisee.operations.map((o) => o.plannedFlowId)).toEqual(['flow-297']);
    expect(patchDivisee.subOperations).toEqual([]);
    expect(patchDivisee.removedSubOperations).toEqual([]);
    const apres = applyPatchToLedger(divisee.ledger, patchDivisee);
    expect(lignes(apres, divisee.op.id).map((l) => [l.id, l.amount])).toEqual(lignes(divisee.ledger, divisee.op.id).map((l) => [l.id, l.amount]));
  });
});

describe('#297 · 6. modifier un niveau garde ce que contiennent les autres', () => {
  it('[niveau 0] modifier la division de l’opération garde ce que contient une sous-opération gardée, et n’écrit que ce qui change', () => {
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

  it('[niveau 2] retirer une sous-opération retire ce qu’elle contient', () => {
    const { ledger, op } = exempleDuPoint3();
    const patch = editDivision(ledger, op.id, [{ id: 's-reste', share: variable }]);
    expect([...patch.removedSubOperations!].sort()).toEqual(['s-resto', 's-sans', 's-vac']);
    const apres = applyPatchToLedger(ledger, patch);
    expect(lignes(apres, op.id).map((l) => [l.id, l.amount])).toEqual([['s-reste', op.amount]]);
  });
});

describe('#297 · 7. les sous-opérations se sauvegardent, se restaurent et se synchronisent', () => {
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

  it('[niveau 0] un fichier sauvegardé se restaure avec tous les niveaux', async () => {
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

  it('[niveau 1] deux instances qui modifient deux niveaux différents d’une même opération convergent, sans conflit', async () => {
    const a = await instance('A');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    expect(await synchroniser(a, b)).toEqual([]);
    ecrire(a, editDivision(a.load(), 'op-297', [{ id: 's-vac', tirelireId: VACANCES, categoryId: RESTAURANT, share: fixe(-70) }, { id: 's-reste', share: variable }]));
    ecrire(b, editDivision(b.load(), 'op-297', [{ id: 's-resto', categoryId: RESTAURANT, share: fixe(-25) }, { id: 's-sans', share: variable }], {}, 's-vac'));
    expect(await synchroniser(a, b)).toEqual([]);
    expect(vivantes(a)).toEqual(vivantes(b));
    expect(Object.fromEntries(lignes(a.load(), 'op-297').map((l) => [l.id, l.amount]))).toEqual({ 's-resto': euros(-25), 's-sans': euros(-45), 's-reste': euros(-30) });
  });

  it('[niveau 1] après synchronisation, aucune sous-opération ne reste sans le niveau qui la contient', async () => {
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

  it('[niveau 2] un niveau retiré retire ce qu’il contient, avant même toute synchronisation', () => {
    const { ledger, op } = exempleDuPoint3();
    ledger.subOperations = ledger.subOperations.map((s) => (s.id === 's-vac' ? { ...s, deletedAt: '2026-09-05T10:00:00.000Z' } : s));
    // « Restaurant » et la part sans catégorie restent écrites dans le fichier, sous un niveau retiré : elles ne comptent plus.
    expect(liveSubOperations(ledger.subOperations).filter((s) => s.operationId === op.id).map((s) => s.id)).toEqual(['s-reste']);
    const avant = sansOperation(ledger, op.id);
    expect(solde(ledger, VACANCES)).toBe(solde(avant, VACANCES));
    expect(nonAffecte(ledger, PRINCIPAL) - nonAffecte(avant, PRINCIPAL)).toBe(euros(-100));
  });

  it('[niveau 1] un paquet par fichier porte tous les niveaux', async () => {
    const a = await instance('A');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    importBundle(b, exportBundle(a));
    expect(vivantes(b)).toEqual(vivantes(a));
  });
});

describe('#297 · 8. le format change de version : la précédente est refusée en le disant, et le code ne garde rien d’elle', () => {
  it('[niveau 0] un fichier de la version précédente est refusé, sans rien ouvrir ni écrire', async () => {
    const a = await LedgerStore.create({ sqlJs: SQL, siteId: 'A' });
    const db = new SQL.Database(a.export());
    db.run(`UPDATE meta SET value = '3' WHERE key = 'format_version'`);
    const avant = db.export();
    db.close();
    const copie = avant.slice();
    await expect(LedgerStore.create({ sqlJs: SQL, siteId: 'A', bytes: avant })).rejects.toBeInstanceOf(FormatRefused);
    expect(Buffer.from(avant).equals(Buffer.from(copie))).toBe(true);
  });

  it('[niveau 1] un paquet de la version précédente est refusé, sans rien écrire', async () => {
    const a = await LedgerStore.create({ sqlJs: SQL, siteId: 'A' });
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    a.upsert('categories', { id: RESTAURANT, name: 'Restaurant', nature: 'expense' });
    const avant = Buffer.from(b.export());
    expect(() => importBundle(b, { ...exportBundle(a), version: 3 })).toThrow(/version antérieure/);
    expect(b.load().categories.find((c) => c.id === RESTAURANT)).toBeUndefined();
    expect(Buffer.from(b.export()).equals(avant)).toBe(true);
  });

  it('[niveau 2] un fichier neuf n’a que la table des sous-opérations : aucune table de la ventilation à un niveau', async () => {
    const a = await LedgerStore.create({ sqlJs: SQL, siteId: 'A' });
    const db = new SQL.Database(a.export());
    const tables = db.exec(`SELECT name FROM sqlite_master WHERE type = 'table'`)[0]!.values.map((v) => String(v[0]));
    const colonnes = db.exec(`PRAGMA table_info(sub_operations)`)[0]!.values.map((v) => String(v[1]));
    db.close();
    expect(tables).toContain('sub_operations');
    expect(tables).not.toContain('allocations');
    expect(colonnes).toContain('parent_id');
  });
});
