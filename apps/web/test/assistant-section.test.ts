/**
 * Tests du codeur de #363 — depuis un écran, l'assistant s'ouvre sur sa seule section : le brouillon
 * (`src/lib/brouillon.ts`), sans navigateur, sur un vrai dépôt (`LedgerStore`). Ce qui se voit à
 * l'écran — le bouton, le titre, la barre d'étapes, le résumé, le choix entre deux assistants — est
 * dans `navigateur/assistant-section.test.ts`.
 *
 * Chaque test dit, dans son titre, le point du « Fait quand » qu'il vérifie. Les autres sont passés
 * dans le harnais d'audit, `assistant-section-harnais.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { LedgerStore, MAIN_ACCOUNT_ID, alive, euros, type Account, type Ledger, type Need, type PlannedFlow, type Tirelire } from '@tirelire/core';
import { brouillonIntact, ecrire, montrer, nouveauBrouillon, preparerValidation, reglage, retirer, titreDeLAssistant, valider } from '../src/lib/brouillon';

const SQL = await initSqlJs();
const depot = () => LedgerStore.create({ sqlJs: SQL });
const ECHEANCE = { interval: 1, unit: 'month', anchorDate: '2026-09-05' } as const;

const epargne = (id: string, name: string): Account => ({ id, name, kind: 'epargne', openingBalance: 0, openingDate: '2026-09-01' });
const tirelire = (id: string, name: string): Tirelire => ({ id, name, placement: [], openingBalance: 0, openingDate: '2026-09-01' });
const besoin = (id: string, tirelireId: string): Need => ({ id, tirelireId, kind: 'recurring', amount: 5000, periodicity: ECHEANCE, priority: 1 });
const prelevement = (id: string, tirelireId: string): PlannedFlow => ({
  id,
  name: 'Taxe foncière',
  kind: 'dueDate',
  amount: -90000,
  accountId: MAIN_ACCOUNT_ID,
  action: { tirelireId },
  periodicity: { interval: 12, unit: 'month', anchorDate: '2026-10-15' },
  dateWindowDays: 7,
});
const salaire = (id: string): PlannedFlow => ({ id, name: 'Salaire', kind: 'income', amount: 200000, accountId: MAIN_ACCOUNT_ID, periodicity: ECHEANCE, dateWindowDays: 3 });
const noms = (projet: Ledger, cle: 'accounts' | 'tirelires' | 'plannedFlows' | 'needs') => alive(projet[cle] as Array<{ id: string; name?: string; deletedAt?: string }>).map((l) => l.name ?? l.id).sort();

describe('[niveau 4] #363 · 2 et 5 — le titre, et un retrait de la section', () => {
  it('le titre nomme la section', () => {
    expect([titreDeLAssistant('comptes'), titreDeLAssistant('tirelires'), titreDeLAssistant()]).toEqual(['Compléter mes comptes', 'Compléter mes tirelires', 'Construire mon budget']);
  });

  it('un retrait de la section reste dans la section : retirer une tirelire ne touche pas aux comptes', async () => {
    const store = await depot();
    store.upsert('accounts', epargne('livret', 'Livret A'));
    store.upsert('tirelires', { ...tirelire('t-vac', 'Vacances'), placement: [{ accountId: 'livret', share: { kind: 'variable' } }] });
    store.upsert('needs', besoin('n-vac', 't-vac'));
    const projet = store.load();
    const b = nouveauBrouillon(projet, 'tirelires');
    retirer(b, projet, 'needs', 'n-vac');
    retirer(b, projet, 'tirelires', 't-vac');
    valider(store, projet, b);
    const apres = store.load();
    expect(alive(apres.tirelires)).toEqual([]);
    expect(noms(apres, 'accounts')).toContain('Livret A');
  });
});
