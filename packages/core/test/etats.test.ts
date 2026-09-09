import { describe, expect, it } from 'vitest';
import { countStates, emptyLedger, matchesState, validityState, type Ledger, type StateFilter } from '../src/model.js';
import { euros } from '../src/money.js';
import { indexLedger, tirelireBalance, tirelireValidityState } from '../src/balances.js';
import { exampleLedger } from '../src/example.js';
import { computePlan } from '../src/plan.js';

/**
 * D55 : l'état d'une ligne datée, et le filtre qui s'en sert. `activeAt` répondait par oui ou non,
 * ce qui confond ce qui est fini et ce qui n'a pas commencé.
 */
describe('état d’une ligne datée', () => {
  it('distingue ce qui est clos, en vigueur et à venir, bornes incluses', () => {
    const ligne = { activeFrom: '2026-03-01', activeTo: '2026-08-31' };
    expect(validityState(ligne, '2026-02-28')).toBe('upcoming');
    expect(validityState(ligne, '2026-03-01')).toBe('active');
    expect(validityState(ligne, '2026-08-31')).toBe('active');
    expect(validityState(ligne, '2026-09-01')).toBe('closed');
  });

  it('sans dates, une ligne est toujours en vigueur', () => {
    expect(validityState({}, '2026-09-06')).toBe('active');
  });

  it('le filtre « tout » laisse tout passer, les autres ne gardent que leur état', () => {
    expect(matchesState('all', 'closed')).toBe(true);
    expect(matchesState('closed', 'closed')).toBe(true);
    expect(matchesState('closed', 'active')).toBe(false);
  });

  it('les comptes du filtre disent ce que chaque choix laisserait voir', () => {
    const lignes = [{ activeTo: '2026-01-01' }, {}, {}, { activeFrom: '2027-01-01' }];
    const comptes = countStates(lignes, (l) => validityState(l, '2026-09-06'));
    expect(comptes).toEqual({ all: 4, active: 2, upcoming: 1, closed: 1 });
  });
});

/** Une tirelire ne porte pas de dates : son état se lit sur ses besoins et sur son solde. */
describe('état d’une tirelire', () => {
  function foyer(
    besoins: Array<{ id: string; activeFrom?: string; activeTo?: string }>,
    rollover: 'none' | 'unlimited' = 'none',
  ): Ledger {
    const l = emptyLedger({ periodStartDay: 1 });
    l.accounts.push({ id: 'acc', name: 'Compte', kind: 'principal', openingBalance: euros(1000), openingDate: '2024-12-31' });
    l.tirelires.push({
      id: 'tir',
      name: 'Piano',
      placement: [{ accountId: 'acc', share: { kind: 'variable' } }],
      openingBalance: 0,
      openingDate: '2025-01-01',
      rollover: { mode: rollover },
    });
    for (const b of besoins)
      l.needs.push({
        id: b.id,
        tirelireId: 'tir',
        kind: 'recurring',
        amount: euros(50),
        periodicity: { interval: 1, unit: 'month', anchorDate: '2025-01-01' },
        priority: 20,
        ...(b.activeFrom ? { activeFrom: b.activeFrom } : {}),
        ...(b.activeTo ? { activeTo: b.activeTo } : {}),
      });
    return l;
  }

  const état = (l: Ledger, date = '2026-09-06') => {
    const idx = indexLedger(l);
    return tirelireValidityState(idx.tireliresById.get('tir')!, idx, date);
  };

  it('en vigueur dès qu’un seul besoin l’est', () => {
    expect(état(foyer([{ id: 'a', activeTo: '2026-01-31' }, { id: 'b' }]))).toBe('active');
  });

  it('close quand tous ses besoins sont finis et qu’elle ne porte plus rien', () => {
    expect(état(foyer([{ id: 'a', activeTo: '2026-01-31' }]))).toBe('closed');
  });

  it('à venir quand tous ses besoins attendent', () => {
    expect(état(foyer([{ id: 'a', activeFrom: '2027-01-01' }]))).toBe('upcoming');
  });

  it('reste en vigueur tant qu’elle porte de l’argent, ses besoins fussent-ils clos', () => {
    // Même besoin clos que ci-dessus, mais reporté (D05) : les dotations sont restées dedans. La
    // garde qui compte — un besoin s'éteint souvent avant que la tirelire soit vidée, et la ranger
    // dans les closes ferait disparaître de l'écran de l'argent qui existe.
    const l = foyer([{ id: 'a', activeTo: '2026-01-31' }], 'unlimited');
    const idx = indexLedger(l);
    expect(tirelireBalance(idx.tireliresById.get('tir')!, idx, '2026-09-06')).toBeGreaterThan(0);
    expect(état(l)).toBe('active');
  });

  it('une tirelire sans aucun besoin est en vigueur : rien ne permet de la dire terminée', () => {
    expect(état(foyer([]))).toBe('active');
  });
});

/**
 * L'exemple doit montrer le filtre sans qu'on saisisse quoi que ce soit : sans les trois états sur
 * les trois écrans, la fonction n'est visible nulle part au chargement.
 */
describe('l’exemple porte les trois états (D55)', () => {
  const l = exampleLedger();
  const asOf = '2026-09-06';
  const compte = (états: StateFilter[], items: Array<{ activeFrom?: string; activeTo?: string }>) =>
    items.filter((x) => états.includes(validityState(x, asOf))).length;

  it('des besoins clos et des besoins à venir sur l’écran Tirelires', () => {
    expect(compte(['closed'], l.needs)).toBeGreaterThan(0);
    expect(compte(['upcoming'], l.needs)).toBeGreaterThan(0);
    expect(compte(['active'], l.needs)).toBeGreaterThan(0);
  });

  it('un flux à venir sur l’écran Flux prévus', () => {
    expect(compte(['upcoming'], l.plannedFlows)).toBeGreaterThan(0);
    expect(compte(['active'], l.plannedFlows)).toBeGreaterThan(0);
  });

  it('un compte clos sur l’écran Comptes, sans effet sur le plan', () => {
    const clos = l.accounts.filter((a) => validityState(a, asOf) === 'closed');
    expect(clos).toHaveLength(1);
    // Clos, vidé, jamais désigné : il ne doit apparaître dans aucun virement du plan, sans quoi
    // l'exemple demanderait un virement vers un compte qui n'existe plus.
    const plan = computePlan(l, asOf);
    expect(plan.transfers.some((t) => t.accountId === clos[0]!.id)).toBe(false);
    expect(l.tirelires.some((e) => e.placement.some((p) => p.accountId === clos[0]!.id))).toBe(false);
  });
});
