// @vitest-environment jsdom
/**
 * Tests du codeur de #418 : ce que vérifiait le harnais navigateur d'audit de #210 (« L'assistant n'écrit dans le
 * projet qu'à sa validation finale »), que #418 retire, sans navigateur : l'application montée sous jsdom (`ecran.ts`), au jour des tests. Chaque titre dit le point du « Fait quand » de
 * #210 qu'il vérifie, et le numéro du test retiré dans la table de #418 (« validé 1 » à « validé 7 »).
 *
 * « Rien n'est entré dans le projet » se lit de deux façons : les écrans ordinaires (Plan, Comptes, Flux prévus,
 * Tirelires, le début de période de Réglages) disent ce qu'ils disaient avant, et le projet que porte le dépôt est
 * le même. « Après un rechargement » : la page se ferme, et l'application se rouvre sur ce qu'elle a enregistré
 * (`rouvrirLApplication`) ; l'écriture de ce dépôt sur l'appareil est une capacité du navigateur (D83), qui ne se
 * vérifie pas ici. « Tout effacer » et l'ouverture d'un fichier sont ceux de l'application, pressés dans Réglages.
 *
 * Le brouillon seul : `assistant-brouillon.test.ts`. « Le plan dote des tirelires » et l'assistant franchi par ses
 * seuls boutons primaires : le harnais du registre `navigateur/assistant-simple.test.ts` (I4). « Ses lignes à
 * l'arrivée » : `assistant-flux-exemple-ecran.test.ts`, `assistant-tirelires-exemple-ecran.test.ts` et
 * `assistant-categories-exemple-ecran.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { LedgerStore, MAIN_ACCOUNT_ID, alive, type Ledger } from '@tirelire/core';
import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  allerA,
  app,
  attendre,
  avancer,
  cliquer,
  ecran,
  jusquAuResume,
  lire,
  ouvrirLApplication,
  presser,
  projet,
  rouvrirLApplication,
  saisir,
  t,
  tous,
} from './ecran';

const NOM_PRINCIPAL = 'Compte de la maison';
const NOM_AUTRE_COMPTE = 'Livret de la maison';

/** Les noms que l'étape en cours montre dans ses champs de nom. */
const noms = () => tous<HTMLInputElement>('main input.nom').map((i) => i.value.trim()).filter(Boolean);

/** Le texte de l'écran, les noms et besoins des cartes de tirelire compris (#369 : ils sont dans des champs). */
const texteAvecLesChamps = () => {
  const m = document.querySelector('main')!.cloneNode(true) as HTMLElement;
  for (const i of tous<HTMLInputElement>('input.nom, input.besoin', m)) i.replaceWith(document.createTextNode(` ${i.value} `));
  return t(m);
};

/** Le texte d'un écran ordinaire, atteint par le menu Plus. */
async function ecranOrdinaire(nom: string): Promise<string> {
  expect(await ecran(nom), `pas d’écran « ${nom} » dans le menu Plus`).toBe(true);
  if (nom === 'Comptes') {
    // Comptes range ce qui est clos (D56) : « Clos » allumé, tous les comptes se lisent, avant comme après.
    const b = tous<HTMLButtonElement>('main button.filtre').find((x) => t(x).startsWith('Clos') && x.getAttribute('aria-pressed') === 'false');
    if (b) await presser(b);
    // Les comptes se corrigent sur leur ligne, dans des champs (#362) : leurs valeurs sont ce que l'écran dit.
    return `${t(document.querySelector('main'))} || ${tous<HTMLInputElement>('main .ligne-compte input').map((i) => i.value).join(' | ')}`;
  }
  return nom === 'Tirelires' ? texteAvecLesChamps() : t(document.querySelector('main'));
}

/** Ce que disent les écrans qui lisent le projet : Plan, Comptes, Flux prévus, Tirelires, et le jour de début de période. */
async function projetLu() {
  await allerA('Plan');
  const plan = t(document.querySelector('main'));
  const comptes = await ecranOrdinaire('Comptes');
  const flux = await ecranOrdinaire('Flux prévus');
  const tirelires = await ecranOrdinaire('Tirelires');
  await ecranOrdinaire('Réglages');
  const h = tous('main h2').find((x) => t(x).includes('Début de la période budgétaire'));
  const jour = (h?.nextElementSibling?.querySelector('input') as HTMLInputElement | null)?.value ?? null;
  return { plan, comptes, flux, tirelires, jour };
}

/** Le budget que porte le dépôt, sans l'identifiant de l'appareil ni les dates d'écriture. */
const budgetDe = (l: Ledger) =>
  JSON.stringify(
    { accounts: l.accounts, tirelires: l.tirelires, needs: l.needs, categories: l.categories, plannedFlows: l.plannedFlows, settings: { ...l.settings, siteId: undefined } },
    (k, v) => (k === 'hlc' || k === 'updatedAt' ? undefined : v),
  );

/** Rien n'a changé, écran par écran, ni dans le dépôt : le message dit ce qui a bougé. */
function memeProjet(obtenu: Awaited<ReturnType<typeof projetLu>>, attendu: Awaited<ReturnType<typeof projetLu>>, quand: string) {
  for (const e of ['plan', 'comptes', 'flux', 'tirelires', 'jour'] as const) expect(obtenu[e], `${quand} : l’écran « ${e} » n’est plus ce qu’il était`).toEqual(attendu[e]);
}

/** Ouvre l'assistant sur un projet vierge, depuis le Plan. */
async function ouvrirLAssistant() {
  await allerA('Plan');
  expect(await cliquer('Construire mon budget'), 'pas de bouton « Construire mon budget »').toBe(true);
}

/** Ouvre l'assistant depuis Configuration (« Lancer »). */
async function lancerLAssistant() {
  await allerA('Plus');
  expect(await cliquer('Lancer'), 'pas de bouton « Lancer » pour ouvrir l’assistant').toBe(true);
}

async function allerALEtape(titre: RegExp) {
  for (let i = 0; i < 12 && !titre.test(lire().h2); i++) await avancer();
  expect(lire().h2, `l’étape ${titre} n’a pas été atteinte`).toMatch(titre);
}

async function remonterALEtape(titre: RegExp) {
  for (let i = 0; i < 12 && !titre.test(lire().h2); i++) await cliquer('Précédent');
  expect(lire().h2, `l’étape ${titre} n’a pas été retrouvée en remontant`).toMatch(titre);
}

/** Du point où l'on est jusqu'au résumé, par les seuls boutons primaires ; rend les noms que chaque étape montrait à l'arrivée. */
async function jusquAuResumeEnNotant(): Promise<Map<string, string[]>> {
  const parEtape = new Map<string, string[]>();
  for (let i = 0; i < 14 && !lire().primaires.includes('Valider mon budget'); i++) {
    parEtape.set(lire().h2, noms());
    if (!(await avancer())) break;
  }
  return parEtape;
}

/** Le choix du placement d'une réserve au résumé : la première liste qui propose « Peu importe ». */
const choixDuPlacement = () => tous<HTMLSelectElement>('main select').find((s) => [...s.options].some((o) => t(o) === 'Peu importe'));

/**
 * Prépare un budget dans l'assistant d'un projet vierge, sans le valider : le compte principal nommé et doté, un
 * compte ajouté par le formulaire de l'étape, les lignes proposées d'office, le début de période au 28, une réserve
 * placée sur un autre compte au résumé. Rend ce qui a été préparé.
 */
async function preparer() {
  await ouvrirLAssistant();
  await avancer(); // le principe → les comptes
  const principal = tous<HTMLInputElement>('main .ligne-compte.principal input');
  await saisir(principal[0]!, NOM_PRINCIPAL);
  await saisir(document.querySelector('main .ligne-compte.principal input.mt') as HTMLInputElement, '1234,56');
  await saisir(document.querySelector('main form.edit input[placeholder="Livret A"]') as HTMLInputElement, NOM_AUTRE_COMPTE);
  expect(await cliquer('Ajouter un compte'), 'pas de bouton « Ajouter un compte »').toBe(true);
  const autresComptes = tous('main .ligne-compte:not(.principal)').map((l) => (l.querySelector('input') as HTMLInputElement).value.trim()).filter(Boolean);
  expect(autresComptes, 'le compte ajouté n’est pas sur l’étape').toContain(NOM_AUTRE_COMPTE);
  await avancer(); // → les revenus
  const champ = tous('main label.f').find((l) => t(l).includes('La période commence le'));
  const jour = (champ?.querySelector('input') as HTMLInputElement | null)?.value ?? null;
  expect(jour, 'l’assistant n’arrive pas au jour de paie de l’exemple').toBe('28');
  const parEtape = await jusquAuResumeEnNotant();

  const choix = choixDuPlacement();
  expect(choix, 'le résumé ne propose pas de placer une réserve').toBeTruthy();
  const option = [...choix!.options].find((o) => o.value && o.value !== MAIN_ACCOUNT_ID)!;
  const placement = { reserve: t(choix!.closest('.card')?.querySelector('.label strong')), compte: t(option) };
  await saisir(choix!, option.value);
  return { autresComptes, jour, parEtape, placement };
}

/** L'assistant rouvert repart du début : le principe, « Commencer ». */
async function repartDuDebut(apres: string) {
  await ouvrirLAssistant();
  const e = lire();
  expect(t(document.querySelector('main h1')), `après ${apres}`).toBe('Construire mon budget');
  expect(e.primaires.some((p) => p.includes('Commencer')), `l’assistant reprend ce qui était préparé (après ${apres})`).toBe(true);
}

describe('#418 · #210 point 1 — rien de ce que l’assistant montre n’entre dans le projet avant la validation, sans navigateur', () => {
  it('[niveau 4] #210 point 1, I10 (table #418, validé 1) — projet vierge : le budget préparé, puis quitté sans valider, n’entre ni dans les écrans ni dans le dépôt ; rouverte sur ce qu’elle a enregistré, l’application dit de même, et l’assistant repart de « Commencer »', async () => {
    await ouvrirLApplication();
    const avant = await projetLu();
    const depotAvant = budgetDe(projet());
    expect(avant.comptes).not.toContain(NOM_PRINCIPAL);

    const prepare = await preparer();
    expect([...prepare.parEtape.values()].flat().length, 'l’assistant ne propose rien d’office dans un projet vierge').toBeGreaterThanOrEqual(3);
    expect(lire().primaires).toContain('Valider mon budget');

    memeProjet(await projetLu(), avant, 'avant la validation');
    expect(budgetDe(projet()), 'le dépôt a changé avant la validation').toBe(depotAvant);

    await rouvrirLApplication();
    memeProjet(await projetLu(), avant, 'rouverte sans validation');
    expect(budgetDe(projet()), 'le dépôt rouvert a changé sans validation').toBe(depotAvant);
    await repartDuDebut('la réouverture');
  });

  it('[niveau 4] #210 point 1, I10 (table #418, validé 2) — projet existant : l’assistant part du contenu ; une rentrée renommée, une autre retirée et un placement changé n’entrent pas ; rouvert, il reprend au résumé avec la correction et le retrait ; validé, les trois entrent', async () => {
    await ouvrirLApplication();
    expect(await cliquer('Charger l\'exemple')).toBe(true);
    await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A'), 'l’exemple');
    const avant = await projetLu();
    const depotAvant = budgetDe(projet());

    await lancerLAssistant();
    await allerALEtape(/Qu.est-ce qui rentre/);
    const rentrees = noms();
    const uniques = rentrees.filter((n) => rentrees.filter((x) => x === n).length === 1);
    expect(uniques.length, 'les rentrées de l’exemple ont des homonymes').toBeGreaterThanOrEqual(2);
    const [corrigee, retiree] = uniques as [string, string];
    const corrigeeEn = `${corrigee} corrigée`;
    expect(avant.flux).toContain(corrigee);
    expect(avant.flux).toContain(retiree);

    await saisir(tous<HTMLInputElement>('main input.nom').find((i) => i.value.trim() === corrigee)!, corrigeeEn);
    const ligne = tous<HTMLInputElement>('main input.nom').find((i) => i.value.trim() === retiree)!.closest('.ligne-flux, .row, .card')!;
    await presser(ligne.querySelector('button.danger') as HTMLButtonElement);
    expect(noms()).toContain(corrigeeEn);
    expect(noms()).not.toContain(retiree);

    expect(await jusquAuResume()).toBe(true);
    const choix = choixDuPlacement();
    expect(choix, 'le résumé de l’exemple ne propose pas de placer une réserve').toBeTruthy();
    const option = [...choix!.options].find((o) => o.value !== choix!.value)!;
    await saisir(choix!, option.value);

    memeProjet(await projetLu(), avant, 'avant la validation');
    expect(budgetDe(projet()), 'le dépôt a changé avant la validation').toBe(depotAvant);

    await lancerLAssistant();
    expect(lire().primaires, 'l’assistant ne reprend pas où il en était').toContain('Valider mon budget');
    await remonterALEtape(/Qu.est-ce qui rentre/);
    expect(noms()).toContain(corrigeeEn);
    expect(noms()).not.toContain(retiree);
    expect(await jusquAuResume()).toBe(true);
    expect(await cliquer('Valider mon budget')).toBe(true);

    const apres = await projetLu();
    expect(apres.flux, 'la correction n’est pas entrée à la validation').toContain(corrigeeEn);
    expect(apres.flux, 'le retrait n’est pas entré à la validation').not.toContain(retiree);
    expect(apres.tirelires, 'le placement n’est pas entré à la validation').not.toEqual(avant.tirelires);
    const flux = alive(projet().plannedFlows).map((f) => f.name);
    expect(flux).toContain(corrigeeEn);
    expect(flux).not.toContain(retiree);
  });
});

describe('#418 · #210 point 2 — la validation fait entrer exactement ce que l’assistant montre, sans navigateur', () => {
  it('[niveau 4] #210 point 2, U1 (table #418, validé 3) — le budget préparé, validé : compte principal nommé et doté, compte ajouté, flux, tirelires, début de période et placement entrent ; rouverte sur ce qu’elle a enregistré, l’application dit de même', async () => {
    await ouvrirLApplication();
    const prepare = await preparer();
    const lignes = [...prepare.parEtape].filter(([etape]) => !/comptes|classer/i.test(etape));
    const nomsFlux = lignes.filter(([etape]) => /rentre|part tout seul/i.test(etape)).flatMap(([, n]) => n);
    const nomsTirelires = lignes.filter(([etape]) => !/rentre|part tout seul/i.test(etape)).flatMap(([, n]) => n);
    expect(nomsFlux.length, 'aucune ligne de flux préparée').toBeGreaterThanOrEqual(2);
    expect(nomsTirelires.length, 'aucune tirelire préparée').toBeGreaterThanOrEqual(1);

    expect(await cliquer('Valider mon budget')).toBe(true);
    const apres = await projetLu();
    expect(apres.comptes, 'le compte principal renseigné n’est pas entré').toContain(NOM_PRINCIPAL);
    expect(apres.comptes, 'le solde du compte principal n’est pas entré').toMatch(/1\D?234,56/);
    for (const nom of prepare.autresComptes) expect(apres.comptes, `le compte « ${nom} » n’est pas entré`).toContain(nom);
    for (const nom of nomsFlux) expect(apres.flux, `« ${nom} » n’est pas entré dans Flux prévus`).toContain(nom);
    for (const nom of nomsTirelires) expect(apres.tirelires, `« ${nom} » n’est pas entré dans Tirelires`).toContain(nom);
    expect(apres.jour, 'le début de période n’est pas entré').toBe(prepare.jour);
    expect(apres.tirelires, 'le placement de la réserve n’est pas entré').toContain(`le reste sur ${prepare.placement.compte}`);

    const p = projet();
    const principal = alive(p.accounts).find((a) => a.id === MAIN_ACCOUNT_ID)!;
    expect([principal.name, principal.openingBalance]).toEqual([NOM_PRINCIPAL, 123456]);
    const reserve = alive(p.tirelires).find((x) => x.name === prepare.placement.reserve)!;
    expect(reserve.placement.map((x) => alive(p.accounts).find((a) => a.id === x.accountId)?.name)).toEqual([prepare.placement.compte]);
    const depot = budgetDe(p);

    await rouvrirLApplication();
    memeProjet(await projetLu(), apres, 'rouverte');
    expect(budgetDe(projet()), 'le dépôt rouvert n’est pas celui que la validation a écrit').toBe(depot);
  });
});

describe('#418 · #210 point 3 — ce qui est préparé se retrouve en revenant, et le résumé dit que rien n’est enregistré, sans navigateur', () => {
  it('[niveau 4] #210 point 3 (table #418, validé 4) — on quitte l’assistant au milieu et on y revient : l’étape et ses lignes sont là ; le résumé dit que rien n’est enregistré, sans « Voir le plan » ; après la validation, il le dit enregistré', async () => {
    await ouvrirLApplication();
    await ouvrirLAssistant();
    await avancer();
    await allerALEtape(/ne tombe pas tous les mois/i);
    const avant = noms();
    expect(avant.length, 'l’étape ne propose rien d’office').toBeGreaterThanOrEqual(1);

    await allerA('Plan');
    await ouvrirLAssistant();
    expect(lire().h2, 'l’assistant ne reprend pas à l’étape où on l’a quitté').toMatch(/ne tombe pas tous les mois/i);
    expect(noms(), 'les lignes préparées ne sont pas retrouvées telles quelles').toEqual(avant);

    expect(await jusquAuResume()).toBe(true);
    const boutons = () => tous('main button').map(t);
    expect(t(document.querySelector('main')), 'le résumé ne dit pas que rien n’est encore enregistré').toContain('Rien n’est encore enregistré');
    expect(boutons(), 'le plan s’offre avant la validation').not.toContain('Voir le plan');

    expect(await cliquer('Valider mon budget')).toBe(true);
    expect(lire().h2).toContain('enregistré');
    expect(t(document.querySelector('main'))).not.toContain('Rien n’est encore enregistré');
    expect(boutons()).toContain('Voir le plan');
  });
});

describe('#418 · #210 point 3 — remplacer le projet perd ce qui était préparé, sans navigateur', () => {
  /** Un assistant préparé jusqu'aux revenus sur un projet vierge, puis Réglages. */
  async function preparerPuisAllerAuxReglages() {
    await ouvrirLApplication();
    await ouvrirLAssistant();
    await avancer();
    await allerALEtape(/Qu.est-ce qui rentre/);
    expect(noms().length, 'rien n’est préparé d’office').toBeGreaterThanOrEqual(2);
    expect(app.assistantPrepare, 'l’assistant n’a rien préparé').toBe(true);
    await ecranOrdinaire('Réglages');
  }

  it('[niveau 4] #210 point 3 (table #418, validé 5) — « Tout effacer » dans Réglages : rouvert, l’assistant repart de « Commencer »', async () => {
    await preparerPuisAllerAuxReglages();
    expect(await cliquer('Tout effacer'), 'pas de bouton « Tout effacer »').toBe(true);
    await attendre(() => t(document.querySelector('main')).includes('Données effacées.'), 'la fin de l’effacement');
    await repartDuDebut('« Tout effacer »');
  });

  it('[niveau 4] #210 point 3 (table #418, validé 6) — l’ouverture d’un fichier SQLite dans Réglages : rouvert, l’assistant repart de « Commencer »', async () => {
    const requerir = createRequire(resolve(process.cwd(), 'package.json'));
    const SQL = await initSqlJs({ wasmBinary: readFileSync(requerir.resolve('sql.js/dist/sql-wasm.wasm')) as unknown as ArrayBuffer });
    const store = await LedgerStore.create({ sqlJs: SQL, siteId: 'audit-210' });
    const octets = store.export();
    store.close();

    await preparerPuisAllerAuxReglages();
    const champ = tous<HTMLInputElement>('main input[type="file"]').find((c) => /sqlite/i.test(c.accept));
    expect(champ, 'aucun champ pour importer un fichier SQLite dans Réglages').toBeTruthy();
    Object.defineProperty(champ!, 'files', { configurable: true, value: [new File([octets as Uint8Array<ArrayBuffer>], 'projet.sqlite', { type: 'application/x-sqlite3' })] });
    champ!.dispatchEvent(new Event('change', { bubbles: true }));
    await attendre(() => t(document.querySelector('main')).includes('Fichier importé.'), 'la fin de l’ouverture du fichier');
    await repartDuDebut('l’ouverture d’un fichier');
  });
});

describe('#418 · #210 point 4 — projet vierge : une ligne retirée ne revient pas en repassant par l’étape, sans navigateur', () => {
  it('[niveau 4] #210 point 4, D43, D46 (table #418, validé 7) — à chacune des six étapes qui proposent, une ligne retirée ne revient pas quand on remonte du résumé par « Précédent »', async () => {
    await ouvrirLApplication();
    await ouvrirLAssistant();
    await avancer(); // le principe → les comptes
    await avancer(); // les comptes → les revenus

    const apresRetrait = new Map<string, string[]>();
    for (let i = 0; i < 6; i++) {
      const etape = lire().h2;
      const arrivee = noms();
      expect(arrivee.length, `l’étape « ${etape} » ne propose rien d’office à l’arrivée`).toBeGreaterThanOrEqual(1);
      await presser(document.querySelector('main button.danger') as HTMLButtonElement);
      const restantes = noms();
      expect(restantes, `« ${etape} » : le retrait n’a retiré qu’une ligne`).toHaveLength(arrivee.length - 1);
      apresRetrait.set(etape, restantes);
      expect(await avancer()).toBe(true);
    }
    expect(apresRetrait.size, 'les six étapes n’ont pas des titres distincts').toBe(6);

    expect(lire().primaires).toContain('Valider mon budget');
    for (let i = 0; i < 6; i++) {
      expect(await cliquer('Précédent')).toBe(true);
      const etape = lire().h2;
      expect(noms(), `« ${etape} » : une ligne retirée est revenue en repassant par l’étape`).toEqual(apresRetrait.get(etape));
    }
  });
});
