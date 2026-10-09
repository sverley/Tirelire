// @vitest-environment jsdom
/**
 * Harnais d'audit de #418, composé parmi les tests du codeur :
 * ce que vérifiait `navigateur/ordre-ventile-assistant-harnais.test.ts` (harnais d'audit
 * de #395, l'ordre « Virement Livret A » que l'assistant propose au résumé), sauf la carte lue à 375 px, sans
 * navigateur : l'application montée sous jsdom (`ecran.ts`), au jour des tests, projet vierge. Chaque titre dit le
 * point du « Fait quand » de #395 qu'il vérifie, et le numéro du test retiré dans la table de #418 (« ordre 1 » à
 * « ordre 3 »).
 *
 * Le calcul sur l'exemple : `packages/core/test/ordre-ventile-exemple-harnais.test.ts`. Reste dans le navigateur :
 * « la carte de l'ordre dit chaque part, la variable comme le reste, lisible à 375 px »
 * (`navigateur/ordre-ventile-assistant-harnais.test.ts`).
 *
 * Niveaux (D83) : ceux des tests retirés, que la table de #418 recopie. 1 pour ordre 1 (I10) et ordre 2 (U2, I3),
 * rouges sur trois mutations : l'ordre proposé écrit aussitôt dans le projet ; une part perdue à la validation ; le
 * Plan qui ne signale plus la part de Vacances. 2 pour ordre 3.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { alive, computePlan, type Ledger } from '@tirelire/core';
import { allerA, app, arriverAuxComptes, cliquer, etape, ouvrirLApplication, presser, projet, saisir, t, tous } from './ecran';

/** Les parts que montre la carte de l'ordre : le nom de sa tirelire, sa forme et son montant ; le non affecté n'en est pas une. */
const parts = () =>
  tous('main .card.ordre .ventilation .row.part:not(.non-affecte)').map((r) => {
    const label = r.querySelector('.label');
    return [t({ textContent: label?.firstChild?.textContent ?? '' } as Element), t(label?.querySelector('.sub')), t(r.querySelector('.num'))];
  });

/** L'ordre enregistré : son montant et ses parts, nommées par leur tirelire. */
const ordreEnregistre = (l: Ledger) => {
  const f = alive(l.plannedFlows).find((x) => x.kind === 'transfer' && x.name === 'Virement Livret A');
  if (!f) return null;
  return { montant: f.amount, parts: (f.action?.allocation ?? []).map((a) => [l.tirelires.find((x) => x.id === a.tirelireId)?.name, a.share]) };
};

/** L'assistant d'un projet vierge, mené au résumé par ses étapes de tirelires : l'ordre s'y propose. */
async function auResume() {
  await ouvrirLApplication();
  await arriverAuxComptes();
  for (const e of ['Budgets', 'Pas tous les mois', 'Épargne', 'Résumé']) expect(await etape(e), `pas d’étape « ${e} »`).toBe(true);
}

describe('#418 · #395 — parcouru sans rien modifier, sans navigateur', () => {
  beforeAll(auResume);

  it('[niveau 1] #395 point 6, I10 (table #418, ordre 1) — le résumé atteint, l’ordre proposé, le projet ne porte aucun ordre', () => {
    expect(parts().length, 'le résumé ne propose pas l’ordre').toBe(4);
    expect(ordreEnregistre(projet())).toBeNull();
  });

  it('[niveau 1] #395 points 6 et 7 (table #418, ordre 2) — validé, l’ordre s’enregistre à 600,00 € avec ses parts, et le Plan signale le montant de l’ordre et la seule part de Vacances', async () => {
    expect(await cliquer('Valider mon budget')).toBe(true);
    const l = projet();
    expect(ordreEnregistre(l)).toEqual({
      montant: -60000,
      parts: [
        ['Taxe foncière', { kind: 'fixed', amount: -10000 }],
        ['Assurance auto', { kind: 'fixed', amount: -5000 }],
        ['Vacances', { kind: 'fixed', amount: -15000 }],
        ['Épargne de précaution', { kind: 'variable' }],
      ],
    });
    const livret = computePlan(l, app.asOf).transfers.find((x) => x.accountName === 'Livret A')!;
    expect(livret.bankOrder?.signaled).toBe(true);
    expect(livret.bankOrder!.parts.filter((p) => p.signaled).map((p) => p.tirelireName)).toEqual(['Vacances']);

    // Ce que le Plan de ce projet en montre : sur la carte Livret A, le montant de l'ordre à passer, et, des parts de
    // l'ordre enregistré, Vacances seule en écart, avec ce que le budget lui demande.
    await allerA('Plan');
    const carte = tous('main .card').find((c) => t(c.querySelector(':scope > .row .label strong')) === 'Livret A');
    expect(carte, 'pas de carte « Livret A » dans le Plan').toBeTruthy();
    const ordre = tous(':scope > .row', carte!).find((r) => t(r.querySelector('.label')).startsWith('Ordre permanent chez la banque'));
    expect(t(ordre), 'le Plan ne signale pas le montant de l’ordre').toMatch(/à passer à [\d\s ,]+€ chez la banque/);
    const enregistre = carte!.querySelector('.ordre-enregistre');
    expect(enregistre, 'le Plan ne montre pas l’ordre enregistré').toBeTruthy();
    const enEcart = tous('.ventilation .row.part.ecart', enregistre!).map((r) => t({ textContent: r.querySelector('.label')?.firstChild?.textContent ?? '' } as Element));
    expect(enEcart, 'les parts que le Plan signale').toEqual(['Vacances']);
    expect(t(tous('.ventilation .row.part.ecart', enregistre!)[0]), 'la part de Vacances ne dit pas ce que le budget demande').toMatch(/le budget demande 200,00 € par mois/);
  });
});

describe('#418 · #395 — une tirelire retirée après la proposition, le montant corrigé, sans navigateur', () => {
  beforeAll(auResume);

  it('[niveau 2] #395 points 4 et 5 (table #418, ordre 3) — Vacances retirée : Taxe foncière 100,00, Assurance auto 50,00, Épargne de précaution 450,00 en « le reste » ; à 120,00, la variable à 0,00 ; validé, l’ordre à 120,00 € et ses trois parts', async () => {
    expect(await etape('Pas tous les mois')).toBe(true);
    const champ = tous<HTMLInputElement>('main .card.tirelire input.nom').find((i) => i.value.trim() === 'Vacances');
    const b = champ?.parentElement?.querySelector('button.danger') as HTMLButtonElement | null | undefined;
    expect(b, 'pas de bouton pour retirer Vacances').toBeTruthy();
    await presser(b!);
    expect(await etape('Résumé')).toBe(true);
    expect(parts()).toEqual([
      ['Taxe foncière', 'part fixe', '100,00 €'],
      ['Assurance auto', 'part fixe', '50,00 €'],
      ['Épargne de précaution', 'le reste', '450,00 €'],
    ]);
    await saisir(document.querySelector('main .card.ordre input.mt') as HTMLInputElement, '120,00');
    expect(parts()).toEqual([
      ['Taxe foncière', 'part fixe', '100,00 €'],
      ['Assurance auto', 'part fixe', '50,00 €'],
      ['Épargne de précaution', 'le reste', '0,00 €'],
    ]);
    expect(await cliquer('Valider mon budget')).toBe(true);
    expect(ordreEnregistre(projet())).toEqual({
      montant: -12000,
      parts: [
        ['Taxe foncière', { kind: 'fixed', amount: -10000 }],
        ['Assurance auto', { kind: 'fixed', amount: -5000 }],
        ['Épargne de précaution', { kind: 'variable' }],
      ],
    });
  });
});
