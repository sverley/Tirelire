/**
 * Harnais d'audit de #183 — « Le plan des périodes à venir suppose exécutés ses propres virements
 * (D52), contre le principe 1.3 ». Côté cœur ; ce qui se voit à l'écran — l'écran Plan et la ligne
 * de chaque flux à l'écran Flux prévus — se vérifie sans navigateur, depuis #419, dans
 * `apps/web/test/plan-sans-hypothese-ecran.test.ts`.
 *
 * Composé après le codage (auditeur.md, étape 2) : pour chaque phrase du « Fait quand » qu'un test
 * peut trancher, un test — celui du codeur quand il la tranche (points 5 et 6, repris de
 * `occurrences-ordre-permanent.test.ts`), sinon le mien. Il rejoue le « Fait quand » de l'issue sur
 * le jeu d'exemple (données inventées), à la date de lecture que l'application lui donne
 * (`loadExample` : 6 septembre 2026), et ne fige aucun montant qu'il pourrait recalculer : ce que les
 * tirelires demandent est recalculé ici, depuis les lignes du plan, et comparé à ce que le plan dit
 * de virer.
 *
 * Chaque `describe` reprend un point sous son numéro (les points 9 et 10 sont de la documentation,
 * et le point 11 est ce fichier) :
 *
 * 1. Jusqu'à la date de lecture, les positions se lisent sur le réel : un virement enregistré ôte son
 *    écart, un virement oublié reste réclamé (D21, D52). Garde, verte avant comme après le codage.
 * 2. Au-delà, aucune position de compte ne dépend d'un virement non constaté : que le virement de la
 *    période courante soit enregistré ou non, le plan d'une période à venir dit la même chose.
 * 3 et 4. Pour chaque période à venir et chaque compte d'accueil, ce qu'il faut virer vaut ce que les
 *    tirelires placées là demandent pour la période : ni l'argent qui dort sur le compte, ni un
 *    virement fait ou non ne le déplacent. **Rouge** avant le codage : D52 retranchait du virement le
 *    « non affecté » qu'on rapatrie, c'est-à-dire une position de compte, dans une période à venir.
 *    Un règlement de compte tiers en est une aussi : il ne se lit que dans la période où l'on lit.
 * 5. Chaque occurrence d'un virement permanent se lit sur le plan de sa période : pointée, attendue
 *    dans sa fenêtre, ou attendue non reçue (D12). Tests du codeur. Ce que l'écran en dit est dans le
 *    fichier du navigateur.
 * 6. Sans suivi des opérations (U1), le plan ne dit ni réception ni manquement : test du codeur ; ce
 *    que l'écran montre est dans le fichier du navigateur.
 * 7. Commencer à importer ne change ni les besoins ni les virements permanents proposés.
 * 8. Les soldes des tirelires ne changent pas (D29, I2) : enregistrer un virement ne les déplace pas,
 *    dans aucune période. Commencer à importer ne les déplace pas non plus : le point 7 compare, avec
 *    et sans import, les soldes et le « tenu » de chaque ligne.
 *
 * Niveaux (D83) : tous à 1. Le plan sans hypothèse est la parole du porteur (principe 1.3), et la
 * promesse tombe si le plan affiche une position de compte qu'aucune donnée ne porte, si un
 * manquement se cache, ou si l'import change ce que le budget demande ; aucune donnée n'est perdue
 * par là, le plan se calculant sans être stocké (D89).
 */
import { describe, expect, it } from 'vitest';
import {
  alive,
  applyPatchToLedger,
  computePlan,
  euros,
  exampleLedger,
  indexLedger,
  matchTirelireTransfers,
  normalizeLabel,
  periodsAround,
  proposedOrderAllocation,
  tirelireBalance,
  type Ledger,
  type Operation,
  type Plan,
} from '../src/index.js';

const PRINCIPAL = 'acc-principal';
const LIVRET = 'acc-livret';
/** La date de lecture de l'exemple, telle que l'application la pose au chargement. */
const LECTURE = '2026-09-06';
/** Les trois périodes qui suivent celle de la date de lecture (28 août → 27 septembre). */
const SEPTEMBRE = '2026-09-06';
const OCTOBRE = '2026-09-28';
const NOVEMBRE = '2026-10-28';

// ---------------------------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------------------------

/**
 * Le plan de chaque période de la fenêtre de l'écran Plan, lu comme l'écran le lit : à la date de
 * lecture dans la période où l'on lit, au premier jour des autres.
 */
function plans(l: Ledger, lecture = LECTURE): Plan[] {
  return periodsAround(l, lecture, 1, 4).map((p) => computePlan(l, p.start <= lecture && p.end >= lecture ? lecture : p.start, lecture));
}

const àVenir = (l: Ledger, lecture = LECTURE): Plan[] => plans(l, lecture).filter((p) => p.period.start > lecture);

/** Ce que les tirelires placées sur un compte demandent pour la période du plan. */
function demande(p: Plan, compte: string): number {
  return p.lines.filter((x) => x.accountId === compte).reduce((s, x) => s + x.requested, 0);
}

const virement = (p: Plan, compte: string) => p.transfers.find((t) => t.accountId === compte);

/** Une ligne de relevé qui aurait été importée : « VIR PERMANENT TIRELIRE LIVRET A ». */
const LIBELLÉ_VIREMENT = 'VIR PERMANENT TIRELIRE LIVRET A';

/**
 * Un virement du compte principal vers le Livret A, enregistré des deux côtés comme l'import le
 * fait : l'entrée est rapprochée, la sortie reconnue par son libellé (D11). Reconnue par son seul
 * libellé, elle n'est pas ventilée d'office (#393, point 4) : l'utilisateur la ventile, ici par la
 * ventilation que le plan propose pour ce montant (D21, D60), ce qui la verrouille (D22).
 */
function avecVirement(l: Ledger, montant: number, date: string, id = 'op-virement'): Ledger {
  const sortie: Operation = { id, accountId: PRINCIPAL, origin: 'imported', date, label: LIBELLÉ_VIREMENT, normalizedLabel: normalizeLabel(LIBELLÉ_VIREMENT), amount: -montant, state: 'untreated' };
  const entrée: Operation = { id: `${id}-entrée`, accountId: LIVRET, origin: 'imported', date, label: LIBELLÉ_VIREMENT, normalizedLabel: normalizeLabel(LIBELLÉ_VIREMENT), amount: montant, state: 'reconciled', transferAccountId: PRINCIPAL };
  const avec: Ledger = { ...l, operations: [...l.operations, entrée, sortie] };
  const reconnu = applyPatchToLedger(avec, matchTirelireTransfers(avec));
  const plan = computePlan(l, date);
  const parts = proposedOrderAllocation(plan, virement(plan, LIVRET)!, montant);
  return {
    ...reconnu,
    operations: reconnu.operations.map((o) => (o.id === id ? { ...o, state: 'locked' as const } : o)),
    subOperations: [...reconnu.subOperations, ...parts.map((p, i) => ({ id: `${id}-part-${i}`, operationId: id, ...p }))],
  };
}

/** De l'argent arrivé sur le Livret A sans appartenir à aucune tirelire : il dort. */
function avecArgentQuiDort(l: Ledger, montant: number, date = '2026-09-04'): Ledger {
  const dépôt: Operation = { id: 'op-dort', accountId: LIVRET, origin: 'imported', date, label: 'DEPOT', normalizedLabel: 'DEPOT', amount: montant, state: 'untreated' };
  return { ...l, operations: [...l.operations, dépôt] };
}

/** Commencer à importer : des lignes de relevé du compte principal, non classées (U3). */
function avecImport(l: Ledger): Ledger {
  const ligne = (id: string, date: string, libellé: string, montant: number): Operation => ({
    id,
    accountId: PRINCIPAL,
    origin: 'imported',
    date,
    label: libellé,
    normalizedLabel: normalizeLabel(libellé),
    amount: montant,
    state: 'untreated',
  });
  return { ...l, operations: [...l.operations, ligne('imp-1', '2026-09-02', 'CB CARREFOUR', -euros(45.3)), ligne('imp-2', '2026-09-03', 'CB BOULANGERIE', -euros(12.8)), ligne('imp-3', '2026-09-04', 'VIR MUTUELLE', euros(30))] };
}

/** Le grand livre de l'exemple, et ses variantes : ce qu'un plan sans hypothèse ne doit pas suivre. */
const exemple = () => exampleLedger();
const CAS: Array<[string, () => Ledger]> = [
  ['l’exemple', exemple],
  ['un virement de 650 € enregistré avant la date de lecture', () => avecVirement(exemple(), euros(650), '2026-09-05')],
  ['300 € qui dorment sur le Livret A', () => avecArgentQuiDort(exemple(), euros(300))],
  ['des lignes de relevé importées', () => avecImport(exemple())],
];

/** Somme des écarts de placement du compte principal vers le Livret A, à la date de lecture. */
function écartsVersLivret(p: Plan): number {
  return p.gaps.filter((g) => g.toAccountId === LIVRET && g.fromAccountId === PRINCIPAL).reduce((s, g) => s + g.amount, 0);
}

/** Ce que le plan dit des tirelires, sans rien de la position des comptes. */
function lignes(p: Plan) {
  return p.lines.map((x) => ({ besoin: x.needId, compte: x.accountId, balance: x.balance, held: x.held, cruise: x.cruise, catchUp: x.catchUp, requested: x.requested }));
}

// ---------------------------------------------------------------------------------------------
// 1. Jusqu'à la date de lecture : le réel
// ---------------------------------------------------------------------------------------------

describe('[niveau 1] point 1 — jusqu’à la date de lecture, le plan lit les positions des comptes sur le réel', () => {
  it('un virement enregistré avant la date de lecture ôte son écart à la période en cours', () => {
    const sans = computePlan(exemple(), SEPTEMBRE, LECTURE);
    const avec = computePlan(avecVirement(exemple(), euros(650), '2026-09-05'), SEPTEMBRE, LECTURE);
    expect(écartsVersLivret(sans), 'sans virement, tout ce que les tirelires du Livret A demandent est encore sur le compte principal').toBe(demande(sans, LIVRET));
    expect(écartsVersLivret(avec)).toBe(écartsVersLivret(sans) - euros(650));
    const t = (p: Plan) => virement(p, LIVRET)!;
    expect(t(avec).standing + t(avec).exceptional).toBe(t(sans).standing + t(sans).exceptional - euros(650));
  });

  it('un virement oublié reste réclamé : au 5 octobre, celui de septembre n’ayant pas eu lieu, le plan le redemande', () => {
    // D21 : le « complément exceptionnel » est fait pour cela — l'argent est encore sur le compte principal.
    const lecture = '2026-10-05';
    const oublié = exemple();
    const fait = avecVirement(exemple(), euros(650), '2026-09-28');
    const réclamé = (l: Ledger) => écartsVersLivret(computePlan(l, lecture, lecture));
    expect(réclamé(oublié), 'septembre et octobre sont dus').toBeGreaterThan(demande(computePlan(oublié, lecture, lecture), LIVRET));
    expect(réclamé(fait)).toBe(réclamé(oublié) - euros(650));
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Au-delà : aucune position obtenue en supposant un virement exécuté
// ---------------------------------------------------------------------------------------------

describe('[niveau 1] point 2 — au-delà de la date de lecture, le plan ne dépend pas d’un virement non constaté', () => {
  it('le plan d’une période à venir dit la même chose, que le virement de la période courante soit enregistré ou non', () => {
    const sans = àVenir(exemple());
    const avec = àVenir(avecVirement(exemple(), euros(650), '2026-09-05'));
    expect(avec.length).toBeGreaterThanOrEqual(3);
    for (const [i, p] of sans.entries()) {
      const q = avec[i]!;
      expect(q.period.label).toBe(p.period.label);
      expect({ période: p.period.label, lignes: lignes(q) }).toEqual({ période: p.period.label, lignes: lignes(p) });
      expect({ période: p.period.label, virements: q.transfers.map((t) => [t.accountId, t.net]) }, 'ce que le plan dit de virer').toEqual({
        période: p.period.label,
        virements: p.transfers.map((t) => [t.accountId, t.net]),
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 3 et 4. Ce qu'il faut virer vaut ce que les tirelires demandent
// ---------------------------------------------------------------------------------------------

describe('[niveau 1] points 3 et 4 — pour une période à venir, ce qu’il faut virer vaut ce que les tirelires demandent', () => {
  it.each(CAS)('%s : pour chaque période à venir et chaque compte d’accueil, le virement à faire vaut la demande des tirelires', (_nom, faire) => {
    const périodes = àVenir(faire());
    expect(périodes.map((p) => p.period.label).slice(0, 3)).toEqual(['octobre 2026', 'novembre 2026', 'décembre 2026']);
    let comptes = 0;
    for (const p of périodes) {
      for (const t of p.transfers) {
        if (t.settlement !== 0) continue; // un compte tiers se règle, il ne se dote pas.
        comptes++;
        expect(
          { période: p.period.label, compte: t.accountName, àVirer: t.net },
          `« ${t.accountName} », ${p.period.label} : le plan dit de virer ${t.net / 100} € pour ${demande(p, t.accountId) / 100} € demandés par ses tirelires — la différence est une position de compte (le non affecté qu’on rapatrie), lue dans une période dont aucun relevé n’existe`,
        ).toEqual({ période: p.period.label, compte: t.accountName, àVirer: demande(p, t.accountId) });
      }
    }
    expect(comptes, 'au moins un compte d’accueil par période à venir').toBeGreaterThanOrEqual(périodes.length);
  });

  it('un règlement de compte tiers est une position de compte : il ne se lit que dans la période où l’on lit', () => {
    // Sur l'exemple, le compte de Marie doit 20 € au compte principal. Lu au 6 septembre, ce solde
    // ne dit rien d'octobre : le redemander à chaque période à venir, c'est le supposer inchangé.
    const courant = computePlan(exemple(), SEPTEMBRE, LECTURE);
    expect(courant.transfers.filter((t) => t.settlement !== 0).map((t) => t.accountName)).toEqual(['Compte de Marie']);
    for (const p of àVenir(exemple())) {
      expect({ période: p.period.label, règlements: p.transfers.filter((t) => t.settlement !== 0).map((t) => t.accountName) }).toEqual({ période: p.period.label, règlements: [] });
    }
  });

});

// ---------------------------------------------------------------------------------------------
// 5 et 6. Les occurrences d'un virement permanent (tests du codeur, repris au harnais)
// ---------------------------------------------------------------------------------------------

/**
 * L'exemple porte le flux dérivé `flow-vir-livret` : 600 € par mois, ancré au 28, fenêtre de cinq
 * jours, sur le compte principal ; il n'importe aucun relevé. Dans la période « septembre 2026 »
 * (28/08 → 27/09), l'occurrence du 28 août est close ; celle du 28 septembre ouvre « octobre 2026 ».
 */
function ligneDeRelevé(id: string, date: string, montant: number, reprise?: { plannedFlowId: string; plannedDate: string }): Operation {
  return { id, accountId: PRINCIPAL, origin: 'imported', date, label: LIBELLÉ_VIREMENT, normalizedLabel: normalizeLabel(LIBELLÉ_VIREMENT), amount: montant, state: 'untreated', ...reprise };
}

const avecLignes = (...ops: Operation[]): Ledger => {
  const l = exemple();
  return { ...l, operations: [...l.operations, ...ops] };
};

const virementLivret = (l: Ledger, asOf: string) => computePlan(l, asOf, LECTURE).transfers.find((t) => t.accountId === LIVRET)!;

describe('[niveau 1] point 5 — le virement permanent se lit sur son flux, le plan de sa période le montre (D12)', () => {
  it('pointée : une opération rapprochée de l’ordre, dans sa fenêtre', () => {
    const l = avecLignes(ligneDeRelevé('o1', '2026-08-29', -euros(600), { plannedFlowId: 'flow-vir-livret', plannedDate: '2026-08-28' }));
    expect(virementLivret(l, SEPTEMBRE).occurrences).toEqual([{ date: '2026-08-28', windowEnd: '2026-09-02', status: 'pointee', operationId: 'o1', flowId: 'flow-vir-livret', flowName: 'Virement Livret A' }]);
  });

  it('attendue non reçue : la fenêtre est close sans opération, et le plan de sa période le montre', () => {
    const l = avecLignes(ligneDeRelevé('o2', '2026-09-01', -euros(40)));
    expect(virementLivret(l, SEPTEMBRE).occurrences).toEqual([{ date: '2026-08-28', windowEnd: '2026-09-02', status: 'nonRecue', flowId: 'flow-vir-livret', flowName: 'Virement Livret A' }]);
  });

  it('attendue : une période à venir montre l’occurrence à venir, sans rien en supposer', () => {
    const l = avecLignes(ligneDeRelevé('o2', '2026-09-01', -euros(40)));
    expect(virementLivret(l, OCTOBRE).occurrences).toEqual([{ date: '2026-09-28', windowEnd: '2026-10-03', status: 'attendue', flowId: 'flow-vir-livret', flowName: 'Virement Livret A' }]);
  });
});

describe('[niveau 1] point 6 — sans suivi des opérations (U1), le plan ne dit ni réception ni manquement', () => {
  it('le virement est proposé, complet, et ne porte aucune occurrence', () => {
    const l = exemple();
    for (const asOf of [SEPTEMBRE, OCTOBRE]) {
      expect(virementLivret(l, asOf).bankOrder).toBeDefined();
      expect(virementLivret(l, asOf).occurrences).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 7. Commencer à importer
// ---------------------------------------------------------------------------------------------

describe('[niveau 1] point 7 — commencer à importer ne change ni les besoins ni les virements permanents proposés', () => {
  it('les tirelires demandent la même chose, et le virement permanent reste la somme de leurs dotations, sur toutes les périodes', () => {
    const avant = plans(exemple());
    const après = plans(avecImport(exemple()));
    expect(après.map((p) => p.period.label)).toEqual(avant.map((p) => p.period.label));
    for (const [i, p] of avant.entries()) {
      const q = après[i]!;
      expect({ période: p.period.label, lignes: lignes(q) }).toEqual({ période: p.period.label, lignes: lignes(p) });
      expect({ période: p.period.label, permanents: q.transfers.map((t) => [t.accountId, t.permanent, t.breakdown]) }).toEqual({
        période: p.period.label,
        permanents: p.transfers.map((t) => [t.accountId, t.permanent, t.breakdown]),
      });
    }
  });

});

// ---------------------------------------------------------------------------------------------
// 8. Les soldes des tirelires
// ---------------------------------------------------------------------------------------------

describe('[niveau 1] point 8 — les soldes des tirelires ne dépendent pas d’un virement enregistré (D29, I2)', () => {
  it('un virement enregistré avant la date de lecture : chaque tirelire garde son solde, dans chaque période', () => {
    const faire = () => avecVirement(exemple(), euros(650), '2026-09-05');
    const base = plans(exemple());
    const variante = plans(faire());
    for (const [i, p] of base.entries()) {
      const soldes = (x: Plan) => x.lines.map((l) => [l.needId, l.balance, l.held]);
      expect({ période: p.period.label, soldes: soldes(variante[i]!) }).toEqual({ période: p.period.label, soldes: soldes(p) });
    }
    const idxBase = indexLedger(exemple());
    const idx = indexLedger(faire());
    for (const e of alive(exemple().tirelires)) {
      expect({ tirelire: e.name, solde: tirelireBalance(e, idx, LECTURE) }).toEqual({ tirelire: e.name, solde: tirelireBalance(e, idxBase, LECTURE) });
    }
  });
});
