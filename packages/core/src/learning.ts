/**
 * Classification apprenante des opérations (prototype de l'étude
 * `docs/apprentissage-classification.md`).
 *
 * Trois étages, du plus sûr au plus incertain :
 *
 *  1. **Recherche → sélection → classement** : une requête structurée (`Query`)
 *     filtre les opérations ; la ventilation choisie s'applique à toute la
 *     sélection (`classifySelection`) et la requête peut devenir une règle.
 *     Déterministe, écrit directement.
 *  2. **Mémoire des libellés** : une opération dont le libellé normalisé a déjà
 *     été ventilé reçoit la même ventilation (`recallByLabel`). Déterministe,
 *     proposé avec une confiance de 1.
 *  3. **Bayes naïf** sur les jetons du libellé, le signe, l'ordre de grandeur du
 *     montant, le compte et la catégorie suggérée par la source
 *     (`trainClassifier`, `classify`). Jamais écrit sans confirmation.
 *
 * Le modèle n'est jamais stocké : il se reconstruit à partir des ventilations
 * confirmées (« ce qui se recalcule ne se stocke pas »).
 *
 * Une ventilation apprise est un **gabarit** : des lignes (catégorie,
 * enveloppe, part) où la part est une fraction du montant de l'opération.
 * Une opération simple donne un gabarit à une ligne de part 1.
 */
import type { Allocation, Cents, Id, Ledger, Operation } from './model.js';
import { alive } from './model.js';
import { uuidv7 } from './ids.js';
import type { Patch } from './matching.js';
import { emptyPatch } from './matching.js';

// ---------------------------------------------------------------------------
// Gabarits de ventilation
// ---------------------------------------------------------------------------

export interface TemplateLine {
  categoryId?: Id;
  envelopeId?: Id;
  /** Part du montant de l'opération, entre 0 et 1 ; la somme des parts vaut 1. */
  share: number;
}

/** Gabarit d'une ventilation, indépendant du montant. */
export type Template = TemplateLine[];

/** Précision des parts dans la clé d'un gabarit (millièmes). */
const SHARE_PRECISION = 1000;

/** Gabarit d'une ventilation existante ; `undefined` si elle est vide ou incohérente. */
export function templateOf(op: Operation, allocations: Allocation[]): Template | undefined {
  if (op.amount === 0 || allocations.length === 0) return undefined;
  const lines: TemplateLine[] = allocations.map((a) => ({
    ...(a.categoryId ? { categoryId: a.categoryId } : {}),
    ...(a.envelopeId ? { envelopeId: a.envelopeId } : {}),
    share: Math.round((a.amount / op.amount) * SHARE_PRECISION) / SHARE_PRECISION,
  }));
  const total = lines.reduce((s, l) => s + l.share, 0);
  if (Math.abs(total - 1) > 2 / SHARE_PRECISION) return undefined;
  return lines.sort((a, b) => templateLineKey(a).localeCompare(templateLineKey(b)));
}

function templateLineKey(l: TemplateLine): string {
  return `${l.categoryId ?? ''}|${l.envelopeId ?? ''}|${l.share}`;
}

/** Clé textuelle d'un gabarit : identifie une classe pour l'apprentissage. */
export function templateKey(t: Template): string {
  return t.map(templateLineKey).join('+');
}

export function parseTemplateKey(key: string): Template {
  return key.split('+').map((part) => {
    const [categoryId, envelopeId, share] = part.split('|');
    return {
      ...(categoryId ? { categoryId } : {}),
      ...(envelopeId ? { envelopeId } : {}),
      share: Number(share),
    };
  });
}

/**
 * Applique un gabarit à une opération : des lignes de ventilation dont les
 * montants sont proportionnels au montant de l'opération, la dernière ligne
 * absorbant l'arrondi pour que la somme soit exacte.
 */
export function applyTemplate(op: Operation, template: Template): Allocation[] {
  const out: Allocation[] = [];
  let remaining = op.amount;
  template.forEach((line, i) => {
    const amount = i === template.length - 1 ? remaining : Math.round(op.amount * line.share);
    remaining -= amount;
    out.push({
      id: uuidv7(),
      operationId: op.id,
      amount,
      ...(line.categoryId ? { categoryId: line.categoryId } : {}),
      ...(line.envelopeId ? { envelopeId: line.envelopeId } : {}),
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Étage 1 : recherche structurée et classement en lot
// ---------------------------------------------------------------------------

/**
 * Requête de recherche. Tous les critères présents doivent être satisfaits.
 * Les termes se cherchent dans le libellé normalisé et les détails, sans
 * accent ni casse ; les montants sont en valeur absolue.
 */
export interface Query {
  /** Tous ces termes doivent apparaître. Un terme avec espace est une expression exacte. */
  terms?: string[];
  /** Aucun de ces termes ne doit apparaître. */
  excluded?: string[];
  sign?: 'debit' | 'credit';
  /** Bornes sur |montant|, incluses. */
  minAmount?: Cents;
  maxAmount?: Cents;
  accountId?: Id;
  from?: string;
  to?: string;
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/**
 * Analyse la syntaxe de la barre de recherche :
 * `carrefour market -drive >20 <150 +` → termes, exclusion, bornes en euros, signe.
 * `"vir sepa"` garde l'expression entière ; `+` = crédits, `-` = débits.
 */
export function parseQuery(text: string): Query {
  const q: Query = {};
  const tokens = text.match(/"[^"]*"|\S+/g) ?? [];
  for (const raw of tokens) {
    let t = raw;
    if (t === '+') {
      q.sign = 'credit';
      continue;
    }
    if (t === '-') {
      q.sign = 'debit';
      continue;
    }
    let m = /^([<>])(\d+(?:[.,]\d{1,2})?)$/.exec(t);
    if (m) {
      const cents = Math.round(Number(m[2]!.replace(',', '.')) * 100);
      if (m[1] === '>') q.minAmount = cents;
      else q.maxAmount = cents;
      continue;
    }
    let excluded = false;
    if (t.startsWith('-') && t.length > 1) {
      excluded = true;
      t = t.slice(1);
    }
    t = t.replace(/^"|"$/g, '').trim();
    if (!t) continue;
    if (excluded) (q.excluded ??= []).push(t);
    else (q.terms ??= []).push(t);
  }
  return q;
}

export function queryMatches(q: Query, op: Operation): boolean {
  const haystack = fold(`${op.normalizedLabel} ${op.label} ${op.details ?? ''}`);
  for (const t of q.terms ?? []) if (!haystack.includes(fold(t))) return false;
  for (const t of q.excluded ?? []) if (haystack.includes(fold(t))) return false;
  if (q.sign === 'debit' && op.amount >= 0) return false;
  if (q.sign === 'credit' && op.amount <= 0) return false;
  const abs = Math.abs(op.amount);
  if (q.minAmount !== undefined && abs < q.minAmount) return false;
  if (q.maxAmount !== undefined && abs > q.maxAmount) return false;
  if (q.accountId && op.accountId !== q.accountId) return false;
  if (q.from && op.date < q.from) return false;
  if (q.to && op.date > q.to) return false;
  return true;
}

export function searchOperations(ledger: Ledger, q: Query): Operation[] {
  return alive(ledger.operations).filter((op) => queryMatches(q, op));
}

/**
 * Applique un gabarit à une sélection d'opérations : remplace les ventilations
 * existantes (marquées supprimées) et passe les opérations en `categorized`.
 * Les virements internes appariés ne sont pas touchés.
 */
export function classifySelection(ledger: Ledger, ops: Operation[], template: Template, now = new Date().toISOString()): Patch {
  const patch = emptyPatch();
  const byOp = new Map<Id, Allocation[]>();
  for (const a of alive(ledger.allocations)) {
    const list = byOp.get(a.operationId) ?? [];
    list.push(a);
    byOp.set(a.operationId, list);
  }
  for (const op of ops) {
    if (op.deletedAt || op.status === 'transfer' || op.transferAccountId) continue;
    for (const old of byOp.get(op.id) ?? []) patch.allocations.push({ ...old, deletedAt: now });
    patch.allocations.push(...applyTemplate(op, template));
    if (op.status === 'pending') patch.operations.push({ ...op, status: 'categorized' });
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Étage 2 : mémoire des libellés
// ---------------------------------------------------------------------------

/** Opérations ventilées qui servent d'exemples : hors virements internes, hors ponctuel ambigu. */
function examples(ledger: Ledger): { op: Operation; template: Template }[] {
  const byOp = new Map<Id, Allocation[]>();
  for (const a of alive(ledger.allocations)) {
    const list = byOp.get(a.operationId) ?? [];
    list.push(a);
    byOp.set(a.operationId, list);
  }
  const out: { op: Operation; template: Template }[] = [];
  for (const op of alive(ledger.operations)) {
    if (op.status === 'pending' || op.status === 'transfer' || op.transferAccountId) continue;
    const t = templateOf(op, byOp.get(op.id) ?? []);
    if (t) out.push({ op, template: t });
  }
  return out;
}

/**
 * Le gabarit le plus fréquent parmi les opérations passées de même libellé
 * normalisé et de même signe ; la plus récente départage.
 */
export function recallByLabel(ledger: Ledger, op: Operation): Template | undefined {
  const votes = new Map<string, { count: number; last: string }>();
  for (const ex of examples(ledger)) {
    if (ex.op.id === op.id || ex.op.normalizedLabel !== op.normalizedLabel) continue;
    if (Math.sign(ex.op.amount) !== Math.sign(op.amount)) continue;
    const key = templateKey(ex.template);
    const v = votes.get(key) ?? { count: 0, last: '' };
    v.count++;
    if (ex.op.date > v.last) v.last = ex.op.date;
    votes.set(key, v);
  }
  let best: string | undefined;
  let bestVote: { count: number; last: string } | undefined;
  for (const [key, v] of votes) {
    if (!bestVote || v.count > bestVote.count || (v.count === bestVote.count && v.last > bestVote.last)) {
      best = key;
      bestVote = v;
    }
  }
  return best ? parseTemplateKey(best) : undefined;
}

// ---------------------------------------------------------------------------
// Étage 3 : Bayes naïf
// ---------------------------------------------------------------------------

/** Mots du libellé qui ne disent rien du marchand. */
const STOP_WORDS = new Set(['CARTE', 'CB', 'PRELEVEMENT', 'PRLV', 'EUROPEEN', 'VIR', 'VIREMENT', 'RECU', 'EMIS', 'PERM', 'INST', 'SEPA', 'DE', 'DU', 'LA', 'LE', 'LES', 'PAR', 'POUR', 'FACTURE', 'PAIEMENT', 'ACHAT', 'FR', 'EUR']);

/**
 * Ordre de grandeur d'un montant : puissance de dix des euros (0 : moins de
 * 10 €, 1 : dizaines, 2 : centaines…). Plus fin, le montant brouille plus qu'il
 * n'aide sur peu d'exemples : un même marchand va de 20 à 150 €.
 */
function amountBucket(amount: Cents): string {
  const euros = Math.abs(amount) / 100;
  return `montant:${euros < 1 ? 0 : Math.floor(Math.log10(euros))}`;
}

/**
 * Jetons d'une opération : mots significatifs du libellé, bigrammes voisins,
 * signe, tranche de montant, compte, catégorie suggérée par la source.
 * Les mots viennent du libellé normalisé (sans numéros de carte ni dates).
 */
export function featuresOf(op: Operation): string[] {
  const words = op.normalizedLabel.split(' ').filter((w) => w.length > 1 && !/^\d+$/.test(w) && !STOP_WORDS.has(w));
  const feats = new Set<string>();
  for (const w of words) feats.add(`mot:${w}`);
  for (let i = 0; i + 1 < words.length; i++) feats.add(`bi:${words[i]} ${words[i + 1]}`);
  feats.add(op.amount < 0 ? 'signe:debit' : 'signe:credit');
  feats.add(amountBucket(op.amount));
  feats.add(`compte:${op.accountId}`);
  if (op.suggestedCategory) feats.add(`source:${fold(op.suggestedCategory)}`);
  return [...feats];
}

export interface Classifier {
  /** Nombre d'exemples par classe (clé de gabarit). */
  classCount: Map<string, number>;
  /** Par classe, nombre d'exemples portant chaque jeton. */
  featureCount: Map<string, Map<string, number>>;
  vocabulary: Set<string>;
  total: number;
}

export function trainClassifier(ledger: Ledger, exclude?: Id): Classifier {
  const m: Classifier = { classCount: new Map(), featureCount: new Map(), vocabulary: new Set(), total: 0 };
  for (const ex of examples(ledger)) {
    if (ex.op.id === exclude) continue;
    const key = templateKey(ex.template);
    m.classCount.set(key, (m.classCount.get(key) ?? 0) + 1);
    m.total++;
    const fc = m.featureCount.get(key) ?? new Map<string, number>();
    m.featureCount.set(key, fc);
    for (const f of featuresOf(ex.op)) {
      fc.set(f, (fc.get(f) ?? 0) + 1);
      m.vocabulary.add(f);
    }
  }
  return m;
}

export interface Prediction {
  key: string;
  template: Template;
  /** Probabilité a posteriori, normalisée sur les classes connues. */
  probability: number;
  /** Nombre d'exemples de la classe. */
  support: number;
}

/**
 * Bayes naïf de Bernoulli avec lissage de Laplace : pour chaque classe, produit
 * de P(jeton | classe) sur les jetons présents. Les jetons absents ne pèsent
 * pas (les libellés sont courts : leur absence dit peu). Rend les classes par
 * probabilité décroissante.
 */
export function classify(model: Classifier, op: Operation, alpha = 0.5): Prediction[] {
  if (model.total === 0) return [];
  const feats = featuresOf(op).filter((f) => model.vocabulary.has(f));
  const scores: { key: string; logp: number }[] = [];
  for (const [key, n] of model.classCount) {
    const fc = model.featureCount.get(key)!;
    let logp = Math.log(n / model.total);
    for (const f of feats) logp += Math.log(((fc.get(f) ?? 0) + alpha) / (n + 2 * alpha));
    scores.push({ key, logp });
  }
  const max = Math.max(...scores.map((s) => s.logp));
  const weights = scores.map((s) => ({ key: s.key, w: Math.exp(s.logp - max) }));
  const sum = weights.reduce((s, x) => s + x.w, 0);
  return weights
    .map((x) => ({ key: x.key, template: parseTemplateKey(x.key), probability: x.w / sum, support: model.classCount.get(x.key)! }))
    .sort((a, b) => b.probability - a.probability);
}

// ---------------------------------------------------------------------------
// Proposition combinée et évaluation
// ---------------------------------------------------------------------------

export type SuggestionSource = 'memoire' | 'bayes';

export interface Suggestion {
  operationId: Id;
  source: SuggestionSource;
  template: Template;
  allocations: Allocation[];
  /** 1 pour la mémoire ; probabilité a posteriori pour Bayes. */
  confidence: number;
  /** Bayes : écart avec la deuxième classe. */
  margin?: number;
}

export interface SuggestOptions {
  /** Confiance minimale pour proposer une prédiction Bayes. */
  minConfidence?: number;
  /** Écart minimal avec la deuxième classe. */
  minMargin?: number;
  /** Exemples minimaux dans la classe proposée. */
  minSupport?: number;
}

const DEFAULT_SUGGEST: Required<SuggestOptions> = { minConfidence: 0.8, minMargin: 0.5, minSupport: 2 };

/** Propose une ventilation pour une opération : mémoire d'abord, Bayes ensuite. */
export function suggestAllocation(ledger: Ledger, model: Classifier, op: Operation, options: SuggestOptions = {}): Suggestion | undefined {
  const o = { ...DEFAULT_SUGGEST, ...options };
  const recalled = recallByLabel(ledger, op);
  if (recalled) return { operationId: op.id, source: 'memoire', template: recalled, allocations: applyTemplate(op, recalled), confidence: 1 };
  const [best, second] = classify(model, op);
  if (!best) return undefined;
  const margin = best.probability - (second?.probability ?? 0);
  if (best.probability < o.minConfidence || margin < o.minMargin || best.support < o.minSupport) return undefined;
  return { operationId: op.id, source: 'bayes', template: best.template, allocations: applyTemplate(op, best.template), confidence: best.probability, margin };
}

/** Propositions pour toutes les opérations en attente non ventilées. */
export function suggestPending(ledger: Ledger, options: SuggestOptions = {}): Suggestion[] {
  const model = trainClassifier(ledger);
  const allocated = new Set(alive(ledger.allocations).map((a) => a.operationId));
  const out: Suggestion[] = [];
  for (const op of alive(ledger.operations)) {
    if (op.status !== 'pending' || allocated.has(op.id) || op.transferAccountId) continue;
    const s = suggestAllocation(ledger, model, op, options);
    if (s) out.push(s);
  }
  return out;
}

export interface Evaluation {
  /** Exemples testés (chacun retiré du modèle avant d'être prédit). */
  examples: number;
  /** Retrouvés par la mémoire des libellés. */
  recalled: number;
  recalledCorrect: number;
  /** Proposés par Bayes (au-dessus des seuils). */
  proposed: number;
  proposedCorrect: number;
  /** Ni mémoire ni Bayes : restent à trier à la main. */
  silent: number;
}

/**
 * Validation « un contre tous » sur le grand livre lui-même : chaque exemple
 * est prédit sans lui-même. Mesure ce que l'apprentissage aurait épargné à
 * l'utilisateur, et surtout combien de propositions auraient été fausses.
 */
export function evaluate(ledger: Ledger, options: SuggestOptions = {}): Evaluation {
  const ev: Evaluation = { examples: 0, recalled: 0, recalledCorrect: 0, proposed: 0, proposedCorrect: 0, silent: 0 };
  for (const ex of examples(ledger)) {
    ev.examples++;
    const truth = templateKey(ex.template);
    const model = trainClassifier(ledger, ex.op.id);
    const s = suggestAllocation(ledger, model, ex.op, options);
    if (!s) {
      ev.silent++;
      continue;
    }
    const ok = templateKey(s.template) === truth;
    if (s.source === 'memoire') {
      ev.recalled++;
      if (ok) ev.recalledCorrect++;
    } else {
      ev.proposed++;
      if (ok) ev.proposedCorrect++;
    }
  }
  return ev;
}
