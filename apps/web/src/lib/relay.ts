/**
 * Client du relais : dépose chiffré ce que le relais n'a pas encore reçu de nous, tire et applique
 * ce que les autres y ont déposé (delta d'état, D58). Chiffrement AES-GCM avec une clé dérivée
 * (PBKDF2) de la phrase du foyer ; le relais ne voit jamais la phrase ni le contenu. Les curseurs
 * sont propres à l'instance : ils ne sont pas dans le fichier.
 */
import { checkBundle, exportBundle, importBundle, type Conflict, type Knowledge, type LedgerStore, type StateBundle } from '@tirelire/core';

export interface RelayConfig {
  url: string;
  room: string;
  passphrase: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(passphrase: string, room: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('tirelire:' + room), iterations: 200_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function encrypt(key: CryptoKey, text: string): Promise<{ iv: string; blob: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { iv: b64(iv), blob: b64(new Uint8Array(ct)) };
}

async function decrypt(key: CryptoKey, iv: string, blob: string): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) as BufferSource }, key, unb64(blob) as BufferSource);
  return dec.decode(pt);
}

/** Ce que nos dépôts ont déjà porté au relais (ce que nous savions au dernier dépôt). */
const PUSH_KEY = 'relay_pushed';
/** Dernier dépôt des autres déjà tiré. */
export const PULL_KEY = 'relay_pulled_after';

export function newRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface RelayResult {
  pushed: number;
  pulledBundles: number;
  applied: number;
  /** Lignes modifiées des deux côtés : la version retenue et l'écartée. */
  conflicts: Conflict[];
}

/** Un aller-retour complet : déposer nos nouveautés, tirer et appliquer celles des autres. */
export async function relaySync(store: LedgerStore, cfg: RelayConfig, deviceName?: string): Promise<RelayResult> {
  const base = cfg.url.replace(/\/+$/, '') + '/r/' + encodeURIComponent(cfg.room);
  const key = await deriveKey(cfg.passphrase, cfg.room);

  // Tirer d'abord, tout vérifier avant de rien appliquer : un dépôt d'un autre format arrête
  // l'échange, et rien n'est reçu ni déposé.
  const after = Number(store.getLocal(PULL_KEY) ?? 0);
  const res = await fetch(`${base}?site=${encodeURIComponent(store.siteId)}&after=${after}`);
  if (!res.ok) throw new Error(`Relais : ${res.status}`);
  const { records } = (await res.json()) as { records: Array<{ id: number; site: string; iv: string; blob: string }> };
  const bundles: StateBundle[] = [];
  let last = after;
  for (const r of records) {
    let text: string;
    try {
      text = await decrypt(key, r.iv, r.blob);
    } catch {
      throw new Error('Phrase de chiffrement incorrecte (ou paquet corrompu).');
    }
    let b: unknown;
    try {
      b = JSON.parse(text);
    } catch {
      throw new Error('Paquet du relais illisible. Rien n’a été reçu.');
    }
    checkBundle(b);
    bundles.push(b);
    last = Math.max(last, r.id);
  }
  let applied = 0;
  const conflicts: Conflict[] = [];
  for (const b of bundles) {
    const r = importBundle(store, b);
    applied += r.applied;
    conflicts.push(...r.conflicts);
  }
  store.setLocal(PULL_KEY, String(last));

  // Déposer ce que le relais n'a pas encore reçu de nous.
  const pushed = readKnowledge(store.getLocal(PUSH_KEY));
  const bundle = exportBundle(store, pushed, deviceName);
  if (bundle.rows.length) {
    const { iv, blob } = await encrypt(key, JSON.stringify(bundle));
    const res2 = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site: store.siteId, iv, blob }) });
    if (!res2.ok) throw new Error(`Relais : ${res2.status}`);
    store.setLocal(PUSH_KEY, JSON.stringify(bundle.knowledge));
  }
  return { pushed: bundle.rows.length, pulledBundles: records.length, applied, conflicts };
}

function readKnowledge(json: string | undefined): Knowledge {
  try {
    const k = JSON.parse(json ?? '{}') as Knowledge;
    return k && typeof k === 'object' ? k : {};
  } catch {
    return {};
  }
}
