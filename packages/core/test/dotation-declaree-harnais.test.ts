/**
 * Harnais d'audit de #477 — « Cœur : la dotation est ce qui est déclaré, quel que soit le solde ».
 * Composé après le codage (auditeur.md, étape 2), des tests du codeur, tous retenus.
 *
 * Niveaux (D83) :
 * - point 1, niveau 1 : une dotation qui suivrait le solde ferait changer le budget sans validation,
 *   ce que I10 interdit tel qu'il est écrit (D96, « l'hypothèse écartée ») ;
 * - points 2, 4 et 5, niveau 2 : la lecture du solde (« retenu », statuts, `payoutShort`) donnerait
 *   un résultat faux, l'usage restant possible (D29, D48) ;
 * - point 3, niveau 1 : l'ordre demandé, comme le harnais du registre qui le tient déjà
 *   (`flux-derives-besoin.test.ts`, I3 U2, I10) ; deux tests du même besoin ont le même niveau.
 *
 * Le point 6 (le plan de l'exemple) est tenu par les tests adaptés (`manque-lissage-harnais`,
 * `reprise-harnais`, et dans `apps/web/test`, `compte-principal-cas` et `stockage-domaine`) ; le
 * point 7, par les tests mesurés eux-mêmes ; le point 8 se vérifie à la relecture.
 */
import { describe, expect, it } from 'vitest';
import { computePlan, euros, exampleLedger, readAlerts, type Ledger, type Plan } from '../src/index.js';

const SEPTEMBRE = '2026-09-06';
const OCTOBRE = '2026-10-20';

function line(plan: Plan, needId: string) {
  const l = plan.lines.find((x) => x.needId === needId);
  if (!l) throw new Error(`ligne ${needId} absente`);
  return l;
}

/** L'exemple, les soldes d'ouverture de ses tirelires remplacés par `soldes`. */
function avecSoldes(soldes: Record<string, number>): Ledger {
  const l = exampleLedger();
  for (const t of l.tirelires) if (t.id in soldes) t.openingBalance = soldes[t.id]!;
  return l;
}

/** L'exemple, plus une tirelire de saison qui verse 1 200 € par an (100 € par période), ouverte avec `solde`. */
function avecSaison(solde: number): Ledger {
  const l = exampleLedger();
  l.tirelires.push({ id: 'env-saison', name: 'Saison', placement: [], openingBalance: solde, openingDate: '2026-08-28' });
  l.needs.push({ id: 'need-saison', tirelireId: 'env-saison', kind: 'payout', amount: euros(1200), periodicity: { interval: 12, unit: 'month', anchorDate: '2026-08-28' }, priority: 5 });
  return l;
}

const dotations = (p: Plan) => Object.fromEntries(p.lines.map((l) => [l.needId, l.requested]));

describe('[niveau 1] #477 · 1. la dotation est ce qui est déclaré, quel que soit le solde', () => {
  // Des soldes vides, en déficit, à la cible, au-delà : taxe foncière (cible 1 200 €), précaution
  // (objectif 6 000 €), Enfants et loisirs (récurrent avec report), et une saison qui verse.
  const variantes: Array<[string, Record<string, number>, number]> = [
    ['vides', { 'env-tf': 0, 'env-precaution': 0, 'env-enfants': 0, 'env-auto': 0 }, 0],
    ['en déficit', { 'env-tf': euros(-500), 'env-precaution': euros(-100), 'env-enfants': euros(-300), 'env-auto': euros(-50) }, euros(-200)],
    ['à leur cible', { 'env-tf': euros(1200), 'env-precaution': euros(6000), 'env-enfants': euros(200), 'env-auto': euros(600) }, euros(1200)],
    ['au-delà', { 'env-tf': euros(2000), 'env-precaution': euros(9000), 'env-enfants': euros(800), 'env-auto': euros(900) }, euros(5000)],
  ];

  for (const date of [SEPTEMBRE, OCTOBRE]) {
    it(`le ${date} : ligne par ligne, la même dotation, et le même total demandé`, () => {
      const plans = variantes.map(([nom, soldes, saison]) => {
        const l = avecSaison(saison);
        for (const t of l.tirelires) if (t.id in soldes) t.openingBalance = soldes[t.id]!;
        return { nom, p: computePlan(l, date) };
      });
      const [ref, ...autres] = plans;
      for (const { nom, p } of autres) {
        expect(dotations(p), `soldes ${nom}`).toEqual(dotations(ref!.p));
        expect(p.totals.requested, `soldes ${nom}`).toBe(ref!.p.totals.requested);
      }
      // Ce qui est déclaré : la croisière, plus la part d'un lissage décidé ; pour un versement, sa part.
      for (const l of ref!.p.lines) expect(l.requested, l.needId).toBe(l.kind === 'payout' ? -l.cruise : l.cruise + l.smoothing);
    });
  }

  it('une échéance pleine demande sa croisière ; un objectif atteint, sa mensualité ; un versement sans réserve, sa part', () => {
    const p = computePlan(avecSaison(0), SEPTEMBRE);
    const plein = computePlan(
      (() => {
        const l = avecSaison(0);
        for (const t of l.tirelires) if (t.id === 'env-auto') t.openingBalance = euros(600);
        for (const t of l.tirelires) if (t.id === 'env-precaution') t.openingBalance = euros(6000);
        return l;
      })(),
      SEPTEMBRE,
    );
    expect(line(plein, 'need-auto').requested).toBe(euros(50));
    expect(line(plein, 'need-precaution').requested).toBe(euros(300));
    expect(line(p, 'need-saison').requested).toBe(euros(-100));
  });
});

describe('[niveau 2] #477 · 2. un déficit ne se rattrape plus de lui-même', () => {
  it('Enfants et loisirs, 36 € de déficit fin septembre : octobre demande sa croisière, le « retenu » est de −36 €', () => {
    const oct = line(computePlan(exampleLedger(), OCTOBRE), 'need-enfants');
    expect([oct.balance, oct.held, oct.requested, oct.status]).toEqual([euros(-36), euros(-36), euros(200), 'ok']);
  });

  it('le déficit reste dans le solde prévu de la tirelire : lu le 6 septembre, octobre part de −36 € et finit à 164 €', () => {
    const p = computePlan(exampleLedger(), '2026-10-01', SEPTEMBRE);
    const t = p.forecast!.tirelires.find((x) => x.id === 'env-enfants')!;
    expect([t.start, t.end]).toEqual([euros(-36), euros(164)]);
    expect(t.movements.filter((m) => m.origin === 'dotation').map((m) => m.amount)).toEqual([euros(200)]);
  });

  it('il reste dans le solde de période en période, sans dépense ni revenu ventilé, pour une tirelire qui reporte', () => {
    // Un déficit de 300 € à l'ouverture, reporté sans limite : chaque période ajoute sa croisière, et rien d'autre.
    const l = avecSoldes({ 'env-enfants': euros(-300) });
    l.operations = l.operations.filter((o) => !o.id.startsWith('op-enfants'));
    l.subOperations = l.subOperations.filter((a) => a.tirelireId !== 'env-enfants');
    const sept = line(computePlan(l, SEPTEMBRE), 'need-enfants');
    const oct = line(computePlan(l, OCTOBRE), 'need-enfants');
    expect([sept.balance, sept.held, sept.requested]).toEqual([euros(-300), euros(-300), euros(200)]);
    expect([oct.balance, oct.held, oct.requested]).toEqual([euros(-100), euros(-100), euros(200)]);
  });

  it('il pèse sur le premier besoin récurrent si la tirelire reporte, sinon sur le premier besoin', () => {
    // Enfants porte deux récurrents à partir de novembre (Enfants, puis le piano) : le premier porte le déficit.
    const l = avecSoldes({ 'env-enfants': euros(-500) });
    l.operations = l.operations.filter((o) => !o.id.startsWith('op-enfants'));
    l.subOperations = l.subOperations.filter((a) => a.tirelireId !== 'env-enfants');
    const nov = computePlan(l, '2026-11-05');
    // −500 + 200 en septembre + 200 en octobre : 100 € de déficit en novembre, sur une seule ligne,
    // la première récurrente de la tirelire ; l'autre retient zéro.
    const siennes = nov.lines.filter((x) => x.tirelireId === 'env-enfants');
    expect(siennes.map((x) => x.kind)).toEqual(['recurring', 'recurring']);
    expect(siennes.map((x) => x.held).sort((x, y) => x - y)).toEqual([euros(-100), 0]);
    expect(siennes.map((x) => x.requested).sort((x, y) => x - y)).toEqual([euros(45), euros(200)]);
    // La taxe foncière, une échéance seule dans sa tirelire : le déficit pèse sur elle.
    const tf = line(computePlan(avecSoldes({ 'env-tf': euros(-400) }), SEPTEMBRE), 'need-tf');
    expect(tf.held).toBe(euros(-400));
    expect(tf.requested).toBe(euros(150));
  });

  it('la libération de fin de période remet à zéro le déficit d’une tirelire sans report (D29), et la dotation n’en dépend pas', () => {
    // Santé, sans report : 80 € de déficit à l'ouverture ; la période suivante repart de zéro.
    const l = avecSoldes({ 'env-sante': euros(-80) });
    const sept = line(computePlan(l, SEPTEMBRE), 'need-sante');
    const oct = line(computePlan(l, OCTOBRE), 'need-sante');
    expect([sept.held, sept.requested]).toEqual([euros(-80), euros(100)]);
    expect([oct.balance, oct.requested]).toEqual([0, euros(100)]);
  });
});

describe('[niveau 1] #477 · 3. l’ordre permanent demandé compte l’objectif atteint', () => {
  const permanent = (l: Ledger) => computePlan(l, SEPTEMBRE).transfers.find((t) => t.accountId === 'acc-livret')!.permanent;

  it('l’épargne de précaution pleine, à 6 000 € ou au-delà, reste dans l’ordre vers le Livret A', () => {
    const base = permanent(exampleLedger());
    expect(permanent(avecSoldes({ 'env-precaution': euros(6000) }))).toBe(base);
    expect(permanent(avecSoldes({ 'env-precaution': euros(9000) }))).toBe(base);
    expect(computePlan(avecSoldes({ 'env-precaution': euros(6000) }), SEPTEMBRE).transfers.find((t) => t.accountId === 'acc-livret')!.breakdown.find((b) => b.tirelireId === 'env-precaution')?.cruise).toBe(euros(300));
  });

  it('une échéance déjà provisionnée y reste, un versement n’y entre pas', () => {
    const base = permanent(exampleLedger());
    expect(permanent(avecSoldes({ 'env-tf': euros(1200), 'env-auto': euros(600) }))).toBe(base);
    const l = exampleLedger();
    l.needs.push({ id: 'need-versant', tirelireId: 'env-vac', kind: 'payout', amount: euros(1200), periodicity: { interval: 12, unit: 'month', anchorDate: '2026-08-28' }, priority: 50 });
    expect(permanent(l)).toBe(base);
  });
});

describe('[niveau 2] #477 · 4. le statut d’une ligne', () => {
  it('« en avance » : une échéance ou un objectif dont la part retenue atteint la cible ; la ligne demande sa croisière', () => {
    const p = computePlan(avecSoldes({ 'env-auto': euros(600), 'env-precaution': euros(6000) }), SEPTEMBRE);
    expect([line(p, 'need-auto').status, line(p, 'need-auto').requested]).toEqual(['ahead', euros(50)]);
    expect([line(p, 'need-precaution').status, line(p, 'need-precaution').requested]).toEqual(['ahead', euros(300)]);
    // Sous la cible, la même ligne est en croisière.
    const q = computePlan(exampleLedger(), SEPTEMBRE);
    expect(line(q, 'need-auto').status).toBe('ok');
    expect(line(q, 'need-precaution').status).toBe('ok');
  });

  it('« rattrapage » seulement quand la période porte la part d’un lissage décidé', () => {
    const p = computePlan(exampleLedger(), SEPTEMBRE);
    for (const l of p.lines) expect(l.status === 'catchUp', l.needId).toBe(l.smoothing !== 0);
    expect(line(p, 'need-tf').status).toBe('catchUp');
    // Octobre porte encore la seconde part (28 septembre) ; janvier n'en porte aucune, et aucun déficit n'en donne.
    expect(computePlan(exampleLedger(), OCTOBRE).lines.filter((l) => l.status === 'catchUp').map((l) => l.needId)).toEqual(['need-tf']);
    expect(computePlan(exampleLedger(), '2027-01-10').lines.filter((l) => l.status === 'catchUp').map((l) => l.needId)).toEqual([]);
  });

  it('« non financé » et « réduit » passent avant « en avance » et « rattrapage »', () => {
    const l = avecSoldes({ 'env-auto': euros(600) });
    l.plannedFlows = l.plannedFlows.filter((f) => f.kind !== 'income');
    const p = computePlan(l, SEPTEMBRE);
    expect(line(p, 'need-auto').status).toBe('unfunded');
    expect(line(p, 'need-tf').status).toBe('unfunded');
    // Assez pour couvrir une partie de la taxe foncière, priorité 10, et rien d'autre.
    const m = avecSoldes({ 'env-auto': euros(600) });
    for (const f of m.plannedFlows) if (f.kind === 'income') f.amount = 0;
    m.plannedFlows.find((f) => f.kind === 'income')!.amount = euros(1220 + 100);
    const q = computePlan(m, SEPTEMBRE);
    expect(line(q, 'need-tf').status).toBe('reduced');
  });

  it('un versement n’est plus « réduit » parce que sa réserve s’épuise', () => {
    for (const solde of [0, euros(50), euros(-200), euros(5000)]) expect(line(computePlan(avecSaison(solde), SEPTEMBRE), 'need-saison').status, `réserve de ${solde}`).toBe('ok');
  });
});

describe('[niveau 2] #477 · 5. `payoutShort` dit que la réserve ne porte plus la part déclarée', () => {
  const codes = (l: Ledger) => computePlan(l, SEPTEMBRE).warnings.filter((w) => w.code === 'payoutShort').map((w) => w.needId);

  it('il vient quand la part retenue au début de la période est inférieure à la part déclarée, et seulement alors', () => {
    expect(codes(avecSaison(euros(99)))).toEqual(['need-saison']);
    expect(codes(avecSaison(0))).toEqual(['need-saison']);
    expect(codes(avecSaison(euros(-10)))).toEqual(['need-saison']);
    expect(codes(avecSaison(euros(100)))).toEqual([]);
    expect(codes(avecSaison(euros(5000)))).toEqual([]);
  });

  it('son message dit que la réserve ne porte plus la part, et ne dit plus qu’il « ne verse plus le montant prévu »', () => {
    const w = computePlan(avecSaison(euros(50)), SEPTEMBRE).warnings.find((x) => x.code === 'payoutShort')!;
    expect(w.message).toBe('La réserve de « Saison » ne porte plus sa part déclarée.');
    expect(w.message).not.toContain('ne verse plus');
  });

  it('`readAlerts` le rend avec ce que la réserve retient et la part déclarée, à part du message', () => {
    const [a] = readAlerts(avecSaison(euros(30)), { today: SEPTEMBRE }, ['payoutShort']);
    expect(a && a.code === 'payoutShort' && [a.held, a.cruise]).toEqual([euros(30), euros(100)]);
    expect(a).not.toHaveProperty('paid');
  });
});
