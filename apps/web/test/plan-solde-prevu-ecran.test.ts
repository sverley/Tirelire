// @vitest-environment jsdom
/**
 * Harnais d'audit de #419, composé parmi les tests du codeur :
 * ce que vérifiait, dans le navigateur, le harnais d'audit de #296 côté écran (« le plan
 * d'une période à venir montre le solde prévu des comptes et des tirelires », D52, D88), que #419 retire, se vérifie
 * ici sans navigateur : l'application montée sous jsdom (`ecran.ts`). Chaque titre dit le point du « Fait quand » de
 * #296 qu'il vérifie, et le numéro du test retiré dans la table de #419 (« solde prévu 1 » à « solde prévu 4 »). Ce
 * qui reste au navigateur, la mesure de l'écran déplié à 375 px (C9) : `navigateur/plan-solde-prevu.test.ts`.
 *
 * Ce qui se lit ici : le bloc « Soldes prévus » de l'écran Plan — ses comptes, ses tirelires, leur manque, et le détail
 * de leurs opérations, replié ou déplié. L'exemple chargé par « Charger l'exemple » se lit au 6 septembre 2026 ;
 * octobre 2026 est la première période à venir. Les montants attendus sont relus dans le cœur, sur le même exemple et
 * à la même date. Le calcul : `packages/core/test/plan-solde-prevu.test.ts`.
 *
 * Niveaux (D83) : ceux des tests retirés, que la table de #419 recopie. 1 pour solde prévu 3 (principe 1.3 : le manque
 * signalé), vu rouge à l'audit sur une mutation qui retire la date du manque ; 2 pour solde prévu 1, 2 et 4 (D52, D88).
 */
import { describe, expect, it } from 'vitest';
import { alive, computePlan, exampleLedger, formatCents, type ForecastMovement } from '@tirelire/core';
import { allerA, app, attendre, cliquer, cliquerExactement, ouvrirLApplication, presser, rendu, t, tous } from './ecran';
import { shortDate } from '../src/lib/format';

/** Un montant tel que l'écran l'écrit, espaces resserrés comme `t` les resserre. */
const fmt = (c: number) => formatCents(c).replace(/[\s  ]+/g, ' ');
const LECTURE = '2026-09-06';
const OCTOBRE = 'octobre 2026';
const DEBUT_OCTOBRE = '2026-09-28';

interface Ligne {
  nom: string;
  montant: string;
  sous: string[];
  detail: Array<{ libelle: string; sous: string; montant: string }>;
}

/** Le bloc « Soldes prévus », lu tel qu'affiché : ses comptes, ses tirelires, et ce qui est déplié ; `null` sans bloc. */
function soldesPrevus(): { comptes: Ligne[]; tirelires: Ligne[] } | null {
  const h2 = tous('main h2').find((h) => /^Soldes prévus/.test(t(h)));
  if (!h2) return null;
  const lire = (titre: string) => {
    let el = h2.nextElementSibling;
    while (el && !(el.tagName === 'H3' && t(el) === titre)) el = el.nextElementSibling;
    const carte = el?.nextElementSibling;
    const out: Ligne[] = [];
    for (const enfant of carte ? [...carte.children] : []) {
      if (enfant.classList.contains('row')) {
        out.push({
          nom: t(enfant.querySelector('.label')?.firstChild as Element | null),
          montant: t(enfant.querySelector(':scope > div:last-child')),
          sous: tous('.label > .sub', enfant).map(t),
          detail: [],
        });
      } else if (enfant.classList.contains('orders')) {
        // Le premier bloc déplié sous une ligne est celui des opérations ; le suivant (parts des tirelires hébergées) n'en est pas.
        const dernier = out[out.length - 1];
        if (!dernier || enfant.previousElementSibling?.classList.contains('orders')) continue;
        for (const r of tous(':scope > .row', enfant))
          dernier.detail.push({ libelle: t(r.querySelector('.label')?.firstChild as Element | null), sous: t(r.querySelector('.sub')), montant: t(r.querySelector(':scope > div:last-child')) });
      }
    }
    return out;
  };
  return { comptes: lire('Comptes'), tirelires: lire('Tirelires') };
}

/** Clique le bouton du détail qui suit la ligne `nom` du bloc. */
async function deplier(nom: string): Promise<boolean> {
  const h2 = tous('main h2').find((h) => /^Soldes prévus/.test(t(h)));
  for (let el = h2?.nextElementSibling ?? null; el; el = el.nextElementSibling) {
    for (const r of tous(':scope > .row', el)) {
      if (t(r.querySelector('.label')?.firstChild as Element | null) !== nom) continue;
      const b = r.nextElementSibling?.querySelector<HTMLButtonElement>('button');
      if (!b) return false;
      await presser(b);
      return true;
    }
  }
  return false;
}

/** Ouvre l'application, charge l'exemple, et va au Plan. */
async function ouvrirLExemple(): Promise<void> {
  await ouvrirLApplication();
  expect(await cliquer('Charger l\'exemple')).toBe(true);
  await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A') && app.asOf === LECTURE, 'l’exemple');
  await allerA('Plan');
  await rendu();
}

/** Ouvre la période d'octobre par son bouton. */
async function ouvrirOctobre(): Promise<void> {
  expect(await cliquerExactement(OCTOBRE), `bouton « ${OCTOBRE} » introuvable`).toBe(true);
}

/** Les opérations d'une ligne dépliée disent, chacune, ce que le cœur prévoit : libellé, date, montant et une origine. */
function memesOperations(lu: Ligne['detail'], prevu: ForecastMovement[]): void {
  expect(lu.map((d) => d.libelle)).toEqual(prevu.map((m) => m.label));
  expect(lu.map((d) => d.montant)).toEqual(prevu.map((m) => fmt(m.amount)));
  lu.forEach((d, i) => {
    const [jour, origine] = d.sous.split(' · ');
    expect(jour).toBe(shortDate(prevu[i]!.date));
    expect(origine?.trim(), `l’opération « ${d.libelle} » ne dit pas son origine`).toBeTruthy();
    if (prevu[i]!.origin === 'flux') expect(origine).toMatch(/prévue par ce flux/);
    if (prevu[i]!.origin === 'dotation') expect(origine).toMatch(/dotation/);
  });
}

describe('#419 · #296 — le solde prévu à l’écran Plan, sur l’exemple, sans navigateur', () => {
  const plan = computePlan(exampleLedger(), DEBUT_OCTOBRE, LECTURE);

  it('[niveau 2] #296 point 6 (table #419, solde prévu 1) — la période où l’on lit ne montre pas de solde prévu', async () => {
    await ouvrirLExemple();
    // La période où l'on lit est bien affichée : son plan est là, sans bloc « Soldes prévus ».
    expect(tous('main h2').map(t)).toContain('Tirelires');
    expect(soldesPrevus()).toBeNull();
    // Le bloc vient avec la période à venir : son absence n'est pas celle de tout le bloc.
    await ouvrirOctobre();
    expect(soldesPrevus()).not.toBeNull();
  });

  it('[niveau 2] #296 point 1 (table #419, solde prévu 2) — octobre montre le solde prévu de chaque compte et de chaque tirelire, celui que le cœur calcule', async () => {
    await ouvrirLExemple();
    await ouvrirOctobre();
    const bloc = soldesPrevus();
    expect(bloc, 'pas de bloc « Soldes prévus » en octobre').not.toBeNull();
    const f = plan.forecast!;
    expect(f.accounts.length).toBeGreaterThan(1);
    expect(f.tirelires.length).toBeGreaterThan(1);
    expect(bloc!.comptes.map((c) => [c.nom, c.montant])).toEqual(f.accounts.map((a) => [a.name, fmt(a.end)]));
    expect(bloc!.tirelires.map((x) => [x.nom, x.montant])).toEqual(f.tirelires.map((x) => [x.name, fmt(x.end)]));
  });

  it('[niveau 1] #296 point 3 (table #419, solde prévu 3) — un manque se lit avec sa date et son montant', async () => {
    await ouvrirLExemple();
    await ouvrirOctobre();
    const bloc = soldesPrevus()!;
    const enManque = [...plan.forecast!.accounts, ...plan.forecast!.tirelires].filter((x) => x.shortfall);
    expect(enManque.length, 'l’exemple n’a aucun manque en octobre : ce test ne vérifie rien').toBeGreaterThan(0);
    for (const x of enManque) {
      const l = [...bloc.comptes, ...bloc.tirelires].find((c) => c.nom === x.name)!;
      expect(l.sous.filter((s) => /^Manque/.test(s)), `« ${x.name} » ne dit pas son manque`).toEqual([`Manque : ${fmt(x.shortfall!.amount)} le ${shortDate(x.shortfall!.date)}`]);
    }
    // Sans manque, rien ne s'en dit.
    for (const x of [...plan.forecast!.accounts, ...plan.forecast!.tirelires].filter((y) => !y.shortfall)) {
      const l = [...bloc.comptes, ...bloc.tirelires].find((c) => c.nom === x.name)!;
      expect(l.sous.some((s) => /Manque/.test(s)), `« ${x.name} » dit un manque que le cœur ne calcule pas`).toBe(false);
    }
  });

  it('[niveau 2] #296 point 4 (table #419, solde prévu 4) — repliées par défaut, les opérations se lisent sur demande, chacune avec son origine', async () => {
    await ouvrirLExemple();
    await ouvrirOctobre();
    let bloc = soldesPrevus()!;
    for (const l of [...bloc.comptes, ...bloc.tirelires]) expect(l.detail, `« ${l.nom} » est déplié par défaut`).toEqual([]);

    expect(await deplier('Compte courant')).toBe(true);
    expect(await deplier('Taxe foncière')).toBe(true);
    bloc = soldesPrevus()!;
    const courant = bloc.comptes.find((c) => c.nom === 'Compte courant')!;
    const prevuCourant = plan.forecast!.accounts.find((a) => a.name === 'Compte courant')!;
    expect(prevuCourant.movements.length).toBeGreaterThan(0);
    memesOperations(courant.detail, prevuCourant.movements);
    expect(courant.detail.some((d) => /prévue par ce flux/.test(d.sous) && d.libelle === 'Salaire')).toBe(true);
    const taxe = bloc.tirelires.find((x) => x.nom === 'Taxe foncière')!;
    memesOperations(taxe.detail, plan.forecast!.tirelires.find((x) => x.name === 'Taxe foncière')!.movements);
    expect(taxe.detail.map((d) => d.sous).join(' | ')).toMatch(/dotation/);
    expect(taxe.detail.some((d) => d.libelle === 'Taxe foncière (prélèvement)' && /prévue par ce flux/.test(d.sous))).toBe(true);
    // Les autres lignes restent repliées.
    for (const l of [...bloc.comptes, ...bloc.tirelires].filter((x) => x.nom !== 'Compte courant' && x.nom !== 'Taxe foncière')) expect(l.detail, `« ${l.nom} » s’est déplié`).toEqual([]);

    // Replier rend l'état par défaut.
    expect(await deplier('Compte courant')).toBe(true);
    bloc = soldesPrevus()!;
    expect(bloc.comptes.find((c) => c.nom === 'Compte courant')!.detail).toEqual([]);
  });
});
