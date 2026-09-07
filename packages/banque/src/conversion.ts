/**
 * Des opérations Enable Banking aux lignes d'import de Tirelire (`ParsedRow`),
 * puis à un CSV que l'écran d'import reconnaît sans profil particulier.
 */
import type { ParsedRow } from '@tirelire/core';
import type { CompteBanque, Operation } from './enable-banking.ts';

export interface OptionsConversion {
  /** Valeur mise dans la colonne compte (par défaut l'IBAN, sinon le nom du compte). */
  compte?: string;
  /** Garder aussi les opérations en attente (`PDNG`) ? Par défaut non : leur libellé et
   *  leur date changent à la comptabilisation, ce qui casserait la clé déterministe. */
  garderAttente?: boolean;
}

/** Montant signé en centimes : Enable Banking donne un montant (souvent positif) et un sens. */
export function montantCentimes(op: Operation): number {
  const brut = Math.round(Math.abs(Number(op.transaction_amount.amount.replace(',', '.'))) * 100);
  if (!Number.isFinite(brut)) throw new Error(`Montant illisible : ${op.transaction_amount.amount}`);
  const sens = op.credit_debit_indicator;
  if (sens === 'DBIT') return -brut;
  if (sens === 'CRDT') return brut;
  return op.transaction_amount.amount.trim().startsWith('-') ? -brut : brut;
}

/** Libellé court : lignes de remise, sinon contrepartie, sinon code de la banque. */
export function libelle(op: Operation): { court: string; complet?: string } {
  const remise = (op.remittance_information ?? []).map((l) => l.trim()).filter(Boolean);
  const partie = op.credit_debit_indicator === 'CRDT' ? op.debtor?.name : op.creditor?.name;
  const court = remise[0] ?? partie?.trim() ?? op.bank_transaction_code?.description ?? 'Opération';
  const morceaux = [...remise];
  if (partie && !morceaux.some((m) => m.includes(partie))) morceaux.push(partie.trim());
  if (op.bank_transaction_code?.description) morceaux.push(op.bank_transaction_code.description);
  const complet = morceaux.join(' · ');
  return complet && complet !== court ? { court, complet } : { court };
}

export function cleCompte(c: CompteBanque): string {
  return c.account_id?.iban ?? c.account_id?.other?.identification ?? c.name ?? c.uid;
}

export function versLignes(ops: Operation[], o: OptionsConversion = {}): ParsedRow[] {
  const out: ParsedRow[] = [];
  let ligne = 1;
  for (const op of ops) {
    if (op.status !== 'BOOK' && !(o.garderAttente && op.status === 'PDNG')) continue;
    const date = op.booking_date ?? op.transaction_date ?? op.value_date;
    if (!date) continue;
    const { court, complet } = libelle(op);
    const valeur = op.value_date && op.value_date !== date ? op.value_date : undefined;
    out.push({
      line: ligne++,
      date,
      ...(valeur ? { valueDate: valeur } : {}),
      label: court,
      ...(complet ? { fullLabel: complet } : {}),
      amount: montantCentimes(op),
      ...(o.compte ? { accountKey: o.compte } : {}),
      ...(op.entry_reference ? { externalRef: op.entry_reference } : {}),
    });
  }
  // Ordre chronologique, comme un relevé, pour que le rang des identiques du jour soit stable.
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.line - b.line));
  return out.map((r, i) => ({ ...r, line: i + 1 }));
}

const ENTETE = ['Date', 'Date de valeur', 'Compte', 'Libellé', 'Libellé complet', 'Montant', 'Référence'];

function cellule(s: string): string {
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function jjmmaaaa(iso: string): string {
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}

/** CSV UTF-8, séparateur `;`, dates JJ/MM/AAAA, montant `-76,00` : reconnu par `guessColumns`. */
export function versCsv(rows: ParsedRow[]): string {
  const lignes = [ENTETE.join(';')];
  for (const r of rows) {
    const montant = (r.amount / 100).toFixed(2).replace('.', ',');
    lignes.push(
      [jjmmaaaa(r.date), r.valueDate ? jjmmaaaa(r.valueDate) : '', r.accountKey ?? '', r.label, r.fullLabel ?? '', montant, r.externalRef ?? '']
        .map(cellule)
        .join(';'),
    );
  }
  return lignes.join('\r\n') + '\r\n';
}
