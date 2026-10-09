/**
 * Harnais d'audit de #409, côté assistant, sans navigateur : le brouillon enregistré en JSON
 * (`src/lib/brouillon.ts`, point 2), repris sur un projet (points 4 et 6), ce que le résumé en dit
 * (`src/lib/differenceAssistant.ts`, point 5) et ce que l'assistant en montre (point 7), sur un vrai
 * dépôt (`LedgerStore`) qui porte le budget de l'exemple. Le cœur est dans
 * `packages/core/test/budget-json-ligne-retiree-harnais.test.ts` ; l'écran, dans
 * `navigateur/budget-json-ligne-retiree-harnais.test.ts`.
 *
 * Les tests sont ceux du codeur (`budget-json-ligne-retiree.test.ts`, déplacé ici en entier), classés
 * par la suite de questions de D83 ; est de l'auditeur le brouillon enregistré depuis l'assistant
 * ouvert sur chaque section (point 2, #363). Niveau 1 : le résumé (point 5, D40, I10) et la validation
 * (point 6, I10), vus rouges sur des mutations ciblées, dites dans la vérification de la PR. Niveau 2 :
 * le reste.
 *
 * L'ordre « Virement Livret A » (600 €) a trois parts fixes — Taxe foncière, Assurance auto, Vacances —
 * et la part variable d'Épargne de précaution.
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { LedgerStore, alive, budgetDefiniEnJson, exampleLedger, lireBudgetJson, standingOrderTarget, MAIN_ACCOUNT_ID, type Ledger, type PlannedFlow } from '@tirelire/core';
import { brouillonDuFichier, fichierAEnregistrer, montrer, nouveauBrouillon, preparerValidation, retireesDuFichier, retirer, valider, type Brouillon } from '../src/lib/brouillon';
import { direDifference } from '../src/lib/differenceAssistant';

const SQL = await initSqlJs();
const ORDRE = 'flow-vir-livret';
const RETIRE = '2026-09-02T10:00:00.000Z';
const MAINTENANT = '2026-09-06T08:00:00.000Z';

async function depot(retirees: string[] = []): Promise<LedgerStore> {
  const s = await LedgerStore.create({ sqlJs: SQL, siteId: 't' });
  const l = exampleLedger();
  for (const k of ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows'] as const) for (const r of l[k]) s.upsert(k, r as never);
  for (const id of retirees) {
    for (const n of alive(s.load().needs).filter((x) => x.tirelireId === id)) s.remove('needs', n.id);
    s.remove('tirelires', id);
  }
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
    const s = await depot(['env-auto']);
    s.remove('accounts', 'acc-enfants');
    const projet = s.load();
    for (const section of ['comptes', 'tirelires'] as const) {
      const lu = lireBudgetJson(JSON.stringify(budgetDefiniEnJson(fichierAEnregistrer(projet, nouveauBrouillon(projet, section), MAINTENANT))));
      if (!lu.ok) throw new Error(`${section} : ${lu.message}`);
    }
  });
});

describe('[niveau 2] #409 · 4 à 7 — repris sur un projet vierge', () => {
  async function repris() {
    const source = await depot(['env-auto']);
    const j = budgetDefiniEnJson(fichierAEnregistrer(source.load(), nouveauBrouillon(source.load()), MAINTENANT));
    const lu = lireBudgetJson(JSON.stringify(j));
    if (!lu.ok) throw new Error(lu.message);
    const s = await LedgerStore.create({ sqlJs: SQL, siteId: 'u' });
    return { s, b: brouillonDuFichier(s.load(), lu.budget), deleted: source.load().tirelires.find((t) => t.id === 'env-auto')!.deletedAt };
  }

  it('[niveau 1] 5 — le résumé dit la tirelire qui entre retirée, sous son nom, à part des ajouts', async () => {
    const { s, b } = await repris();
    const d = dire(s.load(), b);
    const tirelires = d.parties.find((p) => p.nom === 'Tirelires')!;
    expect(tirelires.entreesRetirees.map((l) => l.texte)).toEqual(['« Assurance auto »']);
    expect(tirelires.ajouts.map((l) => l.texte)).not.toContain('« Assurance auto »');
    // Le besoin retiré n'est désigné par aucune ligne : le fichier ne le porte pas, et le résumé n'en dit rien.
    expect(JSON.stringify(d.parties)).not.toContain('le besoin de « Assurance auto »');
  });

  it('7 — l’assistant ne montre la tirelire retirée nulle part comme vivante ; le brouillon la porte retirée', async () => {
    const { s, b } = await repris();
    const montre = montrer(s.load(), b);
    expect(alive(montre.tirelires).map((t) => t.id)).not.toContain('env-auto');
    expect(montre.tirelires.find((t) => t.id === 'env-auto')!.deletedAt).toBeTruthy();
    expect(retireesDuFichier(b, 'tirelires')).toEqual(new Set(['env-auto']));
  });

  it('[niveau 1] 6 — validé : la tirelire retirée, l’ordre et chacune de ses parts, tels que le fichier les dit', async () => {
    const { s, b, deleted } = await repris();
    valider(s, s.load(), b);
    const apres = s.load();
    expect(apres.tirelires.find((t) => t.id === 'env-auto')).toMatchObject({ name: 'Assurance auto', deletedAt: deleted });
    expect(apres.plannedFlows.find((f) => f.id === ORDRE)!.action).toEqual(exampleLedger().plannedFlows.find((f) => f.id === ORDRE)!.action);
  });

  it('une tirelire retirée dans l’assistant n’est pas « retirée par le fichier »', async () => {
    const s = await depot();
    const b = nouveauBrouillon(s.load());
    retirerTirelire(b, s.load(), 'env-auto');
    expect(retireesDuFichier(b, 'tirelires').has('env-auto')).toBe(false);
  });
});
