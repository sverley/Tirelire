// @vitest-environment jsdom
/**
 * Harnais d'audit de #420, composé parmi les tests du codeur :
 * ce que vérifiait, dans le navigateur, le harnais d'audit de #320 côté écran (« Le Bilan
 * lit le budget d'abord »), sauf C9, se vérifie ici sans navigateur : l'application montée sous jsdom (`ecran.ts`). Chaque titre dit le point du « Fait quand » de #320 qu'il vérifie, et le numéro du test retiré dans
 * la table de #420 (« bilan 1 » à « bilan 7 »).
 *
 * Ce qui se lit ici : ce que montrent le Bilan et le Plan, et où mènent leurs boutons. Les cartes de période se
 * reconnaissent à `data-periode`. Les montants attendus sont relus dans le cœur (`readBudgetAhead`), sur le même
 * projet et à la même date, et non figés. Décors : l'exemple chargé par « Charger l'exemple », lu au 6 septembre
 * 2026 ; un budget sans opération aux revenus réduits au tiers, et des opérations sans aucun besoin, posés dans
 * l'application comme elle pose l'exemple (`replaceWith`) et lus au jour des tests ; une base vide. La lecture
 * elle-même : `packages/core/test/bilan-budget-harnais.test.ts`. Reste dans le navigateur la mesure à 375 px (C9) :
 * `navigateur/bilan-budget-harnais.test.ts`.
 *
 * Niveaux (D83) : ceux des tests retirés, que la table de #420 recopie. 1 pour bilan 5 (I3, U1 : sans opération), bilan 6
 * (I3, U5 : sans besoin) et bilan 7 (I5, I3 : la base vide), chacun vu rouge sur une mutation ciblée du Bilan à
 * l'audit ; 2 pour bilan 1 à 4 (D06, D29, D52, D57, et la réponse au manque de #184).
 */
import { describe, expect, it } from 'vitest';
import { alive, dueDateShortfalls, exampleLedger, formatCents, readBudgetAhead, type Ledger } from '@tirelire/core';
import { JOUR, allerA, app, attendre, cliquer, cliquerExactement, ouvrirLApplication, presser, rendu, t, tous } from './ecran';

/** Un montant tel que l'écran l'écrit, espaces resserrés comme `t` les resserre. */
const fmt = (c: number) => formatCents(c).replace(/[\s  ]+/g, ' ');
const LECTURE_EXEMPLE = '2026-09-06';

/** Ouvre l'application et charge l'exemple, comme le bouton de l'accueil. */
async function ouvrirLExemple(): Promise<void> {
  await ouvrirLApplication();
  expect(await cliquer('Charger l\'exemple')).toBe(true);
  await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A') && app.asOf === LECTURE_EXEMPLE, 'l’exemple');
  await rendu();
}

/** Ouvre l'application sur ce projet, posé comme l'application pose l'exemple (`replaceWith`). */
async function ouvrirSur(l: Ledger): Promise<void> {
  await ouvrirLApplication();
  await app.replaceWith(l);
  await rendu();
  expect(app.asOf).toBe(JOUR);
}

/** Ce que montre le Bilan : titres, cartes de période (et si elles sont signalées), boutons, case « revenus ». */
function lireLeBilan() {
  const main = document.querySelector('main')!;
  return {
    titres: tous('h2', main).map(t),
    periodes: tous('[data-periode]', main).map((e) => ({ texte: t(e), avertie: e.classList.contains('warn') })),
    boutons: tous('button', main).map(t),
    caseRevenus: tous('label', main).some((l) => t(l) === 'revenus' && !!l.querySelector('input[type=checkbox]')),
    texte: t(main),
  };
}

async function allerAuBilan(): Promise<void> {
  await allerA('Bilan');
  expect(t(document.querySelector('main h1'))).toBe('Bilan');
}

async function allerAuPlan(): Promise<void> {
  await allerA('Plan');
  expect(tous('main h2').some((h) => t(h) === 'Tirelires'), 'le Plan ne s’affiche pas').toBe(true);
}

/** Les quatre totaux que le Plan affiche en tuiles, par leur intitulé (« Marge » sans son coussin). */
const tuilesDuPlan = (): Record<string, string> =>
  Object.fromEntries(tous('main .stats .stat').map((s) => [t(s.querySelector('.k')).replace(/ \(coussin.*$/, ''), t(s.querySelector('.v'))]));

/** Passe le Plan à la période qui suit celle qu'il regarde, par ses boutons de période (« octobre 2026 »…). */
async function periodeSuivanteDuPlan(): Promise<boolean> {
  const mois = /^(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) \d{4}$/;
  const barre = tous('main .actions').find((a) => tous('button', a).some((b) => mois.test(t(b))));
  const boutons = barre ? tous<HTMLButtonElement>('button', barre) : [];
  const suivant = boutons[boutons.findIndex((b) => b.classList.contains('primary')) + 1];
  if (suivant) await presser(suivant);
  return !!suivant;
}

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** L'exemple sans le lissage décidé de la taxe foncière : son échéance est en manque, sans réponse. */
function sansReponse(): Ledger {
  const l = exampleLedger();
  l.shortfallAnswers = [];
  l.operations = l.operations.filter((o) => o.id !== 'op-lissage-tf');
  l.subOperations = l.subOperations.filter((s) => s.operationId !== 'op-lissage-tf');
  return l;
}

/** Un budget sans aucune opération, dont les revenus, réduits au tiers, ne couvrent plus tout. */
function budgetSansOperationAuxRevenusReduits(): Ledger {
  const l = exampleLedger();
  l.operations = [];
  l.subOperations = [];
  l.shortfallAnswers = [];
  l.plannedFlows = l.plannedFlows.map((f) => (f.kind === 'income' ? { ...f, amount: Math.round(f.amount / 3) } : f));
  return l;
}

/** Des opérations, et plus aucun besoin : U5, importer et classer sans budget. */
function operationsSansBesoin(): Ledger {
  const l = exampleLedger();
  l.needs = [];
  // Sans besoin, plus de réponse à un manque : une réponse qui désigne un besoin absent n'a pas de sens.
  l.shortfallAnswers = [];
  return l;
}

describe('#420 · #320 — sur l’exemple, lu au 6 septembre : un budget et des opérations, sans navigateur', () => {
  it('[niveau 2] #320 points 1, 4 et 5 (table #420, bilan 1) — le budget d’abord, période par période, sans moyenne ; le passé dessous ; le choix des périodes vaut pour les deux', async () => {
    const lecture = readBudgetAhead(exampleLedger(), LECTURE_EXEMPLE, 12)!;
    await ouvrirLExemple();
    await allerAuBilan();
    let b = lireLeBilan();
    // D57 : le budget d'abord, le passé dessous, avec ses moyennes et sa case « revenus ».
    const iBudget = b.titres.indexOf('Le budget, période par période');
    const iPasse = b.titres.indexOf('Ce qui a été dépensé');
    expect(iBudget).toBeGreaterThanOrEqual(0);
    expect(iPasse).toBeGreaterThan(iBudget);
    expect(b.caseRevenus).toBe(true);
    expect(b.texte).toContain('moy.');
    // Six périodes par défaut, la première au montant du budget, et la période en cours dite.
    expect(b.periodes).toHaveLength(6);
    const t0 = lecture.periods[0]!.totals;
    for (const m of [t0.incomes, t0.fixedCharges, t0.requested, t0.funded, t0.margin]) expect(b.periodes[0]!.texte).toContain(fmt(m));
    expect(b.periodes[0]!.texte).toContain('période en cours');
    // Point 4 : aucune moyenne dans la lecture du budget, ni dans aucune de ses cartes.
    for (const p of b.periodes) expect(p.texte).not.toMatch(/moy\.|en moyenne/);
    // Aucune période n'est signalée : tous les besoins de l'exemple sont couverts.
    expect(b.periodes.some((p) => p.avertie)).toBe(false);

    // Le choix vaut pour les deux lectures : autant de cartes, et autant de lignes au tableau d'une catégorie du passé.
    const lignesDuTableau = () => tous('main table tbody tr').length;
    expect(await cliquer('3 périodes')).toBe(true);
    b = lireLeBilan();
    expect(b.periodes).toHaveLength(3);
    const ligne = document.querySelector('main button.row') as HTMLButtonElement | null;
    expect(ligne, 'la lecture du passé n’a aucune catégorie à ouvrir').toBeTruthy();
    await presser(ligne!);
    expect(lignesDuTableau()).toBe(3);
    expect(await cliquer('12 périodes')).toBe(true);
    b = lireLeBilan();
    expect(b.periodes).toHaveLength(12);
    for (let i = 0; i < 12; i++) expect(b.periodes[i]!.texte).toContain(fmt(lecture.periods[i]!.totals.margin));
    expect(lignesDuTableau()).toBe(12);
  });

  // Deux décors : l'exemple, où tout est couvert, et un budget aux revenus réduits, où « Couvert par les revenus »
  // n'est pas « Demandé » — sans lui, une carte qui montrerait le demandé pour le couvert ne se verrait pas.
  it.each([
    ['l’exemple lu au 6 septembre', 'exemple'],
    ['un budget aux revenus réduits, lu au jour des tests', 'reduits'],
  ])('[niveau 2] #320 point 1 (table #420, bilan 2) — chaque période dit, au centime, ce que le Plan dit de la même période : la période en cours, puis la suivante (%s)', async (_decor, quel) => {
    if (quel === 'exemple') await ouvrirLExemple();
    else {
      const l = budgetSansOperationAuxRevenusReduits();
      const p0 = readBudgetAhead(l, JOUR, 2)!.periods[0]!.totals;
      expect(p0.funded, 'les revenus réduits couvrent tout : ce décor ne distingue rien').not.toBe(p0.requested);
      await ouvrirSur(l);
    }
    await allerAuBilan();
    const b = lireLeBilan();
    expect(b.periodes.length).toBeGreaterThanOrEqual(2);
    await allerAuPlan();
    for (const i of [0, 1]) {
      if (i === 1) expect(await periodeSuivanteDuPlan(), 'le Plan n’a pas de période suivante').toBe(true);
      const plan = tuilesDuPlan();
      for (const k of ['Revenus prévus', 'Charges fixes', 'Couvert par les revenus', 'Marge']) expect(plan[k], `le Plan ne montre pas « ${k} »`).toBeTruthy();
      const carte = b.periodes[i]!.texte;
      // « Couvert par les revenus » du Plan est la part des dotations que les revenus couvrent.
      expect(carte, `période ${i + 1} : revenus prévus`).toMatch(new RegExp(`Revenus prévus\\s*${echapper(plan['Revenus prévus']!)}`));
      expect(carte, `période ${i + 1} : charges fixes`).toMatch(new RegExp(`Charges fixes\\s*${echapper(plan['Charges fixes']!)}`));
      expect(carte, `période ${i + 1} : part couverte par les revenus`).toMatch(new RegExp(`Couvert par les revenus\\s*${echapper(plan['Couvert par les revenus']!)}`));
      expect(carte, `période ${i + 1} : marge`).toContain(plan['Marge']);
    }
  });

  it('[niveau 2] #320 point 3 (table #420, bilan 3) — l’échéance en manque et la réponse qu’elle a reçue se lisent au Bilan : lissage décidé, aucune, refus ; la proposition n’y est pas répétée, le Plan en est le chemin', async () => {
    const manque = dueDateShortfalls(sansReponse(), LECTURE_EXEMPLE).find((s) => s.needId === 'need-tf')!;
    await ouvrirLExemple();
    await allerAuBilan();
    // Le lissage décidé que porte l'exemple : une fois, et rien à répondre ici.
    let b = lireLeBilan();
    expect(b.titres).toContain('Échéances en manque');
    expect(b.texte).toContain(manque.name);
    expect(b.texte).toContain('Lissage décidé');
    expect(b.boutons).not.toContain('Lisser');
    // Le Bilan mène au Plan, où l'on répond.
    expect(await cliquer('Répondre dans le Plan')).toBe(true);
    expect(app.view).toBe('plan');
    expect(tous('main h2').some((h) => t(h) === 'Échéances en manque'), 'le Plan ne montre pas ses échéances en manque').toBe(true);
    // Aucune réponse : le manque, son montant et sa date, sans la proposition de lisser.
    expect(await cliquer('Retirer le lissage')).toBe(true);
    await allerAuBilan();
    b = lireLeBilan();
    expect(b.texte).toContain('Aucune réponse pour l’instant');
    expect(b.texte).toContain(fmt(manque.amount));
    // shortDate abrège le mois à quatre lettres : « 15 octo. 2026 ».
    expect(b.texte).toMatch(/15 oct\S* 2026/);
    for (const geste of ['Lisser', 'Modifier', 'Refuser']) expect(b.boutons, `« ${geste} » n’est pas au Bilan`).not.toContain(geste);
    // Le refus.
    await allerAuPlan();
    expect(await cliquerExactement('Refuser')).toBe(true);
    await allerAuBilan();
    b = lireLeBilan();
    expect(b.texte).toContain('Lissage refusé');
  });
});

describe('#420 · #320 — un budget sans aucune opération, dont les revenus ne couvrent pas tout, sans navigateur', () => {
  it('[niveau 2] #320 point 2 (table #420, bilan 4) — une période dont des besoins ne sont pas couverts se distingue des autres et les nomme, avec le montant non couvert de chacun ; le détail de tous les besoins se déplie', async () => {
    const l = budgetSansOperationAuxRevenusReduits();
    const lecture = readBudgetAhead(l, JOUR, 6)!;
    expect(lecture.periods.some((p) => p.uncovered.length > 0), 'le projet de ce test doit avoir des besoins non couverts').toBe(true);
    await ouvrirSur(l);
    await allerAuBilan();
    const b = lireLeBilan();
    expect(b.periodes).toHaveLength(6);
    lecture.periods.forEach((p, i) => {
      expect(b.periodes[i]!.avertie, `période ${i + 1} signalée ou non`).toBe(p.uncovered.length > 0);
      for (const n of p.uncovered) {
        const carte = b.periodes[i]!.texte;
        expect(carte, `période ${i + 1} : « ${n.name} » nommé`).toContain(`« ${n.name} »`);
        expect(carte, `période ${i + 1} : montant non couvert de « ${n.name} »`).toContain(fmt(n.uncovered));
        // Comme le Plan : « n'est pas couverte » (rien n'est couvert) ou « n'est couverte qu'en partie ».
        expect(carte).toMatch(n.status === 'unfunded' ? new RegExp(`« ${echapper(n.name)} » n[’']est pas couverte`) : new RegExp(`« ${echapper(n.name)} » n[’']est couverte qu[’']en partie`));
      }
    });
    // Le détail de la première période se déplie à la demande, et porte tous ses besoins : replié, un besoin couvert
    // n'y est pas nommé.
    const premiere = () => document.querySelector('main [data-periode]')!;
    const couverts = lecture.periods[0]!.needs.filter((n) => !lecture.periods[0]!.uncovered.some((u) => u.needId === n.needId));
    expect(couverts.length, 'la première période n’a aucun besoin couvert : le dépli ne se vérifie pas').toBeGreaterThan(0);
    expect(couverts.some((n) => !t(premiere()).includes(n.name)), 'replié, le détail se lit déjà').toBe(true);
    const detail = tous<HTMLButtonElement>('button', premiere()).find((x) => t(x).startsWith('Détail ·'));
    expect(detail, 'la première période n’a pas de détail à déplier').toBeTruthy();
    await presser(detail!);
    for (const n of lecture.periods[0]!.needs) expect(t(premiere())).toContain(n.name);
  });

  it('[niveau 1] #320 point 6, I3, U1 (table #420, bilan 5) — sans opération, la place du passé dit en une phrase ce que des opérations y ajouteront, comme un enrichissement : aucune invitation à importer, aucune case « revenus », aucune moyenne', async () => {
    await ouvrirSur(budgetSansOperationAuxRevenusReduits());
    await allerAuBilan();
    const b = lireLeBilan();
    expect(b.periodes, 'le budget se lit sans opération').toHaveLength(6);
    expect(b.texte).toContain('Avec des opérations, importées ou saisies, le Bilan ajoutera ici ce qui a été dépensé');
    expect(b.caseRevenus).toBe(false);
    expect(b.texte).not.toMatch(/moy\.|en moyenne/);
    expect(b.boutons.filter((x) => /import/i.test(x)), 'aucun bouton ne mène à importer').toEqual([]);
    // Aucun geste de l'écran ne mène à l'écran Import.
    for (const bouton of tous<HTMLButtonElement>('main button')) {
      if (/périodes$|^Détail ·|^Masquer le détail$|^×$/.test(t(bouton))) continue;
      const vue = app.view;
      await presser(bouton);
      expect(app.view, `« ${t(bouton)} » mène à l’écran Import`).not.toBe('import');
      if (app.view !== vue) await allerAuBilan();
    }
  });
});

describe('#420 · #320 — des opérations, et aucun besoin (U5), sans navigateur', () => {
  it('[niveau 1] #320 point 7, I3, U5 (table #420, bilan 6) — sans aucun besoin et avec des opérations, le Bilan reste la lecture du passé seule, sans place vide pour le budget', async () => {
    await ouvrirSur(operationsSansBesoin());
    await allerAuBilan();
    const b = lireLeBilan();
    expect(b.periodes).toHaveLength(0);
    for (const titre of ['Le budget, période par période', 'Échéances en manque']) expect(b.titres).not.toContain(titre);
    expect(b.texte).not.toContain('Le Bilan lira votre budget');
    // La lecture du passé, telle qu'aujourd'hui : ses choix, sa case « revenus », son explication.
    for (const n of ['3 périodes', '6 périodes', '12 périodes']) expect(b.boutons).toContain(n);
    expect(b.caseRevenus).toBe(true);
    expect(b.texte).toContain('Dépensé par période de paie et par catégorie');
  });
});

describe('#420 · #320 — une base vide, sans navigateur', () => {
  it('[niveau 1] #320 point 7, I5, I3 (table #420, bilan 7) — sans besoin ni opération, le Bilan dit ce qu’il lira, et mène à « Construire mon budget »', async () => {
    await ouvrirLApplication();
    await allerAuBilan();
    const b = lireLeBilan();
    expect(b.texte).toContain('dès qu’il y en aura un');
    expect(b.texte).toContain('dès qu’il y aura des opérations');
    expect(b.boutons).toContain('Construire mon budget');
    // Rien à régler : ni choix de périodes, ni case « revenus », ni carte.
    expect(b.boutons.some((x) => /périodes$/.test(x))).toBe(false);
    expect(b.caseRevenus).toBe(false);
    expect(b.periodes).toHaveLength(0);
    expect(await cliquerExactement('Construire mon budget')).toBe(true);
    expect(app.view).toBe('wizard');
    expect(t(document.querySelector('main h1'))).toBe('Construire mon budget');
  });
});
