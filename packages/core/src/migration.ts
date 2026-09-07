/**
 * Migrations du modèle (D30) : amènent un dépôt écrit sous un modèle antérieur au modèle
 * courant. Chaque étape lit les colonnes dépréciées et écrit les nouvelles via `upsert`, donc
 * dans le journal de changements ; elle est idempotente et déterministe (mêmes identifiants sur
 * tous les appareils) pour que deux migrations indépendantes convergent à la fusion.
 */
import type { Envelope, Need, NeedKind, Periodicity, Rollover } from './model.js';
import { MODEL_VERSION } from './schema.js';
import type { LedgerStore } from './store.js';

export interface MigrationReport {
  from: number;
  to: number;
  /** Lignes écrites par étape. */
  steps: Array<{ version: number; written: number }>;
}

export function migrateModel(store: LedgerStore): MigrationReport {
  const from = store.modelVersion;
  const steps: MigrationReport['steps'] = [];
  if (from < 2) steps.push({ version: 2, written: migrateTo2(store) });
  if (from < MODEL_VERSION) store.setModelVersion(MODEL_VERSION);
  return { from, to: MODEL_VERSION, steps };
}

/** Identifiant déterministe du besoin issu d'une enveloppe typée (D28). */
export function migratedNeedId(envelopeId: string): string {
  return `need_${envelopeId}`;
}

/**
 * 1 → 2 (D19, D28) : `Envelope.accountId` devient `placementAccountId` ; `kind`, `target`,
 * `periodicity`, `monthlyAmount`, `priority` deviennent un besoin.
 */
function migrateTo2(store: LedgerStore): number {
  let written = 0;
  const existingNeeds = new Set(store.load().needs.map((n) => n.id));
  for (const raw of store.readRawTable('envelopes')) {
    const id = raw['id'] as string;
    const kind = raw['kind'] as 'provision' | 'goal' | 'budget' | undefined;
    const accountId = raw['accountId'] as string | undefined;
    if (!kind && !accountId) continue;
    const envelope: Envelope = {
      id,
      name: raw['name'] as string,
      placementAccountId: (raw['placementAccountId'] as string | undefined) ?? accountId ?? '',
      openingBalance: (raw['openingBalance'] as number | undefined) ?? 0,
      openingDate: raw['openingDate'] as string,
      ...(raw['rollover'] ? { rollover: raw['rollover'] as Rollover } : kind === 'budget' ? { rollover: { mode: 'none' } as Rollover } : {}),
      ...(raw['deletedAt'] ? { deletedAt: raw['deletedAt'] as string } : {}),
    };
    store.upsert('envelopes', envelope);
    written++;
    if (!kind) continue;
    const needId = migratedNeedId(id);
    if (existingNeeds.has(needId)) continue;
    const needKind: NeedKind = kind === 'provision' ? 'dueDate' : kind === 'budget' ? 'recurring' : 'goal';
    const target = raw['target'] as number | undefined;
    const periodicity = raw['periodicity'] as Periodicity | undefined;
    const need: Need = {
      id: needId,
      envelopeId: id,
      kind: needKind,
      priority: (raw['priority'] as number | undefined) ?? { dueDate: 10, recurring: 20, goal: 30 }[needKind],
      ...(target !== undefined ? { amount: target } : {}),
      ...(periodicity ? { periodicity } : {}),
      ...(kind === 'goal' && raw['monthlyAmount'] !== undefined ? { monthlyAmount: raw['monthlyAmount'] as number } : {}),
      ...(envelope.deletedAt ? { deletedAt: envelope.deletedAt } : {}),
    };
    store.upsert('needs', need);
    written++;
  }
  return written;
}
