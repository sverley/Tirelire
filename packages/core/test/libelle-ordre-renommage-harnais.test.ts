/**
 * Harnais d'audit de #206 — « Le lien entre un ordre enregistré et son budget survit au renommage
 * d'un compte » (domaine plan et flux, hypothèse 3 ; D11 amendée le 8 octobre 2026). Côté cœur ; ce
 * qui se lit à l'écran (point 6) est dans `apps/web/test/navigateur/libelle-ordre-renommage-harnais.test.ts`.
 *
 * Composé après le codage (auditeur.md, étape 2) : les tests du codeur, repris de
 * `libelle-ordre-renommage.test.ts`, qu'ils couvraient en entier. Sont de moi, dans ses tests : un
 * ordre à venir qui compte (point 4, précisions), un ordre sans libellé qui ne laisse rien
 * reconnaître vers son compte (point 4, précisions), et un libellé tiré d'un nom qui ne reconnaît
 * rien sans « TIRELIRE » (point 4, précisions). Au second tour, les tests du codeur sur la précision
 * tranchée le 08/10 (point 4 : un débit du compte principal seulement), repris de
 * `libelle-ordre-sens.test.ts`, qu'ils couvraient en entier. Données inventées (D84) : l'exemple, lu au
 * 6 septembre 2026, et des opérations écrites ici. Le point 7 est de la documentation, relue.
 *
 * Niveaux (D83), par le besoin que couvre chaque phrase :
 * - 0 · la reconnaissance ne touche ni une opération verrouillée, ni une qui reprend, ni une déjà
 *   reconnue, renommage compris (points 4 et 5) : une décision écrasée ne se rétablit pas en
 *   corrigeant le code.
 * - 2 · les règles de D11 amendée, D12, D24 et D60 que les points 1 à 5 appliquent, nominales comme
 *   limites.
 */
import { describe, expect, it } from 'vitest';
import {
  computePlan,
  euros,
  exampleLedger,
  matchTirelireTransfers,
  normalizeLabel,
  standingTransferFlow,
  transferLabel,
  type Ledger,
  type Operation,
  type PlannedFlow,
} from '../src/index.js';

const PRINCIPAL = 'acc-principal';
const LIVRET = 'acc-livret';
const ENFANTS = 'acc-enfants';
const ORDRE = 'flow-vir-livret';
/** Mi-période « septembre » de l'exemple (28 août → 27 septembre). */
const LECTURE = '2026-09-06';

function renommer(l: Ledger, id: string, nom: string): Ledger {
  return { ...l, accounts: l.accounts.map((a) => (a.id === id ? { ...a, name: nom } : a)) };
}

/** L'ordre de l'exemple, sous l'identifiant `f.id`, avec `f` par-dessus ; une clé à `undefined` est retirée. */
function avecOrdre(l: Ledger, f: { [K in keyof PlannedFlow]?: PlannedFlow[K] | undefined } & { id: string }): Ledger {
  const base = l.plannedFlows.find((x) => x.id === ORDRE)!;
  const autre = { ...base, ...f } as Record<string, unknown>;
  for (const k of Object.keys(f)) if (autre[k] === undefined) delete autre[k];
  return { ...l, plannedFlows: [...l.plannedFlows.filter((x) => x.id !== f.id), autre as unknown as PlannedFlow] };
}

function sansOrdre(l: Ledger): Ledger {
  return { ...l, plannedFlows: l.plannedFlows.filter((f) => f.id !== ORDRE) };
}

function virement(l: Ledger, id = LIVRET, asOf = LECTURE) {
  return computePlan(l, asOf).transfers.find((t) => t.accountId === id);
}

/** Un débit du compte principal, sauf `compte` et un `montant` négatif (un crédit) donnés. */
function ligne(id: string, libellé: string, montant = euros(600), date = '2026-09-29', compte = PRINCIPAL): Operation {
  return { id, accountId: compte, origin: 'imported', date, label: libellé, normalizedLabel: normalizeLabel(libellé), amount: -montant, state: 'untreated' };
}

function importer(l: Ledger, ...ops: Operation[]) {
  const avec: Ledger = { ...l, operations: [...l.operations, ...ops] };
  const patch = matchTirelireTransfers(avec);
  return { patch, vers: (id: string) => patch.operations.find((o) => o.id === id)?.transferAccountId };
}

describe('[niveau 2] #206 · 1. le plan donne le libellé enregistré (point 1)', () => {
  it('le libellé de l’ordre comparé, et non celui tiré du nom', () => {
    const l = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: 'VIR MAISON EPARGNE' });
    expect(virement(l)!.labels).toEqual(['VIR MAISON EPARGNE']);
  });

  it('plusieurs ordres : chaque libellé distinct une fois ; un ordre sans libellé n’en donne aucun', () => {
    let l = avecOrdre(exampleLedger(), { id: 'flow-b', labelPattern: 'VIR LIVRET B', amount: euros(-20) });
    l = avecOrdre(l, { id: 'flow-c', labelPattern: 'TIRELIRE LIVRET A', amount: euros(-10) });
    l = avecOrdre(l, { id: 'flow-d', labelPattern: undefined, amount: euros(-5) });
    expect([...virement(l)!.labels].sort()).toEqual(['TIRELIRE LIVRET A', 'VIR LIVRET B']);
    const seul = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: undefined });
    expect(virement(seul)!.labels).toEqual([]);
  });

  it('un compte sans ordre comparé garde le libellé tiré de son nom actuel', () => {
    const l = renommer(sansOrdre(exampleLedger()), LIVRET, 'Livret Bleu');
    expect(virement(l)!.labels).toEqual([transferLabel('Livret Bleu')]);
  });
});

describe('[niveau 2] #206 · 2. renommer le compte ne change pas ce libellé (point 2)', () => {
  it('le plan affiche le libellé enregistré, nomme le compte par son nom actuel, et compare la même chose', () => {
    const avant = exampleLedger();
    const après = renommer(avant, LIVRET, 'Livret Bleu');
    const a = virement(avant)!;
    const b = virement(après)!;
    expect(b.labels).toEqual(['TIRELIRE LIVRET A']);
    expect(b.labels).not.toContain(transferLabel('Livret Bleu'));
    expect(b.accountName).toBe('Livret Bleu');
    expect({ permanent: b.permanent, bankOrder: b.bankOrder, proposal: b.proposal }).toEqual({ permanent: a.permanent, bankOrder: a.bankOrder, proposal: a.proposal });
    expect(après.plannedFlows.find((f) => f.id === ORDRE)).toEqual(avant.plannedFlows.find((f) => f.id === ORDRE));
    const signal = computePlan(après, LECTURE).warnings.find((w) => w.code === 'bankOrderDrift' && w.accountId === LIVRET);
    expect(signal?.message).toContain('« Livret Bleu »');
  });
});

describe('[niveau 2] #206 · 3. enregistrer garde le libellé (point 3)', () => {
  it('un ordre enregistré depuis le plan prend le libellé que le plan affiche', () => {
    const l = renommer(sansOrdre(exampleLedger()), LIVRET, 'Livret Bleu');
    const plan = computePlan(l, LECTURE);
    const t = plan.transfers.find((x) => x.accountId === LIVRET)!;
    const f = standingTransferFlow(plan, t, PRINCIPAL, 'flow-neuf', euros(650))!;
    expect(f.labelPattern).toBe(t.labels[0]);
    expect(f.labelPattern).toBe(transferLabel('Livret Bleu'));
  });

  for (const renomme of [false, true])
    it(`un nouveau montant garde le libellé de l’ordre${renomme ? ', après un renommage' : ''}`, () => {
      let l = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: 'VIR MAISON EPARGNE' });
      if (renomme) l = renommer(l, LIVRET, 'Livret Bleu');
      const plan = computePlan(l, LECTURE);
      const t = plan.transfers.find((x) => x.accountId === LIVRET)!;
      const existant = l.plannedFlows.find((f) => f.id === ORDRE)!;
      const f = standingTransferFlow(plan, t, PRINCIPAL, 'inutile', euros(700), existant)!;
      expect(f.id).toBe(ORDRE);
      expect(f.amount).toBe(euros(-700));
      expect(f.labelPattern).toBe('VIR MAISON EPARGNE');
    });
});

describe('[niveau 2] #206 · 4. l’import reconnaît le libellé enregistré (point 4)', () => {
  it('le libellé d’un ordre la reconnaît comme sa sélection, même sans « TIRELIRE »', () => {
    const l = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: 'VIR(EMENT)? MAISON' });
    const { patch, vers } = importer(l, ligne('op-1', 'VIREMENT MAISON 09'));
    expect(vers('op-1')).toBe(LIVRET);
    expect(patch.subOperations).toEqual([]);
    expect(patch.operations.find((o) => o.id === 'op-1')!.state).toBe('reconciled');
  });

  it('un ordre terminé à la date de l’opération la reconnaît encore (relevé ancien)', () => {
    const l = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: 'VIR MAISON', activeTo: '2026-08-31' });
    expect(importer(l, ligne('op-1', 'VIR MAISON', euros(600), '2026-09-29')).vers('op-1')).toBe(LIVRET);
    // Précisions tranchées : un ordre à venir compte aussi (ajouté par l'auditeur).
    const àVenir = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: 'VIR MAISON', activeFrom: '2026-12-01' });
    expect(importer(àVenir, ligne('op-1', 'VIR MAISON', euros(600), '2026-09-29')).vers('op-1')).toBe(LIVRET);
    expect(importer(àVenir, ligne('op-2', 'VIR PERMANENT TIRELIRE LIVRET A')).vers('op-2')).toBeUndefined();
  });

  it('le libellé tiré du nom d’un compte qui a un ordre ne reconnaît rien pour lui', () => {
    const l = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: 'VIR MAISON' });
    expect(importer(l, ligne('op-1', 'VIR PERMANENT TIRELIRE LIVRET A')).vers('op-1')).toBeUndefined();
    // Précisions tranchées : un ordre sans libellé ne laisse rien reconnaître vers son compte (D12 ; ajouté par l'auditeur).
    const sansLibellé = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: undefined });
    expect(importer(sansLibellé, ligne('op-1', 'VIR PERMANENT TIRELIRE LIVRET A')).vers('op-1')).toBeUndefined();
  });

  it('un compte sans ordre se reconnaît par le libellé tiré de son nom actuel', () => {
    const l = sansOrdre(exampleLedger());
    expect(importer(l, ligne('op-1', 'VIR PERMANENT TIRELIRE LIVRET A')).vers('op-1')).toBe(LIVRET);
    // Comme aujourd'hui, sans « TIRELIRE » le nom seul ne reconnaît rien (précisions ; ajouté par l'auditeur).
    expect(importer(l, ligne('op-2', 'VIR PERMANENT LIVRET A')).vers('op-2')).toBeUndefined();
  });

  it('le libellé d’un ordre l’emporte sur un libellé tiré d’un nom, même plus long', () => {
    // « Livret A Maison », sans ordre, se reconnaît par « LIVRET A MAISON » ; l'ordre du Livret A, par « MAISON ».
    let l = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: 'MAISON' });
    l = { ...l, accounts: [...l.accounts, { id: 'acc-lam', name: 'Livret A Maison', kind: 'epargne', openingBalance: 0, openingDate: '2026-08-27' }] };
    expect(importer(l, ligne('op-1', 'VIR TIRELIRE LIVRET A MAISON')).vers('op-1')).toBe(LIVRET);
  });

  it('entre libellés de même sorte, le plus long ; à égalité, aucun compte', () => {
    const autre = { id: 'acc-autre', name: 'Autre livret', kind: 'epargne' as const, openingBalance: 0, openingDate: '2026-08-27' };
    let l: Ledger = { ...exampleLedger(), accounts: [...exampleLedger().accounts, autre] };
    l = avecOrdre(l, { id: ORDRE, labelPattern: 'VIR MAISON' });
    l = avecOrdre(l, { id: 'flow-autre', counterpartAccountId: 'acc-autre', labelPattern: 'VIR MAISON BIS', action: undefined });
    expect(importer(l, ligne('op-1', 'VIR MAISON BIS')).vers('op-1')).toBe('acc-autre');
    const égal = avecOrdre(l, { id: 'flow-autre', counterpartAccountId: 'acc-autre', labelPattern: 'MAISON XYZ', action: undefined });
    // « VIR MAISON » et « MAISON XYZ » ont la même longueur et la reconnaissent tous deux.
    const r = importer(égal, ligne('op-2', 'VIR MAISON XYZ'));
    expect(r.vers('op-2')).toBeUndefined();
    expect(r.patch.operations.map((o) => o.id)).not.toContain('op-2');
  });
});

describe('[niveau 2] #206 · 4. le libellé d’un ordre ne reconnaît qu’un débit du compte principal (précision du 08/10)', () => {
  const l = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: 'VIR' });

  it('un débit du compte principal que le motif reconnaît va vers le compte de l’ordre', () => {
    expect(importer(l, ligne('op-1', 'VIR LIVRET')).vers('op-1')).toBe(LIVRET);
  });

  it('un crédit du compte principal n’est pas reconnu par lui, quel que soit son libellé', () => {
    expect(importer(l, ligne('op-1', 'VIREMENT SALAIRE ACME', -euros(3400))).vers('op-1')).toBeUndefined();
  });

  it('une opération d’un autre compte n’est pas reconnue par lui, débit comme crédit', () => {
    const r = importer(l, ligne('op-1', 'VIR CANTINE', euros(45), '2026-09-29', ENFANTS), ligne('op-2', 'VIR RECU', -euros(45), '2026-09-29', ENFANTS));
    expect(r.vers('op-1')).toBeUndefined();
    expect(r.vers('op-2')).toBeUndefined();
  });

  it('le libellé tiré d’un nom garde la reconnaissance d’aujourd’hui, hors du compte principal comme en crédit', () => {
    const r = importer(sansOrdre(l), ligne('op-1', 'TIRELIRE LIVRET A', euros(10), '2026-09-29', ENFANTS), ligne('op-2', 'TIRELIRE LIVRET A', -euros(10)));
    expect(r.vers('op-1')).toBe(LIVRET);
    expect(r.vers('op-2')).toBe(LIVRET);
  });
});

describe('[niveau 2] #206 · 5. renommer ne change pas ce qui est reconnu (point 5)', () => {
  it('après renommage, le libellé enregistré se reconnaît, celui du nouveau nom non, et une opération reconnue garde son compte', () => {
    const avant = exampleLedger();
    const déjà = { ...ligne('op-0', 'VIR PERMANENT TIRELIRE LIVRET A', euros(600), '2026-08-29'), state: 'reconciled' as const, transferAccountId: LIVRET };
    const après = renommer({ ...avant, operations: [...avant.operations, déjà] }, LIVRET, 'Livret Bleu');
    const r = importer(après, ligne('op-1', 'VIR PERMANENT TIRELIRE LIVRET A'), ligne('op-2', 'VIR PERMANENT TIRELIRE LIVRET BLEU'));
    expect(r.vers('op-1')).toBe(LIVRET);
    expect(r.vers('op-2')).toBeUndefined();
    expect(r.patch.operations.map((o) => o.id)).not.toContain('op-0');
  });
});

describe('[niveau 0] #206 · 4 et 5. la reconnaissance n’écrase rien', () => {
  it('point 4 — ne touche ni une opération verrouillée, ni une qui reprend, ni une déjà reconnue', () => {
    const l = exampleLedger();
    const verrouillée = { ...ligne('op-v', 'VIR TIRELIRE LIVRET A'), state: 'locked' as const };
    const reprend = { ...ligne('op-r', 'VIR TIRELIRE LIVRET A'), plannedFlowId: ORDRE, plannedDate: '2026-09-28' };
    const reconnue = { ...ligne('op-d', 'VIR TIRELIRE LIVRET A'), transferAccountId: 'acc-enfants' };
    expect(importer(l, verrouillée, reprend, reconnue).patch.operations).toEqual([]);
  });

  it('point 5 — après un renommage, une opération reconnue avant garde son compte, même vers un autre compte que celui de l’ordre', () => {
    const avant = exampleLedger();
    const déjà = { ...ligne('op-0', 'VIR PERMANENT TIRELIRE LIVRET A', euros(600), '2026-08-29'), state: 'reconciled' as const, transferAccountId: 'acc-enfants' };
    const après = renommer({ ...avant, operations: [...avant.operations, déjà] }, LIVRET, 'Livret Bleu');
    expect(importer(après).patch.operations).toEqual([]);
  });
});
