/**
 * Harnais d'audit de #209 — « Le compte principal existe dans toute base, même vide », second
 * fichier : les niveaux 2 à 4, hors registre (D81). Le premier, `compte-principal.test.ts`, dit ce que
 * le harnais mesure et comment ; ce fichier reprend le point 6 du « Fait quand » : ce qui tenait tient.
 *
 * 6. L'exemple, chargé comme l'application le fait (`replaceWith`), donne le même plan qu'avant #209
 *    à trois dates ; un relevé inventé (D84) importé sur le compte principal, comme l'écran Import
 *    (`prepareImport`, puis la chaîne automatique), donne les mêmes opérations, rapprochements et
 *    ventilations compris. L'identifiant du compte principal peut changer avec #209 : il est
 *    remplacé par « principal » des deux côtés avant comparaison, et les identifiants des
 *    opérations importées ne sont pas comparés (ils portent le compte, D09).
 *
 * Ce que `main` donnait avant #209 est dans `compte-principal-209.avant.json` : les plans au
 * 6 septembre 2026, au 20 octobre 2026 et au 10 janvier 2027, et l'import du relevé ci-dessous.
 *
 * Niveaux (D83) : 2 — un résultat faux, l'usage restant possible.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import {
  LedgerStore,
  addDays,
  bankMultiAccountProfile,
  computePlan,
  exampleLedger,
  parseCsv,
  parseRows,
  prepareImport,
  rankBetween,
  runPipeline,
  type Ledger,
} from '@tirelire/core';

const SQL = await initSqlJs();
const CLES = ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows', 'operations', 'subOperations', 'shortfallAnswers', 'automations', 'importProfiles', 'devices'] as const;
type Cle = (typeof CLES)[number];
type Ligne = Record<string, unknown> & { id: string };
const DATES = ['2026-09-06', '2026-10-20', '2027-01-10'];
const AVANT = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'compte-principal-209.avant.json'), 'utf8')) as {
  plans: Record<string, unknown>;
  releve: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Outils
// ─────────────────────────────────────────────────────────────────────────────────────────────

function instance(): Promise<LedgerStore> {
  return LedgerStore.create({ sqlJs: SQL });
}

function lignes(store: LedgerStore, cle: Cle): Ligne[] {
  return (store.load()[cle] as unknown as Ligne[]).slice();
}

/** Le compte principal vivant d'une base : un et un seul, sinon le premier fichier l'a déjà dit. */
function principal(store: LedgerStore): Ligne {
  const p = lignes(store, 'accounts').filter((a) => a['kind'] === 'principal' && !a['deletedAt']);
  expect(p.length, 'la base n’a pas un compte principal et un seul').toBe(1);
  return p[0]!;
}

/** Charge l'exemple comme l'application (`replaceWith`) : toutes les tables, puis les réglages. */
function charger(store: LedgerStore, l: Ledger = exampleLedger()): void {
  for (const cle of CLES) for (const r of l[cle] as unknown as Ligne[]) store.upsert(cle, r as never);
  for (const [k, v] of Object.entries(l.settings)) if (k !== 'siteId') store.setSetting(k as never, v as never);
}

const NUM_PRINCIPAL = '00011111209';
const NUM_LIVRET = '00022222209';

/** Relevé inventé (D84), au format des exports bancaires français : le compte principal et le livret de l'exemple. */
const RELEVE = [
  'Date transaction;Date comptabilisation;Num Compte;Libellé Compte;Libellé opération;Libellé complet;Catégorie;Sous-Catégorie;Montant;Pointée;',
  '28/08/2026;28/08/2026;00011111209;Compte Courant;VIR SEPA RECU SALAIRE EMPLOYEUR;VIR SEPA RECU DE: EMPLOYEUR SA MOTIF: SALAIRE AOUT;Revenus du travail;Salaires;3400,00;Non;',
  '01/09/2026;01/09/2026;00011111209;Compte Courant;VIR TIRELIRE LIVRET A;VIR PERMANENT TIRELIRE LIVRET A;Épargne;Virement interne;-600,00;Non;',
  '01/09/2026;01/09/2026;00022222209;Livret A;VIR TIRELIRE LIVRET A;VIR PERMANENT TIRELIRE LIVRET A;Épargne;Virement interne;600,00;Non;',
  '03/09/2026;03/09/2026;00011111209;Compte Courant;CARTE X2009 02/09 SUPERMARCHE;CARTE X2009 02/09 SUPERMARCHE DU BOURG;Vie quotidienne;Alimentation;-85,40;Non;',
  '03/09/2026;03/09/2026;00011111209;Compte Courant;CARTE X2009 02/09 SUPERMARCHE;CARTE X2009 02/09 SUPERMARCHE DU BOURG;Vie quotidienne;Alimentation;-85,40;Non;',
  '04/09/2026;04/09/2026;00011111209;Compte Courant;CARTE X2009 03/09 BOULANGERIE DU COIN;CARTE X2009 03/09 BOULANGERIE DU COIN;Vie quotidienne;Alimentation;-12,30;Non;',
  '05/09/2026;05/09/2026;00011111209;Compte Courant;ECHEANCE PRET IMMO 000123;ECHEANCE PRET IMMO 000123;Logement;Crédit;-950,00;Non;',
  '05/09/2026;05/09/2026;00011111209;Compte Courant;VIR LOYER LOCATAIRE;VIR SEPA RECU DE: LOCATAIRE MOTIF: LOYER SEPTEMBRE;Revenus;Loyers;700,00;Non;',
  '05/09/2026;05/09/2026;00011111209;Compte Courant;VIR CAF ALLOCATIONS;VIR SEPA RECU DE: CAF;Revenus;Allocations;100,00;Non;',
].join('\r\n');

/** L'import comme l'écran Import (`doImport`) : profil sur le compte principal, opérations retenues, puis la chaîne automatique. */
function importer(store: LedgerStore): void {
  const p = bankMultiAccountProfile('profil-209');
  p.accountMap = { [NUM_PRINCIPAL]: principal(store).id, [NUM_LIVRET]: 'acc-livret' };
  store.upsert('importProfiles', p as never);
  store.upsert('automations', { id: 'auto-supermarche-209', name: 'Supermarché', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim' }, rank: rankBetween(undefined, undefined) } as never);
  const lu = parseRows(parseCsv(RELEVE), p);
  expect(lu.errors, 'le relevé inventé ne se lit pas').toEqual([]);
  const prep = prepareImport(store.load(), lu.rows, p);
  const ops = prep.candidates.filter((c) => (c.exact ? false : c.probable ? (c.similarity ?? 0) < 0.5 : true)).map((c) => c.operation);
  for (const o of ops) store.upsert('operations', o);
  const dates = ops.map((o) => o.date).sort();
  if (!dates.length) return;
  runPipeline(store.load(), dates[0]!, addDays(dates[dates.length - 1]!, 1), (patch) => {
    for (const o of patch.operations) store.upsert('operations', o);
    for (const a of patch.subOperations) store.upsert('subOperations', a);
    for (const id of patch.removedSubOperations ?? []) store.remove('subOperations', id);
    return store.load();
  });
}

/** Les opérations importées, sans leurs identifiants, chaque virement désignant son pendant par son rang. */
function releve(store: LedgerStore): unknown {
  const ops = lignes(store, 'operations').filter((o) => o['origin'] === 'imported' && !o['deletedAt']);
  const cle = (o: Ligne) => [o['accountId'], o['date'], o['label'], o['amount']].join('|');
  const tries = [...ops].sort((a, b) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0));
  const rang = new Map(tries.map((o, i) => [o.id, i]));
  const ventilations = lignes(store, 'subOperations').filter((a) => !a['deletedAt']);
  const ou_ = (v: unknown) => v ?? null;
  return tries.map((o) => ({
    accountId: o['accountId'],
    date: o['date'],
    label: o['label'],
    details: ou_(o['details']),
    amount: o['amount'],
    state: o['state'],
    oneOff: ou_(o['oneOff']),
    plannedFlowId: ou_(o['plannedFlowId']),
    transferAccountId: ou_(o['transferAccountId']),
    transfer: o['transferOperationId'] ? (rang.get(String(o['transferOperationId'])) ?? 'inconnue') : null,
    allocations: ventilations
      .filter((a) => a['operationId'] === o.id)
      .map((a) => ({ categoryId: ou_(a['categoryId']), tirelireId: ou_(a['tirelireId']), share: ou_(a['share']), replenishment: ou_(a['replenishment']) }))
      .map((a) => JSON.stringify(a))
      .sort(),
  }));
}

/** Une valeur, l'identifiant du compte principal remplacé par « principal », pour comparer par-delà #209. */
function sansIdentite(v: unknown, id: string): unknown {
  return JSON.parse(JSON.stringify(v).split(JSON.stringify(id).slice(1, -1)).join('principal'));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Assertions, partagées avec les témoins rouges
// ─────────────────────────────────────────────────────────────────────────────────────────────

function verifierMemePlan(plans: Record<string, unknown>): void {
  for (const [date, attendu] of Object.entries(AVANT.plans)) expect(plans[date], `le plan du ${date} n’est plus celui d’avant #209`).toEqual(attendu);
}

function verifierMemeReleve(vu: unknown): void {
  expect(vu, 'l’import du relevé ne donne plus les mêmes opérations qu’avant #209').toEqual(AVANT.releve);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 6. Ce qui tenait tient encore
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('#209 · 6. ce qui tenait tient encore', () => {
  it('l’exemple se charge et donne le même plan qu’avant, à trois dates [niveau 2]', async () => {
    const s = await instance();
    charger(s);
    const id = principal(s).id;
    verifierMemePlan(Object.fromEntries(DATES.map((d) => [d, sansIdentite(computePlan(s.load(), d), id)])));
  });

  it('un relevé importé sur le compte principal donne les mêmes opérations, classements compris [niveau 2]', async () => {
    const s = await instance();
    charger(s);
    importer(s);
    verifierMemeReleve(sansIdentite(releve(s), principal(s).id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Témoins rouges : les mêmes assertions, sur une version volontairement cassée du besoin
// ─────────────────────────────────────────────────────────────────────────────────────────────

it.fails('témoin rouge · un plan qui n’est plus celui d’avant [niveau 2]', () => {
  verifierMemePlan(Object.fromEntries(DATES.map((d) => [d, { totals: {} }])));
});

it.fails('témoin rouge · un import qui perd une opération [niveau 2]', () => {
  verifierMemeReleve((AVANT.releve as unknown[]).slice(1));
});
