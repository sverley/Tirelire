/**
 * État réactif de l'application : le grand livre chargé depuis le dépôt,
 * la date de calcul, et le plan dérivé.
 */
import {
  computePlan,
  emptyLedger,
  exampleLedger,
  LEDGER_KEYS,
  todayISO,
  uuidv7,
  type Ledger,
  type LedgerStore,
  type Patch,
  type Plan,
  type Settings,
} from '@tirelire/core';
import type { LedgerKey } from '@tirelire/core';
import { eraseStore, openStore, type OpenedStore } from './db';

export type View = 'plan' | 'operations' | 'import' | 'review' | 'more' | 'accounts' | 'tirelires' | 'categories' | 'flows' | 'entries' | 'settings' | 'sync' | 'wizard';

class AppState {
  ledger = $state<Ledger>(emptyLedger());
  asOf = $state<string>(todayISO());
  /** Date jusqu'à laquelle les soldes sont connus (D52) : au-delà, le plan simule sa propre exécution. */
  today = $state<string>(todayISO());
  view = $state<View>('plan');
  /** Vues traversées pour revenir en arrière (geste Android, chevron) sans quitter l'appli. */
  history = $state<View[]>([]);
  ready = $state(false);
  error = $state<string | undefined>(undefined);
  private opened: OpenedStore | undefined;

  plan: Plan = $derived(computePlan(this.ledger, this.asOf, this.today));

  get store(): LedgerStore {
    if (!this.opened) throw new Error('Dépôt non ouvert');
    return this.opened.store;
  }

  async init(): Promise<void> {
    try {
      this.opened = await openStore();
      this.reload();
      this.ready = true;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  reload(): void {
    this.ledger = this.store.load();
  }

  upsert<K extends LedgerKey>(key: K, row: Ledger[K][number]): void {
    this.store.upsert(key, row);
    this.reload();
  }

  remove(key: LedgerKey, id: string): void {
    this.store.remove(key, id);
    this.reload();
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.store.setSetting(key, value);
    this.reload();
  }

  newId(): string {
    return uuidv7();
  }

  /** Change d'onglet principal : repart d'une pile vide (nouveau contexte de navigation). */
  switchTab(view: View): void {
    this.history = [];
    this.view = view;
  }

  /** Ouvre une vue en gardant trace de la précédente pour le retour. */
  go(view: View): void {
    if (view === this.view) return;
    this.history = [...this.history, this.view];
    this.view = view;
  }

  /**
   * Revient à la vue précédente s'il y en a une. Renvoie `false` quand la pile est
   * vide (on est à la racine d'un onglet) : c'est à l'appelant de décider, par
   * exemple quitter l'application sur le geste Android.
   */
  back(): boolean {
    const rest = this.history.slice(0, -1);
    const previous = this.history.at(-1);
    if (previous === undefined) return false;
    this.history = rest;
    this.view = previous;
    return true;
  }

  /** Écrit un patch (opérations + ventilations) d'un seul coup. */
  applyPatch(patch: Patch): void {
    for (const o of patch.operations) this.store.upsert('operations', o);
    for (const a of patch.allocations) this.store.upsert('allocations', a);
    for (const id of patch.removedAllocations ?? []) this.store.remove('allocations', id);
    if (patch.operations.length || patch.allocations.length || patch.removedAllocations?.length) this.reload();
  }

  /** Applique un patch sans recharger (pour enchaîner), puis rend le grand livre relu. */
  applyPatchQuiet(patch: Patch): Ledger {
    for (const o of patch.operations) this.store.upsert('operations', o);
    for (const a of patch.allocations) this.store.upsert('allocations', a);
    for (const id of patch.removedAllocations ?? []) this.store.remove('allocations', id);
    this.ledger = this.store.load();
    return this.ledger;
  }

  /** Charge le jeu d'exemple de l'analyse (remplace les données courantes). */
  async loadExample(): Promise<void> {
    await this.replaceWith(exampleLedger());
    this.asOf = '2026-09-06';
  }

  async replaceWith(l: Ledger): Promise<void> {
    await this.eraseAll();
    const s = this.store;
    // Boucle sur `LEDGER_KEYS` plutôt qu'une table après l'autre : la liste écrite à la main avait
    // oublié `needs`, si bien que charger l'exemple donnait des tirelires sans aucun besoin — donc
    // un plan vide. Ajouter une table au modèle ne peut plus laisser cette fonction en arrière.
    for (const key of LEDGER_KEYS) for (const row of l[key]) s.upsert(key, row as never);
    // Les réglages du foyer, sauf `siteId` qui appartient à l'appareil et non aux données.
    s.setSetting('periodStartDay', l.settings.periodStartDay);
    s.setSetting('principalCushion', l.settings.principalCushion);
    s.setSetting('transferThreshold', l.settings.transferThreshold);
    this.reload();
  }

  /** Efface tout et repart d'un dépôt vide. */
  async eraseAll(): Promise<void> {
    this.opened?.store.close();
    await eraseStore();
    this.opened = await openStore();
    this.reload();
  }

  /** Export du fichier SQLite. */
  async exportBytes(): Promise<Uint8Array> {
    await this.opened?.flush();
    return this.store.export();
  }

  /** Remplace la base par un fichier SQLite importé. */
  async importFile(bytes: Uint8Array): Promise<void> {
    this.opened?.store.close();
    await eraseStore();
    this.opened = await openStore(bytes);
    this.reload();
  }
}

export const app = new AppState();
