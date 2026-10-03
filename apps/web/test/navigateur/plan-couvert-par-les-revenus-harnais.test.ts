/**
 * Harnais d'audit de #323, côté écran — ce que le Plan dit sans opération, à 375 px, sur le site construit :
 * ce que couvrent les revenus, et la période où aucun besoin n'est en vigueur. Points 1 à 3 du « Fait quand ».
 *
 * Retenus parmi les tests du codeur (`navigateur/plan-couvert-par-les-revenus.test.ts`, d'où ils sont
 * déplacés), puis complétés : « Virements à faire depuis le compte principal » reste au Plan (U2, à
 * surveiller) ; la période sans besoin et celle qui en a se lisent sur une même page, ouverte une fois ; la
 * phrase ajoutée se reconnaît à ce qu'elle dit — qu'aucune tirelire n'y est dotée —, pas à ses mots. Le montant
 * de la tuile, comparé à celui du Bilan, l'est déjà par `bilan-budget-harnais.test.ts` (#320), que le codeur a
 * adapté : il n'est pas répété ici. Les tests du codeur qui lisent le source de `Plan.svelte` ne sont pas
 * retenus : ils figent son balisage sans rien observer, et restent dans son fichier, au niveau 4.
 *
 * Niveaux (D83) :
 *  - 2 pour le point 1 : D29 veut que le plan dise ce que les revenus de la période couvrent ; une tuile qui
 *    parle de virement en est un cas faux, l'usage restant possible.
 *  - 3 pour le point 2 : le résultat reste juste (aucune tirelire dotée, 0,00 €), mais un cadre qui ne contient
 *    que son total le dit moins clairement qu'une phrase. I5 ne dit « ce qui le remplirait » que d'une base
 *    vide : ici le budget existe, c'est la période qui n'a aucun besoin.
 *  - 2 pour le point 3 : D85 est une décision, un texte qui tutoie en est un cas faux.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import { LEDGER_KEYS, LedgerStore, exampleLedger, periodsAround, type Ledger } from '@tirelire/core';
import { JOUR_DES_TESTS, allerÀ, cliquer, navigateur, nouvellePage, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const SQL = await initSqlJs();
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Ce que dit la phrase d'une période sans besoin : aucune tirelire n'y est dotée. */
const AUCUNE_TIRELIRE_DOTÉE = /aucune tirelire[^.]*dotée/i;
/** Les formes sûres du tutoiement : pronoms et possessifs de la deuxième personne du singulier, impératifs courants. */
const TUTOIEMENT = /\b(tu|te|toi|ton|ta|tes|tien|tienne)\b|\bt[’']|\b(Importe|saisis|Choisis|Ajoute|Crée|Regarde|Vérifie)\b/g;

/** L'exemple, chaque besoin ouvert au plus tôt au premier jour de la période qui suit `jour`. */
function besoinsDifférés(jour: string): { ledger: Ledger; vide: string; dotée: string } {
  const l = exampleLedger();
  const [courante, suivante] = periodsAround(l, jour, 0, 1);
  const needs = l.needs.map((n) => (!n.activeFrom || n.activeFrom < suivante!.start ? { ...n, activeFrom: suivante!.start } : n));
  return { ledger: { ...l, needs }, vide: courante!.label, dotée: suivante!.label };
}

/** Les tuiles, les titres, et ce qui suit le titre « Tirelires » : carte (avec son total) ou phrase. */
async function lire(page: Page) {
  return page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const tuiles = [...document.querySelectorAll('main .stats .stat')].map((s) => ({ k: t(s.querySelector('.k')), v: t(s.querySelector('.v')) }));
    const titres = [...document.querySelectorAll('main h2')].map(t);
    const h = [...document.querySelectorAll('main h2')].find((x) => t(x) === 'Tirelires');
    const après = h?.nextElementSibling ?? null;
    const total = après?.classList.contains('card') ? après.querySelector(':scope > .row.total') : null;
    return {
      tuiles,
      titres,
      aprèsTitre: { carte: !!après?.classList.contains('card'), texte: t(après) },
      total: total ? { k: t(total.querySelector('.label')), v: t(total.querySelector('.num')) } : null,
    };
  });
}

/** Importe un grand livre par le champ SQLite de Réglages, sur une page neuve, et ouvre le Plan. */
async function pageAvec(site: Site, l: Ledger): Promise<Page> {
  const store = await LedgerStore.create({ sqlJs: SQL, siteId: 'audit-323' });
  for (const clé of LEDGER_KEYS) for (const r of l[clé]) store.upsert(clé, r as never);
  for (const clé of ['periodStartDay', 'principalCushion', 'transferThreshold', 'orderRounding'] as const) store.setSetting(clé, l.settings[clé]);
  const octets = store.export();
  store.close();
  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-323-'));
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
    await pause(500);
    return page;
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

describe.skipIf(!navigateur)('#323 · le Plan sans opération, à 375 px', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  });
  afterAll(async () => {
    await site?.fermer();
  });

  it('[niveau 2] point 1 — la tuile et le total des tirelires disent « Couvert par les revenus », pour le même montant, sans « viré » ; les virements restent sous leur titre', async () => {
    const page = await ouvrirLExemple(site);
    try {
      const é = await lire(page);
      const tuile = é.tuiles.find((x) => x.k === 'Couvert par les revenus');
      expect(tuile, `tuiles : ${é.tuiles.map((x) => x.k).join(' | ')}`).toBeTruthy();
      expect(é.total?.k).toBe('Couvert par les revenus');
      expect(é.total?.v).toBe(tuile!.v);
      for (const x of [...é.tuiles.map((y) => y.k), é.total!.k]) expect(x).not.toMatch(/viré/i);
      expect(é.titres, `titres : ${é.titres.join(' | ')}`).toContain('Virements à faire depuis le compte principal');
    } finally {
      await page.close();
    }
  });

  describe('une période où aucun besoin n’est en vigueur, puis la suivante', () => {
    let page: Page;
    let vide: string;
    let dotée: string;
    beforeAll(async () => {
      const b = besoinsDifférés(JOUR_DES_TESTS.slice(0, 10));
      vide = b.vide;
      dotée = b.dotée;
      page = await pageAvec(site, b.ledger);
    });
    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 3] point 2 — la période sans besoin le dit sous « Tirelires », sans carte ; la suivante garde sa carte', async () => {
      expect(await cliquer(page, vide), `bouton « ${vide} » introuvable`).toBe(true);
      await pause(300);
      const a = await lire(page);
      expect(a.aprèsTitre.carte, `sous « Tirelires » : ${a.aprèsTitre.texte}`).toBe(false);
      expect(a.aprèsTitre.texte).toMatch(AUCUNE_TIRELIRE_DOTÉE);
      expect(await cliquer(page, dotée), `bouton « ${dotée} » introuvable`).toBe(true);
      await pause(300);
      const b = await lire(page);
      expect(b.aprèsTitre.carte, `sous « Tirelires » : ${b.aprèsTitre.texte}`).toBe(true);
      expect(b.aprèsTitre.texte).not.toMatch(AUCUNE_TIRELIRE_DOTÉE);
    });

    it('[niveau 2] point 3 — les textes que la tâche écrit, la phrase de la période sans besoin et l’intitulé de la tuile, vouvoient', async () => {
      expect(await cliquer(page, vide), `bouton « ${vide} » introuvable`).toBe(true);
      await pause(300);
      const a = await lire(page);
      const textes = [a.aprèsTitre.texte, ...a.tuiles.map((x) => x.k)];
      expect(a.aprèsTitre.texte, 'rien ne s’écrit sous « Tirelires »').not.toBe('');
      for (const texte of textes) expect(texte.match(TUTOIEMENT) ?? [], `le texte tutoie : « ${texte} »`).toEqual([]);
    });
  });
});
