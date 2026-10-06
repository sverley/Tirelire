/**
 * Tests du codeur de #225, niveau 4 : aucun écran ne tutoie, les mois abrégés s'écrivent en français,
 * les titres des groupes de Flux prévus sont au pluriel juste.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shortDate, periodicityLabel, FLOW_GROUP_TITLES, FLOW_KINDS } from '../src/lib/format';

const dossiers = ['src/views', 'src/lib'].map((d) => resolve(process.cwd(), d));
const fichiers = dossiers.flatMap((d) =>
  readdirSync(d).filter((f) => /\.(svelte|ts)$/.test(f)).map((f) => resolve(d, f)),
);
const tutoiement =
  /\b(Saisis-le|saisis-le|saisis-en|commence par|[Rr]enseigne au moins|élargis|passe le filtre|détache-les|supprime-les|modifie directement|laisse vide|Scanne \(|Fais scanner|sélectionne le texte|ton ordre|ta banque|chez ta|à toi|tu as|corrige-le)\b/;

describe('[niveau 4] #225 · 1 — l\'application ne tutoie jamais', () => {
  it('aucune forme relevée du tutoiement dans les écrans', () => {
    const trouves = fichiers.filter((f) => tutoiement.test(readFileSync(f, 'utf8')));
    expect(trouves).toEqual([]);
  });
});

describe('[niveau 4] #225 · 2 — mois abrégés', () => {
  it('chaque mois s\'écrit comme en français', () => {
    const attendus = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    attendus.forEach((m, i) => {
      const iso = `2026-${String(i + 1).padStart(2, '0')}-02`;
      expect(shortDate(iso)).toBe(`2 ${m} 2026`);
    });
  });
  it('flux annuel', () => {
    expect(periodicityLabel({ interval: 1, unit: 'year', anchorDate: '2026-10-02' } as never)).toBe('chaque année le 2 oct.');
  });
});

describe('[niveau 4] #225 · 3 — titres des groupes', () => {
  it('pluriel juste, singulier dans le choix du type', () => {
    expect(FLOW_GROUP_TITLES).toEqual({
      income: 'Revenus',
      fixedCharge: 'Charges fixes',
      dueDate: 'Échéances payées par une tirelire',
      transfer: 'Virements internes attendus',
    });
    expect(FLOW_KINDS.fixedCharge).toBe('Charge fixe');
    expect(FLOW_KINDS.transfer).toBe('Virement interne attendu');
  });
});
