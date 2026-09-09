/**
 * Jeu de données d'exemple : celui de l'analyse (§2 et §4), daté du 6 septembre 2026.
 * Sert aux tests, au bouton « charger l'exemple » de l'interface, et aux propositions de
 * l'assistant, qui n'ont pas d'autre source (D43).
 *
 * Il porte aussi des **changements datés** (D51) : une révision déjà appliquée, deux à venir, un
 * besoin qui apparaît et une charge qui s'arrête. Tous sont placés hors de la période en cours,
 * si bien que le plan du 6 septembre est celui de l'analyse, inchangé ; c'est en avançant de
 * période en période qu'on les voit prendre effet.
 */
import type { Ledger } from './model.js';
import { emptyLedger } from './model.js';
import { euros } from './money.js';

export function exampleLedger(): Ledger {
  const l = emptyLedger({ principalCushion: euros(600), periodStartDay: 28 });

  l.accounts.push(
    { id: 'acc-principal', name: 'Compte courant', kind: 'principal', openingBalance: euros(2340), openingDate: '2026-08-27' },
    { id: 'acc-livret', name: 'Livret A', kind: 'epargne', openingBalance: euros(4815), openingDate: '2026-08-27' },
    {
      id: 'acc-enfants',
      name: 'Carte enfants',
      kind: 'courant',
      tracksSettlement: true,
      openingBalance: 0,
      openingDate: '2026-08-27',
      settlementThreshold: euros(10),
      settlementDirection: 'both',
    },
    {
      id: 'acc-marie',
      name: 'Compte de Marie',
      kind: 'courant',
      tracksSettlement: true,
      openingBalance: 0,
      openingDate: '2026-08-27',
      settlementThreshold: euros(10),
      settlementDirection: 'both',
    },
    // Un compte clos (D56) : vidé et fermé avant la période en cours, il ne pèse donc rien sur le
    // plan, mais il donne à l'écran Comptes le cas que le filtre d'état sert à ranger.
    {
      id: 'acc-livret-jeune',
      name: 'Livret jeune',
      kind: 'epargne',
      openingBalance: 0,
      openingDate: '2026-08-27',
      activeTo: '2026-06-30',
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

  const monthlyNeed = (anchor: string) => ({ interval: 1, unit: 'month' as const, anchorDate: anchor });
  l.needs.push(
    { id: 'need-tf', tirelireId: 'env-tf', kind: 'dueDate', amount: euros(1200), periodicity: { interval: 12, unit: 'month' as const, anchorDate: '2026-10-15' }, priority: 10 },
    { id: 'need-auto', tirelireId: 'env-auto', kind: 'dueDate', amount: euros(600), periodicity: { interval: 12, unit: 'month' as const, anchorDate: '2027-03-05' }, priority: 10 },
    { id: 'need-vac', tirelireId: 'env-vac', kind: 'dueDate', amount: euros(2400), periodicity: { interval: 12, unit: 'month' as const, anchorDate: '2027-07-01' }, priority: 10 },
    { id: 'need-essence', tirelireId: 'env-essence', kind: 'recurring', amount: euros(200), periodicity: monthlyNeed('2026-08-28'), priority: 20 },
    { id: 'need-enfants', tirelireId: 'env-enfants', kind: 'recurring', amount: euros(200), periodicity: monthlyNeed('2026-08-28'), priority: 20 },
    { id: 'need-sante', tirelireId: 'env-sante', kind: 'recurring', amount: euros(100), periodicity: monthlyNeed('2026-08-28'), priority: 20 },
  );

  // ------------------------------------------------------------------------
  // Budgets datés (D50, D51) : trois révisions et une apparition, placées de part et d'autre de la
  // période en cours pour qu'on puisse les regarder venir depuis le plan. Les périodes commencent
  // le 28 : septembre = 28/08 → 27/09, octobre = 28/09 → 27/10, novembre = 28/10 → 27/11,
  // décembre = 28/11 → 27/12, janvier = 28/12 → 27/01. Rien de tout cela ne touche la période en
  // cours : à la date de l'exemple, une seule version de chaque budget est en vigueur.
  // ------------------------------------------------------------------------

  // Révision déjà faite : « Divers et sorties » était à 300 € et a été ramené à 250 € au 28 août.
  // La version close reste lisible dans l'écran Tirelires et ne dote plus rien.
  l.needs.push(
    { id: 'need-divers-avant', tirelireId: 'env-divers', kind: 'recurring', amount: euros(300), periodicity: monthlyNeed('2026-01-28'), priority: 40, activeTo: '2026-08-27' },
    { id: 'need-divers', tirelireId: 'env-divers', kind: 'recurring', amount: euros(250), periodicity: monthlyNeed('2026-08-28'), priority: 40, activeFrom: '2026-08-28' },
  );

  // Révision à venir : l'alimentation passe de 900 à 950 € à partir de la période de novembre.
  // Septembre et octobre restent dotés à 900 — c'est tout l'objet de D50.
  l.needs.push(
    { id: 'need-alim', tirelireId: 'env-alim', kind: 'recurring', amount: euros(900), periodicity: monthlyNeed('2026-08-28'), priority: 20, activeTo: '2026-10-27' },
    { id: 'need-alim-apres', tirelireId: 'env-alim', kind: 'recurring', amount: euros(950), periodicity: monthlyNeed('2026-10-28'), priority: 20, activeFrom: '2026-10-28' },
  );

  // Besoin qui apparaît en cours d'année : un enfant commence le piano en novembre. Deuxième besoin
  // sur une tirelire qui en portait un seul (D28), et ligne de plan qui n'existe pas avant.
  l.needs.push({
    id: 'need-piano',
    tirelireId: 'env-enfants',
    kind: 'recurring',
    name: 'Cours de piano',
    amount: euros(45),
    periodicity: monthlyNeed('2026-10-28'),
    priority: 20,
    activeFrom: '2026-10-28',
  });

  // Le crédit immobilier se termine le 5 décembre (voir `flow-credit`) : l'épargne de précaution
  // reprend la mensualité libérée à partir de janvier, avec une cible relevée.
  l.needs.push(
    { id: 'need-precaution', tirelireId: 'env-precaution', kind: 'goal', amount: euros(6000), monthlyAmount: euros(300), priority: 30, activeTo: '2026-12-27' },
    { id: 'need-precaution-apres', tirelireId: 'env-precaution', kind: 'goal', amount: euros(12000), monthlyAmount: euros(800), priority: 30, activeFrom: '2026-12-28' },
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

  const monthly = (anchor: string) => ({ interval: 1, unit: 'month' as const, anchorDate: anchor });
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
      // Augmentation à la paie de novembre : le flux est clos et `flow-salaire-apres` prend la
      // suite (D23). Les revenus de septembre et d'octobre gardent le montant qui était le leur.
      activeTo: '2026-10-27',
    },
    {
      id: 'flow-salaire-apres',
      name: 'Salaire',
      kind: 'income',
      amount: euros(3550),
      accountId: 'acc-principal',
      categoryId: 'cat-salaire',
      periodicity: monthly('2026-10-28'),
      dateWindowDays: 3,
      amountTolerance: { pct: 10 },
      labelPattern: 'VIR(EMENT)? .*SALAIRE',
      variable: true,
      activeFrom: '2026-10-28',
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
      // Dernière échéance le 5 décembre : à partir de janvier, 950 € cessent de partir. C'est le
      // changement le plus spectaculaire du jeu d'exemple, et il ne demande qu'une date.
      activeTo: '2026-12-05',
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
      periodicity: { interval: 12, unit: 'month' as const, anchorDate: '2026-10-15' },
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
