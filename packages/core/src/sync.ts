/**
 * Synchronisation entre appareils : protocole d'échange de changements,
 * indépendant du transport (fichier, relais HTTP, WebRTC…).
 *
 * Chaque appareil retient, pour chaque pair, le dernier numéro de séquence
 * (`seq`, propre au journal du pair) qu'il a reçu de lui. Un échange, symétrique :
 *   A → B : hello { site: A }                      (et B → A de même)
 *   A → B : request { cursor: dernier seq de B connu de A }
 *   B → A : changes { entries de B depuis ce seq, upTo }, puis done
 *   A ↔ B : bye { lastSeq } une fois tout reçu (le journal a grandi des entrées reçues)
 * Les entrées relayées (changements d'un troisième appareil déjà reçus) voyagent
 * aussi ; le destinataire ignore ce qu'il connaît déjà (empreinte unique).
 */
import type { ChangeEntry, LedgerStore } from './store.js';

export type SyncMessage =
  | { type: 'hello'; site: string; name?: string }
  | { type: 'request'; site: string; cursor: number }
  | { type: 'changes'; site: string; entries: ChangeEntry[]; upTo: number }
  | { type: 'done'; site: string }
  /** Envoyé quand chacun a tout reçu : position finale du journal, pour le curseur du pair. */
  | { type: 'bye'; site: string; lastSeq: number };

export interface Transport {
  send(msg: SyncMessage): void | Promise<void>;
  onMessage(cb: (msg: SyncMessage) => void): void;
  close(): void;
}

export interface SyncResult {
  peer: string;
  peerName?: string;
  sent: number;
  received: number;
  applied: number;
}

const CURSOR_PREFIX = 'peer_cursor:';

export function getPeerCursor(store: LedgerStore, peer: string): number {
  const r = store.query(`SELECT value FROM meta WHERE key = ?`, [CURSOR_PREFIX + peer]);
  return Number(r[0]?.['value'] ?? 0);
}

export function setPeerCursor(store: LedgerStore, peer: string, seq: number): void {
  store.query(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [CURSOR_PREFIX + peer, String(seq)]);
}

/** Pairs connus (ceux avec lesquels on a déjà échangé). */
export function knownPeers(store: LedgerStore): Array<{ site: string; cursor: number }> {
  return store
    .query(`SELECT key, value FROM meta WHERE key LIKE ?`, [CURSOR_PREFIX + '%'])
    .map((r) => ({ site: String(r['key']).slice(CURSOR_PREFIX.length), cursor: Number(r['value']) }));
}

/**
 * Déroule un échange complet avec un pair sur un transport déjà connecté.
 * Les deux côtés appellent `runSync` ; le protocole est symétrique.
 */
export function runSync(store: LedgerStore, transport: Transport, opts: { name?: string; timeoutMs?: number } = {}): Promise<SyncResult> {
  return new Promise((resolve, reject) => {
    let peer: string | undefined;
    let peerName: string | undefined;
    let sent = 0;
    let received = 0;
    let applied = 0;
    let weAreDone = false;
    let theyAreDone = false;
    let byeSent = false;
    const timer = setTimeout(() => reject(new Error('Synchronisation : délai dépassé')), opts.timeoutMs ?? 30_000);
    const finish = () => {
      if (weAreDone && theyAreDone && !byeSent) {
        byeSent = true;
        void transport.send({ type: 'bye', site: store.siteId, lastSeq: store.lastSeq });
      }
    };
    transport.onMessage((msg) => {
      try {
        if (msg.type === 'hello') {
          peer = msg.site;
          peerName = msg.name;
          void transport.send({ type: 'request', site: store.siteId, cursor: getPeerCursor(store, msg.site) });
        } else if (msg.type === 'request') {
          // Inutile de renvoyer au pair ses propres changements relayés.
          const entries = store.changesSince(msg.cursor).filter((e) => e.site !== msg.site);
          sent = entries.length;
          void transport.send({ type: 'changes', site: store.siteId, entries, upTo: store.lastSeq });
          void transport.send({ type: 'done', site: store.siteId });
          weAreDone = true;
          finish();
        } else if (msg.type === 'changes') {
          received += msg.entries.length;
          const res = store.applyRemote(msg.entries);
          applied += res.applied;
          setPeerCursor(store, msg.site, Math.max(getPeerCursor(store, msg.site), msg.upTo));
        } else if (msg.type === 'done') {
          theyAreDone = true;
          finish();
        } else if (msg.type === 'bye') {
          setPeerCursor(store, msg.site, Math.max(getPeerCursor(store, msg.site), msg.lastSeq));
          clearTimeout(timer);
          resolve({ peer: peer ?? msg.site, ...(peerName ? { peerName } : {}), sent, received, applied });
        }
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
    void transport.send({ type: 'hello', site: store.siteId, ...(opts.name ? { name: opts.name } : {}) });
  });
}

// ---------------------------------------------------------------------------
// Échange par fichier
// ---------------------------------------------------------------------------

export interface ChangeBundle {
  format: 'tirelire-changes';
  version: 1;
  site: string;
  name?: string;
  /** Premier seq inclus dans le paquet (exclusif : entries.seq > from). */
  from: number;
  upTo: number;
  entries: ChangeEntry[];
}

/** Paquet de tous les changements après `since` (0 = tout), à envoyer à un autre appareil. */
export function exportBundle(store: LedgerStore, since = 0, name?: string): ChangeBundle {
  const entries = store.changesSince(since);
  return { format: 'tirelire-changes', version: 1, site: store.siteId, ...(name ? { name } : {}), from: since, upTo: store.lastSeq, entries };
}

export function importBundle(store: LedgerStore, bundle: ChangeBundle): { applied: number; ignored: number; stale: number } {
  if (bundle.format !== 'tirelire-changes') throw new Error('Ce fichier n’est pas un paquet de changements Tirelire.');
  const res = store.applyRemote(bundle.entries);
  setPeerCursor(store, bundle.site, Math.max(getPeerCursor(store, bundle.site), bundle.upTo));
  return res;
}

/** Transport en mémoire reliant deux pairs (tests, et même appareil). */
export function memoryTransportPair(): [Transport, Transport] {
  let cbA: ((m: SyncMessage) => void) | undefined;
  let cbB: ((m: SyncMessage) => void) | undefined;
  const queueA: SyncMessage[] = [];
  const queueB: SyncMessage[] = [];
  const deliver = (queue: SyncMessage[], cb: ((m: SyncMessage) => void) | undefined) => {
    if (!cb) return;
    while (queue.length) {
      const m = queue.shift()!;
      queueMicrotask(() => cb(m));
    }
  };
  const a: Transport = {
    send: (m) => {
      queueB.push(m);
      deliver(queueB, cbB);
    },
    onMessage: (cb) => {
      cbA = cb;
      deliver(queueA, cbA);
    },
    close: () => undefined,
  };
  const b: Transport = {
    send: (m) => {
      queueA.push(m);
      deliver(queueA, cbA);
    },
    onMessage: (cb) => {
      cbB = cb;
      deliver(queueB, cbB);
    },
    close: () => undefined,
  };
  return [a, b];
}
