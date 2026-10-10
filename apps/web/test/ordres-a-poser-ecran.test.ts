// @vitest-environment jsdom
/**
 * Tests du codeur de #419 : ce que vérifiait, dans le navigateur, le harnais d'audit de #13 (les ordres à poser, du
 * résumé de l'assistant au Plan) et que #419 en retire, se vérifie ici sans navigateur : l'application montée sous
 * jsdom (`ecran.ts`). Chaque titre dit les points du « Fait quand » de #13 qu'il vérifie, et le numéro du test retiré
 * dans la table de #419 (« ordres à poser 1 » à « ordres à poser 6 »). Ce qui reste au navigateur — la copie dans le
 * presse-papiers, et ce qui se lit à 375 px, au résumé comme au Plan — : `navigateur/ordres-a-poser-harnais.test.ts`.
 *
 * Ce qui se lit ici : le résumé de l'assistant — ses blocs d'ordres à poser, sa phrase quand il n'y en a pas, le texte
 * de la suite —, l'écran qui suit la validation, la carte du compte au Plan, et le projet que l'application a
 * enregistré, relu dans le dépôt. Chaque parcours part d'un projet vierge, l'assistant ouvert avec les propositions de
 * l'exemple : l'ordre de l'exemple vers le Livret A est déjà là au résumé ; une fois retiré, le budget demande un ordre
 * vers le Livret A, que le résumé dit. Les montants attendus sont relus dans le cœur, sur le même budget et à la même
 * date. Ce que l'assistant calcule et dit, sans écran : `ordres-a-poser-harnais.test.ts` (« #13 · 2 », « #13 · 5 »,
 * « #13 · 7 »).
 */
import { describe, expect, it } from 'vitest';
import { alive, computePlan, exampleLedger, formatCents, transferLabel, type Ledger } from '@tirelire/core';
import { JOUR, app, arriverAuxComptes, cliquer, cliquerExactement, etape, ouvrirLApplication, presser, projet, rendu, saisir, t, tous } from './ecran';

/** Un montant tel que l'écran l'écrit, espaces resserrés comme `t` les resserre. */
const fmt = (c: number) => formatCents(c).replace(/[\s  ]+/g, ' ');
const COMPTE = 'Livret A';
const LIBELLE = transferLabel(COMPTE);

/** Ce que dit un ordre, dans le bloc de l'assistant ou sur la carte du Plan : la même lecture des deux côtés. */
function lireUnOrdre(c: Element) {
  return {
    montant: t(c.querySelector(':scope > .row > .num')),
    parts: tous('.ventilation .row', c).map(t),
    libelles: tous('.libelle-a-copier .libelle', c).map((x) => x.textContent ?? ''),
    jours: tous('.consigne .jour', c).map(t),
    boutons: tous('button', c).map(t),
  };
}
/** Les blocs d'ordres à poser du résumé de l'assistant. */
const blocsDeLAssistant = () => tous('main .card.ordre-a-poser').map((c) => ({ compte: t(c.querySelector(':scope > .row .label strong')), ...lireUnOrdre(c) }));
/** Le bloc `bloc` (`.proposition`, `.ordre-enregistre`) de la carte d'un compte au Plan ; `null` s'il n'y est pas. */
function carteDuPlan(compte: string, bloc: string) {
  const carte = tous('main .card').find((x) => t(x.querySelector(':scope > .row strong')) === compte);
  const c = carte?.querySelector(bloc);
  return c ? lireUnOrdre(c) : null;
}
/** Ce que le résumé dit des ordres à poser : ses blocs, sa phrase, son titre. */
const resume = () => ({
  blocs: tous('main .card.ordre-a-poser').length,
  phrase: t(document.querySelector('main .rien-a-poser')),
  titre: tous('main h3').some((h) => /ordres permanents à poser/.test(t(h))),
});
/** Les ordres vivants vers un compte, dans le projet enregistré. */
const ordresVers = (l: Ledger, compte: string) => {
  const id = alive(l.accounts).find((a) => a.name === compte)?.id;
  return alive(l.plannedFlows).filter((f) => f.kind === 'transfer' && (f.counterpartAccountId === id || f.accountId === id));
};

/** Un projet vierge, l'assistant ouvert avec les propositions de l'exemple, parcouru jusqu'au résumé. */
async function auResume(): Promise<void> {
  await ouvrirLApplication();
  await arriverAuxComptes();
  for (const e of ['Budgets', 'Pas tous les mois', 'Épargne', 'Résumé']) expect(await etape(e), `pas d’étape « ${e} »`).toBe(true);
}
/** Au résumé, retire l'ordre de l'exemple. */
async function retirerLOrdreDeLExemple(): Promise<void> {
  const b = document.querySelector<HTMLButtonElement>('main .card.ordre button[title="Retirer ce virement"]');
  expect(b, 'l’ordre de l’exemple ne se retire pas au résumé').toBeTruthy();
  await presser(b!);
}
/** Au résumé, laisse chaque tirelire hors de tout compte d'accueil ; rend combien étaient placées. */
async function laisserLesTirelireshorsDesComptes(): Promise<number> {
  let n = 0;
  for (const c of tous<HTMLSelectElement>('main select')) {
    if (!c.querySelector('option[value=""]') || c.value === '') continue;
    await saisir(c, '');
    n++;
  }
  return n;
}

/** Ce que le budget de l'assistant demande vers le Livret A, l'ordre de l'exemple retiré, au jour des tests. */
const propose = (() => {
  const l = exampleLedger();
  const plan = computePlan({ ...l, plannedFlows: l.plannedFlows.filter((f) => f.id !== 'flow-vir-livret') }, JOUR);
  return plan.transfers.find((x) => x.accountName === COMPTE)!.proposal!;
})();

describe('#419 · #13 — les ordres à poser, de l’assistant au Plan, sans navigateur', () => {
  it('[niveau 4] #13 points 1 et 4 (table #419, ordres à poser 1) — l’ordre de l’exemple est là : pas de bloc, une phrase, et rien qui invite à créer un compte', async () => {
    await auResume();
    expect(blocsDeLAssistant()).toEqual([]);
    const phrase = t(document.querySelector('main .rien-a-poser'));
    expect(phrase).toMatch(/^Aucun autre ordre permanent à poser chez votre banque/);
    expect(phrase).not.toMatch(/créez|créer|ajoutez/i);
    expect(tous('main .card.ordre').some((c) => /Livret A/.test(t(c))), 'l’ordre de l’exemple n’est pas au résumé').toBe(true);
  });

  it('[niveau 4] #13 points 1, 3, 6 et 7 (table #419, ordres à poser 2) — l’ordre retiré, le résumé dit celui à poser vers le Livret A, sans geste qui l’enregistre', async () => {
    await auResume();
    await retirerLOrdreDeLExemple();
    const blocs = blocsDeLAssistant();
    expect(blocs.map((b) => b.compte)).toEqual([COMPTE]);
    const b = blocs[0]!;
    expect(b.montant).toBe(fmt(propose.amount));
    expect(b.montant).toBe('650,00 €');
    expect(b.parts.length, 'la ventilation ne se lit pas').toBeGreaterThanOrEqual(propose.allocation!.length);
    expect(propose.allocation!.length).toBeGreaterThan(0);
    expect(b.libelles).toEqual([LIBELLE]);
    expect(b.jours).toEqual([expect.stringMatching(/^Jour du virement : le 28 de chaque mois\. .*jusqu’à 5 jours avant ou après est reconnu à l’import/)]);
    expect(b.boutons, 'le bloc ne doit offrir que la copie').toEqual(['Copier']);
    const suite = document.querySelector('main p.explication-suite');
    expect(!!suite && !suite.closest('details'), 'le texte de la suite n’est pas affiché dans l’assistant').toBe(true);
    expect(t(suite)).toMatch(/libellé et son montant/);
    // Dire n'est pas enregistrer : rien ne s'est écrit dans le projet.
    expect(ordresVers(projet(), COMPTE)).toEqual([]);
  });

  it('[niveau 4] #13 point 3 (table #419, ordres à poser 3) — validé, aucun ordre n’est enregistré ; l’écran dit que les ordres se mettent en place sur le Plan, et le bouton principal y conduit', async () => {
    await auResume();
    await retirerLOrdreDeLExemple();
    expect(blocsDeLAssistant().length, 'le budget doit d’abord demander un ordre').toBe(1);
    expect(await cliquer('Valider mon budget')).toBe(true);
    await rendu();
    expect(alive(projet().accounts).some((a) => a.name === COMPTE), 'la validation n’a pas écrit le budget').toBe(true);
    expect(ordresVers(projet(), COMPTE)).toEqual([]);
    expect(t(document.querySelector('main .ordres-sur-le-plan'))).toMatch(/se mettent en place sur l’écran Plan/);
    expect(tous('main .btn.primary').map(t)).toEqual(['Voir le plan']);
    expect(await cliquerExactement('Voir le plan')).toBe(true);
    expect(app.view).toBe('plan');
    expect(carteDuPlan(COMPTE, '.proposition'), 'le Plan ne propose pas l’ordre à mettre en place').not.toBeNull();
  });

  it('[niveau 4] #13 point 5 (table #419, ordres à poser 4) — enregistré depuis le Plan, l’ordre dit le jour de son ancrage et son libellé, ceux que le Plan proposait', async () => {
    await auResume();
    await retirerLOrdreDeLExemple();
    expect(await cliquer('Valider mon budget')).toBe(true);
    expect(await cliquerExactement('Voir le plan')).toBe(true);
    const avant = carteDuPlan(COMPTE, '.proposition');
    expect(avant, 'la carte du Plan ne propose pas d’ordre').not.toBeNull();
    expect(avant!.libelles).toEqual([LIBELLE]);
    expect(await cliquerExactement('Enregistrer mon ordre permanent')).toBe(true);
    const [ordre, ...autres] = ordresVers(projet(), COMPTE);
    expect(autres).toEqual([]);
    expect(ordre?.labelPattern).toBe(LIBELLE);
    expect(Number(ordre!.periodicity.anchorDate.slice(8))).toBe(28);
    const enregistre = carteDuPlan(COMPTE, '.ordre-enregistre');
    expect(enregistre?.libelles).toEqual(avant!.libelles);
    expect(enregistre?.jours).toEqual(avant!.jours);
    expect(enregistre?.jours[0]).toMatch(/le 28 de chaque mois/);
  });

  it('[niveau 4] #13 point 4 (table #419, ordres à poser 5) — sans ordre de l’exemple, les tirelires laissées hors de tout compte d’accueil : une phrase, aucun bloc, rien qui invite à créer un compte', async () => {
    await auResume();
    await retirerLOrdreDeLExemple();
    expect(resume().blocs, 'le budget doit d’abord demander un ordre').toBeGreaterThan(0);
    expect(await laisserLesTirelireshorsDesComptes(), 'aucune tirelire n’était placée ailleurs').toBeGreaterThan(0);
    const r = resume();
    expect(r).toMatchObject({ blocs: 0, titre: false });
    expect(r.phrase).toMatch(/^Aucun ordre permanent à poser chez votre banque/);
    expect(r.phrase).not.toMatch(/créez|créer|ajoutez|ouvrez/i);
  });

  it('[niveau 4] #13 point 4 (table #419, ordres à poser 6) — sans aucune tirelire, le résumé ne parle pas d’ordre à poser', async () => {
    await auResume();
    // L'état où le test retiré partait : l'ordre de l'exemple retiré, les tirelires hors de tout compte d'accueil.
    await retirerLOrdreDeLExemple();
    await laisserLesTirelireshorsDesComptes();
    for (const e of ['Budgets', 'Pas tous les mois', 'Épargne']) {
      expect(await etape(e)).toBe(true);
      for (let i = 0; i < 40; i++) {
        const b = document.querySelector<HTMLButtonElement>('main button[title="Retirer cette tirelire"]');
        if (!b) break;
        await presser(b);
      }
      expect(document.querySelector('main button[title="Retirer cette tirelire"]'), `une tirelire reste à l’étape « ${e} »`).toBeNull();
    }
    expect(await etape('Résumé')).toBe(true);
    expect(resume()).toEqual({ blocs: 0, phrase: '', titre: false });
    expect(t(document.querySelector('main'))).not.toMatch(/ordre permanent à poser/i);
  });
});
