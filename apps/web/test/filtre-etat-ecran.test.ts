// @vitest-environment jsdom
/**
 * Tests du codeur de #421 : ce que vérifiait, dans le navigateur, la garde du filtre d'état des écrans de cartes (D56,
 * `navigateur/filtre-etat.test.ts`), que #421 retire, se vérifie ici sans navigateur : l'application montée sous jsdom
 * (`ecran.ts`), l'exemple chargé (« Charger l'exemple »), au jour des tests. Chaque titre dit ce qu'il vérifie de D56,
 * et le numéro du test retiré dans la table de #421 (« filtre-etat 1 » à « filtre-etat 3 »).
 *
 * Ce qui se lit ici est ce que chaque écran montre : ses interrupteurs d'état (allumés ou non), les noms de ses cartes,
 * les pastilles d'état de ce qu'il affiche ; chaque interrupteur se bascule d'un clic. La règle de chaque état, les
 * interrupteurs indépendants et l'exemple qui porte les trois états, pour la donnée seule, sont vérifiés au cœur par
 * `packages/core/test/etats.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { alive } from '@tirelire/core';
import { app, attendre, cliquer, ecran, ouvrirLApplication, presser, t, tous } from './ecran';

/** Noms des cartes affichées, interrupteurs et pastilles d'état. */
function lire() {
  return {
    // Le nom d'une carte de compte se lit dans le champ de sa ligne (la section Comptes, #362), celui d'une tirelire
    // dans son champ (#369) ; les autres, dans leur titre.
    cartes: [
      ...tous('main .card > .row > .label > strong, main .card.tirelire > .ligne-tirelire > input.nom'),
      ...tous('main .card > .ligne-compte > input:first-child'),
    ].map((e) => (e instanceof HTMLInputElement ? e.value.trim() : t(e))),
    filtres: tous('main .filtre').map(t),
    allumes: tous('main .filtre.actif').map(t),
    pastilles: tous('main .pill.dim').map(t),
  };
}

/** Ouvre l'application, charge l'exemple et va sur un écran de Configuration. */
async function ouvrir(nom: string): Promise<void> {
  await ouvrirLApplication();
  expect(await cliquer('Charger l\'exemple')).toBe(true);
  await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A'), 'l’exemple');
  expect(await ecran(nom), `l’écran ${nom} est introuvable`).toBe(true);
  expect(t(document.querySelector('main h1'))).toBe(nom);
}

/** Bascule un interrupteur d'état par son libellé. */
async function basculer(etat: string): Promise<void> {
  const b = tous<HTMLButtonElement>('main .filtre').find((x) => t(x).startsWith(etat));
  expect(b, `interrupteur « ${etat} » introuvable`).toBeDefined();
  await presser(b!);
}

describe('#421 · D56 — le filtre d’état des écrans de cartes, sur l’exemple chargé, sans navigateur', () => {
  it('[niveau 4] D56 (table #421, filtre-etat 1) — l’écran Tirelires part avec « En cours » et « À venir » allumés et « Clos » affiché et éteint, sans pastille « clos » ; « Clos » allumé rend le besoin clos ; « En cours » et « À venir » éteints, seul le clos reste', async () => {
    await ouvrir('Tirelires');

    const depart = lire();
    expect(depart.filtres.some((f) => f.startsWith('Clos')), 'l’interrupteur « Clos » manque').toBe(true);
    expect(depart.allumes.some((f) => f.startsWith('En cours')), '« En cours » doit partir allumé').toBe(true);
    expect(depart.allumes.some((f) => f.startsWith('À venir')), '« À venir » doit partir allumé').toBe(true);
    expect(depart.allumes.some((f) => f.startsWith('Clos')), '« Clos » doit partir éteint').toBe(false);
    // L'exemple porte un budget révisé (D51) : « Divers et sorties » a un besoin clos, rangé au départ, et un besoin
    // en vigueur, qui garde la carte à l'écran.
    expect(depart.cartes).toContain('Divers et sorties');
    expect(depart.pastilles, 'rien de clos ne doit s’afficher au départ').not.toContain('clos');
    expect(depart.pastilles, 'ce qui vient reste lisible').toContain('à venir');

    await basculer('Clos');
    const avecClos = lire();
    expect(avecClos.pastilles, 'allumer « Clos » doit rendre le besoin clos').toContain('clos');
    expect(avecClos.pastilles, 'les autres interrupteurs ne bougent pas').toContain('à venir');

    // Éteindre le courant ne garde que les cartes qui portent du clos ou de l'à venir.
    await basculer('En cours');
    await basculer('À venir');
    const closSeul = lire();
    expect(closSeul.cartes).toContain('Divers et sorties');
    expect(closSeul.cartes, 'une tirelire sans rien de clos n’a rien à faire ici').not.toContain('Taxe foncière');
    expect(closSeul.pastilles.length, 'le clos doit rester').toBeGreaterThan(0);
    expect(closSeul.pastilles.every((p) => p === 'clos'), 'seul le clos doit rester').toBe(true);
  });

  it('[niveau 4] D56 (table #421, filtre-etat 2) — l’écran Comptes part avec « Compte courant » et sans « Livret jeune », « Clos » affiché ; « Clos » allumé, les deux y sont ; « En cours » éteint, il ne reste que « Livret jeune »', async () => {
    await ouvrir('Comptes');

    const depart = lire();
    expect(depart.cartes).toContain('Compte courant');
    expect(depart.cartes, 'un compte clos ne se lit pas comme un compte ouvert').not.toContain('Livret jeune');
    expect(depart.filtres.some((f) => f.startsWith('Clos')), 'ce qui est masqué doit rester visible dans la barre').toBe(true);

    await basculer('Clos');
    const avecClos = lire();
    expect(avecClos.cartes).toContain('Livret jeune');
    expect(avecClos.cartes).toContain('Compte courant');

    await basculer('En cours');
    expect(lire().cartes).toEqual(['Livret jeune']);
  });

  it('[niveau 4] D56 (table #421, filtre-etat 3) — l’écran Flux prévus affiche « À venir » et une pastille « à venir » (le salaire revalorisé, D51) ; éteint, plus aucune pastille « à venir », et des flux restent à l’écran', async () => {
    await ouvrir('Flux prévus');

    const depart = lire();
    expect(depart.filtres.some((f) => f.startsWith('À venir')), 'l’interrupteur « À venir » manque').toBe(true);
    // L'exemple porte un salaire revalorisé à la paie de novembre (D51) : son successeur est à venir.
    expect(depart.pastilles).toContain('à venir');

    await basculer('À venir');
    const sansAVenir = lire();
    expect(sansAVenir.pastilles, 'éteindre « À venir » doit ranger le successeur').not.toContain('à venir');
    expect(sansAVenir.cartes.length, 'les flux en vigueur restent').toBeGreaterThan(0);
  });
});
