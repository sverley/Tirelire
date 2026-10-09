// @vitest-environment jsdom
/**
 * Tests du codeur de #418 : ce que vérifiait le harnais navigateur d'audit de #344 (« Dans l'assistant, ajouter un
 * besoin à une tirelire de l'étape Budgets »), que #418 retire, sans navigateur :
 * l'application montée sous jsdom (`ecran.ts`), au jour des tests, projet vierge, tirelire « Enfants et loisirs ».
 * Chaque titre dit le point du « Fait quand » de #344 qu'il vérifie, et le numéro du test retiré dans la table de
 * #418 (« ajout 1 » à « ajout 7 »).
 *
 * « L'étape se franchit par son seul bouton primaire » (I4) reste au harnais du registre,
 * `navigateur/assistant-simple.test.ts` ; ici, les boutons primaires de l'étape sont lus, ce qui rougit si le
 * bouton d'ajout d'un besoin devient primaire. Le point 7 de #344 (D40) se relit, sans test.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { alive, euros } from '@tirelire/core';
import { arriverAuxComptes, centimes, cliquer, ecran, etape, lire, ouvrirLApplication, presser, projet, saisir, t, tous, validerTelQuel, allerA } from './ecran';

const TIRELIRE = 'Enfants et loisirs';

/** La carte d'une tirelire de l'étape, par le nom de son champ. */
const carte = (nom: string) => tous('main .card.tirelire').find((c) => (c.querySelector('input.nom') as HTMLInputElement).value === nom);

/** Les lignes de besoin d'une carte : nom propre, montant, détail de validité. */
const lignes = (nom: string) => {
  const c = carte(nom);
  return c
    ? tous('.ligne', c).map((l) => ({
        nom: (l.querySelector('input.besoin') as HTMLInputElement | null)?.value ?? '',
        montant: (l.querySelector('input.mt') as HTMLInputElement).value,
        suite: t(l.querySelector('.suite')),
      }))
    : null;
};

/** Remplit le formulaire d'ajout d'un besoin de la carte, comme à la saisie, puis l'envoie par son bouton. */
async function ajouter(tirelire: string, nom: string, montant: string) {
  const f = carte(tirelire)?.querySelector('form.ajout-besoin');
  expect(f, `la carte « ${tirelire} » n’offre pas d’ajouter un besoin`).toBeTruthy();
  await saisir(f!.querySelector('.besoin-nom') as HTMLInputElement, nom);
  await saisir(f!.querySelector('.mt') as HTMLInputElement, montant);
  await presser(f!.querySelector('button[type=submit]') as HTMLButtonElement);
}

const erreur = (tirelire: string) => t(carte(tirelire)?.querySelector('form.ajout-besoin .err'));

/** Retire d'un clic la ligne de besoin qui porte ce nom propre. */
async function retirer(nom: string) {
  const l = tous('main .card.tirelire .ligne').find((x) => (x.querySelector('input.besoin') as HTMLInputElement | null)?.value === nom);
  expect(l, `pas de ligne « ${nom} »`).toBeTruthy();
  await presser(l!.querySelector('button.danger') as HTMLButtonElement);
}

/** Le « À mettre de côté » du bandeau de l'assistant, en centimes. */
const deCote = () => centimes(t(tous('main .stat').find((s) => t(s.querySelector('.k')) === 'À mettre de côté')?.querySelector('.v')));

describe('#418 · #344 — l’étape Budgets d’un projet vierge, sans navigateur', () => {
  beforeAll(async () => {
    await ouvrirLApplication();
    await arriverAuxComptes();
    expect(await etape('Budgets')).toBe(true);
  });

  it('[niveau 4] #344 point 1 (table #418, ajout 1) — chaque carte de tirelire offre d’ajouter un besoin, qui s’ajoute comme ligne de plus, nommée, et se corrige et se retire sur place', async () => {
    const cartes = tous('main .card.tirelire');
    expect(cartes.length).toBeGreaterThanOrEqual(2);
    expect(cartes.filter((c) => tous('form.ajout-besoin', c).length !== 1).map((c) => (c.querySelector('input.nom') as HTMLInputElement).value), 'cartes sans exactement un formulaire d’ajout').toEqual([]);

    const avant = lignes(TIRELIRE)!;
    expect(avant).toHaveLength(2); // son besoin et « Cours de piano » (#336)
    await ajouter(TIRELIRE, 'Solfège', '20');
    const apres = lignes(TIRELIRE)!;
    expect(apres).toHaveLength(3);
    expect(apres[2]).toMatchObject({ nom: 'Solfège', montant: '20,00' });
    expect(erreur(TIRELIRE)).toBe('');

    // Il se corrige sur place, comme les autres.
    const montant = tous<HTMLInputElement>('main .card.tirelire .ligne input.mt').find((i) => (i.closest('.ligne')!.querySelector('input.besoin') as HTMLInputElement | null)?.value === 'Solfège')!;
    await saisir(montant, '25');
    expect(lignes(TIRELIRE)!.find((l) => l.nom === 'Solfège')?.montant).toBe('25,00');
    // Il se retire sur place ; les autres lignes de la carte restent.
    await retirer('Solfège');
    expect(lignes(TIRELIRE)!.map((l) => l.nom)).toEqual(avant.map((l) => l.nom));
  });

  it('[niveau 4] #344 point 2 (table #418, ajout 2) — sans nom, ou sans montant positif, l’étape refuse en le disant et n’ajoute rien', async () => {
    const avant = lignes(TIRELIRE)!;
    for (const [nom, montant] of [
      ['', '30'],
      ['   ', '30'],
      ['Péage', ''],
      ['Péage', '0'],
      ['Péage', '-5'],
      ['Péage', 'abc'],
    ] as const) {
      await ajouter(TIRELIRE, nom, montant);
      expect(erreur(TIRELIRE), `« ${nom} » · « ${montant} » : pas de message`).not.toBe('');
      expect(lignes(TIRELIRE), `« ${nom} » · « ${montant} » a ajouté une ligne`).toEqual(avant);
    }
    // Un ajout valide efface le message.
    await ajouter(TIRELIRE, 'Péage', '30');
    expect(erreur(TIRELIRE)).toBe('');
    await retirer('Péage');
    expect(lignes(TIRELIRE)).toEqual(avant);
  });

  it('[niveau 4] #344 point 3 (table #418, ajout 3) — le bandeau de l’assistant compte aussitôt le besoin ajouté, de son montant par période', async () => {
    const avant = deCote();
    await ajouter(TIRELIRE, 'Péage', '30');
    expect(deCote() - avant).toBe(3000);
    await retirer('Péage');
    expect(deCote()).toBe(avant);
  });

  it('[niveau 4] #344 point 5 (table #418, ajout 4) — sur la carte « Essence », la ligne d’aide est « Cours de piano », 45,00 ; la recopier ajoute le besoin de l’exemple, date de début comprise ; à 50, sans date', async () => {
    const f = carte('Essence')!.querySelector('form.ajout-besoin')!;
    expect([(f.querySelector('.besoin-nom') as HTMLInputElement).placeholder, (f.querySelector('.mt') as HTMLInputElement).placeholder]).toEqual(['Cours de piano', '45,00']);

    await ajouter('Essence', 'Cours de piano', '45,00');
    const vu = lignes('Essence')!;
    expect(vu).toHaveLength(2);
    expect(vu[1]!.nom).toBe('Cours de piano');
    expect(vu[1]!.suite).toMatch(/à partir du 28 oct\S* 2026/);
    // Un autre montant ne porte pas cette date : sans date, en vigueur depuis toujours (D50).
    await ajouter('Essence', 'Cours de piano', '50');
    expect(lignes('Essence')![2]).toMatchObject({ nom: 'Cours de piano', montant: '50,00', suite: '' });
  });

  it('[niveau 4] #344 point 4, I4 (table #418, ajout 5) — le bouton d’ajout n’est pas primaire : les boutons primaires de l’étape sont « Ajouter » et « Suivant › », et un ajout réussi vide ses formulaires', async () => {
    expect(tous('main .btn.primary').map(t), 'les boutons primaires de l’étape').toEqual(['Ajouter', 'Suivant ›']);
    expect(tous<HTMLInputElement>('main form.ajout-besoin input').every((i) => i.value === ''), 'un ajout réussi laisse son formulaire rempli').toBe(true);
    const titre = lire().h2;
    expect(await cliquer('Suivant')).toBe(true);
    expect(lire().h2).not.toBe(titre);
  });
});

describe('#418 · #344 — après la validation, sans navigateur', () => {
  beforeAll(async () => {
    await ouvrirLApplication();
    await arriverAuxComptes();
    expect(await etape('Budgets')).toBe(true);
    await ajouter(TIRELIRE, 'Solfège', '20');
    await validerTelQuel();
  });

  /** La ligne du besoin « Solfège » de la carte « Enfants et loisirs » de l'écran Tirelires : son nom, son montant, son texte. */
  async function ligneDansTirelires() {
    expect(await ecran('Tirelires')).toBe(true);
    const c = carte(TIRELIRE);
    const l = c ? tous('.ligne', c).find((x) => ((x.querySelector('input.besoin') as HTMLInputElement | null)?.value ?? '') === 'Solfège') : undefined;
    return { carte: !!c, ligne: l ? `${(l.querySelector('input.besoin') as HTMLInputElement).value} ${(l.querySelector('input.mt') as HTMLInputElement).value} ${t(l)}`.trim() : '', el: l };
  }

  it('[niveau 4] #344 point 3, D06, D50 (table #418, ajout 6) — validé, « Solfège » est un besoin d’« Enfants et loisirs », sans date, à la priorité 20, et le Plan le dote, 20,00 en croisière, à côté du besoin de la tirelire, 200,00', async () => {
    const p = projet();
    const enfants = alive(p.tirelires).find((x) => x.name === TIRELIRE)!;
    const solfege = alive(p.needs).find((n) => n.name === 'Solfège');
    expect(solfege, 'le besoin ajouté n’est pas enregistré').toBeDefined();
    expect(solfege).toMatchObject({ tirelireId: enfants.id, kind: 'recurring', amount: euros(20), priority: 20 });
    expect(solfege!.activeFrom, 'le besoin ajouté porte une date de début').toBeUndefined();
    expect(solfege!.activeTo, 'le besoin ajouté porte une date de fin').toBeUndefined();

    const { carte: vue, ligne } = await ligneDansTirelires();
    expect(vue, 'pas de carte « Enfants et loisirs » dans Tirelires').toBe(true);
    expect(ligne).toMatch(/priorité 20\b/);
    expect(ligne, 'le besoin ajouté porte une date de validité').not.toMatch(/à partir du|jusqu|du \d|au \d/);

    await allerA('Plan');
    const plan = t(document.querySelector('main'));
    expect(plan, 'le Plan ne dote pas le besoin ajouté').toMatch(/Solfège ?dans Enfants et loisirs[^]*?croisière 20,00/);
    expect(plan, 'le Plan ne dote plus le besoin de la tirelire').toMatch(/Enfants et loisirs non financé[^]*?croisière 200,00/);
  });

  it('[niveau 4] #344 point 6, I11 (table #418, ajout 7) — dans Tirelires, la ligne « Solfège » a son « Modifier » ; son montant passé à 25 s’enregistre, et la ligne le dit', async () => {
    const { el } = await ligneDansTirelires();
    expect(el, 'le besoin ajouté ne se retrouve pas dans Tirelires').toBeTruthy();
    const modifier = tous<HTMLButtonElement>('button', el!).find((b) => t(b) === 'Modifier');
    expect(modifier, 'pas de bouton « Modifier » sur le besoin ajouté').toBeTruthy();
    await presser(modifier!);
    const f = tous<HTMLFormElement>('main form').find((x) => t(x).includes('Enregistrer'))!;
    const montant = tous<HTMLInputElement>('input', f).find((i) => i.value === '20,00' || i.value === '20');
    expect(montant, 'champ du montant introuvable').toBeTruthy();
    await saisir(montant!, '25');
    await presser(f.querySelector('button[type=submit]') as HTMLButtonElement);
    expect(alive(projet().needs).find((n) => n.name === 'Solfège')?.amount).toBe(euros(25));
    expect((await ligneDansTirelires()).ligne).toMatch(/^Solfège 25,00/);
  });
});
