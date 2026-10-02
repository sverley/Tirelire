/**
 * Harnais d'audit de #198 — « Un fichier fabriqué dehors s'ouvre, ou dit clairement pourquoi il ne
 * s'ouvre pas (D58) ». Côté application ; la vérification elle-même, ses refus et la commande sont
 * gardés par le premier fichier, `packages/core/test/fichier-fabrique-harnais.test.ts`.
 *
 * Ce fichier garde le seul endroit où le codage relie l'application à la vérification : `openStore`
 * (`apps/web/src/lib/db.ts`), qui n'impose la vérification entière — avec ce qui se complète — qu'à
 * un fichier que l'utilisateur ouvre (importé, restauré), et jamais au fichier que l'application
 * tient déjà (points 3, 7 et 9). Rien de tout cela ne se voyait dans le cœur, et le codeur n'avait
 * pas de test sur ce fil (compte rendu, point 9). Les tests sont de moi.
 *
 * Il joue `openStore` tel que l'interface l'appelle (`importFile`, `apps/web/src/lib/state.svelte.ts`),
 * sur un `indexedDB` en mémoire : le navigateur n'est pas nécessaire, donc ce fichier se joue avec
 * l'interface sans navigateur. L'écran lui-même — le message de refus dans Réglages, son texte au
 * regard de C1 — reste aux vérifications manuelles de l'issue (`VM-C1-sans-geste`, `VM-C5-sauvegarde`).
 *
 * Niveaux (D83), par le besoin que couvre chaque test :
 * - 0 · l'irréparable : un fichier refusé ne remplace rien — l'utilisateur garde ce que l'application
 *   tenait (point 3, D30, C5).
 * - 2 · un cas est faux : un fichier fabriqué qui s'ouvre remplace les données, s'enregistre complété
 *   et se rouvre sans rien compléter (point 7) ; le fichier tenu n'est pas revérifié au démarrage
 *   (point 9).
 */
import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FILE_FORMAT, FORMAT_VERSION, MAIN_ACCOUNT_ID } from '@tirelire/core';

// Le module de l'application charge le wasm de sql.js par une adresse que seul Vite sait lire.
vi.mock('sql.js/dist/sql-wasm.wasm?url', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') };
});

const SQL = await initSqlJs();
const { openStore, OuvertureRefusee } = await import('../src/lib/db');

/** `indexedDB` en mémoire, de ce que `db.ts` lui demande : ouvrir, une transaction, lire, écrire, effacer. */
function navigateurNeuf(): void {
  const magasin = new Map<string, unknown>();
  const copie = (v: unknown) => (v instanceof Uint8Array ? new Uint8Array(v) : v);
  const requete = <T>(valeur: T) => {
    const r: { result?: T; onsuccess?: () => void } = {};
    setTimeout(() => {
      r.result = valeur;
      r.onsuccess?.();
    }, 0);
    return r;
  };
  const objectStore = {
    get: (k: string) => requete(copie(magasin.get(k))),
    put: (v: unknown, k: string) => (magasin.set(k, copie(v)), requete(undefined)),
    delete: (k: string) => (magasin.delete(k), requete(undefined)),
  };
  const base = {
    createObjectStore: () => objectStore,
    transaction: () => {
      const tx: { oncomplete?: () => void; objectStore: () => typeof objectStore } = { objectStore: () => objectStore };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  };
  Object.assign(globalThis, {
    indexedDB: {
      open: () => {
        const r: { result: typeof base; onupgradeneeded?: () => void; onsuccess?: () => void } = { result: base };
        setTimeout(() => (r.onupgradeneeded?.(), r.onsuccess?.()), 0);
        return r;
      },
    },
    window: { addEventListener: () => undefined },
  });
}

/** Un fichier fabriqué hors de l'application : le marqueur et la version, une table d'opérations, sans horloge. */
function fabriquer(operations: Array<Array<string | number>>): Uint8Array {
  const db = new SQL.Database();
  db.run('CREATE TABLE meta (key TEXT, value TEXT)');
  db.run('INSERT INTO meta VALUES (?, ?), (?, ?)', ['format', FILE_FORMAT, 'format_version', String(FORMAT_VERSION)]);
  db.run('CREATE TABLE operations (id, account_id, origin, date, label, amount, state)');
  for (const o of operations) db.run('INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?, ?)', o);
  const octets = db.export();
  db.close();
  return octets;
}
const op = (id: string, amount: number, date = '2026-09-06') => [id, MAIN_ACCOUNT_ID, 'manual', date, `Libellé ${id}`, amount, 'untreated'];

/** Les opérations d'une base ouverte, par identifiant. */
const ids = (s: { load(): { operations: Array<{ id: string }> } }) => s.load().operations.map((o) => o.id).sort();

beforeEach(navigateurNeuf);

describe('[niveau 0] #198 · 3. un fichier fabriqué refusé ne remplace rien : l’utilisateur garde ce que l’application tenait (D30, C5)', () => {
  it('le refus nomme la table, la ligne et la colonne ; les données tenues sont toujours là, au démarrage suivant', async () => {
    const tenu = await openStore();
    tenu.store.upsert('operations', { id: 'op-tenue', accountId: MAIN_ACCOUNT_ID, origin: 'manual', date: '2026-09-01', label: 'Loyer', normalizedLabel: 'LOYER', amount: -80000, state: 'untreated' } as never);
    await tenu.flush();
    tenu.store.close();

    const erreur = await openStore(fabriquer([op('op-1', -3.5)])).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(erreur).toBeInstanceOf(OuvertureRefusee);
    expect((erreur as InstanceType<typeof OuvertureRefusee>).reason).toBe('invalide');
    expect((erreur as Error).message).toContain('table operations, ligne « op-1 », colonne amount');

    const rouvert = await openStore();
    expect(ids(rouvert.store)).toEqual(['op-tenue']);
    rouvert.store.close();
  });
});

describe('[niveau 2] #198 · 7. un fichier fabriqué qui s’ouvre devient un fichier de l’application', () => {
  it('importé, il remplace les données, se complète, s’enregistre ; rouvert au démarrage, toutes ses lignes ont leur horloge, et rien ne se complète à l’import suivant', async () => {
    const tenu = await openStore();
    tenu.store.upsert('operations', { id: 'op-tenue', accountId: MAIN_ACCOUNT_ID, origin: 'manual', date: '2026-09-01', label: 'Loyer', normalizedLabel: 'LOYER', amount: -80000, state: 'untreated' } as never);
    await tenu.flush();

    const ouvert = await openStore(fabriquer([op('op-1', -350), op('op-2', -1200, '2026-09-07')]));
    expect(ids(ouvert.store)).toEqual(['op-1', 'op-2']); // le fichier remplace ce que l'application tenait
    expect(ouvert.store.completion.horloges.map((h) => h.id).sort()).toEqual(['op-1', 'op-2']);
    ouvert.store.close(); // `importFile` n'enregistre rien de plus : c'est `openStore` qui enregistre ce qu'il vient d'ouvrir

    const rouvert = await openStore(); // le démarrage suivant lit ce qui a été enregistré
    expect(ids(rouvert.store)).toEqual(['op-1', 'op-2']);
    expect(rouvert.store.query(`SELECT COUNT(*) AS n FROM operations WHERE hlc IS NULL OR hlc = ''`)[0]!['n']).toBe(0);
    const exporte = rouvert.store.export();
    rouvert.store.close();
    const reimporte = await openStore(exporte); // ce que l'application a enregistré s'importe, sans rien à compléter
    expect(reimporte.store.completion).toEqual({ tables: [], colonnes: [], horloges: [], comptePrincipal: false });
    reimporte.store.close();
  });
});

describe('[niveau 2] #198 · 9. le fichier que l’application tient déjà ne passe que par le contrôle du format', () => {
  it('une référence vers une ligne absente, que l’écriture ligne par ligne laisse passer, n’empêche pas le démarrage ; importée, elle refuse', async () => {
    const tenu = await openStore();
    tenu.store.upsert('subOperations', { id: 's-1', operationId: 'op-absente', share: { kind: 'variable' } } as never);
    await tenu.flush();
    const octets = tenu.store.export();
    tenu.store.close();

    const demarre = await openStore();
    expect(demarre.store.load().subOperations.map((s) => s.id)).toEqual(['s-1']);
    demarre.store.close();
    await expect(openStore(octets)).rejects.toMatchObject({ reason: 'invalide' });
  });
});
