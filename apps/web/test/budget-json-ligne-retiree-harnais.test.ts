/**
 * Harnais d'audit de #409, côté assistant, sans navigateur : le brouillon enregistré en JSON
 * (`src/lib/brouillon.ts`, point 2), repris sur un projet (points 4 et 6), ce que le résumé en dit
 * (`src/lib/differenceAssistant.ts`, point 5), la carte d'un ordre (`carteDeLOrdre`, `partsDeLOrdre`,
 * lue comme la lit `VentilationOrdre.svelte`, points 5 et 6) et ce que l'assistant en montre (point
 * 7), sur un vrai dépôt (`LedgerStore`) qui porte le budget de l'exemple. Le cœur est dans
 * `packages/core/test/budget-json-ligne-retiree-harnais.test.ts` ; la mise en page à 375 px et le
 * clavier (point 9), seuls à demander le navigateur (D83, « Le navigateur au minimum »), dans
 * `navigateur/budget-json-ligne-retiree-harnais.test.ts`.
 *
 * Les tests sont ceux du codeur (`budget-json-ligne-retiree.test.ts`, déplacé ici en entier, et les
 * deux tests « #409 · 5 et 6 » de `carte-ordre-ligne-retiree.test.ts`, tour 2), classés par la suite
 * de questions de D83 ; est de l'auditeur le brouillon enregistré depuis l'assistant ouvert sur
 * chaque section (point 2, #363) et, au tour 2, le compte retiré dans le résumé et à la validation.
 * Niveau 1 : le résumé et la carte (point 5, D40, I10) et la validation (point 6, I10), vus rouges sur
 * des mutations ciblées, dites dans la vérification de la PR. Niveau 2 : le reste.
 *
 * L'ordre « Virement Livret A » (600 €) a trois parts fixes — Taxe foncière (100 €), Assurance auto
 * (50 €), Vacances (150 €) — et la part variable d'Épargne de précaution ; un second ordre, sans part,
 * va du compte principal vers la Carte enfants.
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { LedgerStore, alive, budgetDefiniEnJson, euros, exampleLedger, lireBudgetJson, standingOrderTarget, MAIN_ACCOUNT_ID, type Ledger, type PlannedFlow } from '@tirelire/core';
import { brouillonDuFichier, carteDeLOrdre, fichierAEnregistrer, montrer, nouveauBrouillon, ordreEnregistre, partsDeLOrdre, preparerValidation, retireesDuFichier, retirer, valider, type Brouillon } from '../src/lib/brouillon';
import { direDifference } from '../src/lib/differenceAssistant';
import { lireVentilation } from '../src/lib/ventilationOrdre';

const SQL = await initSqlJs();
const ORDRE = 'flow-vir-livret';
const ORDRE_ENFANTS = 'flow-vir-enfants';
const RETIRE = '2026-09-02T10:00:00.000Z';
const MAINTENANT = '2026-09-06T08:00:00.000Z';

/** Le dépôt de l'exemple, l'ordre vers la Carte enfants en plus ; puis les tirelires et les comptes retirés, comme à l'écran. */
async function depot(retirees: string[] = [], comptes: string[] = []): Promise<LedgerStore> {
  const s = await LedgerStore.create({ sqlJs: SQL, siteId: 't' });
  const l = exampleLedger();
  // La tirelire placée sur la Carte enfants ne l'est plus : le placement sur un compte retiré est hors de #409.
  l.tirelires = l.tirelires.map((t) => (t.id === 'env-enfants' ? { ...t, placement: [] } : t));
  l.plannedFlows.push({
    id: ORDRE_ENFANTS,
    name: 'Virement Carte enfants',
    kind: 'transfer',
    amount: euros(-200),
    accountId: MAIN_ACCOUNT_ID,
    counterpartAccountId: 'acc-enfants',
    periodicity: { unit: 'month', interval: 1, anchorDate: '2026-08-28' },
    dateWindowDays: 5,
  });
  for (const k of ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows'] as const) for (const r of l[k]) s.upsert(k, r as never);
  for (const id of retirees) {
    for (const n of alive(s.load().needs).filter((x) => x.tirelireId === id)) s.remove('needs', n.id);
    s.remove('tirelires', id);
  }
  for (const id of comptes) s.remove('accounts', id);
  return s;
}
/** Retire une tirelire dans le brouillon, comme la section Tirelires : ses besoins, puis elle. */
function retirerTirelire(b: Brouillon, projet: Ledger, id: string) {
  for (const n of alive(montrer(projet, b).needs).filter((x) => x.tirelireId === id)) retirer(b, projet, 'needs', n.id);
  retirer(b, projet, 'tirelires', id);
}
const nommerDans = (l: Ledger) => (prop: string, id: string) =>
  ((prop === 'tirelireId' ? l.tirelires : prop === 'categoryId' || prop === 'parentId' ? l.categories : l.accounts) as Array<{ id: string; name?: string }>).find((x) => x.id === id)?.name;
const enregistres = (projet: Ledger, b: Brouillon): PlannedFlow[] =>
  alive(montrer(projet, b).plannedFlows).filter((f) => projet.plannedFlows.some((p) => p.id === f.id && !p.deletedAt) && standingOrderTarget(f, MAIN_ACCOUNT_ID) !== undefined);
const dire = (projet: Ledger, b: Brouillon) => {
  const { difference, preparation } = preparerValidation(projet, b);
  if (!preparation.ok) throw new Error(preparation.message);
  return direDifference(difference, preparation.conflits, nommerDans(montrer(projet, b)), enregistres(projet, b));
};
const tireliresDe = (j: Record<string, unknown>) => (j['tirelires'] as Array<Record<string, unknown>>) ?? [];
const ordreMontre = (montre: Ledger, id: string) => montre.plannedFlows.find((f) => f.id === id && !f.deletedAt)!;
/** La carte de l'ordre `id`, et sa ventilation lue comme la lit `VentilationOrdre.svelte`. */
function carte(projet: Ledger, b: Brouillon, id: string) {
  const montre = montrer(projet, b);
  const c = carteDeLOrdre(projet, montre, b, ordreMontre(montre, id), MAIN_ACCOUNT_ID);
  const { montant, allocation, noms } = c.ventilation;
  return { ...c, lecture: lireVentilation(montant, allocation, noms), montre };
}

describe('[niveau 2] #409 · 2 — le brouillon enregistré se relit', () => {
  it('le projet retiré à l’écran : le brouillon de l’assistant complet porte la tirelire retirée, avec sa date de suppression', async () => {
    const s = await depot(['env-auto']);
    const projet = s.load();
    const deleted = projet.tirelires.find((t) => t.id === 'env-auto')!.deletedAt;
    const j = budgetDefiniEnJson(fichierAEnregistrer(projet, nouveauBrouillon(projet), MAINTENANT));
    expect(tireliresDe(j).find((t) => t['id'] === 'env-auto')).toMatchObject({ name: 'Assurance auto', deleted_at: deleted });
    expect(lireBudgetJson(JSON.stringify(j)).ok).toBe(true);
  });

  it('retirée dans l’assistant : le brouillon porte la tirelire, retirée au moment de l’enregistrement ; repris sur le même projet, le même résumé', async () => {
    const s = await depot();
    const projet = s.load();
    const b = nouveauBrouillon(projet);
    retirerTirelire(b, projet, 'env-auto');
    const avant = dire(projet, b);
    const j = budgetDefiniEnJson(fichierAEnregistrer(projet, b, MAINTENANT));
    expect(tireliresDe(j).find((t) => t['id'] === 'env-auto')).toMatchObject({ deleted_at: MAINTENANT });
    const lu = lireBudgetJson(JSON.stringify(j));
    if (!lu.ok) throw new Error(lu.message);
    const repris = brouillonDuFichier(projet, lu.budget);
    expect(dire(projet, repris)).toEqual(avant);
    expect(avant.ordres.map((l) => l.texte).join(' ')).toContain('Assurance auto');
  });

  it('ouvert sur la section Tirelires, retirée puis validée : le brouillon de l’assistant complet se relit', async () => {
    const s = await depot();
    const section = nouveauBrouillon(s.load(), 'tirelires');
    retirerTirelire(section, s.load(), 'env-auto');
    valider(s, s.load(), section);
    const projet = s.load();
    expect(projet.plannedFlows.find((f) => f.id === ORDRE)!.action!.allocation!.some((p) => p.tirelireId === 'env-auto')).toBe(true);
    const lu = lireBudgetJson(JSON.stringify(budgetDefiniEnJson(fichierAEnregistrer(projet, nouveauBrouillon(projet), MAINTENANT))));
    expect(lu.ok).toBe(true);
  });

  it('enregistré depuis l’assistant ouvert sur une section, sur un projet où l’ordre désigne une tirelire et un compte retirés : il se relit (auditeur)', async () => {
    const s = await depot(['env-auto'], ['acc-enfants']);
    const projet = s.load();
    for (const section of ['comptes', 'tirelires'] as const) {
      const lu = lireBudgetJson(JSON.stringify(budgetDefiniEnJson(fichierAEnregistrer(projet, nouveauBrouillon(projet, section), MAINTENANT))));
      if (!lu.ok) throw new Error(`${section} : ${lu.message}`);
    }
  });
});

describe('[niveau 2] #409 · 4 à 7 — repris sur un projet vierge, Assurance auto et la Carte enfants retirées', () => {
  async function repris() {
    const source = await depot(['env-auto'], ['acc-enfants']);
    const j = budgetDefiniEnJson(fichierAEnregistrer(source.load(), nouveauBrouillon(source.load()), MAINTENANT));
    const lu = lireBudgetJson(JSON.stringify(j));
    if (!lu.ok) throw new Error(lu.message);
    const s = await LedgerStore.create({ sqlJs: SQL, siteId: 'u' });
    const avant = source.load();
    return {
      s,
      b: brouillonDuFichier(s.load(), lu.budget),
      deleted: avant.tirelires.find((t) => t.id === 'env-auto')!.deletedAt,
      compteDeleted: avant.accounts.find((a) => a.id === 'acc-enfants')!.deletedAt,
    };
  }

  it('[niveau 1] 5 — le résumé dit la tirelire et le compte qui entrent retirés, sous leur nom, à part des ajouts', async () => {
    const { s, b } = await repris();
    const d = dire(s.load(), b);
    const tirelires = d.parties.find((p) => p.nom === 'Tirelires')!;
    expect(tirelires.entreesRetirees.map((l) => l.texte)).toEqual(['« Assurance auto »']);
    expect(tirelires.ajouts.map((l) => l.texte)).not.toContain('« Assurance auto »');
    const comptes = d.parties.find((p) => p.nom === 'Comptes')!;
    expect(comptes.entreesRetirees.map((l) => l.texte)).toEqual(['« Carte enfants »']);
    expect(comptes.ajouts.map((l) => l.texte)).not.toContain('« Carte enfants »');
    // Le besoin retiré n'est désigné par aucune ligne : le fichier ne le porte pas, et le résumé n'en dit rien.
    expect(JSON.stringify(d.parties)).not.toContain('le besoin de « Assurance auto »');
  });

  it('[niveau 1] 5 et 6 — la carte de l’ordre qui entre avec le fichier montre la part de la tirelire retirée, sous son nom, marquée comme retirée ; la validation la garde', async () => {
    const { s, b } = await repris();
    const projet = s.load();
    expect(ordreEnregistre(projet, ORDRE)).toBe(false);
    const c = carte(projet, b, ORDRE);
    expect(c.lecture.lignes.map((l) => [l.nom, l.montant, l.retiree ?? false])).toEqual([
      ['Taxe foncière', euros(100), false],
      ['Assurance auto', euros(50), true],
      ['Vacances', euros(150), false],
      ['Épargne de précaution', euros(300), false],
    ]);
    // Ce que la carte montre est ce que la validation enregistre : toutes les parts du fichier.
    const fichier = exampleLedger().plannedFlows.find((f) => f.id === ORDRE)!.action!.allocation;
    expect(partsDeLOrdre(projet, c.montre, b, ordreMontre(c.montre, ORDRE))).toEqual(fichier);
  });

  it('[niveau 1] 5 — la carte de l’ordre vers le compte que le fichier dit retiré le nomme, marqué comme retiré', async () => {
    const { s, b } = await repris();
    const c = carte(s.load(), b, ORDRE_ENFANTS);
    expect(c.vers).toBe('Carte enfants (compte retiré)');
    expect(c.ventilation.compte).toBe('Carte enfants (compte retiré)');
  });

  it('7 — l’assistant ne montre la tirelire et le compte retirés nulle part comme vivants ; le brouillon les porte retirés', async () => {
    const { s, b } = await repris();
    const montre = montrer(s.load(), b);
    expect(alive(montre.tirelires).map((t) => t.id)).not.toContain('env-auto');
    expect(montre.tirelires.find((t) => t.id === 'env-auto')!.deletedAt).toBeTruthy();
    expect(retireesDuFichier(b, 'tirelires')).toEqual(new Set(['env-auto']));
    // « ni dans une liste de choix » : les comptes que l'assistant propose sont les vivants.
    expect(alive(montre.accounts).map((a) => a.id)).not.toContain('acc-enfants');
    expect(montre.accounts.find((a) => a.id === 'acc-enfants')!.deletedAt).toBeTruthy();
  });

  it('[niveau 1] 6 — validé : la tirelire et le compte retirés, les ordres et chacune de leurs parts, tels que le fichier les dit', async () => {
    const { s, b, deleted, compteDeleted } = await repris();
    valider(s, s.load(), b);
    const apres = s.load();
    expect(apres.tirelires.find((t) => t.id === 'env-auto')).toMatchObject({ name: 'Assurance auto', deletedAt: deleted });
    expect(apres.accounts.find((a) => a.id === 'acc-enfants')).toMatchObject({ name: 'Carte enfants', deletedAt: compteDeleted });
    expect(apres.plannedFlows.find((f) => f.id === ORDRE)!.action).toEqual(exampleLedger().plannedFlows.find((f) => f.id === ORDRE)!.action);
    const enfants = apres.plannedFlows.find((f) => f.id === ORDRE_ENFANTS)!;
    expect([enfants.counterpartAccountId, enfants.deletedAt]).toEqual(['acc-enfants', undefined]);
  });

  it('une tirelire retirée dans l’assistant n’est pas « retirée par le fichier »', async () => {
    const s = await depot();
    const b = nouveauBrouillon(s.load());
    retirerTirelire(b, s.load(), 'env-auto');
    expect(retireesDuFichier(b, 'tirelires').has('env-auto')).toBe(false);
  });
});
