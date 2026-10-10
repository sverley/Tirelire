// @vitest-environment jsdom
/**
 * Tests du codeur de #421 : ce que vérifiait, dans le navigateur, le harnais d'audit de #322
 * (`navigateur/tirelires-comptes-sans-operation-harnais.test.ts`, « Les écrans Tirelires et Comptes se lisent sans
 * opération »), que #421 retire, se vérifie ici sans navigateur : l'application montée sous jsdom (`ecran.ts`), au jour
 * des tests, dans un projet sans aucune opération. Chaque titre dit le point du « Fait quand » de #322 qu'il vérifie,
 * et le numéro du test retiré dans la table de #421 (« tirelires-comptes-sans-operation 1 » à « … 6 »).
 *
 * Décor, comme dans le test retiré : 1 et 2 sur une base vide ; 3 à 6 sur le projet que l'assistant valide, mené par
 * ses boutons primaires, 1 500,00 saisis pour le compte principal à l'étape des comptes, chaque tirelire laissée
 * « Peu importe » au résumé (l'assistant place chaque tirelire comme l'exemple, #336 : « Peu importe » donne des
 * tirelires sans placement voulu). 5 et 6 se suivent sur ce projet, comme les tests retirés.
 *
 * Ce qui se lit ici est ce que les écrans Comptes et Tirelires montrent : la ligne « solde initial … » de la carte du
 * compte principal ; les cartes de Tirelires, leur rubrique (le titre qui les précède), leur texte, leurs boutons et
 * leur alerte ; l'annonce d'une échéance en manque, dont le montant se relit au cœur (`dueDateShortfalls`), sur le
 * projet enregistré et à la même date. Le vouvoiement (D85, point 4) se lit dans ces textes tels que l'application
 * les montre, aux formes que repérait le test retiré : son expression `TUTOIEMENT`, recopiée.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { alive, dueDateShortfalls, exampleLedger } from '@tirelire/core';
import { JOUR, arriverAuxComptes, centimes, cliquer, ecran, lire, ouvrirLApplication, presser, projet, saisir, t, tous } from './ecran';

/** Les formes du tutoiement (D85), recopiées du test retiré (les mêmes que celles du harnais de #320). */
const TUTOIEMENT = /\b(tu|te|toi|ton|ta|tes|tien|tienne)\b|\bt[’']|\b(Importe|saisis|Choisis|Ajoute|Crée|Regarde|Vérifie)\b/;

/** Le nom que l'exemple donne au compte principal, que l'assistant lui donne (#211). */
const PRINCIPAL = exampleLedger().accounts.find((a) => a.kind === 'principal')!.name;

/** Une carte de l'écran Tirelires : sa rubrique (le titre qui la précède), son nom, son texte, ses boutons, son alerte. */
interface CarteTirelire {
  rubrique: string;
  nom: string;
  texte: string;
  boutons: string[];
  alerte: boolean;
  el: HTMLElement;
}

const lireLesTirelires = (): CarteTirelire[] => {
  let rubrique = '';
  const cartes: CarteTirelire[] = [];
  for (const e of tous('main h2, main > .card')) {
    if (e.tagName === 'H2') rubrique = t(e);
    else
      cartes.push({
        rubrique,
        nom: (e.querySelector('input.nom') as HTMLInputElement | null)?.value ?? '',
        texte: t(e),
        boutons: tous(':scope > .actions button, :scope > .ajout-besoin button, :scope > .ligne-tirelire button', e).map(t),
        alerte: e.classList.contains('warn'),
        el: e,
      });
  }
  return cartes;
};

/** La ligne « solde initial … » de la carte du compte principal, à l'écran Comptes ; rien si elle n'y est pas. */
const soldeInitialDuPrincipal = (): string => {
  const carte = tous('main .card').find((c) => t(c.querySelector('.pill')) === 'principal');
  return tous('.sub', carte ?? document.createElement('div')).map(t).find((s) => s.includes('solde initial')) ?? '';
};

/** Saisit le solde sur la ligne du compte principal (l'étape des comptes de l'assistant, ou l'écran Comptes). */
async function saisirLeSoldeDuPrincipal(valeur: string): Promise<boolean> {
  const champ = document.querySelector('main .ligne-compte.principal input.mt') as HTMLInputElement | null;
  if (!champ) return false;
  await saisir(champ, valeur);
  return true;
}

/** Remplit, dans le formulaire ouvert, le champ dont l'étiquette commence par `etiquette` (une valeur, ou le texte d'une option). */
async function remplir(etiquette: string, valeur: string): Promise<boolean> {
  const label = tous('main form.edit label').find((l) => t(l).startsWith(etiquette));
  const champ = label?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null | undefined;
  if (!champ) return false;
  if (champ instanceof HTMLSelectElement) {
    const o = [...champ.options].find((x) => x.value === valeur || t(x) === valeur);
    if (!o) return false;
    await saisir(champ, o.value);
  } else await saisir(champ, valeur);
  return true;
}

/** Envoie le formulaire d'ajout ouvert (#369 : celui de la section, dont le bouton se nomme « Ajouter »). */
async function envoyer(): Promise<boolean> {
  const b = document.querySelector('main form.edit button[type="submit"]') as HTMLButtonElement | null;
  if (b) await presser(b);
  return !!b;
}

/** Ouvre le panneau « Modifier » de la tirelire (le bouton du pied de sa carte, non celui d'une ligne de besoin, #369). */
async function modifierLaTirelire(nom: string): Promise<boolean> {
  const c = tous('main .card.tirelire').find((x) => (x.querySelector('input.nom') as HTMLInputElement | null)?.value === nom);
  const b = c && tous<HTMLButtonElement>(':scope > .actions button', c).find((x) => t(x) === 'Modifier');
  if (b) await presser(b);
  return !!b;
}

/** Clique, dans la carte de l'écran qui porte ce nom, le bouton dont le libellé contient `libelle`. */
async function gesteDansLaCarte(carte: string, libelle: string): Promise<boolean> {
  const nomDe = (c: Element) => ((c.querySelector(':scope > .ligne-compte > input') ?? c.querySelector('input.nom')) as HTMLInputElement | null)?.value ?? t(c.querySelector('strong, .label'));
  const c = tous('main .card').find((x) => nomDe(x).includes(carte));
  const b = c && tous<HTMLButtonElement>('button', c).find((x) => t(x).includes(libelle));
  if (b) await presser(b);
  return !!b;
}

/** Au résumé, laisse chaque tirelire « Peu importe » ; sans effet sur une étape qui ne demande pas de placement. */
async function laisserSansPlacement(): Promise<void> {
  for (const s of tous<HTMLSelectElement>('main select')) {
    const libre = [...s.options].find((o) => t(o) === 'Peu importe');
    if (libre && s.value !== libre.value) await saisir(s, libre.value);
  }
}

/**
 * L'assistant, de l'accueil au plan, par ses seuls boutons primaires, en saisissant `solde` pour le compte principal
 * quand l'étape des comptes s'affiche, et en laissant chaque tirelire « Peu importe ».
 */
async function traverserLAssistant(solde: string): Promise<void> {
  await arriverAuxComptes();
  expect(await saisirLeSoldeDuPrincipal(solde), 'l’étape des comptes n’a pas de ligne pour le compte principal').toBe(true);
  for (let i = 0; i < 15; i++) {
    await laisserSansPlacement();
    const primaire = lire().primaires.find((p) => /Suivant|Commencer|Valider/.test(p));
    expect(primaire, `l’étape « ${lire().h2} » n’a pas de bouton primaire`).toBeDefined();
    expect(await cliquer(primaire!)).toBe(true);
    if (primaire === 'Valider mon budget') break;
  }
  expect(await cliquer('Voir le plan'), 'l’assistant validé ne mène pas au plan').toBe(true);
}

describe('#421 · #322 — base vide, sans navigateur', () => {
  it('[niveau 4] #322 point 3, point 4 (table #421, tirelires-comptes-sans-operation 1) — dans Comptes, la carte du compte principal non renseigné dit « solde initial à renseigner », sans « 0,00 » ni « 1970 », et sans forme du tutoiement', async () => {
    await ouvrirLApplication();
    expect(await ecran('Comptes')).toBe(true);
    const ligne = soldeInitialDuPrincipal();
    expect(ligne).toContain('solde initial à renseigner');
    expect(ligne).not.toMatch(/0,00|1970/);
    expect(ligne, 'point 4 · vouvoiement').not.toMatch(TUTOIEMENT);
  });

  it('[niveau 4] #322 point 3 (table #421, tirelires-comptes-sans-operation 2) — 1 500,00 saisis sur la ligne du compte principal, dans Comptes, sa carte dit « solde initial 1 500,00 € au » suivi d’une date, et plus « à renseigner » ni « 1970 »', async () => {
    await ouvrirLApplication();
    expect(await ecran('Comptes')).toBe(true);
    // Le solde se corrige sur la ligne, comme dans l'assistant (#362) : le panneau ne porte plus que les champs avancés.
    expect(await saisirLeSoldeDuPrincipal('1 500,00')).toBe(true);
    const ligne = soldeInitialDuPrincipal();
    expect(ligne).toMatch(/solde initial 1\s?500,00\s?€ au \S*\d/);
    expect(ligne).not.toMatch(/à renseigner|1970/);
  });
});

describe('#421 · #322 — après l’assistant, mené par ses boutons primaires, ses tirelires laissées « Peu importe », avec 1 500 € saisis pour le compte principal, sans navigateur', () => {
  beforeAll(async () => {
    await ouvrirLApplication();
    await traverserLAssistant('1 500,00');
    expect(alive(projet().tirelires).length, 'l’assistant validé n’a créé aucune tirelire').toBeGreaterThan(0);
    expect(alive(projet().operations).length, 'le projet porte des opérations').toBe(0);
  });

  it('[niveau 4] #322 point 3 (table #421, tirelires-comptes-sans-operation 3) — renseigné par l’assistant, la carte du compte principal, dans Comptes, dit « solde initial 1 500,00 € au » suivi d’une date', async () => {
    expect(await ecran('Comptes')).toBe(true);
    const ligne = soldeInitialDuPrincipal();
    expect(ligne).toMatch(/solde initial 1\s?500,00\s?€ au \S*\d/);
    expect(ligne).not.toMatch(/à renseigner|1970/);
  });

  it('[niveau 4] #322 point 1, I11, point 4 (table #421, tirelires-comptes-sans-operation 4) — dans Tirelires, chaque carte est sous la rubrique du compte principal, sans alerte, dit « voulu : libre », un solde en euros et ses besoins, porte « Ajouter un besoin », « Modifier » et « × », et ne tutoie pas ; l’écran ne dit pas « Sans compte de placement »', async () => {
    expect(await ecran('Tirelires')).toBe(true);
    const cartes = lireLesTirelires();
    expect(cartes.length, t(document.querySelector('main'))).toBeGreaterThan(0);
    for (const c of cartes) {
      expect(c.alerte, c.texte).toBe(false);
      // L'assistant a renseigné le compte principal avec le nom que l'exemple lui donne (#211).
      expect(c.rubrique, c.texte).toBe(PRINCIPAL);
      expect(c.texte, c.texte).toContain('voulu : libre');
      expect(c.texte, `${c.texte} · point 4 · vouvoiement`).not.toMatch(TUTOIEMENT);
      expect(c.texte, `${c.texte} · son solde`).toMatch(/\d\s?,\d{2}\s?€/);
      expect(c.texte, `${c.texte} · ses besoins`).toMatch(/priorité \d|Aucun besoin/);
      // « × » retire la tirelire (#369 : l'en-tête de la carte est celui de l'assistant).
      for (const b of ['Ajouter un besoin', 'Modifier', '×']) expect(c.boutons, c.texte).toContain(b);
    }
    expect(t(document.querySelector('main'))).not.toContain('Sans compte de placement');
  });

  it('[niveau 4] #322 point 1, principe 1.4 (table #421, tirelires-comptes-sans-operation 5) — une tirelire « Dépense à échéance », « Contrôle technique », 1 200,00 € au 15 octobre 2026, ajoutée par le formulaire de l’écran Tirelires, s’annonce dans sa carte, sans autre geste : « Il manquera », au montant que le cœur calcule, au centime', async () => {
    expect(await ecran('Tirelires')).toBe(true);
    // L'échéance s'ajoute par le formulaire de la section, « Dépense à échéance » (#369).
    expect(await cliquer('Ajouter une tirelire')).toBe(true);
    expect(await remplir('Quelle sorte', 'Dépense à échéance')).toBe(true);
    expect(await remplir('Quoi', 'Contrôle technique')).toBe(true);
    expect(await remplir('Montant de l', '1 200,00')).toBe(true);
    expect(await remplir('Prochaine échéance', '2026-10-15')).toBe(true);
    expect(await envoyer()).toBe(true);

    const tirelire = alive(projet().tirelires).find((x) => x.name === 'Contrôle technique');
    expect(tirelire, 'la tirelire « Contrôle technique » n’est pas enregistrée').toBeDefined();
    const manque = dueDateShortfalls(projet(), JOUR).find((s) => s.tirelireId === tirelire!.id);
    expect(manque, 'le cœur ne calcule aucun manque pour cette échéance').toBeDefined();
    expect(manque!.amount, 'le cœur ne calcule pas de montant qui manquera').toBeGreaterThan(0);

    const carte = lireLesTirelires().find((c) => c.nom === 'Contrôle technique');
    expect(carte, 'la carte « Contrôle technique » n’est pas à l’écran').toBeDefined();
    const annonce = t(carte!.el.querySelector('.card.warn[role="status"]'));
    expect(annonce, t(document.querySelector('main'))).toMatch(/manquera\s+\d[\d\s]*,\d{2}\s?€/);
    const dit = annonce.match(/manquera\s+(\d[\d\s]*,\d{2})/)![1]!;
    expect(centimes(dit), `l’annonce dit « ${dit} »`).toBe(manque!.amount);
  });

  it('[niveau 4] #322 point 2, D38, point 4 (table #421, tirelires-comptes-sans-operation 6) — une tirelire placée sur un compte ensuite supprimé reste seule à part, sous « Sans compte de placement », en alerte, avec un texte qui dit que le compte n’existe plus, sans tutoiement, et un « Modifier » qui ouvre « Placement voulu » ; aucune autre carte n’est en alerte', async () => {
    expect(await ecran('Comptes')).toBe(true);
    // Le formulaire d'ajout de la section Comptes est toujours là (#362) : il n'ouvre pas de panneau.
    expect(await remplir('Nom du compte', 'Livret Témoin')).toBe(true);
    expect(await cliquer('Ajouter un compte')).toBe(true);
    expect(alive(projet().accounts).some((a) => a.name === 'Livret Témoin'), 'le compte « Livret Témoin » n’est pas enregistré').toBe(true);

    expect(await ecran('Tirelires')).toBe(true);
    expect(await cliquer('Ajouter une tirelire')).toBe(true);
    expect(await remplir('Quoi', 'Orpheline')).toBe(true);
    expect(await remplir('Combien par période', '10,00')).toBe(true);
    expect(await envoyer()).toBe(true);
    // Le placement ne se dit pas à l'ajout : il se dit dans le panneau « Modifier » de la carte (#369, D59).
    expect(await modifierLaTirelire('Orpheline')).toBe(true);
    expect(await cliquer('Ajouter un compte')).toBe(true);
    expect(await remplir('Compte', 'Livret Témoin')).toBe(true);
    expect(await cliquer('Enregistrer')).toBe(true);
    const temoin = alive(projet().accounts).find((a) => a.name === 'Livret Témoin')!;
    expect(
      alive(projet().tirelires).find((x) => x.name === 'Orpheline')?.placement?.some((p) => p.accountId === temoin.id),
      'la tirelire « Orpheline » n’est pas placée sur « Livret Témoin »',
    ).toBe(true);

    expect(await ecran('Comptes')).toBe(true);
    expect(await gesteDansLaCarte('Livret Témoin', 'Supprimer')).toBe(true);
    expect(await ecran('Tirelires')).toBe(true);

    const cartes = lireLesTirelires();
    const aPart = cartes.filter((c) => c.rubrique === 'Sans compte de placement');
    expect(aPart.map((c) => c.nom === 'Orpheline')).toEqual([true]);
    expect(aPart[0]!.alerte).toBe(true);
    expect(aPart[0]!.texte).toMatch(/n.existe plus|supprimé|introuvable|disparu/i);
    expect(aPart[0]!.texte, 'point 4 · vouvoiement').not.toMatch(TUTOIEMENT);
    expect(aPart[0]!.boutons).toContain('Modifier');
    expect(cartes.filter((c) => c.alerte && c.rubrique !== 'Sans compte de placement')).toEqual([]);

    expect(await modifierLaTirelire('Orpheline')).toBe(true);
    expect(t(document.querySelector('main form.edit.attached'))).toContain('Placement voulu');
    expect(await cliquer('Annuler')).toBe(true);
  });
});
