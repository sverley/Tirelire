/**
 * Harnais d'audit de #13 — sans navigateur : l'ordre que dit l'assistant est celui que le Plan
 * enregistrera (point 2), son jour et sa fenêtre se lisent sur l'ordre (point 5), le libellé se copie
 * tel qu'il se lit ou rien ne se copie (point 6), et le texte de la suite (point 7). L'écran est
 * vérifié dans le navigateur, pour la copie dans le presse-papiers et ce qui se lit à 375 px, par
 * `navigateur/ordres-a-poser-harnais.test.ts` ; pour le reste, sans navigateur, depuis #419, par
 * `ordres-a-poser-ecran.test.ts`. Repris des tests du codeur.
 *
 * Niveaux (D83) : 1 pour les points 2 (U2, U3 : l'ordre posé chez la banque est celui que l'import
 * reconnaîtra), 5 (U3), 6 (C2) et 7 (I3 : le texte ne suppose pas qu'on importe) ; 4 pour la longueur
 * du libellé, qui relit une règle du cœur (D21), et pour la lecture du source, que l'écran vérifie.
 * Rouges vus sur mutations du code de la PR : voir la vérification de l'auditeur dans la PR.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computePlan, exampleLedger, standingTransferFlow, transferLabel, type Ledger, type PlannedFlow } from '@tirelire/core';
import { consigneDe, copierTexte, EXPLICATION_SUITE, ordreAPoser } from '../src/lib/consigneOrdre';

const JOUR = '2026-09-20';
/** L'exemple sans son ordre vers le Livret A : le budget en demande un, aucun n'est posé. */
function sansOrdre(): Ledger {
  const l = exampleLedger();
  return { ...l, plannedFlows: l.plannedFlows.filter((f) => f.id !== 'flow-vir-livret') };
}
const lire = (chemin: string) => readFileSync(resolve(__dirname, '..', chemin), 'utf8');

describe('[niveau 1] #13 · 2 — l’ordre que l’assistant dit est celui que le Plan enregistre', () => {
  it('même montant, même ventilation, même libellé, même ancrage que « Enregistrer mon ordre permanent »', () => {
    const plan = computePlan(sansOrdre(), JOUR);
    const t = plan.transfers.find((x) => x.accountName === 'Livret A')!;
    expect(t.bankOrder).toBeUndefined();
    const dit = ordreAPoser(plan, t, 'acc-principal')!;
    const enregistre = standingTransferFlow(plan, t, 'acc-principal', 'autre-id', t.proposal!.amount)!;
    const sansId = ({ id: _id, ...f }: PlannedFlow) => f;
    expect(sansId(dit)).toEqual(sansId(enregistre));
    expect(-dit.amount).toBe(t.proposal!.amount);
    expect(dit.action?.allocation).toEqual(t.proposal!.allocation);
    expect(dit.labelPattern).toBe(transferLabel('Livret A'));
    expect(dit.periodicity.anchorDate).toBe(plan.period.start);
    // Ajouté par l'auditeur : sur l'exemple, la demande tombe sur le pas (650 €) ; une demande hors du
    // pas distingue le montant proposé, arrondi, de la demande brute.
    const horsDuPas = { ...t, permanent: t.permanent - 1234 };
    expect(-ordreAPoser(plan, horsDuPas, 'acc-principal')!.amount).toBe(t.proposal!.amount);
  });

  it('un ordre enregistré : l’évolution proposée garde son libellé et son ancrage', () => {
    const l = exampleLedger();
    const plan = computePlan(l, JOUR);
    const t = plan.transfers.find((x) => x.accountName === 'Livret A')!;
    const existant = l.plannedFlows.find((f) => f.id === 'flow-vir-livret')!;
    const dit = ordreAPoser(plan, t, 'acc-principal', existant)!;
    expect(dit.labelPattern).toBe(existant.labelPattern);
    expect(dit.periodicity.anchorDate).toBe(existant.periodicity.anchorDate);
    expect(-dit.amount).toBe(t.proposal!.amount);
  });

  it('sans proposition, rien à poser', () => {
    const plan = computePlan(sansOrdre(), JOUR);
    const marie = plan.transfers.find((x) => x.accountName === 'Compte de Marie')!;
    expect(marie.permanent).toBe(0);
    expect(ordreAPoser(plan, marie, 'acc-principal')).toBeUndefined();
  });
});

describe('[niveau 1] #13 · 5 — le jour et l’écart de jours se lisent sur l’ordre', () => {
  const ordre = (anchorDate: string, dateWindowDays: number, labelPattern?: string): PlannedFlow => ({
    id: 'o',
    name: 'Virement',
    kind: 'transfer',
    amount: -1000,
    accountId: 'p',
    counterpartAccountId: 'l',
    periodicity: { interval: 1, unit: 'month', anchorDate },
    dateWindowDays,
    ...(labelPattern ? { labelPattern } : {}),
  });
  it('le jour de l’ancrage, la fenêtre de l’ordre', () => {
    const c = consigneDe(ordre('2026-08-28', 5, 'TIRELIRE LIVRET A'));
    expect(c).toMatchObject({ libelle: 'TIRELIRE LIVRET A', jour: 28, fenetre: 5 });
    expect(c.quand).toBe('le 28 de chaque mois');
    expect(c.reconnaissance).toMatch(/jusqu’à 5 jours avant ou après est reconnu à l’import ; au-delà, il ne l’est pas/);
  });
  it('le 1er, une fenêtre d’un jour, un jour qui n’existe pas tous les mois', () => {
    expect(consigneDe(ordre('2026-09-01', 1)).quand).toBe('le 1er de chaque mois');
    expect(consigneDe(ordre('2026-09-01', 1)).reconnaissance).toMatch(/jusqu’à 1 jour avant/);
    expect(consigneDe(ordre('2026-08-31', 0)).quand).toMatch(/le 31 de chaque mois, ou le dernier jour du mois/);
    expect(consigneDe(ordre('2026-08-31', 0)).reconnaissance).toMatch(/un autre jour n’est pas reconnu/);
  });
  it('le jour de l’ordre proposé est celui qui s’enregistre : le début de la période en cours', () => {
    const plan = computePlan(sansOrdre(), JOUR);
    const t = plan.transfers.find((x) => x.accountName === 'Livret A')!;
    const c = consigneDe(ordreAPoser(plan, t, 'acc-principal')!);
    expect(c.jour).toBe(28);
    expect(c.fenetre).toBe(5);
  });
});

describe('[niveau 1] #13 · 6 — copier le libellé, ou rien', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('le libellé exact, blancs compris', async () => {
    const copie: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: (t: string) => (copie.push(t), Promise.resolve()) } });
    expect(await copierTexte('TIRELIRE LIVRET A ')).toBe(true);
    expect(copie).toEqual(['TIRELIRE LIVRET A ']);
  });
  it('sans presse-papiers, ou refusé : faux, rien de copié', async () => {
    vi.stubGlobal('navigator', {});
    expect(await copierTexte('X')).toBe(false);
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('refusé')) } });
    expect(await copierTexte('X')).toBe(false);
  });
  it('[niveau 4] le libellé montré est celui du plan, dans sa longueur de libellé bancaire', () => {
    const l = transferLabel('Livret d’épargne populaire famille Dupont');
    expect(l).toBe('TIRELIRE LIVRET D EPARGNE POPULAIRE');
    expect(l.length).toBe(35);
  });
});

describe('[niveau 1] #13 · 7 — ce qui se passera ensuite', () => {
  it('reconnaissance, parts, non affecté, évolution sans réécriture, sans supposer l’import ; vouvoyé', () => {
    expect(EXPLICATION_SUITE).toMatch(/libellé et son montant, dans la tolérance de l’ordre/);
    expect(EXPLICATION_SUITE).toMatch(/prend les parts de la ventilation de l’ordre/);
    expect(EXPLICATION_SUITE).toMatch(/reste non affecté sur le compte qui reçoit le virement/);
    expect(EXPLICATION_SUITE).toMatch(/quand modifier l’ordre chez votre banque/);
    expect(EXPLICATION_SUITE).toMatch(/ne réécrit jamais/);
    expect(EXPLICATION_SUITE).toMatch(/^Importer vos relevés n’est pas nécessaire/);
    expect(EXPLICATION_SUITE).not.toMatch(/\b(tu|te|ton|ta|tes)\b/i);
  });
  // Repris du test du codeur, second tour (`ordres-a-poser-suite.test.ts`) : point 7, précisé le 08/10.
  it('sans import, l’ordre compte à sa date, il n’est ni tenu pour exécuté ni dit manquant (D52)', () => {
    const premiere = EXPLICATION_SUITE.split('. ')[0]!;
    expect(premiere).toMatch(/^Importer vos relevés n’est pas nécessaire : sans import, /);
    expect(premiere).toMatch(/le plan compte l’ordre à sa date, parce qu’il est enregistré/);
    expect(premiere).toMatch(/ne le dit jamais manquant/);
    expect(EXPLICATION_SUITE).not.toMatch(/exécuté/);
  });
  it('[niveau 4] affiché dans l’assistant, replié sur l’écran Plan (lecture du source)', () => {
    expect(lire('src/views/Wizard.svelte')).toMatch(/<ExplicationSuite \/>/);
    expect(lire('src/views/Plan.svelte')).toMatch(/<ExplicationSuite repliee \/>/);
  });
});
