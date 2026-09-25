/**
 * Ouverture du dépôt SQLite dans le navigateur et persistance dans IndexedDB.
 *
 * Deux entrées, écrites ensemble dans une même transaction : le fichier (les données, D58) et
 * l'état de l'instance — son identité, son horloge, ce qu'elle sait des autres, ses curseurs de
 * relais. Celui-ci n'est jamais dans le fichier : un fichier exporté puis ouvert ailleurs donne
 * une autre instance, et un fichier restauré ici garde l'identité d'ici sans rien croire savoir.
 *
 * Un fichier d'un autre format n'est ni ouvert, ni effacé, ni remplacé : `OuvertureRefusee` le
 * rend tel quel, pour que l'utilisateur l'enregistre avant de choisir.
 */
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { FormatRefused, LedgerStore, type InstanceState } from '@tirelire/core';
import { PULL_KEY } from './relay';

const DB_NAME = 'tirelire';
const STORE = 'files';
const KEY = 'ledger.sqlite';
const INSTANCE_KEY = 'instance.json';

/** Le fichier enregistré n'est pas au format de cette version : rien n'en a été touché. */
export class OuvertureRefusee extends Error {
  constructor(
    message: string,
    readonly bytes: Uint8Array,
    readonly reason: FormatRefused['reason'],
  ) {
    super(message);
    this.name = 'OuvertureRefusee';
  }
}

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

async function idbGetInstance(): Promise<InstanceState | undefined> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(INSTANCE_KEY);
    req.onsuccess = () => {
      try {
        resolve(req.result ? (JSON.parse(req.result as string) as InstanceState) : undefined);
      } catch {
        resolve(undefined);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/** Le fichier et l'instance, ensemble ou pas du tout : ce que l'instance sait suit son état. */
async function idbPutBoth(bytes: Uint8Array, instance: InstanceState): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(bytes, KEY);
    tx.objectStore(STORE).put(JSON.stringify(instance), INSTANCE_KEY);
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

/**
 * Ouvre le fichier enregistré, ou `bytes` (un fichier importé, une restauration) qui le remplace.
 * Un fichier refusé ne remplace rien : l'erreur `OuvertureRefusee` le rend, et rien n'est écrit.
 */
export async function openStore(bytes?: Uint8Array): Promise<OpenedStore> {
  const sqlJs = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = bytes ? undefined : await idbGet(KEY);
  const known = await idbGetInstance();
  const source = bytes ?? saved;
  // L'instance garde son identité et son horloge. Ce qu'elle sait ne vaut que pour l'état qu'elle
  // a enregistré : un autre état (fichier importé, départ à neuf) le redéduit de ses lignes, et le
  // relais se retire depuis le début.
  const continuing = !bytes && saved !== undefined;
  let instance: InstanceState | undefined;
  if (known && continuing) instance = known;
  else if (known) {
    const { [PULL_KEY]: _oublie, ...local } = known.local ?? {};
    instance = { siteId: known.siteId, ...(known.lastHlc ? { lastHlc: known.lastHlc } : {}), local };
  }
  let store: LedgerStore;
  try {
    store = await LedgerStore.create({ sqlJs, ...(source ? { bytes: source } : {}), ...(instance ? { instance } : {}) });
  } catch (err) {
    if (err instanceof FormatRefused && source) throw new OuvertureRefusee(err.message, source, err.reason);
    throw err;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> = Promise.resolve();
  const save = () => {
    saving = idbPutBoth(store.export(), store.instanceState()).catch((err) => console.error('Sauvegarde impossible', err));
    return saving;
  };
  store.onChange(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  });
  if (!continuing || !known) await save();
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

/** Efface les données ; l'instance garde son identité et son horloge. */
export async function eraseStore(): Promise<void> {
  await idbDelete(KEY);
}
