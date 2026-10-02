/**
 * Harnais d'audit de #209 — « Le compte principal existe dans toute base, même vide ».
 * Garde I8 (D58, garantie A : le compte principal a la même identité sur toutes les instances), et
 * ce que #209 demande de D40 (il naît avec la base, l'assistant le renseigne) et de D41.
 *
 * Fichier de niveau 0 et 1, que le registre cite (D81). Les niveaux 2 à 4 sont dans
 * `compte-principal-cas.test.ts` ; ce qui se voit à l'écran — le plan, l'écran Comptes, l'assistant —
 * dans `navigateur/compte-principal.test.ts`, parce que les tests navigateur vivent à part (D83).
 *
 * Chaque `describe` reprend un point du « Fait quand » de l'issue, sous son numéro. Le harnais
 * passe par ce que l'application appelle déjà : le dépôt (`LedgerStore`, que `openStore` ouvre pour
 * chaque base, neuve ou après « Repartir » et « Tout effacer »), le protocole (`runSync`), l'échange
 * par fichier (`exportBundle`, `importBundle`) et le relais (`relaySync`), sur l'exemple chargé comme
 * le fait l'application (`replaceWith`). Il ne suppose rien de ce que l'issue laisse au codeur : ni
 * l'identifiant choisi, ni la façon dont le dépôt distingue un compte principal renseigné de son
 * défaut, ni la forme du refus.
 *
 * Ce que chaque point mesure, et où il s'arrête :
 *
 * 1. Une base neuve, une base rouverte avec l'identité d'une instance qui a tout effacé, et un
 *    fichier rouvert ont un compte principal vivant et un seul ; leur plan ne porte aucun
 *    avertissement d'absence.
 * 2. Deux bases neuves et l'exemple ont le même identifiant ; deux instances nées séparément n'ont
 *    qu'un compte principal après synchronisation, par chaque transport.
 * 3. Le compte principal renseigné (nom, banque, solde et date d'ouverture) l'emporte sur le défaut,
 *    que le défaut soit né avant ou après lui — l'horloge de chaque instance est réglée par le
 *    test —, par chaque transport et dans les deux sens ; l'exemple chargé d'un côté donne le même
 *    compte principal et le même plan de l'autre. Deux renseignements concurrents sont un conflit
 *    ordinaire (D58) : même version des deux côtés, l'écartée dans la trace, comme #196 le mesure.
 * 4. L'assistant : dans le navigateur seulement.
 * 5. Le dépôt refuse, en le disant, de supprimer le compte principal, d'en changer le genre et d'en
 *    écrire un second ; rien n'est écrit. Ce que l'écran propose se mesure dans le navigateur.
 * 6. Un fichier exporté se rouvre à l'identique, compte principal renseigné compris. Le plan de
 *    l'exemple et l'import d'un relevé : second fichier (niveau 2).
 * 7. Les catalogues : en relisant (D81).
 *
 * Les assertions sont dans des fonctions à part, pour que les témoins rouges, en fin de fichier,
 * rejouent les mêmes sur une version volontairement cassée du besoin.
 *
 * Niveaux (D83), marqués dans chaque titre ; un témoin a le niveau de ce qu'il garde :
 * - 0 : point 3 (un compte principal renseigné écrasé par un défaut est une ligne réécrite, dont
 *   rien ne reste, D58 ; un conflit tranché sans le montrer, comme #196) ; point 6.
 * - 1 : points 1, 2 et 5 (D58 garantie A, sous I8 ; tous les usages passent par le compte
 *   principal : sans lui, ou avec deux, aucun ne tient).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import initSqlJs from 'sql.js';
import {
  ACCOUNT_KINDS,
  LedgerStore,
  computePlan,
  exampleLedger,
  exportBundle,
  importBundle,
  memoryTransportPair,
  runSync,
  type Ledger,
  type Plan,
} from '@tirelire/core';
import { relaySync } from '../src/lib/relay';

const SQL = await initSqlJs();
const AUJOURD_HUI = '2026-09-06';
const CLES = ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows', 'operations', 'subOperations', 'automations', 'importProfiles', 'devices'] as const;
type Cle = (typeof CLES)[number];
type Ligne = Record<string, unknown> & { id: string };

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Outils
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Une minute : l'écart d'horloge entre deux instances, pour que l'ordre de naissance soit sans ambiguïté. */
const UNE_MINUTE = 60_000;

/**
 * Une instance neuve — la base que `openStore` ouvre quand rien n'est enregistré —, ou ouverte
 * depuis un fichier. Son horloge est décalée de `decalage` ms : une instance née avec un décalage
 * plus grand écrit des lignes plus récentes. Jamais d'identité imposée : c'est au dépôt.
 */
function naissance(decalage = 0, bytes?: Uint8Array): Promise<LedgerStore> {
  return LedgerStore.create({ sqlJs: SQL, now: () => Date.now() + decalage, ...(bytes ? { bytes } : {}) });
}

function lignes(store: LedgerStore, cle: Cle): Ligne[] {
  return (store.load()[cle] as unknown as Ligne[]).slice();
}

/** Les comptes principaux vivants d'une base. */
function principaux(store: LedgerStore): Ligne[] {
  return lignes(store, 'accounts').filter((a) => a['kind'] === 'principal' && !a['deletedAt']);
}

/** Le compte principal d'une base, quand elle en a un et un seul (sinon le test l'a déjà dit). */
function principal(store: LedgerStore): Ligne {
  return verifierUnSeul(principaux(store), 'la base');
}

/** Ce que l'assistant, ou l'écran Comptes, renseigne sur le compte principal (I11). */
const RENSEIGNE = { name: 'Compte joint du foyer', bank: 'Banque du coin', openingBalance: 123_456, openingDate: '2026-08-01' };

function renseigner(store: LedgerStore, valeurs: Record<string, unknown> = RENSEIGNE): void {
  store.upsert('accounts', { ...principal(store), ...valeurs } as never);
}

/** Charge l'exemple comme l'application (`replaceWith`) : toutes les tables, puis les réglages. */
function charger(store: LedgerStore, l: Ledger = exampleLedger()): void {
  for (const cle of CLES) for (const r of l[cle] as unknown as Ligne[]) store.upsert(cle, r as never);
  for (const [k, v] of Object.entries(l.settings)) if (k !== 'siteId') store.setSetting(k as never, v as never);
}

/** L'état d'une instance, comparable d'une instance à l'autre : sans son identité, lignes triées. */
function etat(store: LedgerStore): Record<string, unknown> {
  const l = store.load() as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const cle of CLES) out[cle] = [...(l[cle] as Ligne[])].sort((a, b) => a.id.localeCompare(b.id));
  const { siteId: _identite, ...reglages } = l['settings'] as Record<string, unknown>;
  out['settings'] = reglages;
  return out;
}

/** Le contenu de toutes les tables d'un fichier SQLite, relu ligne à ligne (pas ses octets libres). */
function contenu(bytes: Uint8Array): string {
  const db = new SQL.Database(bytes);
  try {
    const tables = db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)[0]?.values.map((v) => String(v[0])) ?? [];
    return tables.map((t) => `${t} ${JSON.stringify(db.exec(`SELECT * FROM "${t}"`)[0] ?? null)}`).join('\n');
  } finally {
    db.close();
  }
}

/** Ce que la synchronisation a rendu à une instance, plus ce que son fichier contient. */
function trace(store: LedgerStore, ...rendus: unknown[]): string {
  return JSON.stringify(rendus) + '\n' + contenu(store.export());
}

const plan = (store: LedgerStore): Plan => computePlan(store.load(), AUJOURD_HUI);

/** Ce que rend un geste qui doit être refusé. */
function tenter(fn: () => unknown): { etat: 'refusé' | 'accepté'; dit: string } {
  try {
    const v = fn();
    return { etat: 'accepté', dit: JSON.stringify(v ?? null) };
  } catch (e: unknown) {
    return { etat: 'refusé', dit: e instanceof Error ? e.message : String(e) };
  }
}

// Les trois transports, chacun rendant ce qu'il a rendu à `a` puis à `b`.

/** En direct : le protocole de D16 sur un transport en mémoire, comme le fait WebRTC. */
async function direct(a: LedgerStore, b: LedgerStore): Promise<[unknown, unknown]> {
  const [x, y] = memoryTransportPair();
  return Promise.all([runSync(a, x), runSync(b, y)]);
}

/** Par fichier : chacune importe le paquet de l'autre, détaché de l'instance qui l'a produit. */
async function parFichier(a: LedgerStore, b: LedgerStore): Promise<[unknown, unknown]> {
  const pa = structuredClone(await exportBundle(a));
  const pb = structuredClone(await exportBundle(b));
  const rb = await importBundle(b, pa as never);
  const ra = await importBundle(a, pb as never);
  return [ra, rb];
}

const RELAIS = { url: 'https://relais.exemple.invalid/tirelire', room: 'salon-209', passphrase: 'phrase du foyer 209' };

/** Un relais en mémoire, au contrat de `apps/hebergement/serveur/relais.php` : rien ne sort de la machine. */
function relaisFactice(): void {
  const depots: Array<Record<string, unknown> & { id: number; site?: unknown }> = [];
  const repondre = (corps: unknown) => new Response(JSON.stringify(corps), { status: 200, headers: { 'content-type': 'application/json' } });
  const faux = async (entree: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url);
    if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
      const corps = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const id = depots.length + 1;
      depots.push({ ...corps, id });
      return repondre({ id });
    }
    const site = url.searchParams.get('site') ?? '';
    const apres = Number(url.searchParams.get('after') ?? 0);
    return repondre({ records: depots.filter((r) => r.id > apres && r.site !== site) });
  };
  vi.stubGlobal('fetch', faux);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Par le relais : A dépose, B dépose et retire, A retire. */
async function parRelais(a: LedgerStore, b: LedgerStore): Promise<[unknown, unknown]> {
  relaisFactice();
  const ra1 = await relaySync(a, RELAIS);
  const rb = await relaySync(b, RELAIS);
  const ra2 = await relaySync(a, RELAIS);
  return [[ra1, ra2], rb];
}

type Transport = (a: LedgerStore, b: LedgerStore) => Promise<[unknown, unknown]>;
const TRANSPORTS: Array<[string, Transport]> = [
  ['en direct', direct],
  ['par fichier', parFichier],
  ['par le relais', parRelais],
];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Assertions, partagées avec les témoins rouges
// ─────────────────────────────────────────────────────────────────────────────────────────────

function verifierUnSeul(comptes: Ligne[], ou: string): Ligne {
  expect(comptes.length, `${ou} : ${comptes.length} compte(s) principal(aux) vivant(s), il en faut un et un seul`).toBe(1);
  return comptes[0]!;
}

function verifierSansGeste(store: LedgerStore, comptes: Ligne[], ou: string): void {
  verifierUnSeul(comptes, ou);
  const total = lignes(store, 'accounts').filter((a) => !a['deletedAt']).length;
  expect(total, `${ou} : ${total} compte(s), le seul compte d'une base neuve est le principal`).toBe(1);
}

function verifierPlanSansAbsence(p: Plan, ou: string): void {
  const absence = p.warnings.filter((w) => String(w.code) === 'noPrincipal' || /aucun compte principal/i.test(w.message));
  expect(absence, `${ou} : le plan signale une absence de compte principal`).toEqual([]);
}

function verifierMemeIdentite(ids: Array<[string, string]>): void {
  const distincts = new Set(ids.map(([, id]) => id));
  expect([...distincts].length, `identifiants différents : ${ids.map(([qui, id]) => `${qui} = ${id}`).join(', ')}`).toBe(1);
}

function verifierConvergence(...instances: LedgerStore[]): void {
  const [premiere, ...autres] = instances.map(etat);
  for (const e of autres) expect(e, 'les instances n’ont pas le même état').toEqual(premiere);
}

function verifierRenseigne(compte: Ligne, attendu: Record<string, unknown>, ou: string): void {
  const vu = Object.fromEntries(Object.keys(attendu).map((k) => [k, compte[k]]));
  expect(vu, `${ou} : le compte principal ne porte pas ce qui a été renseigné`).toEqual(attendu);
}

function verifierMemePlan(a: Plan, b: Plan): void {
  expect(JSON.parse(JSON.stringify(b)), 'le plan n’est pas le même des deux côtés').toEqual(JSON.parse(JSON.stringify(a)));
}

function verifierConflitMontre(traceInstance: string, ecarte: string): void {
  expect(traceInstance.includes(ecarte), `la version écartée (${ecarte}) n’est ni rendue ni gardée`).toBe(true);
}

function verifierRefusDit(r: { etat: string; dit: string }, geste: string): void {
  expect(r.etat, `${geste} : le dépôt ne refuse pas`).toBe('refusé');
  expect(r.dit, `${geste} : le refus ne dit pas qu'il s'agit du compte principal`).toMatch(/principal/i);
}

function verifierRienEcrit(avant: string, apres: string, geste: string): void {
  expect(apres, `${geste} : le dépôt a écrit malgré le refus`).toBe(avant);
}

function verifierMemeFichier(a: LedgerStore, b: LedgerStore, bytes: Uint8Array): void {
  expect(etat(b), 'le fichier rouvert n’a pas le même état').toEqual(etat(a));
  expect(contenu(b.export()), 'le fichier rouvert n’a pas le même contenu').toBe(contenu(bytes));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. Toute base a son compte principal
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('[niveau 1] #209 · 1. toute base a son compte principal', () => {
  it('une base neuve a un compte principal et un seul, sans aucun geste, et son plan ne signale pas d’absence', async () => {
    const s = await naissance();
    verifierSansGeste(s, principaux(s), 'base neuve');
    verifierPlanSansAbsence(plan(s), 'base neuve');
  });

  it('une base rouverte à neuf par une instance qui a tout effacé (« Repartir », « Tout effacer ») a le sien', async () => {
    // `eraseAll` et `startOver` effacent le fichier et rouvrent : l'instance garde son identité et son
    // horloge (`openStore`, `db.ts`), la base est neuve.
    const avant = await naissance();
    renseigner(avant);
    const { siteId, lastHlc } = avant.instanceState();
    const s = await LedgerStore.create({ sqlJs: SQL, instance: { siteId, ...(lastHlc ? { lastHlc } : {}) } });
    verifierSansGeste(s, principaux(s), 'base après « Repartir »');
    verifierPlanSansAbsence(plan(s), 'base après « Repartir »');
  });

  it('un fichier rouvert garde son compte principal, sans en recevoir un second', async () => {
    const a = await naissance();
    renseigner(a);
    const b = await naissance(0, a.export());
    verifierUnSeul(principaux(b), 'fichier rouvert');
    verifierRenseigne(principal(b), RENSEIGNE, 'fichier rouvert');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. Il a la même identité partout
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('[niveau 1] #209 · 2. il a la même identité partout (I8, D58 garantie A)', () => {
  it('deux bases neuves et l’exemple ont le même identifiant de compte principal', async () => {
    const a = await naissance();
    const b = await naissance(UNE_MINUTE);
    const exemple = exampleLedger().accounts.filter((x) => x.kind === 'principal');
    verifierMemeIdentite([
      ['base A', principal(a).id],
      ['base B', principal(b).id],
      ['exemple', verifierUnSeul(exemple as unknown as Ligne[], 'l’exemple').id],
    ]);
  });

  for (const [nom, transport] of TRANSPORTS) {
    it(`deux instances nées séparément n’ont qu’un compte principal après synchronisation ${nom}`, async () => {
      const a = await naissance();
      const b = await naissance(UNE_MINUTE);
      await transport(a, b);
      verifierUnSeul(principaux(a), `A ${nom}`);
      verifierUnSeul(principaux(b), `B ${nom}`);
      verifierConvergence(a, b);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. Ce qui est renseigné l'emporte sur le défaut
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Les deux ordres de naissance : le défaut de la base neuve est plus ancien, ou plus récent, que le renseignement. */
const NAISSANCES: Array<[string, number, number]> = [
  ['la base neuve est née après le renseignement', 0, UNE_MINUTE],
  ['la base neuve est née avant le renseignement', UNE_MINUTE, 0],
];

describe('[niveau 0] #209 · 3. ce qui est renseigné l’emporte sur le défaut', () => {
  for (const [nom, transport] of TRANSPORTS) {
    it(`${nom}, dans les deux sens et quel que soit l’ordre de naissance, la base neuve prend le compte principal renseigné`, async () => {
      for (const [ordre, decalageRenseignee, decalageNeuve] of NAISSANCES) {
        for (const sens of ['renseignée → neuve', 'neuve → renseignée']) {
          const renseignee = await naissance(decalageRenseignee);
          renseigner(renseignee);
          const neuve = await naissance(decalageNeuve);
          if (sens === 'renseignée → neuve') await transport(renseignee, neuve);
          else await transport(neuve, renseignee);
          const ou = `${nom}, ${sens}, ${ordre}`;
          verifierRenseigne(principal(neuve), RENSEIGNE, `${ou} : base neuve`);
          verifierRenseigne(principal(renseignee), RENSEIGNE, `${ou} : base renseignée`);
          verifierConvergence(renseignee, neuve);
        }
      }
    });

    it(`${nom}, l’exemple chargé d’un côté se retrouve de l’autre, compte principal et plan compris`, async () => {
      for (const [ordre, decalageExemple, decalageNeuve] of NAISSANCES) {
        const avecExemple = await naissance(decalageExemple);
        charger(avecExemple);
        const neuve = await naissance(decalageNeuve);
        await transport(avecExemple, neuve);
        const attendu = exampleLedger().accounts.find((x) => x.kind === 'principal')!;
        verifierRenseigne(principal(neuve), { name: attendu.name, openingBalance: attendu.openingBalance, openingDate: attendu.openingDate }, `${nom}, ${ordre}`);
        verifierMemePlan(plan(avecExemple), plan(neuve));
        verifierConvergence(avecExemple, neuve);
      }
    });
  }

  it('deux renseignements concurrents restent un conflit ordinaire : même version des deux côtés, l’écartée se voit (D58)', async () => {
    const a = await naissance();
    const b = await naissance(UNE_MINUTE);
    await direct(a, b);
    renseigner(a, { ...RENSEIGNE, name: 'ECART-A-209' });
    renseigner(b, { ...RENSEIGNE, name: 'RETENU-B-209' });
    const [ra, rb] = await direct(a, b);
    verifierConvergence(a, b);
    verifierRenseigne(principal(a), { name: 'RETENU-B-209' }, 'A');
    verifierConflitMontre(trace(a, ra), 'ECART-A-209');
    verifierConflitMontre(trace(b, rb), 'ECART-A-209');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5. Il reste présent et unique
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('[niveau 1] #209 · 5. il reste présent et unique', () => {
  it('le dépôt refuse de supprimer le compte principal, en le disant, et n’écrit rien', async () => {
    const s = await naissance();
    renseigner(s);
    const avant = contenu(s.export());
    const r = tenter(() => s.remove('accounts', principal(s).id));
    verifierRefusDit(r, 'supprimer');
    verifierRienEcrit(avant, contenu(s.export()), 'supprimer');
    verifierUnSeul(principaux(s), 'après le refus');
  });

  it('le dépôt refuse de lui donner un autre genre, en le disant, et n’écrit rien', async () => {
    const s = await naissance();
    const avant = contenu(s.export());
    for (const genre of ACCOUNT_KINDS.filter((k) => k !== 'principal')) {
      const r = tenter(() => s.upsert('accounts', { ...principal(s), kind: genre } as never));
      verifierRefusDit(r, `passer au genre ${genre}`);
      verifierRienEcrit(avant, contenu(s.export()), `passer au genre ${genre}`);
    }
    verifierUnSeul(principaux(s), 'après le refus');
  });

  it('le dépôt refuse d’écrire un second compte principal, en le disant, et n’écrit rien', async () => {
    const s = await naissance();
    const avant = contenu(s.export());
    const second = { ...principal(s), id: 'acc-second-principal-209', name: 'Un second' };
    const r = tenter(() => s.upsert('accounts', second as never));
    verifierRefusDit(r, 'un second compte principal');
    verifierRienEcrit(avant, contenu(s.export()), 'un second compte principal');
    verifierUnSeul(principaux(s), 'après le refus');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 6. Ce qui tenait tient encore
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('[niveau 0] #209 · 6. ce qui tenait tient encore', () => {
  it('un fichier exporté se rouvre à l’identique, compte principal renseigné compris', async () => {
    const a = await naissance();
    charger(a);
    renseigner(a);
    a.remove('categories', 'cat-abos');
    const bytes = a.export();
    const b = await naissance(UNE_MINUTE, bytes.slice());
    verifierMemeFichier(a, b, bytes);
    verifierRenseigne(principal(b), RENSEIGNE, 'fichier rouvert');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Témoins rouges : les mêmes assertions, sur une version volontairement cassée du besoin
// ─────────────────────────────────────────────────────────────────────────────────────────────

const cassé = (n: number): Ligne[] =>
  Array.from({ length: n }, (_, i) => ({ id: `acc-${i}`, kind: 'principal', name: `Compte ${i}`, openingBalance: 0, openingDate: AUJOURD_HUI }));

describe('[niveau 1] harnais du registre', () => {
  it.fails('témoin rouge · une base neuve sans compte principal', () => {
    verifierUnSeul(cassé(0), 'base neuve');
  });
  it.fails('témoin rouge · une base neuve qui en a deux', () => {
    verifierUnSeul(cassé(2), 'base neuve');
  });
  it.fails('témoin rouge · un plan qui signale l’absence du compte principal', async () => {
    const s = await naissance();
    const p = plan(s);
    verifierPlanSansAbsence({ ...p, warnings: [...p.warnings, { code: 'noPrincipal', message: 'Aucun compte principal défini.' }] } as Plan, 'base neuve');
  });
  it.fails('témoin rouge · deux bases neuves dont les comptes principaux diffèrent', () => {
    verifierMemeIdentite([
      ['base A', 'acc-a'],
      ['base B', 'acc-b'],
    ]);
  });
  it.fails('témoin rouge · un compte principal qui se laisse supprimer', () => {
    verifierRefusDit({ etat: 'accepté', dit: 'null' }, 'supprimer');
  });
  it.fails('témoin rouge · un refus qui ne dit pas de quel compte il s’agit', () => {
    verifierRefusDit({ etat: 'refusé', dit: 'Écriture refusée.' }, 'supprimer');
  });
  it.fails('témoin rouge · un refus qui écrit quand même', () => {
    verifierRienEcrit('accounts [avant]', 'accounts [après]', 'supprimer');
  });
});

describe('[niveau 0] harnais du registre', () => {
  it.fails('témoin rouge · un défaut plus récent qui écrase ce qui est renseigné', () => {
    verifierRenseigne({ id: 'acc-principal', ...RENSEIGNE, name: 'Compte principal', openingBalance: 0 }, RENSEIGNE, 'base neuve');
  });
  it.fails('témoin rouge · un conflit tranché sans rien en dire', () => {
    verifierConflitMontre('RETENU-B-209', 'ECART-A-209');
  });
  it.fails('témoin rouge · un fichier qui ne se rouvre pas à l’identique', async () => {
    const a = await naissance();
    charger(a);
    const bytes = a.export();
    const b = await naissance(0, bytes.slice());
    renseigner(b);
    verifierMemeFichier(a, b, bytes);
  });
});
