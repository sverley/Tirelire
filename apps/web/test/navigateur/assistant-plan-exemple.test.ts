/**
 * Tests du codeur de #324 — « L'assistant conduit au plan, et son résumé dit ce que dira le plan » :
 * l'assistant mené jusqu'à sa validation par ses seuls boutons primaires, sur un projet vierge, au
 * 6 septembre 2026, à 375 px, sur le site construit.
 *
 * Tous de niveau 4 (D83) : l'auditeur retient, déplace et modifie.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import {
  LedgerStore,
  computePlan,
  dueDateShortfalls,
  exampleLedger,
  periodReadingDate,
  periodsAround,
  shortfallsForPeriod,
  type Ledger,
} from '@tirelire/core';
import { allerÀ, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const SQL = await initSqlJs();
const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));
const JOUR = '2026-09-06';

/** Une page neuve dont l'horloge lit le 6 septembre 2026, jour de l'exemple, à midi heure de Paris. */
async function pageAuJour(site: Site): Promise<Page> {
  const page = await nouvellePage(site);
  await page.evaluateOnNewDocument((début: number) => {
    const Vraie = Date;
    const décalage = début - Vraie.now();
    const maintenant = () => Vraie.now() + décalage;
    function DateFixée(this: unknown, ...a: unknown[]): unknown {
      if (!new.target) return new Vraie(maintenant()).toString();
      return a.length === 0 ? new Vraie(maintenant()) : new (Vraie as unknown as new (...b: unknown[]) => Date)(...a);
    }
    Object.setPrototypeOf(DateFixée, Vraie);
    DateFixée.prototype = Vraie.prototype;
    (DateFixée as unknown as { now: () => number }).now = maintenant;
    (globalThis as unknown as { Date: unknown }).Date = DateFixée;
  }, Date.parse(`${JOUR}T12:00:00+02:00`));
  return page;
}

/** Clique un bouton primaire, et lui seul : le parcours simple se franchit par eux (I4). */
async function primaire(page: Page, texte: string): Promise<void> {
  const fait = await page.evaluate((t: string) => {
    const b = ([...document.querySelectorAll('main button.btn.primary')] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').includes(t));
    b?.click();
    return !!b;
  }, texte);
  expect(fait, `pas de bouton primaire « ${texte} »`).toBe(true);
  await pause(250);
}

/** L'assistant ouvert sur un projet vierge, à l'étape Le principe. */
async function ouvrirLAssistant(site: Site): Promise<Page> {
  const page = await pageAuJour(site);
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
  await allerÀ(page, 'Plan');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('Construire mon budget'));
    b?.click();
  });
  await pause(300);
  return page;
}

/** Ce que le résumé de l'assistant dit : les montants, les annonces, les échéances en manque. */
const lireLeResume = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();
    return {
      titre: t(document.querySelector('main .card.accent, main .card.warn')),
      montants: [...document.querySelectorAll('main .card > .row')]
        .filter((r) => !r.querySelector('.label strong'))
        .map((r): [string, string] => [t(r.querySelector('.label')), t(r.querySelector('.num'))]),
      annonces: [...document.querySelectorAll('main .warnings > div')].map(t),
      manques: [...document.querySelectorAll('main .card.warn .row')]
        .filter((r) => t(r.querySelector('.label')).includes('échéance du'))
        .map((r): [string, string, string] => [t(r.querySelector('.label strong')), t(r.querySelector('.sub.neg')), t(r.querySelector(':scope > .num'))]),
    };
  });

/** Ce que le Plan de la période en cours dit : les montants, les annonces, les échéances en manque. */
const lireLePlan = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();
    return {
      montants: [...document.querySelectorAll('main .stats .stat')].map((s): [string, string] => [t(s.querySelector('.k')), t(s.querySelector('.v'))]),
      annonces: [...document.querySelectorAll('main .warnings > div')].map(t),
      manques: [...document.querySelectorAll('main .card.warn .row')]
        .filter((r) => t(r.querySelector('.label')).includes('échéance du'))
        .map((r): [string, string, string] => [t(r.querySelector('.label strong')), t(r.querySelector('.sub.neg')), t(r.querySelector(':scope > .num'))]),
    };
  });

/** Le fichier que l'application a conservé, relu côté Node. */
async function projetConserve(page: Page): Promise<Ledger> {
  await pause(1200); // l'application conserve le fichier un instant après la dernière écriture
  const b64 = await page.evaluate(
    () =>
      new Promise<string | null>((ok) => {
        const req = indexedDB.open('tirelire');
        req.onerror = () => ok(null);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('files')) return (db.close(), ok(null));
          const get = db.transaction('files', 'readonly').objectStore('files').get('ledger.sqlite');
          get.onerror = () => (db.close(), ok(null));
          get.onsuccess = () => {
            db.close();
            const v = get.result as Uint8Array | undefined;
            if (!(v instanceof Uint8Array)) return ok(null);
            let s = '';
            for (let i = 0; i < v.length; i += 0x8000) s += String.fromCharCode(...v.subarray(i, i + 0x8000));
            ok(btoa(s));
          };
        };
      }),
  );
  expect(b64, 'le fichier de l’application est introuvable').not.toBeNull();
  const store = await LedgerStore.create({ sqlJs: SQL, bytes: new Uint8Array(Buffer.from(b64!, 'base64')) });
  const projet = store.load();
  store.close();
  return projet;
}

/** L'exemple privé de ses opérations : les opérations, leurs sous-opérations, et la réponse de lissage qu'elles portent. */
function exempleSansOperations(): Ledger {
  const l = exampleLedger();
  l.operations = [];
  l.subOperations = [];
  l.shortfallAnswers = [];
  return l;
}

/**
 * Ce que dit le Plan de la période en cours et des douze suivantes, sans les identifiants (ceux de
 * l'exemple ne sont pas ceux d'un projet qui l'a reproduit) : de quoi comparer deux projets au centime.
 */
function lirePlans(l: Ledger, jour: string) {
  return periodsAround(l, jour, 0, 12).map((p) => {
    const plan = computePlan(l, periodReadingDate(p, jour), jour);
    const manques = shortfallsForPeriod(dueDateShortfalls(l, jour), plan.period, jour);
    return {
      periode: [p.start, p.end],
      totaux: plan.totals,
      lignes: plan.lines.map((x) => ({ nom: x.name, genre: x.kind, demande: x.requested, couvert: x.funded, statut: x.status })),
      virements: plan.transfers.map((x) => ({
        compte: x.accountName,
        permanent: x.permanent,
        reguliers: x.standing,
        net: x.net,
        ordre: x.bankOrder ? { montant: x.bankOrder.amount, ecart: x.bankOrder.drift } : null,
      })),
      annonces: plan.warnings.map((w) => [w.code, w.message]),
      manques: manques.map((m) => ({
        nom: m.name,
        date: m.dueDate,
        manque: m.amount,
        croisiere: m.cruise,
        propose: (m.proposal ?? []).map((q) => [q.date, q.amount]),
      })),
    };
  });
}

/** Saisit une valeur comme le ferait un doigt : le champ change, puis son changement est déclaré. */
async function saisir(page: Page, selecteur: string, rang: number, valeur: string): Promise<void> {
  const fait = await page.evaluate(
    (sel: string, r: number, v: string) => {
      const champ = document.querySelectorAll<HTMLInputElement>(sel)[r];
      if (!champ) return false;
      champ.value = v;
      champ.dispatchEvent(new Event('input', { bubbles: true }));
      champ.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    selecteur,
    rang,
    valeur,
  );
  expect(fait, `pas de champ « ${selecteur} » n°${rang}`).toBe(true);
  await pause(150);
}

/** Passe d'étape en étape, par « Suivant », jusqu'à celle où l'on voit `ceQuOnVoit`. */
async function avancerJusqua(page: Page, ceQuOnVoit: string): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const la = await page.evaluate((t: string) => (document.querySelector('main')?.textContent ?? '').includes(t), ceQuOnVoit);
    if (la) return;
    await primaire(page, 'Suivant');
  }
  throw new Error(`l'assistant n'arrive pas à « ${ceQuOnVoit} »`);
}

/** Retire une tirelire de l'étape où l'on est, par son nom. */
async function retirerLaTirelire(page: Page, nom: string): Promise<void> {
  const fait = await page.evaluate((n: string) => {
    const ligne = [...document.querySelectorAll('main .ligne-tirelire')].find((l) => (l.querySelector('input.nom') as HTMLInputElement | null)?.value === n);
    const b = ligne?.querySelector('button[title="Retirer cette tirelire"]') as HTMLButtonElement | null;
    b?.click();
    return !!b;
  }, nom);
  expect(fait, `pas de tirelire « ${nom} » à retirer`).toBe(true);
  await pause(150);
}

/** Un geste de l'utilisateur, fait à l'étape où l'on voit `ceQuOnVoit`. */
type Geste = [ceQuOnVoit: string, geste: (page: Page) => Promise<void>];

/**
 * Un projet vierge, l'assistant mené à son résumé en faisant les `gestes`, le résumé lu, le budget
 * validé, puis le Plan de la période en cours lu à son tour.
 */
async function resumeEtPlan(site: Site, gestes: Geste[]) {
  const page = await ouvrirLAssistant(site);
  try {
    await primaire(page, 'Commencer');
    for (const [ceQuOnVoit, geste] of gestes) {
      await avancerJusqua(page, ceQuOnVoit);
      await geste(page);
    }
    await avancerJusqua(page, 'Valider mon budget');
    const resume = await lireLeResume(page);
    await primaire(page, 'Valider mon budget');
    await pause(300);
    await allerÀ(page, 'Plan');
    await pause(300);
    const plan = await lireLePlan(page);
    return { resume, plan, projet: await projetConserve(page) };
  } finally {
    await page.close();
  }
}

/** Les centimes d'un montant écrit à la française : « −1 234,50 € » dit −123450. */
const centimes = (t: string) => Math.round(Number(t.replace(/[^\d,−-]/g, '').replace('−', '-').replace(',', '.')) * 100);

/**
 * Le résumé dit ce que dit le Plan de la période en cours, une fois le budget validé : les mêmes
 * montants — ceux que l'écran du Plan montre, et ceux qu'il ne montre pas, relus dans le projet
 * conservé —, les mêmes annonces, les mêmes échéances en manque ; et « Tout est finançable »
 * seulement si le Plan n'annonce rien.
 */
function leResumeEstLePlan({ resume, plan, projet }: Awaited<ReturnType<typeof resumeEtPlan>>): void {
  // Ce que l'écran du Plan montre.
  for (const [libelle, valeur] of plan.montants) {
    const dans = resume.montants.find(([l]) => l === libelle);
    expect(dans, `le résumé ne dit pas « ${libelle} »`).toBeDefined();
    expect(dans![1], libelle).toBe(valeur);
  }
  expect(resume.annonces).toEqual(plan.annonces);
  expect(resume.manques).toEqual(plan.manques);
  // Ce que le Plan calcule pour la période en cours du projet validé.
  const [courante] = lirePlans(projet, JOUR);
  const dit = (debut: string | RegExp) => resume.montants.find(([l]) => (typeof debut === 'string' ? l === debut : debut.test(l)));
  expect(centimes(dit('Revenus prévus')![1]), 'revenus').toBe(courante!.totaux.incomes);
  expect(centimes(dit('Charges fixes')![1]), 'charges fixes').toBe(courante!.totaux.fixedCharges);
  expect(centimes(dit(/^Dotations demandées/)![1]), 'dotations demandées').toBe(courante!.totaux.requested);
  expect(centimes(dit('Couvert par les revenus')![1]), 'couvert').toBe(courante!.totaux.funded);
  expect(centimes(dit(/^Marge/)![1]), 'marge').toBe(courante!.totaux.margin);
  const coussin = /coussin ([^)]*)\)/.exec(dit(/^Marge/)![0])?.[1];
  expect(coussin ? centimes(coussin) : 0, 'coussin').toBe(courante!.totaux.cushion);
  const decouvert = courante!.annonces.some(([code]) => code === 'principalOverdrawn');
  expect(dit('Non affecté sur le compte principal') !== undefined, 'non affecté négatif annoncé').toBe(decouvert);
  if (decouvert) expect(centimes(dit('Non affecté sur le compte principal')![1])).toBe(courante!.totaux.principalUnallocated);
  expect(resume.annonces).toEqual(courante!.annonces.map(([, message]) => message!.replace(/[\s\u00a0\u202f]+/g, ' ').trim()));
  expect(resume.manques.map(([nom, , montant]) => [nom, centimes(montant)])).toEqual(courante!.manques.map((m) => [m.nom, m.manque]));
  // « Tout est finançable » seulement si le Plan n'annonce rien.
  const rien = courante!.annonces.length === 0 && courante!.manques.length === 0;
  expect(resume.titre.includes('Tout est finançable'), `« Tout est finançable » : ${resume.titre}`).toBe(rien);
}

describe.skipIf(!navigateur)('#324 — l’assistant conduit au plan, et son résumé dit ce que dira le plan', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);

  afterAll(async () => {
    await site?.fermer();
  });

  describe('un projet vierge, accepté tel quel par les seuls boutons primaires', () => {
    let page: Page;
    const vus: { periode?: string; propositions?: string[]; coussin?: string; resume?: Awaited<ReturnType<typeof lireLeResume>>; plan?: Awaited<ReturnType<typeof lireLePlan>> } = {};

    beforeAll(async () => {
      page = await ouvrirLAssistant(site);
      await primaire(page, 'Commencer');
      // Étape Comptes : le coussin du compte principal.
      vus.coussin = await page.evaluate(() => (document.querySelector('.ligne-compte.principal input[aria-label="Coussin du compte principal"]') as HTMLInputElement | null)?.value ?? '');
      await primaire(page, 'Suivant');
      // Étape Revenus : le début de période.
      vus.periode = await page.evaluate(() => {
        const champ = [...document.querySelectorAll('label.f')].find((l) => (l.textContent ?? '').includes('La période commence le'));
        return (champ?.querySelector('input') as HTMLInputElement | null)?.value ?? '';
      });
      vus.propositions = await page.evaluate(() =>
        ([...document.querySelectorAll('main .propositions .prop .n')] as HTMLElement[]).map((n) => (n.textContent ?? '').replace(/[\s  ]+/g, ' ').trim()),
      );
      for (let i = 0; i < 6; i++) await primaire(page, 'Suivant');
      vus.resume = await lireLeResume(page);
      await primaire(page, 'Valider mon budget');
      await pause(300);
    }, 120_000);

    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 4] 1, 7 — la période commence le 28 dès l’arrivée sur l’étape Revenus, et « Suivre le mois calendaire » est seul proposé', () => {
      expect(vus.periode).toBe('28');
      expect(vus.propositions!.filter((p) => /mois calendaire|jour de ma paie/.test(p))).toEqual([expect.stringMatching(/^Suivre le mois calendaire/)]);
    });

    it('[niveau 4] 2 — l’étape Comptes montre le coussin de l’exemple, 600,00, sur la ligne du compte principal', () => {
      expect(vus.coussin).toBe('600,00');
    });

    it('[niveau 4] 5 — le plan du projet validé est celui de l’exemple privé de ses opérations, sur treize périodes', async () => {
      const projet = await projetConserve(page);
      const attendu = lirePlans(exempleSansOperations(), JOUR);
      const obtenu = lirePlans(projet, JOUR);
      expect(obtenu).toEqual(attendu);
    });

    it('[niveau 4] 5 — les chiffres que dit l’issue : la période en cours, la taxe foncière et le lissage proposé, l’ordre vers Livret A', async () => {
      const [courante] = lirePlans(await projetConserve(page), JOUR);
      expect(courante!.periode).toEqual(['2026-08-28', '2026-09-27']);
      expect(courante!.totaux).toMatchObject({ incomes: 420000, fixedCharges: 122000, requested: 230000, funded: 230000, margin: 68000, cushion: 60000 });
      expect(courante!.virements.find((v) => v.compte === 'Livret A')).toMatchObject({ permanent: 65000, ordre: { montant: 60000 } });
      expect(courante!.manques).toEqual([
        expect.objectContaining({ nom: 'Taxe foncière', date: '2026-10-15', manque: 10000, propose: [['2026-08-28', 5000], ['2026-09-28', 5000]] }),
      ]);
      expect(lirePlans(await projetConserve(page), JOUR)).toHaveLength(13);
    });

    it('[niveau 4] 3 — le résumé dit ce que dit le Plan de la période en cours une fois validé', async () => {
      await allerÀ(page, 'Plan');
      await pause(300);
      vus.plan = await lireLePlan(page);
      leResumeEstLePlan({ resume: vus.resume!, plan: vus.plan, projet: await projetConserve(page) });
    });
  });

  describe('le résumé dit ce que dira le Plan, sur des budgets qui ne se ressemblent pas', () => {
    it('[niveau 4] 4 — accepté tel quel, avec 1 500,00 € sur le compte principal : le non affecté négatif et l’échéance en manque y sont dits', async () => {
      const lu = await resumeEtPlan(site, [['Numéro ou IBAN', (p) => saisir(p, '.ligne-compte.principal > input.mt', 0, '1500,00')]]);
      expect(lu.plan.annonces.some((a) => a.includes('non affecté est négatif'))).toBe(true);
      expect(lu.plan.manques.map(([nom]) => nom)).toEqual(['Taxe foncière']);
      leResumeEstLePlan(lu);
    }, 120_000);

    it('[niveau 4] 4 — des revenus qui ne couvrent pas les dotations : chaque ligne non couverte et la marge négative y sont dites, pas « Tout est finançable »', async () => {
      const lu = await resumeEtPlan(site, [
        ["Rentrées d'argent", async (p) => { for (let i = 0; i < 4; i++) await saisir(p, 'main .ligne-flux > input.mt', i, '100,00'); }],
      ]);
      expect(lu.plan.annonces.some((a) => a.includes('n’est pas couverte') || a.includes("n'est pas couverte"))).toBe(true);
      expect(lu.resume.titre).not.toContain('Tout est finançable');
      leResumeEstLePlan(lu);
    }, 120_000);

    it('[niveau 4] 3 — un budget que le Plan n’annonce rien à regarder : le résumé dit « Tout est finançable »', async () => {
      const lu = await resumeEtPlan(site, [
        ['Dépenses à échéance', (p) => retirerLaTirelire(p, 'Taxe foncière')],
        // Sans la taxe foncière, le budget demande 550,00 € vers le Livret A : l'ordre permanent déjà en place les vire.
        ['Valider mon budget', (p) => saisir(p, 'input[aria-label="Ce que la banque vire"]', 0, '550,00')],
      ]);
      expect(lu.plan.annonces).toEqual([]);
      expect(lu.plan.manques).toEqual([]);
      expect(lu.resume.titre).toContain('Tout est finançable');
      leResumeEstLePlan(lu);
    }, 120_000);
  });
});
