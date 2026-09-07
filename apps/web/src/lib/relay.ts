/**
 * Client du relais : pousse nos changements chiffrés, tire ceux des autres.
 * Chiffrement AES-GCM avec une clé dérivée (PBKDF2) de la phrase du foyer ;
 * le relais ne voit jamais la phrase ni le contenu.
 */
import { exportBundle, importBundle, type ChangeBundle, type LedgerStore } from '@tirelire/core';

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

const PUSH_KEY = 'relay_pushed_upto';
const PULL_KEY = 'relay_pulled_after';

function getMeta(store: LedgerStore, key: string): number {
  return Number(store.query(`SELECT value FROM meta WHERE key = ?`, [key])[0]?.['value'] ?? 0);
}
function setMeta(store: LedgerStore, key: string, v: number): void {
  store.query(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [key, String(v)]);
}

export function newRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface RelayResult {
  pushed: number;
  pulledBundles: number;
  applied: number;
}

/** Un aller-retour complet : pousser nos nouveautés, tirer et appliquer celles des autres. */
export async function relaySync(store: LedgerStore, cfg: RelayConfig, deviceName?: string): Promise<RelayResult> {
  const base = cfg.url.replace(/\/+$/, '') + '/r/' + encodeURIComponent(cfg.room);
  const key = await deriveKey(cfg.passphrase, cfg.room);

  // Pousser
  const since = getMeta(store, PUSH_KEY);
  const bundle = exportBundle(store, since, deviceName);
  let pushed = 0;
  if (bundle.entries.length) {
    const { iv, blob } = await encrypt(key, JSON.stringify(bundle));
    const res = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site: store.siteId, upTo: bundle.upTo, iv, blob }) });
    if (!res.ok) throw new Error(`Relais : ${res.status}`);
    setMeta(store, PUSH_KEY, bundle.upTo);
    pushed = bundle.entries.length;
  }

  // Tirer
  const after = getMeta(store, PULL_KEY);
  const res = await fetch(`${base}?site=${encodeURIComponent(store.siteId)}&after=${after}`);
  if (!res.ok) throw new Error(`Relais : ${res.status}`);
  const { records } = (await res.json()) as { records: Array<{ id: number; site: string; iv: string; blob: string }> };
  let applied = 0;
  let last = after;
  for (const r of records) {
    let text: string;
    try {
      text = await decrypt(key, r.iv, r.blob);
    } catch {
      throw new Error('Phrase de chiffrement incorrecte (ou paquet corrompu).');
    }
    const b = JSON.parse(text) as ChangeBundle;
    applied += importBundle(store, b).applied;
    last = Math.max(last, r.id);
  }
  setMeta(store, PULL_KEY, last);
  return { pushed, pulledBundles: records.length, applied };
}
