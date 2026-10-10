// @vitest-environment jsdom
/**
 * Harnais d'audit de #420, composé parmi les tests du codeur :
 * ce que vérifiait, dans le navigateur, le harnais d'audit de #306 côté écran (« Une
 * opération en reprend une autre, et la sélection d'un flux est la seule qui le reconnaisse »), que #420 retire, se
 * vérifie ici sans navigateur : l'application montée sous jsdom (`ecran.ts`). Chaque titre dit le point du « Fait quand »
 * de #306 qu'il vérifie, et le numéro du test retiré dans la table de #420 (« reprise 1 » à « reprise 4 »).
 *
 * Ce qui se lit ici : ce que montrent le Plan (le détail d'un solde prévu), l'écran Opérations, l'écran Flux prévus,
 * l'écran Saisie manuelle et la liste des automatismes du Bilan, et le projet que l'application a enregistré, relu
 * dans le dépôt. Les montants attendus sont relus dans le cœur, sur le même projet et à la même date. Les règles
 * elles-mêmes : `packages/core/test/reprise-harnais.test.ts`.
 *
 * Décors : l'exemple chargé par « Charger l'exemple » (lu au 6 septembre 2026, comme `loadExample` le règle), dont
 * octobre 2026 est la première période à venir et dont le salaire du 28 août est repris par une opération du relevé ;
 * pour le point 9, l'exemple dont le salaire d'octobre est corrigé par une saisie que reprend une opération du relevé,
 * écrit par le cœur et posé dans l'application comme elle pose l'exemple (`replaceWith`), lu au jour des tests.
 *
 * Niveaux (D83) : ceux des tests retirés, que la table de #420 recopie. 1 pour reprise 1 (U1 : corriger le Plan sans
 * import) et reprise 4 (I2 : une saisie reprise ne se supprime pas tant que la reprise tient), chacun vu rouge sur une
 * mutation ciblée de l'application à l'audit ; 3 pour reprise 2 (ce que l'écran dit d'une reprise) ; 2 pour reprise 3.
 */
import { describe, expect, it } from 'vitest';
import {
  alive,
  applyPatchToLedger,
  computePlan,
  correctPlannedOperation,
  euros,
  exampleLedger,
  formatCents,
  resumeEntry,
  undoResumption,
  type Ledger,
  type Operation,
} from '@tirelire/core';
import { JOUR, allerA, app, attendre, cliquer, cliquerExactement, ecran, ouvrirLApplication, presser, projet, rendu, saisir, t, tous } from './ecran';

/** Un montant tel que l'écran l'écrit, espaces resserrés comme `t` les resserre. */
const fmt = (c: number) => formatCents(c).replace(/[\s  ]+/g, ' ');
const LECTURE = '2026-09-06';
const OCTOBRE = 'octobre 2026';
const DEBUT_OCTOBRE = '2026-09-28';
const COMPTE = 'Compte courant';

/** Ouvre l'application et charge l'exemple, comme le bouton de l'accueil. */
async function ouvrirLExemple(): Promise<void> {
  await ouvrirLApplication();
  expect(await cliquer('Charger l\'exemple')).toBe(true);
  await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A') && app.asOf === LECTURE, 'l’exemple');
  await rendu();
}

/** Ouvre l'application sur ce projet, posé comme l'application pose l'exemple (`replaceWith`). */
async function ouvrirSur(l: Ledger): Promise<void> {
  await ouvrirLApplication();
  await app.replaceWith(l);
  await rendu();
}

/** Ce que le cœur calcule pour le compte courant en octobre, l'exemple éventuellement corrigé. */
const prevu = (corrige?: (l: Ledger) => Ledger) => {
  const l = corrige ? corrige(exampleLedger()) : exampleLedger();
  return computePlan(l, DEBUT_OCTOBRE, LECTURE).forecast!.accounts.find((a) => a.name === COMPTE)!;
};

/** Le bloc « Soldes prévus » : ses lignes de compte (`.row` directes de ses cartes). */
function lignesDesSoldes(): HTMLElement[] {
  const h2 = tous('main h2').find((h) => /^Soldes prévus/.test(t(h)));
  const lignes: HTMLElement[] = [];
  for (let el = h2?.nextElementSibling ?? null; el; el = el.nextElementSibling) lignes.push(...tous(':scope > .row', el));
  return lignes;
}
const ligneDuCompte = () => lignesDesSoldes().find((r) => t(r.querySelector('.label')?.firstChild as Element | null) === COMPTE);

/** Le solde prévu que l'écran donne au compte courant. */
const soldePrevu = (): string | null => {
  const r = ligneDuCompte();
  return r ? t(r.querySelector(':scope > div:last-child')) : null;
};

/** Déplie le détail du compte courant. */
async function deplier(): Promise<boolean> {
  const b = ligneDuCompte()?.nextElementSibling?.querySelector('button') as HTMLButtonElement | null | undefined;
  if (!b) return false;
  await presser(b);
  return true;
}

interface Mouvement {
  libelle: string;
  sous: string;
  boutons: string[];
}

/** Les opérations du détail déplié : leur libellé, ce qui s'en dit, et les boutons qui les suivent. */
const mouvements = (): Mouvement[] =>
  tous('main .orders > .row').map((r) => {
    const suite = r.nextElementSibling;
    return {
      libelle: t(r.querySelector('.label')?.firstChild as Element | null),
      sous: tous('.label > .sub', r).map(t).join(' | '),
      boutons: suite?.classList.contains('actions') ? tous('button', suite).map(t) : [],
    };
  });

/** Clique le bouton `bouton` qui suit l'opération `libelle` du détail, dont ce qui s'en dit répond à `sous`. */
async function agir(libelle: string, sous: RegExp, bouton: string): Promise<boolean> {
  for (const r of tous('main .orders > .row')) {
    if (t(r.querySelector('.label')?.firstChild as Element | null) !== libelle) continue;
    if (!sous.test(tous('.label > .sub', r).map(t).join(' | '))) continue;
    const suite = r.nextElementSibling;
    const cible = suite?.classList.contains('actions') ? tous<HTMLButtonElement>('button', suite).find((x) => t(x) === bouton) : undefined;
    if (!cible) return false;
    await presser(cible);
    return true;
  }
  return false;
}

/** Renseigne le montant du panneau « Corriger l'opération prévue », puis l'enregistre. */
async function corriger(montant: string): Promise<boolean> {
  const f = document.querySelector('main form.edit.attached');
  const champ = f?.querySelector('input') as HTMLInputElement | null;
  const envoyer = tous<HTMLButtonElement>('button', f ?? document.createElement('div')).find((b) => t(b) === 'Enregistrer');
  if (!champ || !envoyer) return false;
  await saisir(champ, montant);
  await presser(envoyer);
  return true;
}

/** L'écran Opérations, sur toutes les opérations (il s'ouvre sur les non traitées). */
async function toutesLesOperations(): Promise<void> {
  await allerA('Opérations');
  const s = tous<HTMLSelectElement>('main select').find((x) => [...x.options].some((o) => t(o) === 'Non traitées'));
  expect(s, 'l’écran Opérations n’offre pas de lire toutes les opérations').toBeTruthy();
  await saisir(s!, [...s!.options].find((o) => t(o) === 'Toutes')!.value);
}

/** Le texte de la dernière ligne d'opération de l'écran Opérations qui répond à `motif`. */
const ligneOperation = (motif: RegExp): string | null => {
  const lignes = tous('main .row').filter((r) => motif.test(t(r)));
  return lignes.length ? t(lignes[lignes.length - 1]) : null;
};

describe('#420 · #306 points 2, 4 et 5 — la reprise à l’écran, sur l’exemple, sans navigateur', () => {
  it('[niveau 1] #306 point 2 (table #420, reprise 1) — dans le détail d’un solde prévu, l’utilisateur corrige une opération prévue ou la masque, et retire sa saisie pour la faire compter de nouveau', async () => {
    const mv = prevu().movements.find((m) => m.flowId === 'flow-salaire')!;
    const initial = fmt(prevu().end);
    const corrige = fmt(prevu((l) => applyPatchToLedger(l, correctPlannedOperation(l, 'flow-salaire', mv.date, euros(3000), mv.date))).end);
    const masque = fmt(prevu((l) => applyPatchToLedger(l, correctPlannedOperation(l, 'flow-salaire', mv.date, 0, mv.date))).end);
    expect(new Set([initial, corrige, masque]).size, 'corriger ou masquer le salaire ne change rien : ce test ne vérifie rien').toBe(3);

    await ouvrirLExemple();
    await allerA('Plan');
    expect(await cliquer(OCTOBRE)).toBe(true);
    expect(soldePrevu(), 'le solde prévu d’octobre n’est pas celui du cœur').toBe(initial);
    expect(await deplier()).toBe(true);
    const avant = mouvements().find((m) => m.libelle === mv.label && /prévue par ce flux/.test(m.sous));
    expect(avant, `l’opération prévue « ${mv.label} » n’est pas dans le détail`).toBeDefined();
    expect(avant!.boutons, 'une opération prévue se corrige et se masque depuis le détail').toEqual(expect.arrayContaining(['Corriger', 'Masquer']));

    // Corriger : elle vaudra 3 000 €, à la même date. Le solde prévu est celui que le cœur calcule.
    expect(await agir(mv.label, /prévue par ce flux/, 'Corriger')).toBe(true);
    expect(await corriger('3000')).toBe(true);
    expect(soldePrevu(), 'après la correction, le solde prévu n’est pas celui du cœur').toBe(corrige);
    const correction = mouvements().find((m) => /corrige l’opération prévue/.test(m.sous));
    expect(correction, 'la saisie ne dit pas qu’elle corrige l’opération prévue').toBeDefined();
    expect(correction!.boutons).toContain('Retirer la correction');
    expect(alive(projet().operations).some((o) => o.origin === 'manual' && o.plannedFlowId === 'flow-salaire' && o.plannedDate === mv.date && o.amount === euros(3000)), 'la correction n’est pas enregistrée').toBe(true);

    // Retirer la correction : l'opération prévue compte de nouveau.
    expect(await agir(correction!.libelle, /corrige l’opération prévue/, 'Retirer la correction')).toBe(true);
    expect(soldePrevu(), 'retirer la correction ne rend pas le solde prévu d’origine').toBe(initial);

    // Masquer : elle n'aura pas lieu. Retirer cette saisie la fait compter de nouveau.
    expect(await agir(mv.label, /prévue par ce flux/, 'Masquer')).toBe(true);
    expect(soldePrevu(), 'après le masquage, le solde prévu n’est pas celui du cœur').toBe(masque);
    const masquage = mouvements().find((m) => /masque l’opération prévue/.test(m.sous));
    expect(masquage, 'la saisie de zéro ne dit pas qu’elle masque l’opération prévue').toBeDefined();
    expect(masquage!.boutons).toContain('Rétablir l’opération prévue');
    expect(await agir(masquage!.libelle, /masque l’opération prévue/, 'Rétablir l’opération prévue')).toBe(true);
    expect(soldePrevu(), 'rétablir l’opération prévue ne rend pas le solde prévu d’origine').toBe(initial);
    expect(alive(projet().operations).some((o) => o.origin === 'manual' && o.plannedFlowId === 'flow-salaire' && o.plannedDate === mv.date), 'une saisie retirée reste enregistrée').toBe(false);
  });

  it('[niveau 3] #306 point 4 (table #420, reprise 2) — l’écran des opérations dit ce qu’une opération reprend et l’écart de montant, et la reprise se défait', async () => {
    await ouvrirLExemple();
    await toutesLesOperations();
    const reprise = /reprend l’opération prévue « Salaire » du/;
    const ligne = ligneOperation(reprise);
    expect(ligne, 'aucune ligne ne dit que le salaire d’août reprend l’opération prévue du salaire').not.toBeNull();
    // L'exemple : 3 400 € reçus pour 3 400 € prévus.
    expect(ligne).toMatch(/écart nul/);

    // Ouvrir la ligne, défaire la reprise : elle ne dit plus rien de tel.
    const bouton = tous<HTMLButtonElement>('main .row button.label').find((b) => reprise.test(t(b)));
    expect(bouton).toBeTruthy();
    await presser(bouton!);
    expect(await cliquer('Défaire la reprise'), 'le panneau de l’opération n’offre pas de défaire la reprise').toBe(true);
    expect(ligneOperation(reprise), 'la reprise défaite se lit encore à l’écran').toBeNull();
    const repris = alive(projet().operations).filter((o) => o.plannedFlowId === 'flow-salaire' && o.plannedDate?.startsWith('2026-08'));
    expect(repris, 'la reprise défaite est encore enregistrée').toEqual([]);
  });

  it('[niveau 2] #306 point 5 (table #420, reprise 3) — un flux n’a qu’une sélection : un seul jeu de critères à l’écran Flux prévus, aucun automatisme engendré, aucun dans la liste des automatismes', async () => {
    await ouvrirLExemple();
    /** La liste « Automatismes » du Bilan, ligne par ligne. */
    const automatismes = async (): Promise<string[] | null> => {
      await allerA('Bilan');
      const h = tous('main h2').find((x) => t(x) === 'Automatismes');
      let e = h?.nextElementSibling ?? null;
      while (e && !e.classList.contains('card')) e = e.nextElementSibling;
      return e ? tous(':scope > .row', e).map(t) : null;
    };
    const avant = await automatismes();
    expect(avant, 'le Bilan ne montre pas sa liste d’automatismes').not.toBeNull();
    expect(avant!.filter((x) => /issu d’un flux/.test(x))).toEqual([]);
    const automatismesAvant = JSON.stringify(projet().automations);

    expect(await ecran('Flux prévus')).toBe(true);
    expect(await cliquerExactement('Modifier'), 'aucun flux ne se modifie à l’écran Flux prévus').toBe(true);
    const libelles = tous('main form.edit label').map(t);
    expect(libelles.length, 'le formulaire du flux ne s’est pas ouvert').toBeGreaterThan(0);
    // Un seul jeu de critères : le compte, le motif de libellé, la tolérance de montant, la fenêtre.
    expect(libelles.filter((c) => /^Motif de libellé/.test(c))).toHaveLength(1);
    expect(libelles.filter((c) => /^Tolérance de montant/.test(c))).toHaveLength(2);
    expect(libelles.filter((c) => /^Fenêtre/.test(c))).toHaveLength(1);
    expect(libelles.filter((c) => /automatisme/i.test(c)), 'le flux propose encore de créer un automatisme à part').toEqual([]);
    expect(libelles.some((c) => /^Verrouiller les opérations que ce flux reprend/.test(c))).toBe(true);

    // Enregistrer le flux, verrouillage demandé : aucun automatisme de plus.
    const f = document.querySelector('main form.edit')!;
    const verrou = tous('label.check', f).find((l) => /^Verrouiller les opérations/.test(t(l)))!.querySelector('input') as HTMLInputElement;
    if (!verrou.checked) await presser(verrou);
    expect(verrou.checked).toBe(true);
    await presser(tous<HTMLButtonElement>('button', f).find((x) => t(x) === 'Enregistrer')!);
    expect(alive(projet().plannedFlows).some((x) => x.action?.state === 'lock'), 'le flux n’a pas été enregistré avec son verrouillage').toBe(true);
    expect(JSON.stringify(projet().automations), 'enregistrer un flux a engendré un automatisme').toBe(automatismesAvant);
    expect(await automatismes(), 'enregistrer un flux a changé la liste des automatismes').toEqual(avant);
  });
});

// ---------------------------------------------------------------------------
// Point 9 : supprimer une saisie qu'une opération du relevé reprend
// ---------------------------------------------------------------------------

const PRINCIPAL = 'acc-principal';

/** L'exemple, dont le salaire d'octobre est corrigé à 3 000 € par une saisie, que reprend une opération du relevé. */
function avecReprise(): { l: Ledger; saisie: Operation; releve: Operation } {
  let l = exampleLedger();
  const mv = computePlan(l, DEBUT_OCTOBRE, JOUR).forecast!.accounts.find((a) => a.name === COMPTE)!.movements.find((m) => m.flowId === 'flow-salaire')!;
  l = applyPatchToLedger(l, correctPlannedOperation(l, 'flow-salaire', mv.date, euros(3000), mv.date));
  const saisie = l.operations.find((o) => o.origin === 'manual' && o.plannedFlowId === 'flow-salaire' && o.plannedDate === mv.date)!;
  const releve: Operation = { id: 'releve-salaire', accountId: PRINCIPAL, origin: 'imported', date: mv.date, label: 'VIR SALAIRE OCTOBRE', normalizedLabel: 'VIR SALAIRE OCTOBRE', amount: euros(3100), state: 'untreated' };
  l = { ...l, operations: [...l.operations, releve] };
  l = applyPatchToLedger(l, resumeEntry(l, releve.id, saisie.id));
  return { l, saisie, releve: l.operations.find((o) => o.id === releve.id)! };
}

/** Le solde prévu du compte courant en octobre, que le cœur calcule au jour de lecture. */
const soldeDuCoeur = (l: Ledger) => fmt(computePlan(l, DEBUT_OCTOBRE, JOUR).forecast!.accounts.find((a) => a.name === COMPTE)!.end);

/** Ce même projet, la reprise défaite puis la saisie supprimée. */
function repriseDefaiteSaisieSupprimee(l: Ledger, saisie: Operation, releve: Operation): Ledger {
  const defaite = applyPatchToLedger(l, undoResumption(l, releve.id));
  return { ...defaite, operations: defaite.operations.map((o) => (o.id === saisie.id ? { ...o, deletedAt: '2026-09-20T12:00:00.000Z' } : o)) };
}

/** Le solde prévu d'octobre, lu sur le Plan. */
async function soldeAuPlan(): Promise<string | null> {
  await allerA('Plan');
  expect(await cliquer(OCTOBRE), 'bouton de la période octobre 2026 introuvable').toBe(true);
  return soldePrevu();
}

/** Ce que le projet enregistré dit de la saisie et de l'opération du relevé. */
const etat = (saisie: Operation, releve: Operation) => {
  const p = projet();
  const s = p.operations.find((o) => o.id === saisie.id);
  const r = p.operations.find((o) => o.id === releve.id);
  return { saisieSupprimee: !!s?.deletedAt, repriseTenue: r?.resumedOperationId === saisie.id, operations: JSON.stringify(p.operations.map(({ normalizedLabel: _n, ...o }) => o)) };
};

describe('#420 · #306 point 9 — une saisie qu’une opération reprend ne se supprime pas tant que la reprise tient, sans navigateur', () => {
  // Pas d'épreuve depuis le Plan : une saisie reprise ne compte plus, le détail d'un solde prévu n'y liste alors que
  // l'opération du relevé, sans bouton ; « Retirer la correction » n'y est pas offert pour elle.

  it.each([
    ['Opérations', 'Supprimer'],
    ['Saisie manuelle', '×'],
  ])('[niveau 1] #306 point 9, I2 (table #420, reprise 4) — depuis l’écran %s, supprimer la saisie reprise le dit, et ne change rien tant qu’on ne défait pas la reprise ; acceptée, la reprise se défait et la saisie se supprime', async (ecranNom, bouton) => {
    const { l, saisie, releve } = avecReprise();
    const tenue = soldeDuCoeur(l);
    const defaite = soldeDuCoeur(repriseDefaiteSaisieSupprimee(l, saisie, releve));
    expect(tenue, 'défaire la reprise ne change rien au solde prévu : ce test ne vérifie rien').not.toBe(defaite);

    await ouvrirSur(l);
    expect(app.asOf).toBe(JOUR);
    expect(await soldeAuPlan()).toBe(tenue);

    // Les questions que l'écran pose, notées, et la réponse qu'on leur donne.
    const questions: string[] = [];
    let reponse = false;
    const confirmer = window.confirm;
    window.confirm = (m?: string) => (questions.push(String(m)), reponse);
    try {
      /** Ouvre l'écran, et clique `bouton` pour la saisie ; rend faux si la saisie n'y est pas. */
      const supprimer = async (): Promise<boolean> => {
        if (ecranNom === 'Opérations') {
          await toutesLesOperations();
          const ligne = tous('main .row').find((r) => t(r.querySelector('button.label strong')) === saisie.label);
          if (!ligne) return false;
          await presser(ligne.querySelector('button.label') as HTMLButtonElement);
          const b = tous<HTMLButtonElement>('button', ligne).find((x) => t(x) === bouton);
          if (!b) return false;
          await presser(b);
          return true;
        }
        if (!(await ecran('Saisie manuelle'))) return false;
        const ligne = tous('main .row').find((r) => t(r.querySelector('strong')) === saisie.label);
        const b = ligne && tous<HTMLButtonElement>('button', ligne).find((x) => t(x) === bouton);
        if (!b) return false;
        await presser(b);
        return true;
      };

      const avant = etat(saisie, releve);
      expect(avant).toMatchObject({ saisieSupprimee: false, repriseTenue: true });

      // Refusée : rien ne change, ni dans le projet ni dans le solde prévu.
      reponse = false;
      expect(await supprimer(), `la saisie « ${saisie.label} » n’a pas de bouton « ${bouton} » à l’écran ${ecranNom}`).toBe(true);
      expect(questions, 'l’écran n’a posé aucune question').toHaveLength(1);
      expect(questions[0]).toMatch(/ne se supprime pas tant que la reprise tient/);
      expect(questions[0], 'le message ne dit pas ce qui reprend la saisie').toMatch(/VIR SALAIRE OCTOBRE/);
      expect(etat(saisie, releve), 'refuser a changé le projet').toEqual(avant);
      expect(await soldeAuPlan(), 'refuser a changé le solde prévu').toBe(tenue);

      // Acceptée : la reprise se défait, la saisie se supprime.
      reponse = true;
      expect(await supprimer(), 'la saisie n’est plus là après avoir refusé').toBe(true);
      expect(questions).toHaveLength(2);
      expect(etat(saisie, releve), 'acceptée, la reprise n’est pas défaite ou la saisie pas supprimée').toMatchObject({ saisieSupprimee: true, repriseTenue: false });
      expect(await soldeAuPlan(), 'la reprise défaite et la saisie supprimée, le solde prévu n’est pas celui du cœur').toBe(defaite);
      // L'opération du relevé ne reprend plus la saisie supprimée, et l'occurrence que la saisie corrigeait lui est
      // de nouveau proposée.
      await toutesLesOperations();
      const ligne = ligneOperation(/VIR SALAIRE OCTOBRE/);
      expect(ligne, 'l’opération du relevé n’est plus à l’écran').not.toBeNull();
      expect(ligne, 'l’opération du relevé reprend encore la saisie supprimée').not.toMatch(/reprend la saisie/);
      expect(ligne, 'l’opération du relevé n’est pas de nouveau proposée à l’occurrence du salaire').toMatch(/Proposition : reprendre l’opération prévue « Salaire » du/);
      expect(await supprimer(), 'la saisie supprimée se lit encore à l’écran').toBe(false);
      expect(questions, 'supprimer une saisie que rien ne reprend plus ne devait rien demander de tel').toHaveLength(2);
    } finally {
      window.confirm = confirmer;
    }
  });
});
