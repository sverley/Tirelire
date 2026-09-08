/**
 * État réactif de l'application : le grand livre chargé depuis le dépôt,
 * la date de calcul, et le plan dérivé.
 */
import {
  computePlan,
  diffDays,
  emptyLedger,
  exampleLedger,
  todayISO,
  uuidv7,
  LEDGER_KEYS,
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
  view = $state<View>('plan');
  /** Vues traversées pour revenir en arrière (geste Android, chevron) sans quitter l'appli. */
  history = $state<View[]>([]);
  ready = $state(false);
  error = $state<string | undefined>(undefined);
  private opened: OpenedStore | undefined;

  plan: Plan = $derived(computePlan(this.ledger, this.asOf));

  /** Date de la dernière opération connue, tous comptes confondus (undefined sans opération). */
  lastOperationDate: string | undefined = $derived.by(() => {
    let last: string | undefined;
    for (const o of this.ledger.operations) if (!o.deletedAt && (last === undefined || o.date > last)) last = o.date;
    return last;
  });

  /**
   * Jours entre la dernière opération connue et la date de lecture. Au-delà de quelques jours,
   * les soldes et le plan supposent qu'il ne s'est rien passé depuis le dernier relevé importé :
   * l'interface doit le dire, sans quoi on lit un plan optimiste sans le savoir.
   */
  staleDays: number = $derived(this.lastOperationDate ? diffDays(this.lastOperationDate, this.asOf) : 0);

  /** La date de lecture est-elle le jour même ? Sinon, toute l'application lit une autre date. */
  readingToday: boolean = $derived(this.asOf === todayISO());

  /** Revenir à aujourd'hui après avoir consulté une autre date. */
  backToToday(): void {
    this.asOf = todayISO();
  }

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

  /**
   * Remplace le dépôt par un grand livre complet (l'exemple, un jeu de démonstration).
   *
   * Les tables sont parcourues depuis `LEDGER_KEYS`, jamais énumérées à la main : la liste écrite
   * à la main avait oublié les besoins (D28), et charger l'exemple donnait des tirelires vides,
   * donc un plan sans une seule ligne. Une table ajoutée au modèle est reprise ici d'office.
   *
   * Les réglages suivent le même principe, à une exception près : `siteId` désigne *cet* appareil
   * dans le journal de changements (D08) et n'appartient pas au grand livre recopié.
   */
  async replaceWith(l: Ledger): Promise<void> {
    await this.eraseAll();
    const s = this.store;
    const copyTable = <K extends (typeof LEDGER_KEYS)[number]>(key: K) => {
      for (const row of l[key]) s.upsert(key, row);
    };
    for (const key of LEDGER_KEYS) copyTable(key);
    for (const key of Object.keys(l.settings) as Array<keyof Settings>) {
      if (key === 'siteId') continue;
      s.setSetting(key, l.settings[key]);
    }
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
