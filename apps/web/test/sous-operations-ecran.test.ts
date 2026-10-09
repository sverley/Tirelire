// @vitest-environment jsdom
/**
 * Tests du codeur de #420 : ce que vérifiait, dans le navigateur, le harnais d'audit de #297 côté écran (« Une
 * opération contient des sous-opérations, sur autant de niveaux qu'on veut »), que #420 retire, se vérifie ici sans
 * navigateur : l'application montée sous jsdom (`ecran.ts`). Chaque titre dit le point du « Fait quand » de #297
 * qu'il vérifie, et le numéro du test retiré dans la table de #420 (« sous-opérations 1 » à « sous-opérations 5 »).
 *
 * Ce qui se lit ici : ce que montrent le panneau de ventilation de l'écran Opérations et sa liste, ce que la Saisie
 * manuelle enregistre, et le projet que l'application a enregistré, relu dans le dépôt. Les parcours partent de
 * l'exemple chargé (« Fournitures scolaires », −146 €, une seule part « montant fixe » : catégorie « Enfants »,
 * tirelire « Enfants et loisirs »), parfois divisé à la main en deux moitiés de −73 € : l'une classée
 * « Alimentation », l'autre sans catégorie ni tirelire, qui prend celles du niveau au-dessus. Le calcul, la
 * conservation et la synchronisation : `packages/core/test/sous-operations-harnais.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { alive, liveSubOperations, type SubOperation } from '@tirelire/core';
import { allerA, app, attendre, cliquer, ecran, ouvrirLApplication, presser, projet, rendu, saisir as saisirChamp, t, tous } from './ecran';

const OPERATION = 'Fournitures scolaires';

/** Ouvre l'application et charge l'exemple, comme le bouton de l'accueil. */
async function ouvrirLExemple(): Promise<void> {
  await ouvrirLApplication();
  expect(await cliquer('Charger l\'exemple')).toBe(true);
  await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A'), 'l’exemple');
  await rendu();
}

/** Le panneau de ventilation ouvert, lu en une chaîne. */
const panneau = () => t(document.querySelector('form.edit'));
/** Les lignes du panneau ouvert (la dernière grille est celle de la nouvelle catégorie). */
const grilles = () => tous('form.edit .grid');

/** Ce que dit la ligne `i` du panneau : ses deux choix « vides » (ce qu'elle prend du niveau au-dessus) et son montant. */
function ligne(i: number) {
  const g = grilles()[i];
  const choix = (debut: string) => (g ? tous('label', g).find((x) => t(x).startsWith(debut))?.querySelector('select') : null) as HTMLSelectElement | null | undefined;
  return { categorie: t(choix('Catégorie')?.options[0]), tirelire: t(choix('Tirelire')?.options[0]), soit: t(g?.querySelector('.sub')) };
}

/** Ce que la ligne `i` du panneau a de choisi : sa part, sa catégorie, sa tirelire. */
function choixDeLaLigne(i: number) {
  const g = grilles()[i];
  const choisi = (debut: string) => t(((g ? tous('label', g).find((x) => t(x).startsWith(debut))?.querySelector('select') : null) as HTMLSelectElement | null | undefined)?.selectedOptions[0]);
  return { part: choisi('Part'), categorie: choisi('Catégorie'), tirelire: choisi('Tirelire') };
}

/** La ligne d'une opération de l'écran Opérations, par son libellé. */
const ligneDeLOperation = (libelle: string) =>
  tous('main .card .row')
    .filter((x) => x.querySelector(':scope > label.cocher'))
    .find((x) => t(x.querySelector(':scope > button.label strong')) === libelle);

/** Ce que l'écran Opérations affiche sous le libellé d'une opération : ses lignes comptées, avec leur montant. */
const resume = (libelle: string) => t(ligneDeLOperation(libelle)?.querySelector(':scope > button.label .sub'));

/** L'écran Opérations, sur toutes les opérations : celle de l'exemple est verrouillée. */
async function afficherToutes(): Promise<void> {
  await allerA('Opérations');
  const s = tous<HTMLSelectElement>('main select').find((x) => [...x.options].some((o) => t(o) === 'Non traitées'));
  if (!s) throw new Error('le filtre « Toutes » est introuvable sur l’écran Opérations');
  await saisirChamp(s, [...s.options].find((o) => t(o) === 'Toutes')!.value);
}

async function ouvrirLaLigne(libelle: string): Promise<void> {
  const b = ligneDeLOperation(libelle)?.querySelector(':scope > button.label') as HTMLButtonElement | null | undefined;
  if (!b) throw new Error(`opération « ${libelle} » introuvable`);
  await presser(b);
}

/** Clique le `n`-ième bouton du panneau ouvert dont le texte est exactement `texte`. */
async function bouton(texte: string, n = 0): Promise<void> {
  const b = tous<HTMLButtonElement>('form.edit button').filter((x) => t(x) === texte)[n];
  if (!b) throw new Error(`bouton « ${texte} » (n° ${n}) introuvable dans le panneau : ${panneau()}`);
  await presser(b);
}

/** Choisit `texte` dans la liste de la ligne `i` dont l'étiquette commence par `debut`. */
async function choisir(i: number, debut: string, texte: string): Promise<void> {
  const g = grilles()[i];
  const s = (g ? tous('label', g).find((x) => t(x).startsWith(debut))?.querySelector('select') : null) as HTMLSelectElement | null | undefined;
  const o = s && [...s.options].find((x) => t(x) === texte);
  if (!s || !o) throw new Error(`« ${debut} » : choix « ${texte} » introuvable sur la ligne ${i}`);
  await saisirChamp(s, o.value);
}

/** Saisit la valeur (pourcentage ou montant) de la ligne `i`. */
async function saisir(i: number, valeur: string): Promise<void> {
  const champ = grilles()[i]?.querySelector('input') as HTMLInputElement | null;
  if (!champ) throw new Error(`pas de champ de valeur sur la ligne ${i}`);
  await saisirChamp(champ, valeur);
}

/** Modifie dans la Saisie manuelle l'opération `libelle`, son montant ou son libellé, et enregistre. */
async function saisieModifier(libelle: string, changements: { montant?: string; libelle?: string }): Promise<void> {
  expect(await ecran('Saisie manuelle')).toBe(true);
  const r = tous('main .card .row').find((x) => t(x.querySelector('.label strong')) === libelle);
  const modifier = r && tous<HTMLButtonElement>('button', r).find((b) => t(b) === 'Modifier');
  if (!modifier) throw new Error(`la saisie de « ${libelle} » ne s’ouvre pas`);
  await presser(modifier);
  const f = document.querySelector('form.edit')!;
  const champ = (debut: string) => tous('label', f).find((x) => t(x).startsWith(debut))?.querySelector('input') as HTMLInputElement | null | undefined;
  for (const [debut, valeur] of [['Libellé', changements.libelle], ['Montant', changements.montant]] as const) {
    if (valeur === undefined) continue;
    const i = champ(debut);
    if (!i) throw new Error(`champ « ${debut} » introuvable dans la saisie`);
    await saisirChamp(i, valeur);
  }
  await presser(tous<HTMLButtonElement>('button', f).find((b) => t(b) === 'Enregistrer')!);
}

/**
 * Le point de départ des parcours : la part de l'exemple divisée à la main en 50 % « Alimentation » et le reste,
 * enregistrée. Rend ce que disait le panneau du niveau à son ouverture, avant qu'on y écrive.
 */
async function diviserEnDeux(): Promise<string> {
  await afficherToutes();
  await ouvrirLaLigne(OPERATION);
  await bouton('Diviser');
  const ouverture = panneau();
  await choisir(0, 'Part', 'Pourcentage');
  await saisir(0, '50');
  await choisir(0, 'Catégorie', 'Alimentation');
  await bouton('Ajouter une ligne');
  await bouton('Enregistrer');
  return ouverture;
}

/** L'opération de l'exemple, telle que le projet enregistré la garde, et ses sous-opérations vivantes. */
function enregistree(libelle = OPERATION) {
  const p = projet();
  const op = alive(p.operations).find((o) => o.label === libelle);
  const subs = op ? liveSubOperations(p.subOperations).filter((s) => s.operationId === op.id) : [];
  return { op, subs };
}
/** Une sous-opération sans ce qui ne la décrit pas (l'horodatage de synchronisation, s'il y en a). */
const contenu = (s: SubOperation) => ({ id: s.id, parentId: s.parentId, categoryId: s.categoryId, tirelireId: s.tirelireId, share: s.share, replenishment: s.replenishment, date: s.date });
const parId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1);
const nomDeCategorie = (id?: string) => projet().categories.find((c) => c.id === id)?.name;

describe('#420 · #297 points 6 et 11 — les sous-opérations à l’écran, sur l’exemple, sans navigateur', () => {
  it('[niveau 4] #297 point 6 (table #420, sous-opérations 1) — on divise une part à tout niveau, et on la lit avec son montant et ce qui vaut pour elle', async () => {
    await ouvrirLExemple();
    const ouverture = await diviserEnDeux();
    // Le niveau qu'on ouvre dit son montant et ce que prendra une ligne qui ne règle rien.
    expect(ouverture).toContain('Opération › −146,00 € · Enfants · Enfants et loisirs');
    expect(ouverture).toContain('Vous divisez cette part de −146,00 €');
    expect(ouverture).toContain('prend Enfants et Enfants et loisirs');

    // Enregistrée, la division se relit : chaque part a son montant, et la seconde, qui ne règle rien, montre ce qu'elle prend.
    expect(ligne(0).soit).toBe('soit −73,00 €');
    expect(ligne(1)).toEqual({ categorie: '— (Enfants)', tirelire: '— (Enfants et loisirs)', soit: 'soit −73,00 €' });
    // La liste des opérations la lit à ses feuilles : chaque part avec ses étiquettes (celles du niveau pour la seconde) et son montant.
    const lignes = resume(OPERATION);
    expect(lignes).toMatch(/Alimentation[^+]*−73,00 €/);
    expect(lignes).toContain('Enfants / Enfants et loisirs / −73,00 €');
    // Le projet enregistré : deux moitiés sous la part de l'opération.
    const { subs } = enregistree();
    const haut = subs.filter((s) => !s.parentId);
    expect(haut).toHaveLength(1);
    expect(subs.filter((s) => s.parentId === haut[0]!.id)).toHaveLength(2);

    // Et on la divise encore, un niveau plus bas, sans limite : le niveau dit tout ce qui le contient.
    await bouton('Diviser', 1);
    const troisieme = panneau();
    expect(troisieme).toContain('Opération › −146,00 € · Enfants · Enfants et loisirs › −73,00 €');
    expect(troisieme).toContain('Vous divisez cette part de −73,00 €');
  });

  it('[niveau 4] #297 point 6 (table #420, sous-opérations 2) — modifier un niveau, l’opération ou sa saisie garde ce que contiennent les autres niveaux', async () => {
    await ouvrirLExemple();
    await diviserEnDeux();
    const { op, subs: apresDivision } = enregistree();
    const part = apresDivision.find((s) => !s.parentId)!;
    const moitiesAvant = apresDivision.filter((s) => s.parentId === part.id).map(contenu).sort(parId);
    expect(moitiesAvant).toHaveLength(2);

    // Au premier niveau, on change la catégorie de la part divisée : ses deux moitiés restent, et celle qui ne règle rien prend la nouvelle.
    await bouton('Remonter d’un niveau');
    expect(ligne(0).soit).toContain('divisée en 2');
    await choisir(0, 'Catégorie', 'Santé');
    await bouton('Enregistrer');
    let apres = enregistree();
    expect(nomDeCategorie(apres.subs.find((s) => s.id === part.id)?.categoryId), 'la catégorie de la part n’est pas enregistrée').toBe('Santé');
    expect(apres.subs.filter((s) => s.parentId === part.id).map(contenu).sort(parId), 'changer le niveau au-dessus a changé le niveau en dessous').toEqual(moitiesAvant);
    const apresNiveau = resume(OPERATION);
    expect(apresNiveau).toMatch(/Alimentation[^+]*−73,00 €/);
    expect(apresNiveau).toContain('Santé / Enfants et loisirs / −73,00 €');

    // La saisie ne règle qu'une catégorie et une tirelire : elle garde la division, à tous ses niveaux.
    const partAvantSaisie = contenu(apres.subs.find((s) => s.id === part.id)!);
    await saisieModifier(OPERATION, { libelle: `${OPERATION} (rentrée)` });
    apres = enregistree(`${OPERATION} (rentrée)`);
    expect(apres.op?.id, 'la Saisie n’a pas enregistré le libellé').toBe(op!.id);
    expect(apres.subs.filter((s) => s.parentId === part.id).map(contenu).sort(parId), 'la Saisie a changé le niveau en dessous').toEqual(moitiesAvant);
    // La part qui contient la division reste la même — son identifiant, sa catégorie, sa tirelire ; seule sa part
    // devient « le reste », comme la Saisie le fait d'une opération à une seule part (point 11).
    const { share: _avant, ...partSansMontant } = partAvantSaisie;
    const { share: partApres, ...resteApres } = contenu(apres.subs.find((s) => s.id === part.id) ?? ({} as SubOperation));
    expect(resteApres, 'la Saisie a changé la part divisée').toEqual(partSansMontant);
    expect(partApres).toEqual({ kind: 'variable' });
    expect(apres.subs, 'la Saisie a ajouté ou retiré une sous-opération').toHaveLength(3);

    await afficherToutes();
    const apresSaisie = resume(`${OPERATION} (rentrée)`);
    expect(apresSaisie).toMatch(/Alimentation[^+]*−73,00 €/);
    expect(apresSaisie).toContain('Santé / Enfants et loisirs / −73,00 €');
  });

  it('[niveau 4] #297 point 11 (table #420, sous-opérations 3) — changer dans la Saisie le montant d’une opération qui n’a qu’une part remet cette part à « le reste »', async () => {
    await ouvrirLExemple();
    // L'exemple : une seule part « montant fixe » de −146 €. Portée à 200 €, elle vaut 200 €, et rien ne tombe dans le non affecté.
    await saisieModifier(OPERATION, { montant: '200,00' });
    const { subs } = enregistree();
    expect(subs.map((s) => s.share), 'la seule part n’est pas « le reste »').toEqual([{ kind: 'variable' }]);
    await afficherToutes();
    await ouvrirLaLigne(OPERATION);
    expect(choixDeLaLigne(0)).toEqual({ part: 'Le reste', categorie: 'Enfants', tirelire: 'Enfants et loisirs' });
    expect(ligne(0).soit).toBe('soit −200,00 €');
    expect(panneau()).not.toMatch(/non affecté\s*:/);
  });

  it('[niveau 4] #297 point 11 (table #420, sous-opérations 4) — … sans toucher à ce que contient cette part : ses moitiés suivent le nouveau montant', async () => {
    await ouvrirLExemple();
    await diviserEnDeux();
    await saisieModifier(OPERATION, { montant: '200,00' });
    await afficherToutes();
    const lignes = resume(OPERATION);
    expect(lignes).toMatch(/Alimentation[^+]*−100,00 €/);
    expect(lignes).toContain('Enfants / Enfants et loisirs / −100,00 €');
  });

  it('[niveau 4] #297 point 11 (table #420, sous-opérations 5) — une opération divisée en plusieurs parts reste telle qu’elle est quand la Saisie en change le montant', async () => {
    await ouvrirLExemple();
    // L'exemple, divisé au premier niveau en deux parts : −100 € « montant fixe », et le reste.
    await afficherToutes();
    await ouvrirLaLigne(OPERATION);
    await saisir(0, '-100,00');
    await bouton('Ajouter une ligne');
    await bouton('Enregistrer');
    const avant = enregistree().subs.map(contenu).sort(parId);
    expect(avant.map((s) => s.share)).toEqual(expect.arrayContaining([{ kind: 'fixed', amount: -10000 }, { kind: 'variable' }]));
    expect(avant).toHaveLength(2);

    await saisieModifier(OPERATION, { montant: '200,00' });
    const apres = enregistree();
    expect(apres.op?.amount, 'la Saisie n’a pas enregistré le montant').toBe(-20000);
    expect(apres.subs.map(contenu).sort(parId), 'la Saisie a changé les parts d’une opération divisée').toEqual(avant);

    await afficherToutes();
    await ouvrirLaLigne(OPERATION);
    // La part fixe reste à −100 € ; seul le reste suit le montant.
    expect(choixDeLaLigne(0).part).toBe('Montant fixe');
    expect(ligne(0).soit).toBe('soit −100,00 €');
    expect(choixDeLaLigne(1).part).toBe('Le reste');
    expect(ligne(1).soit).toBe('soit −100,00 €');
    expect(grilles().length - 1).toBe(2);
  });
});
