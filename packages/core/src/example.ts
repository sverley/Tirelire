/**
 * Jeu de données d'exemple : celui de l'analyse (§2 et §4), daté du 6 septembre 2026.
 * Sert aux tests et au bouton « charger l'exemple » de l'interface.
 */
import type { Ledger } from './model.js';
import { emptyLedger } from './model.js';
import { euros } from './money.js';

export function exampleLedger(): Ledger {
  const l = emptyLedger({ principalCushion: euros(600), periodStartDay: 28 });

  l.accounts.push(
    { id: 'acc-principal', name: 'Compte courant', kind: 'principal', openingBalance: euros(2340), openingDate: '2026-08-27' },
    { id: 'acc-livret', name: 'Livret A', kind: 'holding', openingBalance: euros(4815), openingDate: '2026-08-27' },
    {
      id: 'acc-enfants',
      name: 'Carte enfants',
      kind: 'third',
      openingBalance: 0,
      openingDate: '2026-08-27',
      settlementThreshold: euros(10),
      settlementDirection: 'both',
    },
    {
      id: 'acc-marie',
      name: 'Compte de Marie',
      kind: 'third',
      openingBalance: 0,
      openingDate: '2026-08-27',
      settlementThreshold: euros(10),
      settlementDirection: 'both',
    },
  );

  l.tirelires.push(
    { id: 'env-tf', name: 'Taxe foncière', placement: [{ accountId: 'acc-livret', share: { kind: 'variable' } }], openingBalance: euros(900), openingDate: '2026-08-27' },
    { id: 'env-auto', name: 'Assurance auto', placement: [{ accountId: 'acc-livret', share: { kind: 'variable' } }], openingBalance: euros(300), openingDate: '2026-08-27' },
    { id: 'env-vac', name: 'Vacances', placement: [{ accountId: 'acc-livret', share: { kind: 'variable' } }], openingBalance: euros(400), openingDate: '2026-08-27' },
    { id: 'env-precaution', name: 'Épargne de précaution', placement: [{ accountId: 'acc-livret', share: { kind: 'variable' } }], openingBalance: euros(3200), openingDate: '2026-08-27' },
    { id: 'env-alim', name: 'Alimentation', placement: [{ accountId: 'acc-principal', share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28', rollover: { mode: 'none' } },
    { id: 'env-essence', name: 'Essence', placement: [{ accountId: 'acc-principal', share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28', rollover: { mode: 'none' } },
    { id: 'env-divers', name: 'Divers et sorties', placement: [{ accountId: 'acc-principal', share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28', rollover: { mode: 'none' } },
    { id: 'env-enfants', name: 'Enfants et loisirs', placement: [{ accountId: 'acc-enfants', share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28', rollover: { mode: 'unlimited' } },
    { id: 'env-sante', name: 'Santé', placement: [{ accountId: 'acc-principal', share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28', rollover: { mode: 'none' } },
  );

  const monthlyNeed = (anchor: string) => ({ intervalMonths: 1, anchorDate: anchor });
  l.needs.push(
    { id: 'need-tf', tirelireId: 'env-tf', kind: 'dueDate', amount: euros(1200), periodicity: { intervalMonths: 12, anchorDate: '2026-10-15' }, priority: 10 },
    { id: 'need-auto', tirelireId: 'env-auto', kind: 'dueDate', amount: euros(600), periodicity: { intervalMonths: 12, anchorDate: '2027-03-05' }, priority: 10 },
    { id: 'need-vac', tirelireId: 'env-vac', kind: 'dueDate', amount: euros(2400), periodicity: { intervalMonths: 12, anchorDate: '2027-07-01' }, priority: 10 },
    { id: 'need-precaution', tirelireId: 'env-precaution', kind: 'goal', amount: euros(6000), monthlyAmount: euros(300), priority: 30 },
    { id: 'need-alim', tirelireId: 'env-alim', kind: 'recurring', amount: euros(900), periodicity: monthlyNeed('2026-08-28'), priority: 20 },
    { id: 'need-essence', tirelireId: 'env-essence', kind: 'recurring', amount: euros(200), periodicity: monthlyNeed('2026-08-28'), priority: 20 },
    { id: 'need-divers', tirelireId: 'env-divers', kind: 'recurring', amount: euros(250), periodicity: monthlyNeed('2026-08-28'), priority: 40 },
    { id: 'need-enfants', tirelireId: 'env-enfants', kind: 'recurring', amount: euros(200), periodicity: monthlyNeed('2026-08-28'), priority: 20 },
    { id: 'need-sante', tirelireId: 'env-sante', kind: 'recurring', amount: euros(100), periodicity: monthlyNeed('2026-08-28'), priority: 20 },
  );

  l.categories.push(
    { id: 'cat-salaire', name: 'Salaire', nature: 'income' },
    { id: 'cat-loyer', name: 'Loyer perçu', nature: 'income' },
    { id: 'cat-alloc', name: 'Allocations', nature: 'income' },
    { id: 'cat-alim', name: 'Alimentation', nature: 'expense', tirelireId: 'env-alim' },
    { id: 'cat-sante', name: 'Santé', nature: 'expense', tirelireId: 'env-sante' },
    { id: 'cat-enfants', name: 'Enfants', nature: 'expense', tirelireId: 'env-enfants' },
    { id: 'cat-logement', name: 'Logement', nature: 'expense' },
    { id: 'cat-assurance', name: 'Assurances', nature: 'expense' },
    { id: 'cat-abos', name: 'Abonnements', nature: 'expense' },
    { id: 'cat-transfert', name: 'Virement interne', nature: 'expense' },
  );

  const monthly = (anchor: string) => ({ intervalMonths: 1, anchorDate: anchor });
  l.plannedFlows.push(
    {
      id: 'flow-salaire',
      name: 'Salaire',
      kind: 'income',
      amount: euros(3400),
      accountId: 'acc-principal',
      categoryId: 'cat-salaire',
      periodicity: monthly('2026-08-28'),
      dateWindowDays: 3,
      amountTolerance: { pct: 10 },
      labelPattern: 'VIR(EMENT)? .*SALAIRE',
      variable: true,
    },
    {
      id: 'flow-loyer',
      name: 'Loyer locatif',
      kind: 'income',
      amount: euros(700),
      accountId: 'acc-principal',
      categoryId: 'cat-loyer',
      periodicity: monthly('2026-09-05'),
      dateWindowDays: 5,
      labelPattern: 'LOYER',
    },
    {
      id: 'flow-caf',
      name: 'Allocations',
      kind: 'income',
      amount: euros(100),
      accountId: 'acc-principal',
      categoryId: 'cat-alloc',
      periodicity: monthly('2026-09-05'),
      dateWindowDays: 5,
      labelPattern: 'CAF',
    },
    {
      id: 'flow-credit',
      name: 'Crédit immobilier',
      kind: 'fixedCharge',
      amount: euros(-950),
      accountId: 'acc-principal',
      categoryId: 'cat-logement',
      periodicity: monthly('2026-09-05'),
      dateWindowDays: 3,
      labelPattern: 'ECHEANCE PRET',
    },
    {
      id: 'flow-assur-hab',
      name: 'Assurance habitation',
      kind: 'fixedCharge',
      amount: euros(-45),
      accountId: 'acc-principal',
      categoryId: 'cat-assurance',
      periodicity: monthly('2026-09-10'),
      dateWindowDays: 3,
    },
    {
      id: 'flow-internet',
      name: 'Internet et mobiles',
      kind: 'fixedCharge',
      amount: euros(-75),
      accountId: 'acc-principal',
      categoryId: 'cat-abos',
      periodicity: monthly('2026-09-12'),
      dateWindowDays: 3,
    },
    {
      id: 'flow-electricite',
      name: 'Électricité',
      kind: 'fixedCharge',
      amount: euros(-150),
      accountId: 'acc-principal',
      categoryId: 'cat-logement',
      periodicity: monthly('2026-09-15'),
      dateWindowDays: 4,
      amountTolerance: { pct: 30 },
      variable: true,
    },
    {
      id: 'flow-tf',
      name: 'Taxe foncière (prélèvement)',
      kind: 'dueDate',
      amount: euros(-1200),
      accountId: 'acc-principal',
      tirelireId: 'env-tf',
      periodicity: { intervalMonths: 12, anchorDate: '2026-10-15' },
      dateWindowDays: 5,
      labelPattern: 'DGFIP|TAXE FONC',
    },
  );

  // Le salaire d'août est arrivé sur le compte principal ; puis les opérations manuelles des comptes tiers (§10).
  l.operations.push(
    {
      id: 'op-salaire-08',
      accountId: 'acc-principal',
      origin: 'manual',
      date: '2026-08-28',
      label: 'VIR SALAIRE AOUT',
      normalizedLabel: 'VIR SALAIRE AOUT',
      amount: euros(3400),
      state: 'reconciled',
      plannedFlowId: 'flow-salaire',
    },
    {
      id: 'op-dentiste',
      accountId: 'acc-marie',
      origin: 'manual',
      date: '2026-09-02',
      label: 'Dentiste (payé par Marie)',
      normalizedLabel: 'DENTISTE PAYE PAR MARIE',
      amount: euros(-80),
      state: 'locked',
    },
    {
      id: 'op-caf-marie',
      accountId: 'acc-marie',
      origin: 'manual',
      date: '2026-09-05',
      label: 'Allocations reçues sur le compte de Marie',
      normalizedLabel: 'ALLOCATIONS RECUES SUR LE COMPTE DE MARIE',
      amount: euros(100),
      state: 'locked',
    },
    {
      id: 'op-vir-enfants',
      accountId: 'acc-principal',
      origin: 'manual',
      date: '2026-08-28',
      label: 'VIR PERM TIRELIRE CARTE ENFANTS',
      normalizedLabel: 'VIR PERM TIRELIRE CARTE ENFANTS',
      amount: euros(-200),
      state: 'reconciled',
      transferAccountId: 'acc-enfants',
    },
    {
      id: 'op-enfants-1',
      accountId: 'acc-enfants',
      origin: 'manual',
      date: '2026-09-01',
      label: 'Fournitures scolaires',
      normalizedLabel: 'FOURNITURES SCOLAIRES',
      amount: euros(-146),
      state: 'locked',
    },
    {
      id: 'op-enfants-2',
      accountId: 'acc-enfants',
      origin: 'manual',
      date: '2026-09-04',
      label: 'Inscription judo',
      normalizedLabel: 'INSCRIPTION JUDO',
      amount: euros(-90),
      state: 'locked',
    },
  );
  l.allocations.push(
    { id: 'al-salaire-08', operationId: 'op-salaire-08', categoryId: 'cat-salaire', share: { kind: 'fixed', amount: euros(3400) } },
    { id: 'al-dentiste', operationId: 'op-dentiste', categoryId: 'cat-sante', tirelireId: 'env-sante', share: { kind: 'fixed', amount: euros(-80) } },
    { id: 'al-caf-marie', operationId: 'op-caf-marie', categoryId: 'cat-alloc', share: { kind: 'fixed', amount: euros(100) } },
    { id: 'al-vir-enfants', operationId: 'op-vir-enfants', categoryId: 'cat-transfert', tirelireId: 'env-enfants', share: { kind: 'fixed', amount: euros(-200) } },
    { id: 'al-enfants-1', operationId: 'op-enfants-1', categoryId: 'cat-enfants', tirelireId: 'env-enfants', share: { kind: 'fixed', amount: euros(-146) } },
    { id: 'al-enfants-2', operationId: 'op-enfants-2', categoryId: 'cat-enfants', tirelireId: 'env-enfants', share: { kind: 'fixed', amount: euros(-90) } },
  );

  return l;
}
