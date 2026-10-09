/**
 * Tests du codeur de #409, tour 2, sans navigateur : ce que montre la carte d'un ordre permanent
 * dans l'assistant (`carteDeLOrdre`, `partsDeLOrdre`, `src/lib/brouillon.ts`), lue comme la lit
 * `VentilationOrdre.svelte` (`lireVentilation`), sur un vrai dépôt (`LedgerStore`) qui porte le
 * budget de l'exemple. Les deux tests « #409 · 5 et 6 » sont passés au harnais d'audit
 * (`budget-json-ligne-retiree-harnais.test.ts`) ; restent ici, au niveau 4, ceux de #407 et de #395.
 *
 * L'ordre « Virement Livret A » (600 €) a trois parts fixes — Taxe foncière (100 €), Assurance auto
 * (50 €), Vacances (150 €) — et la part variable d'Épargne de précaution.
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { LedgerStore, MAIN_ACCOUNT_ID, alive, budgetDefiniEnJson, euros, exampleLedger, lireBudgetJson, type Ledger, type PlannedFlow } from '@tirelire/core';
import { brouillonDuFichier, carteDeLOrdre, fichierAEnregistrer, montrer, nouveauBrouillon, ordreEnregistre, retirer, type Brouillon } from '../src/lib/brouillon';
import { lireVentilation } from '../src/lib/ventilationOrdre';

const SQL = await initSqlJs();
const ORDRE = 'flow-vir-livret';
const ORDRE_ENFANTS = 'flow-vir-enfants';
const MAINTENANT = '2026-09-06T08:00:00.000Z';

/** Un ordre de 200 € du compte principal vers la Carte enfants, sans part. */
const ordreEnfants = (): PlannedFlow => ({
  id: ORDRE_ENFANTS,
  name: 'Virement Carte enfants',
  kind: 'transfer',
  amount: euros(-200),
  accountId: MAIN_ACCOUNT_ID,
  counterpartAccountId: 'acc-enfants',
  periodicity: { unit: 'month', interval: 1, anchorDate: '2026-08-28' },
  dateWindowDays: 5,
});

/** Le dépôt de l'exemple, l'ordre vers la Carte enfants en plus ; puis les tirelires et les comptes retirés, comme à l'écran. */
async function depot(tirelires: string[] = [], comptes: string[] = []): Promise<LedgerStore> {
  const s = await LedgerStore.create({ sqlJs: SQL, siteId: 't' });
  const l = exampleLedger();
  // La tirelire placée sur la Carte enfants ne l'est plus : le placement sur un compte retiré est hors de #409.
  l.tirelires = l.tirelires.map((t) => (t.id === 'env-enfants' ? { ...t, placement: [] } : t));
  l.plannedFlows.push(ordreEnfants());
  for (const k of ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows'] as const) for (const r of l[k]) s.upsert(k, r as never);
  for (const id of tirelires) {
    for (const n of alive(s.load().needs).filter((x) => x.tirelireId === id)) s.remove('needs', n.id);
    s.remove('tirelires', id);
  }
  for (const id of comptes) s.remove('accounts', id);
  return s;
}

/** Le brouillon enregistré depuis l'assistant sur `source`, repris sur un projet vierge. */
async function reprisSurUnProjetVierge(source: LedgerStore): Promise<{ s: LedgerStore; b: Brouillon }> {
  const projet = source.load();
  const lu = lireBudgetJson(JSON.stringify(budgetDefiniEnJson(fichierAEnregistrer(projet, nouveauBrouillon(projet), MAINTENANT))));
  if (!lu.ok) throw new Error(lu.message);
  const s = await LedgerStore.create({ sqlJs: SQL, siteId: 'u' });
  return { s, b: brouillonDuFichier(s.load(), lu.budget) };
}

const ordreMontre = (montre: Ledger, id: string) => montre.plannedFlows.find((f) => f.id === id && !f.deletedAt)!;
/** La carte de l'ordre `id`, et sa ventilation lue comme la lit `VentilationOrdre.svelte`. */
function carte(projet: Ledger, b: Brouillon, id: string) {
  const montre = montrer(projet, b);
  const c = carteDeLOrdre(projet, montre, b, ordreMontre(montre, id), MAIN_ACCOUNT_ID);
  const { montant, allocation, noms } = c.ventilation;
  return { ...c, lecture: lireVentilation(montant, allocation, noms), montre };
}

describe('[niveau 4] #407 · 8 et #395 — la carte d’un ordre enregistré et de l’ordre proposé', () => {
  it('un ordre enregistré montre la part de la tirelire retirée dans le projet, marquée comme retirée', async () => {
    const s = await depot(['env-auto']);
    const projet = s.load();
    const b = nouveauBrouillon(projet);
    expect(ordreEnregistre(projet, ORDRE)).toBe(true);
    const auto = carte(projet, b, ORDRE).lecture.lignes.find((l) => l.tirelireId === 'env-auto');
    expect(auto).toMatchObject({ nom: 'Assurance auto', retiree: true });
  });

  it('un ordre enregistré garde, sur sa carte, la part d’une tirelire retirée dans l’assistant, marquée comme retirée', async () => {
    const s = await depot();
    const projet = s.load();
    const b = nouveauBrouillon(projet);
    for (const n of alive(montrer(projet, b).needs).filter((x) => x.tirelireId === 'env-auto')) retirer(b, projet, 'needs', n.id);
    retirer(b, projet, 'tirelires', 'env-auto');
    expect(carte(projet, b, ORDRE).lecture.lignes.find((l) => l.tirelireId === 'env-auto')).toMatchObject({ nom: 'Assurance auto', retiree: true });
  });

  it('l’ordre que le projet ne porte pas perd la part d’une tirelire retirée dans l’assistant : elle n’est pas « retirée par le fichier »', async () => {
    const source = await depot();
    const { s, b } = await reprisSurUnProjetVierge(source);
    const projet = s.load();
    for (const n of alive(montrer(projet, b).needs).filter((x) => x.tirelireId === 'env-auto')) retirer(b, projet, 'needs', n.id);
    retirer(b, projet, 'tirelires', 'env-auto');
    const c = carte(projet, b, ORDRE);
    expect(c.lecture.lignes.map((l) => l.nom)).toEqual(['Taxe foncière', 'Vacances', 'Épargne de précaution']);
    expect(c.lecture.lignes.some((l) => l.retiree)).toBe(false);
  });
});
