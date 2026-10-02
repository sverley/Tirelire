/**
 * Harnais d'audit de #320, côté écran — ce que le Bilan montre : le budget d'abord, période par période,
 * au montant du Plan ; le passé dessous ; ce qu'il dit sans opération, sans besoin, sans rien. Points 1 à 7
 * du « Fait quand ». Le calcul est gardé dans le cœur (`packages/core/test/bilan-budget-harnais.test.ts`) ;
 * ici, seulement ce qui se voit et ce qui mène ailleurs.
 *
 * Retenus parmi les tests du codeur (`bilan-budget.test.ts`, d'où ils sont déplacés), puis complétés : les
 * états que son seul exemple ne montrait pas — des revenus qui ne couvrent pas tout, des opérations sans
 * aucun besoin, la réponse à un manque — se fabriquent ici en grand livre importé par Réglages, comme le
 * font les autres harnais. Les cartes de période se reconnaissent à `data-periode`, la marque que le
 * codeur pose sur chacune. Les montants attendus sont relus dans le cœur, et non figés ; la date de
 * lecture est celle de l'exemple chargé (6 septembre) ou, pour un fichier importé, le jour des tests.
 *
 * Niveaux (D83) :
 *  - 1 pour ce que l'écran promet quand rien n'est encore saisi : une base vide qui dit ce qu'elle lira et
 *    mène à « Construire mon budget » (I5, I3 : aucun écran ne reste vide faute d'en avoir) ; un budget
 *    sans opération qui lit le budget sans inviter à importer comme à un préalable (I3, U1) ; des
 *    opérations sans aucun besoin dont le Bilan reste la lecture du passé seule, sans place vide pour le
 *    budget (I3, U5 : « aucun ne reste vide faute d'en avoir ») ; un Bilan aux périodes signalées qui ne
 *    déborde pas de l'écran à 375 px (C9 : le registre ne garde ce débordement que pour le Plan).
 *    Chacun a son témoin rouge, montré à l'audit.
 *  - 2 pour le reste : la lecture de D06, D29 et D52 à l'écran, au montant du Plan ; les non-couverts
 *    nommés ; le manque et sa réponse de #184 ; les deux lectures du passé et du budget de D57.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import { LEDGER_KEYS, LedgerStore, dueDateShortfalls, exampleLedger, formatCents, readBudgetAhead, type Ledger } from '@tirelire/core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const SQL = await initSqlJs();
const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));
/** Un montant tel que l'écran l'écrit, espaces normalisées comme à la lecture. */
const fmt = (c: number) => formatCents(c).replace(/\s+/g, ' ');
/** La date de lecture de l'exemple chargé (`loadExample`), et celle d'un fichier importé (`JOUR_DES_TESTS`). */
const LECTURE_EXEMPLE = '2026-09-06';
const LECTURE_IMPORT = '2026-09-20';

/** Ce que montre le Bilan : titres, cartes de période (et si elles sont signalées), boutons, case « revenus », largeur. */
const lireLeBilan = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main');
    return {
      titres: [...(main?.querySelectorAll('h2') ?? [])].map(t),
      periodes: [...(main?.querySelectorAll('[data-periode]') ?? [])].map((e) => ({ texte: t(e), avertie: e.classList.contains('warn') })),
      boutons: [...(main?.querySelectorAll('button') ?? [])].map(t),
      caseRevenus: [...(main?.querySelectorAll('label') ?? [])].some((l) => t(l) === 'revenus' && !!l.querySelector('input[type=checkbox]')),
      texte: t(main),
    };
  });

async function allerAuBilan(page: Page) {
  await allerÀ(page, 'Bilan');
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent?.trim() === 'Bilan');
  await pause();
}

/** Les quatre totaux que le Plan affiche en tuiles, par leur intitulé (« Marge » sans son coussin). */
const tuilesDuPlan = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return Object.fromEntries([...document.querySelectorAll('main .stats .stat')].map((s) => [t(s.querySelector('.k')).replace(/ \(coussin.*$/, ''), t(s.querySelector('.v'))])) as Record<string, string>;
  });

/** Passe le Plan à la période qui suit celle qu'il regarde, par ses boutons de période (« octobre 2026 »…). */
const periodeSuivanteDuPlan = (page: Page) =>
  page.evaluate(() => {
    const mois = /^(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) \d{4}$/;
    const barre = [...document.querySelectorAll('main .actions')].find((a) => [...a.querySelectorAll('button')].some((b) => mois.test(b.textContent?.trim() ?? '')));
    const boutons = [...(barre?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
    const suivant = boutons[boutons.findIndex((b) => b.classList.contains('primary')) + 1];
    suivant?.click();
    return !!suivant;
  });

async function allerAuPlan(page: Page) {
  await allerÀ(page, 'Plan');
  await page.waitForFunction(() => [...document.querySelectorAll('main h2')].some((h) => h.textContent?.trim() === 'Tirelires'));
  await pause();
}

/** Importe un grand livre par le champ « Importer un fichier… » de Réglages, sur une page neuve, puis va au Bilan. */
async function pageAvec(site: Site, l: Ledger): Promise<Page> {
  const store = await LedgerStore.create({ sqlJs: SQL, siteId: 'audit-320' });
  for (const clé of LEDGER_KEYS) for (const r of l[clé]) store.upsert(clé, r as never);
  for (const clé of ['periodStartDay', 'principalCushion', 'transferThreshold', 'orderRounding'] as const) store.setSetting(clé, l.settings[clé]);
  const octets = store.export();
  store.close();

  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-320-'));
  const chemin = join(dossier, 'grand-livre.sqlite');
  writeFileSync(chemin, octets);
  try {
    const page = await nouvellePage(site);
    page.on('dialog', (d) => void d.accept());
    await page.goto(site.url, { waitUntil: 'networkidle0' });
    const fin = Date.now() + 15_000;
    while (Date.now() < fin && !(await page.evaluate(() => !!document.querySelector('main') && !document.body.textContent?.includes('Ouverture de la base')).catch(() => false))) await pause(100);
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, 'Réglages'), 'Réglages introuvable sous Plus').toBe(true);
    await pause(300);
    const champ = (await page.evaluateHandle(() => [...document.querySelectorAll<HTMLInputElement>('main input[type="file"]')].find((c) => /sqlite/i.test(c.accept)) ?? null)).asElement();
    expect(champ, 'aucun champ pour importer un fichier SQLite dans Réglages').not.toBeNull();
    await (champ as unknown as { uploadFile(p: string): Promise<void> }).uploadFile(chemin);
    await pause(1_500);
    await allerAuBilan(page);
    return page;
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

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
  // Sans besoin, plus de réponse à un manque : une réponse qui désigne un besoin absent fait refuser l'import.
  l.shortfallAnswers = [];
  return l;
}

describe.skipIf(!navigateur)('#320 · le Bilan à l’écran', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  });
  afterAll(async () => {
    await site?.fermer();
  });

  describe('sur l’exemple, lu au 6 septembre : un budget et des opérations', () => {
    let page: Page;
    beforeAll(async () => {
      page = await ouvrirLExemple(site);
      await allerAuBilan(page);
    });
    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 2] points 1, 4 et 5 — le budget d’abord, période par période, sans moyenne ; le passé dessous ; le choix des périodes vaut pour les deux', async () => {
      const lecture = readBudgetAhead(exampleLedger(), LECTURE_EXEMPLE, 12)!;
      let b = await lireLeBilan(page);
      // D57 : le budget d'abord, le passé dessous, avec ses moyennes et sa case « revenus ».
      const iBudget = b.titres.indexOf('Le budget, période par période');
      const iPasse = b.titres.indexOf('Ce qui a été dépensé');
      expect(iBudget).toBeGreaterThanOrEqual(0);
      expect(iPasse).toBeGreaterThan(iBudget);
      expect(b.caseRevenus).toBe(true);
      expect(b.texte).toContain('moy.');
      // Six périodes par défaut, la première au montant du budget de référence d'U1, et la période en cours dite.
      expect(b.periodes).toHaveLength(6);
      const t0 = lecture.periods[0]!.totals;
      for (const m of [t0.incomes, t0.fixedCharges, t0.requested, t0.funded, t0.margin]) expect(b.periodes[0]!.texte).toContain(fmt(m));
      expect(b.periodes[0]!.texte).toContain('période en cours');
      // Point 4 : aucune moyenne dans la lecture du budget, ni dans aucune de ses cartes.
      for (const p of b.periodes) expect(p.texte).not.toMatch(/moy\.|en moyenne/);
      // Aucune période n'est signalée : tous les besoins de l'exemple sont couverts.
      expect(b.periodes.some((p) => p.avertie)).toBe(false);

      // Le choix vaut pour les deux lectures : autant de cartes, et autant de lignes au tableau d'une catégorie du passé.
      const lignesDuTableau = () => page.evaluate(() => document.querySelectorAll('main table tbody tr').length);
      expect(await cliquer(page, '3 périodes')).toBe(true);
      b = await lireLeBilan(page);
      expect(b.periodes).toHaveLength(3);
      const ouverte = await page.evaluate(() => {
        const ligne = document.querySelector('main button.row') as HTMLButtonElement | null;
        ligne?.click();
        return !!ligne;
      });
      expect(ouverte, 'la lecture du passé n’a aucune catégorie à ouvrir').toBe(true);
      await pause();
      expect(await lignesDuTableau()).toBe(3);
      expect(await cliquer(page, '12 périodes')).toBe(true);
      b = await lireLeBilan(page);
      expect(b.periodes).toHaveLength(12);
      for (let i = 0; i < 12; i++) expect(b.periodes[i]!.texte).toContain(fmt(lecture.periods[i]!.totals.margin));
      expect(await lignesDuTableau()).toBe(12);
    });

    it('[niveau 2] point 1 — chaque période dit, au centime, ce que le Plan dit de la même période : la période en cours, puis la suivante', async () => {
      await cliquer(page, '6 périodes');
      const b = await lireLeBilan(page);
      await allerAuPlan(page);
      for (const i of [0, 1]) {
        if (i === 1) expect(await periodeSuivanteDuPlan(page), 'le Plan n’a pas de période suivante').toBe(true);
        await pause();
        const plan = await tuilesDuPlan(page);
        for (const k of ['Revenus prévus', 'Charges fixes', 'Réservé et viré', 'Marge']) expect(plan[k], `le Plan ne montre pas « ${k} »`).toBeTruthy();
        const carte = b.periodes[i]!.texte;
        // « Réservé et viré » du Plan est la part des dotations que les revenus couvrent.
        expect(carte, `période ${i + 1} : revenus prévus`).toContain(plan['Revenus prévus']);
        expect(carte, `période ${i + 1} : charges fixes`).toContain(plan['Charges fixes']);
        expect(carte, `période ${i + 1} : part couverte par les revenus`).toMatch(new RegExp(`Couvert par les revenus\\s*${plan['Réservé et viré']!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
        expect(carte, `période ${i + 1} : marge`).toContain(plan['Marge']);
      }
    });

    it('[niveau 2] point 3 — l’échéance en manque et la réponse qu’elle a reçue se lisent au Bilan : lissage décidé, aucune, refus ; la proposition n’y est pas répétée, le Plan en est le chemin', async () => {
      const manque = dueDateShortfalls(sansReponse(), LECTURE_EXEMPLE).find((s) => s.needId === 'need-tf')!;
      await allerAuBilan(page);
      // Le lissage décidé que porte l'exemple : une fois, et rien à répondre ici.
      let b = await lireLeBilan(page);
      expect(b.titres).toContain('Échéances en manque');
      expect(b.texte).toContain(manque.name);
      expect(b.texte).toContain('Lissage décidé');
      expect(b.boutons).not.toContain('Lisser');
      // Le Bilan mène au Plan, où l'on répond.
      expect(await cliquer(page, 'Répondre dans le Plan')).toBe(true);
      await page.waitForFunction(() => [...document.querySelectorAll('main h2')].some((h) => h.textContent?.trim() === 'Échéances en manque'));
      // Aucune réponse : le manque, son montant et sa date, sans la proposition de lisser.
      expect(await cliquer(page, 'Retirer le lissage')).toBe(true);
      await allerAuBilan(page);
      b = await lireLeBilan(page);
      expect(b.texte).toContain('Aucune réponse pour l’instant');
      expect(b.texte).toContain(fmt(manque.amount));
      // shortDate abrège le mois à quatre lettres : « 15 octo. 2026 ».
      expect(b.texte).toMatch(/15 oct\S* 2026/);
      for (const geste of ['Lisser', 'Modifier', 'Refuser']) expect(b.boutons, `« ${geste} » n’est pas au Bilan`).not.toContain(geste);
      // Le refus.
      await allerAuPlan(page);
      expect(await cliquer(page, 'Refuser')).toBe(true);
      await allerAuBilan(page);
      b = await lireLeBilan(page);
      expect(b.texte).toContain('Lissage refusé');
    });
  });

  describe('un budget sans aucune opération, dont les revenus ne couvrent pas tout', () => {
    let page: Page;
    const l = budgetSansOperationAuxRevenusReduits();
    beforeAll(async () => {
      page = await pageAvec(site, l);
    });
    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 2] point 2 — une période dont des besoins ne sont pas couverts se distingue des autres et les nomme, avec le montant non couvert de chacun ; le détail de tous les besoins se déplie', async () => {
      const lecture = readBudgetAhead(l, LECTURE_IMPORT, 6)!;
      expect(lecture.periods.some((p) => p.uncovered.length > 0), 'le grand livre de ce test doit avoir des besoins non couverts').toBe(true);
      const b = await lireLeBilan(page);
      expect(b.periodes).toHaveLength(6);
      lecture.periods.forEach((p, i) => {
        expect(b.periodes[i]!.avertie, `période ${i + 1} signalée ou non`).toBe(p.uncovered.length > 0);
        for (const n of p.uncovered) {
          const carte = b.periodes[i]!.texte;
          expect(carte, `période ${i + 1} : « ${n.name} » nommé`).toContain(`« ${n.name} »`);
          expect(carte, `période ${i + 1} : montant non couvert de « ${n.name} »`).toContain(fmt(n.uncovered));
          // Comme le Plan : « n'est pas couverte » (rien n'est couvert) ou « n'est couverte qu'en partie ».
          expect(carte).toMatch(n.status === 'unfunded' ? /n[’']est pas couverte/ : /n[’']est couverte qu[’']en partie/);
        }
      });
      // Le détail de la première période se déplie à la demande, et porte tous ses besoins.
      expect(await cliquer(page, 'Détail ·')).toBe(true);
      const apres = await lireLeBilan(page);
      for (const n of lecture.periods[0]!.needs) expect(apres.periodes[0]!.texte).toContain(n.name);
    });

    it('[niveau 1] point 6 — sans opération, la place du passé dit en une phrase ce que des opérations y ajouteront, comme un enrichissement : aucune invitation à importer, aucune case « revenus », aucune moyenne (I3, U1)', async () => {
      const b = await lireLeBilan(page);
      expect(b.periodes, 'le budget se lit sans opération').toHaveLength(6);
      expect(b.texte).toContain('Avec des opérations, importées ou saisies, le Bilan ajoutera ici ce qui a été dépensé');
      expect(b.caseRevenus).toBe(false);
      expect(b.texte).not.toMatch(/moy\.|en moyenne/);
      expect(b.boutons.filter((x) => /import/i.test(x)), 'aucun bouton ne mène à importer').toEqual([]);
    });

    // En dernier : il change le choix des périodes, que les tests d'avant lisent à six.
    it('[niveau 1] C9 — à 375 px, douze périodes signalées et leurs détails dépliés ne font pas défiler l’écran en largeur', async () => {
      expect(await cliquer(page, '12 périodes')).toBe(true);
      for (let i = 0; i < 3; i++) expect(await cliquer(page, 'Détail ·')).toBe(true);
      const r = await page.evaluate(() => ({ largeur: document.documentElement.clientWidth, defile: document.documentElement.scrollWidth }));
      expect(r.largeur).toBe(375);
      expect(r.defile, `le Bilan défile en largeur : ${r.defile} px pour ${r.largeur} px`).toBeLessThanOrEqual(r.largeur);
    });
  });

  describe('des opérations, et aucun besoin (U5)', () => {
    let page: Page;
    beforeAll(async () => {
      page = await pageAvec(site, operationsSansBesoin());
    });
    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 1] point 7 — sans aucun besoin et avec des opérations, le Bilan reste la lecture du passé seule, sans place vide pour le budget (I3, U5)', async () => {
      const b = await lireLeBilan(page);
      expect(b.periodes).toHaveLength(0);
      for (const titre of ['Le budget, période par période', 'Échéances en manque']) expect(b.titres).not.toContain(titre);
      expect(b.texte).not.toContain('Le Bilan lira votre budget');
      // La lecture du passé, telle qu'aujourd'hui : ses choix, sa case « revenus », son explication.
      for (const n of ['3 périodes', '6 périodes', '12 périodes']) expect(b.boutons).toContain(n);
      expect(b.caseRevenus).toBe(true);
      expect(b.texte).toContain('Dépensé par période de paie et par catégorie');
    });
  });

  describe('une base vide', () => {
    let page: Page;
    beforeAll(async () => {
      page = await nouvellePage(site);
      await page.goto(site.url, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => !!document.querySelector('.tabbar'));
      await allerAuBilan(page);
    });
    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 1] point 7 — sans besoin ni opération, le Bilan dit ce qu’il lira, et mène à « Construire mon budget » (I5, I3)', async () => {
      const b = await lireLeBilan(page);
      expect(b.texte).toContain('dès qu’il y en aura un');
      expect(b.texte).toContain('dès qu’il y aura des opérations');
      expect(b.boutons).toContain('Construire mon budget');
      // Rien à régler : ni choix de périodes, ni case « revenus », ni carte.
      expect(b.boutons.some((x) => /périodes$/.test(x))).toBe(false);
      expect(b.caseRevenus).toBe(false);
      expect(b.periodes).toHaveLength(0);
      expect(await cliquer(page, 'Construire mon budget')).toBe(true);
      await page.waitForFunction(() => document.querySelector('main h1')?.textContent?.trim() === 'Construire mon budget');
    });
  });
});
