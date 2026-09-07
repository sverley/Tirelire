/**
 * Migrations du modèle (D30) : amènent un dépôt écrit sous un modèle antérieur au modèle
 * courant. Chaque étape lit les colonnes dépréciées et écrit les nouvelles via `upsert`, donc
 * dans le journal de changements ; elle est idempotente et déterministe (mêmes identifiants sur
 * tous les appareils) pour que deux migrations indépendantes convergent à la fusion.
 */
import type { Allocation, Envelope, Need, NeedKind, Operation, OperationState, Periodicity, Rollover } from './model.js';
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
  if (from < 3) steps.push({ version: 3, written: migrateTo3(store) });
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

/**
 * 2 → 3 (D22, D27) : `Operation.status` devient un état parmi trois, `Allocation.amount` devient
 * une part fixe.
 *
 * L'ancien modèle ne distingue pas ce que l'utilisateur a classé à la main de ce qu'une règle a
 * posé : tout ce qui était traité devient donc `reconciled`, malléable, et jamais `locked` —
 * verrouiller d'office prétendrait à une vérité que l'ancien modèle ne portait pas. Ce qui doit
 * l'être se verrouille ensuite par action groupée (D26). `oneOff` était un statut : il devient un
 * attribut, ce qui le rend compatible avec un état.
 */
function migrateTo3(store: LedgerStore): number {
  let written = 0;
  for (const raw of store.readRawTable('operations')) {
    const status = raw['status'] as string | undefined;
    if (!status || raw['state']) continue;
    const state: OperationState = status === 'pending' ? 'untreated' : 'reconciled';
    const op = { ...(raw as unknown as Operation), state };
    if (status === 'oneOff') op.oneOff = true;
    delete (op as Record<string, unknown>)['status'];
    store.upsert('operations', op);
    written++;
  }
  for (const raw of store.readRawTable('allocations')) {
    const amount = raw['amount'] as number | undefined;
    if (amount === undefined || raw['share']) continue;
    const al = { ...(raw as unknown as Allocation), share: { kind: 'fixed' as const, amount } };
    delete (al as Record<string, unknown>)['amount'];
    store.upsert('allocations', al);
    written++;
  }
  return written;
}
