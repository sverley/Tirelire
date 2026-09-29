/**
 * Harnais d'audit de #183 — « Le plan des périodes à venir suppose exécutés ses propres virements
 * (D52), contre le principe 1.3 ». Côté cœur ; ce qui se voit à l'écran est dans
 * `apps/web/test/navigateur/plan-sans-hypothese.test.ts`.
 *
 * Il ne relit pas la solution : il rejoue le « Fait quand » de l'issue sur le jeu d'exemple (données
 * inventées), à la date de lecture que l'application lui donne (`loadExample` : 6 septembre 2026), et
 * ne fige aucun montant : ce que les tirelires demandent est recalculé ici, depuis les lignes du
 * plan, et comparé à ce que le plan dit de virer.
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
 * 5. Le pointage de D12 sur un virement permanent (garde du mécanisme que le point 5 s'appuie sur) :
 *    l'occurrence dont la fenêtre est close sans opération remonte en « attendu, non reçu » ; pointée
 *    ou encore dans sa fenêtre, non. Ce que l'écran en lit est dans le fichier du navigateur : le
 *    cœur n'a pas d'état d'occurrence à interroger.
 * 6. Sans suivi des opérations (U1), le plan des périodes à venir est complet : voir le navigateur.
 * 7. Commencer à importer ne change ni les besoins ni les virements permanents proposés.
 * 8. Les soldes des tirelires ne changent pas (D29, I2) : enregistrer un virement ou importer ne les
 *    déplace pas, dans aucune période.
 *
 * Les gardes vertes le restent après le codage ; les rouges le sont pour la raison dite dans leur
 * message. Le codage sert aussi à recaler ce harnais : un test qui reste rouge alors que le besoin
 * est couvert est à corriger, pas à contourner.
 *
 * Niveaux (D83) : tous à 1. Le plan sans hypothèse est la parole du porteur (principe 1.3), et la
 * promesse tombe si le plan affiche une position de compte qu'aucune donnée ne porte, si un
 * manquement se cache, ou si l'import change ce que le budget demande ; aucune donnée n'est perdue
 * par là, le plan se calculant sans être stocké (D84).
 */
import { describe, expect, it } from 'vitest';
import {
  alive,
  applyMatch,
  applyPatchToLedger,
  computePlan,
  euros,
  exampleLedger,
  indexLedger,
  matchTirelireTransfers,
  missingFlows,
  normalizeLabel,
  periodsAround,
  proposeMatches,
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
 * fait : la sortie est ventilée entre les tirelires du Livret A (D21), l'entrée est rapprochée.
 */
function avecVirement(l: Ledger, montant: number, date: string, id = 'op-virement'): Ledger {
  const sortie: Operation = { id, accountId: PRINCIPAL, origin: 'imported', date, label: LIBELLÉ_VIREMENT, normalizedLabel: normalizeLabel(LIBELLÉ_VIREMENT), amount: -montant, state: 'untreated' };
  const entrée: Operation = { id: `${id}-entrée`, accountId: LIVRET, origin: 'imported', date, label: LIBELLÉ_VIREMENT, normalizedLabel: normalizeLabel(LIBELLÉ_VIREMENT), amount: montant, state: 'reconciled', transferAccountId: PRINCIPAL };
  const avec: Ledger = { ...l, operations: [...l.operations, entrée, sortie] };
  return applyPatchToLedger(avec, matchTirelireTransfers(avec));
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

  it('garde : la part permanente et le complément du virement disent déjà la demande (D52)', () => {
    for (const p of àVenir(exemple())) {
      for (const t of p.transfers) {
        if (t.settlement !== 0) continue;
        expect({ période: p.period.label, compte: t.accountName, montant: t.standing + t.exceptional }).toEqual({
          période: p.period.label,
          compte: t.accountName,
          montant: demande(p, t.accountId),
        });
      }
    }
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

  it('septembre, la période où l’on lit, garde son virement net du non affecté : la lecture du réel reste (point 1)', () => {
    const p = computePlan(exemple(), SEPTEMBRE, LECTURE);
    const t = virement(p, LIVRET)!;
    expect(t.surplus, '15 € dorment sur le Livret A dans l’exemple').toBe(euros(15));
    expect(t.net).toBe(t.standing + t.exceptional - t.surplus);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Le pointage d'un virement permanent (D12)
// ---------------------------------------------------------------------------------------------

/**
 * L'exemple porte le flux dérivé `flow-vir-livret` : 600 € par mois, ancré au 28, fenêtre de cinq
 * jours. Une ligne de relevé du 28 août, importée, se rapproche de son occurrence (D12).
 */
function ligneDuVirement(date: string, montant = euros(600)): Operation {
  return { id: 'op-vir-permanent', accountId: PRINCIPAL, origin: 'imported', date, label: LIBELLÉ_VIREMENT, normalizedLabel: normalizeLabel(LIBELLÉ_VIREMENT), amount: -montant, state: 'untreated' };
}

function pointer(l: Ledger, op: Operation): Ledger {
  const avec: Ledger = { ...l, operations: [...l.operations, op] };
  const proposition = proposeMatches(avec, '2026-07-01', '2026-11-30').find((p) => p.operationId === op.id);
  expect(proposition, 'la ligne du relevé est reconnue comme l’occurrence du virement permanent').toBeDefined();
  return applyPatchToLedger(avec, applyMatch(avec, proposition!));
}

const manquants = (l: Ledger, de: string, à: string) => missingFlows(l, de, à).filter((m) => m.flowId === 'flow-vir-livret');

describe('[niveau 1] point 5 — le pointage de D12 porte sur les occurrences du virement permanent (garde du mécanisme)', () => {
  it('une occurrence dont la fenêtre est close sans opération est un virement attendu non reçu', () => {
    const m = manquants(avecImport(exemple()), '2026-08-15', '2026-09-20');
    expect(m.map((x) => x.expectedDate)).toEqual(['2026-08-28']);
    expect(m[0]!.windowEnd).toBe('2026-09-02');
  });

  it('pointée, la même occurrence ne remonte plus', () => {
    const l = pointer(avecImport(exemple()), ligneDuVirement('2026-08-29'));
    expect(manquants(l, '2026-08-15', '2026-09-20')).toEqual([]);
  });

  it('encore dans sa fenêtre, une occurrence n’est pas un manquement', () => {
    // 28 septembre + 5 jours de fenêtre : le 30 septembre, la fenêtre est ouverte.
    const l = avecImport(exemple());
    expect(manquants(l, '2026-09-01', '2026-09-30')).toEqual([]);
    expect(manquants(l, '2026-09-01', '2026-10-04').map((x) => x.expectedDate)).toEqual(['2026-09-28']);
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

  it('les périodes à venir ne lisent rien de plus qu’avant l’import', () => {
    const avant = àVenir(exemple());
    const après = àVenir(avecImport(exemple()));
    expect(après.map((p) => p.transfers.map((t) => [t.accountId, t.net]))).toEqual(avant.map((p) => p.transfers.map((t) => [t.accountId, t.net])));
  });
});

// ---------------------------------------------------------------------------------------------
// 8. Les soldes des tirelires
// ---------------------------------------------------------------------------------------------

describe('[niveau 1] point 8 — les soldes des tirelires ne dépendent ni des virements ni de l’import (D29, I2)', () => {
  it.each(CAS.slice(1))('%s : chaque tirelire garde son solde, dans chaque période', (_nom, faire) => {
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
