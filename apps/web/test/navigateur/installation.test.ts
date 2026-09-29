/**
 * Harnais d'audit de #194 — « La webapp propose de s'installer sur Chrome ».
 * Un fichier, hors registre : l'issue ne change aucune entrée de `docs/gardes.md`. Tout y est de
 * niveau 1 (D83) : si la proposition se tait, bloque ou revient sans cesse, une promesse tombe (C1,
 * C2, I5) sans qu'aucune donnée ne se perde ; le Chrome réel reste installable par son menu.
 *
 * Tout se passe dans le navigateur, sur le site construit. Chromium sans interface ne montre pas la
 * fenêtre d'installation : le harnais simule le signal de Chrome, comme l'issue le prévoit (« Ordre »).
 * À chaque ouverture qui le demande, un événement `beforeinstallprompt` part au chargement de la page
 * (`load`), comme Chrome le fait au plus tôt ; son `prompt()` est compté, et son `userChoice` répond
 * « accepted » ou « dismissed ». Accepté, `appinstalled` suit. Une ouverture « installée » est une
 * ouverture sans signal, où `matchMedia('(display-mode: standalone)')` répond vrai ; une ouverture
 * « sans installation » est une ouverture sans signal, comme dans un navigateur qui n'installe pas
 * d'application web. La réponse du navigateur à la demande de persistance (#42) est réglée comme dans
 * le harnais de #42 : « accordée », sauf au point 4.
 *
 * Il lit l'application par le mot de l'issue et par ce qui existe :
 *
 * - **une commande d'installation** : un bouton ou un lien visible, hors barre d'onglets, dont le
 *   texte dit « install… » (« Installer », « Installer l'application »…) ;
 * - **la proposition** : une commande d'installation visible sur l'accueil, à l'ouverture, sans
 *   aucun geste ; ses **autres commandes** sont celles du plus petit bloc qui la contient avec au
 *   moins une autre commande : chacune la refuse ou la remet à plus tard (principe 4) ;
 * - **atteignable** (I5) : une commande d'installation visible sur l'accueil, sur un écran de la
 *   barre d'onglets, ou sur un écran ouvert depuis Plus, soit deux gestes au plus ;
 * - **les bandeaux du haut** (#279) : ce qui s'affiche au-dessus des autres écrans de la barre
 *   (Opérations, Import, Bilan) ; la proposition n'y paraît pas, lecture du point 6 ;
 * - **la carte « Données »** de Réglages : l'élément qui suit le titre « Données » (#42, #41).
 *
 * Chaque `describe` reprend un point du « Fait quand » de l'issue, sous son numéro :
 *
 * 1. Signal présent, pas installée : la proposition paraît sur l'accueil, au téléphone (375 px) comme
 *    à l'ordinateur (1280 px) ; l'accepter appelle `prompt()`, l'installation de Chrome, une fois.
 * 2. Elle ne bloque rien — chaque onglet s'ouvre, aucune fenêtre modale ni boîte de dialogue.
 *    Refusée dans la fenêtre de Chrome, ou remise par chacune de ses autres commandes (qui
 *    n'appellent pas `prompt()` et la retirent aussitôt), elle n'est plus sur l'accueil à
 *    l'ouverture suivante, signal présent ; elle reste atteignable, et y appelle `prompt()`.
 * 3. Installée (acceptée puis `appinstalled`, et ouverte en `standalone`), ou sans signal : aucune
 *    commande d'installation, ni sur l'accueil ni en deux gestes.
 * 4. Persistance refusée, signal présent : la carte « Données » porte une commande d'installation,
 *    qui appelle `prompt()`. Sans signal, le point 3 garde qu'elle n'y est pas.
 * 5. Chromium ne relève aucune erreur d'installabilité sur le site construit
 *    (`Page.getInstallabilityErrors`, dans le contexte par défaut du navigateur : un contexte isolé
 *    répond « in-incognito »). Vert aujourd'hui : il garde ce qui tient.
 * 6. Signal présent, proposition sans réponse : Opérations, Import et Bilan ne portent aucune
 *    commande d'installation. Le retour à chaque ouverture est gardé au point 2.
 * 7. En relisant.
 *
 * L'installation réelle, la voie de l'onglet (C2) et les textes (C1, D85) restent aux vérifications
 * manuelles de l'issue et à la relecture. Les assertions sont dans des fonctions à part, pour que les
 * témoins rouges les rejouent, sans navigateur, sur une version cassée du besoin.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

type Issue = 'accepted' | 'dismissed';

/** Ce que simule une ouverture. */
interface Réglage {
  /** Chrome signale qu'il peut installer la page. */
  signal: boolean;
  /** Ce que l'utilisateur répond dans la fenêtre de Chrome. */
  issue: Issue;
  /** L'application est ouverte installée, dans sa propre fenêtre. */
  autonome: boolean;
  persistance: 'accordée' | 'refusée';
}

const PAR_DÉFAUT: Réglage = { signal: true, issue: 'dismissed', autonome: false, persistance: 'accordée' };

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Ce qu'on exige de chaque point
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface Lecture {
  où: string;
  /** Les commandes d'installation visibles. */
  commandes: string[];
}

function vérifierProposée(l: Lecture): void {
  expect(l.commandes.length, `${l.où} : l'application ne propose pas de s'installer (aucune commande « Installer… » sans geste)`).toBeGreaterThan(0);
}

function vérifierRienProposé(l: Lecture): void {
  expect(l.commandes, `${l.où} : l'application propose de s'installer`).toEqual([]);
}

interface Acceptation {
  où: string;
  commande: string | null;
  /** Combien de fois `prompt()` a été appelé après le geste. */
  prompts: number;
}

function vérifierInstallationOuverte(a: Acceptation): void {
  expect(a.commande, `${a.où} : aucune commande d'installation à toucher`).not.toBeNull();
  expect(a.prompts, `${a.où} : « ${a.commande} » n'ouvre pas l'installation de Chrome (prompt() appelé ${a.prompts} fois)`).toBe(1);
}

interface Report {
  où: string;
  commande: string;
  /** `prompt()` appelé par la commande. */
  prompts: number;
  /** Les commandes d'installation encore visibles sur l'accueil, aussitôt après. */
  aussitôt: string[];
  /** Celles de l'accueil à l'ouverture suivante, signal présent. */
  àLaSuivante: string[];
}

function vérifierReport(r: Report): void {
  expect(r.prompts, `${r.où} : « ${r.commande} » ouvre l'installation au lieu de la refuser ou de la remettre`).toBe(0);
  expect(r.aussitôt, `${r.où} : après « ${r.commande} », la proposition reste sur l'accueil`).toEqual([]);
  expect(r.àLaSuivante, `${r.où} : après « ${r.commande} », la proposition revient à l'ouverture suivante`).toEqual([]);
}

function vérifierAutresCommandes(où: string, autres: string[]): void {
  expect(autres.length, `${où} : la proposition ne se refuse pas (aucune autre commande à côté de l'installation)`).toBeGreaterThan(0);
}

interface Accès {
  où: string;
  /** Le chemin, en gestes depuis l'accueil, vers une commande d'installation ; `null` si aucune. */
  chemin: string[] | null;
  prompts: number;
}

function vérifierAtteignable(a: Accès): void {
  expect(a.chemin, `${a.où} : l'installation ne s'atteint plus en deux gestes depuis l'accueil`).not.toBeNull();
  expect(a.prompts, `${a.où} : la commande atteinte par ${a.chemin?.join(' → ') || 'l’accueil'} n'ouvre pas l'installation de Chrome`).toBe(1);
}

function vérifierInatteignable(a: Accès): void {
  expect(a.chemin, `${a.où} : une commande d'installation est proposée (${a.chemin?.join(' → ') || 'sur l’accueil'})`).toBeNull();
}

interface Étape {
  onglet: string;
  résultat: string;
}

interface Tour {
  où: string;
  étapes: Étape[];
  modales: string[];
  dialogues: string[];
}

function vérifierRienNeBloque(t: Tour): void {
  expect(t.dialogues, `${t.où} : une boîte de dialogue a interrompu l'utilisateur : ${t.dialogues.join(' | ')}`).toEqual([]);
  expect(t.modales, `${t.où} : une fenêtre modale couvre l'écran : ${t.modales.join(' | ')}`).toEqual([]);
  const bloquées = t.étapes.filter((é) => é.résultat !== 'ouvert');
  expect(bloquées, `${t.où} : des onglets ne s'ouvrent plus : ${bloquées.map((é) => `${é.onglet} (${é.résultat})`).join(', ')}`).toEqual([]);
}

function vérifierInstallable(erreurs: string[]): void {
  expect(erreurs, `Chromium ne tient pas le site pour installable : ${erreurs.join(', ')}`).toEqual([]);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Le signal de Chrome, simulé
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface Instance {
  page: Page;
  réglage: Réglage;
  dialogues: string[];
  script?: string;
}

async function régler(i: Instance): Promise<void> {
  if (i.script) await i.page.removeScriptToEvaluateOnNewDocument(i.script);
  const { identifier } = await i.page.evaluateOnNewDocument((r: Réglage) => {
    const journal = { prompts: 0 };
    Object.defineProperty(window, '__installation194', { value: journal });

    const proto = (window as unknown as { StorageManager?: { prototype: Record<string, unknown> } }).StorageManager?.prototype;
    if (proto) {
      proto['persisted'] = () => Promise.resolve(r.persistance === 'accordée');
      proto['persist'] = () => Promise.resolve(r.persistance === 'accordée');
    }

    if (r.autonome) {
      const vraie = window.matchMedia.bind(window);
      window.matchMedia = (q: string) =>
        /display-mode\s*:\s*standalone/.test(q)
          ? ({ matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as unknown as MediaQueryList)
          : vraie(q);
    }

    if (r.signal)
      window.addEventListener('load', () =>
        setTimeout(() => {
          const e = new Event('beforeinstallprompt', { cancelable: true });
          const choix = { outcome: r.issue, platform: 'web' };
          let répondre: (v: typeof choix) => void = () => {};
          const userChoice = new Promise<typeof choix>((ok) => (répondre = ok));
          Object.assign(e, {
            platforms: ['web'],
            userChoice,
            prompt() {
              journal.prompts++;
              répondre(choix);
              if (r.issue === 'accepted') setTimeout(() => window.dispatchEvent(new Event('appinstalled')), 200);
              return Promise.resolve(choix);
            },
          });
          window.dispatchEvent(e);
        }, 0),
      );
  }, i.réglage);
  i.script = identifier;
}

async function attendrePrête(page: Page): Promise<void> {
  await page.waitForFunction(() => !!document.querySelector('main') && !document.body.textContent?.includes('Ouverture de la base'), { timeout: 15_000 });
  await pause(800);
}

async function instance(site: Site, réglage: Partial<Réglage> = {}, largeur = 375, hauteur = 812): Promise<Instance> {
  const page = await nouvellePage(site, largeur, hauteur);
  const i: Instance = { page, réglage: { ...PAR_DÉFAUT, ...réglage }, dialogues: [] };
  page.on('dialog', (d) => {
    i.dialogues.push(d.message());
    void d.dismiss();
  });
  await régler(i);
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await attendrePrête(page);
  return i;
}

async function rouvrir(i: Instance, réglage: Partial<Réglage> = {}): Promise<void> {
  i.réglage = { ...i.réglage, ...réglage };
  await régler(i);
  await i.page.reload({ waitUntil: 'networkidle0' });
  await attendrePrête(i.page);
}

const prompts = (i: Instance) => i.page.evaluate(() => (window as unknown as { __installation194?: { prompts: number } }).__installation194?.prompts ?? 0);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Lectures dans la page
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Les commandes d'installation visibles, hors barre d'onglets (exécutée dans la page). `clic` ≥ 0
 * clique celle de ce rang ; `autres` ≥ 0 clique la commande de ce rang parmi les autres commandes du
 * bloc de la première. Rend aussi ces autres commandes.
 */
function installationDansLaPage(args: { clic: number; autres: number }): { commandes: string[]; autres: string[] } {
  const t = (e: Element) => (e.textContent ?? '').replace(/\s+/g, ' ').trim();
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  };
  const COMMANDE = 'button, a[href], [role="button"]';
  const toutes = [...document.querySelectorAll<HTMLElement>(COMMANDE)].filter((e) => !e.closest('.tabbar') && visible(e));
  const installer = toutes.filter((e) => /install/i.test(t(e)));
  let autres: HTMLElement[] = [];
  const première = installer[0];
  if (première)
    for (let b: HTMLElement | null = première.parentElement; b && b !== document.body; b = b.parentElement) {
      const dedans = toutes.filter((e) => e !== première && b!.contains(e) && !installer.includes(e));
      if (dedans.length) {
        autres = dedans;
        break;
      }
    }
  if (args.clic >= 0) installer[args.clic]?.click();
  if (args.autres >= 0) autres[args.autres]?.click();
  return { commandes: installer.map(t), autres: autres.map(t) };
}

const lire = (i: Instance) => i.page.evaluate(installationDansLaPage, { clic: -1, autres: -1 });

/** L'accueil, sans geste : les commandes d'installation qui paraissent dans les 3 s, ou leur absence après 3 s. */
async function lireLAccueil(i: Instance, où: string, attendu: boolean): Promise<Lecture> {
  await allerÀ(i.page, 'Plan');
  const fin = Date.now() + 3_000;
  let l = await lire(i);
  while (Date.now() < fin && (attendu ? !l.commandes.length : true)) {
    await pause(150);
    l = await lire(i);
  }
  return { où, commandes: l.commandes };
}

/** Accepte la proposition de l'accueil : touche sa première commande d'installation. */
async function accepter(i: Instance, où: string): Promise<Acceptation> {
  const { commandes } = await lireLAccueil(i, où, true);
  if (!commandes.length) return { où, commande: null, prompts: 0 };
  const avant = await prompts(i);
  await i.page.evaluate(installationDansLaPage, { clic: 0, autres: -1 });
  await pause(600);
  return { où, commande: commandes[0]!, prompts: (await prompts(i)) - avant };
}

/**
 * Cherche une commande d'installation en deux gestes au plus depuis l'accueil : l'accueil, chaque
 * écran de la barre d'onglets, puis chaque écran ouvert depuis Plus. `toucher` la touche, et compte
 * les `prompt()` qui suivent.
 */
async function chercher(i: Instance, où: string, toucher: boolean): Promise<Accès> {
  const trouvée = async (chemin: string[]): Promise<Accès | null> => {
    await pause(250);
    const l = await lire(i);
    if (!l.commandes.length) return null;
    let n = 0;
    if (toucher) {
      const avant = await prompts(i);
      await i.page.evaluate(installationDansLaPage, { clic: 0, autres: -1 });
      await pause(600);
      n = (await prompts(i)) - avant;
    }
    return { où, chemin: [...chemin, `« ${l.commandes[0]} »`], prompts: n };
  };
  await allerÀ(i.page, 'Plan');
  const accueil = await trouvée([]);
  if (accueil) return accueil;
  for (const onglet of ['Opérations', 'Import', 'Bilan', 'Plus']) {
    await allerÀ(i.page, onglet);
    const r = await trouvée([onglet]);
    if (r) return r;
  }
  await allerÀ(i.page, 'Plus');
  const entrées = await i.page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button')].map((b) => (b.querySelector('strong')?.textContent ?? b.textContent ?? '').replace(/\s+/g, ' ').trim()));
  for (let k = 0; k < entrées.length; k++) {
    await allerÀ(i.page, 'Plus');
    await i.page.evaluate((n: number) => [...document.querySelectorAll<HTMLElement>('main button')][n]?.click(), k);
    const r = await trouvée(['Plus', entrées[k]!]);
    if (r) return r;
  }
  return { où, chemin: null, prompts: 0 };
}

/** Le tour des onglets depuis l'accueil, proposition affichée : chaque onglet sous le doigt, et ouvert. */
async function faireLeTour(i: Instance, où: string): Promise<Tour> {
  i.dialogues.length = 0;
  const étapes: Étape[] = [];
  const modales = new Set<string>();
  for (const onglet of ['Opérations', 'Import', 'Bilan', 'Plus', 'Plan']) {
    const résultat = await i.page.evaluate((libellé: string) => {
      const b = [...document.querySelectorAll<HTMLElement>('.tabbar button')].find((x) => x.textContent?.includes(libellé));
      if (!b) return 'onglet introuvable';
      const r = b.getBoundingClientRect();
      const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!dessus || !b.contains(dessus)) return `couvert par ${dessus ? `${dessus.tagName.toLowerCase()}.${dessus.className}` : 'rien'}`;
      b.click();
      return 'cliqué';
    }, onglet);
    await pause(250);
    const lu = await i.page.evaluate((libellé: string) => {
      const actif = document.querySelector('.tabbar button.active')?.textContent ?? '';
      const m = [...document.querySelectorAll('dialog[open], [aria-modal="true"], [role="alertdialog"]')].map((e) => (e.textContent ?? '').trim().slice(0, 80));
      return { ouvert: actif.includes(libellé), modales: m };
    }, onglet);
    lu.modales.forEach((m) => modales.add(m));
    étapes.push({ onglet, résultat: résultat !== 'cliqué' ? résultat : lu.ouvert ? 'ouvert' : 'cliqué, mais l’écran n’a pas changé' });
  }
  return { où, étapes, modales: [...modales], dialogues: [...i.dialogues] };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Les points du « Fait quand »
// ─────────────────────────────────────────────────────────────────────────────────────────────

let site: Site;

beforeAll(async () => {
  if (navigateur) site = await ouvrirLeSite();
}, 120_000);

afterAll(async () => {
  await site?.fermer();
});

describe('[niveau 1] C1, C2 · #194 · 1. l’application propose de s’installer', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    for (const [taille, largeur, hauteur] of [['téléphone', 375, 812], ['ordinateur', 1280, 800]] as const) {
      it(`${taille} : signal de Chrome, pas installée : la proposition paraît sur l’accueil, et l’accepter ouvre l’installation de Chrome`, async () => {
        const i = await instance(site, {}, largeur, hauteur);
        try {
          vérifierInstallationOuverte(await accepter(i, `${taille}, signal de Chrome`));
        } finally {
          await i.page.close();
        }
      }, 60_000);
    }
  });

  it.fails('témoin rouge · un signal de Chrome que l’application ignore', () => {
    vérifierProposée({ où: 'accueil, signal de Chrome', commandes: [] });
  });
  it.fails('témoin rouge · une proposition qui n’ouvre pas l’installation de Chrome', () => {
    vérifierInstallationOuverte({ où: 'accueil', commande: 'Installer', prompts: 0 });
  });
});

describe('[niveau 1] C2, I5 · #194 · 2. elle ne bloque rien, ne revient pas à chaque ouverture, et reste atteignable', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('proposée : elle ne bloque rien', async () => {
      const i = await instance(site);
      try {
        vérifierProposée(await lireLAccueil(i, 'signal de Chrome', true));
        vérifierRienNeBloque(await faireLeTour(i, 'proposition affichée'));
      } finally {
        await i.page.close();
      }
    }, 60_000);

    it('refusée dans la fenêtre de Chrome : pas sur l’accueil à l’ouverture suivante, atteignable en deux gestes', async () => {
      const i = await instance(site, { issue: 'dismissed' });
      try {
        vérifierInstallationOuverte(await accepter(i, 'signal de Chrome'));
        await rouvrir(i);
        vérifierRienProposé(await lireLAccueil(i, 'ouverture suivante, refusée dans la fenêtre de Chrome', false));
        vérifierAtteignable(await chercher(i, 'ouverture suivante, refusée dans la fenêtre de Chrome', true));
      } finally {
        await i.page.close();
      }
    }, 120_000);

    it('remise par chacune de ses autres commandes : retirée aussitôt, pas sur l’accueil à l’ouverture suivante, atteignable en deux gestes', async () => {
      const i = await instance(site);
      const autres = (await i.page.evaluate(installationDansLaPage, { clic: -1, autres: -1 })).autres;
      await i.page.close();
      vérifierAutresCommandes('proposition sur l’accueil', autres);
      for (let k = 0; k < autres.length; k++) {
        const j = await instance(site);
        try {
          const où = `remise par « ${autres[k]} »`;
          vérifierProposée(await lireLAccueil(j, où, true));
          const avant = await prompts(j);
          await j.page.evaluate(installationDansLaPage, { clic: -1, autres: k });
          await pause(600);
          const n = (await prompts(j)) - avant;
          const aussitôt = (await lire(j)).commandes;
          await rouvrir(j);
          const àLaSuivante = (await lireLAccueil(j, où, false)).commandes;
          vérifierReport({ où, commande: autres[k]!, prompts: n, aussitôt, àLaSuivante });
          vérifierAtteignable(await chercher(j, `${où}, ouverture suivante`, true));
        } finally {
          await j.page.close();
        }
      }
    }, 240_000);
  });

  it.fails('témoin rouge · une proposition qui bloque l’écran', () => {
    vérifierRienNeBloque({ où: 'proposition affichée', étapes: [{ onglet: 'Opérations', résultat: 'couvert par div.voile' }], modales: ['Installer Tirelire ?'], dialogues: [] });
  });
  it.fails('témoin rouge · une proposition qu’on ne peut pas refuser', () => {
    vérifierAutresCommandes('proposition sur l’accueil', []);
  });
  it.fails('témoin rouge · une proposition refusée qui revient à chaque ouverture', () => {
    vérifierReport({ où: 'remise', commande: 'Plus tard', prompts: 0, aussitôt: [], àLaSuivante: ['Installer'] });
  });
  it.fails('témoin rouge · une installation refusée qu’on ne retrouve plus', () => {
    vérifierAtteignable({ où: 'ouverture suivante', chemin: null, prompts: 0 });
  });
});

describe('[niveau 1] C2 · #194 · 3. installée, ou sans installation possible, elle ne propose rien', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('acceptée puis installée : plus rien de proposé, ni aussitôt, ni ouverte dans sa fenêtre', async () => {
      const i = await instance(site, { issue: 'accepted' });
      try {
        vérifierInstallationOuverte(await accepter(i, 'signal de Chrome'));
        await pause(800);
        vérifierInatteignable(await chercher(i, 'aussitôt installée', false));
        await rouvrir(i, { signal: false, autonome: true });
        vérifierInatteignable(await chercher(i, 'ouverte installée, dans sa fenêtre', false));
      } finally {
        await i.page.close();
      }
    }, 120_000);

    it('sans signal de Chrome : rien de proposé, ni sur l’accueil ni en deux gestes, persistance accordée ou refusée', async () => {
      for (const persistance of ['accordée', 'refusée'] as const) {
        const i = await instance(site, { signal: false, persistance });
        try {
          vérifierInatteignable(await chercher(i, `sans signal de Chrome, persistance ${persistance}`, false));
        } finally {
          await i.page.close();
        }
      }
    }, 120_000);
  });

  it.fails('témoin rouge · un bouton d’installation dans un navigateur qui n’installe pas', () => {
    vérifierInatteignable({ où: 'sans signal de Chrome', chemin: ['Plus', 'Réglages', '« Installer l’application »'], prompts: 0 });
  });
});

describe('[niveau 1] C4, C2 · #194 · 4. là où l’installation est conseillée, elle se propose', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('persistance refusée, signal de Chrome : la carte « Données » porte une commande d’installation, qui ouvre celle de Chrome', async () => {
      const i = await instance(site, { persistance: 'refusée' });
      try {
        await allerÀ(i.page, 'Plus');
        expect(await cliquer(i.page, 'Réglages'), 'Réglages introuvable sous Plus').toBe(true);
        await pause(300);
        const avant = await prompts(i);
        const commande = await i.page.evaluate(() => {
          const titre = [...document.querySelectorAll('main h1, main h2, main h3')].find((h) => h.textContent?.trim() === 'Données');
          const b = [...(titre?.nextElementSibling?.querySelectorAll<HTMLElement>('button, a[href], [role="button"]') ?? [])].find((e) => /install/i.test(e.textContent ?? ''));
          b?.click();
          return b ? (b.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
        });
        await pause(600);
        vérifierInstallationOuverte({ où: 'Réglages, carte « Données », persistance refusée', commande, prompts: (await prompts(i)) - avant });
      } finally {
        await i.page.close();
      }
    }, 60_000);
  });

  it.fails('témoin rouge · des Réglages qui conseillent l’installation sans la proposer', () => {
    vérifierInstallationOuverte({ où: 'Réglages, carte « Données »', commande: null, prompts: 0 });
  });
});

describe('[niveau 1] C2 · #194 · 5. Chrome tient le site pour installable', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('Chromium ne relève aucune erreur d’installabilité sur le site construit', async () => {
      // Le contexte par défaut : dans un contexte isolé, Chromium répond « in-incognito ».
      const page = await site.chrome.defaultBrowserContext().newPage();
      try {
        await page.goto(site.url, { waitUntil: 'networkidle0' });
        await pause(4_000);
        const cdp = await page.createCDPSession();
        const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: Array<{ errorId: string }> };
        vérifierInstallable(installabilityErrors.map((e) => e.errorId));
      } finally {
        await page.close();
      }
    }, 60_000);
  });

  it.fails('témoin rouge · un manifeste sans icône qu’installer', () => {
    vérifierInstallable(['manifest-missing-suitable-icon']);
  });
});

describe('[niveau 1] #279 · #194 · 6. pas un bandeau de plus en haut des écrans', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('signal de Chrome, proposition sans réponse : Opérations, Import et Bilan ne la portent pas', async () => {
      const i = await instance(site);
      try {
        vérifierProposée(await lireLAccueil(i, 'signal de Chrome', true));
        for (const onglet of ['Opérations', 'Import', 'Bilan']) {
          await allerÀ(i.page, onglet);
          await pause(250);
          vérifierRienProposé({ où: `écran ${onglet}, proposition sans réponse`, commandes: (await lire(i)).commandes });
        }
      } finally {
        await i.page.close();
      }
    }, 60_000);
  });

  it.fails('témoin rouge · une proposition affichée en haut de chaque écran', () => {
    vérifierRienProposé({ où: 'écran Opérations', commandes: ['Installer l’application'] });
  });
});
