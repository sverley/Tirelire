// @vitest-environment jsdom
/**
 * Tests du codeur de #419 : ce que vérifiait, dans le navigateur, le harnais d'audit de #393 côté écran (point 11 :
 * « modifier un ordre à l'écran Flux ne retire pas les parts de son action »), que #419 retire, se vérifie ici sans
 * navigateur : l'application montée sous jsdom (`ecran.ts`). Le titre dit le point du « Fait quand » de #393 qu'il
 * vérifie, et le numéro du test retiré dans la table de #419 (« action-du-flux 1 »).
 *
 * Ce qui se lit ici : la carte du Livret A à l'écran Plan, le formulaire du flux à l'écran Flux prévus, et le projet
 * que l'application a enregistré, relu dans le dépôt. Le parcours part de l'exemple chargé (« Charger l'exemple ») :
 * l'ordre vers le Livret A s'enregistre depuis le Plan avec la ventilation proposée (« Confirmer mon nouvel ordre ») ;
 * on l'ouvre ensuite à l'écran Flux prévus par « Modifier », on coche le verrouillage et on enregistre. L'enregistrement
 * de l'ordre lui-même, calculé : `packages/core/test/action-du-flux-harnais.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { alive, type PlannedFlow } from '@tirelire/core';
import { allerA, app, attendre, cliquer, ecran, ouvrirLApplication, presser, projet, rendu, t, tous } from './ecran';

/** Ouvre l'application et charge l'exemple, comme le bouton de l'accueil. */
async function ouvrirLExemple(): Promise<void> {
  await ouvrirLApplication();
  expect(await cliquer('Charger l\'exemple')).toBe(true);
  await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A'), 'l’exemple');
  await rendu();
}

/** L'ordre vers le Livret A, tel que le projet enregistré le porte. */
const ordreEnregistre = (): PlannedFlow | undefined =>
  alive(projet().plannedFlows).find((f) => f.kind === 'transfer' && f.counterpartAccountId === 'acc-livret');

/** Clique un bouton de la carte du Livret A, à l'écran Plan. */
async function cliquerDansLaCarte(texte: string): Promise<boolean> {
  const c = tous('main .card').find((x) => t(x.querySelector(':scope > .row strong')) === 'Livret A');
  const b = c && tous<HTMLButtonElement>('button', c).find((x) => t(x) === texte);
  if (b) await presser(b);
  return !!b;
}

describe('#419 · #393 point 11 — modifier un ordre à l’écran Flux prévus garde les parts de son action, sans navigateur', () => {
  it('[niveau 4] #393 point 11 (table #419, action-du-flux 1) — enregistré depuis le Plan avec ses parts, modifié et verrouillé à l’écran Flux prévus : le projet garde son identifiant et ses parts, et son action porte le verrouillage', async () => {
    await ouvrirLExemple();
    await allerA('Plan');
    expect(await cliquerDansLaCarte('Confirmer mon nouvel ordre'), 'bouton « Confirmer mon nouvel ordre » absent de la carte du Livret A').toBe(true);
    const enregistre = ordreEnregistre();
    const parts = enregistre?.action?.allocation;
    expect(parts?.length, 'l’ordre enregistré depuis le Plan ne porte pas de parts').toBeGreaterThan(0);
    expect(enregistre?.action?.state, 'l’ordre est déjà verrouillé : cocher ne change rien').not.toBe('lock');

    expect(await ecran('Flux prévus')).toBe(true);
    const ligne = tous('main .row').find((x) => t(x.querySelector('.label strong')) === enregistre!.name);
    const modifier = ligne && tous<HTMLButtonElement>('button', ligne).find((b) => t(b) === 'Modifier');
    expect(modifier, `bouton « Modifier » absent de « ${enregistre!.name} »`).toBeTruthy();
    await presser(modifier!);
    const f = document.querySelector<HTMLFormElement>('main form.edit');
    const coche = f && tous('label', f).find((l) => t(l).includes('Verrouiller'))?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(coche, 'case « Verrouiller » introuvable dans le formulaire du flux').toBeTruthy();
    expect(coche!.checked).toBe(false);
    await presser(coche!);
    expect(coche!.checked).toBe(true);
    await presser(f!.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    expect(document.querySelector('main form.edit'), 'le formulaire du flux ne s’est pas enregistré').toBeNull();

    const modifie = ordreEnregistre();
    expect(modifie?.id).toBe(enregistre!.id);
    expect(modifie?.action?.allocation, 'le formulaire du flux a retiré ou changé les parts de l’ordre').toEqual(parts);
    expect(modifie?.action?.state).toBe('lock');
  });
});
