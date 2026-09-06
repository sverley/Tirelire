/**
 * Lecture de fichiers CSV bancaires : décodage (UTF-8 ou Windows-1252),
 * détection du séparateur, découpage en lignes et cellules (guillemets gérés).
 */

export type Delimiter = ';' | ',' | '\t' | '|';

export function decodeBytes(bytes: Uint8Array, encoding: 'auto' | 'utf-8' | 'windows-1252' = 'auto'): string {
  if (encoding === 'utf-8') return new TextDecoder('utf-8').decode(bytes);
  if (encoding === 'windows-1252') return new TextDecoder('windows-1252').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function detectDelimiter(text: string): Delimiter {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const counts: Array<[Delimiter, number]> = ([';', ',', '\t', '|'] as Delimiter[]).map((d) => [
    d,
    (sample.match(new RegExp(d === '|' ? '\\|' : d === '\t' ? '\\t' : d, 'g')) ?? []).length,
  ]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ';';
}

/** Découpe un texte CSV en lignes de cellules. Les lignes vides sont ignorées. */
export function parseCsv(text: string, delimiter?: Delimiter): string[][] {
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === d) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}
