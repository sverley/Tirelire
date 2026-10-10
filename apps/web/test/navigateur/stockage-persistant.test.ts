/**
 * Harnais d'audit de #42 — « Les données du navigateur doivent être protégées de l'effacement ».
 * Garde la part de C4 que #42 construit : « si le navigateur manque de place et que l'application
 * n'a pas demandé à les rendre persistantes ». Fichier de niveau 0 et 1, que le registre cite sous C4
 * (point 7 : la ligne « À bâtir » y devient ce harnais) ; les niveaux 2 à 4 — les textes vouvoient
 * (D85) — se vérifient sans navigateur, dans `../stockage-persistant-ecran.test.ts` (#421), hors registre
 * (D81).
 *
 * Tout se passe dans le navigateur, sur le site construit : la demande, ce que le navigateur répond,
 * l'accueil et Réglages. Le harnais règle la réponse du navigateur par les deux appels du standard
 * Storage qui demandent et qui lisent la persistance, `navigator.storage.persist()` et
 * `navigator.storage.persisted()`, remplacés avant tout script de la page. Quatre réponses :
 *
 * - « accordée » : pas encore persistante à l'ouverture, `persist()` l'accorde ;
 * - « refusée » : pas persistante, `persist()` la refuse ;
 * - « impossible » : le navigateur n'offre pas la demande — ni `persist` ni `persisted` sur
 *   `navigator.storage` ;
 * - « déjà » : persistante dès l'ouverture, accordée à une ouverture précédente.
 *
 * Une ouverture suivante rouvre la même page, dans le même contexte, donc les mêmes données, avec la
 * réponse réglée pour elle. Un dernier test laisse le vrai Chromium répondre, sans rien remplacer :
 * ce que l'accueil dit doit s'accorder à ce qu'il a accordé.
 *
 * Il ne suppose rien de ce que l'issue laisse au codeur : ni la forme ni la place du signal, ni ses
 * mots au-delà de ceux du point 3, ni le code qui demande. Ce qu'il lit :
 *
 * - **le signal** : le plus petit élément visible de la page, hors barre d'onglets, dont le texte dit à la
 *   fois « effac… » et « navigateur » — « les données peuvent être effacées par le navigateur »
 *   (point 3) ; ses commandes sont les boutons et liens de son plus proche bloc qui en porte, sous
 *   `main`, l'en-tête ou le corps de la page ;
 * - **la carte « Données »** de Réglages, que l'issue nomme : l'élément qui suit le titre
 *   « Données » ;
 * - **l'accueil** : l'écran que l'application montre à l'ouverture, sans aucun geste ;
 * - **les données de `main`** : le fichier de l'exemple, écrit avant toute ouverture là où `main`
 *   l'écrit — base IndexedDB « tirelire », magasin « files », clé « ledger.sqlite » —, sur la même
 *   origine, puis relu au même endroit après l'ouverture.
 *
 * Chaque `describe` reprend un point du « Fait quand » de l'issue, sous son numéro :
 *
 * 1. À chaque ouverture où les données ne sont pas persistantes — base vide ou garnie, première
 *    ouverture ou suivante, réponse accordée ou refusée —, `persist()` est appelé sans aucun geste.
 * 2. Accordée, refusée, impossible : la carte « Données » dit trois choses différentes, et
 *    l'application ne lève aucune erreur quand la demande n'existe pas.
 * 3. Refusée ou impossible : le signal paraît sur l'accueil sans geste ; il ne bloque rien — chaque
 *    onglet reste sous le doigt et s'ouvre, aucune fenêtre modale ni boîte de dialogue, le plan reste
 *    affiché — ; la carte « Données » le redit (« atteignable depuis Réglages »).
 * 4. Refusée ou impossible : une commande du signal mène en un geste à l'export du fichier, le moyen
 *    qui existe aujourd'hui sans capacité propre à une plateforme ni geste technique — soit le geste
 *    télécharge lui-même le fichier, soit il amène à l'écran, visible sans défiler, une commande qui
 *    le télécharge (« Exporter », « Sauvegarder », « Télécharger », « Enregistrer », « copie ») —, et
 *    le fichier téléchargé est une base SQLite qui porte les données.
 * 5. Accordée à cette ouverture, déjà accordée, ou accordée à l'ouverture qui suit un refus : pas de
 *    signal sur l'accueil, et la carte « Données » dit que les données sont gardées (« gardées »,
 *    « conservées », « protégées », « persistantes » ou « persistance », en mots entiers).
 * 6. Sous chaque réponse, les données de `main` sont toujours là, au même endroit, et l'application
 *    les montre ; aucune requête ne sort : seules des lectures (GET) de l'origine qui sert
 *    l'application partent.
 * 7. Le registre : en relisant (D81).
 *
 * Les assertions sont dans des fonctions à part, pour que les témoins rouges, en fin de chaque
 * point, rejouent les mêmes sur une version volontairement cassée du besoin ; les témoins se jouent
 * sans navigateur.
 *
 * Niveaux (D83), marqués dans chaque titre ; un témoin a le niveau de ce qu'il garde :
 * - 0 : points 1, 3 et 6 — une demande qui ne part plus, ou un risque d'effacement que l'accueil
 *   tait, laissent le navigateur effacer des données que rien ne rendra ; une base déplacée ou une
 *   requête sortie le sont pour de bon (I7).
 * - 1 : points 2, 4 et 5 — la promesse de C4 et de C5 tombe (dire ce qui est obtenu, mener à la
 *   sauvegarde, se taire une fois accordée), sans qu'une donnée soit perdue par là.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import { LEDGER_KEYS, LedgerStore, exampleLedger } from '@tirelire/core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

type Réponse = 'accordée' | 'refusée' | 'impossible' | 'déjà';

/** Les lignes de chaque table, par identifiant : ce qui doit survivre à l'ouverture. */
type Contenu = Record<string, string[]>;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Ce qu'on exige de chaque point
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface Ouverture {
  où: string;
  demandes: number;
  erreurs: string[];
}

function vérifierDemande(o: Ouverture): void {
  expect(o.demandes, `${o.où} : l'application n'a pas demandé au navigateur de garder ses données (navigator.storage.persist() jamais appelé)`).toBeGreaterThan(0);
}

interface Accueil {
  où: string;
  /** Le texte du signal, ou `null` s'il n'y en a pas. */
  signal: string | null;
}

function vérifierSignal(a: Accueil): void {
  expect(a.signal, `${a.où} : l'accueil ne dit pas que les données peuvent être effacées par le navigateur`).not.toBeNull();
}

function vérifierSansSignal(a: Accueil): void {
  expect(a.signal, `${a.où} : l'accueil signale encore un risque d'effacement : « ${a.signal} »`).toBeNull();
}

interface Étape {
  onglet: string;
  /** « ouvert », ou ce qui en a empêché. */
  résultat: string;
}

interface Tour {
  où: string;
  étapes: Étape[];
  modales: string[];
  dialogues: string[];
  planAffiché: boolean;
}

function vérifierRienNeBloque(t: Tour): void {
  expect(t.dialogues, `${t.où} : une boîte de dialogue a interrompu l'utilisateur : ${t.dialogues.join(' | ')}`).toEqual([]);
  expect(t.modales, `${t.où} : une fenêtre modale couvre l'écran : ${t.modales.join(' | ')}`).toEqual([]);
  expect(t.planAffiché, `${t.où} : l'accueil ne montre plus le plan à côté du signal`).toBe(true);
  const bloquées = t.étapes.filter((é) => é.résultat !== 'ouvert');
  expect(bloquées, `${t.où} : des onglets ne s'ouvrent plus : ${bloquées.map((é) => `${é.onglet} (${é.résultat})`).join(', ')}`).toEqual([]);
}

interface CarteDonnées {
  réponse: Réponse;
  /** Le texte de la carte « Données » de Réglages, ou `null` si elle est introuvable. */
  texte: string | null;
}

const DIT_LE_RISQUE = (s: string) => /effac/i.test(s) && /navigateur/i.test(s);

/** « gardées », « conservées », « protégées », « persistantes », « persistance », en mots entiers : « sauvegarde » n'y répond pas. */
const DIT_GARDÉES = (s: string) => /(?<!\p{L})(gardée?s?|conservée?s?|protégée?s?|persistante?s?|persistance)(?!\p{L})/iu.test(s);

function vérifierRéglagesRedisentLeSignal(c: CarteDonnées): void {
  expect(c.texte, `Réglages (${c.réponse}) : aucune carte « Données »`).not.toBeNull();
  expect(DIT_LE_RISQUE(c.texte!), `Réglages (${c.réponse}) : la carte « Données » ne redit pas que les données peuvent être effacées par le navigateur : « ${c.texte} »`).toBe(true);
}

function vérifierTroisRéponsesDistinguées(cartes: CarteDonnées[]): void {
  for (const c of cartes) expect(c.texte, `Réglages (${c.réponse}) : aucune carte « Données »`).not.toBeNull();
  for (let i = 0; i < cartes.length; i++)
    for (let j = i + 1; j < cartes.length; j++)
      expect(cartes[i]!.texte, `Réglages : la carte « Données » dit la même chose quand la persistance est ${cartes[i]!.réponse} et quand elle est ${cartes[j]!.réponse} : « ${cartes[i]!.texte} »`).not.toBe(cartes[j]!.texte);
}

function vérifierSansErreur(o: Ouverture): void {
  expect(o.erreurs, `${o.où} : la page a levé des erreurs`).toEqual([]);
}

function vérifierRéglagesGardées(c: CarteDonnées): void {
  expect(c.texte, `Réglages (${c.réponse}) : aucune carte « Données »`).not.toBeNull();
  expect(DIT_GARDÉES(c.texte!), `Réglages (${c.réponse}) : la carte « Données » ne dit pas que les données sont gardées : « ${c.texte} »`).toBe(true);
}

interface Protection {
  où: string;
  /** Le chemin qui a mené au fichier : la commande du signal, puis celle de l'écran s'il y en a une. */
  chemin: string | null;
  essais: string[];
  /** Le fichier téléchargé : son en-tête et le nombre de tirelires qu'il porte. */
  fichier: { entête: string; tirelires: number } | null;
}

function vérifierProtection(p: Protection): void {
  expect(p.chemin, `${p.où} : aucune commande du signal ne mène en un geste à l'export du fichier (essais : ${p.essais.join(' ; ') || 'le signal ne porte ni bouton ni lien'})`).not.toBeNull();
  expect(p.fichier?.entête, `${p.où} : ce que « ${p.chemin} » télécharge n'est pas une base SQLite`).toBe('SQLite format 3');
  expect(p.fichier!.tirelires, `${p.où} : le fichier que « ${p.chemin} » télécharge ne porte pas les tirelires des données`).toBeGreaterThan(0);
}

interface Base {
  où: string;
  avant: Contenu;
  /** Ce que la base de `main` porte après l'ouverture, au même endroit, ou `null` si elle n'y est plus. */
  après: Contenu | null;
  /** L'application montre-t-elle les données (plus de « Charger l'exemple ») ? */
  montrées: boolean;
}

function vérifierBaseIntacte(b: Base): void {
  expect(b.après, `${b.où} : la base de main n'est plus à son adresse (IndexedDB « tirelire », « files », « ledger.sqlite »)`).not.toBeNull();
  for (const table of Object.keys(b.avant)) {
    const perdues = b.avant[table]!.filter((id) => !b.après![table]?.includes(id));
    expect(perdues, `${b.où} : des lignes de ${table} ont disparu`).toEqual([]);
  }
  expect(b.montrées, `${b.où} : l'application ne montre pas les données de main (elle propose de charger l'exemple)`).toBe(true);
}

interface Requête {
  méthode: string;
  url: string;
  corps: boolean;
}

function vérifierRienNeSort(où: string, origine: string, requêtes: Requête[]): void {
  const sorties = requêtes.filter((r) => {
    if (/^(data|blob):/.test(r.url)) return false;
    return r.méthode !== 'GET' || r.corps || new URL(r.url).origin !== origine;
  });
  expect(sorties, `${où} : des requêtes sont parties hors des lectures de l'application : ${sorties.map((r) => `${r.méthode} ${r.url}`).join(', ')}`).toEqual([]);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Réponse du navigateur, ouverture, lectures
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Le script qui règle la réponse du navigateur, par page : remplacé à chaque ouverture. */
const scripts = new WeakMap<Page, string>();

/** Règle ce que le navigateur répondra à la prochaine ouverture de la page. */
async function régler(page: Page, réponse: Réponse): Promise<void> {
  const ancien = scripts.get(page);
  if (ancien) await page.removeScriptToEvaluateOnNewDocument(ancien);
  const { identifier } = await page.evaluateOnNewDocument((r: string) => {
    const journal = { demandes: 0 };
    Object.defineProperty(window, '__persistance42', { value: journal });
    const proto = (window as unknown as { StorageManager?: { prototype: Record<string, unknown> } }).StorageManager?.prototype;
    if (!proto) return;
    if (r === 'impossible') {
      delete proto['persist'];
      delete proto['persisted'];
      return;
    }
    let persistante = r === 'déjà';
    proto['persisted'] = function persisted() {
      return Promise.resolve(persistante);
    };
    proto['persist'] = function persist() {
      journal.demandes++;
      if (r !== 'refusée') persistante = true;
      return Promise.resolve(persistante);
    };
  }, réponse);
  scripts.set(page, identifier);
}

/** Une page neuve, les requêtes, erreurs et boîtes de dialogue notées. */
async function page42(site: Site): Promise<{ page: Page; requêtes: Requête[]; erreurs: string[]; dialogues: string[] }> {
  const page = await nouvellePage(site);
  const requêtes: Requête[] = [];
  const erreurs: string[] = [];
  const dialogues: string[] = [];
  page.on('request', (r) => requêtes.push({ méthode: r.method(), url: r.url(), corps: !!r.postData() }));
  page.on('pageerror', (e) => erreurs.push(e instanceof Error ? e.message : String(e)));
  page.on('dialog', (d) => {
    dialogues.push(d.message());
    void d.dismiss();
  });
  return { page, requêtes, erreurs, dialogues };
}

/** Ouvre (ou rouvre) l'application et attend qu'elle soit prête : la base ouverte, l'écran monté. */
async function ouvrir(page: Page, site: Site, réponse: Réponse, rouvrir = false): Promise<void> {
  await régler(page, réponse);
  if (rouvrir) await page.reload({ waitUntil: 'networkidle0' });
  else await page.goto(site.url, { waitUntil: 'networkidle0' });
  const fin = Date.now() + 15_000;
  while (Date.now() < fin) {
    const prête = await page
      .evaluate(() => !!document.querySelector('main') && !document.body.textContent?.includes('Ouverture de la base'))
      .catch(() => false);
    if (prête) return;
    await pause(100);
  }
  throw new Error(`l'application ne s'est pas ouverte (réponse ${réponse})`);
}

/** Combien de fois cette ouverture a demandé la persistance, attendu au plus `délai` ms. */
async function demandes(page: Page, délai = 5_000): Promise<number> {
  const fin = Date.now() + délai;
  let n = 0;
  while (Date.now() < fin) {
    n = await page.evaluate(() => (window as unknown as { __persistance42?: { demandes: number } }).__persistance42?.demandes ?? 0);
    if (n > 0) return n;
    await pause(100);
  }
  return n;
}

/**
 * Localise le signal dans la page : le plus petit élément visible, hors barre d'onglets, dont le
 * texte dit « effac… » et « navigateur » ; ses commandes, celles de son plus proche bloc qui en porte.
 * Exécutée dans la page ; `cliquer` ≥ 0 clique la commande de ce rang.
 */
function signalDansLaPage(cliquer: number): { texte: string | null; commandes: string[]; cliqué: boolean } {
  const t = (e: Element) => (e.textContent ?? '').replace(/\s+/g, ' ').trim();
  const dit = (s: string) => /effac/i.test(s) && /navigateur/i.test(s);
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect();
    const st = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const candidats = [...document.body.querySelectorAll('*')].filter((e) => !e.closest('.tabbar, script, style, template') && dit(t(e)) && visible(e));
  const feuille = candidats.find((e) => ![...e.children].some((c) => dit(t(c))));
  if (!feuille) return { texte: null, commandes: [], cliqué: false };
  const COMMANDE = 'button, a[href], [role="button"]';
  const bornes = new Set<Element | null>([document.body, document.documentElement, document.querySelector('main'), document.querySelector('header')]);
  let commandes: HTMLElement[] = [];
  const englobante = feuille.closest(COMMANDE) as HTMLElement | null;
  if (englobante) commandes = [englobante];
  else
    for (let bloc: Element | null = feuille; bloc && !bornes.has(bloc); bloc = bloc.parentElement) {
      const trouvées = [...bloc.querySelectorAll<HTMLElement>(COMMANDE)].filter(visible);
      if (trouvées.length) {
        commandes = trouvées;
        break;
      }
    }
  const cible = cliquer >= 0 ? commandes[cliquer] : undefined;
  cible?.click();
  return { texte: t(feuille), commandes: commandes.map((c) => t(c) || c.getAttribute('aria-label') || c.tagName), cliqué: !!cible };
}

/** Le signal sur l'écran courant ; attendu au plus `délai` ms s'il doit paraître. */
async function lireLeSignal(page: Page, délai: number): Promise<{ texte: string | null; commandes: string[] }> {
  const fin = Date.now() + délai;
  let lu = await page.evaluate(signalDansLaPage, -1);
  while (!lu.texte && Date.now() < fin) {
    await pause(100);
    lu = await page.evaluate(signalDansLaPage, -1);
  }
  return lu;
}

/** L'accueil après l'ouverture, sans aucun geste : le signal s'il paraît dans les 5 s, ou son absence après 2 s. */
async function lireLAccueil(page: Page, où: string, attendu: boolean): Promise<Accueil> {
  if (!attendu) await pause(2_000);
  const { texte } = await lireLeSignal(page, attendu ? 5_000 : 0);
  return { où, signal: texte };
}

/** La carte « Données » de Réglages, par la barre d'onglets et la Configuration. */
async function lireLaCarteDonnées(page: Page, réponse: Réponse): Promise<CarteDonnées> {
  await allerÀ(page, 'Plus');
  await cliquer(page, 'Réglages');
  await pause(300);
  const texte = await page.evaluate(() => {
    const titre = [...document.querySelectorAll('main h1, main h2, main h3')].find((h) => h.textContent?.trim() === 'Données');
    const carte = titre?.nextElementSibling;
    return carte ? (carte.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
  });
  return { réponse, texte };
}

/** Le tour des onglets depuis l'accueil, signal affiché : chaque onglet sous le doigt, et ouvert. */
async function faireLeTour(page: Page, où: string, dialogues: string[]): Promise<Tour> {
  const planAffiché = await page.evaluate(() => [...document.querySelectorAll('main h2')].some((h) => h.textContent?.trim() === 'Tirelires'));
  const étapes: Étape[] = [];
  const modales = new Set<string>();
  for (const onglet of ['Opérations', 'Import', 'Bilan', 'Plus', 'Plan']) {
    const résultat = await page.evaluate((libellé: string) => {
      const b = [...document.querySelectorAll<HTMLElement>('.tabbar button')].find((x) => x.textContent?.includes(libellé));
      if (!b) return 'onglet introuvable';
      const r = b.getBoundingClientRect();
      const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!dessus || !b.contains(dessus)) return `couvert par ${dessus ? `${dessus.tagName.toLowerCase()}.${dessus.className}` : 'rien'}`;
      b.click();
      return 'cliqué';
    }, onglet);
    await pause(250);
    const lu = await page.evaluate((libellé: string) => {
      const actif = document.querySelector('.tabbar button.active')?.textContent ?? '';
      const m = [...document.querySelectorAll('dialog[open], [aria-modal="true"], [role="alertdialog"]')].map((e) => (e.textContent ?? '').trim().slice(0, 80));
      return { ouvert: actif.includes(libellé), modales: m };
    }, onglet);
    lu.modales.forEach((m) => modales.add(m));
    étapes.push({ onglet, résultat: résultat !== 'cliqué' ? résultat : lu.ouvert ? 'ouvert' : 'cliqué, mais l’écran n’a pas changé' });
  }
  return { où, étapes, modales: [...modales], dialogues: [...dialogues], planAffiché };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Les données de main
// ─────────────────────────────────────────────────────────────────────────────────────────────

const SQL = await initSqlJs();

/** L'exemple, chargé comme l'application le fait (`replaceWith`), exporté comme `main` l'enregistre. */
async function fichierDeMain(): Promise<Uint8Array> {
  const store = await LedgerStore.create({ sqlJs: SQL });
  const l = exampleLedger();
  for (const cle of LEDGER_KEYS) for (const r of l[cle]) store.upsert(cle, r as never);
  for (const [k, v] of Object.entries(l.settings)) if (k !== 'siteId') store.setSetting(k as never, v as never);
  const octets = store.export();
  store.close();
  return octets;
}

async function contenu(octets: Uint8Array): Promise<Contenu> {
  const store = await LedgerStore.create({ sqlJs: SQL, bytes: octets });
  const l = store.load() as unknown as Record<string, Array<{ id: string }>>;
  const c: Contenu = {};
  for (const cle of LEDGER_KEYS) c[cle] = l[cle]!.map((r) => r.id).sort();
  store.close();
  return c;
}

const enBase64 = (o: Uint8Array) => Buffer.from(o).toString('base64');

/** Écrit le fichier là où `main` l'écrit, sur l'origine du site, avant toute ouverture de l'application. */
async function semerLaBaseDeMain(page: Page, site: Site, octets: Uint8Array): Promise<void> {
  await page.goto(new URL('icon.svg', site.url).href, { waitUntil: 'load' });
  await page.evaluate(async (b64: string) => {
    const octets = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await new Promise<void>((ok, ko) => {
      const req = indexedDB.open('tirelire', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onerror = () => ko(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put(octets, 'ledger.sqlite');
        tx.oncomplete = () => {
          db.close();
          ok();
        };
        tx.onerror = () => ko(tx.error);
      };
    });
  }, enBase64(octets));
}

/** Relit le fichier à l'endroit où `main` l'écrit, ou `null` s'il n'y est plus. */
async function relireLaBaseDeMain(page: Page): Promise<Uint8Array | null> {
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
  return b64 === null ? null : new Uint8Array(Buffer.from(b64, 'base64'));
}

const donnéesMontrées = (page: Page) => page.evaluate(() => ![...document.querySelectorAll('button')].some((b) => b.textContent?.includes("Charger l'exemple")));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Téléchargements (point 4)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Suit les téléchargements du contexte de la page : chaque `attendre` les dirige vers un dossier
 * neuf, puis rend le premier fichier téléchargé — ou `null` si aucun n'a commencé dans `départ` ms.
 * La session reste ouverte tant que la page sert : la fermer rendrait au navigateur son réglage.
 */
async function suivreLesTéléchargements(site: Site, page: Page) {
  const cdp = await site.chrome.target().createCDPSession();
  const contexte = page.browserContext().id;
  const commencés = new Set<string>();
  const finis = new Map<string, boolean>();
  cdp.on('Browser.downloadWillBegin', (e: { guid: string }) => commencés.add(e.guid));
  cdp.on('Browser.downloadProgress', (e: { guid: string; state: string }) => {
    if (e.state !== 'inProgress') finis.set(e.guid, e.state === 'completed');
  });
  let dossier = '';
  return {
    /** À appeler avant le geste : le prochain téléchargement ira dans un dossier neuf. */
    async préparer(): Promise<void> {
      if (dossier) rmSync(dossier, { recursive: true, force: true });
      dossier = mkdtempSync(join(tmpdir(), 'tirelire-42-'));
      commencés.clear();
      finis.clear();
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dossier, eventsEnabled: true, ...(contexte ? { browserContextId: contexte } : {}) });
    },
    /** Après le geste : le fichier téléchargé, ou `null`. */
    async fichier(départ = 2_000): Promise<Uint8Array | null> {
      const début = Date.now();
      while (!commencés.size && Date.now() - début < départ) await pause(100);
      if (!commencés.size) return null;
      const fin = Date.now() + 20_000;
      while (Date.now() < fin && ![...finis.values()].some(Boolean)) await pause(100);
      const fichiers = readdirSync(dossier).filter((f) => !f.endsWith('.crdownload'));
      return fichiers.length ? new Uint8Array(readFileSync(join(dossier, fichiers[0]!))) : null;
    },
    async fermer(): Promise<void> {
      await cdp.detach().catch(() => {});
      if (dossier) rmSync(dossier, { recursive: true, force: true });
    },
  };
}

/** Les commandes visibles sans défiler, hors barres, qui disent sauvegarder ou exporter ; `cliquer` ≥ 0 clique celle de ce rang. */
function sauvegardesÀLÉcran(cliquer: number): string[] {
  const t = (e: Element) => (e.textContent ?? '').replace(/\s+/g, ' ').trim();
  const trouvées = [...document.querySelectorAll<HTMLElement>('button, a[href], label, [role="button"]')].filter((e) => {
    if (e.closest('.tabbar, .topbar')) return false;
    if (!/export|sauvegard|télécharg|enregistr|copie/i.test(t(e))) return false;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
    const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
    const dessus = document.elementFromPoint(x, y);
    return !!dessus && (e.contains(dessus) || dessus.contains(e));
  });
  trouvées[cliquer]?.click();
  return trouvées.map(t);
}

/** Cherche, sous la réponse donnée, une commande du signal qui mène en un geste au fichier exporté. */
async function chercherLaProtection(site: Site, réponse: Réponse, octets: Uint8Array): Promise<Protection> {
  const où = `persistance ${réponse}`;
  const { page } = await page42(site);
  const téléchargements = await suivreLesTéléchargements(site, page);
  const essais: string[] = [];
  try {
    await semerLaBaseDeMain(page, site, octets);
    await ouvrir(page, site, réponse);
    const { texte, commandes } = await lireLeSignal(page, 5_000);
    if (!texte) return { où, chemin: null, essais: ['aucun signal sur l’accueil'], fichier: null };
    const lireLeFichier = async (o: Uint8Array) => {
      const entête = new TextDecoder().decode(o.subarray(0, 15));
      let tirelires = 0;
      if (entête === 'SQLite format 3') tirelires = (await contenu(o).catch(() => ({}) as Contenu))['tirelires']?.length ?? 0;
      return { entête, tirelires };
    };
    for (let k = 0; k < commandes.length; k++) {
      // Le geste seul.
      await téléchargements.préparer();
      await ouvrir(page, site, réponse, true);
      await lireLeSignal(page, 5_000);
      await page.evaluate(signalDansLaPage, k);
      await pause(400);
      let fichier = await téléchargements.fichier();
      if (fichier) return { où, chemin: commandes[k]!, essais, fichier: await lireLeFichier(fichier) };
      const àLÉcran = await page.evaluate(sauvegardesÀLÉcran, -1);
      essais.push(`« ${commandes[k]} » → ${àLÉcran.length ? àLÉcran.map((s) => `« ${s} »`).join(', ') : 'aucune commande de sauvegarde visible'}`);
      // Le geste, puis chaque commande de sauvegarde visible à l'écran où il mène.
      for (let j = 0; j < àLÉcran.length; j++) {
        await téléchargements.préparer();
        await ouvrir(page, site, réponse, true);
        await lireLeSignal(page, 5_000);
        await page.evaluate(signalDansLaPage, k);
        await pause(400);
        await page.evaluate(sauvegardesÀLÉcran, j);
        fichier = await téléchargements.fichier();
        if (fichier) return { où, chemin: `${commandes[k]} → ${àLÉcran[j]}`, essais, fichier: await lireLeFichier(fichier) };
        essais.push(`« ${commandes[k]} » → « ${àLÉcran[j]} » : rien de téléchargé`);
      }
    }
    return { où, chemin: null, essais, fichier: null };
  } finally {
    await téléchargements.fermer();
    await page.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Les points du « Fait quand »
// ─────────────────────────────────────────────────────────────────────────────────────────────

let site: Site;
let octets: Uint8Array;
let avant: Contenu;

beforeAll(async () => {
  octets = await fichierDeMain();
  avant = await contenu(octets);
  if (navigateur) site = await ouvrirLeSite();
}, 120_000);

afterAll(async () => {
  await site?.fermer();
});

describe('[niveau 0] C4 · #42 · 1. l’application demande', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('à chaque ouverture où les données ne sont pas persistantes, la demande part sans geste', async () => {
      const { page } = await page42(site);
      try {
        await ouvrir(page, site, 'refusée');
        const o1 = { où: 'base vide, première ouverture, refusée', demandes: await demandes(page), erreurs: [] };
        await ouvrir(page, site, 'refusée', true);
        const o2 = { où: 'base vide, ouverture suivante, refusée', demandes: await demandes(page), erreurs: [] };
        vérifierDemande(o1);
        vérifierDemande(o2);
      } finally {
        await page.close();
      }
      const garnie = await page42(site);
      try {
        await semerLaBaseDeMain(garnie.page, site, octets);
        await ouvrir(garnie.page, site, 'accordée');
        const o3 = { où: 'données de main, première ouverture, accordée', demandes: await demandes(garnie.page), erreurs: [] };
        await ouvrir(garnie.page, site, 'refusée', true);
        const o4 = { où: 'données de main, ouverture suivante, refusée', demandes: await demandes(garnie.page), erreurs: [] };
        vérifierDemande(o3);
        vérifierDemande(o4);
      } finally {
        await garnie.page.close();
      }
    }, 120_000);
  });

  it.fails('témoin rouge · une ouverture qui ne demande pas au navigateur de garder les données', () => {
    vérifierDemande({ où: 'base vide, première ouverture, refusée', demandes: 0, erreurs: [] });
  });
});

describe('[niveau 1] C4 · #42 · 2. elle sait ce qu’elle a obtenu', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('accordée, refusée, impossible : Réglages, carte « Données », dit trois choses différentes, sans erreur', async () => {
      // Une seule instance, trois ouvertures : seule la réponse du navigateur change d'une carte à
      // l'autre, pas les données ni l'identité de l'appareil que la carte affiche.
      const cartes: CarteDonnées[] = [];
      const ouvertures: Ouverture[] = [];
      const { page, erreurs } = await page42(site);
      try {
        await semerLaBaseDeMain(page, site, octets);
        let rouvrir = false;
        for (const réponse of ['accordée', 'refusée', 'impossible'] as const) {
          erreurs.length = 0;
          await ouvrir(page, site, réponse, rouvrir);
          rouvrir = true;
          await demandes(page, réponse === 'impossible' ? 1_500 : 5_000);
          await pause(500);
          cartes.push(await lireLaCarteDonnées(page, réponse));
          ouvertures.push({ où: `persistance ${réponse}`, demandes: 0, erreurs: [...erreurs] });
        }
      } finally {
        await page.close();
      }
      ouvertures.forEach(vérifierSansErreur);
      vérifierTroisRéponsesDistinguées(cartes);
    }, 120_000);
  });

  it.fails('témoin rouge · des Réglages qui disent la même chose, accordée ou refusée', () => {
    const texte = 'Tout est stocké dans ce navigateur, dans un fichier SQLite. Exporter le fichier SQLite';
    vérifierTroisRéponsesDistinguées([
      { réponse: 'accordée', texte },
      { réponse: 'refusée', texte },
      { réponse: 'impossible', texte: `${texte} (demande impossible)` },
    ]);
  });
  it.fails('témoin rouge · une application qui plante quand le navigateur n’offre pas la demande', () => {
    vérifierSansErreur({ où: 'persistance impossible', demandes: 0, erreurs: ['navigator.storage.persist is not a function'] });
  });
});

describe('[niveau 0] C4 · #42 · 3. tant que les données restent effaçables, l’utilisateur le sait sans chercher', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    for (const réponse of ['refusée', 'impossible'] as const) {
      it(`${réponse} : le signal paraît dès l’accueil, ne bloque rien, et Réglages le redit`, async () => {
        const { page, dialogues } = await page42(site);
        try {
          await semerLaBaseDeMain(page, site, octets);
          await ouvrir(page, site, réponse);
          const accueil = await lireLAccueil(page, `persistance ${réponse}, à l’ouverture`, true);
          vérifierSignal(accueil);
          const tour = await faireLeTour(page, `persistance ${réponse}`, dialogues);
          vérifierRienNeBloque(tour);
          vérifierRéglagesRedisentLeSignal(await lireLaCarteDonnées(page, réponse));
        } finally {
          await page.close();
        }
      }, 120_000);
    }

    it('la réponse réelle de ce Chromium, sans rien remplacer : l’accueil s’accorde à ce qu’il a accordé', async () => {
      const page = await nouvellePage(site);
      try {
        await semerLaBaseDeMain(page, site, octets);
        await page.goto(site.url, { waitUntil: 'networkidle0' });
        await pause(3_000);
        const persistante = await page.evaluate(() => navigator.storage?.persisted?.() ?? Promise.resolve(false));
        const accueil = { où: `ce Chromium, persistance ${persistante ? 'accordée' : 'non accordée'}`, signal: (await lireLeSignal(page, persistante ? 0 : 2_000)).texte };
        if (persistante) vérifierSansSignal(accueil);
        else vérifierSignal(accueil);
      } finally {
        await page.close();
      }
    }, 60_000);
  });

  it.fails('témoin rouge · un refus du navigateur que l’accueil ne signale pas', () => {
    vérifierSignal({ où: 'persistance refusée, à l’ouverture', signal: null });
  });
  it.fails('témoin rouge · un signal qui bloque l’écran', () => {
    vérifierRienNeBloque({
      où: 'persistance refusée',
      étapes: [
        { onglet: 'Opérations', résultat: 'couvert par div.voile' },
        { onglet: 'Plan', résultat: 'ouvert' },
      ],
      modales: ['Vos données peuvent être effacées par le navigateur'],
      dialogues: [],
      planAffiché: false,
    });
  });
  it.fails('témoin rouge · un signal qui interrompt par une boîte de dialogue', () => {
    vérifierRienNeBloque({ où: 'persistance refusée', étapes: [], modales: [], dialogues: ['Vos données peuvent être effacées par le navigateur'], planAffiché: true });
  });
  it.fails('témoin rouge · des Réglages qui taisent le risque d’effacement', () => {
    vérifierRéglagesRedisentLeSignal({ réponse: 'refusée', texte: 'Tout est stocké dans ce navigateur, dans un fichier SQLite. Exporter le fichier SQLite' });
  });
});

describe('[niveau 1] C4 · #42 · 4. avec ce qui les protège', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    for (const réponse of ['refusée', 'impossible'] as const) {
      it(`${réponse} : le signal mène en un geste à l’export du fichier, qui porte les données`, async () => {
        vérifierProtection(await chercherLaProtection(site, réponse, octets));
      }, 120_000);
    }
  });

  it.fails('témoin rouge · un signal qui ne mène à aucun moyen de protéger les données', () => {
    vérifierProtection({ où: 'persistance refusée', chemin: null, essais: ['« En savoir plus » → aucune commande de sauvegarde visible'], fichier: null });
  });
  it.fails('témoin rouge · un export qui ne porte pas les données', () => {
    vérifierProtection({ où: 'persistance refusée', chemin: 'Sauvegarder', essais: [], fichier: { entête: 'SQLite format 3', tirelires: 0 } });
  });
});

describe('[niveau 1] C4 · #42 · 5. accordée, plus de signal', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    for (const réponse of ['accordée', 'déjà'] as const) {
      it(`${réponse} : pas de signal sur l’accueil, et Réglages dit que les données sont gardées`, async () => {
        const { page } = await page42(site);
        try {
          await semerLaBaseDeMain(page, site, octets);
          await ouvrir(page, site, réponse);
          await demandes(page, réponse === 'déjà' ? 1_000 : 5_000);
          vérifierSansSignal(await lireLAccueil(page, `persistance ${réponse}`, false));
          vérifierRéglagesGardées(await lireLaCarteDonnées(page, réponse));
        } finally {
          await page.close();
        }
      }, 60_000);
    }

    it('refusée, puis accordée à l’ouverture suivante : le signal disparaît', async () => {
      const { page } = await page42(site);
      try {
        await semerLaBaseDeMain(page, site, octets);
        await ouvrir(page, site, 'refusée');
        vérifierSignal(await lireLAccueil(page, 'persistance refusée, première ouverture', true));
        await ouvrir(page, site, 'accordée', true);
        await demandes(page);
        vérifierSansSignal(await lireLAccueil(page, 'persistance accordée à l’ouverture suivante', false));
        vérifierRéglagesGardées(await lireLaCarteDonnées(page, 'accordée'));
      } finally {
        await page.close();
      }
    }, 60_000);
  });

  it.fails('témoin rouge · un signal qui reste une fois la persistance accordée', () => {
    vérifierSansSignal({ où: 'persistance accordée', signal: 'Vos données peuvent être effacées par le navigateur.' });
  });
  it.fails('témoin rouge · des Réglages qui ne disent pas que les données sont gardées', () => {
    vérifierRéglagesGardées({ réponse: 'accordée', texte: 'Tout est stocké dans ce navigateur, dans un fichier SQLite. Exporter le fichier SQLite' });
  });
});

describe('[niveau 0] C4 · #42 · 6. rien ne se perd, rien ne sort', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('sous chaque réponse, les données de main restent à leur adresse, et seules des lectures de l’application partent', async () => {
      for (const réponse of ['accordée', 'refusée', 'impossible', 'déjà'] as const) {
        const { page, requêtes } = await page42(site);
        try {
          await semerLaBaseDeMain(page, site, octets);
          requêtes.length = 0;
          await ouvrir(page, site, réponse);
          await demandes(page, réponse === 'impossible' || réponse === 'déjà' ? 1_500 : 5_000);
          await pause(1_000);
          const lu = await relireLaBaseDeMain(page);
          vérifierBaseIntacte({ où: `persistance ${réponse}`, avant, après: lu ? await contenu(lu) : null, montrées: await donnéesMontrées(page) });
          await ouvrir(page, site, réponse, true);
          await pause(1_000);
          const relu = await relireLaBaseDeMain(page);
          vérifierBaseIntacte({ où: `persistance ${réponse}, ouverture suivante`, avant, après: relu ? await contenu(relu) : null, montrées: await donnéesMontrées(page) });
          vérifierRienNeSort(`persistance ${réponse}`, new URL(site.url).origin, requêtes);
        } finally {
          await page.close();
        }
      }
    }, 120_000);
  });

  it.fails('témoin rouge · une demande de persistance qui laisse la base de main derrière elle', () => {
    vérifierBaseIntacte({ où: 'persistance accordée', avant: { tirelires: ['t-courses'] }, après: null, montrées: false });
  });
  it.fails('témoin rouge · une requête sortie pendant la demande de persistance', () => {
    vérifierRienNeSort('persistance refusée', 'http://localhost:4173', [
      { méthode: 'GET', url: 'http://localhost:4173/assets/index.js', corps: false },
      { méthode: 'POST', url: 'https://mesure.exemple/persistance', corps: true },
    ]);
  });
});
