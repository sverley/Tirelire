/** Montants en centimes : parsing et formatage à la française. */
import type { Cents } from './model.js';

export function euros(n: number): Cents {
  return Math.round(n * 100);
}

/** « 1 234,56 € » ; `sign` force l'affichage du signe +. */
export function formatCents(c: Cents, opts: { sign?: boolean; symbol?: boolean } = {}): string {
  const symbol = opts.symbol ?? true;
  const neg = c < 0;
  const abs = Math.abs(c);
  const int = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, '0');
  const intStr = int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const s = `${intStr},${dec}${symbol ? ' €' : ''}`;
  if (neg) return `−${s}`;
  if (opts.sign && c > 0) return `+${s}`;
  return s;
}

/** Lit « 1 234,56 », « -1234.56 », « 1.234,56 », « 12 € »… en centimes. */
export function parseCents(input: string): Cents | undefined {
  let s = input.trim().replace(/[€\s  ]/g, '');
  if (!s) return undefined;
  let neg = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  // Déterminer le séparateur décimal : le dernier de , ou . s'il est suivi de 1-2 chiffres.
  const m = /^(\d[\d.,]*?)(?:([.,])(\d{1,2}))?$/.exec(s);
  if (!m) return undefined;
  const intPart = m[1]!.replace(/[.,]/g, '');
  if (!/^\d+$/.test(intPart)) return undefined;
  const dec = (m[3] ?? '').padEnd(2, '0');
  const cents = Number(intPart) * 100 + Number(dec);
  return neg ? -cents : cents;
}

export function divideCents(total: Cents, parts: number): Cents {
  return Math.round(total / parts);
}
