/**
 * Tests du codeur de #41 : le rappel de sauvegarde et la marque des données qui le fonde. Hors du
 * harnais du besoin ; ils gardent le besoin du point 3, que le harnais classe au niveau 0 (D83) :
 * une marque qui ne change plus, ou une période mal comptée, fait taire le rappel, et des données
 * peuvent se perdre.
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { exampleLedger, LedgerStore, marqueDesDonnees, sauvegardeARappeler, unePeriodeApres } from '../src/index.js';

const SQL = await initSqlJs();

describe('[niveau 0] #41 · une période budgétaire plus tard (D02)', () => {
  it('le même jour du mois suivant, au mois calendaire', () => {
    expect(unePeriodeApres('2026-09-20', 1)).toBe('2026-10-20');
    expect(unePeriodeApres('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('la même place dans la période de paie suivante', () => {
    // Période du 28 août au 27 septembre, puis du 28 septembre au 27 octobre.
    expect(unePeriodeApres('2026-09-01', 28)).toBe('2026-10-02'); // cinquième jour de chacune
    expect(unePeriodeApres('2026-08-28', 28)).toBe('2026-09-28');
  });
});

describe('[niveau 0] #41 · le rappel de sauvegarde', () => {
  const base = { aujourdhui: '2026-09-28', debutPeriode: 1 };
  it('rien de saisi : pas de rappel', () => {
    expect(sauvegardeARappeler({ ...base, derniere: undefined, marque: '' })).toBe(false);
  });
  it('des données jamais sauvegardées : rappel', () => {
    expect(sauvegardeARappeler({ ...base, derniere: undefined, marque: 'm1' })).toBe(true);
  });
  it('rien de changé depuis la sauvegarde : pas de rappel, même ancienne', () => {
    expect(sauvegardeARappeler({ ...base, derniere: { date: '2025-01-01', marque: 'm1' }, marque: 'm1' })).toBe(false);
  });
  it('changées depuis une sauvegarde de moins d’une période : pas encore', () => {
    expect(sauvegardeARappeler({ ...base, derniere: { date: '2026-09-01', marque: 'm1' }, marque: 'm2' })).toBe(false);
    expect(sauvegardeARappeler({ ...base, derniere: { date: '2026-08-28', marque: 'm1' }, marque: 'm2' })).toBe(false);
  });
  it('changées depuis une sauvegarde de plus d’une période : rappel', () => {
    expect(sauvegardeARappeler({ ...base, derniere: { date: '2026-08-27', marque: 'm1' }, marque: 'm2' })).toBe(true);
  });
});

describe('[niveau 0] #41 · la marque des données', () => {
  it('vide sur une base neuve, elle change à chaque écriture, locale ou reçue, et se retrouve à la réouverture', async () => {
    const a = await LedgerStore.create({ sqlJs: SQL, siteId: 'aaaaaaaaaaaa' });
    expect(marqueDesDonnees(a)).toBe('');
    const cat = exampleLedger().categories[0]!;
    a.upsert('categories', cat);
    const m1 = marqueDesDonnees(a);
    expect(m1).not.toBe('');
    a.upsert('categories', { ...cat, name: `${cat.name} bis` });
    const m2 = marqueDesDonnees(a);
    expect(m2).not.toBe(m1);
    a.setSetting('periodStartDay', 28);
    const m3 = marqueDesDonnees(a);
    expect(m3).not.toBe(m2);
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'bbbbbbbbbbbb', bytes: a.export() });
    expect(marqueDesDonnees(b)).toBe(m3);
    a.setLocal('curseur', '1');
    expect(marqueDesDonnees(a)).toBe(m3);
  });
});
