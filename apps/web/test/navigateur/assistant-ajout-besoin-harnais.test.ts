/**
 * Harnais d'audit de #344, côté écran : « Dans l'assistant, ajouter un besoin à une tirelire de l'étape
 * Budgets » — sur le site construit, à 375 px, projet vierge. Retient et complète les tests du codeur
 * (`assistant-ajout-besoin.test.ts`, d'où ils sont déplacés).
 *
 * Niveaux (D83), par phrase du « Fait quand » :
 *  - 1 pour le point 4 : sa phrase est la valeur d'I4 telle qu'elle est écrite (« chaque étape se franchit par
 *    son seul bouton primaire, sans champ à remplir »). Témoin rouge : le bouton d'ajout rendu primaire.
 *  - 1 pour le point 6 : sa phrase est la valeur d'I11 (« tout ce qu'une étape d'assistant crée se modifie aussi
 *    hors assistant »), et la validation n'écrit rien de ce que l'assistant montre sinon (U1).
 *  - 2 pour les points 1, 2 et 3 : D28 (la somme des besoins), D06 (la priorité par défaut) et D50 (sans date, en
 *    vigueur) sont des décisions ; un besoin absent, accepté à tort ou mal doté est un cas faux, l'usage restant
 *    possible.
 *  - 3 pour le point 5 : les aides (#214) rendent l'ajout plus facile ; sans elles le résultat reste juste.
 *  - Le point 7 (D40) se relit, sans test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));
const TIRELIRE = 'Enfants et loisirs';

/** Les lignes de besoin d'une carte de l'étape : nom propre, montant, détail de validité. */
const lignes = (page: Page, tirelire: string) =>
  page.evaluate((nom: string) => {
    const c = ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).find((x) => (x.querySelector('input.nom') as HTMLInputElement).value === nom);
    return c
      ? ([...c.querySelectorAll('.ligne')] as HTMLElement[]).map((l) => ({
          nom: (l.querySelector('input.besoin') as HTMLInputElement | null)?.value ?? '',
          montant: (l.querySelector('input.mt') as HTMLInputElement).value,
          suite: (l.querySelector('.suite')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        }))
      : null;
  }, tirelire);

/** Remplit le formulaire d'ajout d'un besoin de la carte, laisse l'écran se mettre à jour comme à la saisie, puis l'envoie. */
async function ajouter(page: Page, tirelire: string, nom: string, montant: string) {
  const fait = await page.evaluate(
    (t: string, n: string, m: string) => {
      const c = ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).find((x) => (x.querySelector('input.nom') as HTMLInputElement).value === t);
      const f = c?.querySelector('form.ajout-besoin');
      if (!f) return false;
      const poser = (i: HTMLInputElement, v: string) => {
        i.value = v;
        i.dispatchEvent(new Event('input', { bubbles: true }));
      };
      poser(f.querySelector('.besoin-nom') as HTMLInputElement, n);
      poser(f.querySelector('.mt') as HTMLInputElement, m);
      return true;
    },
    tirelire,
    nom,
    montant,
  );
  expect(fait, `la carte « ${tirelire} » n’offre pas d’ajouter un besoin`).toBe(true);
  await pause(80);
  await page.evaluate((t: string) => {
    const c = ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).find((x) => (x.querySelector('input.nom') as HTMLInputElement).value === t)!;
    (c.querySelector('form.ajout-besoin button[type=submit]') as HTMLButtonElement).click();
  }, tirelire);
  await pause(250);
}

const erreur = (page: Page, tirelire: string) =>
  page.evaluate((t: string) => {
    const c = ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).find((x) => (x.querySelector('input.nom') as HTMLInputElement).value === t)!;
    return (c.querySelector('form.ajout-besoin .err')?.textContent ?? '').trim();
  }, tirelire);

/** Ce que l'étape montre : cartes, formulaires d'ajout, boutons primaires, et le bandeau « À mettre de côté ». */
const etape = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    const cartes = ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).map((c) => ({
      nom: (c.querySelector('input.nom') as HTMLInputElement).value,
      formulaires: c.querySelectorAll('form.ajout-besoin').length,
    }));
    const stat = ([...document.querySelectorAll('.stat')] as HTMLElement[]).find((s) => t(s.querySelector('.k')) === 'À mettre de côté');
    return {
      cartes,
      primaires: ([...document.querySelectorAll('main .btn.primary')] as HTMLElement[]).map(t),
      deCote: t(stat?.querySelector('.v')),
    };
  });

/** « 1 234,56 € » → 123456 (centimes). */
const centimes = (texte: string) => Math.round(Number(texte.replace(/[^\d,-]/g, '').replace(',', '.')) * 100);

async function ouvrirLEtapeBudgets(page: Page, site: Site) {
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
  await allerÀ(page, 'Plan');
  await cliquer(page, 'Construire mon budget');
  await pause(300);
  await cliquer(page, 'Commencer');
  await pause(250);
  const arrive = await page.evaluate(() => {
    const b = ([...document.querySelectorAll('.wizard-steps .wstep')] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').trim() === 'Budgets');
    b?.click();
    return !!b;
  });
  expect(arrive, 'pas d’étape « Budgets » dans l’assistant').toBe(true);
  await pause(300);
}

/** Du point où l'on est jusqu'au résumé, puis « Valider mon budget », par les seuls boutons primaires. */
async function validerLeBudget(page: Page) {
  for (let i = 0; i < 14; i++) {
    const fait = await page.evaluate(() => {
      const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
      const b = ([...document.querySelectorAll('main .actions button.primary')] as HTMLButtonElement[]).find((x) => /Suivant|Valider mon budget/.test(t(x)));
      const valide = !!b && /Valider/.test(t(b));
      b?.click();
      return { cliquee: !!b, valide };
    });
    await pause(300);
    if (fait.valide) return;
    expect(fait.cliquee, 'plus de bouton primaire avant la validation').toBe(true);
  }
  throw new Error('le résumé n’a pas été atteint');
}

const texteDe = (page: Page) => page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' ').trim());

describe.skipIf(!navigateur)('#344 — ajouter un besoin à une tirelire de l’étape Budgets', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 300_000);
  afterAll(async () => {
    await site?.fermer();
  });

  describe('étape Budgets', () => {
    let page: Page;
    beforeAll(async () => {
      page = await nouvellePage(site);
      await ouvrirLEtapeBudgets(page, site);
    }, 120_000);
    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 2] 1 — chaque carte de tirelire offre d’ajouter un besoin, qui s’ajoute comme ligne de plus, nommée, et se corrige et se retire sur place', async () => {
      const e = await etape(page);
      expect(e.cartes.length).toBeGreaterThanOrEqual(2);
      expect(e.cartes.filter((c) => c.formulaires !== 1).map((c) => c.nom), 'cartes sans exactement un formulaire d’ajout').toEqual([]);
      expect(e.cartes.map((c) => c.nom)).toContain(TIRELIRE);

      const avant = (await lignes(page, TIRELIRE))!;
      expect(avant.length).toBe(2); // son besoin et « Cours de piano » (#336)
      await ajouter(page, TIRELIRE, 'Solfège', '20');
      const apres = (await lignes(page, TIRELIRE))!;
      expect(apres).toHaveLength(avant.length + 1);
      expect(apres[apres.length - 1]).toMatchObject({ nom: 'Solfège', montant: '20,00' });
      expect(await erreur(page, TIRELIRE)).toBe('');

      // Il se corrige sur place, comme les autres : le montant, puis le nom.
      await page.evaluate((nom: string) => {
        const l = ([...document.querySelectorAll('main .card.tirelire .ligne')] as HTMLElement[]).find((x) => (x.querySelector('input.besoin') as HTMLInputElement | null)?.value === nom)!;
        const m = l.querySelector('input.mt') as HTMLInputElement;
        m.value = '25';
        m.dispatchEvent(new Event('change', { bubbles: true }));
      }, 'Solfège');
      await pause(250);
      expect(((await lignes(page, TIRELIRE))!).find((l) => l.nom === 'Solfège')?.montant).toBe('25,00');

      // Il se retire sur place ; les autres lignes de la carte restent.
      await page.evaluate((nom: string) => {
        const l = ([...document.querySelectorAll('main .card.tirelire .ligne')] as HTMLElement[]).find((x) => (x.querySelector('input.besoin') as HTMLInputElement | null)?.value === nom)!;
        (l.querySelector('button.danger') as HTMLButtonElement).click();
      }, 'Solfège');
      await pause(250);
      expect(((await lignes(page, TIRELIRE))!).map((l) => l.nom)).toEqual(avant.map((l) => l.nom));
    });

    it('[niveau 2] 2 — sans nom, ou sans montant positif, l’étape refuse en le disant et n’ajoute rien', async () => {
      const avant = (await lignes(page, TIRELIRE))!;
      for (const [nom, montant] of [
        ['', '30'],
        ['   ', '30'],
        ['Péage', ''],
        ['Péage', '0'],
        ['Péage', '-5'],
        ['Péage', 'abc'],
      ] as const) {
        await ajouter(page, TIRELIRE, nom, montant);
        expect(await erreur(page, TIRELIRE), `« ${nom} » · « ${montant} » : pas de message`).not.toBe('');
        expect(await lignes(page, TIRELIRE), `« ${nom} » · « ${montant} » a ajouté une ligne`).toEqual(avant);
      }
      // Un ajout valide efface le message, et le nom de l'erreur ne reste pas dans le formulaire.
      await ajouter(page, TIRELIRE, 'Péage', '30');
      expect(await erreur(page, TIRELIRE)).toBe('');
      await page.evaluate(() => {
        const l = ([...document.querySelectorAll('main .card.tirelire .ligne')] as HTMLElement[]).find((x) => (x.querySelector('input.besoin') as HTMLInputElement | null)?.value === 'Péage')!;
        (l.querySelector('button.danger') as HTMLButtonElement).click();
      });
      await pause(250);
      expect(await lignes(page, TIRELIRE)).toEqual(avant);
    });

    it('[niveau 2] 3 — le bandeau de l’assistant compte aussitôt le besoin ajouté, de son montant par période', async () => {
      const avant = centimes((await etape(page)).deCote);
      await ajouter(page, TIRELIRE, 'Péage', '30');
      const apres = centimes((await etape(page)).deCote);
      expect(apres - avant).toBe(3000);
      await page.evaluate(() => {
        const l = ([...document.querySelectorAll('main .card.tirelire .ligne')] as HTMLElement[]).find((x) => (x.querySelector('input.besoin') as HTMLInputElement | null)?.value === 'Péage')!;
        (l.querySelector('button.danger') as HTMLButtonElement).click();
      });
      await pause(250);
      expect(centimes((await etape(page)).deCote)).toBe(avant);
    });

    it('[niveau 3] 5 — la ligne d’aide est « Cours de piano », 45,00 ; la recopier ajoute le besoin de l’exemple, date de début comprise', async () => {
      const aides = await page.evaluate((t: string) => {
        const c = ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).find((x) => (x.querySelector('input.nom') as HTMLInputElement).value === t)!;
        return [(c.querySelector('.besoin-nom') as HTMLInputElement).placeholder, (c.querySelector('form.ajout-besoin .mt') as HTMLInputElement).placeholder];
      }, 'Essence');
      expect(aides).toEqual(['Cours de piano', '45,00']);

      // Recopiée sur une tirelire qui n'a pas ce besoin, la ligne ajoutée est celle de l'exemple.
      await ajouter(page, 'Essence', 'Cours de piano', '45,00');
      const vu = (await lignes(page, 'Essence'))!;
      expect(vu).toHaveLength(2);
      expect(vu[1]!.nom).toBe('Cours de piano');
      expect(vu[1]!.suite).toMatch(/à partir du 28 oct\S* 2026/);
      // Un montant ou un nom autre ne porte pas cette date : sans date, en vigueur depuis toujours (D50).
      await ajouter(page, 'Essence', 'Cours de piano', '50');
      const autre = (await lignes(page, 'Essence'))!;
      expect(autre[2]).toMatchObject({ nom: 'Cours de piano', montant: '50,00', suite: '' });
    });

    it('[niveau 1] 4 — le bouton d’ajout n’est pas primaire : l’étape se franchit par son seul bouton « Suivant », sans champ rempli', async () => {
      const e = await etape(page);
      expect(e.primaires, 'les boutons primaires de l’étape').toEqual(['Ajouter', 'Suivant ›']);
      // Rien n'a été rempli dans les formulaires d'ajout : « Suivant » franchit l'étape et n'ajoute aucune ligne.
      const champsVides = await page.evaluate(() =>
        ([...document.querySelectorAll('main form.ajout-besoin input')] as HTMLInputElement[]).every((i) => i.value === ''),
      );
      expect(champsVides, 'un ajout réussi laisse son formulaire rempli').toBe(true);
      const titreAvant = await page.evaluate(() => document.querySelector('main h2')?.textContent ?? '');
      expect(await cliquer(page, 'Suivant')).toBe(true);
      await pause(300);
      expect(await page.evaluate(() => document.querySelector('main h2')?.textContent ?? '')).not.toBe(titreAvant);
    });
  });

  describe('après la validation', () => {
    let page: Page;
    beforeAll(async () => {
      page = await nouvellePage(site);
      await ouvrirLEtapeBudgets(page, site);
      await ajouter(page, TIRELIRE, 'Solfège', '20');
      await validerLeBudget(page);
      await pause(600);
    }, 120_000);
    afterAll(async () => {
      await page?.close();
    });

    /** Ouvre l'écran Tirelires et rend ce que dit la ligne du besoin « Solfège » de la carte « Enfants et loisirs ». */
    async function ligneDansTirelires() {
      await allerÀ(page, 'Plus');
      expect(await cliquer(page, 'Tirelires')).toBe(true);
      await pause(300);
      // La carte de l'écran Tirelires est celle de l'assistant (#369) : le nom est dans son champ, et la ligne du besoin porte son nom propre dans le sien.
      return page.evaluate((t: string) => {
        const c = ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).find((x) => ((x.querySelector('input.nom') as HTMLInputElement | null)?.value ?? '').trim() === t);
        const l = c ? ([...c.querySelectorAll('.ligne')] as HTMLElement[]).find((x) => ((x.querySelector('input.besoin') as HTMLInputElement | null)?.value ?? '').includes('Solfège')) : undefined;
        return { carte: !!c, ligne: l ? `${(l.querySelector('input.besoin') as HTMLInputElement).value} ${(l.querySelector('input.mt') as HTMLInputElement).value} ${l.textContent ?? ''}`.replace(/\s+/g, ' ').trim() : '' };
      }, TIRELIRE);
    }

    it('[niveau 2] 3 — validé, le besoin ajouté est en vigueur sans date de fin, à la priorité par défaut, et le Plan le dote avec les autres besoins de sa tirelire', async () => {
      const { carte, ligne } = await ligneDansTirelires();
      expect(carte, 'pas de carte « Enfants et loisirs » dans Tirelires').toBe(true);
      expect(ligne).toContain('Solfège');
      expect(ligne).toMatch(/priorité 20\b/);
      expect(ligne, 'le besoin ajouté porte une date de validité').not.toMatch(/à partir du|jusqu|du \d|au \d/);
      expect(ligne, 'le besoin ajouté est signalé comme pas encore en vigueur').not.toMatch(/pas encore|terminé|dormant/i);

      await allerÀ(page, 'Plan');
      await pause(300);
      const plan = await texteDe(page);
      // Une ligne de dotation par besoin : le besoin de la tirelire (200,00) et celui qu'on a ajouté (20,00).
      expect(plan, 'le Plan ne dote pas le besoin ajouté').toMatch(/Solfège\s*dans Enfants et loisirs[^]*?croisière 20,00/);
      expect(plan, 'le Plan ne dote plus le besoin de la tirelire').toMatch(/Enfants et loisirs\s*non financé[^]*?croisière 200,00/);
    });

    it('[niveau 1] 6 — le besoin ajouté se retrouve dans Tirelires et s’y modifie', async () => {
      const { ligne } = await ligneDansTirelires();
      expect(ligne, 'le besoin ajouté ne se retrouve pas dans Tirelires').toContain('Solfège');
      const ouvert = await page.evaluate(() => {
        const l = ([...document.querySelectorAll('main .ligne')] as HTMLElement[]).find((x) => ((x.querySelector('input.besoin') as HTMLInputElement | null)?.value ?? '').includes('Solfège'));
        const b = ([...(l?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').trim() === 'Modifier');
        b?.click();
        return !!b;
      });
      expect(ouvert, 'pas de bouton « Modifier » sur le besoin ajouté').toBe(true);
      await pause(250);
      await page.evaluate(() => {
        const f = [...document.querySelectorAll('main form')].find((x) => (x.textContent ?? '').includes('Enregistrer')) as HTMLFormElement;
        const champs = [...f.querySelectorAll('input')] as HTMLInputElement[];
        const montant = champs.find((i) => i.value === '20,00' || i.value === '20');
        if (!montant) throw new Error('champ du montant introuvable : ' + champs.map((i) => i.value).join('|'));
        montant.value = '25';
        montant.dispatchEvent(new Event('input', { bubbles: true }));
        (f.querySelector('button[type=submit]') as HTMLButtonElement).click();
      });
      await pause(300);
      expect((await ligneDansTirelires()).ligne).toMatch(/^Solfège 25,00/);
    });
  });
});
