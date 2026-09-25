/**
 * Import de relevés : profil (colonnes, formats), lecture des lignes,
 * clés déterministes, déduplication exacte et doublons probables.
 */
import type { Account, Cents, Id, ISODate, Ledger, Operation } from './model.js';
import { alive } from './model.js';
import { normalizeLabel, operationKey } from './ids.js';
import { parseCents } from './money.js';
import { diffDays, formatDate } from './dates.js';

export interface ImportColumns {
  date: string;
  valueDate?: string;
  label: string;
  fullLabel?: string;
  /** Montant signé, ou bien débit / crédit séparés. */
  amount?: string;
  debit?: string;
  credit?: string;
  account?: string;
  category?: string;
  subCategory?: string;
}

export const IMPORT_SOURCES = ['bank', 'linxo', 'other'] as const;
export const IMPORT_ENCODINGS = ['auto', 'utf-8', 'windows-1252'] as const;
export const IMPORT_DELIMITERS = ['auto', ';', ',', '\t', '|'] as const;
export const IMPORT_DATE_FORMATS = ['DMY', 'YMD', 'MDY'] as const;

export interface ImportProfile {
  id: Id;
  name: string;
  /** Source, pour la date de bascule et les doublons entre sources. */
  source: (typeof IMPORT_SOURCES)[number];
  encoding: (typeof IMPORT_ENCODINGS)[number];
  delimiter: (typeof IMPORT_DELIMITERS)[number];
  /** Indice (0-based) de la ligne d'en-tête ; les lignes avant sont ignorées. */
  headerRow: number;
  columns: ImportColumns;
  dateFormat: (typeof IMPORT_DATE_FORMATS)[number];
  /** Débit / crédit en colonnes séparées : le débit est-il exprimé en positif ? */
  debitPositive?: boolean;
  /** Valeur de la colonne compte → compte Tirelire. */
  accountMap: Record<string, Id>;
  /** Compte cible quand il n'y a pas de colonne compte. */
  accountId?: Id;
  deletedAt?: string;
}

export interface ParsedRow {
  line: number;
  date: ISODate;
  valueDate?: ISODate;
  label: string;
  fullLabel?: string;
  amount: Cents;
  accountKey?: string;
  suggestedCategory?: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: Array<{ line: number; message: string }>;
  headers: string[];
}

// ---------------------------------------------------------------------------
// Détection des colonnes à partir des en-têtes
// ---------------------------------------------------------------------------

const HEADER_HINTS: Array<[keyof ImportColumns, RegExp[]]> = [
  ['date', [/^date$/i, /date\s*(d')?\s*op/i, /date transaction/i, /^date op/i]],
  ['valueDate', [/date\s*(de\s*)?valeur/i, /date comptab/i]],
  ['account', [/^num.*compte/i, /^compte$/i, /libell[eé]\s*compte/i, /^account/i, /nom du compte/i]],
  ['fullLabel', [/libell[eé]\s*complet/i, /d[eé]tail/i, /description longue/i]],
  ['label', [/^libell[eé]$/i, /libell[eé]\s*op/i, /^libell/i, /^label$/i, /^description$/i, /^intitul/i, /^nom$/i]],
  ['amount', [/^montant$/i, /^montant\s*\(?eur/i, /^amount$/i, /^somme$/i]],
  ['debit', [/^d[eé]bit/i]],
  ['credit', [/^cr[eé]dit/i]],
  ['subCategory', [/sous.?cat/i]],
  ['category', [/^cat[eé]gorie/i, /^category/i]],
];

/** Propose une correspondance colonnes ← en-têtes. */
export function guessColumns(headers: string[]): Partial<ImportColumns> {
  const out: Partial<ImportColumns> = {};
  const used = new Set<string>();
  // Les motifs sont classés du plus précis au plus vague : on les essaie dans cet ordre sur tous les en-têtes.
  for (const [key, patterns] of HEADER_HINTS) {
    outer: for (const p of patterns) {
      for (const h of headers) {
        if (used.has(h)) continue;
        if (p.test(h.trim())) {
          out[key] = h;
          used.add(h);
          break outer;
        }
      }
    }
  }
  return out;
}

export function guessDateFormat(samples: string[]): ImportProfile['dateFormat'] {
  for (const s of samples) {
    if (/^\d{4}-\d{2}-\d{2}/.test(s.trim())) return 'YMD';
    const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-]\d{2,4}$/.exec(s.trim());
    if (m && Number(m[1]) > 12) return 'DMY';
    if (m && Number(m[2]) > 12) return 'MDY';
  }
  return 'DMY';
}

/** Trouve la ligne d'en-tête : la première dont une cellule ressemble à « date » et une à « montant/libellé ». */
export function guessHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i]!.map((c) => c.trim());
    const hasDate = cells.some((c) => /date/i.test(c));
    const hasAmount = cells.some((c) => /montant|amount|d[eé]bit|cr[eé]dit/i.test(c));
    if (hasDate && hasAmount) return i;
  }
  return 0;
}

export function newProfileFromRows(id: Id, name: string, rows: string[][]): ImportProfile {
  const headerRow = guessHeaderRow(rows);
  const headers = (rows[headerRow] ?? []).map((h) => h.trim());
  const columns = guessColumns(headers);
  const dateIdx = columns.date ? headers.indexOf(columns.date) : -1;
  const samples = rows.slice(headerRow + 1, headerRow + 30).map((r) => r[dateIdx] ?? '');
  return {
    id,
    name,
    source: 'bank',
    encoding: 'auto',
    delimiter: 'auto',
    headerRow,
    columns: { date: columns.date ?? '', label: columns.label ?? columns.fullLabel ?? '', ...columns },
    dateFormat: dateIdx >= 0 ? guessDateFormat(samples) : 'DMY',
    debitPositive: true,
    accountMap: {},
  };
}

// ---------------------------------------------------------------------------
// Correspondance des comptes par numéro
// ---------------------------------------------------------------------------

/** Normalise un numéro de compte ou IBAN pour comparaison : espaces et ponctuation retirés, casse uniforme. */
export function normalizeAccountNumber(s: string): string {
  return s.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/**
 * Retrouve, parmi les comptes qui ont un numéro mémorisé (`Account.accountNumber`), celui qui
 * correspond à cette valeur de la colonne compte d'un fichier importé : égalité une fois
 * normalisé, ou l'un des deux se termine par l'autre (certains exports ne donnent que les
 * derniers chiffres). Sert à proposer une correspondance automatique dès la lecture du fichier,
 * y compris avec un nouveau profil d'import.
 */
export function matchAccountByNumber(accounts: Account[], raw: string): Account | undefined {
  const norm = normalizeAccountNumber(raw);
  if (norm.length < 4) return undefined; // trop court pour être fiable
  for (const a of accounts) {
    if (!a.accountNumber) continue;
    const an = normalizeAccountNumber(a.accountNumber);
    if (an.length < 4) continue;
    if (an === norm || an.endsWith(norm) || norm.endsWith(an)) return a;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Lecture des lignes
// ---------------------------------------------------------------------------

export function parseDateCell(s: string, format: ImportProfile['dateFormat']): ISODate | undefined {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(t);
  if (!m) return undefined;
  let a = Number(m[1]);
  let b = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  const [d, mo] = format === 'MDY' ? [b, a] : [a, b];
  if (format === 'YMD') return undefined;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return formatDate({ y, m: mo, d });
}

export function parseRows(rows: string[][], profile: ImportProfile): ParseResult {
  const headers = (rows[profile.headerRow] ?? []).map((h) => h.trim());
  const col = (name: string | undefined): number => (name ? headers.indexOf(name) : -1);
  const iDate = col(profile.columns.date);
  const iValue = col(profile.columns.valueDate);
  const iLabel = col(profile.columns.label);
  const iFull = col(profile.columns.fullLabel);
  const iAmount = col(profile.columns.amount);
  const iDebit = col(profile.columns.debit);
  const iCredit = col(profile.columns.credit);
  const iAccount = col(profile.columns.account);
  const iCat = col(profile.columns.category);
  const iSub = col(profile.columns.subCategory);
  const errors: ParseResult['errors'] = [];
  const out: ParsedRow[] = [];
  if (iDate < 0) errors.push({ line: profile.headerRow, message: 'Colonne de date introuvable.' });
  if (iAmount < 0 && iDebit < 0 && iCredit < 0) errors.push({ line: profile.headerRow, message: 'Colonne de montant introuvable.' });
  if (errors.length) return { rows: [], errors, headers };

  for (let i = profile.headerRow + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const cell = (idx: number) => (idx >= 0 ? (r[idx] ?? '').trim() : '');
    const date = parseDateCell(cell(iDate), profile.dateFormat);
    if (!date) {
      if (r.every((c) => !c.trim())) continue;
      errors.push({ line: i + 1, message: `Date illisible : « ${cell(iDate)} »` });
      continue;
    }
    let amount: Cents | undefined;
    if (iAmount >= 0 && cell(iAmount) !== '') amount = parseCents(cell(iAmount));
    else {
      const d = iDebit >= 0 && cell(iDebit) !== '' ? parseCents(cell(iDebit)) : undefined;
      const c = iCredit >= 0 && cell(iCredit) !== '' ? parseCents(cell(iCredit)) : undefined;
      if (d !== undefined) amount = profile.debitPositive === false ? d : -Math.abs(d);
      else if (c !== undefined) amount = Math.abs(c);
    }
    if (amount === undefined) {
      errors.push({ line: i + 1, message: 'Montant illisible.' });
      continue;
    }
    const label = cell(iLabel) || cell(iFull);
    const valueDate = iValue >= 0 ? parseDateCell(cell(iValue), profile.dateFormat) : undefined;
    const cat = [cell(iCat), cell(iSub)].filter(Boolean).join(' / ');
    out.push({
      line: i + 1,
      date,
      ...(valueDate ? { valueDate } : {}),
      label,
      ...(iFull >= 0 && cell(iFull) && cell(iFull) !== label ? { fullLabel: cell(iFull) } : {}),
      amount,
      ...(iAccount >= 0 ? { accountKey: cell(iAccount) } : {}),
      ...(cat ? { suggestedCategory: cat } : {}),
    });
  }
  return { rows: out, errors, headers };
}

// ---------------------------------------------------------------------------
// Préparation de l'import : clés, doublons
// ---------------------------------------------------------------------------

export interface ImportCandidate {
  row: ParsedRow;
  operation: Operation;
  /** Déjà en base avec la même clé : ignoré. */
  exact: boolean;
  /** Opération existante qui ressemble (même compte, même montant, ±3 jours, libellé proche). */
  probable?: Operation;
  similarity?: number;
}

export interface ImportPreparation {
  candidates: ImportCandidate[];
  /** Valeurs de colonne compte sans correspondance. */
  unmappedAccounts: string[];
  counts: { total: number; new: number; exact: number; probable: number; unmapped: number };
}

export function labelSimilarity(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter((t) => t.length > 2));
  const tb = new Set(b.split(' ').filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return a === b ? 1 : 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.min(ta.size, tb.size);
}

export function prepareImport(ledger: Ledger, parsed: ParsedRow[], profile: ImportProfile): ImportPreparation {
  const existing = alive(ledger.operations);
  const byKey = new Map(existing.map((o) => [o.id, o]));
  const byAccount = new Map<Id, Operation[]>();
  for (const o of existing) {
    const arr = byAccount.get(o.accountId);
    if (arr) arr.push(o);
    else byAccount.set(o.accountId, [o]);
  }
  const unmapped = new Set<string>();
  const rankCounter = new Map<string, number>();
  const candidates: ImportCandidate[] = [];
  const seenInFile = new Set<string>();

  for (const row of parsed) {
    let accountId: Id | undefined;
    if (row.accountKey !== undefined && profile.columns.account) {
      accountId = profile.accountMap[row.accountKey];
      if (!accountId) {
        unmapped.add(row.accountKey);
        continue;
      }
    } else accountId = profile.accountId;
    if (!accountId) {
      unmapped.add('(sans compte)');
      continue;
    }
    const normalized = normalizeLabel(row.label);
    const rankKey = [accountId, row.date, row.amount, normalized].join('|');
    const rank = rankCounter.get(rankKey) ?? 0;
    rankCounter.set(rankKey, rank + 1);
    const id = operationKey(accountId, row.date, row.amount, normalized, rank);
    const operation: Operation = {
      id,
      accountId,
      origin: 'imported',
      date: row.date,
      label: row.label,
      ...(row.fullLabel ? { details: row.fullLabel } : {}),
      normalizedLabel: normalized,
      amount: row.amount,
      state: 'untreated',
      ...(row.suggestedCategory ? { suggestedCategory: row.suggestedCategory } : {}),
    };
    const exact = byKey.has(id) || seenInFile.has(id);
    seenInFile.add(id);
    let probable: Operation | undefined;
    let similarity: number | undefined;
    if (!exact) {
      let best = 0;
      for (const o of byAccount.get(accountId) ?? []) {
        if (o.amount !== row.amount) continue;
        if (Math.abs(diffDays(o.date, row.date)) > 3) continue;
        if (o.origin !== 'imported') continue;
        const sim = labelSimilarity(o.normalizedLabel, normalized);
        const score = sim + (o.date === row.date ? 0.25 : 0);
        if (score > best) {
          best = score;
          probable = o;
          similarity = sim;
        }
      }
      if (probable && (similarity ?? 0) < 0.34 && probable.date !== row.date) probable = undefined;
    }
    candidates.push({ row, operation, exact, ...(probable ? { probable, similarity: similarity ?? 0 } : {}) });
  }
  const counts = {
    total: parsed.length,
    new: candidates.filter((c) => !c.exact && !c.probable).length,
    exact: candidates.filter((c) => c.exact).length,
    probable: candidates.filter((c) => !c.exact && c.probable).length,
    unmapped: parsed.length - candidates.length,
  };
  return { candidates, unmappedAccounts: [...unmapped], counts };
}

/** Profil pour l'export multi-comptes des banques françaises (deux dates, deux libellés, catégories, colonne Pointée). */
export function bankMultiAccountProfile(id: Id, name = 'Export banque (multi-comptes)'): ImportProfile {
  return {
    id,
    name,
    source: 'bank',
    encoding: 'auto',
    delimiter: 'auto',
    headerRow: 0,
    columns: {
      date: 'Date transaction',
      valueDate: 'Date comptabilisation',
      account: 'Num Compte',
      label: 'Libellé opération',
      fullLabel: 'Libellé complet',
      category: 'Catégorie',
      subCategory: 'Sous-Catégorie',
      amount: 'Montant',
    },
    dateFormat: 'DMY',
    accountMap: {},
  };
}
