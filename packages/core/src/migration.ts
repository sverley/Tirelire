/**
 * Migrations du modèle (D30) : amènent un dépôt écrit sous un modèle antérieur au modèle
 * courant. Chaque étape lit les colonnes dépréciées et écrit les nouvelles via `upsert`, donc
 * dans le journal de changements ; elle est idempotente et déterministe (mêmes identifiants sur
 * tous les appareils) pour que deux migrations indépendantes convergent à la fusion.
 */
import { DEFAULT_SETTINGS, type Account, type Allocation, type Automation, type Tirelire, type Need, type NeedKind, type Operation, type OperationState, type Periodicity, type Rollover } from './model.js';
import { MODEL_VERSION } from './schema.js';
import { rankBetween } from './automations.js';
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
  if (from < 4) steps.push({ version: 4, written: migrateTo4(store) });
  if (from < 5) steps.push({ version: 5, written: migrateTo5(store) });
  if (from < 6) steps.push({ version: 6, written: migrateTo6(store) });
  if (from < 7) steps.push({ version: 7, written: migrateTo7(store) });
  if (from < 8) steps.push({ version: 8, written: migrateTo8(store) });
  if (from < 9) steps.push({ version: 9, written: migrateTo9(store) });
  if (from < 10) steps.push({ version: 10, written: migrateTo10(store) });
  if (from < MODEL_VERSION) store.setModelVersion(MODEL_VERSION);
  return { from, to: MODEL_VERSION, steps };
}

/** Identifiant déterministe du besoin issu d'une tirelire typée (D28). */
export function migratedNeedId(tirelireId: string): string {
  return `need_${tirelireId}`;
}

/**
 * 1 → 2 (D19, D28) : `Tirelire.accountId` devient `placementAccountId` ; `kind`, `target`,
 * `periodicity`, `monthlyAmount`, `priority` deviennent un besoin.
 */
function migrateTo2(store: LedgerStore): number {
  let written = 0;
  const existingNeeds = new Set(store.load().needs.map((n) => n.id));
  for (const raw of store.readRawTable('tirelires')) {
    const id = raw['id'] as string;
    const kind = raw['kind'] as 'provision' | 'goal' | 'budget' | undefined;
    const accountId = raw['accountId'] as string | undefined;
    if (!kind && !accountId) continue;
    const tirelire: Tirelire = {
      id,
      name: raw['name'] as string,
      // D38 : le compte d'hébergement devient une répartition à une seule part, qui prend tout.
      placement: accountId ? [{ accountId, share: { kind: 'variable' as const } }] : [],
      openingBalance: (raw['openingBalance'] as number | undefined) ?? 0,
      openingDate: raw['openingDate'] as string,
      ...(raw['rollover'] ? { rollover: raw['rollover'] as Rollover } : kind === 'budget' ? { rollover: { mode: 'none' } as Rollover } : {}),
      ...(raw['deletedAt'] ? { deletedAt: raw['deletedAt'] as string } : {}),
    };
    store.upsert('tirelires', tirelire);
    written++;
    if (!kind) continue;
    const needId = migratedNeedId(id);
    if (existingNeeds.has(needId)) continue;
    const needKind: NeedKind = kind === 'provision' ? 'dueDate' : kind === 'budget' ? 'recurring' : 'goal';
    const target = raw['target'] as number | undefined;
    const periodicity = raw['periodicity'] as Periodicity | undefined;
    const need: Need = {
      id: needId,
      tirelireId: id,
      kind: needKind,
      priority: (raw['priority'] as number | undefined) ?? { dueDate: 10, recurring: 20, goal: 30 }[needKind],
      ...(target !== undefined ? { amount: target } : {}),
      ...(periodicity ? { periodicity } : {}),
      ...(kind === 'goal' && raw['monthlyAmount'] !== undefined ? { monthlyAmount: raw['monthlyAmount'] as number } : {}),
      ...(tirelire.deletedAt ? { deletedAt: tirelire.deletedAt } : {}),
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
 * Une opération qui portait une ventilation devient verrouillée (D34) : rien dans l'ancien modèle
 * ne la reproduisait, donc la laisser malléable reviendrait à la laisser effacer par le premier
 * passage du moteur de D23. Verrouiller de trop se défait par une action groupée ; effacer ne se
 * défait pas. Les autres gardent leur état de traitement. `oneOff` était un statut : il devient un
 * attribut, ce qui le rend compatible avec un état.
 */
function migrateTo3(store: LedgerStore): number {
  let written = 0;
  const classified = new Set(store.readRawTable('allocations').map((a) => a['operationId'] as string));
  for (const raw of store.readRawTable('operations')) {
    const status = raw['status'] as string | undefined;
    if (!status || raw['state']) continue;
    const state: OperationState = classified.has(raw['id'] as string) ? 'locked' : status === 'pending' ? 'untreated' : 'reconciled';
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

/**
 * 3 → 4 (D23, D31, D39) : une règle « motif → catégorie » devient un automatisme : sélection,
 * action et rang, dans la table `automations`.
 *
 * L'ancienne priorité était un entier croissant appliqué en premier ; le rang est une clé
 * triable appliquée en dernier, donc l'ordre s'inverse. Les anciennes règles ne touchaient que
 * les opérations non classées : leur action devient *Rapprocher*, jamais *Verrouiller* — elles
 * n'ont jamais eu valeur de vérité.
 */
function migrateTo4(store: LedgerStore): number {
  let written = 0;
  const rows = store.readRawTable('automations').filter((r) => r['pattern'] !== undefined && !r['selection']);
  // Priorité croissante = appliquée d'abord ; rang décroissant = appliqué en dernier.
  rows.sort((a, b) => ((a['priority'] as number) ?? 0) - ((b['priority'] as number) ?? 0));
  let rank = rankBetween(undefined, undefined);
  for (const raw of [...rows].reverse()) {
    const rule: Automation = {
      id: raw['id'] as string,
      selection: { labelPattern: raw['pattern'] as string },
      action: {
        ...(raw['categoryId'] ? { categoryId: raw['categoryId'] as string } : {}),
        ...(raw['tirelireId'] ? { tirelireId: raw['tirelireId'] as string } : {}),
        state: 'reconcile',
      },
      rank,
      ...(raw['deletedAt'] ? { deletedAt: raw['deletedAt'] as string } : {}),
    };
    store.upsert('automations', rule);
    written++;
    rank = rankBetween(rank, undefined);
  }
  return written;
}

/**
 * 4 → 5 (D39) : une règle devient un automatisme, et change de table. L'ancienne table reste
 * déclarée (D30) pour qu'un appareil non migré puisse continuer d'y écrire sans faire échouer la
 * fusion ; ses lignes sont recopiées ici, à l'identique.
 */
function migrateTo5(store: LedgerStore): number {
  let written = 0;
  const existing = new Set(store.readRawTable('automations').map((r) => r['id'] as string));
  for (const raw of store.readLegacyTable('rules')) {
    const id = raw['id'] as string;
    if (!raw['selection'] || existing.has(id)) continue;
    store.upsert('automations', raw as unknown as Automation);
    written++;
  }
  return written;
}

/**
 * 5 → 6 (D41) : le « compte pivot » s'appelle le compte principal. Seules deux valeurs stockées
 * portaient le mot — le genre du compte et la clé du coussin ; les noms de tables et de colonnes,
 * eux, sont conservés tels quels (voir `cAs` dans `schema.ts`).
 *
 * La lecture accepte de toute façon `pivot` comme synonyme (`fromRow`), pour qu'un
 * appareil resté en arrière n'annule pas la migration en réécrivant l'ancienne valeur.
 */
function migrateTo6(store: LedgerStore): number {
  let written = 0;
  for (const raw of store.readRawTable('accounts')) {
    if (raw['kind'] !== 'pivot') continue;
    store.upsert('accounts', { ...(raw as unknown as Account), kind: 'principal' });
    written++;
  }
  const cushion = store.readLegacySetting('pivotCushion');
  if (cushion !== undefined && store.readSettings().principalCushion === DEFAULT_SETTINGS.principalCushion) {
    store.setSetting('principalCushion', cushion as number);
    written++;
  }
  return written;
}

/**
 * 6 → 7 (D44) : le jour de paie quittait `Account.payDay`, où il n'avait rien à faire — un compte
 * vit avec ou sans paie. Il devient le réglage `periodStartDay` : le jour où commence la période
 * budgétaire, choisi par le foyer. La valeur du compte principal est reprise telle quelle pour que
 * les périodes ne se décalent pas ; la colonne reste déclarée et dépréciée (D30).
 */
function migrateTo7(store: LedgerStore): number {
  if (store.readSettings().periodStartDay !== DEFAULT_SETTINGS.periodStartDay) return 0;
  for (const raw of store.readRawTable('accounts')) {
    if (raw['kind'] !== 'principal' && raw['kind'] !== 'pivot') continue;
    const jour = raw['payDay'];
    if (typeof jour !== 'number' || jour < 1 || jour > 31) continue;
    store.setSetting('periodStartDay', jour);
    return 1;
  }
  return 0;
}

/**
 * 7 → 8 (D45) : le genre d'un compte ne dit plus comment ses opérations y entrent. `third`
 * — « compte tiers, saisi à la main » — mélangeait la nature du compte et le fait qu'on suive un
 * solde à régler avec lui. Il devient `courant` plus le drapeau `tracksSettlement`, qui porte seul
 * ce comportement ; `holding` devient `epargne`, qui dit la même chose plus clairement.
 */
function migrateTo8(store: LedgerStore): number {
  let written = 0;
  for (const raw of store.readRawTable('accounts')) {
    const kind = raw['kind'];
    if (kind !== 'third' && kind !== 'holding') continue;
    const compte = raw as unknown as Account;
    store.upsert('accounts', {
      ...compte,
      kind: kind === 'third' ? 'courant' : 'epargne',
      ...(kind === 'third' ? { tracksSettlement: true } : {}),
    });
    written++;
  }
  return written;
}

/**
 * 8 → 9 (D47) : un rythme ne se comptait qu'en mois, ce qui interdisait les revenus hebdomadaires
 * ou toutes les deux semaines. `intervalMonths` devient `interval` + `unit`. La forme d'origine
 * reste lue (`stepOf`) pour qu'un rythme écrit par un appareil non migré garde son sens.
 */
function migrateTo9(store: LedgerStore): number {
  let written = 0;
  for (const table of ['needs', 'plannedFlows'] as const) {
    for (const raw of store.readRawTable(table)) {
      const per = raw['periodicity'] as Periodicity | undefined;
      if (!per || per.interval !== undefined || per.intervalMonths === undefined) continue;
      const ligne = raw as unknown as { id: string };
      store.upsert(table, {
        ...(raw as object),
        periodicity: { interval: per.intervalMonths, unit: 'month', anchorDate: per.anchorDate },
      } as never);
      void ligne;
      written++;
    }
  }
  return written;
}

/**
 * 9 → 10 (D60) : un virement permanent portait sa ventilation figée (`plannedAllocation`), photo
 * du plan prise au moment de l'enregistrement. Elle cesse d'être stockée : la répartition se rejoue
 * par l'ordre de financement au jour de l'opération (D06). Les flux qui en portaient une sont
 * exactement ceux qu'a écrits l'écran Plan : ils deviennent des flux **dérivés** (D57), les autres
 * restent déclarés. La colonne reste déclarée et dépréciée (D30) : un pair non migré continue de
 * l'écrire sans que personne ne la lise.
 */
function migrateTo10(store: LedgerStore): number {
  let written = 0;
  for (const raw of store.readRawTable('plannedFlows')) {
    if (raw['kind'] !== 'transfer' || raw['origin']) continue;
    const ventilation = raw['plannedAllocation'];
    if (!Array.isArray(ventilation) || ventilation.length === 0) continue;
    store.upsert('plannedFlows', { ...(raw as object), origin: 'derived' } as never);
    written++;
  }
  return written;
}
