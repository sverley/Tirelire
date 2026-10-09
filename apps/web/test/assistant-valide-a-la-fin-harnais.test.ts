/**
 * Harnais d'audit de #210, côté brouillon — ce que la validation de l'assistant écrit dans le projet : tout à la
 * fois, ou rien. Point 2 du « Fait quand » : « une validation interrompue ne laisse pas une partie du budget sans
 * le reste ». Sans navigateur, sur un vrai dépôt (`LedgerStore`).
 *
 * Le premier test est celui du codeur (`assistant-brouillon.test.ts`, d'où il est déplacé) : l'application ne
 * conserve le projet qu'après un délai qui suit la dernière écriture, donc une validation dont toutes les écritures
 * se suivent sans attente ne peut pas être conservée à moitié. Le second est ajouté : l'autre manière d'être
 * interrompue est un refus du dépôt en route, et un projet à moitié écrit en resterait. Il ne dit pas par où
 * le refus doit venir — au geste qui prépare la ligne, comme pour `ecrire` et `reglage`, ou à la validation, avant
 * d'écrire —, seulement que le budget entre en entier ou pas du tout. Les autres tests du codeur sur ce point (la
 * validation exacte, sa reprise après une interruption simulée) restent dans son fichier, au niveau 4 : l'exactitude
 * est tranchée par `assistant-valide-a-la-fin-ecran.test.ts`, sur l'application montée sous jsdom (#418).
 *
 * Niveau (D83) : 2 pour les deux. Un budget à moitié écrit est un cas faux de la validation, l'usage restant possible
 * : le brouillon garde ce qui manque, et le reste se saisit dans les écrans ordinaires.
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { LedgerStore, MAIN_ACCOUNT_ID, RowRefused, alive, type Account, type Ledger, type LedgerKey, type Need, type PlannedFlow, type Tirelire } from '@tirelire/core';
import { ecrire, nouveauBrouillon, reglage, retirer, valider } from '../src/lib/brouillon';

const SQL = await initSqlJs();
const ECHEANCE = { interval: 1, unit: 'month', anchorDate: '2026-09-05' } as const;

const livretA = (): Account => ({ id: 'livret', name: 'Livret A', kind: 'epargne', openingBalance: 0, openingDate: '2026-09-01' });
const vacances = (): Tirelire => ({ id: 't-vacances', name: 'Vacances', placement: [], openingBalance: 0, openingDate: '2026-09-01' });
const besoin = (): Need => ({ id: 'n-vacances', tirelireId: 't-vacances', kind: 'recurring', amount: 5000, periodicity: ECHEANCE, priority: 1 });
const salaire = (): PlannedFlow => ({ id: 'f-salaire', name: 'Salaire', kind: 'income', amount: 200000, accountId: MAIN_ACCOUNT_ID, periodicity: ECHEANCE, dateWindowDays: 3 });

const vivantes = (projet: Ledger, cle: LedgerKey): string[] => alive(projet[cle] as unknown as Array<{ id: string; deletedAt?: string }>).map((l) => l.id).sort();

/** Un budget préparé : un autre compte, une tirelire et son besoin, un flux, un réglage. */
function preparer(projet: Ledger) {
  const b = nouveauBrouillon(projet);
  ecrire(b, 'accounts', livretA());
  ecrire(b, 'tirelires', vacances());
  ecrire(b, 'needs', besoin());
  ecrire(b, 'plannedFlows', salaire());
  reglage(b, 'periodStartDay', 5);
  return b;
}

describe('[niveau 2] #210 · 2 — une validation interrompue ne laisse pas une partie du budget sans le reste', () => {
  it('toutes les écritures ont lieu pendant l’appel : aucune attente entre deux d’entre elles où le projet serait à moitié écrit', async () => {
    const store = await LedgerStore.create({ sqlJs: SQL });
    const projet = store.load();
    const b = preparer(projet);
    let pendant = false;
    let hors = 0;
    let dans = 0;
    store.onChange(() => (pendant ? dans++ : hors++));

    pendant = true;
    const rendu: unknown = valider(store, projet, b);
    pendant = false;

    expect(rendu).toBeUndefined(); // ni promesse, ni suite différée
    expect(dans).toBeGreaterThan(0);
    expect(hors).toBe(0);
  });

  it('un retrait que le dépôt refuserait (le compte principal) ne laisse pas le budget à moitié écrit : il entre en entier, ou pas du tout', async () => {
    const store = await LedgerStore.create({ sqlJs: SQL });
    expect(() => store.remove('accounts', MAIN_ACCOUNT_ID)).toThrow(RowRefused); // le dépôt le refuse
    const projet = store.load();
    const b = preparer(projet);

    // Le retrait est refusé au geste, ou à la validation : de toute façon, ce que dit le projet ensuite se lit.
    try {
      retirer(b, projet, 'accounts', MAIN_ACCOUNT_ID);
      valider(store, projet, b);
    } catch (refus) {
      expect(refus).toBeInstanceOf(RowRefused);
    }

    const apres = store.load();
    const ecrit = {
      compte: vivantes(apres, 'accounts').includes('livret'),
      tirelire: vivantes(apres, 'tirelires').includes('t-vacances'),
      besoin: vivantes(apres, 'needs').includes('n-vacances'),
      flux: vivantes(apres, 'plannedFlows').includes('f-salaire'),
    };
    const tout = Object.values(ecrit).every(Boolean);
    const rien = Object.values(ecrit).every((v) => !v);
    expect(tout || rien, `le budget est à moitié écrit : ${JSON.stringify(ecrit)}`).toBe(true);
  });
});
