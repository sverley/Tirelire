/**
 * Ouverture du dépôt SQLite dans le navigateur et persistance dans IndexedDB.
 * Le fichier SQLite complet est réécrit (debounce) après chaque changement.
 */
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { LedgerStore, migrateModel } from '@tirelire/core';

const DB_NAME = 'tirelire';
const STORE = 'files';
const KEY = 'ledger.sqlite';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<Uint8Array | undefined> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as Uint8Array | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: Uint8Array): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface OpenedStore {
  store: LedgerStore;
  /** Force une sauvegarde immédiate. */
  flush: () => Promise<void>;
}

export async function openStore(bytes?: Uint8Array): Promise<OpenedStore> {
  const sqlJs = await initSqlJs({ locateFile: () => wasmUrl });
  const existing = bytes ?? (await idbGet(KEY));
  const store = await LedgerStore.create({ sqlJs, ...(existing ? { bytes: existing } : {}) });
  // Un dépôt écrit sous un modèle antérieur est amené au modèle courant (D30) dès l'ouverture ;
  // la migration écrit par `upsert`, donc elle se propage aux autres appareils par le journal.
  const migration = migrateModel(store);
  const migrated = migration.steps.some((s) => s.written > 0);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> = Promise.resolve();
  const save = () => {
    saving = idbPut(KEY, store.export()).catch((err) => console.error('Sauvegarde impossible', err));
    return saving;
  };
  store.onChange(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  });
  if (bytes || migrated) await save();
  window.addEventListener('beforeunload', () => {
    if (timer) {
      clearTimeout(timer);
      void save();
    }
  });
  return {
    store,
    flush: async () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      await save();
    },
  };
}

export async function eraseStore(): Promise<void> {
  await idbDelete(KEY);
}
