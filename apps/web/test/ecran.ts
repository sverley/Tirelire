/**
 * L'application montée sans navigateur (#417, #418) : sous jsdom, au jour des tests.
 *
 * Ce que D83 (« Le navigateur au minimum ») laisse aux tests de l'interface sans navigateur — ce qu'un écran
 * montre ou enregistre — se lit ici sur l'application elle-même : `App.svelte` est monté et `app.init()` appelé
 * tels que `main.ts` les monte et les appelle, ses écrans s'y rendent et ses boutons s'y pressent ; ce qu'un test
 * lit, c'est le DOM que les composants produisent, et ce qu'ils enregistrent, le projet que le dépôt relit. jsdom
 * ne met rien en page : aucune mesure de largeur, de position ni de défilement ne se fait ici (D59) ; elles
 * restent au navigateur.
 *
 * Chaque ouverture est une page neuve : les modules de l'application se rechargent (`vi.resetModules`), un nouvel
 * état s'ouvre sur ce que le stockage garde, et ce que la page précédente tenait en mémoire — le brouillon de
 * l'assistant — n'existe plus. `ouvrirLApplication` ouvre sur un stockage vide ; `rouvrirLApplication` recharge :
 * la page se ferme (son `beforeunload` écrit ce qui attendait de l'être, comme dans le navigateur), puis
 * l'application se rouvre sur ce qu'elle a enregistré.
 *
 * Ce qui diffère du site servi, et seulement cela :
 * - le stockage du navigateur (IndexedDB) est une table en mémoire : son écriture sur l'appareil est une capacité
 *   du navigateur (C4, D83), qui ne se vérifie pas ici ; ce que l'application y lit et y écrit (`src/lib/db.ts`),
 *   « Tout effacer » et l'ouverture d'un fichier sont les siens ;
 * - sql.js reçoit son binaire du disque, au lieu de le télécharger ;
 * - l'horloge est fixée au jour des tests, comme `nouvellePage` la fixe dans `harnais.ts`, ou au jour qu'un
 *   fichier choisit (`fixerLeJour`) ;
 * - le service worker ne s'inscrit pas (`vitest.config.ts`) ; le navigateur garde les données (`navigator.storage`) ;
 *   `confirm` répond oui ; `scrollIntoView` et `matchMedia`, que jsdom n'a pas, ne font rien.
 *
 * Un fichier qui s'en sert se déclare `// @vitest-environment jsdom` en tête.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import initSqlJs from 'sql.js';
import type { Ledger } from '@tirelire/core';
import { JOUR_DES_TESTS } from './jour-des-tests';

/** La date de lecture que le jour des tests donne à l'application. */
export const JOUR = JOUR_DES_TESTS.slice(0, 10);

vi.useFakeTimers({ toFake: ['Date'], now: new Date(JOUR_DES_TESTS) });

/** Fixe l'horloge à ce jour, à midi heure de Paris : les pages ouvertes ensuite lisent à cette date. */
export function fixerLeJour(jour: string): void {
  vi.setSystemTime(new Date(`${jour}T12:00:00+02:00`));
}

Element.prototype.scrollIntoView = () => {};
window.matchMedia = ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
window.confirm = () => true;
window.alert = () => {};
Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: async () => true, persist: async () => true } });

const requerir = createRequire(resolve(process.cwd(), 'package.json'));
const BINAIRE = readFileSync(requerir.resolve('sql.js/dist/sql-wasm.wasm')) as unknown as ArrayBuffer;
const SQL = initSqlJs({ wasmBinary: BINAIRE });
vi.doMock('sql.js', () => ({ default: () => SQL }));

/**
 * Le stockage du navigateur, en mémoire : une base par nom, une table par magasin. Il répond comme IndexedDB, de
 * façon asynchrone — chaque requête, puis la fin de sa transaction —, à ce que `src/lib/db.ts` en utilise.
 */
const stockage = new Map<string, Map<string, Map<IDBValidKey, unknown>>>();
const plusTard = (f: () => void) => setTimeout(f, 0);
type Requete = { result?: unknown; error: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null; onupgradeneeded?: (() => void) | null };
function requete(faire: () => unknown): Requete {
  const r: Requete = { error: null, onsuccess: null, onerror: null };
  plusTard(() => {
    r.result = faire();
    r.onsuccess?.();
  });
  return r;
}
const copie = (v: unknown) => (v instanceof Uint8Array ? v.slice() : v);
function baseOuverte(base: Map<string, Map<IDBValidKey, unknown>>) {
  return {
    objectStoreNames: { contains: (nom: string) => base.has(nom) },
    createObjectStore: (nom: string) => void base.set(nom, new Map()),
    close: () => {},
    transaction(nom: string) {
      const magasin = base.get(nom)!;
      const tx = { error: null, oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, objectStore: () => objet };
      const objet = {
        get: (cle: IDBValidKey) => requete(() => copie(magasin.get(cle))),
        put: (valeur: unknown, cle: IDBValidKey) => requete(() => (magasin.set(cle, copie(valeur)), cle)),
        delete: (cle: IDBValidKey) => requete(() => void magasin.delete(cle)),
      };
      plusTard(() => plusTard(() => tx.oncomplete?.()));
      return tx;
    },
  };
}
(globalThis as unknown as { indexedDB: unknown }).indexedDB = {
  open(nom: string) {
    const r: Requete = { error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
    plusTard(() => {
      const neuve = !stockage.has(nom);
      if (neuve) stockage.set(nom, new Map());
      r.result = baseOuverte(stockage.get(nom)!);
      if (neuve) r.onupgradeneeded?.();
      r.onsuccess?.();
    });
    return r;
  },
};

/** Attend que ce que l'application a lancé de façon asynchrone — une écriture, une ouverture — soit fini. */
export const pause = (ms = 30) => new Promise<void>((fin) => setTimeout(fin, ms));

/** Attend que la condition soit vraie, en laissant l'application rendre ; échoue au bout d'un moment. */
export async function attendre(condition: () => boolean, quoi = 'la condition'): Promise<void> {
  for (let i = 0; i < 200; i++) {
    await rendu();
    if (condition()) return;
    await pause(10);
  }
  throw new Error(`${quoi} n’est pas venue`);
}

type Etat = typeof import('../src/lib/state.svelte');
type Svelte = typeof import('svelte');

/** L'état de l'application de la page ouverte. */
export let app: Etat['app'];
let svelte: Svelte | undefined;
let monte: ReturnType<Svelte['mount']> | undefined;
let cible: HTMLElement | undefined;

// Les écoutes que la page pose sur `window` (l'adresse, la fermeture) s'en vont avec elle.
let ecoutes: Array<Parameters<typeof window.addEventListener>> = [];
const ecouter = window.addEventListener.bind(window);
window.addEventListener = ((...a: Parameters<typeof window.addEventListener>) => {
  ecoutes.push(a);
  ecouter(...a);
}) as typeof window.addEventListener;

/** Ferme la page : ce qui attendait d'être écrit l'est (`beforeunload`), puis plus rien d'elle ne vit. */
async function fermerLaPage(): Promise<void> {
  if (!svelte) return;
  window.dispatchEvent(new Event('beforeunload'));
  await pause();
  if (monte) svelte.unmount(monte);
  // La mémoire de la page s'en va avec elle : sa base sql.js se ferme (`opened`, privé dans `state.svelte.ts`).
  (app as unknown as { opened?: { store: { close(): void } } }).opened?.store.close();
  cible?.remove();
  for (const a of ecoutes) window.removeEventListener(a[0], a[1], a[2]);
  ecoutes = [];
  monte = undefined;
}

/** Ouvre une page neuve à cette adresse (« / », ou une adresse qui porte un budget) : comme `main.ts`. */
async function ouvrirUnePage(adresse: string): Promise<void> {
  window.history.replaceState(null, '', adresse);
  vi.resetModules();
  svelte = await import('svelte');
  ({ app } = await import('../src/lib/state.svelte'));
  const { default: App } = await import('../src/App.svelte');
  const pret = app.init();
  cible = document.createElement('div');
  document.body.append(cible);
  monte = svelte.mount(App, { target: cible });
  await pret;
  await rendu();
}

/**
 * Ouvre l'application pour la première fois, sur un stockage vide — un projet vierge —, sur l'écran Plan, comme
 * une page neuve de `harnais.ts`. `adresse` est l'adresse d'ouverture : `/` sans rien, ou `/#budget=…`.
 */
export async function ouvrirLApplication(adresse = '/'): Promise<void> {
  await fermerLaPage();
  stockage.clear();
  await ouvrirUnePage(adresse);
}

/** Recharge l'application : la page se ferme, et l'application se rouvre sur ce qu'elle a enregistré. */
export async function rouvrirLApplication(adresse = '/'): Promise<void> {
  await fermerLaPage();
  await ouvrirUnePage(adresse);
}

/** Laisse l'application rendre ce qui vient de changer. */
export async function rendu(): Promise<void> {
  svelte!.flushSync();
  await svelte!.tick();
  svelte!.flushSync();
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
