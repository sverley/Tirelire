/**
 * Harnais d'audit de #41 — « Sans serveur, la sauvegarde doit être évidente ».
 * Garde la part de C5 que #41 construit : « La sauvegarde doit donc être évidente, sans supposer que
 * l'utilisateur y pense ». Fichier de niveau 0 et 1, que le registre cite sous C5 (point 9 : la ligne
 * « À bâtir » y devient ce harnais) ; les niveaux 2 à 4 — les textes vouvoient (D85) — sont dans
 * `sauvegarde-evidente-cas.test.ts`, hors registre (D81).
 *
 * Tout se passe dans le navigateur, sur le site construit. Le point 3 suit la lecture de
 * l'architecte, confirmée par le porteur le 28 septembre : sans sauvegarde, le rappel vient dès que
 * des données sont là ; après une sauvegarde, quand les données ont changé depuis et qu'elle date de
 * plus d'une période budgétaire.
 *
 * Chaque page a son jour : l'horloge de `nouvellePage` (`JOUR_DES_TESTS`) est décalée au jour voulu,
 * midi à Paris, et se règle à nouveau à chaque réouverture, dans le même contexte, donc sur les
 * mêmes données. Les jours choisis restent loin des bords : cinq jours après une sauvegarde, dans la
 * même période (le 20 et le 25 septembre sont dans la période de l'exemple, 28 août – 27 septembre,
 * comme dans le mois calendaire) ; soixante-dix jours après, plus de deux périodes, quelle que soit
 * la façon de les compter. Le cas limite d'une période exactement reste au codeur.
 *
 * La réponse du navigateur à la demande de persistance (#42) est réglée comme dans le harnais de
 * #42 : « accordée » partout, pour que le seul signal possible soit celui de #41, sauf au point 4,
 * où elle est « refusée » pour que les deux aient quelque chose à dire. Les requêtes vers le relais
 * sont servies par un relais en mémoire, au contrat de `apps/hebergement/serveur/relais.php`, comme
 * dans `conflit-visible.test.ts` ; la synchronisation directe relie deux pages du même navigateur,
 * sans serveur STUN : rien ne sort.
 *
 * Il lit l'application par ce que l'issue et #42 nomment, et par ce que l'application fait déjà ;
 * il ne suppose ni la place ni le reste des mots, ni l'endroit où l'instance garde ses dates :
 *
 * - **un signal** de l'accueil sur la sûreté des données : un enfant direct de `main`, comme celui de
 *   #42, dont le texte, hors commandes, dit « sauvegard… », ou « effac… » et « navigateur » ; ses
 *   commandes gardent les noms de #42, « Enregistrer une copie » et « Masquer » (l'issue : « même
 *   signal, même geste »). Persistance accordée, un signal est donc le rappel ;
 * - **la carte « Données »** de Réglages, que l'issue nomme : l'élément qui suit le titre
 *   « Données » ; le geste qui y enregistre garde son nom d'aujourd'hui, « Exporter le fichier
 *   SQLite », ou prend celui du signal, « Enregistrer une copie » ;
 * - **une date dite** : une ligne (au sens du texte affiché) qui parle de la sauvegarde seule
 *   (« sauvegard… ») ou de la synchronisation seule (« synchro… »), et porte « jamais » ou la date
 *   écrite comme partout dans l'application (`shortDate` : « 20 sept. 2026 ») ; la ligne de la
 *   synchronisation nomme aussi son moyen, et lui seul : « direct », « relais » ou « paquet ». Une
 *   ligne qui dit une autre date que l'attendue, parmi les jours où travaillent les instances des
 *   tests, est fausse ;
 * - **une sauvegarde** : un fichier téléchargé qui est une base SQLite portant les données.
 *
 * Chaque `describe` reprend un point du « Fait quand » de l'issue, sous son numéro :
 *
 * 1. Réglages, carte « Données », dit la date de la dernière sauvegarde et de la dernière
 *    synchronisation, « jamais » sans elles ; le signal les dit aussi.
 * 2. Un dépôt accepté par le relais, un paquet importé, un échange direct abouti datent la
 *    synchronisation, avec leur moyen ; un dépôt refusé ou un paquet illisible ne changent rien.
 * 3. Le rappel : une base vide n'en a pas ; des données jamais sauvegardées l'ont dès l'accueil, même
 *    synchronisées ; sauvegardées, pas de rappel cinq jours après, changées ou non, ni soixante-dix
 *    jours après sans changement ; un rappel soixante-dix jours après, changées.
 * 4. Persistance refusée et sauvegarde à faire : un seul signal, qui dit les deux. Il ne bloque rien
 *    — chaque onglet reste sous le doigt et s'ouvre, aucune fenêtre modale ni boîte de dialogue, le
 *    plan reste affiché — et « Masquer » le masque sans rien enregistrer, pour l'ouverture en cours :
 *    il ne revient pas en changeant d'onglet, et revient à l'ouverture suivante.
 * 5. Depuis le signal (« Enregistrer une copie ») comme depuis la carte « Données », un seul geste
 *    télécharge le fichier des données ; aussitôt, sans rouvrir, la carte dit la date du jour et le
 *    rappel a disparu.
 * 6. Une instance qui reçoit par le relais les données d'une autre, sauvegardées et synchronisées,
 *    ne reçoit pas ses dates : sa sauvegarde est « jamais », sa synchronisation est la sienne. Le
 *    fichier sauvegardé, ouvert sur une instance neuve, y donne « jamais » pour les deux.
 * 7. Après une sauvegarde datée, « Tout effacer », « Charger l'exemple » et l'import d'un fichier
 *    remettent la date de sauvegarde à « jamais ».
 * 8. Le fichier sauvegardé, ouvert sur une instance neuve puis sauvegardé à nouveau, porte les mêmes
 *    lignes, valeur pour valeur ; pendant ces parcours sans relais, seules des lectures (GET) de
 *    l'origine qui sert l'application partent.
 * 9. Le registre : en relisant (D81).
 * 10. Tant que la version est une bêta (`v0.x`, #277), le signal, qu'il paraisse pour le rappel ou
 *    pour la persistance refusée (#42), dit, avec les mots de l'issue, qu'un fichier peut « ne plus
 *    s'ouvrir » à la « version suivante », et que la sauvegarde en garde une copie « telle quelle ».
 *    La version publique `v1` retire ce point : son issue retire ce test.
 *
 * Les assertions sont dans des fonctions à part, pour que les témoins rouges, en fin de chaque
 * point, rejouent les mêmes sur une version volontairement cassée du besoin ; les témoins se jouent
 * sans navigateur.
 *
 * Niveaux (D83), marqués dans chaque titre ; un témoin a le niveau de ce qu'il garde :
 * - 0 : points 3, 6, 7 et 8 — un rappel qui se tait, ou qui se tait parce qu'une date venue d'une
 *   autre instance ou d'autres données le trompe, laisse perdre des données que rien ne rendra ; un
 *   fichier qui ne rouvre pas tout, ou une requête sortie, le sont pour de bon (C5, I7).
 * - 1 : points 1, 2, 4, 5 et 10 — la promesse de C5 et d'I4 tombe (savoir sans chercher où en sont
 *   ses données, un signal qui ne bloque rien, sauvegarder en un geste, savoir qu'une bêta peut ne
 *   plus rouvrir son fichier), sans qu'une donnée soit perdue par là : un fichier d'un autre format
 *   est refusé sans être effacé, et l'application propose de l'enregistrer tel quel (D30, D58).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import type { HTTPRequest, Page } from 'puppeteer-core';
import { LEDGER_KEYS, LedgerStore, exampleLedger, exportBundle } from '@tirelire/core';
import { shortDate } from '../../src/lib/format';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

type Réponse = 'accordée' | 'refusée';
type Moyen = 'direct' | 'relais' | 'paquet';
/** Une date `AAAA-MM-JJ`, ou « jamais ». */
type Valeur = string;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Ce qu'une ligne dit d'une date
// ─────────────────────────────────────────────────────────────────────────────────────────────

const J = '2026-09-20';
const J2 = '2026-09-22';
const J5 = '2026-09-25';
const J70 = '2026-11-29';
/** Les jours où les instances des tests travaillent : une date dite ne peut être que l'un d'eux. */
const JOURS = [J, '2026-09-21', J2, '2026-09-23', '2026-09-24', J5, J70];

type Sujet = 'sauvegarde' | 'synchronisation';
const SUJETS: Record<Sujet, RegExp> = { sauvegarde: /sauvegard/i, synchronisation: /synchro/i };
const MOYENS: Record<Moyen, RegExp> = { direct: /direct/i, relais: /relais/i, paquet: /paquet/i };

/** Une ligne dit-elle cette valeur : « jamais », ou la date écrite comme partout dans l'application ? */
const dit = (ligne: string, v: Valeur) => (v === 'jamais' ? /(?<!\p{L})jamais(?!\p{L})/iu.test(ligne) : ligne.includes(shortDate(v)));

const lisible = (v: Valeur) => (v === 'jamais' ? '« jamais »' : `« ${shortDate(v)} »`);
const résumé = (t: string | null) => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Ce qu'on exige de chaque point
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface Lecture {
  où: string;
  /** Le texte lu : la carte « Données », ou le signal ; `null` s'il est introuvable. */
  texte: string | null;
    sauvegarde?: Valeur;
  synchronisation?: Valeur;
  moyen?: Moyen;
}

function vérifierDates(l: Lecture): void {
  expect(l.texte, `${l.où} : texte introuvable`).not.toBeNull();
  const lignes = l.texte!.split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const valeurs: Valeur[] = ['jamais', ...JOURS];
  const attendus: Array<[Sujet, Valeur | undefined]> = [
    ['sauvegarde', l.sauvegarde],
    ['synchronisation', l.synchronisation],
  ];
  for (const [sujet, attendu] of attendus) {
    if (attendu === undefined) continue;
    const autre: Sujet = sujet === 'sauvegarde' ? 'synchronisation' : 'sauvegarde';
    const nom = sujet === 'sauvegarde' ? 'la dernière sauvegarde' : 'la dernière synchronisation';
    // Les lignes qui parlent de ce sujet seul, et y disent une date ou « jamais ».
    const datées = lignes.filter((x) => SUJETS[sujet].test(x) && !SUJETS[autre].test(x) && valeurs.some((v) => dit(x, v)));
    expect(datées.length, `${l.où} : aucune ligne ne dit ${nom}, ni sa date (${lisible(attendu === 'jamais' ? J : attendu)}) ni « jamais » : « ${résumé(l.texte)} »`).toBeGreaterThan(0);
    const fausses = datées.filter((x) => !dit(x, attendu) || valeurs.some((v) => v !== attendu && dit(x, v)));
    expect(fausses, `${l.où} : ${nom} devrait être ${lisible(attendu)}`).toEqual([]);
    if (sujet === 'synchronisation' && l.moyen && attendu !== 'jamais')
      for (const x of datées) {
        const dits = (Object.keys(MOYENS) as Moyen[]).filter((m) => MOYENS[m].test(x));
        expect(dits, `${l.où} : la dernière synchronisation, faite par « ${l.moyen} », doit le dire, et lui seul : « ${x} »`).toEqual([l.moyen]);
      }
  }
}

interface Signal {
  texte: string;
  commandes: string[];
}

interface Accueil {
  où: string;
  signaux: Signal[];
}

function vérifierRappel(a: Accueil): void {
  expect(a.signaux.length, `${a.où} : l'accueil ne rappelle pas de sauvegarder`).toBeGreaterThan(0);
}

function vérifierSansRappel(a: Accueil): void {
  expect(a.signaux.map((s) => résumé(s.texte)), `${a.où} : l'accueil rappelle de sauvegarder alors que rien ne le demande`).toEqual([]);
}

const DIT_LE_RISQUE = (s: string) => /effac/i.test(s) && /navigateur/i.test(s);

function vérifierUnSeulSignal(a: Accueil): void {
  expect(a.signaux.length, `${a.où} : l'accueil porte ${a.signaux.length} signaux sur la sûreté des données : ${a.signaux.map((s) => `« ${résumé(s.texte)} »`).join(' ; ')}`).toBe(1);
  const t = a.signaux[0]!.texte;
  expect(DIT_LE_RISQUE(t), `${a.où} : le signal ne dit plus que les données peuvent être effacées par le navigateur (#42) : « ${résumé(t)} »`).toBe(true);
  expect(/sauvegard/i.test(t), `${a.où} : le signal ne dit rien de la sauvegarde : « ${résumé(t)} »`).toBe(true);
}

/** Point 10, avec les mots de l'issue : « un fichier peut ne plus s'ouvrir à la version suivante », « une copie telle quelle ». */
function vérifierBêta(a: Accueil): void {
  expect(a.signaux.length, `${a.où} : pas de signal sur l'accueil`).toBeGreaterThan(0);
  const t = a.signaux[0]!.texte;
  const manque = [
    [/ne plus s['’]ouvrir/i, '« ne plus s’ouvrir »'],
    [/version suivante/i, '« version suivante »'],
    [/tel(le)?s? quel(le)?s?/i, '« telle quelle »'],
  ].filter(([m]) => !(m as RegExp).test(t)).map(([, d]) => d as string);
  expect(manque, `${a.où} : en bêta, le signal ne dit pas qu'un fichier peut ne plus s'ouvrir à la version suivante, ni que la sauvegarde en garde une copie telle quelle : « ${résumé(t)} »`).toEqual([]);
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

interface Masquage {
  où: string;
  /** La commande qui a masqué le signal sans rien télécharger, ou `null`. */
  commande: string | null;
  essais: string[];
  /** Le signal, après un tour par un autre onglet, pendant la même ouverture. */
  aprèsUnTour: Signal[];
  /** Le signal à l'ouverture suivante. */
  àLaSuivante: Signal[];
}

function vérifierMasquage(m: Masquage): void {
  expect(m.commande, `${m.où} : aucune commande du signal ne le masque sans rien enregistrer (essais : ${m.essais.join(' ; ') || 'aucune commande'})`).not.toBeNull();
  expect(m.aprèsUnTour.map((s) => résumé(s.texte)), `${m.où} : masqué par « ${m.commande} », le signal revient pendant la même ouverture`).toEqual([]);
  expect(m.àLaSuivante.length, `${m.où} : masqué par « ${m.commande} », le signal ne revient pas à l'ouverture suivante, la sauvegarde restant à faire`).toBeGreaterThan(0);
}

interface Fichier {
  /** Les 15 premiers octets, lus comme du texte. */
  entête: string;
  tirelires: number;
}

interface Geste {
  où: string;
  /** Le chemin qui a téléchargé le fichier en un geste, ou `null`. */
  chemin: string | null;
  essais: string[];
  fichier: Fichier | null;
}

function vérifierUnGeste(g: Geste): void {
  expect(g.chemin, `${g.où} : aucun geste unique n'enregistre le fichier des données (essais : ${g.essais.join(' ; ') || 'aucune commande'})`).not.toBeNull();
  expect(g.fichier?.entête, `${g.où} : ce que « ${g.chemin} » télécharge n'est pas une base SQLite`).toBe('SQLite format 3');
  expect(g.fichier!.tirelires, `${g.où} : le fichier que « ${g.chemin} » télécharge ne porte pas les tirelires des données`).toBeGreaterThan(0);
}

/** Les lignes de chaque table, valeur pour valeur, et les réglages hors identité de l'instance. */
type Contenu = Record<string, string[]>;

interface Réouverture {
  où: string;
  avant: Contenu;
  après: Contenu | null;
}

function vérifierÀLIdentique(r: Réouverture): void {
  expect(r.après, `${r.où} : le fichier rouvert n'a pas pu être sauvegardé à nouveau`).not.toBeNull();
  for (const table of Object.keys(r.avant)) {
    const perdues = r.avant[table]!.filter((l) => !r.après![table]?.includes(l));
    const ajoutées = (r.après![table] ?? []).filter((l) => !r.avant[table]!.includes(l));
    expect({ perdues, ajoutées }, `${r.où} : la table ${table} ne revient pas à l'identique`).toEqual({ perdues: [], ajoutées: [] });
  }
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
// Le relais en mémoire, commun à Node et aux pages
// ─────────────────────────────────────────────────────────────────────────────────────────────

const RELAIS = { url: 'https://relais.exemple.invalid/tirelire', room: 'salon-sauvegarde-41', passphrase: 'phrase du foyer, sauvegarde 41' };

type Dépôt = Record<string, unknown> & { id: number };

/** Un relais au contrat de `relais.php` ; `refuser` le fait répondre 500 à chaque dépôt. */
function relais() {
  const dépôts: Dépôt[] = [];
  const état = { refuser: false };
  const traiter = (méthode: string, url: URL, corps: string | undefined): { statut: number; réponse: unknown } => {
    if (méthode === 'POST') {
      if (état.refuser) return { statut: 500, réponse: { error: 'dépôt refusé' } };
      const id = dépôts.length + 1;
      dépôts.push({ ...(JSON.parse(corps ?? '{}') as Record<string, unknown>), id });
      return { statut: 200, réponse: { id } };
    }
    const site = url.searchParams.get('site') ?? '';
    const après = Number(url.searchParams.get('after') ?? 0);
    return { statut: 200, réponse: { records: dépôts.filter((r) => r.id > après && r['site'] !== site) } };
  };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
  const pourLaPage = (req: HTTPRequest) => {
    if (req.isInterceptResolutionHandled()) return;
    if (!req.url().startsWith(RELAIS.url)) {
      void req.continue();
      return;
    }
    if (req.method() === 'OPTIONS') {
      void req.respond({ status: 204, headers: cors, body: '' });
      return;
    }
    const { statut, réponse } = traiter(req.method(), new URL(req.url()), req.postData());
    void req.respond({ status: statut, headers: cors, contentType: 'application/json', body: JSON.stringify(réponse) });
  };
  return { dépôts, état, pourLaPage };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Une instance : une page, son jour, ses requêtes, ses téléchargements
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface Instance {
  page: Page;
  jour: string;
  réponse: Réponse;
  requêtes: Requête[];
  dialogues: string[];
  erreurs: string[];
  script?: string;
  téléchargements: Awaited<ReturnType<typeof suivreLesTéléchargements>>;
}

/**
 * Le script de chaque ouverture, avant tout script de la page : l'horloge au jour voulu (par-dessus
 * celle de `nouvellePage`), la réponse du navigateur à la demande de persistance (#42), un
 * presse-papiers qui retient ce qu'on y copie, et une connexion directe sans serveur STUN.
 */
async function régler(i: Instance): Promise<void> {
  if (i.script) await i.page.removeScriptToEvaluateOnNewDocument(i.script);
  const { identifier } = await i.page.evaluateOnNewDocument(
    (jour: string, réponse: string) => {
      const Base = Date;
      const décalage = Base.parse(`${jour}T12:00:00+02:00`) - Base.now();
      const maintenant = () => Base.now() + décalage;
      function DateDuJour(this: unknown, ...a: unknown[]): unknown {
        if (!new.target) return new Base(maintenant()).toString();
        return a.length === 0 ? new Base(maintenant()) : new (Base as unknown as new (...b: unknown[]) => Date)(...a);
      }
      Object.setPrototypeOf(DateDuJour, Base);
      DateDuJour.prototype = Base.prototype;
      (DateDuJour as unknown as { now: () => number }).now = maintenant;
      (globalThis as unknown as { Date: unknown }).Date = DateDuJour;

      const proto = (window as unknown as { StorageManager?: { prototype: Record<string, unknown> } }).StorageManager?.prototype;
      if (proto) {
        proto['persisted'] = () => Promise.resolve(réponse === 'accordée');
        proto['persist'] = () => Promise.resolve(réponse === 'accordée');
      }

      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (t: string) => {
            (window as unknown as { __copie41?: string }).__copie41 = t;
            return Promise.resolve();
          },
          readText: () => Promise.resolve((window as unknown as { __copie41?: string }).__copie41 ?? ''),
        },
      });

      const Connexion = window.RTCPeerConnection;
      if (Connexion) {
        const SansStun = function (this: unknown, cfg?: RTCConfiguration) {
          return new Connexion({ ...(cfg ?? {}), iceServers: [] });
        } as unknown as typeof RTCPeerConnection;
        SansStun.prototype = Connexion.prototype;
        Object.setPrototypeOf(SansStun, Connexion);
        (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = SansStun;
      }
    },
    i.jour,
    i.réponse,
  );
  i.script = identifier;
}

/** Attend que l'application soit prête : la base ouverte, l'écran monté. */
async function attendrePrête(page: Page): Promise<void> {
  const fin = Date.now() + 15_000;
  while (Date.now() < fin) {
    const prête = await page
      .evaluate(() => !!document.querySelector('main') && !document.body.textContent?.includes('Ouverture de la base'))
      .catch(() => false);
    if (prête) return;
    await pause(100);
  }
  throw new Error("l'application ne s'est pas ouverte");
}

/** Une instance neuve, dans son propre contexte, ouverte au jour dit, base vide. */
async function instance(site: Site, jour: string, réponse: Réponse = 'accordée'): Promise<Instance> {
  const page = await nouvellePage(site);
  const i: Instance = { page, jour, réponse, requêtes: [], dialogues: [], erreurs: [], téléchargements: await suivreLesTéléchargements(site, page) };
  page.on('request', (r) => i.requêtes.push({ méthode: r.method(), url: r.url(), corps: !!r.postData() }));
  page.on('pageerror', (e) => i.erreurs.push(e instanceof Error ? e.message : String(e)));
  // Les confirmations que le parcours demande (« Tout effacer », « Charger l'exemple », l'import
  // d'un fichier) sont acceptées ; toutes sont notées.
  page.on('dialog', (d) => {
    i.dialogues.push(d.message());
    void d.accept();
  });
  await régler(i);
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await attendrePrête(page);
  await pause(500);
  return i;
}

/** Rouvre l'application sur les mêmes données, au jour dit (le même par défaut). */
async function rouvrir(i: Instance, jour = i.jour, réponse = i.réponse): Promise<void> {
  i.jour = jour;
  i.réponse = réponse;
  await régler(i);
  await i.page.reload({ waitUntil: 'networkidle0' });
  await attendrePrête(i.page);
  await pause(500);
}

async function fermer(...instances: Instance[]): Promise<void> {
  for (const i of instances) {
    await i.téléchargements.fermer();
    await i.page.close().catch(() => {});
  }
}

/** Charge l'exemple depuis l'accueil d'une base vide, et attend le plan. */
async function chargerLExemple(i: Instance): Promise<void> {
  expect(await cliquer(i.page, "Charger l'exemple"), "bouton « Charger l'exemple » introuvable sur l'accueil").toBe(true);
  await i.page.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Tirelires'), { timeout: 15_000 });
  await pause(800);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Lectures dans la page
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Les signaux de l'écran sur la sûreté des données (exécutée dans la page) : les enfants directs de
 * `main`, visibles, dont le texte, hors commandes, dit « sauvegard… », ou « effac… » et
 * « navigateur ». `clic` clique, dans le premier, la commande qui porte ce nom.
 */
function signauxDansLaPage(clic: string | null): Array<{ texte: string; commandes: string[] }> {
  const COMMANDE = 'button, a[href], [role="button"], label';
  const t = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  };
  const horsCommandes = (e: Element) => {
    const c = e.cloneNode(true) as Element;
    c.querySelectorAll(COMMANDE).forEach((x) => x.remove());
    return t(c.textContent);
  };
  const parle = (s: string) => /sauvegard/i.test(s) || (/effac/i.test(s) && /navigateur/i.test(s));
  const blocs = [...(document.querySelector('main')?.children ?? [])].filter((e) => visible(e) && parle(horsCommandes(e)));
  const lus = blocs.map((b) => ({ b, commandes: [...b.querySelectorAll<HTMLElement>(COMMANDE)].filter(visible) }));
  if (clic !== null) lus[0]?.commandes.find((c) => t(c.textContent) === clic)?.click();
  return lus.map(({ b, commandes }) => ({ texte: (b as HTMLElement).innerText, commandes: commandes.map((c) => t(c.textContent)) }));
}

/** L'accueil, sans aucun geste : les signaux qui paraissent dans les 5 s, ou leur absence après 2,5 s. */
async function lireLAccueil(i: Instance, où: string, attendu: boolean): Promise<Accueil> {
  await allerÀ(i.page, 'Plan');
  if (!attendu) await pause(2_500);
  const fin = Date.now() + (attendu ? 5_000 : 0);
  let signaux = await i.page.evaluate(signauxDansLaPage, null);
  while (!signaux.length && Date.now() < fin) {
    await pause(100);
    signaux = await i.page.evaluate(signauxDansLaPage, null);
  }
  return { où, signaux };
}

async function allerAuxRéglages(i: Instance): Promise<void> {
  await allerÀ(i.page, 'Plus');
  expect(await cliquer(i.page, 'Réglages'), 'Réglages introuvable sous Plus').toBe(true);
  await pause(300);
}

/** Le texte de la carte « Données » de Réglages, ou `null`. */
async function lireLaCarte(i: Instance): Promise<string | null> {
  await allerAuxRéglages(i);
  return i.page.evaluate(() => {
    const titre = [...document.querySelectorAll('main h1, main h2, main h3')].find((h) => h.textContent?.trim() === 'Données');
    const carte = titre?.nextElementSibling as HTMLElement | null | undefined;
    return carte ? carte.innerText : null;
  });
}

/** Les noms que l'issue et #42 donnent au geste qui enregistre le fichier. */
const ENREGISTRER = ['Enregistrer une copie', 'Exporter le fichier SQLite'];

/** La commande de la carte « Données » qui enregistre le fichier ; `clic` la clique. Rend son nom, ou `null`. */
function sauvegardeDeLaCarte(args: { noms: string[]; clic: boolean }): string | null {
  const t = (e: Element) => (e.textContent ?? '').replace(/\s+/g, ' ').trim();
  const titre = [...document.querySelectorAll('main h1, main h2, main h3')].find((h) => h.textContent?.trim() === 'Données');
  const b = [...(titre?.nextElementSibling?.querySelectorAll<HTMLElement>('button, a[href], [role="button"]') ?? [])].find((e) => args.noms.includes(t(e)));
  if (b && args.clic) b.click();
  return b ? t(b) : null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Téléchargements
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Suit les téléchargements du contexte de la page, comme le harnais de #42 : chaque `préparer` les
 * dirige vers un dossier neuf, puis `fichier` rend le premier téléchargé, ou `null` si aucun n'a
 * commencé dans `départ` ms.
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
    async préparer(): Promise<void> {
      if (dossier) rmSync(dossier, { recursive: true, force: true });
      dossier = mkdtempSync(join(tmpdir(), 'tirelire-41-'));
      commencés.clear();
      finis.clear();
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dossier, eventsEnabled: true, ...(contexte ? { browserContextId: contexte } : {}) });
    },
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

const SQL = await initSqlJs();

async function lireLeFichier(o: Uint8Array): Promise<Fichier> {
  const entête = new TextDecoder().decode(o.subarray(0, 15));
  let tirelires = 0;
  if (entête === 'SQLite format 3') tirelires = (await contenu(o).catch(() => ({}) as Contenu))['tirelires']?.length ?? 0;
  return { entête, tirelires };
}

/** Le contenu d'un fichier : chaque ligne de chaque table, valeur pour valeur ; les réglages sans `siteId` (D58). */
async function contenu(octets: Uint8Array): Promise<Contenu> {
  const store = await LedgerStore.create({ sqlJs: SQL, bytes: octets });
  const l = store.load() as unknown as Record<string, unknown>;
  const c: Contenu = {};
  for (const clé of LEDGER_KEYS) c[clé] = (l[clé] as unknown[]).map((r) => JSON.stringify(r)).sort();
  const { siteId: _instance, ...réglages } = l['settings'] as Record<string, unknown>;
  c['settings'] = [JSON.stringify(réglages, Object.keys(réglages).sort())];
  store.close();
  return c;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Gestes
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Sauvegarde depuis la carte « Données », d'un seul geste. */
async function sauvegarderDepuisLaCarte(i: Instance, où: string): Promise<Geste & { octets: Uint8Array | null }> {
  await allerAuxRéglages(i);
  await i.téléchargements.préparer();
  const nom = await i.page.evaluate(sauvegardeDeLaCarte, { noms: ENREGISTRER, clic: true });
  if (!nom) return { où, chemin: null, essais: [`aucune commande « ${ENREGISTRER.join(' » ni « ')} » dans la carte « Données »`], fichier: null, octets: null };
  const octets = await i.téléchargements.fichier();
  if (!octets) return { où, chemin: null, essais: [`« ${nom} » : rien de téléchargé`], fichier: null, octets: null };
  return { où, chemin: `Réglages → « ${nom} »`, essais: [], fichier: await lireLeFichier(octets), octets };
}

/** Sauvegarde depuis le signal de l'accueil, d'un seul geste : sa commande « Enregistrer une copie » (#42). */
async function sauvegarderDepuisLeSignal(i: Instance, où: string): Promise<Geste> {
  const { signaux } = await lireLAccueil(i, où, true);
  if (!signaux.length) return { où, chemin: null, essais: ["aucun signal sur l'accueil"], fichier: null };
  if (!signaux[0]!.commandes.includes('Enregistrer une copie'))
    return { où, chemin: null, essais: [`le signal n'a pas de commande « Enregistrer une copie » (${signaux[0]!.commandes.join(', ')})`], fichier: null };
  await i.téléchargements.préparer();
  await i.page.evaluate(signauxDansLaPage, 'Enregistrer une copie');
  const octets = await i.téléchargements.fichier();
  if (!octets) return { où, chemin: null, essais: ['« Enregistrer une copie » : rien de téléchargé'], fichier: null };
  return { où, chemin: 'signal → « Enregistrer une copie »', essais: [], fichier: await lireLeFichier(octets) };
}

/** Masque le signal par sa commande « Masquer » (#42), puis le relit après un tour et à l'ouverture suivante. */
async function masquerLeSignal(i: Instance, où: string): Promise<Masquage> {
  const { signaux } = await lireLAccueil(i, où, true);
  const vide: Masquage = { où, commande: null, essais: [], aprèsUnTour: [], àLaSuivante: [] };
  if (!signaux.length) return { ...vide, essais: ["aucun signal sur l'accueil"] };
  if (!signaux[0]!.commandes.includes('Masquer')) return { ...vide, essais: [`pas de commande « Masquer » (${signaux[0]!.commandes.join(', ')})`] };
  await i.téléchargements.préparer();
  await i.page.evaluate(signauxDansLaPage, 'Masquer');
  await pause(400);
  if (await i.téléchargements.fichier(800)) return { ...vide, essais: ['« Masquer » enregistre le fichier'] };
  if ((await i.page.evaluate(signauxDansLaPage, null)).length) return { ...vide, essais: ['« Masquer » laisse le signal'] };
  await allerÀ(i.page, 'Opérations');
  const aprèsUnTour = (await lireLAccueil(i, où, false)).signaux;
  await rouvrir(i);
  const àLaSuivante = (await lireLAccueil(i, où, true)).signaux;
  return { où, commande: 'Masquer', essais: [], aprèsUnTour, àLaSuivante };
}

/** Le tour des onglets depuis l'accueil, signal affiché : chaque onglet sous le doigt, et ouvert. */
async function faireLeTour(i: Instance, où: string): Promise<Tour> {
  const page = i.page;
  i.dialogues.length = 0;
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
  return { où, étapes, modales: [...modales], dialogues: [...i.dialogues], planAffiché };
}

/** Renomme la première catégorie de dépense de l'exemple : un changement des données. */
async function changerLesDonnées(i: Instance, nouveau: string): Promise<void> {
  await allerÀ(i.page, 'Plus');
  expect(await cliquer(i.page, 'Catégories'), 'écran Catégories introuvable').toBe(true);
  await pause(200);
  const ouvert = await i.page.evaluate(() => {
    const b = [...document.querySelectorAll('main .row button')].find((x) => x.textContent?.trim() === 'Modifier') as HTMLButtonElement | undefined;
    b?.click();
    return !!b;
  });
  expect(ouvert, 'aucune catégorie à modifier sur l’écran Catégories').toBe(true);
  await pause(200);
  const enregistré = await i.page.evaluate(async (nom: string) => {
    const f = document.querySelector('form') as HTMLFormElement | null;
    const l = f && [...f.querySelectorAll('label')].find((x) => x.textContent?.trim().startsWith('Nom'));
    const champ = l?.querySelector('input') as HTMLInputElement | null;
    if (!f || !champ) return false;
    champ.value = nom;
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((fin) => setTimeout(fin, 50));
    f.requestSubmit();
    for (let k = 0; k < 40 && f.isConnected; k++) await new Promise((fin) => setTimeout(fin, 50));
    return !f.isConnected;
  }, nouveau);
  expect(enregistré, `la catégorie ne se renomme pas en « ${nouveau} »`).toBe(true);
  await pause(800);
}

/** Branche la page sur le relais en mémoire. */
async function brancher(i: Instance, r: ReturnType<typeof relais>): Promise<void> {
  await i.page.setRequestInterception(true);
  i.page.on('request', r.pourLaPage);
}

/** Synchronise par l'écran Synchronisation, comme le harnais d'I7 : adresse, salon, phrase, puis le bouton. */
async function synchroniserParLeRelais(i: Instance): Promise<void> {
  await allerÀ(i.page, 'Plus');
  expect(await cliquer(i.page, 'Synchronisation'), 'écran Synchronisation introuvable').toBe(true);
  await pause(200);
  await i.page.evaluate(
    (url: string, salon: string, phrase: string) => {
      const définir = (input: HTMLInputElement | undefined, v: string) => {
        if (!input || input.value === v) return;
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const entrées = [...document.querySelectorAll('input')] as HTMLInputElement[];
      définir(entrées.find((e) => e.placeholder === 'https://maison.exemple.fr/tirelire'), url);
      définir(entrées.find((e) => e.placeholder === 'identifiant secret'), salon);
      définir(entrées.find((e) => e.type === 'password'), phrase);
    },
    RELAIS.url,
    RELAIS.room,
    RELAIS.passphrase,
  );
  await pause(150);
  expect(await cliquer(i.page, 'Synchroniser maintenant'), 'bouton « Synchroniser maintenant » introuvable').toBe(true);
  // Chiffrement, retrait, application, dépôt : le bouton revient quand l'échange est fini.
  await pause(300);
  await i.page
    .waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Échange…')), { timeout: 20_000 })
    .catch(() => {});
  await pause(800);
}

/** Relie deux instances en direct, par le code texte copié et collé (C2), et attend la fin de l'échange. */
async function synchroniserEnDirect(a: Instance, b: Instance): Promise<void> {
  for (const i of [a, b]) {
    await allerÀ(i.page, 'Plus');
    expect(await cliquer(i.page, 'Synchronisation'), 'écran Synchronisation introuvable').toBe(true);
    await pause(200);
  }
  const copier = async (i: Instance, quoi: string) => {
    await i.page.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => x.textContent?.includes('Copier le code texte')), { timeout: 15_000 });
    expect(await cliquer(i.page, 'Copier le code texte'), `${quoi} : « Copier le code texte » introuvable`).toBe(true);
    return i.page.evaluate(() => (window as unknown as { __copie41?: string }).__copie41 ?? '');
  };
  const coller = (i: Instance, libellé: string, code: string) =>
    i.page.evaluate(
      (l: string, v: string) => {
        const champ = [...document.querySelectorAll('label')].find((x) => x.textContent?.includes(l))?.querySelector('textarea');
        if (!champ) return false;
        champ.value = v;
        champ.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      },
      libellé,
      code,
    );
  expect(await cliquer(a.page, 'Proposer'), '« Proposer » introuvable').toBe(true);
  const offre = await copier(a, 'offre');
  expect(await cliquer(b.page, 'Rejoindre'), '« Rejoindre » introuvable').toBe(true);
  expect(await coller(b, 'Code (texte)', offre), 'champ du code introuvable').toBe(true);
  await pause(100);
  expect(await cliquer(b.page, 'Répondre'), '« Répondre » introuvable').toBe(true);
  const réponse = await copier(b, 'réponse');
  expect(await coller(a, 'Réponse (code texte)', réponse), 'champ de la réponse introuvable').toBe(true);
  await pause(100);
  expect(await cliquer(a.page, 'Connecter'), '« Connecter » introuvable').toBe(true);
  for (const [i, nom] of [[a, 'A'], [b, 'B']] as const)
    await i.page.waitForFunction(() => document.body.innerText.includes('Synchronisé avec'), { timeout: 30_000 }).catch(() => {
      throw new Error(`l'échange direct n'a pas abouti sur ${nom}`);
    });
  await pause(800);
}

/** Importe un fichier par le champ de fichier de Réglages (ou de Synchronisation) que `motif` désigne. */
async function importer(i: Instance, chemin: string, quoi: 'paquet' | 'fichier'): Promise<void> {
  const trouver = () =>
    i.page.evaluateHandle((q: string) => {
      const champs = [...document.querySelectorAll<HTMLInputElement>('main input[type="file"]')];
      return (
        champs.find((c) => {
          const l = c.closest('label')?.textContent ?? '';
          return q === 'paquet' ? /paquet/i.test(l) || /json/i.test(c.accept) : /sqlite/i.test(c.accept);
        }) ?? null
      );
    }, quoi);
  await allerAuxRéglages(i);
  let champ = (await trouver()).asElement();
  if (!champ && quoi === 'paquet') {
    await allerÀ(i.page, 'Plus');
    await cliquer(i.page, 'Synchronisation');
    await pause(200);
    champ = (await trouver()).asElement();
  }
  expect(champ, `aucun champ pour importer un ${quoi}`).not.toBeNull();
  await (champ as unknown as { uploadFile(p: string): Promise<void> }).uploadFile(chemin);
  await pause(1_500);
}

/** Écrit des octets dans un fichier temporaire, pour un champ de fichier. */
function fichierTemporaire(nom: string, octets: Uint8Array | string): { chemin: string; effacer(): void } {
  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-41-import-'));
  const chemin = join(dossier, nom);
  writeFileSync(chemin, octets);
  return { chemin, effacer: () => rmSync(dossier, { recursive: true, force: true }) };
}

/** Un paquet de l'exemple, tel qu'une autre instance l'exporte. */
async function paquetDeLExemple(): Promise<string> {
  const store = await LedgerStore.create({ sqlJs: SQL });
  const l = exampleLedger();
  for (const clé of LEDGER_KEYS) for (const r of l[clé]) store.upsert(clé, r as never);
  const paquet = JSON.stringify(exportBundle(store, {}, 'Autre appareil'));
  store.close();
  return paquet;
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

describe('[niveau 1] C5 · #41 · 1. deux dates, dites sans chercher', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('Réglages et le signal disent la dernière sauvegarde et la dernière synchronisation, « jamais » sans elles', async () => {
      const a = await instance(site, J);
      try {
        await chargerLExemple(a);
        await rouvrir(a);
        const signal1 = await lireLAccueil(a, 'jamais sauvegardé', true);
        const carte1 = await lireLaCarte(a);
        const sauvegarde = await sauvegarderDepuisLaCarte(a, 'Réglages');
        expect(sauvegarde.chemin, `la carte « Données » n'enregistre plus le fichier (${sauvegarde.essais.join(' ; ')})`).not.toBeNull();
        await changerLesDonnées(a, 'CHANGÉE-41-1');
        await rouvrir(a, J70);
        const signal2 = await lireLAccueil(a, 'sauvegardé il y a soixante-dix jours, changé depuis', true);
        const carte2 = await lireLaCarte(a);

        vérifierDates({ où: 'Réglages, jamais sauvegardé ni synchronisé', texte: carte1, sauvegarde: 'jamais', synchronisation: 'jamais' });
        vérifierDates({ où: 'Réglages, sauvegardé le 20 septembre, jamais synchronisé', texte: carte2, sauvegarde: J, synchronisation: 'jamais' });
        vérifierRappel(signal1);
        vérifierDates({ où: "signal de l'accueil, jamais sauvegardé ni synchronisé", texte: signal1.signaux[0]!.texte, sauvegarde: 'jamais', synchronisation: 'jamais' });
        vérifierRappel(signal2);
        vérifierDates({ où: "signal de l'accueil, sauvegardé le 20 septembre", texte: signal2.signaux[0]!.texte, sauvegarde: J, synchronisation: 'jamais' });
      } finally {
        await fermer(a);
      }
    }, 180_000);
  });

  it.fails('témoin rouge · des Réglages qui ne disent aucune date', () => {
    vérifierDates({ où: 'Réglages', texte: "Tout est stocké dans ce navigateur, dans un fichier SQLite. Exportez-le régulièrement : c'est votre sauvegarde.", sauvegarde: 'jamais', synchronisation: 'jamais' });
  });
  it.fails('témoin rouge · une sauvegarde faite que les Réglages disent encore « jamais »', () => {
    vérifierDates({ où: 'Réglages', texte: 'Dernière sauvegarde : jamais\nDernière synchronisation : jamais', sauvegarde: J, synchronisation: 'jamais' });
  });
  it.fails('témoin rouge · un signal qui ne dit pas les dates', () => {
    vérifierDates({ où: 'signal', texte: 'Pensez à enregistrer une copie de vos données.\nEnregistrer une copie', sauvegarde: 'jamais', synchronisation: 'jamais' });
  });
});

describe('[niveau 1] C5 · #41 · 2. ce qui compte', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('relais : un dépôt accepté date la synchronisation et dit « relais » ; un dépôt refusé ne change rien', async () => {
      const r = relais();
      const a = await instance(site, J);
      try {
        await brancher(a, r);
        await chargerLExemple(a);
        await synchroniserParLeRelais(a);
        expect(r.dépôts.length, "la page n'a rien déposé sur le relais").toBeGreaterThan(0);
        await rouvrir(a);
        const acceptée = await lireLaCarte(a);
        await rouvrir(a, J2);
        await changerLesDonnées(a, 'CHANGÉE-41-2');
        r.état.refuser = true;
        const avant = r.dépôts.length;
        await synchroniserParLeRelais(a);
        expect(r.dépôts.length, 'le relais devait refuser le dépôt').toBe(avant);
        await rouvrir(a);
        const refusée = await lireLaCarte(a);

        vérifierDates({ où: 'Réglages, après un dépôt accepté le 20 septembre', texte: acceptée, synchronisation: J, moyen: 'relais' });
        vérifierDates({ où: 'Réglages, après un dépôt refusé le 22 septembre', texte: refusée, synchronisation: J, moyen: 'relais' });
      } finally {
        await fermer(a);
      }
    }, 180_000);

    it('paquet : un paquet importé date la synchronisation et dit « paquet » ; un paquet illisible ne change rien', async () => {
      const bon = fichierTemporaire('tirelire-paquet.json', await paquetDeLExemple());
      const mauvais = fichierTemporaire('tirelire-paquet-illisible.json', '{ ceci n’est pas un paquet');
      const a = await instance(site, J);
      try {
        await importer(a, bon.chemin, 'paquet');
        await rouvrir(a);
        const importé = await lireLaCarte(a);
        await rouvrir(a, J2);
        await importer(a, mauvais.chemin, 'paquet');
        await rouvrir(a);
        const illisible = await lireLaCarte(a);

        vérifierDates({ où: 'Réglages, après un paquet importé le 20 septembre', texte: importé, synchronisation: J, moyen: 'paquet' });
        vérifierDates({ où: 'Réglages, après un paquet illisible le 22 septembre', texte: illisible, synchronisation: J, moyen: 'paquet' });
      } finally {
        await fermer(a);
        bon.effacer();
        mauvais.effacer();
      }
    }, 180_000);

    it('direct : un échange abouti date la synchronisation des deux côtés et dit « direct »', async () => {
      const a = await instance(site, J);
      const b = await instance(site, J);
      try {
        await chargerLExemple(a);
        await synchroniserEnDirect(a, b);
        await rouvrir(a);
        await rouvrir(b);
        const carteA = await lireLaCarte(a);
        const carteB = await lireLaCarte(b);

        vérifierDates({ où: "Réglages de l'instance qui propose", texte: carteA, synchronisation: J, moyen: 'direct' });
        vérifierDates({ où: "Réglages de l'instance qui rejoint", texte: carteB, synchronisation: J, moyen: 'direct' });
      } finally {
        await fermer(a, b);
      }
    }, 180_000);
  });

  it.fails('témoin rouge · un dépôt refusé par le relais qui date quand même la synchronisation', () => {
    vérifierDates({ où: 'Réglages', texte: 'Dernière sauvegarde : jamais\nDernière synchronisation : 22 sept. 2026, par le relais', synchronisation: J, moyen: 'relais' });
  });
  it.fails('témoin rouge · une synchronisation qui ne dit pas par quel moyen', () => {
    vérifierDates({ où: 'Réglages', texte: 'Dernière synchronisation : 20 sept. 2026', synchronisation: J, moyen: 'paquet' });
  });
});

describe('[niveau 0] C5 · #41 · 3. le rappel', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('jamais sauvegardées : une base vide ne rappelle rien ; des données, si, dès l’accueil, et une synchronisation n’en dispense pas', async () => {
      const r = relais();
      const a = await instance(site, J);
      try {
        await brancher(a, r);
        const vide = await lireLAccueil(a, 'base vide', false);
        await chargerLExemple(a);
        await rouvrir(a);
        const données = await lireLAccueil(a, 'exemple chargé, jamais sauvegardé', true);
        await synchroniserParLeRelais(a);
        expect(r.dépôts.length, "la page n'a rien déposé sur le relais").toBeGreaterThan(0);
        await rouvrir(a);
        const synchronisées = await lireLAccueil(a, 'synchronisé par le relais, jamais sauvegardé', true);

        vérifierSansRappel(vide);
        vérifierRappel(données);
        vérifierRappel(synchronisées);
      } finally {
        await fermer(a);
      }
    }, 180_000);

    it('sauvegardées : ni cinq jours après, changées ou non, ni soixante-dix jours après sans changement ; soixante-dix jours après un changement, si', async () => {
      const a = await instance(site, J);
      const b = await instance(site, J);
      try {
        for (const i of [a, b]) {
          await chargerLExemple(i);
          const s = await sauvegarderDepuisLaCarte(i, 'Réglages');
          expect(s.chemin, `la carte « Données » n'enregistre plus le fichier (${s.essais.join(' ; ')})`).not.toBeNull();
        }
        await rouvrir(a, J5);
        const cinqJours = await lireLAccueil(a, 'cinq jours après la sauvegarde, rien de changé', false);
        await changerLesDonnées(a, 'CHANGÉE-41-3');
        await rouvrir(a, J5);
        const cinqJoursChangées = await lireLAccueil(a, 'cinq jours après la sauvegarde, données changées', false);
        await rouvrir(a, J70);
        const soixanteDixChangées = await lireLAccueil(a, 'soixante-dix jours après la sauvegarde, données changées', true);
        await rouvrir(b, J70);
        const soixanteDix = await lireLAccueil(b, 'soixante-dix jours après la sauvegarde, rien de changé', false);

        vérifierSansRappel(cinqJours);
        vérifierSansRappel(cinqJoursChangées);
        vérifierSansRappel(soixanteDix);
        vérifierRappel(soixanteDixChangées);
      } finally {
        await fermer(a, b);
      }
    }, 240_000);
  });

  it.fails('témoin rouge · des données jamais sauvegardées que l’accueil ne rappelle pas', () => {
    vérifierRappel({ où: 'exemple chargé, jamais sauvegardé', signaux: [] });
  });
  it.fails('témoin rouge · une sauvegarde dépassée par des changements que l’accueil tait', () => {
    vérifierRappel({ où: 'soixante-dix jours après la sauvegarde, données changées', signaux: [] });
  });
  it.fails('témoin rouge · un rappel alors que rien n’a changé depuis la sauvegarde', () => {
    vérifierSansRappel({ où: 'soixante-dix jours après la sauvegarde, rien de changé', signaux: [{ texte: 'Dernière sauvegarde le 20 sept. 2026 : enregistrez une copie.', commandes: ['Enregistrer une copie'] }] });
  });
});

describe('[niveau 1] C5 · #41 · 4. un seul signal', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('persistance refusée et sauvegarde à faire : un seul signal, qui dit les deux', async () => {
      const a = await instance(site, J, 'refusée');
      try {
        await chargerLExemple(a);
        await rouvrir(a);
        vérifierUnSeulSignal(await lireLAccueil(a, 'persistance refusée, jamais sauvegardé', true));
      } finally {
        await fermer(a);
      }
    }, 120_000);

    it('le rappel ne bloque rien, et se masque pour l’ouverture en cours seulement', async () => {
      const a = await instance(site, J);
      try {
        await chargerLExemple(a);
        await rouvrir(a);
        const accueil = await lireLAccueil(a, 'jamais sauvegardé', true);
        vérifierRappel(accueil);
        await allerÀ(a.page, 'Plan');
        vérifierRienNeBloque(await faireLeTour(a, 'rappel affiché'));
        vérifierMasquage(await masquerLeSignal(a, 'rappel affiché'));
      } finally {
        await fermer(a);
      }
    }, 180_000);
  });

  it.fails('témoin rouge · deux signaux sur la sûreté des données', () => {
    vérifierUnSeulSignal({
      où: 'persistance refusée, jamais sauvegardé',
      signaux: [
        { texte: 'Vos données peuvent être effacées par le navigateur', commandes: ['Enregistrer une copie', 'Masquer'] },
        { texte: 'Dernière sauvegarde : jamais', commandes: ['Sauvegarder'] },
      ],
    });
  });
  it.fails('témoin rouge · un rappel qui bloque l’écran', () => {
    vérifierRienNeBloque({ où: 'rappel affiché', étapes: [{ onglet: 'Opérations', résultat: 'couvert par div.voile' }], modales: ['Sauvegardez vos données'], dialogues: [], planAffiché: false });
  });
  it.fails('témoin rouge · un rappel qu’on ne peut pas masquer', () => {
    vérifierMasquage({ où: 'rappel affiché', commande: null, essais: ['« Enregistrer une copie » : enregistre'], aprèsUnTour: [], àLaSuivante: [] });
  });
  it.fails('témoin rouge · un rappel masqué pour toujours', () => {
    vérifierMasquage({ où: 'rappel affiché', commande: 'Masquer', essais: [], aprèsUnTour: [], àLaSuivante: [] });
  });
});

describe('[niveau 1] C5 · #41 · 5. un geste suffit', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('depuis le signal : un geste enregistre le fichier des données ; aussitôt, le rappel disparaît et Réglages dit la date', async () => {
      const a = await instance(site, J);
      try {
        await chargerLExemple(a);
        await rouvrir(a);
        const geste = await sauvegarderDepuisLeSignal(a, 'signal, jamais sauvegardé');
        await pause(1_000);
        const après = { où: 'aussitôt après la sauvegarde depuis le signal', signaux: await a.page.evaluate(signauxDansLaPage, null) };
        const carte = await lireLaCarte(a);

        vérifierUnGeste(geste);
        vérifierSansRappel(après);
        vérifierDates({ où: 'Réglages, aussitôt après la sauvegarde depuis le signal', texte: carte, sauvegarde: J });
      } finally {
        await fermer(a);
      }
    }, 180_000);

    it('depuis Réglages : un geste enregistre le fichier ; aussitôt, la carte « Données » dit la date et le rappel disparaît', async () => {
      const a = await instance(site, J);
      try {
        await chargerLExemple(a);
        const geste = await sauvegarderDepuisLaCarte(a, 'Réglages, jamais sauvegardé');
        await pause(1_000);
        const carte = await a.page.evaluate(() => {
          const titre = [...document.querySelectorAll('main h1, main h2, main h3')].find((h) => h.textContent?.trim() === 'Données');
          return (titre?.nextElementSibling as HTMLElement | null | undefined)?.innerText ?? null;
        });
        const accueil = await lireLAccueil(a, 'aussitôt après la sauvegarde depuis Réglages', false);

        vérifierUnGeste(geste);
        vérifierDates({ où: 'Réglages, aussitôt après la sauvegarde, sans rouvrir', texte: carte, sauvegarde: J });
        vérifierSansRappel(accueil);
      } finally {
        await fermer(a);
      }
    }, 180_000);
  });

  it.fails('témoin rouge · un signal qui n’enregistre rien en un geste', () => {
    vérifierUnGeste({ où: 'signal', chemin: null, essais: ['« Masquer » : rien de téléchargé'], fichier: null });
  });
  it.fails('témoin rouge · une sauvegarde qui n’apparaît qu’à l’ouverture suivante', () => {
    vérifierDates({ où: 'Réglages, aussitôt après la sauvegarde', texte: 'Dernière sauvegarde : jamais', sauvegarde: J });
  });
  it.fails('témoin rouge · un rappel qui reste après la sauvegarde', () => {
    vérifierSansRappel({ où: 'aussitôt après la sauvegarde', signaux: [{ texte: 'Dernière sauvegarde : jamais', commandes: ['Enregistrer une copie'] }] });
  });
});

describe('[niveau 0] C5 · #41 · 6. des dates propres à l’instance', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('une instance synchronisée avec une autre, sauvegardée et synchronisée, garde ses propres dates ; le fichier n’en porte aucune', async () => {
      const r = relais();
      const a = await instance(site, J);
      let b: Instance | undefined;
      let c: Instance | undefined;
      let fichier: ReturnType<typeof fichierTemporaire> | undefined;
      try {
        await brancher(a, r);
        await chargerLExemple(a);
        const s = await sauvegarderDepuisLaCarte(a, 'Réglages de A');
        expect(s.octets, `la carte « Données » n'enregistre plus le fichier (${s.essais.join(' ; ')})`).not.toBeNull();
        await synchroniserParLeRelais(a);
        expect(r.dépôts.length, "A n'a rien déposé sur le relais").toBeGreaterThan(0);

        b = await instance(site, '2026-09-23');
        await brancher(b, r);
        await synchroniserParLeRelais(b);
        await rouvrir(b);
        const carteB = await lireLaCarte(b);

        fichier = fichierTemporaire('tirelire-a.sqlite', s.octets!);
        c = await instance(site, '2026-09-24');
        await importer(c, fichier.chemin, 'fichier');
        await rouvrir(c);
        const carteC = await lireLaCarte(c);

        vérifierDates({ où: 'B, synchronisée le 23 septembre par le relais avec A, sauvegardée et synchronisée le 20', texte: carteB, sauvegarde: 'jamais', synchronisation: '2026-09-23', moyen: 'relais' });
        vérifierDates({ où: 'C, qui ouvre le fichier sauvegardé par A', texte: carteC, sauvegarde: 'jamais', synchronisation: 'jamais' });
      } finally {
        await fermer(a, ...[b, c].filter((x): x is Instance => !!x));
        fichier?.effacer();
      }
    }, 240_000);
  });

  it.fails('témoin rouge · une date de sauvegarde reçue par la synchronisation', () => {
    vérifierDates({ où: 'B', texte: 'Dernière sauvegarde : 20 sept. 2026\nDernière synchronisation : 23 sept. 2026, par le relais', sauvegarde: 'jamais', synchronisation: '2026-09-23', moyen: 'relais' });
  });
  it.fails('témoin rouge · des dates portées par le fichier', () => {
    vérifierDates({ où: 'C', texte: 'Dernière sauvegarde : 20 sept. 2026\nDernière synchronisation : 20 sept. 2026, par le relais', sauvegarde: 'jamais', synchronisation: 'jamais' });
  });
});

describe('[niveau 0] C5 · #41 · 7. des dates de ces données', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('« Tout effacer », « Charger l’exemple », l’import d’un fichier : la date de sauvegarde revient à « jamais »', async () => {
      const a = await instance(site, J);
      let fichier: ReturnType<typeof fichierTemporaire> | undefined;
      try {
        await chargerLExemple(a);
        const sauvegarder = async (avant: string) => {
          const s = await sauvegarderDepuisLaCarte(a, `Réglages, avant ${avant}`);
          expect(s.octets, `la carte « Données » n'enregistre plus le fichier (${s.essais.join(' ; ')})`).not.toBeNull();
          await rouvrir(a);
          vérifierDates({ où: `Réglages, sauvegardé, avant ${avant}`, texte: await lireLaCarte(a), sauvegarde: J });
          return s.octets!;
        };
        const lectures: Lecture[] = [];

        await sauvegarder('« Tout effacer »');
        await allerAuxRéglages(a);
        expect(await cliquer(a.page, 'Tout effacer'), '« Tout effacer » introuvable').toBe(true);
        await pause(1_500);
        await rouvrir(a);
        lectures.push({ où: 'Réglages, après « Tout effacer »', texte: await lireLaCarte(a), sauvegarde: 'jamais' });

        await allerAuxRéglages(a);
        expect(await cliquer(a.page, "Charger l'exemple"), "« Charger l'exemple » introuvable dans Réglages").toBe(true);
        await pause(1_500);
        await sauvegarder("« Charger l'exemple »");
        await allerAuxRéglages(a);
        expect(await cliquer(a.page, "Charger l'exemple"), "« Charger l'exemple » introuvable dans Réglages").toBe(true);
        await pause(1_500);
        await rouvrir(a);
        lectures.push({ où: "Réglages, après « Charger l'exemple »", texte: await lireLaCarte(a), sauvegarde: 'jamais' });

        const octets = await sauvegarder("l'import d'un fichier");
        fichier = fichierTemporaire('tirelire-sauvegarde.sqlite', octets);
        await importer(a, fichier.chemin, 'fichier');
        await rouvrir(a);
        lectures.push({ où: "Réglages, après l'import d'un fichier", texte: await lireLaCarte(a), sauvegarde: 'jamais' });

        for (const l of lectures) vérifierDates(l);
      } finally {
        await fermer(a);
        fichier?.effacer();
      }
    }, 240_000);
  });

  it.fails('témoin rouge · une date de sauvegarde qui survit à « Tout effacer »', () => {
    vérifierDates({ où: 'Réglages, après « Tout effacer »', texte: 'Dernière sauvegarde : 20 sept. 2026\nDernière synchronisation : jamais', sauvegarde: 'jamais' });
  });
  it.fails('témoin rouge · une date de sauvegarde gardée après l’import d’un autre fichier', () => {
    vérifierDates({ où: "Réglages, après l'import d'un fichier", texte: 'Dernière sauvegarde : 20 sept. 2026', sauvegarde: 'jamais' });
  });
});

describe('[niveau 0] C5 · #41 · 8. rien ne se perd, rien ne sort', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    it('le fichier sauvegardé se rouvre à l’identique ailleurs, et seules des lectures de l’application partent', async () => {
      const a = await instance(site, J);
      let b: Instance | undefined;
      let fichier: ReturnType<typeof fichierTemporaire> | undefined;
      try {
        await chargerLExemple(a);
        await changerLesDonnées(a, 'CHANGÉE-41-8');
        const s1 = await sauvegarderDepuisLaCarte(a, 'Réglages de A');
        expect(s1.octets, `la carte « Données » n'enregistre plus le fichier (${s1.essais.join(' ; ')})`).not.toBeNull();
        fichier = fichierTemporaire('tirelire-a.sqlite', s1.octets!);
        b = await instance(site, '2026-09-21');
        await importer(b, fichier.chemin, 'fichier');
        await rouvrir(b);
        const s2 = await sauvegarderDepuisLaCarte(b, 'Réglages de B');

        vérifierÀLIdentique({ où: 'le fichier de A, ouvert sur B puis sauvegardé', avant: await contenu(s1.octets!), après: s2.octets ? await contenu(s2.octets) : null });
        const origine = new URL(site.url).origin;
        vérifierRienNeSort('A : exemple, changement, sauvegarde', origine, a.requêtes);
        vérifierRienNeSort('B : ouverture du fichier, sauvegarde', origine, b.requêtes);
      } finally {
        await fermer(a, ...[b].filter((x): x is Instance => !!x));
        fichier?.effacer();
      }
    }, 180_000);
  });

  it.fails('témoin rouge · une sauvegarde rouverte à laquelle il manque une ligne', () => {
    vérifierÀLIdentique({ où: 'le fichier rouvert', avant: { tirelires: ['{"id":"t1"}', '{"id":"t2"}'] }, après: { tirelires: ['{"id":"t1"}'] } });
  });
  it.fails('témoin rouge · une requête sortie pendant la sauvegarde', () => {
    vérifierRienNeSort('sauvegarde', 'http://localhost:4173', [{ méthode: 'POST', url: 'https://sauvegarde.exemple.invalid/depot', corps: true }]);
  });
});

describe('[niveau 1] C5 · #41 · 10. une bêta le dit', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    for (const réponse of ['accordée', 'refusée'] as const) {
      it(`${réponse === 'accordée' ? 'le rappel' : 'le signal de la persistance refusée'} dit qu'en bêta un fichier peut ne plus s'ouvrir à la version suivante, et que la sauvegarde le garde tel quel`, async () => {
        const a = await instance(site, J, réponse);
        try {
          await chargerLExemple(a);
          await rouvrir(a);
          vérifierBêta(await lireLAccueil(a, `persistance ${réponse}, jamais sauvegardé`, true));
        } finally {
          await fermer(a);
        }
      }, 120_000);
    }
  });

  it.fails('témoin rouge · un signal de bêta qui tait que le fichier peut ne plus s’ouvrir', () => {
    vérifierBêta({ où: 'rappel', signaux: [{ texte: 'Pensez à enregistrer une copie de vos données\nDernière sauvegarde : jamais\nDernière synchronisation : jamais', commandes: ['Enregistrer une copie', 'Masquer'] }] });
  });
});
