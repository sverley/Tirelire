/**
 * Synchronisation entre instances par delta d'état (D16, D58), indépendante du transport (direct,
 * relais, fichier).
 *
 * Chaque instance sait, pour chaque autre, la plus grande horloge qu'elle en a vue (`Knowledge`).
 * Un échange, symétrique :
 *   A → B : hello { ce que A sait }                  (et B → A de même)
 *   A → B : request                                  (« envoie-moi ce qui me manque »)
 *   B → A : changes { les lignes plus récentes que ce que A sait, ce que B sait }, puis done
 *   A ↔ B : bye une fois tout reçu
 * L'état d'une instance contient ce qu'elle a reçu des autres : ce qu'un appareil tient d'un
 * troisième se propage avec lui, sans rien de plus.
 *
 * Chaque message et chaque paquet porte son format et sa version : un autre format arrête
 * l'échange en le disant, avant que rien ne soit écrit (C8).
 */
import { FORMAT_VERSION } from './schema.js';
import { FormatRefused, knowledgeCovers, type Conflict, type Knowledge, type LedgerStore, type RowState } from './store.js';

/** Marqueur des messages et des paquets de synchronisation. */
export const SYNC_FORMAT = 'tirelire-etat';

interface Envelope {
  format: typeof SYNC_FORMAT;
  version: number;
  site: string;
}

export type SyncMessage =
  | (Envelope & { type: 'hello'; name?: string; knowledge: Knowledge })
  | (Envelope & { type: 'request' })
  | (Envelope & { type: 'changes'; rows: RowState[]; knowledge: Knowledge })
  | (Envelope & { type: 'done' })
  /** Fin de l'échange ; `refused` dit pourquoi l'autre l'arrête. */
  | (Envelope & { type: 'bye'; refused?: string });

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
  /** Lignes modifiées des deux côtés : la version retenue et l'écartée. */
  conflicts: Conflict[];
}

const ANCIEN_FORMAT = 'Le paquet vient d’une version antérieure de Tirelire, qui ne parle plus le même format : mettez à jour Tirelire sur cet appareil-là. Rien n’a été écrit.';

/**
 * Vérifie le format d'un message ou d'un paquet reçu ; lève `FormatRefused` sinon, avant toute
 * écriture.
 */
export function checkSyncFormat(msg: unknown): void {
  const m = msg as Partial<Envelope> & { format?: unknown; version?: unknown } | null;
  if (!m || typeof m !== 'object') throw new FormatRefused('etranger', 'Paquet illisible : ce n’est pas un paquet de synchronisation Tirelire. Rien n’a été écrit.');
  if (m.format === SYNC_FORMAT) {
    if (m.version === FORMAT_VERSION) return;
    const plusRecent = typeof m.version === 'number' && m.version > FORMAT_VERSION;
    throw new FormatRefused(
      plusRecent ? 'recent' : 'ancien',
      plusRecent
        ? `Le paquet vient d’une version plus récente de Tirelire (format ${String(m.version)}, ici ${FORMAT_VERSION}) : mettez à jour Tirelire sur cet appareil. Rien n’a été écrit.`
        : `Le paquet vient d’une version antérieure de Tirelire (format ${String(m.version)}, ici ${FORMAT_VERSION}) : mettez à jour Tirelire sur l’autre appareil. Rien n’a été écrit.`,
    );
  }
  // Le format d'avant D58 : un journal de changements (`tirelire-changes`, ou des messages sans format).
  if (m.format === 'tirelire-changes' || m.format === undefined) throw new FormatRefused('ancien', ANCIEN_FORMAT);
  throw new FormatRefused('etranger', 'Ce paquet n’est pas au format de synchronisation de Tirelire. Rien n’a été écrit.');
}

function envelope(store: LedgerStore): Envelope {
  return { format: SYNC_FORMAT, version: FORMAT_VERSION, site: store.siteId };
}

/** Pairs rencontrés (direct, relais ou fichier), avec la date du dernier échange. */
export function knownPeers(store: LedgerStore): Array<{ site: string; name?: string; at: string; knowledge: Knowledge }> {
  return store.listPeers();
}

/**
 * Déroule un échange complet avec un pair sur un transport déjà connecté.
 * Les deux côtés appellent `runSync` ; le protocole est symétrique.
 */
export function runSync(store: LedgerStore, transport: Transport, opts: { name?: string; timeoutMs?: number } = {}): Promise<SyncResult> {
  return new Promise((resolve, reject) => {
    let peer: string | undefined;
    let peerName: string | undefined;
    let peerKnowledge: Knowledge | undefined;
    let sent = 0;
    let received = 0;
    let applied = 0;
    const conflicts: Conflict[] = [];
    let weAreDone = false;
    let theyAreDone = false;
    let byeSent = false;
    let settled = false;
    const timer = setTimeout(() => fail(new Error('Synchronisation : délai dépassé')), opts.timeoutMs ?? 30_000);
    function fail(err: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    }
    const finish = () => {
      if (weAreDone && theyAreDone && !byeSent) {
        byeSent = true;
        void transport.send({ ...envelope(store), type: 'bye' });
      }
    };
    transport.onMessage((msg) => {
      if (settled) return;
      try {
        checkSyncFormat(msg);
      } catch (err) {
        // Dire à l'autre pourquoi l'échange s'arrête, s'il sait le lire ; ne rien écrire ici.
        try {
          void Promise.resolve(transport.send({ ...envelope(store), type: 'bye', refused: (err as Error).message })).catch(() => undefined);
        } catch {
          /* transport fermé */
        }
        return fail(err);
      }
      try {
        if (msg.type === 'hello') {
          peer = msg.site;
          peerName = msg.name;
          peerKnowledge = msg.knowledge ?? {};
          void transport.send({ ...envelope(store), type: 'request' });
        } else if (msg.type === 'request') {
          const rows = store.rowsNewerThan(peerKnowledge ?? {});
          sent = rows.length;
          void transport.send({ ...envelope(store), type: 'changes', rows, knowledge: store.getKnowledge() });
          void transport.send({ ...envelope(store), type: 'done' });
          weAreDone = true;
          finish();
        } else if (msg.type === 'changes') {
          received += msg.rows.length;
          // Les lignes ont été choisies d'après ce que nous avions annoncé : les recevoir toutes
          // nous apprend tout ce que le pair savait.
          const res = store.receive(msg.rows, { senderKnowledge: msg.knowledge, learn: msg.knowledge });
          applied += res.applied;
          conflicts.push(...res.conflicts);
          store.notePeer(msg.site, msg.knowledge, peerName);
        } else if (msg.type === 'done') {
          theyAreDone = true;
          finish();
        } else if (msg.type === 'bye') {
          if (msg.refused) return fail(new FormatRefused('etranger', `L’autre appareil a arrêté la synchronisation : ${msg.refused}`));
          settled = true;
          clearTimeout(timer);
          resolve({ peer: peer ?? msg.site, ...(peerName ? { peerName } : {}), sent, received, applied, conflicts });
        }
      } catch (err) {
        fail(err);
      }
    });
    void transport.send({ ...envelope(store), type: 'hello', ...(opts.name ? { name: opts.name } : {}), knowledge: store.getKnowledge() });
  });
}

// ---------------------------------------------------------------------------
// Paquets : échange par fichier, dépôts sur le relais
// ---------------------------------------------------------------------------

export interface StateBundle extends Envelope {
  type: 'paquet';
  name?: string;
  /** Ce que l'émetteur supposait déjà connu du destinataire : les lignes vont au-delà. */
  base: Knowledge;
  /** Ce que l'émetteur savait en faisant le paquet. */
  knowledge: Knowledge;
  rows: RowState[];
}

/**
 * Paquet des lignes qu'ignore une instance qui sait `since` (rien : tout l'état). Un nombre, forme
 * d'un ancien curseur, vaut « tout ».
 */
export function exportBundle(store: LedgerStore, since?: Knowledge | number, name?: string): StateBundle {
  const base = typeof since === 'object' && since ? { ...since } : {};
  return { ...envelope(store), type: 'paquet', ...(name ? { name } : {}), base, knowledge: store.getKnowledge(), rows: store.rowsNewerThan(base) };
}

/** Paquet pour un pair déjà rencontré : seulement ce qu'il n'avait pas au dernier échange. */
export function exportBundleFor(store: LedgerStore, peer: string | undefined, name?: string): StateBundle {
  const known = peer ? store.listPeers().find((p) => p.site === peer)?.knowledge : undefined;
  return exportBundle(store, known, name);
}

export interface BundleResult {
  applied: number;
  ignored: number;
  stale: number;
  conflicts: Conflict[];
}

/** Vérifie un paquet reçu (format, forme) sans rien écrire. */
export function checkBundle(bundle: unknown): asserts bundle is StateBundle {
  checkSyncFormat(bundle);
  const b = bundle as Partial<StateBundle>;
  if (b.type !== 'paquet' || !Array.isArray(b.rows) || !b.knowledge || typeof b.knowledge !== 'object' || !b.base || typeof b.base !== 'object')
    throw new FormatRefused('etranger', 'Ce paquet n’est pas un paquet de synchronisation Tirelire complet. Rien n’a été écrit.');
}

export function importBundle(store: LedgerStore, bundle: StateBundle): BundleResult {
  checkBundle(bundle);
  // Ce que le paquet apprend ne vaut que si l'on savait déjà ce qu'il supposait connu : sinon il
  // peut manquer des lignes entre les deux, qu'un autre échange apportera.
  const complete = knowledgeCovers(store.getKnowledge(), bundle.base);
  const res = store.receive(bundle.rows, { senderKnowledge: bundle.knowledge, ...(complete ? { learn: bundle.knowledge } : {}) });
  store.notePeer(bundle.site, bundle.knowledge, bundle.name);
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
