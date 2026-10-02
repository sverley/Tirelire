/**
 * Harnais d'audit de #306, côté écran — ce que le Plan, l'écran Opérations et l'écran Flux prévus
 * font de la reprise (points 2, 4 et 5 du « Fait quand »). Le calcul, l'import, l'état et la
 * ventilation d'une reprise, la correction et le masquage, le format et le plan de l'exemple sont
 * gardés dans le cœur (`packages/core/test/reprise-harnais.test.ts`) ; ici, seulement ce qui se lit à
 * l'écran et ce que l'écran écrit.
 *
 * Écrits par l'auditeur : le codeur n'avait aucun test d'écran. Les parcours partent de l'exemple
 * chargé (« Charger l'exemple », lu au 6 septembre 2026), dont octobre 2026 est la première période
 * à venir et dont le salaire du 28 août a été repris par une opération du relevé. Les montants
 * attendus sont relus dans le cœur, sur le même exemple, et non figés ici.
 *
 * Le point 9 (ajouté le 02/10) part d'un grand livre où une opération du relevé reprend une saisie :
 * l'exemple n'a aucune opération du relevé. Il est écrit ici, par le cœur, puis importé par Réglages.
 *
 * Niveaux (D83) : 1 pour ce que U1 promet à l'écran — corriger une opération prévue, ou la masquer,
 * depuis le détail d'un solde prévu, et la retrouver en retirant la saisie (point 2) ; 3 pour ce que
 * l'écran des opérations en dit, ce qu'une opération reprend et l'écart, et la reprise qui se défait
 * (point 4) ; 2 pour la seule sélection du flux à l'écran Flux prévus et la liste des automatismes
 * (point 5) ; 1 encore pour ce que l'écran répond quand on supprime une saisie qu'une opération
 * reprend, depuis l'écran Opérations et l'écran Saisie (point 9) : le mouvement ne compte pas deux
 * fois. Le Plan n'offre pas cette suppression : voir la note du `describe`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import {
  applyPatchToLedger,
  computePlan,
  correctPlannedOperation,
  euros,
  exampleLedger,
  formatCents,
  LEDGER_KEYS,
  LedgerStore,
  resumeEntry,
  undoResumption,
  type Ledger,
  type Operation,
} from '@tirelire/core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));
/** Un montant tel que l'écran l'écrit, espaces normalisées comme à la lecture. */
const fmt = (c: number) => formatCents(c).replace(/\s+/g, ' ');
const LECTURE = '2026-09-06';
const OCTOBRE = 'octobre 2026';
const DÉBUT_OCTOBRE = '2026-09-28';
const COMPTE = 'Compte courant';

/** Ce que le cœur calcule pour le compte courant en octobre, l'exemple éventuellement corrigé. */
const prévu = (corrige?: (l: ReturnType<typeof exampleLedger>) => ReturnType<typeof exampleLedger>) => {
  const l = corrige ? corrige(exampleLedger()) : exampleLedger();
  return computePlan(l, DÉBUT_OCTOBRE, LECTURE).forecast!.accounts.find((a) => a.name === COMPTE)!;
};
/** L'opération prévue du salaire, dans le détail d'octobre : elle se corrige ou se masque. */
const salaire = () => prévu().movements.find((m) => m.flowId === 'flow-salaire')!;

/** Le solde prévu que l'écran donne au compte courant, dans le bloc « Soldes prévus ». */
async function soldePrévu(page: Page): Promise<string | null> {
  return page.evaluate((nom: string) => {
    const texte = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const h2 = [...document.querySelectorAll('main h2')].find((h) => /^Soldes prévus/.test(texte(h)));
    for (let el = h2?.nextElementSibling ?? null; el; el = el.nextElementSibling) {
      for (const r of el.querySelectorAll(':scope > .row')) {
        if (texte(r.querySelector('.label')?.firstChild as Element | null) === nom) return texte(r.querySelector(':scope > div:last-child'));
      }
    }
    return null;
  }, COMPTE);
}

/** Déplie ou replie le détail du compte courant. */
async function déplier(page: Page): Promise<boolean> {
  const fait = await page.evaluate((nom: string) => {
    const texte = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const h2 = [...document.querySelectorAll('main h2')].find((h) => /^Soldes prévus/.test(texte(h)));
    for (let el = h2?.nextElementSibling ?? null; el; el = el.nextElementSibling) {
      for (const r of el.querySelectorAll(':scope > .row')) {
        if (texte(r.querySelector('.label')?.firstChild as Element | null) !== nom) continue;
        const b = r.nextElementSibling?.querySelector('button');
        if (!b) return false;
        (b as HTMLButtonElement).click();
        return true;
      }
    }
    return false;
  }, COMPTE);
  await pause(150);
  return fait;
}

interface Mouvement {
  libellé: string;
  sous: string;
  boutons: string[];
}

/** Les opérations du détail déplié : leur libellé, ce qui s'en dit, et les boutons qui les suivent. */
async function mouvements(page: Page): Promise<Mouvement[]> {
  return page.evaluate(() => {
    const texte = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('main .orders > .row')].map((r) => {
      const suite = r.nextElementSibling;
      return {
        libellé: texte(r.querySelector('.label')?.firstChild as Element | null),
        sous: [...r.querySelectorAll('.label > .sub')].map(texte).join(' | '),
        boutons: suite?.classList.contains('actions') ? [...suite.querySelectorAll('button')].map(texte) : [],
      };
    });
  });
}

/** Clique le bouton `bouton` qui suit l'opération `libellé` du détail, dont ce qui s'en dit contient `sous`. */
async function agir(page: Page, libellé: string, sous: RegExp, bouton: string): Promise<boolean> {
  const fait = await page.evaluate(
    (l: string, motif: string, b: string) => {
      const texte = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
      for (const r of document.querySelectorAll('main .orders > .row')) {
        if (texte(r.querySelector('.label')?.firstChild as Element | null) !== l) continue;
        if (!new RegExp(motif).test([...r.querySelectorAll('.label > .sub')].map(texte).join(' | '))) continue;
        const cible = [...(r.nextElementSibling?.classList.contains('actions') ? r.nextElementSibling.querySelectorAll('button') : [])].find((x) => texte(x) === b);
        if (!cible) return false;
        (cible as HTMLButtonElement).click();
        return true;
      }
      return false;
    },
    libellé,
    sous.source,
    bouton,
  );
  await pause(200);
  return fait;
}

/** Renseigne le montant du panneau « Corriger l'opération prévue », puis l'enregistre. */
async function corriger(page: Page, montant: string): Promise<boolean> {
  const fait = await page.evaluate((m: string) => {
    const f = document.querySelector('main form.edit.attached');
    const champ = f?.querySelector('input') as HTMLInputElement | null;
    const envoyer = [...(f?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === 'Enregistrer') as HTMLButtonElement | undefined;
    if (!champ || !envoyer) return false;
    champ.value = m;
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    envoyer.click();
    return true;
  }, montant);
  await pause(250);
  return fait;
}

/** Les textes d'une ligne d'opération de l'écran Opérations qui contient `motif`. */
async function ligneOpération(page: Page, motif: RegExp): Promise<string | null> {
  return page.evaluate((source: string) => {
    const texte = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const re = new RegExp(source);
    const lignes = [...document.querySelectorAll('main .row')].filter((r) => re.test(texte(r)));
    return lignes.length ? texte(lignes[lignes.length - 1]) : null;
  }, motif.source);
}

describe.skipIf(!navigateur)('#306 · la reprise à l’écran, à 375 px', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);
  afterAll(async () => {
    await site?.fermer();
  });

  it('[niveau 1] point 2 — dans le détail d’un solde prévu, l’utilisateur corrige une opération prévue ou la masque, et retire sa saisie pour la faire compter de nouveau', async () => {
    const page = await ouvrirLExemple(site);
    try {
      const mv = salaire();
      const initial = fmt(prévu().end);
      const corrigé = fmt(prévu((l) => applyPatchToLedger(l, correctPlannedOperation(l, 'flow-salaire', mv.date, euros(3000), mv.date))).end);
      const masqué = fmt(prévu((l) => applyPatchToLedger(l, correctPlannedOperation(l, 'flow-salaire', mv.date, 0, mv.date))).end);
      expect(new Set([initial, corrigé, masqué]).size, 'corriger ou masquer le salaire ne change rien : ce test ne vérifie rien').toBe(3);

      expect(await cliquer(page, OCTOBRE)).toBe(true);
      await pause(200);
      expect(await soldePrévu(page), 'le solde prévu d’octobre n’est pas celui du cœur').toBe(initial);
      expect(await déplier(page)).toBe(true);
      const avant = (await mouvements(page)).find((m) => m.libellé === mv.label && /prévue par ce flux/.test(m.sous));
      expect(avant, `l’opération prévue « ${mv.label} » n’est pas dans le détail`).toBeDefined();
      expect(avant!.boutons, 'une opération prévue se corrige et se masque depuis le détail').toEqual(expect.arrayContaining(['Corriger', 'Masquer']));

      // Corriger : elle vaudra 3 000 €, à la même date. Le solde prévu est celui que le cœur calcule.
      expect(await agir(page, mv.label, /prévue par ce flux/, 'Corriger')).toBe(true);
      expect(await corriger(page, '3000')).toBe(true);
      expect(await soldePrévu(page), 'après la correction, le solde prévu n’est pas celui du cœur').toBe(corrigé);
      const correction = (await mouvements(page)).find((m) => /corrige l’opération prévue/.test(m.sous));
      expect(correction, 'la saisie ne dit pas qu’elle corrige l’opération prévue').toBeDefined();
      expect(correction!.boutons).toContain('Retirer la correction');

      // Retirer la correction : l'opération prévue compte de nouveau.
      expect(await agir(page, correction!.libellé, /corrige l’opération prévue/, 'Retirer la correction')).toBe(true);
      expect(await soldePrévu(page), 'retirer la correction ne rend pas le solde prévu d’origine').toBe(initial);

      // Masquer : elle n'aura pas lieu. Retirer cette saisie la fait compter de nouveau.
      expect(await agir(page, mv.label, /prévue par ce flux/, 'Masquer')).toBe(true);
      expect(await soldePrévu(page), 'après le masquage, le solde prévu n’est pas celui du cœur').toBe(masqué);
      const masque = (await mouvements(page)).find((m) => /masque l’opération prévue/.test(m.sous));
      expect(masque, 'la saisie de zéro ne dit pas qu’elle masque l’opération prévue').toBeDefined();
      expect(masque!.boutons).toContain('Rétablir l’opération prévue');
      expect(await agir(page, masque!.libellé, /masque l’opération prévue/, 'Rétablir l’opération prévue')).toBe(true);
      expect(await soldePrévu(page), 'rétablir l’opération prévue ne rend pas le solde prévu d’origine').toBe(initial);
    } finally {
      await page.close().catch(() => {});
    }
  });

  it('[niveau 3] point 4 — l’écran des opérations dit ce qu’une opération reprend et l’écart de montant, et la reprise se défait', async () => {
    const page = await ouvrirLExemple(site);
    try {
      await allerÀ(page, 'Opérations');
      await pause(300);
      // L'écran s'ouvre sur les opérations non traitées : le salaire d'août est rapproché.
      const filtré = await page.evaluate(() => {
        const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => (o.textContent ?? '').trim() === 'Non traitées')) as HTMLSelectElement | undefined;
        const o = s && [...s.options].find((x) => (x.textContent ?? '').trim() === 'Toutes');
        if (!s || !o) return false;
        s.value = o.value;
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      });
      expect(filtré, 'l’écran Opérations n’offre pas de lire toutes les opérations').toBe(true);
      await pause(300);
      const reprise = /reprend l’opération prévue « Salaire » du/;
      const ligne = await ligneOpération(page, reprise);
      expect(ligne, 'aucune ligne ne dit que le salaire d’août reprend l’opération prévue du salaire').not.toBeNull();
      // L'exemple : 3 400 € reçus pour 3 400 € prévus.
      expect(ligne).toMatch(/écart nul/);

      // Ouvrir la ligne, défaire la reprise : elle ne dit plus rien de tel.
      const ouvert = await page.evaluate(() => {
        const bouton = [...document.querySelectorAll('main .row button.label')].find((b) => /reprend l’opération prévue « Salaire » du/.test((b.textContent ?? '').replace(/\s+/g, ' ')));
        (bouton as HTMLButtonElement | undefined)?.click();
        return !!bouton;
      });
      expect(ouvert).toBe(true);
      await pause(200);
      expect(await cliquer(page, 'Défaire la reprise'), 'le panneau de l’opération n’offre pas de défaire la reprise').toBe(true);
      await pause(300);
      expect(await ligneOpération(page, reprise), 'la reprise défaite se lit encore à l’écran').toBeNull();
    } finally {
      await page.close().catch(() => {});
    }
  });

  it('[niveau 2] point 5 — un flux n’a qu’une sélection : un seul jeu de critères à l’écran Flux prévus, aucun automatisme engendré, aucun dans la liste des automatismes', async () => {
    const page = await ouvrirLExemple(site);
    try {
      const automatismes = async () => {
        await allerÀ(page, 'Bilan');
        await pause(200);
        return page.evaluate(() => {
          const h = [...document.querySelectorAll('h2')].find((x) => (x.textContent ?? '').trim() === 'Automatismes');
          let e = h?.nextElementSibling ?? null;
          while (e && !e.classList.contains('card')) e = e.nextElementSibling;
          return e ? [...e.querySelectorAll(':scope > .row')].map((r) => (r.textContent ?? '').replace(/\s+/g, ' ').trim()) : null;
        });
      };
      const avant = await automatismes();
      expect(avant, 'le Bilan ne montre pas sa liste d’automatismes').not.toBeNull();
      expect(avant!.filter((t) => /issu d’un flux/.test(t))).toEqual([]);

      await allerÀ(page, 'Plus');
      await cliquer(page, 'Flux prévus');
      await pause(300);
      const modifié = await page.evaluate(() => {
        const b = [...document.querySelectorAll('main button')].find((x) => (x.textContent ?? '').trim() === 'Modifier');
        (b as HTMLButtonElement | undefined)?.click();
        return !!b;
      });
      expect(modifié, 'aucun flux ne se modifie à l’écran Flux prévus').toBe(true);
      await pause(250);
      const champs = await page.evaluate(() => [...document.querySelectorAll('main form.edit label')].map((l) => (l.textContent ?? '').replace(/\s+/g, ' ').trim()));
      expect(champs.length, 'le formulaire du flux ne s’est pas ouvert').toBeGreaterThan(0);
      // Un seul jeu de critères : le compte, le motif de libellé, la tolérance de montant, la fenêtre.
      expect(champs.filter((c) => /^Motif de libellé/.test(c))).toHaveLength(1);
      expect(champs.filter((c) => /^Tolérance de montant/.test(c))).toHaveLength(2);
      expect(champs.filter((c) => /^Fenêtre/.test(c))).toHaveLength(1);
      expect(champs.filter((c) => /automatisme/i.test(c)), 'le flux propose encore de créer un automatisme à part').toEqual([]);
      expect(champs.some((c) => /^Verrouiller les opérations que ce flux reprend/.test(c))).toBe(true);

      // Enregistrer le flux, verrouillage demandé : aucun automatisme de plus.
      const enregistré = await page.evaluate(() => {
        const f = document.querySelector('main form.edit');
        const case_ = [...(f?.querySelectorAll('label.check') ?? [])].find((l) => /^Verrouiller les opérations/.test((l.textContent ?? '').trim()))?.querySelector('input') as HTMLInputElement | null;
        if (case_ && !case_.checked) case_.click();
        const b = [...(f?.querySelectorAll('button') ?? [])].find((x) => (x.textContent ?? '').trim() === 'Enregistrer') as HTMLButtonElement | undefined;
        b?.click();
        return !!b;
      });
      expect(enregistré).toBe(true);
      await pause(300);
      expect(await automatismes(), 'enregistrer un flux a engendré un automatisme').toEqual(avant);
    } finally {
      await page.close().catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// Point 9 : supprimer une saisie qu'une opération du relevé reprend
// ---------------------------------------------------------------------------

const SQL = await initSqlJs();
const LECTURE_FICHIER = '2026-09-20';
const PRINCIPAL = 'acc-principal';

/**
 * L'exemple, dont le salaire d'octobre est corrigé à 3 000 € par une saisie, que reprend une
 * opération du relevé. Rend le grand livre, la saisie et l'opération du relevé.
 */
function avecReprise(): { l: Ledger; saisie: Operation; relevé: Operation } {
  let l = exampleLedger();
  const mv = computePlan(l, DÉBUT_OCTOBRE, LECTURE_FICHIER).forecast!.accounts.find((a) => a.name === COMPTE)!.movements.find((m) => m.flowId === 'flow-salaire')!;
  l = applyPatchToLedger(l, correctPlannedOperation(l, 'flow-salaire', mv.date, euros(3000), mv.date));
  const saisie = l.operations.find((o) => o.origin === 'manual' && o.plannedFlowId === 'flow-salaire' && o.plannedDate === mv.date)!;
  const relevé: Operation = { id: 'releve-salaire', accountId: PRINCIPAL, origin: 'imported', date: mv.date, label: 'VIR SALAIRE OCTOBRE', normalizedLabel: 'VIR SALAIRE OCTOBRE', amount: euros(3100), state: 'untreated' };
  l = { ...l, operations: [...l.operations, relevé] };
  l = applyPatchToLedger(l, resumeEntry(l, relevé.id, saisie.id));
  return { l, saisie, relevé: l.operations.find((o) => o.id === relevé.id)! };
}

/** Le solde prévu du compte courant en octobre, que le cœur calcule au jour de la page. */
const soldeDuCœur = (l: Ledger) => fmt(computePlan(l, DÉBUT_OCTOBRE, LECTURE_FICHIER).forecast!.accounts.find((a) => a.name === COMPTE)!.end);

/** Ce même grand livre, la reprise défaite puis la saisie supprimée. */
function repriseDéfaiteSaisieSupprimée(l: Ledger, saisie: Operation, relevé: Operation): Ledger {
  const défaite = applyPatchToLedger(l, undoResumption(l, relevé.id));
  return { ...défaite, operations: défaite.operations.map((o) => (o.id === saisie.id ? { ...o, deletedAt: '2026-09-20T12:00:00.000Z' } : o)) };
}

/** Une page neuve sur ce grand livre, importé par le champ « Importer un fichier… » de Réglages. */
async function pageAvec(site: Site, l: Ledger, dialogues: Dialogues): Promise<Page> {
  const store = await LedgerStore.create({ sqlJs: SQL, siteId: 'audit-306' });
  for (const clé of LEDGER_KEYS) for (const r of l[clé]) store.upsert(clé, r as never);
  for (const clé of ['periodStartDay', 'principalCushion', 'transferThreshold', 'orderRounding'] as const) store.setSetting(clé, l.settings[clé]);
  const octets = store.export();
  store.close();
  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-306-'));
  const chemin = join(dossier, 'grand-livre.sqlite');
  writeFileSync(chemin, octets);
  try {
    const page = await nouvellePage(site);
    // Le dialogue de l'import se confirme ; ensuite, ce sont ceux que l'écran pose qu'on note et qu'on tranche.
    page.on('dialog', (d) => {
      if (!dialogues.actif) return void d.accept();
      dialogues.messages.push(d.message());
      return void (dialogues.réponse === 'ok' ? d.accept() : d.dismiss());
    });
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
    dialogues.actif = true;
    await allerÀ(page, 'Plan');
    const prêt = Date.now() + 15_000;
    while (Date.now() < prêt && !(await page.evaluate(() => [...document.querySelectorAll('main h2')].some((h) => h.textContent?.trim() === 'Tirelires')).catch(() => false))) await pause(100);
    return page;
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

/** L'écran Opérations, sur toutes les opérations (il s'ouvre sur les non traitées). */
async function toutesLesOpérations(page: Page): Promise<void> {
  await allerÀ(page, 'Opérations');
  await pause(300);
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => (o.textContent ?? '').trim() === 'Non traitées')) as HTMLSelectElement | undefined;
    const o = s && [...s.options].find((x) => (x.textContent ?? '').trim() === 'Toutes');
    if (s && o) {
      s.value = o.value;
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await pause(300);
}

interface Dialogues {
  actif: boolean;
  réponse: 'ok' | 'annuler';
  messages: string[];
}
const dialogues = (): Dialogues => ({ actif: false, réponse: 'annuler', messages: [] });

/** Le solde prévu d'octobre, lu sur le Plan. */
async function soldeAuPlan(page: Page): Promise<string | null> {
  await allerÀ(page, 'Plan');
  expect(await cliquer(page, OCTOBRE), 'bouton de la période octobre 2026 introuvable').toBe(true);
  await pause(250);
  return soldePrévu(page);
}

describe.skipIf(!navigateur)('#306 · point 9 — une saisie qu’une opération reprend ne se supprime pas tant que la reprise tient, à 375 px', () => {
  // Pas d'épreuve depuis le Plan : une saisie reprise ne compte plus, le détail d'un solde prévu n'y liste
  // alors que l'opération du relevé, sans bouton ; « Retirer la correction » n'y est pas offert pour elle.
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);
  afterAll(async () => {
    await site?.fermer();
  });

  /** Le décor a un sens : la reprise tenue et la reprise défaite ne donnent pas le même solde prévu. */
  function décor() {
    const { l, saisie, relevé } = avecReprise();
    const tenue = soldeDuCœur(l);
    const défaite = soldeDuCœur(repriseDéfaiteSaisieSupprimée(l, saisie, relevé));
    expect(tenue, 'défaire la reprise ne change rien au solde prévu : ce test ne vérifie rien').not.toBe(défaite);
    return { l, saisie, relevé, tenue, défaite };
  }

  it.each([
    ['Opérations', 'Supprimer'],
    ['Saisie manuelle', '×'],
  ])('[niveau 1] depuis l’écran %s, supprimer la saisie reprise le dit, et ne change rien tant qu’on ne défait pas la reprise ; acceptée, la reprise se défait et la saisie se supprime', async (écran, bouton) => {
    const { l, saisie, tenue, défaite } = décor();
    const d = dialogues();
    const page = await pageAvec(site, l, d);
    try {
      expect(await soldeAuPlan(page)).toBe(tenue);
      /** Ouvre l'écran, et clique `bouton` sur la ligne de la saisie ; rend si la ligne y était. */
      const supprimer = async (): Promise<boolean> => {
        if (écran === 'Opérations') {
          await toutesLesOpérations(page);
          const ouvert = await page.evaluate((libellé: string) => {
            const ligne = [...document.querySelectorAll('main .row')].find((r) => (r.querySelector('button.label strong')?.textContent ?? '') === libellé);
            (ligne?.querySelector('button.label') as HTMLButtonElement | null)?.click();
            return !!ligne;
          }, saisie.label);
          if (!ouvert) return false;
          await pause(200);
        } else {
          await allerÀ(page, 'Plus');
          if (!(await cliquer(page, 'Saisie manuelle'))) return false;
          await pause(300);
        }
        return page.evaluate(
          (libellé: string, b: string, depuis: string) => {
            const lignes = [...document.querySelectorAll('main .row')].filter((r) => (r.querySelector('strong')?.textContent ?? '') === libellé);
            const ligne = depuis === 'Opérations' ? document.querySelector('main') : lignes[0];
            const cible = [...(ligne?.querySelectorAll('button') ?? [])].find((x) => (x.textContent ?? '').trim() === b);
            if (!cible || (depuis !== 'Opérations' && !lignes.length)) return false;
            (cible as HTMLButtonElement).click();
            return true;
          },
          saisie.label,
          bouton,
          écran,
        );
      };

      d.réponse = 'annuler';
      expect(await supprimer(), `la saisie « ${saisie.label} » n’a pas de bouton « ${bouton} » à l’écran ${écran}`).toBe(true);
      await pause(250);
      expect(d.messages, 'l’écran n’a posé aucune question').toHaveLength(1);
      expect(d.messages[0]).toMatch(/ne se supprime pas tant que la reprise tient/);
      expect(d.messages[0], 'le message ne dit pas ce qui reprend la saisie').toMatch(/VIR SALAIRE OCTOBRE/);
      expect(await soldeAuPlan(page), 'refuser a changé le solde prévu').toBe(tenue);

      d.réponse = 'ok';
      expect(await supprimer(), 'la saisie n’est plus là après avoir refusé').toBe(true);
      await pause(250);
      expect(d.messages).toHaveLength(2);
      expect(await soldeAuPlan(page), 'la reprise défaite et la saisie supprimée, le solde prévu n’est pas celui du cœur').toBe(défaite);
      // La reprise est défaite : l'opération du relevé ne reprend plus la saisie supprimée, et l'occurrence
      // que la saisie corrigeait lui est de nouveau proposée.
      await toutesLesOpérations(page);
      const ligne = await ligneOpération(page, /VIR SALAIRE OCTOBRE/);
      expect(ligne, 'l’opération du relevé n’est plus à l’écran').not.toBeNull();
      expect(ligne, 'l’opération du relevé reprend encore la saisie supprimée').not.toMatch(/reprend la saisie/);
      expect(ligne, 'l’opération du relevé n’est pas de nouveau proposée à l’occurrence du salaire').toMatch(/Proposition : reprendre l’opération prévue « Salaire » du/);
      expect(await supprimer(), 'la saisie supprimée se lit encore à l’écran').toBe(false);
      expect(d.messages, 'supprimer une saisie que rien ne reprend plus ne devait rien demander de tel').toHaveLength(2);
    } finally {
      await page.close().catch(() => {});
    }
  });
});
