/**
 * Tests du codeur de #324 — les réglages que l'ouverture de l'assistant propose d'elle-même sur un
 * projet vierge : le jour de début de période et le coussin du compte principal de l'exemple (points
 * 1 et 2, D44, D41). Sans navigateur ; ce que l'écran en montre est dans
 * `navigateur/assistant-plan-exemple.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { LedgerStore, MAIN_ACCOUNT_ID, budgetSuggestions, euros, type Ledger, type Tirelire } from '@tirelire/core';
import { brouillonIntact, ecrire, montrer, nouveauBrouillon, reglage, valider } from '../src/lib/brouillon';

const SQL = await initSqlJs();
const depot = () => LedgerStore.create({ sqlJs: SQL });
const tirelire = (id: string): Tirelire => ({ id, name: 'Vacances', placement: [], openingBalance: 0, openingDate: '2026-09-01' });

describe('[niveau 4] #324 · 1 et 2 — sur un projet vierge, l’ouverture propose le début de période et le coussin de l’exemple', () => {
  it('l’assistant montre le jour de l’exemple et son coussin, le projet n’y est pas touché', async () => {
    const store = await depot();
    const projet = store.load();
    const montre = montrer(projet, nouveauBrouillon(projet));

    expect(montre.settings.periodStartDay).toBe(budgetSuggestions().periodStartDay);
    expect(montre.settings.periodStartDay).toBe(28);
    expect(montre.settings.principalCushion).toBe(euros(600));
    expect(projet.settings.periodStartDay).toBe(1);
    expect(projet.settings.principalCushion).toBe(0);
  });

  it('ces réglages ne comptent pas comme préparés : le brouillon reste intact, l’ouverture suivante repart du projet', async () => {
    const store = await depot();
    expect(brouillonIntact(nouveauBrouillon(store.load()))).toBe(true);
  });

  it('validé, le projet porte ces réglages, ceux que lit l’écran Réglages', async () => {
    const store = await depot();
    const projet = store.load();
    valider(store, projet, nouveauBrouillon(projet));
    expect(store.readSettings()).toMatchObject({ periodStartDay: 28, principalCushion: euros(600) });
  });

  it('ce que l’assistant prépare l’emporte : choisir le mois calendaire ou changer le coussin se montre et se valide', async () => {
    const store = await depot();
    const projet = store.load();
    const b = nouveauBrouillon(projet);
    reglage(b, 'periodStartDay', 1);
    reglage(b, 'principalCushion', euros(250));

    expect(montrer(projet, b).settings).toMatchObject({ periodStartDay: 1, principalCushion: euros(250) });
    expect(brouillonIntact(b)).toBe(false);
    valider(store, projet, b);
    expect(store.readSettings()).toMatchObject({ periodStartDay: 1, principalCushion: euros(250) });
  });
});

describe('[niveau 4] #324 · 1 et 2 — ce que la personne a déjà posé n’est pas remplacé, et un projet existant n’est pas garni', () => {
  it('un réglage déjà posé, même sur un projet vierge, reste le sien ; l’autre reçoit celui de l’exemple', async () => {
    const store = await depot();
    store.setSetting('periodStartDay', 5);
    const projet = store.load();
    const b = nouveauBrouillon(projet);

    expect(b.projetVierge).toBe(true);
    expect(montrer(projet, b).settings).toMatchObject({ periodStartDay: 5, principalCushion: euros(600) });
    valider(store, projet, b);
    expect(store.readSettings()).toMatchObject({ periodStartDay: 5, principalCushion: euros(600) });
  });

  it('un projet existant n’est garni d’aucun réglage : l’assistant part de ce qu’il porte', async () => {
    const store = await depot();
    store.upsert('tirelires', tirelire('t-vacances'));
    const projet: Ledger = store.load();
    const b = nouveauBrouillon(projet);

    expect(b.projetVierge).toBe(false);
    expect(montrer(projet, b).settings).toMatchObject({ periodStartDay: 1, principalCushion: 0 });
    valider(store, projet, b);
    expect(store.readSettings()).toMatchObject({ periodStartDay: 1, principalCushion: 0 });
  });

  it('les lignes préparées ne changent pas les réglages de départ, figés avec l’état d’ouverture', async () => {
    const store = await depot();
    const projet = store.load();
    const b = nouveauBrouillon(projet);
    ecrire(b, 'tirelires', tirelire('t-vacances'));

    expect(b.projetVierge).toBe(true);
    expect(montrer(projet, b).settings).toMatchObject({ periodStartDay: 28, principalCushion: euros(600) });
    expect(projet.accounts.map((a) => a.id)).toEqual([MAIN_ACCOUNT_ID]);
  });
});
