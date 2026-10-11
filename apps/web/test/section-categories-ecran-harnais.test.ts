// @vitest-environment jsdom
/**
 * Harnais d'audit de #365 — « La section Catégories sert à l'assistant et à l'écran Catégories » : l'écran
 * Catégories et l'assistant ouvert sur la section, sur l'application montée sans navigateur (`ecran.ts`), au
 * jour des tests. Ce qui se lit ici est ce que l'écran montre et ce que le projet enregistré porte. Chaque
 * titre dit le point du « Fait quand » qu'il tranche, et son niveau (D83).
 *
 * Les tests sont ceux du codeur (`section-categories-ecran.test.ts`, d'où ils sont déplacés en entier). Est de
 * moi, au point 3, « les opérations déjà classées gardent leur ventilation » : le codeur ne lisait que la
 * confirmation qui le dit. Niveau 0 : une suppression qui ôterait la catégorie des opérations, ou une
 * validation qui écrirait hors de la section (point 7), altérerait des données que le code corrigé ne
 * rendrait pas ; vus rouges sur des mutations du code de la PR, dites dans la vérification de la PR. Niveau 1 :
 * I5 et I3 sur une base vide (point 5). Niveau 2 : les règles de D32, D46, D59, D61, D94 (points 3 à 5).
 * Niveau 3 : l'explication repliée (point 6). Que l'étape de l'assistant complet reste ce qu'elle est
 * (point 2) se tranche par les tests qu'il nomme ; que la section soit écrite une fois (point 1), par
 * `section-categories-harnais.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, MAIN_ACCOUNT_ID, alive, euros, type Category } from '@tirelire/core';
import { app, champ, cliquer, cliquerExactement, ecran, ouvrirLApplication, presser, projet, rendu, rouvrirLApplication, saisir, t, tous } from './ecran';

const DIX = ['Abonnements', 'Alimentation', 'Allocations', 'Assurances', 'Enfants', 'Logement', 'Loyer perçu', 'Salaire', 'Santé', 'Virement interne'];

async function ouvrir(): Promise<void> {
  expect(await ecran('Catégories'), 'l’écran Catégories est introuvable').toBe(true);
  expect(t(document.querySelector('main h1'))).toBe('Catégories');
}
/** Les lignes de l'écran : nature, nom, retrait, ce qu'elles disent. */
function lignes(): Array<{ nature: string; nom: string; sous: boolean; detail: string }> {
  const sortie: Array<{ nature: string; nom: string; sous: boolean; detail: string }> = [];
  let nature = '';
  for (const e of tous('main h2, main .ligne-categorie')) {
    if (e.tagName === 'H2') nature = t(e);
    else sortie.push({ nature, nom: (e.querySelector('input.nom') as HTMLInputElement).value, sous: e.classList.contains('sous'), detail: t(e.querySelector('.suite')) });
  }
  return sortie;
}
const raccourcis = () => tous('main .propositions .prop .n').map((n) => t(n).replace(/^\+\s*/, ''));
const erreurs = () => tous('main .err').map(t);
const enregistrees = (): Category[] => alive(projet().categories);
const ligneDe = (nom: string) => tous('main .ligne-categorie').find((l) => (l.querySelector('input.nom') as HTMLInputElement).value === nom);
async function renommer(nom: string, nouveau: string) {
  const i = ligneDe(nom)?.querySelector('input.nom') as HTMLInputElement | undefined;
  expect(i, `pas de ligne « ${nom} »`).toBeTruthy();
  await saisir(i!, nouveau);
}
async function geste(nom: string, libelle: string) {
  const b = tous<HTMLButtonElement>('button', ligneDe(nom)).find((x) => t(x) === libelle);
  expect(b, `« ${nom} » : pas de « ${libelle} »`).toBeTruthy();
  await presser(b!);
}
async function completerAvecLAssistant() {
  const a = tous<HTMLAnchorElement>('main a').find((x) => t(x) === 'Compléter avec l’assistant');
  expect(a, 'pas de « Compléter avec l’assistant »').toBeTruthy();
  await presser(a!);
}

describe('[niveau 1] #365 · 5, I5 — sur une base vide, l’écran porte les raccourcis, et rien n’est créé d’office', () => {
  it('aucune catégorie à l’écran ni dans le projet ; les dix raccourcis sous « Ajouter en un geste » ; l’assistant est offert', async () => {
    await ouvrirLApplication();
    await ouvrir();
    expect(lignes()).toEqual([]);
    expect(enregistrees()).toEqual([]);
    expect(raccourcis().sort()).toEqual(DIX);
    expect(tous('main a').map(t)).toContain('Compléter avec l’assistant');
  });

  it('un raccourci crée la catégorie dans le projet, sans tirelire par défaut quand aucune tirelire n’a son nom, et disparaît', async () => {
    expect(await cliquer('+ Alimentation')).toBe(true);
    expect(enregistrees().map((c) => [c.name, c.tirelireId])).toEqual([['Alimentation', undefined]]);
    expect(raccourcis()).not.toContain('Alimentation');
    await rouvrirLApplication();
    await ouvrir();
    expect(lignes().map((l) => l.nom)).toEqual(['Alimentation']);
    expect(raccourcis()).not.toContain('Alimentation');
  });
});

describe('[niveau 2] #365 · 3 à 6 — l’écran Catégories emploie la section, sur l’exemple', () => {
  async function ouvrirLExemple() {
    await ouvrirLApplication();
    expect(await cliquer('Charger l\'exemple')).toBe(true);
    for (let i = 0; i < 200 && !alive(app.ledger.accounts).some((a) => a.name === 'Livret A'); i++) await rendu(), await new Promise((f) => setTimeout(f, 10));
    await ouvrir();
  }

  it('point 3 — chaque ligne dit sa tirelire par défaut et les flux qui la portent, comme dans l’assistant', async () => {
    await ouvrirLExemple();
    const l = lignes();
    expect(l.find((x) => x.nom === 'Alimentation')?.detail).toContain('Tirelire par défaut : Alimentation');
    expect(l.find((x) => x.nom === 'Logement')?.detail).toMatch(/Flux : .*Crédit immobilier/);
    expect(l.find((x) => x.nom === 'Salaire' && x.nature === 'Revenus')?.detail).toContain('Flux : Salaire');
  });

  it('point 3 — le nom se corrige sur place et s’écrit aussitôt ; un doublon est refusé, dit, et le champ reprend son nom', async () => {
    await renommer('Santé', 'Soins');
    expect(enregistrees().map((c) => c.name)).toContain('Soins');
    expect(erreurs()).toEqual([]);
    await renommer('Enfants', ' logement ');
    expect(erreurs()).toEqual(['Une catégorie « Logement » existe déjà pour cette nature.']);
    expect((ligneDe('Enfants')?.querySelector('input.nom') as HTMLInputElement).value).toBe('Enfants');
    expect(enregistrees().filter((c) => c.name === 'Enfants')).toHaveLength(1);
  });

  it('point 3 — supprimer retire la catégorie des flux qui la portent ; la confirmation dit que les opérations gardent leur ventilation', async () => {
    let question = '';
    const avant = window.confirm;
    window.confirm = (m?: string) => ((question = m ?? ''), true);
    try {
      await geste('Logement', 'Supprimer');
    } finally {
      window.confirm = avant;
    }
    expect(question).toMatch(/flux/);
    expect(question).toMatch(/opérations déjà classées .* gardent leur ventilation/);
    expect(enregistrees().map((c) => c.name)).not.toContain('Logement');
    const credit = alive(projet().plannedFlows).filter((f) => f.name === 'Crédit immobilier');
    expect(credit.length).toBeGreaterThan(0);
    for (const f of credit) expect(f.action?.categoryId).toBeUndefined();
    expect(raccourcis()).toContain('Logement');
  });

  it('point 4 — « Modifier » ouvre le panneau nommé : nature, catégorie parente, « Tirelire par défaut (facultatif) » ; le nom n’y est pas, il se corrige sur la ligne', async () => {
    await geste('Alimentation', 'Modifier');
    const f = document.querySelector('main form.edit.attached');
    expect(t(f?.querySelector('.titre-panneau'))).toBe('Modifier la catégorie — Alimentation');
    const libelles = tous('label.f', f!).map((l) => t(l));
    expect(libelles.some((x) => x.startsWith('Nature'))).toBe(true);
    expect(libelles.some((x) => x.startsWith('Catégorie parente (facultatif)'))).toBe(true);
    expect(libelles.some((x) => x.startsWith('Tirelire par défaut (facultatif)'))).toBe(true);
    expect(t(f).includes('Budget consommé')).toBe(false);
    expect(await cliquer('Annuler')).toBe(true);
  });

  it('point 4 — rangement par ordre alphabétique, une sous-catégorie en retrait sous sa parente', async () => {
    await geste('Abonnements', 'Modifier');
    await saisir(champ('Catégorie parente').el, enregistrees().find((c) => c.name === 'Soins')!.id);
    expect(await cliquerExactement('Enregistrer')).toBe(true);
    const depenses = lignes().filter((l) => l.nature === 'Dépenses');
    const i = depenses.findIndex((l) => l.nom === 'Soins');
    expect(depenses[i + 1]).toMatchObject({ nom: 'Abonnements', sous: true });
    const racines = depenses.filter((l) => !l.sous).map((l) => l.nom);
    expect(racines).toEqual([...racines].sort((a, b) => a.localeCompare(b, 'fr')));
    // Une catégorie qui en porte une autre ne se retire pas, et la ligne le dit.
    await geste('Soins', 'Supprimer');
    expect(erreurs()[0]).toMatch(/« Soins » a 1 sous-catégorie/);
    expect(enregistrees().map((c) => c.name)).toContain('Soins');
  });

  it('point 4 — chaque bouton ouvre, sous lui, le formulaire de la section, intitulé et à sa nature, avec les champs avancés et l’aide de sa nature', async () => {
    expect(await cliquer('Ajouter une catégorie de revenus')).toBe(true);
    const f = document.querySelector('main form.edit') as HTMLFormElement;
    expect(t(f.querySelector('.titre-panneau'))).toBe('Ajouter une catégorie de revenu');
    expect(champ('Nature').valeur).toBe('income');
    expect(champ('Nom de la catégorie').aide).toBe('Salaire');
    expect(tous('label.f', f).some((l) => t(l).startsWith('Catégorie parente'))).toBe(true);
    // Le formulaire est sous le bouton de sa nature, dans la partie Revenus.
    const titres = tous('main h2');
    const revenus = titres.find((h) => t(h) === 'Revenus')!;
    expect(revenus.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await cliquer('Annuler')).toBe(true);
    expect(await cliquer('Ajouter une catégorie de dépenses')).toBe(true);
    expect(t(document.querySelector('main form.edit .titre-panneau'))).toBe('Ajouter une catégorie de dépense');
    expect(champ('Nature').valeur).toBe('expense');
    expect(tous('label.f').some((l) => t(l).startsWith('Tirelire par défaut'))).toBe(true);
  });

  it('point 4 — ajouter avec le nom et la nature de l’aide fait ce que fait le raccourci, liens compris : sa tirelire par défaut, puis ses flux', async () => {
    // « Santé », renommée, et « Logement », supprimée, sont les raccourcis restants de la nature Dépense, dans l'ordre de l'exemple.
    expect(champ('Nom de la catégorie').aide).toBe('Santé');
    await saisir(champ('Nom de la catégorie').el, 'Santé');
    expect(await cliquerExactement('Ajouter une catégorie')).toBe(true);
    const tirelireSante = alive(projet().tirelires).find((x) => x.name === 'Santé')!;
    expect(enregistrees().find((c) => c.name === 'Santé')?.tirelireId).toBe(tirelireSante.id);
    expect(document.querySelector('main form.edit'), 'le formulaire se referme une fois la catégorie ajoutée').toBeNull();

    expect(await cliquer('Ajouter une catégorie de dépenses')).toBe(true);
    expect(champ('Nom de la catégorie').aide).toBe('Logement');
    await saisir(champ('Nom de la catégorie').el, 'Logement');
    expect(await cliquerExactement('Ajouter une catégorie')).toBe(true);
    const logement = enregistrees().find((c) => c.name === 'Logement');
    expect(logement).toBeDefined();
    const credit = alive(projet().plannedFlows).filter((f) => f.name === 'Crédit immobilier');
    for (const f of credit) expect(f.action?.categoryId).toBe(logement!.id);
  });

  it('point 4 — un ajout avec une tirelire par défaut choisie la garde', async () => {
    expect(await cliquer('Ajouter une catégorie de dépenses')).toBe(true);
    await saisir(champ('Nom de la catégorie').el, 'Coiffeur');
    const tirelire = alive(projet().tirelires)[0]!;
    await saisir(champ('Tirelire par défaut').el, tirelire.id);
    expect(await cliquerExactement('Ajouter une catégorie')).toBe(true);
    expect(enregistrees().find((c) => c.name === 'Coiffeur')?.tirelireId).toBe(tirelire.id);
  });

  it('[niveau 3] point 6 — l’explication est repliée sous « Comment ça marche ? », s’ouvre d’un geste, et dit la tirelire par défaut sans dire qu’une catégorie alimente un budget', async () => {
    const d = document.querySelector('main details.explication') as HTMLDetailsElement;
    expect(t(d.querySelector('summary'))).toBe('Comment ça marche ?');
    expect(d.open).toBe(false);
    await presser(d.querySelector('summary') as HTMLElement);
    expect(d.open).toBe(true);
    const texte = t(d);
    expect(texte).toContain('sans demander de tirelire');
    expect(texte).toContain('tirelire par défaut');
    expect(texte).toContain('pas un lien comptable');
    expect(t(document.querySelector('main'))).not.toMatch(/alimente/);
  });
});

describe('[niveau 0] #365 · 3 — supprimer une catégorie dans l’écran ne touche pas aux opérations déjà classées', () => {
  it('les sous-opérations classées dans la catégorie supprimée la gardent, vivantes, avec leur part', async () => {
    await ouvrirLApplication();
    expect(await cliquer('Charger l\'exemple')).toBe(true);
    for (let i = 0; i < 200 && !alive(app.ledger.accounts).some((a) => a.name === 'Livret A'); i++) await rendu(), await new Promise((f) => setTimeout(f, 10));
    await ouvrir();
    const sante = enregistrees().find((c) => c.name === 'Santé' && c.nature === 'expense')!;
    const classees = alive(projet().subOperations).filter((s) => s.categoryId === sante.id);
    expect(classees.length, 'l’exemple n’a plus d’opération classée dans « Santé » : choisir une autre catégorie').toBeGreaterThan(0);
    const avant = window.confirm;
    window.confirm = () => true;
    try {
      await geste('Santé', 'Supprimer');
    } finally {
      window.confirm = avant;
    }
    expect(enregistrees().map((c) => c.name)).not.toContain('Santé');
    const apres = alive(projet().subOperations);
    for (const s of classees) expect(apres.find((x) => x.id === s.id)).toEqual(s);
  });
});

describe('[niveau 0] #365 · 7 — l’assistant ouvert sur la section Catégories', () => {
  it('sur une base vide, ouvert depuis l’écran et validé sans rien toucher : les dix catégories, sans tirelire par défaut ; ni tirelire, ni flux, ni compte, ni jour de début de période', async () => {
    await ouvrirLApplication();
    await ouvrir();
    await completerAvecLAssistant();
    expect(t(document.querySelector('main h1'))).toBe('Compléter mes catégories');
    expect(tous('main .wizard-steps .wstep').map(t)).toEqual(['Catégories', 'Résumé']);
    expect(t(document.querySelector('main h2'))).toBe('Comment classer vos dépenses et vos rentrées ?');
    // L'explication est affichée, comme dans l'assistant complet.
    expect(document.querySelector('main details.explication')).toBeNull();
    expect(enregistrees(), 'rien ne s’écrit avant la validation').toEqual([]);
    expect(await cliquer('Suivant')).toBe(true);
    expect(t(document.querySelector('main')).includes('Où dort chaque tirelire')).toBe(false);
    expect(await cliquerExactement('Valider')).toBe(true);
    const p = projet();
    expect(alive(p.categories).map((c) => c.name).sort()).toEqual(DIX);
    expect(alive(p.categories).filter((c) => c.tirelireId)).toEqual([]);
    expect(alive(p.tirelires)).toEqual([]);
    expect(alive(p.plannedFlows)).toEqual([]);
    expect(alive(p.accounts).map((a) => a.id)).toEqual([MAIN_ACCOUNT_ID]);
    expect(p.settings.periodStartDay).toBe(DEFAULT_SETTINGS.periodStartDay);
    expect(p.settings.principalCushion).toBe(DEFAULT_SETTINGS.principalCushion);
    // « Revenir aux catégories » ramène à l'écran, qui montre les lignes validées.
    expect(await cliquerExactement('Revenir aux catégories')).toBe(true);
    expect(t(document.querySelector('main h1'))).toBe('Catégories');
    expect(lignes().map((l) => l.nom).sort()).toEqual(DIX);
  });

  it('sur un projet qui a des flux, rien ne se garnit ; la validation n’écrit que les catégories et le flux dont l’étape a donné la catégorie', async () => {
    await ouvrirLApplication();
    app.upsert('plannedFlows', { id: 'f-sal', name: 'Salaire', kind: 'income', amount: euros(2000), accountId: MAIN_ACCOUNT_ID, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-28' }, dateWindowDays: 3 });
    app.upsert('plannedFlows', { id: 'f-edf', name: 'Électricité', kind: 'fixedCharge', amount: -euros(90), accountId: MAIN_ACCOUNT_ID, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-05' }, dateWindowDays: 3 });
    app.upsert('tirelires', { id: 't-ali', name: 'Alimentation', placement: [], openingBalance: 0, openingDate: '2026-09-01' });
    const avant = projet();
    await ouvrir();
    await completerAvecLAssistant();
    expect(tous('main .ligne-categorie')).toHaveLength(0);
    expect(await cliquer('+ Salaire')).toBe(true);
    expect(await cliquer('+ Alimentation')).toBe(true);
    expect(t(ligneDe('Salaire')?.querySelector('.suite'))).toContain('Flux : Salaire');
    expect(await cliquer('Suivant')).toBe(true);
    expect(await cliquerExactement('Valider')).toBe(true);
    const p = projet();
    const salaire = alive(p.categories).find((c) => c.name === 'Salaire')!;
    expect(alive(p.categories).find((c) => c.name === 'Alimentation')?.tirelireId).toBe('t-ali');
    expect(alive(p.plannedFlows).find((f) => f.id === 'f-sal')?.action?.categoryId).toBe(salaire.id);
    expect(alive(p.plannedFlows).find((f) => f.id === 'f-edf')).toEqual(alive(avant.plannedFlows).find((f) => f.id === 'f-edf'));
    expect(alive(p.tirelires)).toEqual(alive(avant.tirelires));
    expect(alive(p.accounts)).toEqual(alive(avant.accounts));
    expect(p.settings).toEqual(avant.settings);
  });
});

describe('[niveau 2] #365 · 7 — sur un projet vierge qui porte déjà des catégories, le garnissage n’ajoute que celles de l’exemple qui manquent (D43, D46)', () => {
  it('« Alimentation », déjà là, n’est ni doublée ni remplacée ; les neuf autres entrent', async () => {
    await ouvrirLApplication();
    app.upsert('categories', { id: 'c-ali', name: 'alimentation', nature: 'expense' });
    await ouvrir();
    await completerAvecLAssistant();
    expect(lignes().map((l) => l.nom).sort((a, b) => a.localeCompare(b, 'fr'))).toEqual(['alimentation', ...DIX.filter((n) => n !== 'Alimentation')].sort((a, b) => a.localeCompare(b, 'fr')));
    expect(await cliquer('Suivant')).toBe(true);
    expect(await cliquerExactement('Valider')).toBe(true);
    const p = projet();
    expect(alive(p.categories).filter((c) => c.name.toLowerCase() === 'alimentation').map((c) => c.id)).toEqual(['c-ali']);
    expect(alive(p.categories)).toHaveLength(10);
  });
});
