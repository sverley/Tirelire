/**
 * Harnais d'audit de #407 — un retrait qui touche un ordre enregistré, dans l'assistant, sans
 * navigateur : le brouillon (`src/lib/brouillon.ts`), la section Comptes
 * (`src/lib/sectionComptes.svelte.ts`), les lignes du résumé (`src/lib/differenceAssistant.ts`) et la
 * lecture d'une ventilation (`src/lib/ventilationOrdre.ts`), sur un vrai dépôt (`LedgerStore`) qui
 * porte le budget de l'exemple. Le cœur est dans `packages/core/test/retrait-ordre-enregistre-harnais.test.ts` ;
 * l'écran, dans `navigateur/retrait-ordre-enregistre-harnais.test.ts`.
 *
 * Les tests sont ceux du codeur (`retrait-ordre-enregistre.test.ts`, déplacé ici en entier), classés
 * par la suite de questions de D83. Niveau 0 : les points 1, 2 et 4 dans l'assistant — une validation
 * qui retirerait l'ordre enregistré ou une de ses parts réécrirait ce que l'utilisateur a validé
 * (D60, I10), et le code corrigé ne le rendrait pas ; vus rouges sur le code de `main`. Niveau 2 :
 * l'ordre proposé (point 3, #395) et le résumé (point 7, D40). Niveau 1 : la lecture d'une
 * ventilation, que la carte du Plan (point 5, I10) et celle de l'assistant (point 8) partagent ; vue
 * rouge sur le code de `main`.
 *
 * L'ordre « Virement Livret A » (600 €) a trois parts fixes — Taxe foncière 100 €, Assurance auto 50 €,
 * Vacances 150 € — et la part variable d'Épargne de précaution. Chaque test dit, dans son titre, le
 * point du « Fait quand » qu'il tranche.
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { LedgerStore, MAIN_ACCOUNT_ID, alive, exampleLedger, standingOrderTarget, type Ledger, type LedgerKey, type PlannedFlow } from '@tirelire/core';
import { ecrire, montrer, nouveauBrouillon, preparerValidation, retirer, valider, type Brouillon } from '../src/lib/brouillon';
import { direDifference, direOrdresTouches } from '../src/lib/differenceAssistant';
import { lireVentilation } from '../src/lib/ventilationOrdre';

// La section Comptes est un module à runes : hors du compilateur Svelte, son `$state` est une valeur simple.
(globalThis as unknown as { $state: <T>(v: T) => T }).$state = (v) => v;
const { SectionComptes } = await import('../src/lib/sectionComptes.svelte');

const SQL = await initSqlJs();
const ORDRE = 'flow-vir-livret';

async function depot(): Promise<LedgerStore> {
  const s = await LedgerStore.create({ sqlJs: SQL, siteId: 't' });
  const l = exampleLedger();
  for (const k of ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows'] as const) for (const r of l[k]) s.upsert(k, r as never);
  return s;
}
const ordreDe = (l: Ledger, id = ORDRE) => l.plannedFlows.find((f) => f.id === id);
/** Retire une tirelire dans le brouillon, comme la section Tirelires : ses besoins, puis elle. */
function retirerTirelire(b: Brouillon, projet: Ledger, id: string) {
  for (const n of alive(montrer(projet, b).needs).filter((x) => x.tirelireId === id)) retirer(b, projet, 'needs', n.id);
  retirer(b, projet, 'tirelires', id);
}
/** La section Comptes de l'assistant : elle écrit dans le brouillon, et sait quels ordres le projet porte. */
function sectionDuBrouillon(projet: Ledger, b: Brouillon) {
  return new SectionComptes({
    get ledger() {
      return montrer(projet, b);
    },
    upsert: (key, row) => ecrire(b, key, row),
    remove: (key: LedgerKey, id: string) => retirer(b, projet, key, id),
    newId: () => 'id-neuf',
    asOf: '2026-09-06',
    periodStart: () => '2026-08-28',
    mainAccountId: () => MAIN_ACCOUNT_ID,
    coussin: 0,
    setCoussin: () => undefined,
    ordreEnregistre: (id) => projet.plannedFlows.some((f) => f.id === id && !f.deletedAt),
  });
}
/** Ce que le résumé dit des ordres enregistrés, comme l'assistant le calcule. */
function lignesDuResume(projet: Ledger, b: Brouillon) {
  const montre = montrer(projet, b);
  const nommer = (prop: string, id: string) =>
    ((prop === 'tirelireId' ? montre.tirelires : montre.accounts) as Array<{ id: string; name: string }>).find((l) => l.id === id)?.name;
  const enregistres = alive(montre.plannedFlows).filter((f) => projet.plannedFlows.some((x) => x.id === f.id && !x.deletedAt) && standingOrderTarget(f, MAIN_ACCOUNT_ID));
  const { difference } = preparerValidation(projet, b);
  return { lignes: direOrdresTouches(difference, enregistres, nommer), dite: direDifference(difference, [], nommer, enregistres) };
}

describe('[niveau 0] #407 · 1 et 4 — retirer une tirelire dans l’assistant laisse l’ordre enregistré', () => {
  for (const section of [undefined, 'tirelires'] as const) {
    it(`assistant ${section ? 'ouvert sur la section Tirelires' : 'complet'} : la validation écrit le retrait, l’ordre et ses parts restent`, async () => {
      const s = await depot();
      const projet = s.load();
      const avant = ordreDe(projet);
      const b = nouveauBrouillon(projet, section);
      retirerTirelire(b, projet, 'env-auto');
      valider(s, projet, b);
      const apres = s.load();
      expect(apres.tirelires.find((t) => t.id === 'env-auto')!.deletedAt).toBeTruthy();
      expect(ordreDe(apres)).toEqual(avant);
    });
  }
});

describe('#407 · 2 et 4 — retirer un compte dans l’assistant laisse l’ordre enregistré', () => {
  for (const section of [undefined, 'comptes'] as const) {
    it(`[niveau 0] assistant ${section ? 'ouvert sur la section Comptes' : 'complet'} : le retrait de la section ne retire pas l’ordre ; la validation l’écrit tel quel`, async () => {
      const s = await depot();
      const projet = s.load();
      const avant = ordreDe(projet);
      const b = nouveauBrouillon(projet, section);
      const sec = sectionDuBrouillon(projet, b);
      sec.retirer(sec.accounts.find((a) => a.id === 'acc-livret')!);
      expect(ordreDe(montrer(projet, b))).toEqual(avant);
      valider(s, projet, b);
      const apres = s.load();
      expect(apres.accounts.find((a) => a.id === 'acc-livret')!.deletedAt).toBeTruthy();
      expect(ordreDe(apres)).toEqual(avant);
      // Le reste de ce que fait le retrait d'un compte ne change pas : le placement des tirelires qui y dormaient.
      expect(alive(apres.tirelires).filter((t) => t.placement.some((p) => p.accountId === 'acc-livret'))).toEqual([]);
    });
  }

  it('[niveau 2] 3 — l’ordre proposé, que le projet ne porte pas encore, part avec son compte (#395, point 5)', async () => {
    const s = await depot();
    const projet = s.load();
    const b = nouveauBrouillon(projet);
    const propose: PlannedFlow = { ...ordreDe(projet)!, id: 'flow-propose', name: 'Virement proposé' };
    ecrire(b, 'plannedFlows', propose);
    const sec = sectionDuBrouillon(projet, b);
    sec.retirer(sec.accounts.find((a) => a.id === 'acc-livret')!);
    const montre = montrer(projet, b);
    expect(alive(montre.plannedFlows).map((f) => f.id)).toContain(ORDRE);
    expect(alive(montre.plannedFlows).map((f) => f.id)).not.toContain('flow-propose');
  });
});

describe('[niveau 2] #407 · 7 — le résumé le dit avant la validation', () => {
  it('une tirelire retirée : la ligne nomme l’ordre, dit que la part reste, non affectée sur le compte d’accueil, et que le Plan la signalera', async () => {
    const s = await depot();
    const projet = s.load();
    const b = nouveauBrouillon(projet, 'tirelires');
    retirerTirelire(b, projet, 'env-auto');
    const { lignes, dite } = lignesDuResume(projet, b);
    expect(lignes).toHaveLength(1);
    const t = lignes[0]!.texte;
    expect(t).toContain('« Virement Livret A »');
    expect(t).toContain('reste enregistré tel quel');
    expect(t).toContain('la part de « Assurance auto » reste dans l’ordre');
    expect(t).toContain('restera non affecté sur « Livret A »');
    expect(t).toContain('le Plan la signalera');
    expect(dite.ordres).toEqual(lignes);
  });

  it('un compte retiré : la ligne nomme l’ordre, dit qu’il continue de virer tant qu’il n’est pas supprimé à la banque, et que le Plan le signalera comme plus demandé', async () => {
    const s = await depot();
    const projet = s.load();
    const b = nouveauBrouillon(projet, 'comptes');
    const sec = sectionDuBrouillon(projet, b);
    sec.retirer(sec.accounts.find((a) => a.id === 'acc-livret')!);
    const { lignes } = lignesDuResume(projet, b);
    expect(lignes).toHaveLength(1);
    const t = lignes[0]!.texte;
    expect(t).toContain('« Virement Livret A » vers « Livret A » reste enregistré tel quel');
    expect(t).toContain('il continue de virer chez votre banque tant que vous ne l’y supprimez pas');
    expect(t).toContain('le Plan le signalera comme plus demandé');
  });

  it('un ordre retiré avec sa tirelire n’a pas de ligne ; une tirelire qu’aucun ordre ne désigne non plus', async () => {
    const s = await depot();
    const projet = s.load();
    const b = nouveauBrouillon(projet);
    retirerTirelire(b, projet, 'env-auto');
    retirer(b, projet, 'plannedFlows', ORDRE);
    expect(lignesDuResume(projet, b).lignes).toEqual([]);
    const c = nouveauBrouillon(projet);
    ecrire(c, 'tirelires', { id: 'env-seule', name: 'Seule', placement: [], openingBalance: 0, openingDate: '2026-08-28' });
    expect(lignesDuResume(projet, c).lignes).toEqual([]);
  });
});

describe('[niveau 1] #407 · 5 et 8 — la carte d’un ordre enregistré montre la part d’une tirelire retirée sous son nom', () => {
  it('la part se lit sous le nom de la tirelire, marquée comme retirée ; les autres non', () => {
    const allocation = ordreDe(exampleLedger())!.action!.allocation!;
    const l = exampleLedger();
    const noms = {
      tirelires: l.tirelires.filter((t) => t.id !== 'env-auto'),
      categories: [],
      retirees: l.tirelires.filter((t) => t.id === 'env-auto'),
    };
    const lecture = lireVentilation(60000, allocation, noms);
    expect(lecture.lignes.map((x) => [x.nom, x.retiree ?? false, x.montant])).toEqual([
      ['Taxe foncière', false, 10000],
      ['Assurance auto', true, 5000],
      ['Vacances', false, 15000],
      ['Épargne de précaution', false, 30000],
    ]);
    // Sans le nom de la tirelire retirée, la part se dit retirée, comme avant.
    expect(lireVentilation(60000, allocation, { tirelires: noms.tirelires, categories: [] }).lignes[1]!.nom).toBe('tirelire retirée');
  });
});
