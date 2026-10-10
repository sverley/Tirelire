// @vitest-environment jsdom
/**
 * Harnais d'audit de #420, composé parmi les tests du codeur :
 * ce que vérifiait, dans le navigateur, le test du point 4 du harnais d'audit de #321 (« sans
 * opération, aucun écran ne présente l'import comme un préalable »), que #420 retire, se vérifie ici sans navigateur :
 * l'application montée sous jsdom (`ecran.ts`). Son titre dit le point du « Fait quand » de #321
 * qu'il vérifie, et son numéro dans la table de #420 (« import 1 »).
 *
 * Ce qui se lit ici : les trois textes que #321 écrit, tels que l'application les montre — le bloc d'Opérations sans
 * opération et ce que l'import apporte, sur une base vide ; le bandeau des opérations anciennes, sur l'exemple lu le
 * 20 octobre 2026 par la date de lecture de l'en-tête. Les blocs se reconnaissent à `data-sans-operation` et
 * `data-apport-import`. Aucune forme du tutoiement dans les sources : `vouvoiement-textes-harnais.test.ts`. Les
 * points 1 à 3 restent dans le navigateur : `navigateur/import-enrichissement-harnais.test.ts`.
 *
 * Niveau (D83) : 2, celui du test retiré, que la table de #420 recopie (D85, une règle de décision).
 */
import { describe, expect, it } from 'vitest';
import { alive } from '@tirelire/core';
import { allerA, app, attendre, cliquer, ouvrirLApplication, rendu, saisir, t, tous } from './ecran';

/** Les formes du tutoiement qu'un texte vouvoyé ne porte pas (D85). */
const TUTOIEMENT = /\b(tu|te|toi|ton|ta|tes)\b|\bimporte un\b|\bsaisis\b/i;
/** Une forme du vouvoiement : le texte s'adresse bien à « vous ». */
const VOUVOIEMENT = /\b(vous|votre|vos)\b/i;

/** Le bandeau des opérations anciennes, s'il paraît. */
const bandeau = () => tous('main .card.warn').find((c) => t(c).includes('Dernière opération connue'));

describe('#420 · #321 point 4 — les textes que la tâche écrit vouvoient, sans navigateur', () => {
  it('[niveau 2] #321 point 4, D85 (table #420, import 1) — les textes que la tâche écrit vouvoient : Opérations sans opération, ce que l’import apporte, le bandeau', async () => {
    const lus: Record<string, string> = {};

    await ouvrirLApplication();
    await allerA('Opérations');
    expect(t(document.querySelector('main h1'))).toBe('Opérations');
    lus['Opérations sans opération'] = t(document.querySelector('main [data-sans-operation]'));
    await allerA('Import');
    expect(t(document.querySelector('main h1'))).toBe('Import d\'un relevé');
    lus['ce que l’import apporte'] = t(document.querySelector('main [data-apport-import]'));

    // L'exemple s'arrête début septembre : lu le 20 octobre, ses opérations sont anciennes.
    await ouvrirLApplication();
    expect(await cliquer('Charger l\'exemple')).toBe(true);
    await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A') && app.asOf === '2026-09-06', 'l’exemple');
    await rendu();
    expect(bandeau(), 'lu au 6 septembre, l’exemple n’a pas d’opérations anciennes').toBeUndefined();
    await saisir(document.querySelector('header input[type=date]') as HTMLInputElement, '2026-10-20');
    expect(app.asOf).toBe('2026-10-20');
    lus['le bandeau des opérations anciennes'] = t(bandeau());

    for (const [ou, texte] of Object.entries(lus)) {
      expect(texte, `${ou} : texte absent`).not.toBe('');
      expect(texte, `${ou} : tutoiement`).not.toMatch(TUTOIEMENT);
      expect(texte, `${ou} : ne s'adresse pas à « vous »`).toMatch(VOUVOIEMENT);
    }
  });
});
