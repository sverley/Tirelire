/**
 * Harnais de #196 — « Le fichier est un état : sans journal, une horloge par ligne, une
 * synchronisation par delta d'état (D58) ». Garde I8 et C8, et ce que #196 demande encore de C5.
 *
 * Chaque `describe` reprend un point du « Fait quand » de l'issue, sous son numéro. Le harnais passe
 * par ce que l'application appelle déjà et que D16 garde : le dépôt (`LedgerStore` : ouvrir un
 * fichier, écrire, supprimer, régler, charger, exporter), le protocole (`runSync` sur un transport),
 * l'échange par fichier (`exportBundle`, `importBundle`) et le relais (`relaySync`). Il ne suppose
 * rien de ce que l'issue laisse au codeur : ni la forme des paquets, ni l'endroit où une instance
 * garde ce qu'elle sait des autres, ni la façon de montrer un conflit ou un refus.
 *
 * Deux lectures, donc, sans nom de table ni de champ :
 *
 * - **l'état**, ce que `load()` rend, sans l'identité de l'instance ;
 * - **la trace** d'une synchronisation, pour une instance : ce que la synchronisation lui a rendu
 *   (le résultat de `runSync`, `importBundle` ou `relaySync`), plus le contenu de toutes les tables
 *   de son fichier exporté, relu ligne à ligne. Un conflit « se voit » quand ce qui est écarté est
 *   dans la trace des deux instances ; une valeur remplacée sans conflit n'y est plus. C'est
 *   nécessaire, pas suffisant : que l'utilisateur le voie à l'écran se garde dans
 *   `navigateur/conflit-visible.test.ts`, second fichier du harnais parce que les tests navigateur
 *   vivent à part (#121) ;
 * - **le fichier**, ligne à ligne : une ligne supprimée reste dans son fichier (D58 : rien d'une
 *   ligne synchronisable ne disparaît physiquement), quoi que `load()` en montre.
 *
 * Le relais est un relais factice en mémoire qui tient le contrat de `apps/hebergement/serveur`
 * (dépôt, puis retrait filtré par appareil et par numéro) : rien ne sort de la machine.
 *
 * Les assertions sont dans des fonctions à part, pour que les témoins rouges, en fin de fichier,
 * rejouent les mêmes sur une version volontairement cassée du besoin.
 */
import { createHash, webcrypto } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import initSqlJs from 'sql.js';
import {
  LedgerStore,
  bankMultiAccountProfile,
  computePlan,
  exampleLedger,
  exportBundle,
  importBundle,
  memoryTransportPair,
  rankBetween,
  runSync,
} from '@tirelire/core';
import { relaySync } from '../src/lib/relay';

const SQL = await initSqlJs();
const AUJOURD_HUI = '2026-09-06';
const CLES = ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows', 'operations', 'allocations', 'automations', 'importProfiles', 'devices'] as const;
type Cle = (typeof CLES)[number];
type Ligne = Record<string, unknown> & { id: string };

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Outils
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Une instance neuve, ou ouverte depuis un fichier. Jamais d'identité imposée : c'est au dépôt. */
function instance(bytes?: Uint8Array): Promise<LedgerStore> {
  return LedgerStore.create({ sqlJs: SQL, ...(bytes ? { bytes } : {}) });
}

function lignes(store: LedgerStore, cle: Cle): Ligne[] {
  return (store.load()[cle] as unknown as Ligne[]).slice();
}

function ecrire(store: LedgerStore, cle: Cle, ligne: Ligne): void {
  store.upsert(cle, ligne as never);
}

/** Toutes les tables de l'exemple, plus une ligne dans celles qu'il laisse vides. */
function semer(store: LedgerStore): void {
  const l = exampleLedger();
  for (const cle of CLES) for (const r of l[cle] as unknown as Ligne[]) ecrire(store, cle, r);
  ecrire(store, 'automations', { id: 'auto-courses', name: 'Courses', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: l.categories[1]!.id }, rank: rankBetween(undefined, undefined) });
  ecrire(store, 'importProfiles', bankMultiAccountProfile('profil-banque') as unknown as Ligne);
  ecrire(store, 'devices', { id: 'appareil-salon', name: 'Tablette du salon' });
  for (const [k, v] of Object.entries(l.settings)) if (k !== 'siteId') store.setSetting(k as never, v as never);
  // Une ligne de plus par table, que rien ne référence : partagée par la première synchronisation,
  // puis supprimée d'un seul côté (`horsLigne`).
  for (const cle of CLES) ecrire(store, cle, copie(store, cle, 'partagee'));
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

/** La ligne `id` est-elle encore dans une table du fichier, supprimée ou non ? */
function dansLeFichier(bytes: Uint8Array, id: string): boolean {
  const db = new SQL.Database(bytes);
  try {
    const tables = db.exec(`SELECT name FROM sqlite_master WHERE type = 'table'`)[0]?.values.map((v) => String(v[0])) ?? [];
    return tables.some((t) => {
      const colonnes = db.exec(`PRAGMA table_info("${t}")`)[0]?.values.map((v) => String(v[1])) ?? [];
      return colonnes.includes('id') && db.exec(`SELECT 1 FROM "${t}" WHERE id = ?`, [id]).length > 0;
    });
  } finally {
    db.close();
  }
}

/** Ce que la synchronisation a rendu à une instance, plus ce que son fichier contient. */
function trace(store: LedgerStore, ...rendus: unknown[]): string {
  return JSON.stringify(rendus) + '\n' + contenu(store.export());
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** En direct : le protocole de D16 sur un transport en mémoire, comme le fait WebRTC. */
async function direct(a: LedgerStore, b: LedgerStore): Promise<[unknown, unknown]> {
  const [x, y] = memoryTransportPair();
  const [ra, rb] = await Promise.all([runSync(a, x), runSync(b, y)]);
  return [ra, rb];
}

/** Un paquet qui a fait le trajet d'un fichier : détaché de l'instance qui l'a produit. */
async function paquet(store: LedgerStore): Promise<unknown> {
  return structuredClone(await exportBundle(store));
}

/** Par fichier : chacune importe le paquet de l'autre. */
async function parFichier(a: LedgerStore, b: LedgerStore): Promise<[unknown, unknown]> {
  const pa = await paquet(a);
  const pb = await paquet(b);
  const rb = await importBundle(b, pa as never);
  const ra = await importBundle(a, pb as never);
  return [ra, rb];
}

const RELAIS = { url: 'https://relais.exemple.invalid/tirelire', room: 'salon-196', passphrase: 'phrase du foyer 196' };

/** Un relais en mémoire, au contrat de `apps/hebergement/serveur/relais.php`. */
function relaisFactice() {
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
  return depots;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Par le relais : A dépose, B dépose et retire, A retire. */
async function parRelais(a: LedgerStore, b: LedgerStore): Promise<[unknown, unknown]> {
  const ra1 = await relaySync(a, RELAIS);
  const rb = await relaySync(b, RELAIS);
  const ra2 = await relaySync(a, RELAIS);
  return [[ra1, ra2], rb];
}

/** Ce que rend une promesse qui doit être refusée, sans attendre au-delà de `ms`. */
async function issue(fn: () => unknown, ms = 2000): Promise<{ etat: 'refusé' | 'accepté' | 'sans réponse'; dit: string }> {
  const delai = new Promise<{ etat: 'sans réponse'; dit: string }>((r) => setTimeout(() => r({ etat: 'sans réponse', dit: '' }), ms));
  const essai = Promise.resolve()
    .then(fn)
    .then(
      (v) => ({ etat: 'accepté' as const, dit: JSON.stringify(v ?? null) }),
      (e: unknown) => ({ etat: 'refusé' as const, dit: e instanceof Error ? e.message : String(e) }),
    );
  return Promise.race([essai, delai]);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Assertions, partagées avec les témoins rouges
// ─────────────────────────────────────────────────────────────────────────────────────────────

function verifierMemeTaille(apresUne: number, apresCent: number): void {
  expect(apresCent, 'le fichier a grossi des modifications, pas des données').toBe(apresUne);
}

function verifierConvergence(...instances: LedgerStore[]): void {
  const [premiere, ...autres] = instances.map(etat);
  for (const e of autres) expect(e, 'les instances n’ont pas le même état').toEqual(premiere);
}

function verifierPresent(store: LedgerStore, cle: Cle, id: string, attendu: Record<string, unknown>): void {
  const r = lignes(store, cle).find((x) => x.id === id);
  expect(r, `${cle} ${id} absent`).toBeDefined();
  expect(r).toMatchObject(attendu);
}

function verifierSupprimeDans(charges: Ligne[], fichier: Uint8Array, cle: Cle, id: string): void {
  const r = charges.find((x) => x.id === id);
  expect(r === undefined || !!r['deletedAt'], `${cle} ${id} n’est pas supprimé`).toBe(true);
  expect(dansLeFichier(fichier, id), `${cle} ${id} a disparu physiquement du fichier`).toBe(true);
}

function verifierSupprime(store: LedgerStore, cle: Cle, id: string): void {
  verifierSupprimeDans(lignes(store, cle), store.export(), cle, id);
}

function verifierConflitMontre(traceInstance: string, ecarte: string): void {
  expect(traceInstance.includes(ecarte), `la version écartée (${ecarte}) n’est ni rendue ni gardée`).toBe(true);
}

function verifierRefus(r: { etat: string; dit: string }): void {
  expect(r.etat, 'le format étranger n’est pas refusé').toBe('refusé');
  expect(r.dit.trim(), 'le refus ne dit rien').not.toBe('');
}

function verifierRefusDit(r: { etat: string; dit: string }): void {
  expect(r.etat, 'la synchronisation ne s’arrête pas').not.toBe('sans réponse');
  if (r.etat === 'accepté') expect(r.dit, 'la synchronisation se termine sans dire le format').toMatch(/format|version/i);
  else expect(r.dit.trim(), 'le refus ne dit rien').not.toBe('');
}

function verifierRienEcrit(avant: string, apres: string): void {
  expect(apres, 'l’instance a écrit en recevant un format étranger').toBe(avant);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Deux instances, modifiées hors ligne dans toutes les tables et les réglages
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * La ligne de chaque table qu'on modifie et qu'on copie. Les copies ne sont référencées par rien,
 * sauf la ventilation d'une copie, qui pointe l'opération copiée avec elle.
 */
function source(store: LedgerStore, cle: Cle): Ligne {
  const rs = lignes(store, cle);
  if (cle === 'accounts') return rs.find((r) => r['kind'] !== 'principal')!;
  return rs[0]!;
}

function copie(store: LedgerStore, cle: Cle, suffixe: string): Ligne {
  const r: Ligne = { ...source(store, cle), id: `${source(store, cle).id}-${suffixe}` };
  if (cle === 'allocations') r['operationId'] = `${source(store, 'operations').id}-${suffixe}`;
  return r;
}

function modifie(store: LedgerStore, cle: Cle): Ligne {
  const r: Ligne = { ...source(store, cle) };
  if (cle === 'allocations') r['categoryId'] = lignes(store, 'categories').find((c) => c.id !== r['categoryId'])!.id;
  else if (cle === 'operations') r['details'] = 'modifié par B';
  else r['name'] = `${String(r['name'] ?? cle)} (B)`;
  return r;
}

/**
 * A crée, supprime ce qu'elle vient de créer et supprime une ligne partagée, que B ne touche pas,
 * dans toutes les tables ; B modifie et crée ; chacune touche un réglage.
 */
function horsLigne(a: LedgerStore, b: LedgerStore): void {
  for (const cle of CLES) {
    ecrire(a, cle, copie(a, cle, 'a'));
    ecrire(a, cle, copie(a, cle, 'z'));
  }
  for (const cle of CLES) a.remove(cle, copie(a, cle, 'z').id);
  for (const cle of CLES) a.remove(cle, copie(a, cle, 'partagee').id);
  a.setSetting('principalCushion', 12345 as never);
  for (const cle of CLES) {
    ecrire(b, cle, modifie(b, cle));
    ecrire(b, cle, copie(b, cle, 'b'));
  }
  b.setSetting('transferThreshold', 2345 as never);
}

function verifierHorsLigne(...instances: LedgerStore[]): void {
  verifierConvergence(...instances);
  const temoin = instances[0]!;
  for (const s of instances) {
    for (const cle of CLES) {
      verifierPresent(s, cle, copie(temoin, cle, 'a').id, {});
      verifierPresent(s, cle, copie(temoin, cle, 'b').id, {});
      verifierSupprime(s, cle, copie(temoin, cle, 'z').id);
      verifierSupprime(s, cle, copie(temoin, cle, 'partagee').id);
    }
    expect(s.load().settings.principalCushion).toBe(12345);
    expect(s.load().settings.transferThreshold).toBe(2345);
    expect(computePlan(s.load(), AUJOURD_HUI).totals).toEqual(computePlan(temoin.load(), AUJOURD_HUI).totals);
  }
}

/** Deux instances qui partent du même état, reçu par une première synchronisation directe. */
async function deuxInstances(): Promise<[LedgerStore, LedgerStore]> {
  const a = await instance();
  semer(a);
  const b = await instance();
  await direct(a, b);
  return [a, b];
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. Le fichier ne grossit qu'avec les données
// ─────────────────────────────────────────────────────────────────────────────────────────────

const nom = (i: number) => `Nom ${String(i).padStart(3, '0')}`;

describe('[niveau 0] harnais du registre', () => {
  describe('#196 · 1. le fichier ne grossit qu’avec les données', () => {
    it('cent modifications d’une même ligne laissent le fichier à la taille d’une seule', async () => {
      const a = await instance();
      semer(a);
      const compte = lignes(a, 'accounts')[0]!;
      ecrire(a, 'accounts', { ...compte, name: nom(0) });
      const apresUne = a.export().length;
      for (let i = 1; i <= 100; i++) ecrire(a, 'accounts', { ...compte, name: nom(i) });
      verifierMemeTaille(apresUne, a.export().length);
    });

    it('une synchronisation ne fait grossir le fichier que des lignes reçues', async () => {
      const [a, b] = await deuxInstances();
      const compte = lignes(a, 'accounts')[0]!;
      ecrire(a, 'accounts', { ...compte, name: nom(0) });
      await direct(a, b);
      const avant = b.export().length;
      for (let i = 1; i <= 100; i++) ecrire(a, 'accounts', { ...compte, name: nom(i) });
      await direct(a, b);
      verifierPresent(b, 'accounts', compte.id, { name: nom(100) });
      verifierMemeTaille(avant, b.export().length);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // 2. Deux instances convergent, par chaque transport, et rejouer ne change rien
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('#196 · 2. deux instances convergent', () => {
    it('en direct : créations, modifications et suppressions dans toutes les tables, réglages compris', async () => {
      const [a, b] = await deuxInstances();
      horsLigne(a, b);
      await direct(a, b);
      verifierHorsLigne(a, b);
      const avant = etat(a);
      await direct(a, b);
      await direct(b, a);
      verifierConvergence(a, b);
      expect(etat(a), 'rejouer la synchronisation a changé l’état').toEqual(avant);
    });

    it('par le relais : créations, modifications et suppressions dans toutes les tables, réglages compris', async () => {
      const a = await instance();
      semer(a);
      const b = await instance();
      relaisFactice();
      await parRelais(a, b);
      verifierConvergence(a, b);
      horsLigne(a, b);
      await parRelais(a, b);
      verifierHorsLigne(a, b);
      const avant = etat(a);
      await parRelais(a, b);
      await parRelais(b, a);
      verifierConvergence(a, b);
      expect(etat(a), 'rejouer la synchronisation a changé l’état').toEqual(avant);
    });

    it('par fichier : créations, modifications et suppressions dans toutes les tables, réglages compris', async () => {
      const a = await instance();
      semer(a);
      const b = await instance();
      await parFichier(a, b);
      verifierConvergence(a, b);
      const ancien = await paquet(a);
      horsLigne(a, b);
      await parFichier(a, b);
      verifierHorsLigne(a, b);
      const avant = etat(a);
      await parFichier(a, b);
      await importBundle(b, ancien as never);
      await importBundle(a, ancien as never);
      verifierConvergence(a, b);
      expect(etat(a), 'rejouer un paquet, même ancien, a changé l’état').toEqual(avant);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // 3. Trois instances, dont deux ne se croisent jamais
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('#196 · 3. trois instances convergent par relais', () => {
    it('A et B ne se croisent jamais, chacune se synchronise avec C', async () => {
      const [a, c] = await deuxInstances();
      const b = await instance();
      await direct(b, c);
      horsLigne(a, b);
      ecrire(c, 'categories', { ...lignes(c, 'categories')[2]!, name: 'Vue par C' });
      await direct(a, c);
      await direct(b, c);
      await direct(a, c);
      verifierHorsLigne(a, b, c);
      verifierPresent(a, 'categories', lignes(c, 'categories')[2]!.id, { name: 'Vue par C' });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // 4. Une instance reste une instance
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('#196 · 4. une instance reste une instance', () => {
    it('deux instances ouvertes depuis le même fichier exporté, modifiées chacune de son côté, convergent sans perte', async () => {
      const origine = await instance();
      semer(origine);
      const fichier = origine.export();
      const b = await instance(fichier.slice());
      const c = await instance(fichier.slice());
      horsLigne(b, c);
      await direct(b, c);
      verifierHorsLigne(b, c);
    });

    it('restaurer une sauvegarde plus ancienne puis synchroniser ne perd rien de ce que les autres ont reçu', async () => {
      const [a, p] = await deuxInstances();
      const sauvegarde = a.export();
      const compte = lignes(a, 'accounts')[0]!;
      ecrire(a, 'accounts', { ...compte, name: 'Reçu par P' });
      ecrire(a, 'categories', { ...lignes(a, 'categories')[0]!, id: 'cat-apres-sauvegarde', name: 'Créée après la sauvegarde' });
      await direct(a, p);
      a.close();

      const restauree = await instance(sauvegarde);
      await direct(restauree, p);
      verifierPresent(restauree, 'accounts', compte.id, { name: 'Reçu par P' });
      verifierPresent(restauree, 'categories', 'cat-apres-sauvegarde', {});
      verifierPresent(p, 'accounts', compte.id, { name: 'Reçu par P' });

      ecrire(restauree, 'needs', { ...lignes(restauree, 'needs')[0]!, name: 'Écrit après la restauration' });
      await direct(restauree, p);
      verifierPresent(p, 'needs', lignes(restauree, 'needs')[0]!.id, { name: 'Écrit après la restauration' });
      verifierConvergence(restauree, p);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // 5. Un conflit se voit
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /** A et B synchronisées, puis une même ligne touchée des deux côtés : B d'abord, A ensuite. */
  async function conflit(
    cle: Cle,
    id: string,
    parB: (r: Ligne) => Ligne,
    parA: ((r: Ligne) => Ligne) | 'supprimer',
    transport: typeof direct = direct,
  ): Promise<{ a: LedgerStore; b: LedgerStore; ra: unknown; rb: unknown }> {
    const [a, b] = await deuxInstances();
    ecrire(b, cle, parB(lignes(b, cle).find((r) => r.id === id)!));
    await attendre(25);
    if (parA === 'supprimer') a.remove(cle, id);
    else ecrire(a, cle, parA(lignes(a, cle).find((r) => r.id === id)!));
    const [ra, rb] = await transport(a, b);
    return { a, b, ra, rb };
  }

  describe('#196 · 5. un conflit se voit', () => {
    it('une même ligne modifiée des deux côtés : les deux retiennent la plus récente, et l’écartée se voit des deux côtés', async () => {
      const id = exampleLedger().categories[0]!.id;
      const { a, b, ra, rb } = await conflit('categories', id, (r) => ({ ...r, name: 'ECART-B-196' }), (r) => ({ ...r, name: 'RETENU-A-196' }));
      verifierConvergence(a, b);
      verifierPresent(b, 'categories', id, { name: 'RETENU-A-196' });
      verifierConflitMontre(trace(a, ra), 'ECART-B-196');
      verifierConflitMontre(trace(b, rb), 'ECART-B-196');
    });

    it('deux champs différents d’une même ligne : la ligne entière la plus récente gagne, et l’écartée se voit', async () => {
      const besoin = exampleLedger().needs.find((n) => n.name)!;
      const { a, b, ra, rb } = await conflit('needs', besoin.id, (r) => ({ ...r, name: 'ECART-NOM-196' }), (r) => ({ ...r, amount: 123456 }));
      verifierConvergence(a, b);
      const retenu = lignes(b, 'needs').find((r) => r.id === besoin.id)!;
      expect(retenu['amount']).toBe(123456);
      expect(retenu['name'], 'la fusion a mêlé les deux versions au lieu de retenir la ligne entière').toBe(besoin.name);
      verifierConflitMontre(trace(a, ra), 'ECART-NOM-196');
      verifierConflitMontre(trace(b, rb), 'ECART-NOM-196');
    });

    it('une suppression d’un côté contre une modification de l’autre est un conflit', async () => {
      const id = exampleLedger().categories[1]!.id;
      const { a, b, ra, rb } = await conflit('categories', id, (r) => ({ ...r, name: 'ECART-SUPPR-196' }), 'supprimer');
      verifierConvergence(a, b);
      verifierSupprime(a, 'categories', id);
      verifierSupprime(b, 'categories', id);
      verifierConflitMontre(trace(a, ra), 'ECART-SUPPR-196');
      verifierConflitMontre(trace(b, rb), 'ECART-SUPPR-196');
    });

    it('par fichier aussi, l’écartée se voit des deux côtés', async () => {
      const id = exampleLedger().categories[2]!.id;
      const { a, b, ra, rb } = await conflit('categories', id, (r) => ({ ...r, name: 'ECART-FICHIER-196' }), (r) => ({ ...r, name: 'RETENU-FICHIER-196' }), parFichier);
      verifierConvergence(a, b);
      verifierConflitMontre(trace(a, ra), 'ECART-FICHIER-196');
      verifierConflitMontre(trace(b, rb), 'ECART-FICHIER-196');
    });

    it('une ligne modifiée d’un côté puis de l’autre, avec une synchronisation entre les deux, n’est pas un conflit', async () => {
      const [a, b] = await deuxInstances();
      const id = exampleLedger().categories[3]!.id;
      ecrire(a, 'categories', { ...lignes(a, 'categories').find((r) => r.id === id)!, name: 'ANCIEN-A-196' });
      await direct(a, b);
      await attendre(25);
      ecrire(b, 'categories', { ...lignes(b, 'categories').find((r) => r.id === id)!, name: 'NOUVEAU-B-196' });
      const [ra, rb] = await direct(a, b);
      verifierPresent(a, 'categories', id, { name: 'NOUVEAU-B-196' });
      expect(trace(a, ra), 'une valeur remplacée sans conflit est encore rendue ou gardée').not.toContain('ANCIEN-A-196');
      expect(trace(b, rb), 'une valeur remplacée sans conflit est encore rendue ou gardée').not.toContain('ANCIEN-A-196');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // 6. Un fichier étranger au format est refusé en le disant
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('#196 · 6. un fichier étranger au format est refusé', () => {
    it('un fichier au format de main avant #196 n’est pas ouvert, et reste intact', async () => {
      const ancien = fichierAncien();
      const copieAvant = ancien.slice();
      verifierRefus(await issue(() => instance(ancien)));
      expect(Buffer.from(ancien).equals(Buffer.from(copieAvant)), 'le fichier refusé a été modifié').toBe(true);
    });

    it('une base SQLite sans le marqueur de Tirelire n’est pas ouverte', async () => {
      const db = new SQL.Database();
      db.run(`CREATE TABLE notes (id TEXT PRIMARY KEY, texte TEXT)`);
      db.run(`INSERT INTO notes VALUES ('n1', 'une autre application')`);
      const etranger = db.export();
      db.close();
      verifierRefus(await issue(() => instance(etranger)));
    });

    it('un fichier qui n’est pas une base n’est pas ouvert', async () => {
      verifierRefus(await issue(() => instance(new TextEncoder().encode('Ceci n’est pas une base Tirelire.'))));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // 7. Une instance d'un autre format est refusée sans perte
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Un changement tel que l'écrivait une instance de main avant #196 : journal chaîné, par cellule. */
  function entreeAncienne(rowId: string): Record<string, unknown> {
    const e = { seq: 1, hlc: '1790000000000:0000:ancien0000', site: 'ancien0000', tbl: 'accounts', rowId, col: 'name', value: JSON.stringify('ECRIT-PAR-UN-ANCIEN-196'), prevHash: '0'.repeat(64) };
    const hash = createHash('sha256').update([e.prevHash, e.hlc, e.site, e.tbl, e.rowId, e.col, e.value].join('|')).digest('hex');
    return { ...e, hash };
  }

  function paquetAncien(rowId: string): Record<string, unknown> {
    return { format: 'tirelire-changes', version: 1, site: 'ancien0000', from: 0, upTo: 1, entries: [entreeAncienne(rowId)] };
  }

  /** Le chiffrement du relais tel que main le fait avant #196. */
  async function depotAncien(texte: string): Promise<{ iv: string; blob: string }> {
    const enc = new TextEncoder();
    const base = await webcrypto.subtle.importKey('raw', enc.encode(RELAIS.passphrase), 'PBKDF2', false, ['deriveKey']);
    const cle = await webcrypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode('tirelire:' + RELAIS.room), iterations: 200_000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, cle, enc.encode(texte)));
    return { iv: Buffer.from(iv).toString('base64'), blob: Buffer.from(ct).toString('base64') };
  }

  describe('#196 · 7. une instance d’un autre format est refusée sans perte', () => {
    it('en direct : les messages d’une instance de main arrêtent la synchronisation, et rien n’est écrit', async () => {
      const a = await instance();
      semer(a);
      const compte = lignes(a, 'accounts')[0]!.id;
      const avant = contenu(a.export());
      const [x, y] = memoryTransportPair();
      y.onMessage(() => undefined);
      const r = issue(() => runSync(a, x));
      for (const m of [
        { type: 'hello', site: 'ancien0000' },
        { type: 'request', site: 'ancien0000', cursor: 0 },
        { type: 'changes', site: 'ancien0000', entries: [entreeAncienne(compte)], upTo: 1 },
        { type: 'done', site: 'ancien0000' },
        { type: 'bye', site: 'ancien0000', lastSeq: 1 },
      ])
        await y.send(m as never);
      verifierRefusDit(await r);
      verifierRienEcrit(avant, contenu(a.export()));
    });

    it('par fichier : un paquet de main est refusé, et rien n’est écrit', async () => {
      const a = await instance();
      semer(a);
      const avant = contenu(a.export());
      verifierRefus(await issue(() => importBundle(a, paquetAncien(lignes(a, 'accounts')[0]!.id) as never)));
      verifierRienEcrit(avant, contenu(a.export()));
    });

    it('par le relais : un dépôt d’une instance de main arrête la synchronisation, et rien n’est reçu', async () => {
      const a = await instance();
      semer(a);
      const depots = relaisFactice();
      const { iv, blob } = await depotAncien(JSON.stringify(paquetAncien(lignes(a, 'accounts')[0]!.id)));
      depots.push({ id: 1, site: 'ancien0000', upTo: 1, iv, blob, at: '2026-09-24T00:00:00Z' });
      const avant = JSON.stringify(etat(a));
      verifierRefus(await issue(() => relaySync(a, RELAIS), 10_000));
      verifierRienEcrit(avant, JSON.stringify(etat(a)));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // 8. Ce qui tenait tient encore
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('#196 · 8. ce qui tenait tient encore', () => {
    it('un fichier exporté se rouvre à l’identique, suppressions et réglages compris', async () => {
      const [a, b] = await deuxInstances();
      horsLigne(a, b);
      await direct(a, b);
      const rouverte = await instance(a.export());
      verifierConvergence(a, rouverte);
      expect(computePlan(rouverte.load(), AUJOURD_HUI)).toEqual(computePlan(a.load(), AUJOURD_HUI));
    });

    it('l’exemple chargé sur une instance se retrouve sur l’autre, et le plan s’y calcule à l’identique', async () => {
      const [a, b] = await deuxInstances();
      const plan = computePlan(b.load(), AUJOURD_HUI);
      expect(plan.lines.length).toBeGreaterThan(0);
      expect(plan).toEqual(computePlan(a.load(), AUJOURD_HUI));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Témoins rouges : les mêmes assertions, sur une version volontairement cassée du besoin.
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  it.fails('témoin rouge · un fichier qui garde une trace de chaque modification', async () => {
    const a = await instance();
    semer(a);
    const compte = lignes(a, 'accounts')[0]!;
    ecrire(a, 'accounts', { ...compte, name: nom(0) });
    const apresUne = a.export();
    // Version cassée : le même fichier, où chaque modification de la ligne réécrit la ligne et laisse
    // en plus une entrée de journal, comme le faisait main (D08).
    const db = new SQL.Database(apresUne);
    db.run(`CREATE TABLE journal_casse (seq INTEGER PRIMARY KEY, hlc TEXT, site TEXT, tbl TEXT, row_id TEXT, col TEXT, value TEXT, prev_hash TEXT, hash TEXT)`);
    for (let i = 1; i <= 100; i++) {
      const empreinte = createHash('sha256').update(String(i)).digest('hex');
      db.run(`INSERT INTO journal_casse (hlc, site, tbl, row_id, col, value, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        `17900000000${String(i).padStart(2, '0')}:0000:casse`, 'casse', 'accounts', compte.id, 'name', JSON.stringify(nom(i)), empreinte, empreinte,
      ]);
    }
    const apresCent = db.export();
    db.close();
    verifierMemeTaille(apresUne.length, apresCent.length);
  });

  it.fails('témoin rouge · une ligne partagée effacée au lieu d’être supprimée', async () => {
    const a = await instance();
    semer(a);
    const id = copie(a, 'categories', 'partagee').id;
    // Version cassée : la suppression efface la ligne du fichier, qui ne la montre plus.
    const db = new SQL.Database(a.export());
    const tables = db.exec(`SELECT name FROM sqlite_master WHERE type = 'table'`)[0]?.values.map((v) => String(v[0])) ?? [];
    for (const t of tables) if ((db.exec(`PRAGMA table_info("${t}")`)[0]?.values ?? []).some((v) => v[1] === 'id')) db.run(`DELETE FROM "${t}" WHERE id = ?`, [id]);
    const efface = db.export();
    db.close();
    verifierSupprimeDans(lignes(a, 'categories').filter((r) => r.id !== id), efface, 'categories', id);
  });

  it.fails('témoin rouge · deux instances nées du même fichier dont une seule est entendue', async () => {
    const origine = await instance();
    semer(origine);
    const fichier = origine.export();
    const b = await instance(fichier.slice());
    const c = await instance(fichier.slice());
    horsLigne(b, c);
    // Version cassée : C ignore tout ce qui vient de B, comme d'elle-même.
    await importBundle(b, (await paquet(c)) as never);
    verifierHorsLigne(b, c);
  });

  it.fails('témoin rouge · une version écartée sans rien en dire', async () => {
    const id = exampleLedger().categories[0]!.id;
    // Version cassée : l'instance retient la version la plus récente, ne rend rien et ne garde rien
    // de la version écartée.
    const silencieuse = await instance();
    semer(silencieuse);
    ecrire(silencieuse, 'categories', { ...lignes(silencieuse, 'categories').find((r) => r.id === id)!, name: 'RETENU-A-196' });
    verifierConflitMontre(trace(silencieuse, { sent: 1, received: 1 }), 'ECART-B-196');
  });

  it.fails('témoin rouge · un fichier antérieur ouvert sans lire son format', async () => {
    // Version cassée : l'ouverture prend toute base SQLite, sans lire son marqueur ni sa version.
    verifierRefus(await issue(() => new SQL.Database(fichierAncien())));
  });

  it.fails('témoin rouge · un paquet étranger appliqué avant d’être refusé', async () => {
    const a = await instance();
    semer(a);
    const avant = contenu(a.export());
    // Version cassée : le changement reçu est écrit, puis la synchronisation s'arrête.
    ecrire(a, 'accounts', { ...lignes(a, 'accounts')[0]!, name: 'ECRIT-PAR-UN-ANCIEN-196' });
    verifierRienEcrit(avant, contenu(a.export()));
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Un fichier au format de main avant #196 (commit 7ef088f) : un compte, une tirelire, un réglage,
  // données inventées (D84). SQLite compressé par gzip, en base64.
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  function fichierAncien(): Uint8Array {
    return new Uint8Array(gunzipSync(Buffer.from(FICHIER_ANCIEN, 'base64')));
  }

  const FICHIER_ANCIEN =
    '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';
});