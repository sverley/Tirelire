/**
 * Harnais d'audit de #379 — « Le brouillon de l'assistant est le budget JSON » : le brouillon
 * (`src/lib/brouillon.ts`) et sa différence dite (`src/lib/differenceAssistant.ts`), sans navigateur,
 * sur un vrai dépôt (`LedgerStore`). Chaque titre dit le point du « Fait quand » qu'il tranche.
 *
 * Les tests sont ceux du codeur (`assistant-brouillon-json.test.ts`, d'où ils sont déplacés), classés
 * par la suite de questions de D83 ; l'auditeur a séparé la validation qui garde le changement fait
 * ailleurs (niveau 0 : perdu, il ne revient pas), et ajouté le fichier partiel enregistré (point 6,
 * direction C : une partie absente n'est pas définie). Le point 2, « rien n'entre dans le projet avant
 * la validation », reste tranché par les harnais de #210, inchangés.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';
import {
  BUDGET_JSON_VERSION,
  LedgerStore,
  MAIN_ACCOUNT_ID,
  RowRefused,
  alive,
  budgetDefiniEnJson,
  lireBudgetJson,
  type Account,
  type Ledger,
  type PlannedFlow,
  type Tirelire,
} from '@tirelire/core';
import { brouillonDuFichier, brouillonIntact, ecrire, fichierAEnregistrer, montrer, nouveauBrouillon, preparerValidation, reglage, retirer, valider } from '../src/lib/brouillon';
import { direDifference } from '../src/lib/differenceAssistant';

const SQL = await initSqlJs();
const source = (chemin: string) => readFileSync(resolve(process.cwd(), 'src', chemin), 'utf8');
const ECHEANCE = { interval: 1, unit: 'month', anchorDate: '2026-09-05' } as const;
const livret = (): Account => ({ id: 'livret', name: 'Livret A', kind: 'epargne', openingBalance: 0, openingDate: '2026-09-01' });
const vacances = (): Tirelire => ({ id: 't-vacances', name: 'Vacances', placement: [], openingBalance: 0, openingDate: '2026-09-01' });
const flux = (id: string, name: string, amount = 200000, accountId = MAIN_ACCOUNT_ID): PlannedFlow => ({
  id,
  name,
  kind: 'income',
  amount,
  accountId,
  periodicity: ECHEANCE,
  dateWindowDays: 3,
});

/** Un projet déjà budgété : un livret, une tirelire, un salaire et un loyer. */
async function projetBudgete() {
  const store = await LedgerStore.create({ sqlJs: SQL });
  store.upsert('accounts', livret());
  store.upsert('tirelires', vacances());
  store.upsert('plannedFlows', flux('f-salaire', 'Salaire'));
  store.upsert('plannedFlows', { ...flux('f-loyer', 'Loyer', -80000), kind: 'fixedCharge' } as PlannedFlow);
  return store;
}
const nommer = (l: Ledger) => (prop: string, id: string) =>
  ((prop === 'tirelireId' ? l.tirelires : prop === 'categoryId' ? l.categories : l.accounts) as Array<{ id: string; name: string }>).find((x) => x.id === id)?.name;

describe('[niveau 2] #379 · 1 — le brouillon est le fichier', () => {
  it('à l’ouverture, le fichier porte les parties de l’assistant telles que le projet les porte, et l’état lu est le même', async () => {
    const store = await projetBudgete();
    const b = nouveauBrouillon(store.load());
    expect(Object.keys(b.fichier.tables).sort()).toEqual(['accounts', 'categories', 'needs', 'plannedFlows', 'tirelires']);
    expect(Object.keys(b.fichier.settings).sort()).toEqual(['periodStartDay', 'principalCushion']);
    expect(b.fichier.tables.plannedFlows!.map((l) => l.id)).toEqual(['f-salaire', 'f-loyer']);
    expect(b.fichier).toEqual(b.etatLu);
    expect(brouillonIntact(b)).toBe(true);
  });

  it('sur un projet vierge, le garnissage d’office écrit dans le fichier, sans rendre le brouillon préparé', async () => {
    const store = await LedgerStore.create({ sqlJs: SQL });
    const b = nouveauBrouillon(store.load());
    expect(b.fichier.settings).toMatchObject(b.reglagesProposes);
    expect(Object.keys(b.reglagesProposes).length).toBeGreaterThan(0);
    expect(brouillonIntact(b)).toBe(true);
  });

  it('une étape modifie sa ligne dans le fichier ; ce qu’elle ne touche pas y reste tel quel', async () => {
    const store = await projetBudgete();
    const projet = store.load();
    const b = nouveauBrouillon(projet);
    const avant = JSON.stringify(b.fichier.tables.tirelires);
    ecrire(b, 'plannedFlows', { ...flux('f-salaire', 'Salaire'), amount: 210000 });
    expect(b.fichier.tables.plannedFlows!.find((l) => l.id === 'f-salaire')!.v['amount']).toBe(210000);
    expect(b.fichier.tables.plannedFlows!.find((l) => l.id === 'f-loyer')).toEqual(b.etatLu.tables.plannedFlows!.find((l) => l.id === 'f-loyer'));
    expect(JSON.stringify(b.fichier.tables.tirelires)).toBe(avant);
    expect(brouillonIntact(b)).toBe(false);
  });
});

describe('[niveau 2] #379 · 2 — le projet qui change pendant que l’assistant attend', () => {
  it('se montre à jour, avec le brouillon dessus', async () => {
    const store = await projetBudgete();
    const b = nouveauBrouillon(store.load());
    ecrire(b, 'plannedFlows', { ...flux('f-salaire', 'Salaire'), amount: 210000 });
    store.upsert('plannedFlows', { ...flux('f-loyer', 'Loyer', -85000), kind: 'fixedCharge' } as PlannedFlow);
    store.upsert('tirelires', { ...vacances(), id: 't-noel', name: 'Noël' });
    const montre = montrer(store.load(), b);
    expect(alive(montre.plannedFlows).map((f) => [f.id, f.amount])).toEqual([
      ['f-salaire', 210000],
      ['f-loyer', -85000],
    ]);
    expect(alive(montre.tirelires).map((t) => t.id)).toContain('t-noel');
  });
});

describe('[niveau 0] #379 · 4 — la validation n’applique que la différence : ce qui a changé ailleurs reste', () => {
  it('une ligne changée et une ligne ajoutée hors de l’assistant pendant qu’il attend survivent à sa validation', async () => {
    const store = await projetBudgete();
    const b = nouveauBrouillon(store.load());
    ecrire(b, 'plannedFlows', { ...flux('f-salaire', 'Salaire'), amount: 210000 });
    store.upsert('plannedFlows', { ...flux('f-loyer', 'Loyer', -85000), kind: 'fixedCharge' } as PlannedFlow);
    store.upsert('tirelires', { ...vacances(), id: 't-noel', name: 'Noël' });
    const projet = store.load();
    valider(store, projet, b);
    const apres = store.load();
    expect(alive(apres.plannedFlows).map((f) => [f.id, f.amount])).toEqual([
      ['f-salaire', 210000],
      ['f-loyer', -85000],
    ]);
    expect(alive(apres.tirelires).map((t) => t.id).sort()).toEqual(['t-noel', 't-vacances']);
  });
});

describe('[niveau 2] #379 · 4 — un refus', () => {
  it('un refus — une ligne retirée encore désignée — dit le premier problème, n’écrit rien, et le brouillon reste', async () => {
    const store = await projetBudgete();
    const projet = store.load();
    const b = nouveauBrouillon(projet);
    ecrire(b, 'plannedFlows', flux('f-livret', 'Intérêts', 1000, 'livret'));
    retirer(b, projet, 'accounts', 'livret');
    const fichier = JSON.stringify(b.fichier);
    const avant = JSON.stringify(store.load());
    let refus: unknown;
    try {
      valider(store, projet, b);
    } catch (e) {
      refus = e;
    }
    expect(refus).toBeInstanceOf(RowRefused);
    expect((refus as Error).message).toMatch(/livret/);
    expect(JSON.stringify(store.load())).toBe(avant);
    expect(JSON.stringify(b.fichier)).toBe(fichier);
  });
});

describe('[niveau 1] #379 · 3 (I10) — le résumé dit la différence, retraits compris', () => {
  it('partie par partie, ajouts, modifications et retraits, dans les mots de l’utilisateur, avec les réglages', async () => {
    const store = await projetBudgete();
    const projet = store.load();
    const b = nouveauBrouillon(projet);
    ecrire(b, 'tirelires', { ...vacances(), id: 't-noel', name: 'Noël' });
    ecrire(b, 'plannedFlows', { ...flux('f-salaire', 'Salaire'), amount: 210000 });
    retirer(b, projet, 'plannedFlows', 'f-loyer');
    reglage(b, 'periodStartDay', 5);
    const { difference, preparation } = preparerValidation(projet, b);
    expect(preparation.ok).toBe(true);
    const dite = direDifference(difference, preparation.ok ? preparation.conflits : [], nommer(projet));
    expect(dite.vide).toBe(false);
    expect(dite.parties.find((p) => p.nom === 'Tirelires')!.ajouts.map((l) => l.texte)).toEqual(['« Noël »']);
    const flux_ = dite.parties.find((p) => p.nom === 'Flux prévus')!;
    expect(flux_.modifications[0]!.texte).toBe('« Salaire »');
    expect(flux_.modifications[0]!.detail).toMatch(/^montant : .*2.?000,00.*→.*2.?100,00/);
    expect(flux_.retraits.map((l) => l.texte)).toEqual(['« Loyer »']);
    expect(dite.reglages).toEqual([{ texte: 'Jour de début de période', detail: '1 → 5' }]);
    expect(dite.conflits).toEqual([]);
  });

});

describe('[niveau 2] #379 · 3 — sans différence, et les lignes changées des deux côtés', () => {
  it('sans différence, le résumé le sait', async () => {
    const store = await projetBudgete();
    const projet = store.load();
    const { difference } = preparerValidation(projet, nouveauBrouillon(projet));
    expect(direDifference(difference, [], nommer(projet)).vide).toBe(true);
  });

  it('une ligne changée ailleurs et par l’assistant est signalée : la version de l’assistant est retenue, l’écartée se lit', async () => {
    const store = await projetBudgete();
    const b = nouveauBrouillon(store.load());
    ecrire(b, 'plannedFlows', { ...flux('f-salaire', 'Salaire'), amount: 210000 });
    store.upsert('plannedFlows', { ...flux('f-salaire', 'Salaire'), amount: 190000 });
    const projet = store.load();
    const { difference, preparation } = preparerValidation(projet, b);
    expect(preparation.ok).toBe(true);
    const dite = direDifference(difference, preparation.ok ? preparation.conflits : [], nommer(projet));
    expect(dite.conflits).toHaveLength(1);
    expect(dite.conflits[0]!.texte).toBe('Flux prévus : « Salaire »');
    expect(dite.conflits[0]!.detail).toMatch(/retenue \(montant .*2.?100,00.*\).*écartée \(montant .*1.?900,00/);
    valider(store, projet, b);
    expect(store.load().plannedFlows.find((f) => f.id === 'f-salaire')!.amount).toBe(210000);
  });
});

describe('[niveau 2] #379 · 5 et 6 — enregistrer, puis reprendre', () => {
  it('le fichier enregistré est un budget JSON version 2, sans étape ; repris sur le même projet, il redonne la même différence', async () => {
    const store = await projetBudgete();
    const projet = store.load();
    const b = nouveauBrouillon(projet);
    b.etape = 'fixed';
    b.semees.push('income');
    ecrire(b, 'tirelires', { ...vacances(), id: 't-noel', name: 'Noël' });
    ecrire(b, 'plannedFlows', { ...flux('f-salaire', 'Salaire'), amount: 210000 });
    retirer(b, projet, 'plannedFlows', 'f-loyer');
    reglage(b, 'principalCushion', 30000);

    const json = budgetDefiniEnJson(fichierAEnregistrer(projet, b));
    expect(json['version']).toBe(BUDGET_JSON_VERSION);
    expect(JSON.stringify(json)).not.toMatch(/etape|semees|"fixed"|income"\]/);

    const texte = JSON.stringify(json);
    const lu = lireBudgetJson(texte);
    if (!lu.ok) throw new Error(lu.message);
    const repris = brouillonDuFichier(projet, lu.budget);
    expect(repris.etape).toBe('summary');
    const avant = preparerValidation(projet, b).difference;
    const apres = preparerValidation(projet, repris).difference;
    expect(apres).toEqual(avant);
  });

  it('un fichier qui ne définit qu’une partie laisse les autres telles que le projet les porte', async () => {
    const store = await projetBudgete();
    const projet = store.load();
    const lu = lireBudgetJson({ format: 'tirelire-budget', version: 3, tirelires: [{ name: 'Noël', placement: [], opening_balance: 0, opening_date: '2026-09-01' }] });
    if (!lu.ok) throw new Error(lu.message);
    const b = brouillonDuFichier(projet, lu.budget);
    const montre = montrer(projet, b);
    expect(alive(montre.tirelires).map((t) => t.name)).toEqual(['Noël']);
    expect(alive(montre.plannedFlows).map((f) => f.id)).toEqual(['f-salaire', 'f-loyer']);
    const { difference } = preparerValidation(projet, b);
    expect(difference.tables.plannedFlows).toEqual({ ajouts: [], modifications: [], retraits: [] });
  });

  it('enregistré sans qu’une étape les change, un fichier partiel repris ne définit toujours que ses parties (ajouté par l’auditeur)', async () => {
    const store = await projetBudgete();
    const projet = store.load();
    const lu = lireBudgetJson({ format: 'tirelire-budget', version: 3, tirelires: [{ name: 'Noël', placement: [], opening_balance: 0, opening_date: '2026-09-01' }] });
    if (!lu.ok) throw new Error(lu.message);
    const json = budgetDefiniEnJson(fichierAEnregistrer(projet, brouillonDuFichier(projet, lu.budget)));
    expect(Object.keys(json).filter((k) => k !== 'format' && k !== 'version')).toEqual(['tirelires']);
  });

  it('une étape qui change une partie absente du fichier repris l’y fait entrer, sans autre différence (ajouté par l’auditeur)', async () => {
    const store = await projetBudgete();
    const projet = store.load();
    const lu = lireBudgetJson({ format: 'tirelire-budget', version: 3, tirelires: [{ name: 'Noël', placement: [], opening_balance: 0, opening_date: '2026-09-01' }] });
    if (!lu.ok) throw new Error(lu.message);
    const b = brouillonDuFichier(projet, lu.budget);
    ecrire(b, 'plannedFlows', { ...flux('f-salaire', 'Salaire'), amount: 210000 });
    const json = budgetDefiniEnJson(fichierAEnregistrer(projet, b));
    expect(Object.keys(json).filter((k) => k !== 'format' && k !== 'version').sort()).toEqual(['planned_flows', 'tirelires'].sort());
    const flux_ = preparerValidation(projet, b).difference.tables.plannedFlows!;
    expect([flux_.ajouts.length, flux_.modifications.map((m) => m.avant.id), flux_.retraits.length]).toEqual([0, ['f-salaire'], 0]);
  });
});

describe('[niveau 1] #379 · 7 (I4) — les nouveaux gestes de l’écran sont secondaires', () => {
  const ecran = source('views/Wizard.svelte');
  it('la première page offre « Reprendre un budget (JSON) », vers l’écran d’import, en geste secondaire', () => {
    expect(ecran).toMatch(/<button class="btn small" onclick=\{\(\) => app\.go\('importBudget'\)\}>Reprendre un budget \(JSON\)<\/button>/);
  });
  it('le résumé offre « Enregistrer ce brouillon (JSON) », en geste secondaire, nommé avec la date, enregistré sur l’appareil', () => {
    expect(ecran).toMatch(/<button class="btn small" onclick=\{enregistrerBrouillon\}>Enregistrer ce brouillon \(JSON\)<\/button>/);
    expect(ecran).toMatch(/tirelire-budget-\$\{todayISO\(\)\}\.json/);
    expect(ecran).toMatch(/saveFile\(/);
  });
});
