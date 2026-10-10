// @vitest-environment jsdom
/**
 * Harnais d'audit de #419, composé parmi les tests du codeur :
 * ce que vérifiait, dans le navigateur, le harnais d'audit de #323 (« Le Plan se lit sans
 * opération, période passée comprise »), que #419 retire, se vérifie ici sans navigateur : l'application montée sous
 * jsdom (`ecran.ts`). Chaque titre dit le point du « Fait quand » de #323 qu'il vérifie, et le numéro du test retiré
 * dans la table de #419 (« couvert 1 » et « couvert 2 »). Le point 3 (les textes vouvoient) : déjà,
 * `vouvoiement-textes-harnais.test.ts`, qui lit `src/views/Plan.svelte`, où ces textes s'écrivent (« couvert 3 »).
 *
 * Ce qui se lit ici : les tuiles de l'écran Plan, ses titres, et ce qui suit le titre « Tirelires » — sa carte, avec
 * son total, ou une phrase. Décors : l'exemple chargé par « Charger l'exemple » (lu au 6 septembre 2026) ; pour le
 * point 2, l'exemple dont chaque besoin n'ouvre qu'à la période qui suit le jour des tests, posé dans l'application
 * comme elle pose l'exemple (`replaceWith`), lu au jour des tests. Les montants attendus sont relus dans le cœur, sur
 * le même projet et à la même date. Le montant de la tuile comparé au Bilan : `bilan-budget-ecran.test.ts` (« bilan 2 ») ;
 * la prémisse du point 2, sans écran : `plan-couvert-par-les-revenus.test.ts`.
 *
 * Niveaux (D83) : ceux des tests retirés, que la table de #419 recopie. 2 pour couvert 1 (D29 : ce que couvrent les
 * revenus) ; 3 pour couvert 2 (la période sans besoin, moins lisible si elle ne le dit pas).
 */
import { describe, expect, it } from 'vitest';
import { alive, computePlan, exampleLedger, formatCents, periodReadingDate, periodsAround, type Ledger } from '@tirelire/core';
import { JOUR, allerA, app, attendre, cliquer, cliquerExactement, ouvrirLApplication, rendu, t, tous } from './ecran';

/** Un montant tel que l'écran l'écrit, espaces resserrés comme `t` les resserre. */
const fmt = (c: number) => formatCents(c).replace(/[\s  ]+/g, ' ');
const LECTURE = '2026-09-06';
/** Ce que dit la phrase d'une période sans besoin : aucune tirelire n'y est dotée. */
const AUCUNE_TIRELIRE_DOTEE = /aucune tirelire[^.]*dotée/i;

/** L'exemple, chaque besoin ouvert au plus tôt au premier jour de la période qui suit `jour`. */
function besoinsDifferes(jour: string): { ledger: Ledger; vide: string; dotee: string } {
  const l = exampleLedger();
  const [courante, suivante] = periodsAround(l, jour, 0, 1);
  const needs = l.needs.map((n) => (!n.activeFrom || n.activeFrom < suivante!.start ? { ...n, activeFrom: suivante!.start } : n));
  return { ledger: { ...l, needs }, vide: courante!.label, dotee: suivante!.label };
}

/** Les tuiles, les titres, et ce qui suit le titre « Tirelires » : carte (avec son total) ou phrase. */
function lireLePlan() {
  const tuiles = tous('main .stats .stat').map((s) => ({ k: t(s.querySelector('.k')), v: t(s.querySelector('.v')) }));
  const titres = tous('main h2').map(t);
  const h = tous('main h2').find((x) => t(x) === 'Tirelires');
  const apres = h?.nextElementSibling ?? null;
  const total = apres?.classList.contains('card') ? apres.querySelector(':scope > .row.total') : null;
  return {
    tuiles,
    titres,
    apresTitre: { carte: !!apres?.classList.contains('card'), texte: t(apres) },
    total: total ? { k: t(total.querySelector('.label')), v: t(total.querySelector('.num')) } : null,
  };
}

describe('#419 · #323 — le Plan sans opération, sans navigateur', () => {
  it('[niveau 2] #323 point 1 (table #419, couvert 1) — la tuile et le total des tirelires disent « Couvert par les revenus », pour le même montant, celui que le cœur calcule, sans « viré » ; les virements restent sous leur titre', async () => {
    await ouvrirLApplication();
    expect(await cliquer('Charger l\'exemple')).toBe(true);
    await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A') && app.asOf === LECTURE, 'l’exemple');
    await allerA('Plan');
    const e = lireLePlan();
    const tuile = e.tuiles.find((x) => x.k === 'Couvert par les revenus');
    expect(tuile, `tuiles : ${e.tuiles.map((x) => x.k).join(' | ')}`).toBeTruthy();
    expect(e.total?.k).toBe('Couvert par les revenus');
    expect(e.total?.v).toBe(tuile!.v);
    // Le montant que le cœur calcule pour la période où l'on lit, sur le même exemple, à la même date.
    const [courante] = periodsAround(exampleLedger(), LECTURE, 0, 0);
    const funded = computePlan(exampleLedger(), periodReadingDate(courante!, LECTURE), LECTURE).totals.funded;
    expect(funded).toBeGreaterThan(0);
    expect(tuile!.v).toBe(fmt(funded));
    for (const x of [...e.tuiles.map((y) => y.k), e.total!.k]) expect(x).not.toMatch(/viré/i);
    expect(e.titres, `titres : ${e.titres.join(' | ')}`).toContain('Virements à faire depuis le compte principal');
  });

  it('[niveau 3] #323 point 2 (table #419, couvert 2) — la période sans besoin le dit sous « Tirelires », sans carte ; la suivante garde sa carte', async () => {
    const b = besoinsDifferes(JOUR);
    await ouvrirLApplication();
    await app.replaceWith(b.ledger);
    await rendu();
    expect(app.asOf).toBe(JOUR);
    await allerA('Plan');

    expect(await cliquerExactement(b.vide), `bouton « ${b.vide} » introuvable`).toBe(true);
    const a = lireLePlan();
    expect(a.apresTitre.carte, `sous « Tirelires » : ${a.apresTitre.texte}`).toBe(false);
    expect(a.apresTitre.texte).toMatch(AUCUNE_TIRELIRE_DOTEE);
    expect(a.tuiles.find((x) => x.k === 'Couvert par les revenus')?.v).toBe(fmt(0));

    expect(await cliquerExactement(b.dotee), `bouton « ${b.dotee} » introuvable`).toBe(true);
    const d = lireLePlan();
    expect(d.apresTitre.carte, `sous « Tirelires » : ${d.apresTitre.texte}`).toBe(true);
    expect(d.apresTitre.texte).not.toMatch(AUCUNE_TIRELIRE_DOTEE);
    expect(d.total?.k).toBe('Couvert par les revenus');
  });
});
