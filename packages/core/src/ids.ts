/**
 * Identifiants.
 *  - `uuidv7()` pour tout ce que l'utilisateur crée : aléatoire mais ordonné dans le temps.
 *  - `operationKey()` pour les opérations importées : déterministe à partir des données
 *    de la banque, donc identique sur tous les appareils qui importent le même relevé.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import type { Cents, ISODate } from './model.js';

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.getRandomValues) throw new Error('crypto.getRandomValues indisponible');
  c.getRandomValues(b);
  return b;
}

/** UUID v7 (RFC 9562) : 48 bits de temps en ms, puis aléatoire. */
export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  const t = BigInt(now);
  b[0] = Number((t >> 40n) & 0xffn);
  b[1] = Number((t >> 32n) & 0xffn);
  b[2] = Number((t >> 24n) & 0xffn);
  b[3] = Number((t >> 16n) & 0xffn);
  b[4] = Number((t >> 8n) & 0xffn);
  b[5] = Number(t & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Normalisation d'un libellé bancaire pour la clé et le rapprochement :
 * majuscules sans accents, numéros de carte et dates incluses retirés,
 * espaces réduits.
 */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\b\d{2}[\/.-]\d{2}(?:[\/.-]\d{2,4})?\b/g, ' ') // dates incluses (02/09, 04/08/26)
    .replace(/\b(?:CARTE|CB|CARD)\s*[X*]+\d{2,}\b/g, ' ') // « CARTE X2009 »
    .replace(/\bX\d{4}\b/g, ' ')
    .replace(/\b\d{6,}[A-Z]?\b/g, ' ') // numéros de référence
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clé déterministe d'une opération importée.
 * `rank` distingue les opérations strictement identiques du même jour (0, 1, 2…).
 */
export function operationKey(
  accountId: string,
  date: ISODate,
  amount: Cents,
  normalizedLabel: string,
  rank: number,
): string {
  const material = [accountId, date, String(amount), normalizedLabel, String(rank)].join('');
  return 'op_' + bytesToHex(sha256(new TextEncoder().encode(material))).slice(0, 32);
}

export function sha256Hex(s: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(s)));
}
