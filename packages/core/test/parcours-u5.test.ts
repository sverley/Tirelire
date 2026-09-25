/**
 * Parcours de bout en bout de **U5 · import seul** (#39, #70).
 *
 * L'usage : importer des opérations pour les classer et analyser les catégories, **sans tirelire ni
 * budget**. Le parcours part d'une base vide, importe un relevé inventé, crée les catégories
 * et les automatismes, applique le classement, relit la base après redémarrage et lit le bilan par
 * catégorie — sans qu'aucune tirelire, aucun besoin, aucun flux prévu n'existe jamais.
 *
 * Ce qu'il ajoute aux harnais unitaires : ceux-ci éprouvent la lecture d'un relevé et le moteur de
 * règles sur le grand livre d'exemple, qui est plein de tirelires ; ici il n'y en a aucune, et
 * c'est la condition que U5 doit tenir. Ce qu'il ne garde pas : ce que montrent les écrans — cela
 * reste à `VM-U5-sans-tirelire`.
 */
import { describe, expect, it } from 'vitest';
import {
  alive,
  applyAutomations,
  bankMultiAccountProfile,
  computePlan,
  euros,
  lastPeriods,
  parseCsv,
  parseRows,
  prepareImport,
  rankBetween,
  reviewCategories,
  type Ledger,
} from '../src/index.js';
import { AS_OF, DEBUT, PAIE, baseVide, ecrire, relire } from './parcours.js';

const COMPTE = 'cpt-courant';
const NUMÉRO = '00099999999';

/** Relevé inventé, dans la forme des exports bancaires français (aucune donnée réelle). */
const RELEVÉ = [
  'Date transaction;Date comptabilisation;Num Compte;Libellé Compte;Libellé opération;Libellé complet;Catégorie;Sous-Catégorie;Montant;Pointée;',
  "28/08/2026;28/08/2026;00099999999;Compte Courant;VIR RECU DE: EMPLOYEUR SA;VIR RECU DE: EMPLOYEUR SA MOTIF: SALAIRE AOUT;Revenus du travail;Salaires;3400,00;Non;",
  '03/09/2026;03/09/2026;00099999999;Compte Courant;CARTE X2009 02/09 SUPERMARCHE;CARTE X2009 02/09 SUPERMARCHE;Vie quotidienne;Alimentation;-85,40;Non;',
  '10/09/2026;10/09/2026;00099999999;Compte Courant;CARTE X2009 09/09 SUPERMARCHE;CARTE X2009 09/09 SUPERMARCHE;Vie quotidienne;Alimentation;-85,40;Non;',
  '04/09/2026;04/09/2026;00099999999;Compte Courant;PRELEVEMENT DE: EAU DU VILLAGE;PRELEVEMENT DE: EAU DU VILLAGE MOTIF: Facture;Logement;Eau;-76,00;Non;',
].join('\r\n');

const profil = () => {
  const p = bankMultiAccountProfile('prof-relevé');
  p.accountMap = { [NUMÉRO]: COMPTE };
  return p;
};

/**
 * Ce que l'analyse doit dire après le classement : chaque opération portée par une catégorie et par
 * elle seule, un bilan par catégorie qui totalise les dépenses et les revenus, et un plan qui ne
 * réclame aucune tirelire.
 */
function leBilanParCatégorieSeLit(ledger: Ledger): void {
  // Jamais de tirelire, de besoin ni de budget : c'est la condition de l'usage.
  expect(alive(ledger.tirelires)).toEqual([]);
  expect(alive(ledger.needs)).toEqual([]);
  expect(alive(ledger.plannedFlows)).toEqual([]);

  const lignes = alive(ledger.allocations);
  expect(lignes.length, 'aucune opération classée').toBeGreaterThan(0);
  for (const a of lignes) {
    expect(a.categoryId, 'une ligne de ventilation sans catégorie').toBeDefined();
    expect(a.tirelireId, 'le classement a exigé une tirelire').toBeUndefined();
  }

  const bilan = reviewCategories(ledger, lastPeriods(ledger, AS_OF, 3));
  const parNom = new Map(bilan.map((c) => [c.name, c]));
  const alimentation = parNom.get('Alimentation');
  expect(alimentation, 'la catégorie Alimentation ne figure pas au bilan').toBeDefined();
  expect(alimentation!.nature).toBe('expense');
  expect(alimentation!.totalSpent).toBe(euros(170.8));
  expect(alimentation!.periods.reduce((s, p) => s + p.count, 0)).toBe(2);
  const salaire = parNom.get('Salaire');
  expect(salaire, 'la catégorie Salaire ne figure pas au bilan').toBeDefined();
  expect(salaire!.nature).toBe('income');
  expect(salaire!.totalSpent).toBe(euros(3400));

  // Le plan se calcule sans rien réclamer : ni ligne de tirelire, ni virement, ni avertissement
  // qui en désigne une.
  const plan = computePlan(ledger, AS_OF);
  expect(plan.lines).toEqual([]);
  expect(plan.transfers).toEqual([]);
  expect(plan.warnings.filter((w) => w.tirelireId || w.needId)).toEqual([]);
}

describe('[niveau 1] harnais du registre', () => {
  describe('U5 · import seul, de bout en bout (#39)', () => {
    it('parcours U5 · du relevé importé au bilan par catégorie, sans aucune tirelire', async () => {
      const store = await baseVide('parcours-u5');
      store.setSetting('periodStartDay', PAIE);
      store.upsert('accounts', { id: COMPTE, name: 'Compte courant', kind: 'principal', openingBalance: euros(1200), openingDate: DEBUT });
      const p = profil();
      store.upsert('importProfiles', p);

      // Import : lecture du relevé, puis écriture des opérations retenues.
      const lu = parseRows(parseCsv(RELEVÉ), p);
      expect(lu.errors).toEqual([]);
      const préparé = prepareImport(store.load(), lu.rows, p);
      expect(préparé.unmappedAccounts).toEqual([]);
      expect(préparé.counts.new).toBe(4);
      for (const c of préparé.candidates) store.upsert('operations', c.operation);

      // Classement : des catégories et des automatismes, aucune tirelire.
      store.upsert('categories', { id: 'cat-alimentation', name: 'Alimentation', nature: 'expense' });
      store.upsert('categories', { id: 'cat-salaire', name: 'Salaire', nature: 'income' });
      const rang = rankBetween(undefined, undefined);
      store.upsert('automations', { id: 'auto-supermarché', name: 'Supermarché', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alimentation' }, rank: rang });
      store.upsert('automations', { id: 'auto-salaire', name: 'Salaire', selection: { labelPattern: 'EMPLOYEUR' }, action: { categoryId: 'cat-salaire' }, rank: rankBetween(undefined, rang) });
      ecrire(store, applyAutomations(store.load()));

      const ledger = await relire(store, 'parcours-u5');

      // Réimporter le même relevé n'ajoute rien : les clés déterministes suffisent, sans budget (D09).
      expect(prepareImport(ledger, lu.rows, p).counts.exact).toBe(lu.rows.length);
      store.close();

      leBilanParCatégorieSeLit(ledger);
    });

    it.fails('témoin rouge · un bilan qui ne compte que les opérations rattachées à une tirelire', async () => {
      const store = await baseVide('parcours-u5-témoin');
      store.setSetting('periodStartDay', PAIE);
      store.upsert('accounts', { id: COMPTE, name: 'Compte courant', kind: 'principal', openingBalance: euros(1200), openingDate: DEBUT });
      const p = profil();
      for (const c of prepareImport(store.load(), parseRows(parseCsv(RELEVÉ), p).rows, p).candidates) store.upsert('operations', c.operation);
      store.upsert('categories', { id: 'cat-alimentation', name: 'Alimentation', nature: 'expense' });
      store.upsert('categories', { id: 'cat-salaire', name: 'Salaire', nature: 'income' });
      const rang = rankBetween(undefined, undefined);
      store.upsert('automations', { id: 'auto-supermarché', name: 'Supermarché', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alimentation' }, rank: rang });
      store.upsert('automations', { id: 'auto-salaire', name: 'Salaire', selection: { labelPattern: 'EMPLOYEUR' }, action: { categoryId: 'cat-salaire' }, rank: rankBetween(undefined, rang) });
      ecrire(store, applyAutomations(store.load()));
      const ledger = store.load();
      store.close();

      // Version volontairement cassée : le classement n'est retenu que s'il désigne une tirelire —
      // l'usage devient le mode dégradé du budget, ce que I3 refuse.
      leBilanParCatégorieSeLit({ ...ledger, allocations: ledger.allocations.filter((a) => a.tirelireId) });
    });
  });
});
