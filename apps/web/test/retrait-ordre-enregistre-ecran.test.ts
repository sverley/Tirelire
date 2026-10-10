// @vitest-environment jsdom
/**
 * Test du codeur de #419 : ce que vérifiait, dans le navigateur, le harnais d'audit de #407 pour l'ordre proposé sur un
 * projet vierge (point 3), que #419 retire, se vérifie ici sans navigateur : l'application montée sous jsdom
 * (`ecran.ts`). Le titre dit le point du « Fait quand » de #407 qu'il vérifie, et le numéro du test retiré dans la
 * table de #419 (« retrait 1 »). Ce qui reste au navigateur — un retrait, depuis son écran ou dans l'assistant complet,
 * laisse l'ordre enregistré, mesuré à 375 px — : `navigateur/retrait-ordre-enregistre-harnais.test.ts`.
 *
 * Ce qui se lit ici : le résumé de l'assistant — les cartes des ordres, les lignes des ordres touchés —, l'étape
 * Comptes où l'on retire le Livret A, la validation, et le projet que l'application a enregistré, relu dans le dépôt.
 * Le parcours part d'un projet vierge, l'assistant ouvert avec les propositions de l'exemple, qui proposent l'ordre
 * vers le Livret A (#395). L'ordre proposé qui part avec son compte, dans le brouillon :
 * `retrait-ordre-enregistre-harnais.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { alive } from '@tirelire/core';
import { arriverAuxComptes, cliquer, etape, lire, ouvrirLApplication, presser, projet, t, tous } from './ecran';

const cartesDesOrdres = () => tous('main .card.ordre').map(t);

describe('#419 · #407 point 3 — sur un projet vierge, l’ordre proposé part avec son compte, sans navigateur', () => {
  it('[niveau 4] #407 point 3 (table #419, retrait 1) — sur un projet vierge, retirer le Livret A dans l’assistant : le résumé ne montre plus l’ordre proposé ni d’ordre touché, la validation passe, et le projet ne porte aucun flux vers un compte retiré', async () => {
    await ouvrirLApplication();
    await arriverAuxComptes();
    // L'exemple accepté tel quel propose l'ordre vers le Livret A (#395).
    expect(await etape('Résumé')).toBe(true);
    expect(cartesDesOrdres().some((c) => /Livret A/.test(c)), 'l’ordre proposé vers le Livret A absent avant le retrait').toBe(true);

    expect(await etape('Comptes')).toBe(true);
    const ligne = tous('main .ligne-compte').find((x) => x.querySelector<HTMLInputElement>('input')?.value === 'Livret A');
    const retirer = ligne?.querySelector<HTMLButtonElement>('button[title="Retirer ce compte"]');
    expect(retirer, 'bouton « Retirer ce compte » du Livret A absent').toBeTruthy();
    await presser(retirer!);

    expect(await etape('Résumé')).toBe(true);
    expect(cartesDesOrdres().filter((c) => /Livret A/.test(c))).toEqual([]);
    expect(tous('main .difference .ordres-touches li')).toHaveLength(0);
    expect(lire().primaires).toContain('Valider mon budget');
    expect(await cliquer('Valider mon budget')).toBe(true);
    expect(t(document.querySelector('main'))).not.toContain('n’a pas été validé');

    const apres = projet();
    expect(alive(apres.accounts).length, 'la validation n’a rien écrit').toBeGreaterThan(0);
    expect(alive(apres.accounts).map((a) => a.name)).not.toContain('Livret A');
    const versUnCompteRetire = alive(apres.plannedFlows).filter((f) => f.counterpartAccountId && !alive(apres.accounts).some((a) => a.id === f.counterpartAccountId));
    expect(versUnCompteRetire).toEqual([]);
  });
});
