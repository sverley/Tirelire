/**
 * Plomberie commune aux parcours de bout en bout des usages (#70, #38, #58).
 *
 * Un parcours ne part pas d'un grand livre écrit à la main : il part d'une **base vide**, écrit par
 * `upsert` / `setSetting` comme le fait l'application (D84), et relit ce qui a été persisté.
 * C'est ce qui le distingue des harnais unitaires du cœur, qui éprouvent un calcul sur un grand
 * livre déjà constitué.
 *
 * Ce que ces parcours ne gardent pas : ce qui se voit à l'écran. Les écrans restent tenus par les
 * vérifications manuelles des usages (`VM-U1-parcours`, `VM-U2-ordres`, `VM-U5-sans-tirelire`) et
 * par les harnais d'interface, qui demandent un navigateur.
 */
import initSqlJs from 'sql.js';
import { LedgerStore, euros, type Ledger, type Patch } from '../src/index.js';

const SQL = await initSqlJs();

/** Jour de paie (D02) : la période en cours va du 28 août au 27 septembre. */
export const PAIE = 28;
export const DEBUT = '2026-08-28';
export const AS_OF = '2026-09-20';

export const PRINCIPAL = 'cpt-principal';
export const LIVRET = 'cpt-livret';

/** Ouvre une base neuve, comme au premier lancement de l'application. */
export function baseVide(site: string): Promise<LedgerStore> {
  return LedgerStore.create({ sqlJs: SQL, siteId: site });
}

/** Ferme et rouvre la base depuis ses octets : ce que fait l'application au redémarrage. */
export async function relire(store: LedgerStore, site: string): Promise<Ledger> {
  const repris = await LedgerStore.create({ sqlJs: SQL, siteId: site, bytes: store.export() });
  const ledger = repris.load();
  repris.close();
  return ledger;
}

/** Écrit un patch d'un seul coup, comme l'écran des opérations (`state.svelte.ts`). */
export function ecrire(store: LedgerStore, patch: Patch): void {
  for (const o of patch.operations) store.upsert('operations', o);
  for (const a of patch.allocations) store.upsert('allocations', a);
  for (const id of patch.removedAllocations ?? []) store.remove('allocations', id);
}

const mensuel = (anchorDate: string) => ({ interval: 1, unit: 'month' as const, anchorDate });

/**
 * Le budget que l'assistant construit (D40), écrit ligne à ligne : deux comptes, un revenu, une
 * charge fixe, trois tirelires — un budget courant hébergé sur le compte principal, une échéance et
 * un objectif placés sur le livret — et leurs besoins. Aucune opération : c'est tout le propos.
 *
 * Les deux ancrages que l'assistant doit poser pour que le budget se voie dès la période en cours
 * sont ceux de `assistant.test.ts` : tirelires ouvertes au début de la période, flux ancrés sur la
 * dernière occurrence passée.
 */
export function ecrireLeBudget(store: LedgerStore): void {
  store.setSetting('periodStartDay', PAIE);
  store.upsert('accounts', { id: PRINCIPAL, name: 'Compte principal', kind: 'principal', openingBalance: euros(1500), openingDate: DEBUT });
  store.upsert('accounts', { id: LIVRET, name: 'Livret A', kind: 'epargne', openingBalance: 0, openingDate: DEBUT });

  store.upsert('plannedFlows', { id: 'flux-salaire', name: 'Salaire', kind: 'income', amount: euros(2400), accountId: PRINCIPAL, periodicity: mensuel(DEBUT), dateWindowDays: 5 });
  store.upsert('plannedFlows', { id: 'flux-loyer', name: 'Loyer', kind: 'fixedCharge', amount: euros(-750), accountId: PRINCIPAL, periodicity: mensuel('2026-09-05'), dateWindowDays: 5 });

  store.upsert('tirelires', { id: 'tir-courses', name: 'Courses', placement: [{ accountId: PRINCIPAL, share: { kind: 'variable' } }], openingBalance: 0, openingDate: DEBUT, rollover: { mode: 'none' } });
  store.upsert('tirelires', { id: 'tir-taxe', name: 'Taxe foncière', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: DEBUT, rollover: { mode: 'unlimited' } });
  store.upsert('tirelires', { id: 'tir-vacances', name: 'Vacances', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: DEBUT, rollover: { mode: 'unlimited' } });

  store.upsert('needs', { id: 'bes-courses', tirelireId: 'tir-courses', kind: 'recurring', amount: euros(500), periodicity: mensuel(DEBUT), priority: 20 });
  store.upsert('needs', { id: 'bes-taxe', tirelireId: 'tir-taxe', kind: 'dueDate', amount: euros(1200), periodicity: { interval: 12, unit: 'month' as const, anchorDate: '2026-10-15' }, priority: 10 });
  store.upsert('needs', { id: 'bes-vacances', tirelireId: 'tir-vacances', kind: 'goal', amount: euros(3000), monthlyAmount: euros(200), priority: 30 });
}
