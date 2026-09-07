/**
 * État réactif de l'application : le grand livre chargé depuis le dépôt,
 * la date de calcul, et le plan dérivé.
 */
import {
  computePlan,
  emptyLedger,
  exampleLedger,
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

export type View = 'plan' | 'operations' | 'import' | 'review' | 'more' | 'accounts' | 'envelopes' | 'flows' | 'entries' | 'settings' | 'wizard';

class AppState {
  ledger = $state<Ledger>(emptyLedger());
  asOf = $state<string>(todayISO());
  view = $state<View>('plan');
  ready = $state(false);
  error = $state<string | undefined>(undefined);
  private opened: OpenedStore | undefined;

  plan: Plan = $derived(computePlan(this.ledger, this.asOf));

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

  /** Écrit un patch (opérations + ventilations) d'un seul coup. */
  applyPatch(patch: Patch): void {
    for (const o of patch.operations) this.store.upsert('operations', o);
    for (const a of patch.allocations) this.store.upsert('allocations', a);
    if (patch.operations.length || patch.allocations.length) this.reload();
  }

  /** Applique un patch sans recharger (pour enchaîner), puis rend le grand livre relu. */
  applyPatchQuiet(patch: Patch): Ledger {
    for (const o of patch.operations) this.store.upsert('operations', o);
    for (const a of patch.allocations) this.store.upsert('allocations', a);
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
    for (const a of l.accounts) s.upsert('accounts', a);
    for (const e of l.envelopes) s.upsert('envelopes', e);
    for (const c of l.categories) s.upsert('categories', c);
    for (const f of l.plannedFlows) s.upsert('plannedFlows', f);
    for (const o of l.operations) s.upsert('operations', o);
    for (const a of l.allocations) s.upsert('allocations', a);
    for (const r of l.rules) s.upsert('rules', r);
    for (const p of l.importProfiles) s.upsert('importProfiles', p);
    s.setSetting('budgetYearStart', l.settings.budgetYearStart);
    s.setSetting('pivotCushion', l.settings.pivotCushion);
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
