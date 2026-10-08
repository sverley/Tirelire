/**
 * Tests du codeur de #363 — depuis un écran, l'assistant s'ouvre sur sa seule section : le brouillon
 * (`src/lib/brouillon.ts`), sans navigateur, sur un vrai dépôt (`LedgerStore`). Ce qui se voit à
 * l'écran — le bouton, le titre, la barre d'étapes, le résumé, le choix entre deux assistants — est
 * dans `navigateur/assistant-section.test.ts`.
 *
 * Chaque test dit, dans son titre, le point du « Fait quand » qu'il vérifie.
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

describe('[niveau 4] #363 · 2 et 3 — ouvert sur une section, le brouillon ne couvre qu’elle, et ne propose d’office que ce qu’elle porte', () => {
  it('le titre nomme la section', () => {
    expect([titreDeLAssistant('comptes'), titreDeLAssistant('tirelires'), titreDeLAssistant()]).toEqual(['Compléter mes comptes', 'Compléter mes tirelires', 'Construire mon budget']);
  });

  it('section Tirelires, projet vierge : ouvert sur « Budgets », sans le jour de début de période ni le coussin de l’exemple', async () => {
    const projet = (await depot()).load();
    const b = nouveauBrouillon(projet, 'tirelires');
    expect(b.etape).toBe('everyday');
    expect(b.section).toBe('tirelires');
    expect(b.projetVierge).toBe(true);
    expect(b.reglagesProposes).toEqual({});
    expect(Object.keys(b.fichier.tables).sort()).toEqual(['needs', 'tirelires']);
    expect(b.fichier.settings).toEqual({});
    expect(montrer(projet, b).settings).toMatchObject({ periodStartDay: 1, principalCushion: 0 });
  });

  it('section Comptes, projet vierge : ouvert sur « Comptes », avec le coussin de l’exemple et sans le jour de début de période', async () => {
    const projet = (await depot()).load();
    const b = nouveauBrouillon(projet, 'comptes');
    expect(b.etape).toBe('accounts');
    expect(b.reglagesProposes).toEqual({ principalCushion: euros(600) });
    expect(Object.keys(b.fichier.tables)).toEqual(['accounts']);
    expect(montrer(projet, b).settings).toMatchObject({ periodStartDay: 1, principalCushion: euros(600) });
  });

  it('sur un autre projet, rien ne se propose d’office', async () => {
    const store = await depot();
    store.upsert('accounts', epargne('livret', 'Livret A'));
    const b = nouveauBrouillon(store.load(), 'comptes');
    expect(b.projetVierge).toBe(false);
    expect(b.reglagesProposes).toEqual({});
    expect(brouillonIntact(b)).toBe(true);
  });
});

describe('[niveau 4] #363 · 5 — la validation n’écrit que la section', () => {
  it('section Tirelires : les tirelires, besoins et prélèvements entrent ; aucun compte, ni le jour de début de période, ni le coussin', async () => {
    const store = await depot();
    const projet = store.load();
    const b = nouveauBrouillon(projet, 'tirelires');
    ecrire(b, 'tirelires', tirelire('t-taxe', 'Taxe foncière'));
    ecrire(b, 'needs', besoin('n-taxe', 't-taxe'));
    ecrire(b, 'plannedFlows', prelevement('f-taxe', 't-taxe')); // la table des flux entre dans le fichier à ce geste
    valider(store, projet, b);
    const apres = store.load();
    expect(noms(apres, 'tirelires')).toEqual(['Taxe foncière']);
    expect(noms(apres, 'needs')).toEqual(['n-taxe']);
    expect(noms(apres, 'plannedFlows')).toEqual(['Taxe foncière']);
    expect(alive(apres.accounts).map((a) => a.id)).toEqual([MAIN_ACCOUNT_ID]);
    expect(apres.settings).toMatchObject({ periodStartDay: 1, principalCushion: 0 });
  });

  it('section Comptes : le compte et le coussin entrent ; ni tirelire ni flux', async () => {
    const store = await depot();
    const projet = store.load();
    const b = nouveauBrouillon(projet, 'comptes');
    ecrire(b, 'accounts', epargne('livret', 'Livret A'));
    valider(store, projet, b);
    const apres = store.load();
    expect(noms(apres, 'accounts')).toContain('Livret A');
    expect(apres.settings).toMatchObject({ periodStartDay: 1, principalCushion: euros(600) });
    expect(alive(apres.tirelires)).toEqual([]);
    expect(alive(apres.plannedFlows)).toEqual([]);
  });

  it('ce que le projet a changé ailleurs pendant ce temps reste, hors de la section comme dans les tables qu’elle a fait entrer', async () => {
    const store = await depot();
    store.upsert('plannedFlows', salaire('f-salaire'));
    store.upsert('accounts', epargne('livret', 'Livret A'));
    const projet = store.load();
    const b = nouveauBrouillon(projet, 'tirelires');
    ecrire(b, 'tirelires', tirelire('t-taxe', 'Taxe foncière'));
    ecrire(b, 'needs', besoin('n-taxe', 't-taxe'));
    ecrire(b, 'plannedFlows', prelevement('f-taxe', 't-taxe'));
    // Ailleurs, pendant que le brouillon attend : un compte renommé, un salaire changé, le jour de début de période.
    store.upsert('accounts', { ...epargne('livret', 'Livret Bleu') });
    store.upsert('plannedFlows', { ...salaire('f-salaire'), amount: 210000 });
    store.setSetting('periodStartDay', 5);
    const maintenant = store.load();
    const { difference } = preparerValidation(maintenant, b);
    expect(Object.keys(difference.tables).filter((k) => {
      const d = difference.tables[k as keyof typeof difference.tables]!;
      return d.ajouts.length + d.modifications.length + d.retraits.length > 0;
    }).sort()).toEqual(['needs', 'plannedFlows', 'tirelires']);
    valider(store, maintenant, b);
    const apres = store.load();
    expect(noms(apres, 'accounts')).toContain('Livret Bleu');
    expect(alive(apres.plannedFlows).find((f) => f.id === 'f-salaire')?.amount).toBe(210000);
    expect(apres.settings.periodStartDay).toBe(5);
    expect(noms(apres, 'tirelires')).toEqual(['Taxe foncière']);
  });

  it('une ligne changée des deux côtés suit D93 : elle se dit en conflit, et la version de l’assistant est retenue', async () => {
    const store = await depot();
    store.upsert('tirelires', tirelire('t-vac', 'Vacances'));
    store.upsert('needs', besoin('n-vac', 't-vac'));
    const projet = store.load();
    const b = nouveauBrouillon(projet, 'tirelires');
    ecrire(b, 'tirelires', tirelire('t-vac', 'Vacances d’été'));
    store.upsert('tirelires', tirelire('t-vac', 'Congés'));
    const maintenant = store.load();
    const { preparation } = preparerValidation(maintenant, b);
    expect(preparation.ok && preparation.conflits.length).toBe(1);
    valider(store, maintenant, b);
    expect(noms(store.load(), 'tirelires')).toEqual(['Vacances d’été']);
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

  it('un réglage hors de la section n’entre qu’avec son état lu : la différence ne porte que ce qui a changé', async () => {
    const store = await depot();
    const projet = store.load();
    const b = nouveauBrouillon(projet, 'tirelires');
    expect(preparerValidation(projet, b).difference.reglages).toEqual([]);
    reglage(b, 'principalCushion', euros(100));
    expect(preparerValidation(projet, b).difference.reglages).toEqual([{ cle: 'principalCushion', avant: 0, apres: euros(100) }]);
  });
});
