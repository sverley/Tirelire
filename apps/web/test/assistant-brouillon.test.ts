/**
 * Tests du codeur de #210 — « L'assistant n'écrit dans le projet qu'à sa validation finale » : le
 * brouillon (`src/lib/brouillon.ts`), sans navigateur, sur un vrai dépôt (`LedgerStore`).
 *
 * Chaque test dit, dans son titre, le point du « Fait quand » qu'il vérifie. Ce qui se voit à l'écran
 * — l'assistant lui-même, ses boutons, son résumé — est dans
 * `navigateur/assistant-valide-a-la-fin-harnais.test.ts`, le harnais de l'auditeur, qui a repris les tests
 * navigateur du codeur ; la validation tout à la fois est aussi dans `assistant-valide-a-la-fin-harnais.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { LedgerStore, MAIN_ACCOUNT_ID, RowRefused, alive, type Account, type Ledger, type LedgerKey, type Need, type PlannedFlow, type Tirelire } from '@tirelire/core';
import { brouillonIntact, ecrire, montrer, nouveauBrouillon, projetEstVierge, reglage, retirer, valider } from '../src/lib/brouillon';

const SQL = await initSqlJs();
const source = (chemin: string) => readFileSync(resolve(process.cwd(), 'src', chemin), 'utf8');
const CLES: LedgerKey[] = ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows', 'operations', 'subOperations', 'shortfallAnswers', 'automations', 'importProfiles', 'devices'];
type Ligne = Record<string, unknown> & { id: string; deletedAt?: string };

const ECHEANCE = { interval: 1, unit: 'month', anchorDate: '2026-09-05' } as const;

const epargne = (id: string, name: string): Account => ({ id, name, kind: 'epargne', openingBalance: 0, openingDate: '2026-09-01' });
const tirelire = (id: string, name: string): Tirelire => ({ id, name, placement: [], openingBalance: 0, openingDate: '2026-09-01' });
const besoin = (id: string, tirelireId: string): Need => ({ id, tirelireId, kind: 'recurring', amount: 5000, periodicity: ECHEANCE, priority: 1 });
const flux = (id: string, name: string): PlannedFlow => ({
  id,
  name,
  kind: 'income',
  amount: 200000,
  accountId: MAIN_ACCOUNT_ID,
  periodicity: ECHEANCE,
  dateWindowDays: 3,
});

async function depot(): Promise<{ store: LedgerStore; ecritures: { n: number } }> {
  const store = await LedgerStore.create({ sqlJs: SQL });
  const ecritures = { n: 0 };
  store.onChange(() => ecritures.n++);
  return { store, ecritures };
}

/** Les lignes vivantes d'une table, par identifiant. */
const vivantes = (projet: Ledger, cle: LedgerKey): Map<string, Ligne> =>
  new Map(alive(projet[cle] as unknown as Ligne[]).map((l) => [l.id, l]));

/** Ce que le brouillon prépare pour un projet vierge : un compte, deux tirelires, un besoin, un flux, un réglage. */
function preparer(projet: Ledger) {
  const b = nouveauBrouillon(projet);
  ecrire(b, 'accounts', epargne('livret', 'Livret A'));
  ecrire(b, 'accounts', { ...projet.accounts.find((a) => a.id === MAIN_ACCOUNT_ID)!, name: 'Compte courant', openingBalance: 150000 });
  ecrire(b, 'tirelires', tirelire('t-vacances', 'Vacances'));
  ecrire(b, 'tirelires', tirelire('t-loyer', 'Loyer'));
  ecrire(b, 'needs', besoin('n-vacances', 't-vacances'));
  ecrire(b, 'plannedFlows', flux('f-salaire', 'Salaire'));
  reglage(b, 'periodStartDay', 5);
  return b;
}

describe('[niveau 4] #210 · 1 — rien de ce que l’assistant montre n’entre dans le projet avant la validation', () => {
  it('lignes ajoutées, compte principal renseigné, autres comptes, tirelires, besoins, flux et réglage restent dans le brouillon : le dépôt n’est pas touché', async () => {
    const { store, ecritures } = await depot();
    const avant = JSON.stringify([store.load(), store.readSettings()]);
    const b = preparer(store.load());

    expect(ecritures.n).toBe(0);
    expect(JSON.stringify([store.load(), store.readSettings()])).toBe(avant);
    expect(brouillonIntact(b)).toBe(false);
  });

  it('l’assistant montre le projet avec son brouillon dessus : tout ce qu’il a préparé, le compte principal renseigné compris', async () => {
    const { store } = await depot();
    const projet = store.load();
    const montre = montrer(projet, preparer(projet));

    expect([...vivantes(montre, 'accounts').keys()].sort()).toEqual([MAIN_ACCOUNT_ID, 'livret'].sort());
    expect(vivantes(montre, 'accounts').get(MAIN_ACCOUNT_ID)).toMatchObject({ name: 'Compte courant', openingBalance: 150000, kind: 'principal' });
    expect([...vivantes(montre, 'tirelires').keys()].sort()).toEqual(['t-loyer', 't-vacances']);
    expect([...vivantes(montre, 'needs').keys()]).toEqual(['n-vacances']);
    expect([...vivantes(montre, 'plannedFlows').keys()]).toEqual(['f-salaire']);
    expect(montre.settings.periodStartDay).toBe(5);
    // Le projet qu’il a reçu n’a pas bougé.
    expect(projet.tirelires).toEqual([]);
    expect(projet.settings.periodStartDay).toBe(1);
  });

  it('une ligne créée puis retirée dans le brouillon n’y laisse rien, et sa validation n’écrit que les réglages de départ de l’ouverture (D44, D41)', async () => {
    const { store } = await depot();
    const projet = store.load();
    const b = nouveauBrouillon(projet);
    ecrire(b, 'tirelires', tirelire('t-passage', 'De passage'));
    retirer(b, projet, 'tirelires', 't-passage');

    expect(brouillonIntact(b)).toBe(true);
    valider(store, projet, b);
    const apres = store.load();
    for (const cle of CLES) expect(apres[cle], cle).toEqual(projet[cle]);
    expect(store.readSettings()).toMatchObject({ periodStartDay: 28, principalCushion: 60000 });
  });

  it('une ligne que le dépôt refuserait est refusée au geste qui la prépare, comme le dépôt la refuse, et le brouillon n’en garde rien', async () => {
    const { store } = await depot();
    const b = nouveauBrouillon(store.load());
    const bidon = { ...epargne('bidon', 'Bidon'), kind: 'inconnu' } as unknown as Account;

    expect(() => store.upsert('accounts', bidon)).toThrow(RowRefused);
    expect(() => ecrire(b, 'accounts', bidon)).toThrow(RowRefused);
    expect(() => store.setSetting('periodStartDay', 40)).toThrow(RowRefused);
    expect(() => reglage(b, 'periodStartDay', 40)).toThrow(RowRefused);
    expect(brouillonIntact(b)).toBe(true);
  });
});

describe('[niveau 4] #210 · 2 — la validation écrit exactement ce que l’assistant montre, tout à la fois', () => {
  it('après validation, chaque table du projet porte les lignes montrées, et les réglages sont ceux montrés', async () => {
    const { store } = await depot();
    const projet = store.load();
    const b = preparer(projet);
    const montre = montrer(projet, b);

    valider(store, projet, b);

    const apres = store.load();
    for (const cle of CLES) {
      const attendu = vivantes(montre, cle);
      const obtenu = vivantes(apres, cle);
      expect([...obtenu.keys()].sort(), cle).toEqual([...attendu.keys()].sort());
      for (const [id, ligne] of attendu) expect(obtenu.get(id), `${cle} ${id}`).toMatchObject(ligne);
    }
    expect(store.readSettings()).toMatchObject({ periodStartDay: montre.settings.periodStartDay });
  });

  it('une validation interrompue puis reprise donne le même projet qu’une validation menée jusqu’au bout', async () => {
    const complete = await depot();
    valider(complete.store, complete.store.load(), preparer(complete.store.load()));

    const interrompue = await depot();
    const projet = interrompue.store.load();
    const b = preparer(projet);
    const vraie = interrompue.store.upsert.bind(interrompue.store);
    let appels = 0;
    interrompue.store.upsert = ((cle: LedgerKey, ligne: never) => {
      if (++appels === 3) throw new Error('interruption');
      vraie(cle, ligne);
    }) as typeof interrompue.store.upsert;
    expect(() => valider(interrompue.store, projet, b)).toThrow('interruption');

    // Le brouillon n’a rien perdu : il montre toujours le projet, avec lui dessus. On revalide.
    interrompue.store.upsert = vraie as typeof interrompue.store.upsert;
    const reprise = interrompue.store.load();
    const montreAvant = montrer(reprise, b);
    valider(interrompue.store, reprise, b);

    const attendu = complete.store.load();
    const obtenu = interrompue.store.load();
    for (const cle of CLES) {
      const a = vivantes(attendu, cle);
      const o = vivantes(obtenu, cle);
      expect([...o.keys()].sort(), cle).toEqual([...a.keys()].sort());
      for (const [id, ligne] of a) expect(o.get(id), `${cle} ${id}`).toMatchObject(ligne);
      for (const [id, ligne] of vivantes(montreAvant, cle)) expect(o.get(id), `${cle} ${id}`).toMatchObject(ligne);
    }
    expect(interrompue.store.readSettings().periodStartDay).toBe(5);
  });
});

describe('[niveau 4] #210 · 2 — le budget entre en entier ou pas du tout, même quand le dépôt refuserait une écriture', () => {
  it('le retrait du compte principal, que le dépôt refuse, est refusé au geste qui le prépare et le brouillon n’en garde rien', async () => {
    const { store } = await depot();
    const projet = store.load();
    const b = nouveauBrouillon(projet);

    expect(() => store.remove('accounts', MAIN_ACCOUNT_ID)).toThrow(RowRefused);
    expect(() => retirer(b, projet, 'accounts', MAIN_ACCOUNT_ID)).toThrow(RowRefused);
    expect(brouillonIntact(b)).toBe(true);
  });

  it('la validation vérifie toutes ses écritures avant la première : un retrait refusé glissé dans le brouillon ne laisse ni compte, ni tirelire, ni besoin, ni flux, ni réglage', async () => {
    const { store, ecritures } = await depot();
    const projet = store.load();
    const b = preparer(projet);
    const avant = JSON.stringify([store.load(), store.readSettings()]);
    // Un brouillon rempli autrement que par `retirer` : la validation ne s'y fie pas.
    b.lignes.accounts![MAIN_ACCOUNT_ID] = { ...projet.accounts.find((a) => a.id === MAIN_ACCOUNT_ID)!, deletedAt: '2026-10-03T08:00:00.000Z' } as never;

    expect(() => valider(store, projet, b)).toThrow(RowRefused);
    expect(ecritures.n).toBe(0);
    expect(JSON.stringify([store.load(), store.readSettings()])).toBe(avant);

    // Le brouillon n'a rien perdu : sans le retrait refusé, il entre en entier.
    delete b.lignes.accounts![MAIN_ACCOUNT_ID];
    ecrire(b, 'accounts', { ...projet.accounts.find((a) => a.id === MAIN_ACCOUNT_ID)!, name: 'Compte courant', openingBalance: 150000 });
    valider(store, projet, b);
    expect([...vivantes(store.load(), 'tirelires').keys()].sort()).toEqual(['t-loyer', 't-vacances']);
    expect([...vivantes(store.load(), 'plannedFlows').keys()]).toEqual(['f-salaire']);
    expect(vivantes(store.load(), 'accounts').get(MAIN_ACCOUNT_ID)).toMatchObject({ name: 'Compte courant', openingBalance: 150000 });
  });
});

describe('[niveau 4] #210 · 3 — quitter sans valider n’enregistre rien ; ce qui est préparé reste tant que l’application reste ouverte', () => {
  it('un brouillon abandonné laisse le dépôt tel qu’il était, et un nouveau brouillon repart du projet', async () => {
    const { store, ecritures } = await depot();
    const avant = JSON.stringify([store.load(), store.readSettings()]);
    const abandonne = preparer(store.load());
    expect(brouillonIntact(abandonne)).toBe(false);

    const neuf = nouveauBrouillon(store.load());
    expect(ecritures.n).toBe(0);
    expect(JSON.stringify([store.load(), store.readSettings()])).toBe(avant);
    expect(brouillonIntact(neuf)).toBe(true);
    // Le projet, avec les réglages de départ que l'ouverture propose sur un projet vierge (D44, D41).
    expect(montrer(store.load(), neuf)).toEqual({ ...store.load(), settings: { ...store.load().settings, periodStartDay: 28, principalCushion: 60000 } });
  });

  it('un brouillon dont une étape a présenté ses propositions n’est plus intact : on le retrouve en revenant', async () => {
    const { store } = await depot();
    const b = nouveauBrouillon(store.load());
    expect(brouillonIntact(b)).toBe(true);
    b.semees.push('income');
    expect(brouillonIntact(b)).toBe(false);
  });

  it('le projet qui bouge pendant que le brouillon attend : l’assistant montre le projet à jour, avec le brouillon dessus, et la validation garde les deux', async () => {
    const { store } = await depot();
    const b = nouveauBrouillon(store.load());
    ecrire(b, 'tirelires', tirelire('t-assistant', 'Préparée par l’assistant'));
    store.upsert('tirelires', tirelire('t-ailleurs', 'Ajoutée ailleurs'));

    expect([...vivantes(montrer(store.load(), b), 'tirelires').keys()].sort()).toEqual(['t-ailleurs', 't-assistant']);
    valider(store, store.load(), b);
    expect([...vivantes(store.load(), 'tirelires').keys()].sort()).toEqual(['t-ailleurs', 't-assistant']);
  });
});

describe('[niveau 4] #210 · 4 — projet vierge ou projet existant', () => {
  it('un projet vierge n’a que son compte principal : ni tirelire, ni besoin, ni flux, ni autre compte ; les opérations ne comptent pas', async () => {
    const { store } = await depot();
    expect(projetEstVierge(store.load())).toBe(true);
    expect(nouveauBrouillon(store.load()).projetVierge).toBe(true);

    store.upsert('operations', { id: 'o1', accountId: MAIN_ACCOUNT_ID, origin: 'imported', date: '2026-09-02', label: 'Relevé importé', normalizedLabel: 'releve importe', amount: -1200, state: 'untreated' } as never);
    expect(projetEstVierge(store.load())).toBe(true);
  });

  it.each([
    ['une tirelire', (s: LedgerStore) => s.upsert('tirelires', tirelire('t', 'Vacances'))],
    ['un besoin', (s: LedgerStore) => s.upsert('needs', besoin('n', 't'))],
    ['un flux prévu', (s: LedgerStore) => s.upsert('plannedFlows', flux('f', 'Salaire'))],
    ['un compte de plus', (s: LedgerStore) => s.upsert('accounts', epargne('livret', 'Livret A'))],
  ])('%s suffit à faire un projet existant', async (_quoi, ajouter) => {
    const { store } = await depot();
    ajouter(store);
    expect(projetEstVierge(store.load())).toBe(false);
    expect(nouveauBrouillon(store.load()).projetVierge).toBe(false);
  });

  it('une tirelire supprimée ne compte pas : le projet redevient vierge', async () => {
    const { store } = await depot();
    store.upsert('tirelires', tirelire('t', 'Vacances'));
    store.remove('tirelires', 't');
    expect(projetEstVierge(store.load())).toBe(true);
  });

  it('l’état d’ouverture est figé : la première ligne préparée ne fait pas d’un projet vierge un projet existant', async () => {
    const { store } = await depot();
    const b = nouveauBrouillon(store.load());
    ecrire(b, 'tirelires', tirelire('t', 'Vacances'));
    expect(b.projetVierge).toBe(true);
    expect(projetEstVierge(montrer(store.load(), b))).toBe(false);
  });

  it('projet existant : l’assistant part de son contenu, y modifie et y retire, et le projet ne change qu’à la validation', async () => {
    const { store, ecritures } = await depot();
    store.upsert('tirelires', tirelire('t', 'Vacances'));
    store.upsert('tirelires', tirelire('u', 'Loyer'));
    store.upsert('plannedFlows', flux('f', 'Salaire'));
    store.upsert('plannedFlows', flux('g', 'Allocations'));
    const projet = store.load();
    const ecritesAvant = ecritures.n;

    const b = nouveauBrouillon(projet);
    expect([...vivantes(montrer(projet, b), 'tirelires').keys()].sort()).toEqual(['t', 'u']); // il part du contenu
    ecrire(b, 'tirelires', { ...projet.tirelires.find((x) => x.id === 't')!, name: 'Voyage' });
    retirer(b, projet, 'plannedFlows', 'f');

    const montre = montrer(projet, b);
    expect(vivantes(montre, 'tirelires').get('t')).toMatchObject({ name: 'Voyage' });
    expect(montre.tirelires.map((x) => x.id)).toEqual(projet.tirelires.map((x) => x.id)); // la ligne garde sa place
    expect([...vivantes(montre, 'plannedFlows').keys()]).toEqual(['g']);
    // Avant la validation, le projet est celui d’avant.
    expect(ecritures.n).toBe(ecritesAvant);
    expect(vivantes(store.load(), 'tirelires').get('t')).toMatchObject({ name: 'Vacances' });
    expect([...vivantes(store.load(), 'plannedFlows').keys()].sort()).toEqual(['f', 'g']);

    valider(store, projet, b);
    expect(vivantes(store.load(), 'tirelires').get('t')).toMatchObject({ name: 'Voyage' });
    expect(vivantes(store.load(), 'tirelires').get('u')).toMatchObject({ name: 'Loyer' });
    expect([...vivantes(store.load(), 'plannedFlows').keys()]).toEqual(['g']);
  });
});

describe('[niveau 4] #210 · 1 et 2 — l’écran de l’assistant n’écrit dans le projet que par sa validation', () => {
  // La structure, pas le comportement : le comportement est joué dans le navigateur
  // (`navigateur/assistant-valide-a-la-fin-harnais.test.ts`) ; ceci garde que l'écran n'a plus d'autre chemin.
  it('Wizard.svelte n’écrit pas dans le projet, ne lit que le projet montré avec son brouillon, et valide en un seul endroit', () => {
    const ecran = source('views/Wizard.svelte');
    expect(ecran).not.toMatch(/\bapp\.(upsert|remove|setSetting|store|ledger|plan)\b/);
    expect(ecran.match(/app\.validerAssistant\(/g) ?? []).toHaveLength(1);
  });

  it('dans l’état de l’application, seule la validation de l’assistant touche le dépôt', () => {
    const etat = source('lib/state.svelte.ts');
    const debut = etat.indexOf('ouvrirAssistant()');
    const fin = etat.indexOf('newId()', debut);
    expect(debut).toBeGreaterThan(0);
    expect(fin).toBeGreaterThan(debut);
    const assistant = etat.slice(debut, fin);
    expect(assistant.match(/this\.store/g) ?? []).toHaveLength(1);
    expect(assistant.indexOf('this.store')).toBeGreaterThan(assistant.indexOf('validerAssistant()'));
  });
});
