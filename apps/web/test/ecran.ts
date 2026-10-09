/**
 * L'application montée sans navigateur (#417) : sous jsdom, sur un dépôt en mémoire, au jour des tests.
 *
 * Ce que D83 (« Le navigateur au minimum ») laisse aux tests de l'interface sans navigateur — ce qu'un écran
 * montre ou enregistre — se lit ici sur l'application elle-même : `App.svelte` est monté tel que `main.ts` le
 * monte, ses écrans s'y rendent et ses boutons s'y pressent ; ce qu'un test lit, c'est le DOM que les
 * composants produisent, et ce qu'ils enregistrent, le projet que le dépôt relit. jsdom ne met rien en page :
 * aucune mesure de largeur, de position ni de défilement ne se fait ici (D59) ; elles restent au navigateur.
 *
 * Ce qui diffère du site servi, et seulement cela :
 * - le dépôt est ouvert en mémoire (`LedgerStore`), sans IndexedDB : l'enregistrement dans le navigateur est
 *   une capacité du navigateur (C4), qui ne se vérifie pas ici ; « Charger l'exemple » remplace ce dépôt par
 *   un dépôt neuf, comme `eraseAll` le fait du fichier enregistré ;
 * - l'horloge est fixée au jour des tests, comme `nouvellePage` la fixe dans `harnais.ts` ;
 * - le service worker ne s'inscrit pas (`vitest.config.ts`) ; `confirm` répond oui ; `scrollIntoView` et
 *   `matchMedia`, que jsdom n'a pas, ne font rien.
 *
 * Un fichier qui s'en sert se déclare `// @vitest-environment jsdom` en tête.
 */
import { flushSync, mount, tick, unmount } from 'svelte';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import initSqlJs from 'sql.js';
import { LedgerStore, type Ledger } from '@tirelire/core';
import { JOUR_DES_TESTS } from './jour-des-tests';

/** La date de lecture que le jour des tests donne à l'application. */
export const JOUR = JOUR_DES_TESTS.slice(0, 10);

vi.useFakeTimers({ toFake: ['Date'], now: new Date(JOUR_DES_TESTS) });
Element.prototype.scrollIntoView = () => {};
window.matchMedia = ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
window.confirm = () => true;
window.alert = () => {};

const requerir = createRequire(resolve(process.cwd(), 'package.json'));
const SQL = await initSqlJs({ wasmBinary: readFileSync(requerir.resolve('sql.js/dist/sql-wasm.wasm')) as unknown as ArrayBuffer });

const { app } = await import('../src/lib/state.svelte');
const { default: App } = await import('../src/App.svelte');
export { app };

/** Le dépôt que l'application tient (`opened`, privé dans `state.svelte.ts`). */
type AppOuverte = { opened: { store: LedgerStore; flush: () => Promise<void> } | undefined };

async function nouveauDepot(): Promise<void> {
  const ouverte = app as unknown as AppOuverte;
  ouverte.opened?.store.close();
  const store = await LedgerStore.create({ sqlJs: SQL });
  ouverte.opened = { store, flush: async () => {} };
}

// Effacer tout, c'est repartir d'un dépôt neuf : ce que fait `eraseAll` du fichier enregistré.
app.eraseAll = async () => {
  app.assistant = undefined;
  await nouveauDepot();
  app.reload();
};

let monte: ReturnType<typeof mount> | undefined;
let cible: HTMLElement | undefined;

/**
 * Monte l'application sur un projet vierge, au jour des tests, sur l'écran Plan — comme une page neuve
 * de `harnais.ts`. Ce qu'un montage précédent du même fichier tenait est oublié.
 */
export async function ouvrirLApplication(): Promise<void> {
  if (monte) unmount(monte);
  cible?.remove();
  await nouveauDepot();
  app.assistant = undefined;
  app.assistantDemande = undefined;
  app.importEnAttente = undefined;
  app.refusAdresse = undefined;
  app.conflicts = [];
  app.history = [];
  app.view = 'plan';
  app.asOf = JOUR;
  app.reload();
  app.ready = true;
  cible = document.createElement('div');
  document.body.append(cible);
  monte = mount(App, { target: cible });
  await rendu();
}

/** Laisse l'application rendre ce qui vient de changer. */
export async function rendu(): Promise<void> {
  flushSync();
  await tick();
  flushSync();
}

/** Le texte d'un élément, espaces resserrés. */
export const t = (e?: Element | null): string => (e?.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();

/** Les éléments de l'écran (`main`) qui répondent au sélecteur. */
export const tous = <E extends Element = HTMLElement>(selecteur: string, dans: ParentNode = document): E[] => [...dans.querySelectorAll<E>(selecteur)];

/** Le projet tel que le dépôt le relit : ce que l'application a enregistré. */
export const projet = (): Ledger => app.store.load();

/** Clique un élément, puis laisse le rendu se faire. */
export async function presser(e: HTMLElement): Promise<void> {
  e.click();
  await rendu();
}

/** Clique le premier bouton dont le texte contient `texte` ; rend faux s'il n'y en a pas. */
export async function cliquer(texte: string): Promise<boolean> {
  const b = tous<HTMLButtonElement>('button').find((x) => t(x).includes(texte));
  if (b) await presser(b);
  return !!b;
}

/** Clique le bouton dont le texte est exactement celui-ci. */
export async function cliquerExactement(texte: string): Promise<boolean> {
  const b = tous<HTMLButtonElement>('button').find((x) => t(x) === texte);
  if (b) await presser(b);
  return !!b;
}

/** Va sur un onglet de la barre du bas, par son libellé. */
export async function allerA(onglet: string): Promise<void> {
  const b = tous<HTMLButtonElement>('.tabbar button').find((x) => t(x).includes(onglet));
  if (!b) throw new Error(`pas d’onglet « ${onglet} »`);
  await presser(b);
}

/** Un écran ordinaire, atteint par le menu Plus. */
export async function ecran(nom: string): Promise<boolean> {
  await allerA('Plus');
  return cliquer(nom);
}

/** Saisit une valeur dans un champ, comme le fait la saisie : `input`, puis `change`. */
export async function saisir(champ: HTMLInputElement | HTMLSelectElement, valeur: string): Promise<void> {
  champ.value = valeur;
  champ.dispatchEvent(new Event('input', { bubbles: true }));
  champ.dispatchEvent(new Event('change', { bubbles: true }));
  await rendu();
}

/** Le titre de l'étape et les boutons primaires de l'écran. */
export const lire = () => ({ h2: t(document.querySelector('main h2')), primaires: tous('main .actions button.primary').map(t) });

/** Clique le bouton primaire « Suivant » ou « Commencer » ; rend faux s'il n'y en a pas. */
export async function avancer(): Promise<boolean> {
  const b = tous<HTMLButtonElement>('main .actions button.primary').find((x) => /Suivant|Commencer/.test(t(x)));
  if (b) await presser(b);
  return !!b;
}

/** Va à l'étape nommée par la barre des étapes de l'assistant. */
export async function etape(libelle: string): Promise<boolean> {
  const b = tous<HTMLButtonElement>('.wizard-steps .wstep').find((x) => t(x) === libelle);
  if (b) await presser(b);
  return !!b;
}

/** Ouvre l'assistant sur un projet vierge, depuis le Plan, et passe le principe : on arrive sur l'étape Comptes. */
export async function arriverAuxComptes(): Promise<void> {
  await allerA('Plan');
  if (!(await cliquer('Construire mon budget'))) throw new Error('pas de bouton « Construire mon budget »');
  if (!(await avancer())) throw new Error('le principe ne se franchit pas par son bouton primaire');
  if (lire().h2 !== 'Vos comptes en banque') throw new Error(`étape inattendue : ${lire().h2}`);
}

/** Ouvre l'assistant sur un projet existant, depuis Configuration (« Lancer »), et passe le principe. */
export async function rouvrirAuxComptes(): Promise<void> {
  await allerA('Plus');
  if (!(await cliquer('Lancer'))) throw new Error('pas de bouton « Lancer » pour ouvrir l’assistant');
  if (!(await avancer())) throw new Error('le principe ne se franchit pas par son bouton primaire');
  if (lire().h2 !== 'Vos comptes en banque') throw new Error(`étape inattendue : ${lire().h2}`);
}

/** Du point où l'on est jusqu'au résumé, par les seuls boutons primaires ; rend faux si le résumé n'est pas atteint. */
export async function jusquAuResume(): Promise<boolean> {
  for (let i = 0; i < 14 && !lire().primaires.includes('Valider mon budget'); i++) await avancer();
  return lire().primaires.includes('Valider mon budget');
}

/** Du point où l'on est jusqu'au résumé, puis « Valider mon budget ». */
export async function validerTelQuel(): Promise<void> {
  if (!(await jusquAuResume())) throw new Error('le résumé n’est pas atteint par les boutons primaires');
  if (!(await cliquer('Valider mon budget'))) throw new Error('pas de bouton « Valider mon budget »');
}

/** Un montant lu à l'écran, en centimes : « 3400,00 », « 2 340,00 » ou « 4 200,00 € ». */
export const centimes = (texte: string): number => Math.round(parseFloat(texte.replace(/[^\d,.-]/g, '').replace(',', '.')) * 100);

/** Le premier texte d'un libellé de champ, sans « (facultatif) ». */
const premierTexte = (l: Element) =>
  [...l.childNodes].find((n) => n.nodeType === 3 && (n.textContent ?? '').trim())?.textContent?.replace(/\s+/g, ' ').trim().replace(/ \(facultatif\)$/, '') ?? '';

/** Un champ d'un formulaire ouvert : son libellé, son aide, sa valeur, et l'élément. */
export interface Champ {
  libelle: string;
  aide: string;
  valeur: string;
  el: HTMLInputElement | HTMLSelectElement;
}

/** Les champs des formulaires ouverts de l'écran, par leur libellé. */
export const champs = (): Champ[] =>
  tous('main form label.f')
    .map((l) => ({ l, el: l.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null }))
    .filter((x): x is { l: HTMLElement; el: HTMLInputElement | HTMLSelectElement } => !!x.el)
    .map(({ l, el }) => ({ libelle: premierTexte(l), aide: (el as HTMLInputElement).placeholder ?? '', valeur: el.value, el }));

/** Le champ du formulaire ouvert qui porte ce libellé (exactement). */
export function champ(libelle: string): Champ {
  const c = champs().find((x) => x.libelle === libelle);
  if (!c) throw new Error(`pas de champ « ${libelle} » dans le formulaire ouvert (${champs().map((x) => x.libelle).join(', ')})`);
  return c;
}

/** Ce que dit un champ du formulaire d'édition ouvert, par le début de son libellé : sa valeur, ou sa case cochée. */
export function champQuiCommence(libelle: string): string | boolean | undefined {
  const label = tous('form.edit label.f').find((x) => t(x).startsWith(libelle));
  const el = label?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null | undefined;
  if (!el) return undefined;
  return el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
}

/** Saisit une valeur dans le champ du formulaire d'édition ouvert, par le début de son libellé. */
export async function saisirQuiCommence(libelle: string, valeur: string): Promise<void> {
  const label = tous('form.edit label.f').find((x) => t(x).startsWith(libelle));
  const el = label?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null | undefined;
  if (!el) throw new Error(`champ introuvable : ${libelle}`);
  await saisir(el, valeur);
}
