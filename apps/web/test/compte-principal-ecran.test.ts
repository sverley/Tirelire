// @vitest-environment jsdom
/**
 * Harnais d'audit de #421, composé parmi les tests du codeur :
 * ce que vérifiait, dans le navigateur, le harnais d'audit de #209 côté écran (`navigateur/compte-principal.test.ts`,
 * « Le compte principal existe dans toute base, même vide »), que #421 retire, se vérifie ici sans navigateur :
 * l'application montée sous jsdom (`ecran.ts`), sur une base vide, au jour des tests. Chaque titre dit le point du
 * « Fait quand » de #209 qu'il vérifie, et le numéro du test retiré dans la table de #421 (« compte-principal 1 » à
 * « compte-principal 4 »).
 *
 * Ce qui se lit ici est ce que les écrans montrent : le texte du Plan, les cartes de l'écran Comptes et leur pastille de
 * genre, les boutons de la carte du compte principal, les choix de genre de sa carte et de son panneau « Modifier », et
 * celui du formulaire d'ajout d'un compte. La base elle-même — un compte principal et un seul, à l'ouverture et après
 * « Tout effacer » — et le refus du dépôt sont vérifiés par `compte-principal.test.ts` (harnais du registre, I8) ; le
 * projet que l'assistant enregistre, par `assistant-comptes-exemple-ecran.test.ts`.
 *
 * Niveaux (D83) : ceux des tests retirés, que la table de #421 recopie. 1 pour les quatre (U1 à U5 passent par le
 * compte principal ; U1 demande que l'assistant le renseigne au lieu d'en créer un), chacun vu rouge à l'audit sur
 * une mutation ciblée : une base qui naît sans compte principal (1 et 4), une carte du compte principal qui offre
 * « Supprimer » (2), un panneau « Modifier » qui offre au compte principal les genres d'un autre compte (2), un
 * assistant qui écrit le compte principal de l'exemple à côté du premier au lieu de le renseigner (3).
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_KINDS, alive, exampleLedger } from '@tirelire/core';
import { allerA, app, arriverAuxComptes, attendre, cliquer, ecran, ouvrirLApplication, presser, t, tous, validerTelQuel } from './ecran';

/** Ce que l'écran Comptes montre d'une carte : son nom, sa pastille de genre, ses boutons. */
interface Carte {
  el: HTMLElement;
  nom: string;
  genre: string;
  boutons: string[];
}

/** Les cartes de l'écran Comptes qui portent une pastille de genre. */
const cartes = (): Carte[] =>
  tous('main .card')
    .filter((c) => c.querySelector('.pill'))
    .map((c) => ({
      el: c,
      // Le nom se corrige sur la ligne de la carte (la section Comptes, #362) : il est dans son champ.
      nom: (c.querySelector('.ligne-compte input') as HTMLInputElement | null)?.value.trim() ?? t(c.querySelector('strong')),
      genre: t(c.querySelector('.pill')),
      boutons: tous('button', c).map(t),
    }));

/** Ouvre l'écran Comptes depuis n'importe où, et rend ses cartes. */
async function comptes(): Promise<Carte[]> {
  expect(await ecran('Comptes'), 'l’écran Comptes est introuvable').toBe(true);
  return cartes();
}

/** Le texte du Plan. */
async function plan(): Promise<string> {
  await allerA('Plan');
  return t(document.querySelector('main'));
}

function unSeulPrincipal(cs: Carte[], ou: string): Carte {
  const principaux = cs.filter((c) => c.genre === 'principal');
  expect(principaux.length, `${ou} : ${principaux.length} carte(s) de compte principal, il en faut une et une seule (${cs.map((c) => `${c.nom} [${c.genre}]`).join(', ') || 'aucune carte'})`).toBe(1);
  return principaux[0]!;
}

function planSansAbsence(texte: string, ou: string): void {
  expect(/aucun compte principal/i.test(texte), `${ou} : le plan signale une absence de compte principal`).toBe(false);
}

/**
 * Les genres que proposent les choix de genre actifs de cet élément : les options qui valent un genre de compte
 * (`ACCOUNT_KINDS`), dans tout `select` actif qui en porte une.
 */
function genresProposes(e: Element): string[] {
  const genre = (o: HTMLOptionElement) => (ACCOUNT_KINDS as readonly string[]).includes(o.value);
  return tous<HTMLSelectElement>('select', e)
    .filter((s) => !s.disabled && [...s.options].some(genre))
    .flatMap((s) => [...s.options].filter(genre).map((o) => o.value));
}

describe('#421 · #209 — le compte principal à l’écran, sur une base vide, sans navigateur', () => {
  it('[niveau 1] #209 point 1 (table #421, compte-principal 1) — à l’ouverture, sans aucun geste, le Plan ne dit pas « aucun compte principal », et l’écran Comptes montre une carte au genre « principal », une seule', async () => {
    await ouvrirLApplication();
    planSansAbsence(await plan(), 'ouverture');
    unSeulPrincipal(await comptes(), 'ouverture');
  });

  it('[niveau 1] #209 point 5 (table #421, compte-principal 2) — la carte du compte principal n’offre aucun bouton qui le supprime ou le retire ; son panneau « Modifier » n’offre aucun autre genre ; le formulaire d’ajout d’un compte ne propose pas le genre « principal »', async () => {
    await ouvrirLApplication();
    const principal = unSeulPrincipal(await comptes(), 'écran Comptes');
    expect(principal.boutons.some((b) => /supprimer|retirer/i.test(b)), `la carte du compte principal propose : ${principal.boutons.join(', ')}`).toBe(false);
    expect(
      tous('[title]', principal.el).some((e) => /supprimer|retirer/i.test(e.getAttribute('title') ?? '')),
      'la carte du compte principal porte un bouton pour le retirer',
    ).toBe(false);

    // Sa carte ne lui offre aucun autre genre, ni son panneau « Modifier », s'il en a un.
    const surLaCarte = genresProposes(principal.el).filter((g) => g !== 'principal');
    expect(surLaCarte, `la carte du compte principal lui offre le genre : ${surLaCarte.join(', ')}`).toEqual([]);
    const modifier = tous<HTMLButtonElement>('button', principal.el).find((b) => t(b) === 'Modifier');
    if (modifier) {
      await presser(modifier);
      const panneau = document.querySelector('main form.edit.attached');
      expect(panneau, 'le panneau « Modifier » du compte principal ne s’ouvre pas').not.toBeNull();
      const autres = genresProposes(panneau!).filter((g) => g !== 'principal');
      expect(autres, `le compte principal peut passer à ${autres.join(', ')}`).toEqual([]);
      expect(await cliquer('Annuler')).toBe(true);
    }

    const ajout = tous('main form.edit').find((f) => tous('button', f).some((b) => t(b) === 'Ajouter un compte'));
    expect(ajout, 'l’écran Comptes ne propose plus d’ajouter un compte').toBeDefined();
    const type = tous<HTMLSelectElement>('select', ajout!);
    expect(type.length, 'le formulaire d’ajout d’un compte n’a pas de choix de genre').toBeGreaterThan(0);
    for (const s of type) {
      const proposes = [...s.options].map((o) => `${o.value} (${o.text})`);
      expect(
        [...s.options].some((o) => o.value === 'principal' || /principal/i.test(o.text)),
        `un nouveau compte peut être principal : ${proposes.join(', ')}`,
      ).toBe(false);
    }
  });

  it('[niveau 1] #209 point 4 (table #421, compte-principal 3) — l’assistant mené jusqu’au plan par ses seuls boutons primaires : le Plan ne dit pas « aucun compte principal », et l’écran Comptes montre une seule carte au genre « principal », au nom que l’exemple donne au compte principal', async () => {
    await ouvrirLApplication();
    unSeulPrincipal(await comptes(), 'avant l’assistant');
    await arriverAuxComptes();
    await validerTelQuel();
    expect(await cliquer('Voir le plan'), 'l’assistant validé ne mène pas au plan par son bouton primaire').toBe(true);
    expect(t(document.querySelector('.tabbar button.active')), 'l’assistant validé n’ouvre pas le Plan').toContain('Plan');
    planSansAbsence(t(document.querySelector('main')), 'après l’assistant');
    const apres = unSeulPrincipal(await comptes(), 'après l’assistant');
    // L'assistant renseigne le compte principal avec ce que l'exemple en dit (#211) : le même compte, qui prend le
    // nom de l'exemple ; aucun second compte principal n'apparaît.
    const dansLExemple = exampleLedger().accounts.find((a) => a.kind === 'principal')!;
    expect(apres.nom, 'l’assistant, parcouru sans rien saisir, ne renseigne pas le compte principal comme l’exemple le dit').toBe(dansLExemple.name);
  });

  it('[niveau 1] #209 point 1 (table #421, compte-principal 4) — sur l’exemple chargé, « Tout effacer », pressé dans Réglages : l’écran Comptes montre une seule carte au genre « principal », et le Plan ne dit pas « aucun compte principal »', async () => {
    await ouvrirLApplication();
    expect(await cliquer('Charger l\'exemple')).toBe(true);
    await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A'), 'l’exemple');
    expect(await ecran('Réglages'), 'l’écran Réglages est introuvable').toBe(true);
    expect(await cliquer('Tout effacer'), 'le bouton « Tout effacer » est introuvable').toBe(true);
    await attendre(() => !alive(app.ledger.accounts).some((a) => a.name === 'Livret A'), 'l’effacement');
    unSeulPrincipal(await comptes(), 'après « Tout effacer »');
    planSansAbsence(await plan(), 'après « Tout effacer »');
  });
});
