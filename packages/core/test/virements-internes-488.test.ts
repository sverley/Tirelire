/**
 * Tests du codeur de #488 — « Virements internes : appariement automatique seulement quand la
 * destination est connue, et reconnaissance souple des libellés ». Côté cœur ; ce que montrent les
 * écrans Opérations et Import est dans `apps/web/test/virements-internes-488-ecran.test.ts`. Chaque
 * `describe` nomme le point du « Fait quand » qu'il vérifie.
 *
 * Données inventées (D84) : un compte principal, deux comptes enfants, « Léa » et « Tom », et un
 * Livret A. Le principal vire 45 € à chaque enfant le 1er du mois, par un ordre enregistré vers
 * chacun ; chaque enfant reverse aussitôt 45 € par un prélèvement vers un plan d'épargne, qui n'est
 * pas un compte suivi.
 */
import { describe, expect, it } from 'vitest';
import {
  LABEL_SCORE_MIN,
  acceptInternalTransfer,
  applyPatchToLedger,
  designateTransfer,
  emptyLedger,
  euros,
  indexLedger,
  labelMatcher,
  labelScore,
  matchTirelireTransfers,
  normalizeLabel,
  pairInternalTransfers,
  proposeInternalTransfers,
  runPipeline,
  tirelireComponents,
  transfersToOrder,
  unpairTransfer,
  type Ledger,
  type Operation,
  type Patch,
  type PlannedFlow,
} from '../src/index.js';

const CC = 'acc-principal';
const LEA = 'acc-lea';
const TOM = 'acc-tom';
const LIVRET = 'acc-livret';

function op(id: string, accountId: string, date: string, label: string, amount: number, o: Partial<Operation> = {}): Operation {
  return { id, accountId, origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount, state: 'untreated', ...o };
}

function ordre(id: string, vers: string, motif: string, montant = euros(45)): PlannedFlow {
  return { id, name: `Virement ${vers}`, kind: 'transfer', amount: -montant, accountId: CC, counterpartAccountId: vers, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-01' }, dateWindowDays: 3, labelPattern: motif };
}

/** Les comptes ; avec `ordres`, un ordre enregistré du principal vers chaque enfant. */
function comptes(ordres = true): Ledger {
  const l = emptyLedger();
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(2000), openingDate: '2025-12-31' },
    { id: LEA, name: 'Léa', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
    { id: TOM, name: 'Tom', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
    { id: LIVRET, name: 'Livret A', kind: 'epargne', openingBalance: 0, openingDate: '2025-12-31' },
  );
  if (ordres) l.plannedFlows.push(ordre('ordre-lea', LEA, 'ARGENT POCHE LEA'), ordre('ordre-tom', TOM, 'ARGENT POCHE TOM'));
  return l;
}

const avec = (l: Ledger, ...ops: Operation[]): Ledger => ({ ...l, operations: [...l.operations, ...ops] });
const appliquer = (l: Ledger, p: Patch) => applyPatchToLedger(l, p);
const apparie = (l: Ledger) => appliquer(l, pairInternalTransfers(l));
const de = (l: Ledger, id: string) => l.operations.find((o) => o.id === id)!;
const paires = (l: Ledger) =>
  l.operations
    .filter((o) => !o.deletedAt && o.transferOperationId && o.amount < 0)
    .map((o) => `${o.id}>${o.transferOperationId}`)
    .sort();
const proposees = (l: Ledger) => proposeInternalTransfers(l).map((p) => `${p.debitId}>${p.creditId}`).sort();

/** Un mois du piège des comptes enfants : `jours` donne la date de chacun des quatre virements et des deux prélèvements. */
function moisEnfants(m: string, jours: { versLea: string; versTom: string; recuLea: string; recuTom: string; prlvLea: string; prlvTom: string }): Operation[] {
  return [
    op(`${m}-vers-lea`, CC, jours.versLea, 'VIR SEPA ARGENT POCHE LEA', -euros(45)),
    op(`${m}-vers-tom`, CC, jours.versTom, 'VIR SEPA ARGENT POCHE TOM', -euros(45)),
    op(`${m}-recu-lea`, LEA, jours.recuLea, 'VIR RECU DE: M OU MME DUPONT', euros(45)),
    op(`${m}-recu-tom`, TOM, jours.recuTom, 'VIR RECU DE: M OU MME DUPONT', euros(45)),
    op(`${m}-prlv-lea`, LEA, jours.prlvLea, 'PRLV SEPA PLAN EPARGNE LEA', -euros(45)),
    op(`${m}-prlv-tom`, TOM, jours.prlvTom, 'PRLV SEPA PLAN EPARGNE TOM', -euros(45)),
  ];
}

const JUSTES = (m: string) => [`${m}-vers-lea>${m}-recu-lea`, `${m}-vers-tom>${m}-recu-tom`];

describe('#488 · 1. une destination connue', () => {
  it('[niveau 4] désignée, reconnue par le libellé d’un ordre, ou « TIRELIRE <COMPTE> » sans ordre : elle apparie', () => {
    const l = avec(
      comptes(),
      op('designe', CC, '2026-03-10', 'VIR SEPA MISE DE COTE', -euros(80), { state: 'locked', transferAccountId: LIVRET }),
      op('recu-designe', LIVRET, '2026-03-11', 'VIR RECU', euros(80)),
      op('par-ordre', CC, '2026-03-01', 'VIR SEPA ARGENT POCHE LEA', -euros(45)),
      op('recu-ordre', LEA, '2026-03-02', 'VIR RECU', euros(45)),
      op('par-nom', CC, '2026-03-15', 'VIR TIRELIRE LIVRET A', -euros(30)),
      op('recu-nom', LIVRET, '2026-03-15', 'VIR RECU', euros(30)),
    );
    expect(paires(apparie(l))).toEqual(['designe>recu-designe', 'par-nom>recu-nom', 'par-ordre>recu-ordre']);
  });

  it('[niveau 4] ni le nom d’un compte cité dans le libellé, ni son numéro, ni un montant égal n’en font une', () => {
    const l = comptes(false);
    l.accounts = l.accounts.map((a) => (a.id === LEA ? { ...a, accountNumber: '00099999999' } : a));
    const ops = [
      op('nomme', CC, '2026-03-01', 'VIR SEPA LEA', -euros(45)),
      op('numero', CC, '2026-03-05', 'VIR SEPA 00099999999', -euros(46)),
      op('titulaire', TOM, '2026-03-08', 'VIR DE: M OU MME LEA DUPONT', -euros(47)),
      op('recu-1', LEA, '2026-03-01', 'VIR RECU', euros(45)),
      op('recu-2', LEA, '2026-03-05', 'VIR RECU', euros(46)),
      op('recu-3', LEA, '2026-03-08', 'VIR RECU', euros(47)),
    ];
    const l2 = apparie(avec(l, ...ops));
    expect(paires(l2)).toEqual([]);
    // Chacune se propose, à confirmer (point 3).
    expect(proposees(l2)).toEqual(['nomme>recu-1', 'numero>recu-2', 'titulaire>recu-3']);
  });
});

describe('#488 · 2. l’appariement automatique ne se fait qu’avec la destination', () => {
  it('[niveau 4] le piège des comptes enfants : les deux vraies paires de chaque mois, aucune fausse, quel que soit l’ordre des dates ; le prélèvement vers le plan d’épargne n’est apparié à rien', () => {
    const variantes = [
      // L'exemple du besoin : le prélèvement de Léa, daté du 30, passe avant le virement du principal, daté du 1er.
      { versLea: '2026-04-01', versTom: '2026-04-01', recuLea: '2026-04-01', recuTom: '2026-04-01', prlvLea: '2026-03-30', prlvTom: '2026-03-31' },
      { versLea: '2026-04-01', versTom: '2026-04-02', recuLea: '2026-04-02', recuTom: '2026-04-01', prlvLea: '2026-04-02', prlvTom: '2026-04-01' },
      { versLea: '2026-04-02', versTom: '2026-04-01', recuLea: '2026-04-03', recuTom: '2026-03-31', prlvLea: '2026-04-01', prlvTom: '2026-04-03' },
      { versLea: '2026-04-03', versTom: '2026-04-03', recuLea: '2026-04-01', recuTom: '2026-04-02', prlvLea: '2026-04-03', prlvTom: '2026-04-03' },
    ];
    for (const [i, j] of variantes.entries()) {
      for (const sens of [1, -1]) {
        const ops = moisEnfants('avr', j);
        const l = apparie(avec(comptes(), ...(sens === 1 ? ops : [...ops].reverse())));
        expect(paires(l), `variante ${i}, sens ${sens}`).toEqual(JUSTES('avr'));
        for (const p of ['avr-prlv-lea', 'avr-prlv-tom']) expect(de(l, p).transferOperationId, `${p}, variante ${i}`).toBeUndefined();
        for (const c of ['avr-vers-lea', 'avr-recu-lea', 'avr-vers-tom', 'avr-recu-tom']) expect(de(l, c).state, c).toBe('reconciled');
      }
    }
  });

  it('[niveau 4] plusieurs mois dans un seul import, ou un import par mois et par compte : les mêmes paires', () => {
    const jours = (m: string, prev: string) => ({ versLea: `${m}-01`, versTom: `${m}-01`, recuLea: `${m}-01`, recuTom: `${m}-02`, prlvLea: `${prev}-30`, prlvTom: `${m}-01` });
    const mois = [moisEnfants('fev', jours('2026-02', '2026-01')), moisEnfants('mar', jours('2026-03', '2026-02')), moisEnfants('avr', jours('2026-04', '2026-03'))];
    const attendu = [...JUSTES('fev'), ...JUSTES('mar'), ...JUSTES('avr')].sort();

    let seul = avec(comptes(), ...mois.flat());
    runPipeline(seul, '2026-01-01', '2026-05-01', (p) => (seul = appliquer(seul, p)));
    expect(paires(seul)).toEqual(attendu);

    // Un import par mois et par compte : le principal d'abord, les comptes enfants ensuite.
    let parMois = comptes();
    for (const ops of mois)
      for (const compte of [CC, LEA, TOM]) {
        const nouvelles = ops.filter((o) => o.accountId === compte);
        parMois = avec(parMois, ...nouvelles);
        const dates = nouvelles.map((o) => o.date).sort();
        runPipeline(parMois, dates[0]!, dates.at(-1)!, (p) => (parMois = appliquer(parMois, p)));
      }
    expect(paires(parMois)).toEqual(attendu);
    expect(proposeInternalTransfers(parMois)).toEqual([]);
  });

  it('[niveau 4] deux candidats à la même distance : aucun appariement, ils se proposent', () => {
    const l = apparie(
      avec(comptes(), op('vers', CC, '2026-04-02', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('c1', LEA, '2026-04-01', 'VIR RECU', euros(45)), op('c2', LEA, '2026-04-03', 'VIR RECU', euros(45))),
    );
    expect(paires(l)).toEqual([]);
    expect(proposees(l)).toEqual(['vers>c1', 'vers>c2']);
  });

  it('[niveau 4] deux candidats, dont un sur un autre compte que celui désigné : l’appariement se fait avec le compte désigné, seul proposé sinon', () => {
    const l = apparie(avec(comptes(), op('vers', CC, '2026-04-02', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('lea', LEA, '2026-04-03', 'VIR RECU', euros(45)), op('tom', TOM, '2026-04-02', 'VIR RECU', euros(45))));
    expect(paires(l)).toEqual(['vers>lea']);
    expect(de(l, 'tom').transferOperationId).toBeUndefined();
  });

  it('[niveau 4] deux débits qui se disputent un crédit : le plus proche en date l’emporte ; à égalité, aucun', () => {
    const proche = apparie(
      avec(comptes(), op('loin', CC, '2026-04-01', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('pres', CC, '2026-04-03', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('c', LEA, '2026-04-03', 'VIR RECU', euros(45))),
    );
    expect(paires(proche)).toEqual(['pres>c']);
    const egal = apparie(
      avec(comptes(), op('d1', CC, '2026-04-01', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('d2', CC, '2026-04-05', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('c', LEA, '2026-04-03', 'VIR RECU', euros(45))),
    );
    expect(paires(egal)).toEqual([]);
    expect(proposees(egal)).toEqual(['d1>c', 'd2>c']);
  });

  it('[niveau 4] une désignation à la main, verrouillée, s’apparie à l’import qui apporte l’autre côté ; elle reste verrouillée, sa ventilation ne change pas', () => {
    let l = avec(comptes(false), op('vers', CC, '2026-04-02', 'VIR SEPA MISE DE COTE', -euros(80), { state: 'locked', transferAccountId: LIVRET }));
    l.tirelires.push({ id: 'vac', name: 'Vacances', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-01-01' });
    l.subOperations.push({ id: 's1', operationId: 'vers', tirelireId: 'vac', share: { kind: 'variable' } });
    l = avec(l, op('recu', LIVRET, '2026-04-03', 'VIR RECU', euros(80)));
    runPipeline(l, '2026-04-03', '2026-04-04', (p) => (l = appliquer(l, p)));
    expect(paires(l)).toEqual(['vers>recu']);
    expect([de(l, 'vers').state, de(l, 'recu').state]).toEqual(['locked', 'reconciled']);
    expect(l.subOperations.filter((s) => !s.deletedAt).map((s) => [s.id, s.operationId, s.tirelireId])).toEqual([['s1', 'vers', 'vac']]);
  });

  it('[niveau 4] une opération verrouillée sans désignation n’est pas appariée', () => {
    const l = apparie(avec(comptes(), op('vers', CC, '2026-04-01', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('recu', LEA, '2026-04-01', 'VIR RECU', euros(45), { state: 'locked' })));
    expect(paires(l)).toEqual([]);
  });
});

describe('#488 · 3. une proposition, sinon', () => {
  it('[niveau 4] la coïncidence : rien n’est apparié, une proposition est faite ; confirmée, la paire est verrouillée', () => {
    const l = apparie(avec(comptes(), op('vers-tiers', LEA, '2026-05-12', 'VIR SEPA CLUB DE FOOT', -euros(34)), op('sante', CC, '2026-05-12', 'VIR RECU CPAM REMBOURSEMENT', euros(34))));
    expect(paires(l)).toEqual([]);
    const props = proposeInternalTransfers(l);
    expect(props).toEqual([{ debitId: 'vers-tiers', creditId: 'sante' }]);
    // Rien ne s'écrit avant le geste : proposer ne change pas le grand livre.
    expect(l.operations.every((o) => o.state === 'untreated' && !o.transferAccountId)).toBe(true);
    const l2 = appliquer(l, acceptInternalTransfer(l, props[0]!));
    expect(paires(l2)).toEqual(['vers-tiers>sante']);
    expect([de(l2, 'vers-tiers').state, de(l2, 'sante').state]).toEqual(['locked', 'locked']);
    expect([de(l2, 'vers-tiers').transferAccountId, de(l2, 'sante').transferAccountId]).toEqual([CC, LEA]);
    expect(proposeInternalTransfers(l2)).toEqual([]);
  });

  it('[niveau 4] la proposition disparaît dès qu’un côté est apparié, verrouillé, désigné ou supprimé ; ignorée, elle reste', () => {
    const base = avec(comptes(false), op('d', LEA, '2026-05-12', 'VIR SEPA CLUB', -euros(34)), op('c', CC, '2026-05-12', 'VIR RECU CPAM', euros(34)));
    expect(proposees(base)).toEqual(['d>c']);
    expect(proposees(apparie(base)), 'ignorée : rien ne la retire').toEqual(['d>c']);
    const change = (id: string, o: Partial<Operation>) => ({ ...base, operations: base.operations.map((x) => (x.id === id ? { ...x, ...o } : x)) });
    expect(proposees(change('c', { state: 'locked' })), 'verrouillé').toEqual([]);
    expect(proposees(change('d', { deletedAt: '2026-05-13T00:00:00Z' })), 'supprimé').toEqual([]);
    expect(proposees(change('d', { transferAccountId: TOM, state: 'locked' })), 'désigné vers un autre compte').toEqual([]);
    expect(proposees(change('c', { transferAccountId: TOM, transferOperationId: 'x' })), 'apparié ailleurs').toEqual([]);
  });

  it('[niveau 4] sans destination connue nulle part (U5, aucun budget, aucun ordre) : tout se propose, rien ne s’apparie seul', () => {
    const l = emptyLedger();
    l.accounts.push({ id: 'a', name: 'Courant', kind: 'courant', openingBalance: 0, openingDate: '2026-01-01' }, { id: 'b', name: 'Épargne', kind: 'epargne', openingBalance: 0, openingDate: '2026-01-01' });
    let u5 = avec(l, op('d1', 'a', '2026-05-01', 'VIR SEPA EPARGNE', -euros(100)), op('c1', 'b', '2026-05-02', 'VIR RECU', euros(100)), op('d2', 'b', '2026-05-10', 'VIR SEPA RETOUR', -euros(20)), op('c2', 'a', '2026-05-10', 'VIR RECU', euros(20)));
    const rapport = runPipeline(u5, '2026-05-01', '2026-05-11', (p) => (u5 = appliquer(u5, p)));
    expect(rapport.transfersPaired).toBe(0);
    expect(rapport.transferProposals).toBe(2);
    expect(paires(u5)).toEqual([]);
    expect(proposees(u5)).toEqual(['d1>c1', 'd2>c2']);
  });
});

describe('#488 · 4. désigner à la main un virement', () => {
  const ventile = (l: Ledger) => {
    l.tirelires.push({ id: 'vac', name: 'Vacances', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-01-01' });
    l.subOperations.push({ id: 's-d', operationId: 'd', tirelireId: 'vac', share: { kind: 'variable' } }, { id: 's-c', operationId: 'c', tirelireId: 'vac', share: { kind: 'variable' } });
    return l;
  };

  it('[niveau 4] un seul candidat : les deux côtés appariés et verrouillés ; le double compte des composantes disparaît (I2)', () => {
    const l = ventile(avec(comptes(false), op('d', CC, '2026-06-02', 'VIR SEPA MISE DE COTE', -euros(600)), op('c', LIVRET, '2026-06-03', 'VIR RECU', euros(600))));
    // Sans appariement, désigné seul, le débit porte aussi la composante du livret, que le crédit porte déjà.
    const seul = appliquer(l, { operations: [{ ...de(l, 'd'), state: 'locked', transferAccountId: LIVRET }], subOperations: [] });
    const vac = (x: Ledger) => tirelireComponents(indexLedger(x).tireliresById.get('vac')!, indexLedger(x), '2026-06-30');
    expect(vac(seul).get(LIVRET)).toBe(euros(1200));
    const l2 = appliquer(l, designateTransfer(l, 'd', LIVRET));
    expect(paires(l2)).toEqual(['d>c']);
    expect([de(l2, 'd').state, de(l2, 'c').state]).toEqual(['locked', 'locked']);
    expect(vac(l2).get(LIVRET)).toBe(euros(600));
    expect(vac(l2).get(CC)).toBe(-euros(600));
  });

  it('[niveau 4] le crédit désigné « depuis » un compte s’apparie de même', () => {
    const l = avec(comptes(false), op('d', CC, '2026-06-02', 'VIR SEPA MISE DE COTE', -euros(600)), op('c', LIVRET, '2026-06-03', 'VIR RECU', euros(600)));
    expect(paires(appliquer(l, designateTransfer(l, 'c', CC)))).toEqual(['d>c']);
  });

  it('[niveau 4] deux candidats : désignée sans être appariée, les candidats du compte désigné se proposent', () => {
    const l = avec(comptes(false), op('d', CC, '2026-06-02', 'VIR SEPA MISE DE COTE', -euros(600)), op('c1', LIVRET, '2026-06-01', 'VIR RECU', euros(600)), op('c2', LIVRET, '2026-06-03', 'VIR RECU', euros(600)), op('t', TOM, '2026-06-02', 'VIR RECU', euros(600)));
    const l2 = appliquer(l, designateTransfer(l, 'd', LIVRET));
    expect(paires(l2)).toEqual([]);
    expect([de(l2, 'd').state, de(l2, 'd').transferAccountId]).toEqual(['locked', LIVRET]);
    expect(proposees(l2)).toEqual(['d>c1', 'd>c2']);
  });

  it('[niveau 4] sans candidat : désignée seule, puis appariée à l’import qui apporte l’autre côté', () => {
    let l = avec(comptes(false), op('d', CC, '2026-06-02', 'VIR SEPA MISE DE COTE', -euros(600)));
    l = appliquer(l, designateTransfer(l, 'd', LIVRET));
    expect([de(l, 'd').state, de(l, 'd').transferAccountId, de(l, 'd').transferOperationId]).toEqual(['locked', LIVRET, undefined]);
    l = avec(l, op('c', LIVRET, '2026-06-04', 'VIR RECU', euros(600)));
    const rapport = runPipeline(l, '2026-06-04', '2026-06-05', (p) => (l = appliquer(l, p)));
    expect(rapport.transfersPaired).toBe(1);
    expect(paires(l)).toEqual(['d>c']);
    expect(de(l, 'd').state).toBe('locked');
  });
});

describe('#488 · 5. défaire un appariement ne laisse pas un côté pointer dans le vide', () => {
  const paire = () => apparie(avec(comptes(), op('d', CC, '2026-06-01', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('c', LEA, '2026-06-01', 'VIR RECU', euros(45))));
  const coherent = (l: Ledger) => {
    const vivants = new Map(l.operations.filter((o) => !o.deletedAt).map((o) => [o.id, o]));
    for (const o of vivants.values()) if (o.transferOperationId) expect(vivants.get(o.transferOperationId)?.transferOperationId, `${o.id} désigne ${o.transferOperationId}`).toBe(o.id);
  };

  it('[niveau 4] défaire un côté : l’autre ne le désigne plus ni son compte, et garde son état et sa ventilation', () => {
    let l = paire();
    l.subOperations.push({ id: 's-c', operationId: 'c', categoryId: 'cat', share: { kind: 'variable' } });
    l = appliquer(l, unpairTransfer(l, 'd'));
    expect(de(l, 'd').transferOperationId).toBeUndefined();
    expect([de(l, 'c').transferAccountId, de(l, 'c').transferOperationId, de(l, 'c').state]).toEqual([undefined, undefined, 'reconciled']);
    expect(l.subOperations.map((s) => s.id)).toEqual(['s-c']);
    coherent(l);
  });

  it('[niveau 4] désigner un côté apparié vers un autre compte défait l’appariement des deux côtés', () => {
    let l = paire();
    l = appliquer(l, designateTransfer(l, 'd', TOM));
    expect([de(l, 'd').transferAccountId, de(l, 'd').transferOperationId, de(l, 'd').state]).toEqual([TOM, undefined, 'locked']);
    expect([de(l, 'c').transferAccountId, de(l, 'c').transferOperationId, de(l, 'c').state]).toEqual([undefined, undefined, 'reconciled']);
    coherent(l);
  });

  it('[niveau 4] un côté supprimé : défaire l’appariement libère l’autre', () => {
    let l = paire();
    l = appliquer(l, unpairTransfer(l, 'c'));
    l = { ...l, operations: l.operations.map((o) => (o.id === 'c' ? { ...o, deletedAt: '2026-06-02T00:00:00Z' } : o)) };
    expect(de(l, 'd').transferOperationId).toBeUndefined();
    coherent(l);
  });
});

describe('#488 · 6. un ordre ne se propose que sur une paire sûre', () => {
  const budget = (l: Ledger) => {
    l.tirelires.push({ id: 'vac', name: 'Vacances', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-01-01' });
    l.needs.push({ id: 'n-vac', tirelireId: 'vac', kind: 'goal', amount: euros(9000), monthlyAmount: euros(250), priority: 30 });
    l.plannedFlows.push({ id: 'salaire', name: 'Salaire', kind: 'income', amount: euros(2500), accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-28' }, dateWindowDays: 3 });
    return l;
  };
  it('[niveau 4] à confirmer, aucune proposition d’ordre ; confirmée, le débit la propose, le crédit non', () => {
    const l = apparie(budget(avec(comptes(false), op('d', CC, '2026-06-02', 'VIR SEPA MISE DE COTE', -euros(250)), op('c', LIVRET, '2026-06-03', 'VIR RECU', euros(250)))));
    expect(proposees(l)).toEqual(['d>c']);
    expect(transfersToOrder(l, '2026-06-10').size).toBe(0);
    const l2 = appliquer(l, acceptInternalTransfer(l, { debitId: 'd', creditId: 'c' }));
    expect([...transfersToOrder(l2, '2026-06-10')]).toEqual([['d', LIVRET]]);
  });
});

describe('#488 · 7. le rapport d’import', () => {
  it('[niveau 4] compte les virements internes appariés et les paires à confirmer', () => {
    let l = avec(comptes(), ...moisEnfants('avr', { versLea: '2026-04-01', versTom: '2026-04-01', recuLea: '2026-04-01', recuTom: '2026-04-01', prlvLea: '2026-03-30', prlvTom: '2026-03-31' }), op('d', LEA, '2026-04-12', 'VIR SEPA CLUB', -euros(34)), op('c', CC, '2026-04-12', 'VIR RECU CPAM', euros(34)));
    const r = runPipeline(l, '2026-03-30', '2026-04-13', (p) => (l = appliquer(l, p)));
    expect([r.transfersPaired, r.transferProposals]).toEqual([2, 1]);
  });
});

describe('#488 · 8. reconnaissance souple des libellés d’un flux', () => {
  it('[niveau 4] le score, sur les exemples du « Fait quand »', () => {
    expect(LABEL_SCORE_MIN).toBe(0.8);
    expect(labelScore('vir sepa tirelire léa', 'VIR SEPA TIRELIRE LEA')).toBe(1);
    expect(labelScore('TIRELIRE-LIVRET', 'TIRELIRE LIVRET')).toBe(1);
    expect(labelScore('TIRELIRE LIVRET', 'PRLV 123 TIRELIRE LIVRET REF 9')).toBe(1);
    expect(labelScore('A B C', 'A X Y B Z W C')).toBe(1);
    expect(labelScore('A B C', 'A X Y Z B C')).toBeCloseTo(2 / 3);
    expect(labelScore('BOURSO', 'VIR BOURSORAMA')).toBe(1);
    expect(labelScore('ARGENT POCHE MENSUEL', 'VIR ARGENT POCHE MEN')).toBe(1);
    expect(labelScore('ARGENT POCHE MENSUEL', 'VIR ARGENT POCHE ME')).toBeCloseTo(2 / 3);
    expect(labelScore('A B C D', 'A B C')).toBe(0.75);
    expect(labelScore('A B C D E', 'A B C D')).toBe(0.8);
    expect(labelScore('TIRELIRE LEA', 'TIRELIRE TOM')).toBe(0.5);
  });

  it('[niveau 4] un motif littéral reconnaît chaque altération du tableau, une à la fois ; ce qu’il reconnaissait, il le reconnaît encore', () => {
    const motif = 'ARGENT DE POCHE MENSUEL LÉA';
    const brut = 'VIR SEPA ARGENT DE POCHE MENSUEL LÉA REF 2026';
    const libelle = (label: string, details?: string) => op('x', CC, '2026-04-01', label, -euros(45), details ? { details } : {});
    const reconnait = labelMatcher(motif);
    expect(reconnait(libelle(brut))).toBe(true);
    const alterations: Array<[string, string]> = [
      ['préfixe ajouté', `PRLV 0042 ${brut}`],
      ['minuscules et accents', 'vir sepa argent de poche mensuel lea ref 2026'],
      ['ponctuation et blancs changés', 'VIR-SEPA ARGENT/DE  POCHE.MENSUEL-LÉA REF:2026'],
      // Coupé par la source : « MENSU » commence « MENSUEL », et 4 mots sur 5 font 0,8.
      ['dernier mot tronqué', 'VIR SEPA ARGENT DE POCHE MENSU'],
    ];
    const regex = new RegExp(motif, 'i');
    for (const [nom, texte] of alterations) {
      expect(reconnait(libelle(texte)), nom).toBe(true);
      if (nom !== 'préfixe ajouté') expect(regex.test(texte), `${nom} : la regex seule ne le reconnaît pas`).toBe(false);
    }
    // Le libellé complet compte comme le libellé.
    expect(reconnait(libelle('VIR SEPA', 'vir sepa argent de poche mensuel lea'))).toBe(true);
    // « texte.*texte » : chaque partie.
    expect(labelMatcher('ARGENT.*POCHE LÉA')(libelle('vir argent de poche lea'))).toBe(true);
    expect(labelMatcher('ARGENT.*POCHE LÉA')(libelle('vir argent de poche tom'))).toBe(false);
  });

  it('[niveau 4] « TIRELIRE LEA » ne reconnaît pas « TIRELIRE TOM » ; trois mots insérés, non ; une coupure qui fait disparaître la référence, non', () => {
    const lit = (motif: string, label: string) => labelMatcher(motif)(op('x', CC, '2026-04-01', label, -euros(45)));
    expect(lit('TIRELIRE LEA', 'VIR TIRELIRE TOM')).toBe(false);
    expect(lit('ARGENT POCHE', 'ARGENT DE LA BELLE POCHE')).toBe(false);
    expect(lit('ARGENT POCHE LEA', 'VIR SEPA ARGENT')).toBe(false);
  });

  it('[niveau 4] une expression régulière garde sa seule lecture, sans le score', () => {
    const lit = (motif: string, label: string) => labelMatcher(motif)(op('x', CC, '2026-04-01', label, -euros(45)));
    expect(lit('^VIR (EMENT)?SALAIRE', 'vir salaire')).toBe(true);
    expect(lit('^VIR (EMENT)?SALAIRE', 'PRLV VIR SALAIRE')).toBe(false);
    expect(lit('DGFIP|TAXE FONC', 'dgfip')).toBe(true);
    // Littéral, « TAXE FONC » reconnaîtrait « TAXE D FONCIERE » (un mot inséré) ; écrit en expression, non.
    expect(lit('TAXE FONC', 'PRLV TAXE D FONCIERE')).toBe(true);
    expect(lit('(TAXE) FONC', 'PRLV TAXE D FONCIERE')).toBe(false);
  });

  it('[niveau 4] la destination connue suit la lecture souple du libellé de l’ordre', () => {
    const l = avec(comptes(), op('d', CC, '2026-04-01', 'prlv vir-sepa argent poche léa', -euros(45)), op('c', LEA, '2026-04-01', 'VIR RECU', euros(45)));
    expect(matchTirelireTransfers(l).operations.map((o) => [o.id, o.transferAccountId])).toEqual([['d', LEA]]);
    expect(paires(apparie(l))).toEqual(['d>c']);
  });
});
