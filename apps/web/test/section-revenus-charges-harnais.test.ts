/**
 * Harnais d'audit de #364 — « La section Revenus et charges fixes sert à l'assistant et à l'écran Flux
 * prévus » : la section écrite une fois (point 1), sur le texte des sources ; le brouillon ouvert sur la
 * section (point 9), sans navigateur, sur un vrai dépôt (`LedgerStore`). Ce que l'écran et l'assistant
 * montrent et enregistrent est dans `section-revenus-charges-ecran-harnais.test.ts`.
 *
 * Les tests sont ceux du codeur (`section-revenus-charges.test.ts`, d'où ils sont déplacés en entier),
 * classés par la suite de questions de D83. Point 1, niveau 1 : le principe 13 et I11, que la section rend
 * vrais par construction (D94) ; vu rouge sur le `Wizard.svelte` et le `Flows.svelte` de `main`. Point 9 :
 * la validation qui n'écrit que ce que les étapes ont changé, niveau 0 — la partie que couvre la section,
 * les flux, porte aussi les échéances, les virements et les ordres, qu'une validation de toute la table
 * réécrirait, ce que le code corrigé ne rendrait pas ; ce que le brouillon couvre, niveau 2 (cas de règle,
 * comme pour #363 et #365) ; le titre, niveau 3.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { LedgerStore, MAIN_ACCOUNT_ID, alive, budgetSuggestions, type PlannedFlow } from '@tirelire/core';
import { ecrire, nouveauBrouillon, preparerValidation, reglage, titreDeLAssistant, valider } from '../src/lib/brouillon';

const lire = (chemin: string) => readFileSync(resolve(__dirname, '..', chemin), 'utf8');
const ecran = lire('src/views/Flows.svelte');
const wizard = lire('src/views/Wizard.svelte');
const composant = lire('src/lib/SectionRevenusCharges.svelte');
const formulaire = lire('src/lib/FormulaireFlux.svelte');
const module = lire('src/lib/sectionRevenusCharges.svelte.ts');

describe('[niveau 1] #364 · 1 — une section, écrite une fois', () => {
  it('les deux étapes de l’assistant et l’écran emploient la même section ; l’assistant sur son brouillon, l’écran sur le projet', () => {
    expect(wizard).toContain('<SectionRevenusCharges s={sectionFlux} genre="income" />');
    expect(wizard).toContain('<SectionRevenusCharges s={sectionFlux} genre="fixedCharge" />');
    expect(wizard).toMatch(/new SectionDesFlux\(\s*\{[\s\S]*?app\.assistantLedger[\s\S]*?app\.assistantUpsert/);
    expect(ecran).toMatch(/<SectionRevenusCharges s=\{section\}/);
    expect(ecran).toMatch(/new SectionDesFlux\(\s*\{[\s\S]*?app\.ledger[\s\S]*?app\.upsert/);
    expect(ecran).not.toMatch(/assistantUpsert|assistantLedger/);
  });
  it('ni l’assistant ni l’écran ne réécrivent la ligne, les raccourcis, le formulaire d’ajout ou le texte', () => {
    for (const ecrit of ['tete-flux', 'ligne-flux', 'Quoi ?', 'Vers le (jour)', 'Déclarez ce qui rentre', 'Loyer, abonnements, mensualités', 'suggestedFlow', 'aideFlux', 'recopieFlux', 'lastDayOnOrBefore']) {
      expect(wizard, ecrit).not.toContain(ecrit);
      expect(ecran, ecrit).not.toContain(ecrit);
    }
    expect(composant).toContain('tete-flux');
    expect(composant).toContain('Ajouter en un geste');
    expect(formulaire).toContain('Vers le (jour)');
    expect(module).toContain('Déclarez ce qui rentre');
    expect(module).toContain('suggestedFlow');
  });
  it('seul l’assistant garnit d’office ; l’écran replie l’explication, et ne montre pas « Découpage du budget »', () => {
    expect(wizard).toContain("sectionFlux.garnir('income')");
    expect(wizard).toContain("sectionFlux.garnir('fixedCharge')");
    expect(ecran).not.toMatch(/\.garnir\(/);
    expect(ecran).toMatch(/<SectionRevenusCharges[^>]*explication=\{false\}/);
    expect(ecran).toContain('<details class="explication');
    expect(ecran).not.toContain('Découpage du budget');
    expect(composant).not.toContain('Découpage du budget');
    expect(wizard).toContain('Découpage du budget');
  });
});

const SQL = await initSqlJs();
const depot = () => LedgerStore.create({ sqlJs: SQL });
const flux = (id: string, name: string, kind: PlannedFlow['kind'], amount: number, extra: Partial<PlannedFlow> = {}): PlannedFlow => ({
  id,
  name,
  kind,
  amount,
  accountId: MAIN_ACCOUNT_ID,
  periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-05' },
  dateWindowDays: 3,
  ...extra,
});

describe('#364 · 9 — le brouillon ouvert sur la section Revenus et charges fixes', () => {
  it('[niveau 3] le titre nomme la section', () => {
    expect(titreDeLAssistant('revenus')).toBe('Compléter mes revenus et charges fixes');
  });

  it('[niveau 2] ouvert sur un projet vierge, il couvre les flux et le jour de début de période, celui de l’exemple proposé d’office ; ni le coussin, ni aucune autre partie', async () => {
    const store = await depot();
    const b = nouveauBrouillon(store.load(), 'revenus');
    expect(Object.keys(b.fichier.tables)).toEqual(['plannedFlows']);
    expect(b.fichier.settings).toEqual({ periodStartDay: budgetSuggestions().periodStartDay });
    expect(b.reglagesProposes).toEqual({ periodStartDay: budgetSuggestions().periodStartDay });
    expect(b.etape).toBe('income');
  });

  it('[niveau 0] la validation n’écrit que ce que les étapes ont changé : un virement lu avec les flux reste ce que le projet porte, une ligne changée des deux côtés suit D93', async () => {
    const store = await depot();
    store.upsert('accounts', { id: 'livret', name: 'Livret', kind: 'epargne', openingBalance: 0, openingDate: '2026-01-01' } as never);
    store.upsert('plannedFlows', flux('f-sal', 'Salaire', 'income', 200000));
    store.upsert('plannedFlows', flux('f-vir', 'Virement Livret', 'transfer', -10000, { counterpartAccountId: 'livret' }));
    const projet = store.load();
    const b = nouveauBrouillon(projet, 'revenus');
    ecrire(b, 'plannedFlows', flux('f-sal', 'Salaire', 'income', 210000));
    ecrire(b, 'plannedFlows', flux('f-loy', 'Loyer', 'fixedCharge', -80000));
    reglage(b, 'periodStartDay', 28);
    // Ailleurs, pendant que le brouillon attend : le virement corrigé, le salaire renommé.
    store.upsert('plannedFlows', flux('f-vir', 'Virement Livret', 'transfer', -15000, { counterpartAccountId: 'livret' }));
    store.upsert('plannedFlows', flux('f-sal', 'Paie', 'income', 200000));
    const maintenant = store.load();
    expect(preparerValidation(maintenant, b).preparation.ok).toBe(true);
    valider(store, maintenant, b);
    const apres = store.load();
    expect(alive(apres.plannedFlows).find((f) => f.id === 'f-vir')?.amount, 'le virement a été réécrit').toBe(-15000);
    expect(alive(apres.plannedFlows).find((f) => f.id === 'f-sal')).toMatchObject({ name: 'Salaire', amount: 210000 });
    expect(alive(apres.plannedFlows).map((f) => f.name).sort()).toEqual(['Loyer', 'Salaire', 'Virement Livret']);
    expect(apres.settings.periodStartDay).toBe(28);
    expect(apres.settings.principalCushion).toBe(projet.settings.principalCushion);
  });
});
