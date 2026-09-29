/**
 * Harnais d'audit de #183 — « Le plan des périodes à venir suppose exécutés ses propres virements
 * (D52), contre le principe 1.3 ». Côté écran ; le calcul est gardé par
 * `packages/core/test/plan-sans-hypothese.test.ts`.
 *
 * Composé après le codage (auditeur.md, étape 2) : le codeur n'a écrit aucun test d'écran, ces tests
 * sont donc les miens. Ils ne reprennent du calcul que ce qui se lit à l'écran, et un point que le
 * cœur tranche seul (le point 1, le point 8) n'y revient pas.
 *
 * Tout se passe dans le navigateur, sur le site construit, à 375 px. Il lit l'écran Plan comme le
 * porteur le lit : les boutons de période, la légende de la période, les cartes « Virements à faire
 * depuis le compte principal », la liste « Tirelires ». Il ne fige aucun montant : ce que les
 * tirelires demandent est relu dans la liste « Tirelires » de la même page, ou recalculé par le
 * cœur à partir du même grand livre.
 *
 * Deux lectures de l'exemple, à des dates différentes, ne se comparent jamais entre elles : l'exemple
 * chargé par « Charger l'exemple » se lit au 6 septembre 2026 (`loadExample`) ; un fichier importé se
 * lit au jour de la page, le 20 septembre 2026 (`JOUR_DES_TESTS`).
 *
 * Chaque test reprend un point du « Fait quand » de l'issue, sous son numéro :
 *
 * 2 et 6. Une période à venir ne dit ni « soldes projetés » ni « virements supposés faits », et ne
 *    montre aucune position de compte (ni « à rapatrier », ni « tirelires non couvertes par le
 *    solde »).
 * 3 et 4. Pour chaque période à venir, le virement vers le Livret A vaut ce que ses tirelires
 *    demandent, lu sur la même page.
 * 6. Sans suivi (U1), le plan est complet et ne montre ni manquement ni état d'occurrence.
 * 5. Avec suivi des opérations, chaque occurrence attendue d'un virement permanent se lit sur son
 *    flux : pointée, attendue dans sa fenêtre, ou attendue non reçue. Sur un grand livre qui porte
 *    trois virements permanents, un par état. Le harnais ne suppose ni l'endroit ni les mots
 *    exacts : il lit la carte du compte, la ligne de « Attendus, non reçus » et la ligne du flux à
 *    l'écran Flux prévus, et cherche « pointé… », « attendu… », « non reçu… » (le genre et le
 *    nombre importent peu).
 * 7. Commencer à importer ne change ni les besoins ni les virements permanents proposés : le même
 *    grand livre, importé sans puis avec des lignes de relevé, affiche les mêmes cartes et les mêmes
 *    tirelires.
 *
 * Niveaux (D83) : tous à 1, comme dans le cœur — voir l'en-tête de l'autre fichier.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import {
  LEDGER_KEYS,
  LedgerStore,
  alive,
  applyMatch,
  applyPatchToLedger,
  computePlan,
  emptyLedger,
  euros,
  exampleLedger,
  missingFlows,
  normalizeLabel,
  proposeMatches,
  standingTransferFlow,
  type Ledger,
  type Operation,
} from '@tirelire/core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const SQL = await initSqlJs();
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const COMPTE = 'Livret A';
/** La date de lecture de l'exemple chargé (`loadExample`), et celle d'un fichier importé (`JOUR_DES_TESTS`). */
const LECTURE_EXEMPLE = '2026-09-06';
const LECTURE_FICHIER = '2026-09-20';
const PRINCIPAL = 'acc-principal';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Lire l'écran Plan
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** « 1 234,56 € » → 123456 centimes ; `NaN` sans montant. */
function centimes(texte: string): number {
  const m = texte.replace(/[\s  ]/g, '').match(/-?−?\d+(?:,\d{1,2})?/);
  if (!m) return NaN;
  const signe = m[0].startsWith('-') || m[0].startsWith('−') ? -1 : 1;
  const [e, c = '0'] = m[0].replace(/^[-−]/, '').split(',');
  return signe * (Number(e) * 100 + Number(c.padEnd(2, '0')));
}
const eur = (c: number) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
const résumé = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, 400);

/** Attend que l'écran Plan ait affiché ses tirelires (le titre « Tirelires » signe un plan calculé). */
async function attendreLePlan(page: Page): Promise<void> {
  const fin = Date.now() + 15_000;
  while (Date.now() < fin) {
    const prêt = await page.evaluate(() => [...document.querySelectorAll('main h2')].some((h) => h.textContent?.trim() === 'Tirelires')).catch(() => false);
    if (prêt) return;
    await pause(100);
  }
  throw new Error('le plan ne s’affiche pas');
}

/** Choisit une période par son bouton, et attend que l'écran l'ait prise. */
async function allerÀLaPériode(page: Page, période: string): Promise<void> {
  expect(await cliquer(page, période), `bouton de la période « ${période} » introuvable`).toBe(true);
  const fin = Date.now() + 5_000;
  while (Date.now() < fin) {
    const prise = await page.evaluate((p: string) => [...document.querySelectorAll('main .actions .btn.small.primary')].some((b) => b.textContent?.trim() === p), période);
    if (prise) return;
    await pause(100);
  }
  throw new Error(`la période « ${période} » n’est pas affichée`);
}

interface Écran {
  période: string;
  /** La légende sous les boutons de période : « Période du … au …, soldes au … ». */
  légende: string;
  /** Tout le texte de l'écran. */
  texte: string;
}

async function lireLÉcran(page: Page): Promise<Écran> {
  return page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement;
    const légende = [...main.querySelectorAll('p')].find((p) => /^\s*Période du/.test(p.textContent ?? ''))?.textContent ?? '';
    const période = [...main.querySelectorAll('.actions .btn.small.primary')].map((b) => b.textContent?.trim() ?? '').find((t) => /^\S+ \d{4}$/.test(t)) ?? '';
    return { période, légende: légende.replace(/\s+/g, ' ').trim(), texte: main.innerText };
  });
}

interface Carte {
  /** Le montant en gros, en tête de la carte : ce qu'il faut virer. */
  titre: number;
  lignes: Array<{ libellé: string; montant: number; texte: string }>;
  texte: string;
}

/** La carte « Virements à faire depuis le compte principal » d'un compte, telle qu'affichée. */
async function carte(page: Page, compte = COMPTE): Promise<Carte | null> {
  const lue = await page.evaluate((nom: string) => {
    const c = [...document.querySelectorAll('main .card')].find((x) => x.querySelector(':scope > .row strong')?.textContent?.trim() === nom);
    if (!c) return null;
    const rows = [...c.querySelectorAll(':scope > .row')];
    const valeur = (r: Element) => r.querySelector(':scope > .num, :scope > div:last-child')?.textContent?.trim() ?? '';
    return {
      titre: valeur(rows[0]!),
      lignes: rows.slice(1).map((r) => ({ libellé: (r.querySelector('.label')?.textContent ?? '').replace(/\s+/g, ' ').trim(), montant: valeur(r), texte: (r.textContent ?? '').replace(/\s+/g, ' ').trim() })),
      texte: (c as HTMLElement).innerText,
    };
  }, compte);
  if (!lue) return null;
  const signe = lue.titre.includes('←') ? -1 : 1;
  return { titre: signe * centimes(lue.titre), lignes: lue.lignes.map((l) => ({ ...l, montant: centimes(l.montant) })), texte: lue.texte };
}

interface Tirelire {
  nom: string;
  compte: string;
  /** Ce que la tirelire demande : « demandé » quand il diffère de la croisière, sinon la croisière. */
  demandé: number;
}

/** La liste « Tirelires » de l'écran : une ligne par besoin, avec le compte où il se place. */
async function tirelires(page: Page): Promise<{ lignes: Tirelire[]; texte: string }> {
  const lue = await page.evaluate(() => {
    const h = [...document.querySelectorAll('main h2')].find((x) => x.textContent?.trim() === 'Tirelires');
    const c = h?.nextElementSibling as HTMLElement | null | undefined;
    if (!c) return { rows: [], texte: '' };
    const rows = [...c.querySelectorAll(':scope > .row:not(.total)')].map((r) => {
      const subs = [...r.querySelectorAll('.sub')].map((s) => (s.textContent ?? '').replace(/\s+/g, ' ').trim());
      return { nom: (r.querySelector('.label strong')?.textContent ?? '').trim(), subs };
    });
    return { rows, texte: c.innerText };
  });
  const lignes: Tirelire[] = [];
  for (const r of lue.rows) {
    const compte = (r.subs[0] ?? '').split(' · ')[1]?.replace(/\s*\(réservé sur place\)$/, '').trim() ?? '';
    const chiffres = r.subs.find((s) => /croisière/.test(s)) ?? '';
    const demandé = chiffres.match(/demandé\s+([^·]+)/)?.[1] ?? chiffres.match(/croisière\s+([^·]+)/)?.[1] ?? '';
    lignes.push({ nom: r.nom, compte, demandé: centimes(demandé) });
  }
  return { lignes, texte: lue.texte };
}

/** Ce que les tirelires d'un compte demandent, lu dans la liste « Tirelires » de la page. */
async function demandeÀLÉcran(page: Page, compte = COMPTE): Promise<number> {
  return (await tirelires(page)).lignes.filter((l) => l.compte === compte).reduce((s, l) => s + l.demandé, 0);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Ce que l'issue retire, et ce qu'elle interdit
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Ce que D52 fait dire à la légende d'une période à venir, et que l'issue retire (principe 1.3). */
const SUPPOSITION = /soldes?\s+projet[ée]s?|suppos[ée]s?\s+(?:faits?|exécut[ée]s?)/i;
/** Une position de compte, dans une période dont aucun relevé n'existe. */
const POSITION_DE_COMPTE = /à\s+rapatrier|non\s+couvertes?\s+par\s+le\s+solde/i;
/** Un manquement, ou l'état d'une occurrence attendue : ce qu'un plan sans suivi ne montre pas. */
const SUIVI = /non\s+re[çc]u|manquement|attendu/i;

const OCTOBRE = 'octobre 2026';
const PÉRIODES_À_VENIR = [OCTOBRE, 'novembre 2026', 'décembre 2026'];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Un grand livre passé par le fichier importé
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Importe un grand livre par le champ « Importer un fichier… » de Réglages, sur une page neuve. */
async function pageAvec(site: Site, l: Ledger): Promise<Page> {
  const store = await LedgerStore.create({ sqlJs: SQL, siteId: 'audit-183' });
  for (const clé of LEDGER_KEYS) for (const r of l[clé]) store.upsert(clé, r as never);
  for (const clé of ['periodStartDay', 'principalCushion', 'transferThreshold', 'orderRounding'] as const) store.setSetting(clé, l.settings[clé]);
  const octets = store.export();
  store.close();

  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-183-'));
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
    await allerÀ(page, 'Plan');
    await attendreLePlan(page);
    return page;
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

/** Des lignes de relevé du compte principal, non classées : commencer à importer. */
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
  return { ...l, operations: [...l.operations, ligne('imp-1', '2026-09-02', 'CB CARREFOUR', -euros(45.3)), ligne('imp-2', '2026-09-03', 'CB BOULANGERIE', -euros(12.8))] };
}

/** Rapproche une ligne de relevé de l'occurrence d'un flux, comme l'import (D12). */
function pointer(l: Ledger, op: Operation): Ledger {
  const avec: Ledger = { ...l, operations: [...l.operations, op] };
  const proposition = proposeMatches(avec, '2026-07-01', '2026-11-30').find((p) => p.operationId === op.id);
  if (!proposition) throw new Error(`la ligne « ${op.label} » n’est pas reconnue comme l’occurrence d’un flux : le grand livre du harnais est faux`);
  return applyPatchToLedger(avec, applyMatch(avec, proposition));
}

/**
 * Un budget avec suivi des opérations et trois virements permanents, un par état d'occurrence,
 * lu le 20 septembre 2026 (fenêtre de cinq jours pour chacun) :
 * - « Livret A » : occurrence du 28 août, pointée par une ligne de relevé du 29 août ;
 * - « Livret B » : occurrence du 18 septembre, sans ligne ; sa fenêtre court jusqu'au 23 : attendue ;
 * - « Livret C » : occurrence du 3 septembre, sans ligne ; sa fenêtre s'est close le 8 : attendue non reçue.
 * Chaque flux ne commence qu'à son occurrence : aucune autre ne compte.
 */
function grandLivreAvecTroisVirements(): Ledger {
  const l = emptyLedger({ periodStartDay: 28, principalCushion: euros(300) });
  l.accounts.push({ id: PRINCIPAL, name: 'Compte courant', kind: 'principal', openingBalance: euros(3000), openingDate: '2026-08-27' });
  const livrets = [
    { clé: 'a', nom: 'Livret A', ancre: '2026-08-28' },
    { clé: 'b', nom: 'Livret B', ancre: '2026-09-18' },
    { clé: 'c', nom: 'Livret C', ancre: '2026-09-03' },
  ];
  for (const { clé, nom } of livrets) {
    l.accounts.push({ id: `liv-${clé}`, name: nom, kind: 'epargne', openingBalance: 0, openingDate: '2026-08-27' });
    l.tirelires.push({ id: `tir-${clé}`, name: `Projet ${clé.toUpperCase()}`, placement: [{ accountId: `liv-${clé}`, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28' });
    l.needs.push({ id: `bes-${clé}`, tirelireId: `tir-${clé}`, kind: 'goal', amount: euros(5000), monthlyAmount: euros(100), priority: 30 } as never);
  }
  l.plannedFlows.push({
    id: 'flux-salaire',
    name: 'Salaire',
    kind: 'income',
    amount: euros(2000),
    accountId: PRINCIPAL,
    periodicity: { interval: 1, unit: 'month', anchorDate: '2026-08-28' },
    dateWindowDays: 3,
    labelPattern: 'SALAIRE',
  } as never);

  const plan = computePlan(l, LECTURE_FICHIER);
  for (const { clé, ancre } of livrets) {
    const t = plan.transfers.find((x) => x.accountId === `liv-${clé}`);
    const flux = t && standingTransferFlow(plan, t, PRINCIPAL, `flux-vir-${clé}`, euros(100));
    if (!flux) throw new Error(`le budget du harnais ne demande rien vers le Livret ${clé.toUpperCase()}`);
    l.plannedFlows.push({ ...flux, activeFrom: ancre, periodicity: { ...flux.periodicity, anchorDate: ancre } });
  }

  const ligne = (id: string, date: string, libellé: string, montant: number): Operation => ({ id, accountId: PRINCIPAL, origin: 'imported', date, label: libellé, normalizedLabel: normalizeLabel(libellé), amount: montant, state: 'untreated' });
  let suivi = pointer(l, ligne('op-salaire', '2026-08-28', 'VIR SALAIRE ACME', euros(2000)));
  suivi = pointer(suivi, ligne('op-vir-a', '2026-08-29', 'VIR PERMANENT TIRELIRE LIVRET A', -euros(100)));

  // Les états attendus, vérifiés ici pour que le grand livre du harnais ne se trompe pas.
  const manque = missingFlows(suivi, '2026-07-01', LECTURE_FICHIER).map((m) => m.name);
  if (manque.join() !== 'Virement Livret C') throw new Error(`le grand livre du harnais devrait avoir un seul virement non reçu (Livret C) : ${manque.join(', ') || 'aucun'}`);
  if (!alive(suivi.operations).some((o) => o.id === 'op-vir-a' && o.plannedFlowId === 'flux-vir-a')) throw new Error('l’occurrence du Livret A n’est pas pointée dans le grand livre du harnais');
  return suivi;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Les points du « Fait quand »
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe.skipIf(!navigateur)('#183 · le plan sans hypothèse, à 375 px', () => {
  let site: Site;
  const ouvertes: Page[] = [];

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);
  afterAll(async () => {
    for (const p of ouvertes) await p.close().catch(() => {});
    await site?.fermer();
  });

  // ---- l'exemple chargé, lu au 6 septembre 2026 ------------------------------------------------

  describe('l’exemple, sans suivi des opérations', () => {
    let page: Page;
    beforeAll(async () => {
      page = await ouvrirLExemple(site);
      ouvertes.push(page);
      page.on('dialog', (d) => void d.accept());
    });

    // Points 2 et 6 (ni supposition)
    it('[niveau 1] points 2 et 6 — aucune période à venir ne dit « soldes projetés » ni « virements supposés faits », ni ne montre de position de compte', async () => {
      for (const période of PÉRIODES_À_VENIR) {
        await allerÀLaPériode(page, période);
        const écran = await lireLÉcran(page);
        expect(écran.légende, `« ${période} » : la légende d’une période à venir suppose des virements exécutés (D52) : « ${écran.légende} »`).not.toMatch(SUPPOSITION);
        expect(écran.texte, `une position de compte apparaît dans « ${période} », où aucun relevé n’existe`).not.toMatch(POSITION_DE_COMPTE);
        expect(await carte(page), `carte « ${COMPTE} » absente en ${période} : un plan sans hypothèse reste complet`).not.toBeNull();
      }
    });

    // Points 3 et 4
    it('[niveau 1] points 3 et 4 — pour chaque période à venir, le virement vers le Livret A vaut ce que ses tirelires demandent, lu sur la même page', async () => {
      for (const période of PÉRIODES_À_VENIR) {
        await allerÀLaPériode(page, période);
        const c = await carte(page);
        expect(c, `carte « ${COMPTE} » absente en ${période}`).not.toBeNull();
        const demandé = await demandeÀLÉcran(page);
        expect(demandé, `aucune tirelire du ${COMPTE} ne demande rien en ${période} : le harnais lit mal la liste « Tirelires »`).toBeGreaterThan(0);
        expect(
          c!.titre,
          `${période} : la carte du ${COMPTE} dit de virer ${eur(c!.titre)} pour ${eur(demandé)} demandés par ses tirelires (liste « Tirelires » de la même page) — ${résumé(c!.texte)}`,
        ).toBe(demandé);
        // Le même montant, recalculé par le cœur sur le même grand livre.
        const p = computePlan(exampleLedger(), periodStart(période), LECTURE_EXEMPLE);
        expect(demandé).toBe(p.lines.filter((l) => l.accountId === 'acc-livret').reduce((s, l) => s + l.requested, 0));
      }
    });

    // Point 6 (ni manquement)
    it('[niveau 1] point 6 — sans suivi des opérations, le plan ne montre, en aucune période, ni manquement ni état d’occurrence', async () => {
      for (const période of ['septembre 2026', ...PÉRIODES_À_VENIR]) {
        await allerÀLaPériode(page, période);
        const écran = await lireLÉcran(page);
        expect(écran.texte, `sans opération importée, « ${période} » parle de suivi`).not.toMatch(SUIVI);
        expect(await carte(page), `carte « ${COMPTE} » absente en ${période} : le plan sans suivi est complet`).not.toBeNull();
      }
    });
  });

  // ---- point 5 : trois virements permanents, un par état -------------------------------------

  describe('un budget avec suivi des opérations et trois virements permanents', () => {
    let page: Page;
    beforeAll(async () => {
      page = await pageAvec(site, grandLivreAvecTroisVirements());
      ouvertes.push(page);
      // L'écran se lit au 20 septembre, dans la période de septembre : le grand livre du harnais est celui qu'on croit.
      const écran = await lireLÉcran(page);
      expect(écran.période).toBe('septembre 2026');
      expect(écran.légende).toMatch(/soldes au 20 sept/i);
    });

    /**
     * Ce que l'écran dit d'un compte ou de son virement : sa carte, et chaque ligne qui le nomme,
     * chacune précédée, sur le Plan, du titre de son bloc (« Attendus, non reçus » dit l'état de ses
     * lignes). Les titres de l'écran Flux prévus rangent les flux par nature (« … attendus ») et ne
     * disent rien d'un état : ils ne comptent pas. Un bloc qui réunit les lignes de plusieurs comptes
     * (l'écran Flux prévus en a un) ne dit rien de l'un d'eux : seule la plus petite ligne compte.
     */
    async function passages(compte: string, surLePlan = true): Promise<string[]> {
      return page.evaluate((nom: string, titres: boolean) => {
        const dit = (el: Element) => {
          const mots: string[] = [];
          const marche = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = marche.nextNode(); n; n = marche.nextNode()) mots.push(n.textContent ?? '');
          return mots.join(' ').replace(/\s+/g, ' ').trim();
        };
        const titre = (el: Element) => {
          const h = el.closest('.card')?.previousElementSibling;
          return titres && h && h.tagName === 'H2' ? `${dit(h)} — ` : '';
        };
        const sorties: string[] = [];
        // La carte du compte n'existe que sur le Plan ; à l'écran Flux prévus, la première ligne d'un
        // bloc porte le nom d'un flux, et le bloc réunit tous ceux de sa nature.
        if (titres) {
          for (const c of document.querySelectorAll('main .card')) {
            if (c.querySelector(':scope > .row strong')?.textContent?.trim() === nom) sorties.push(titre(c.firstElementChild ?? c) + dit(c));
          }
        }
        // Les lignes seulement, et les plus petites : un bloc qui réunit les lignes de plusieurs
        // comptes ne dit rien de l'un d'eux en particulier.
        const lignes = [...document.querySelectorAll('main .row, main li, main tr')].filter((r) => dit(r).includes(nom));
        for (const r of lignes) {
          if (lignes.some((autre) => autre !== r && r.contains(autre))) continue;
          sorties.push(titre(r) + dit(r));
        }
        return sorties;
      }, compte, surLePlan);
    }

    /** Les états qu'un ensemble de passages dit. Le genre et le nombre importent peu. */
    function états(textes: string[]) {
      const tout = textes.join(' | ');
      return {
        pointée: /(?:point|rapproch)[ée]e?s?(?![a-zé])/i.test(tout),
        attendue: /attendu(?:e|s|es)?(?![a-zé])/i.test(tout.replace(/attendus?,?\s+non\s+re[çc]us?/gi, '')),
        nonReçue: /non\s+re[çc]u(?:e|s|es)?(?![a-zé])/i.test(tout),
      };
    }

    async function lecture(compte: string) {
      const surLePlan = await passages(compte);
      await allerÀ(page, 'Plus');
      await cliquer(page, 'Flux prévus');
      await pause(300);
      const surLesFlux = await passages(`Virement ${compte}`, false);
      await allerÀ(page, 'Plan');
      await attendreLePlan(page);
      return { surLePlan, surLesFlux, ...états([...surLePlan, ...surLesFlux]) };
    }

    // Le point 5 dit « se lit sur son flux » : l'état de chaque occurrence se lit sur la ligne du flux
    // (écran Flux prévus). Le manquement se voit en plus depuis le plan de sa période.
    it('[niveau 1] point 5 — le virement pointé se lit « pointé » sur son flux, et n’est pas un manquement', async () => {
      const v = await lecture('Livret A');
      expect(états(v.surLesFlux).pointée, `rien ne dit, sur le flux, que l’occurrence du 28 août du « Virement Livret A » est pointée : ${résumé(v.surLesFlux.join(' | '))}`).toBe(true);
      expect(v.nonReçue, 'un virement pointé ne remonte pas en « attendu, non reçu »').toBe(false);
    });

    it('[niveau 1] point 5 — le virement dont la fenêtre est ouverte se lit « attendu » sur son flux, sans être un manquement', async () => {
      const v = await lecture('Livret B');
      expect(états(v.surLesFlux).attendue, `rien ne dit, sur le flux, que l’occurrence du 18 septembre du « Virement Livret B » est attendue dans sa fenêtre (jusqu’au 23) : ${résumé(v.surLesFlux.join(' | '))}`).toBe(true);
      expect(v.nonReçue, 'sa fenêtre est ouverte : ce n’est pas encore un manquement').toBe(false);
      expect(v.pointée, 'aucune ligne de relevé ne l’a rapproché').toBe(false);
    });

    it('[niveau 1] point 5 — le virement attendu non reçu se lit « non reçu » sur son flux, et se voit depuis le plan de sa période', async () => {
      const v = await lecture('Livret C');
      expect(états(v.surLesFlux).nonReçue, `le « Virement Livret C » du 3 septembre, fenêtre close le 8, n’est pas dit non reçu sur son flux : ${résumé(v.surLesFlux.join(' | '))}`).toBe(true);
      // Depuis le plan de sa période, sans avoir à changer d'écran.
      expect(états(v.surLePlan).nonReçue, 'le manquement se voit depuis le plan de septembre, sans ouvrir les flux').toBe(true);
      expect(v.pointée).toBe(false);
    });
  });

  // ---- point 7 : commencer à importer --------------------------------------------------------

  describe('commencer à importer', () => {
    it('[niveau 1] point 7 — le même grand livre, avec des lignes de relevé en plus, affiche les mêmes virements permanents et les mêmes tirelires', async () => {
      const sans = await pageAvec(site, exampleLedger());
      const avec = await pageAvec(site, avecImport(exampleLedger()));
      ouvertes.push(sans, avec);
      for (const période of ['septembre 2026', ...PÉRIODES_À_VENIR]) {
        await allerÀLaPériode(sans, période);
        await allerÀLaPériode(avec, période);
        const a = await carte(sans);
        const b = await carte(avec);
        expect(a, `carte « ${COMPTE} » absente sans import`).not.toBeNull();
        expect(b, `carte « ${COMPTE} » absente avec import`).not.toBeNull();
        const permanent = (c: Carte) => c.lignes.find((l) => /^Virement permanent/.test(l.libellé))?.montant;
        expect({ période, permanent: permanent(b!) }, `${période} : le virement permanent proposé change avec l’import`).toEqual({ période, permanent: permanent(a!) });
        const ta = await tirelires(sans);
        const tb = await tirelires(avec);
        expect({ période, tirelires: tb.texte }, `${période} : les tirelires changent avec l’import`).toEqual({ période, tirelires: ta.texte });
      }
    });
  });
});

/** Premier jour d'une période de l'exemple, par son libellé (le jour de paie est le 28). */
function periodStart(période: string): string {
  const mois: Record<string, string> = { 'septembre 2026': '2026-08-28', 'octobre 2026': '2026-09-28', 'novembre 2026': '2026-10-28', 'décembre 2026': '2026-11-28' };
  const début = mois[période];
  if (!début) throw new Error(`période inconnue : ${période}`);
  return début;
}
