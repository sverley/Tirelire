import { describe, expect, it } from 'vitest';
import { alive, computePlan, dueDateFlowForNeed, euros, exampleLedger, needForDueDateFlow, type Ledger } from '../src/index.js';

/**
 * Garde de régression : le jeu d'exemple doit **démontrer** l'application, pas seulement s'installer.
 *
 * Il a déjà été livré sans le moindre besoin : neuf tirelires qui ne demandaient rien, un plan vide,
 * un total réservé à zéro, et un assistant sans propositions (les propositions n'ont pas d'autre
 * source que l'exemple, D43). Rien n'échouait pour autant — les tests d'alors portaient sur le
 * moteur, jamais sur ce que l'exemple en montre. Ce fichier fige donc le contrat de l'exemple :
 * après « Charger l'exemple », le plan de la période en cours se lit tout seul.
 *
 * Il ne double pas `plan.test.ts`, qui vérifie les chiffres un par un, ni `exemple-dates.test.ts`,
 * qui suit les changements datés de D51 : il vérifie les propriétés que l'exemple doit garder
 * quelles que soient les valeurs qu'on y retouchera.
 */

const asOf = '2026-09-06';
const l: Ledger = exampleLedger();

describe('le jeu d’exemple démontre l’application (garde)', () => {
  it('chaque tirelire porte au moins un besoin', () => {
    const porteurs = new Set(alive(l.needs).map((n) => n.tirelireId));
    const muettes = alive(l.tirelires).filter((t) => !porteurs.has(t.id));
    expect(muettes.map((t) => t.name)).toEqual([]);
  });

  it('le plan de la période en cours est rempli : des lignes, un total réservé non nul', () => {
    const plan = computePlan(l, asOf);
    expect(plan.lines.length).toBeGreaterThan(0);
    expect(plan.totals.requested).toBeGreaterThan(0);
    expect(plan.totals.funded).toBeGreaterThan(0);
  });

  it('les trois genres de besoin sont représentés, dont deux échéances', () => {
    const genres = alive(l.needs).map((n) => n.kind);
    expect(genres.filter((k) => k === 'dueDate').length).toBeGreaterThanOrEqual(2);
    expect(genres).toContain('recurring');
    expect(genres).toContain('goal');
  });

  it('les budgets de la vie courante sont dotés', () => {
    const plan = computePlan(l, asOf);
    for (const nom of ['Alimentation', 'Essence', 'Divers et sorties', 'Santé']) {
      const ligne = plan.lines.find((x) => x.tirelireName === nom);
      expect(ligne, `ligne « ${nom} » absente du plan`).toBeDefined();
      expect(ligne!.requested).toBeGreaterThan(0);
    }
  });

  it('la marge est positive mais pas confortable : l’ordre de financement de D06 se voit', () => {
    const { margin, requested } = computePlan(l, asOf).totals;
    expect(margin).toBeGreaterThan(0);
    // Une marge plus grosse que tout ce qui est demandé rendrait la priorité des besoins invisible.
    expect(margin).toBeLessThan(requested);
  });

  it('aucune tirelire n’est laissée en déficit sans rattrapage', () => {
    const octobre = computePlan(l, '2026-09-28');
    for (const ligne of octobre.lines.filter((x) => x.balance < 0)) {
      expect(ligne.requested, `« ${ligne.tirelireName} » en déficit sans dotation`).toBeGreaterThan(0);
    }
    // Enfants et loisirs : 200 dotés, 236 dépensés, report illimité → le trou est rattrapé.
    const enfants = octobre.lines.find((x) => x.needId === 'need-enfants')!;
    expect(enfants.balance).toBe(euros(-36));
    expect(enfants.requested).toBe(euros(236));
  });
});

describe('une échéance et sa provision se répondent', () => {
  it('tout flux d’échéance désigne une tirelire qui porte le besoin correspondant', () => {
    const echeances = alive(l.plannedFlows).filter((f) => f.kind === 'dueDate');
    expect(echeances.length).toBeGreaterThan(0);
    for (const f of echeances) {
      const besoin = needForDueDateFlow(f, l.needs, asOf);
      expect(besoin, `le flux « ${f.name} » n’est provisionné par aucun besoin`).toBeDefined();
      expect(besoin!.amount).toBe(Math.abs(f.amount));
    }
  });

  it('et le besoin retrouve son flux payeur', () => {
    const tf = alive(l.needs).find((n) => n.id === 'need-tf')!;
    expect(dueDateFlowForNeed(tf, l.plannedFlows, asOf)?.name).toBe('Taxe foncière (prélèvement)');
    // Un besoin qu'aucun flux ne paie le dit franchement, au lieu d'emprunter celui du voisin.
    const vacances = alive(l.needs).find((n) => n.id === 'need-vac')!;
    expect(dueDateFlowForNeed(vacances, l.plannedFlows, asOf)).toBeUndefined();
    // Un besoin récurrent n'a pas de flux payeur : la question ne se pose pas.
    const alim = alive(l.needs).find((n) => n.id === 'need-alim')!;
    expect(dueDateFlowForNeed(alim, l.plannedFlows, asOf)).toBeUndefined();
  });

  it('les deux lectures s’ignorent quand la tirelire n’est pas désignée', () => {
    const { tirelireId: _sansTirelire, ...orphelin } = alive(l.plannedFlows).find((f) => f.kind === 'dueDate')!;
    expect(needForDueDateFlow(orphelin, l.needs, asOf)).toBeUndefined();
  });
});
