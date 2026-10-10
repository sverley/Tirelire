// @vitest-environment jsdom
/**
 * Harnais d'audit de #419, composé parmi les tests du codeur :
 * ce que vérifiait, dans le navigateur, le harnais d'audit de #184 côté écran (« une
 * échéance trop proche : le plan annonce le manque et propose le lissage », principe 1.4, D88), que #419 retire, se
 * vérifie ici sans navigateur : l'application montée sous jsdom (`ecran.ts`). Chaque titre dit le point du « Fait
 * quand » de #184 qu'il vérifie, et le numéro du test retiré dans la table de #419 (« manque-lissage 1 » à
 * « manque-lissage 4 »).
 *
 * Ce qui se lit ici : le bloc « Échéances en manque » du Plan et ses gestes, l'annonce de l'écran Tirelires dès
 * qu'une échéance s'enregistre, l'éditeur de la ventilation de l'écran Opérations, et le projet que l'application a
 * enregistré, relu dans le dépôt. Les parcours partent de l'exemple chargé (« Charger l'exemple », lu au 6 septembre
 * 2026), dont la taxe foncière porte son lissage décidé : « Retirer le lissage » ramène le manque (100 € au 15 octobre)
 * et sa proposition. Les montants attendus sont relus dans le cœur, sur le même projet et à la même date. Le calcul, la
 * réponse enregistrée et l'éditeur de la ventilation hors de l'écran : `packages/core/test/manque-lissage-harnais.test.ts`.
 *
 * Niveaux (D83) : ceux des tests retirés, que la table de #419 recopie. 0 pour manque-lissage 4 (la date d'une part,
 * perdue ou changée par l'éditeur de la ventilation) ; 1 pour manque-lissage 1 et 3 (principe 1.4 ; I10 : rien ne
 * s'écrit sans geste) ; 2 pour manque-lissage 2 (D88 : la réponse au manque). Ceux de niveau 0 et 1 vus rouges à
 * l'audit, chacun sur une mutation ciblée de l'application.
 */
import { describe, expect, it } from 'vitest';
import { alive, dueDateShortfalls, euros, exampleLedger, formatCents, liveSubOperations, periodsAround } from '@tirelire/core';
import { allerA, app, attendre, cliquer, cliquerExactement, ecran, ouvrirLApplication, presser, projet, rendu, saisir, t, tous } from './ecran';

/** Un montant tel que l'écran l'écrit, espaces resserrés comme `t` les resserre. */
const fmt = (c: number) => formatCents(c).replace(/[\s  ]+/g, ' ');
const LECTURE = '2026-09-06';

/** Ouvre l'application et charge l'exemple, comme le bouton de l'accueil. */
async function ouvrirLExemple(): Promise<void> {
  await ouvrirLApplication();
  expect(await cliquer('Charger l\'exemple')).toBe(true);
  await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A') && app.asOf === LECTURE, 'l’exemple');
  await rendu();
}

/** Le bloc « Échéances en manque » du Plan : son texte et ses boutons ; `null` s'il n'y est pas. */
function blocManque(): { texte: string; boutons: string[] } | null {
  const h2 = tous('main h2').find((h) => t(h) === 'Échéances en manque');
  let carte = h2?.nextElementSibling ?? null;
  while (carte && !carte.classList.contains('card')) carte = carte.nextElementSibling;
  if (!h2 || !carte) return null;
  return { texte: t(carte), boutons: tous('button', carte).map(t) };
}

/** Le bloc « Échéances en manque », une fois qu'il dit `motif`. */
async function leBlocDit(motif: RegExp): Promise<{ texte: string; boutons: string[] }> {
  await attendre(() => motif.test(blocManque()?.texte ?? ''), `le bloc « Échéances en manque » qui dit ${motif} (${JSON.stringify(blocManque())})`);
  return blocManque()!;
}

/** Les réponses vivantes que le projet enregistré porte pour la taxe foncière. */
const reponsesDeLaTaxe = () => alive(projet().shortfallAnswers).filter((a) => a.needId === 'need-tf');

/** La ligne « Tirelires » de la taxe foncière, celle qui dit sa croisière. */
const ligneDeLaTaxe = () => t(tous('main .row').find((r) => t(r.querySelector('.label strong')) === 'Taxe foncière' && /croisière/.test(t(r))));

// Le montant, la date et la proposition que le cœur annonce pour la taxe foncière sans réponse, à la même date.
const manque = (() => {
  const l = exampleLedger();
  l.shortfallAnswers = [];
  l.operations = l.operations.filter((o) => o.id !== 'op-lissage-tf');
  l.subOperations = l.subOperations.filter((s) => s.operationId !== 'op-lissage-tf');
  return dueDateShortfalls(l, LECTURE).find((s) => s.needId === 'need-tf')!;
})();

describe('#419 · #184 — le manque d’une échéance à l’écran, sur l’exemple, sans navigateur', () => {
  it('[niveau 1] #184 points 1 et 2 (table #419, manque-lissage 1) — le Plan annonce le manque, montant et date, à côté de ce que l’ordre permanent demande, avec la proposition de lisser ; rien ne s’écrit sans le geste de l’utilisateur', async () => {
    await ouvrirLExemple();
    await allerA('Plan');
    // L'exemple porte le lissage décidé de la taxe foncière : le bloc le dit, et se retire d'un geste.
    expect((await leBlocDit(/Lissage décidé/)).boutons).toContain('Retirer le lissage');
    expect(reponsesDeLaTaxe()).toHaveLength(1);
    expect(await cliquerExactement('Retirer le lissage')).toBe(true);

    const b = await leBlocDit(/Il manquera/);
    expect(manque.amount, 'l’exemple sans lissage n’a plus de manque : ce test ne vérifie rien').toBeGreaterThan(0);
    expect(b.texte).toContain(`Il manquera ${fmt(manque.amount)} le 15 oct`);
    expect(b.texte).toContain(`l’ordre permanent en demande ${fmt(manque.cruise)} par période`);
    expect(manque.proposal?.length).toBeGreaterThan(0);
    for (const part of manque.proposal!) expect(b.texte).toContain(fmt(part.amount));
    expect(b.boutons).toEqual(expect.arrayContaining(['Lisser', 'Modifier', 'Refuser']));
    expect(b.texte).not.toMatch(/Lissage décidé|Lissage refusé/);

    // Rien ne s'est lissé de soi-même : le projet ne porte aucune réponse, et le plan de la période ne demande que la croisière.
    await rendu();
    expect(reponsesDeLaTaxe(), 'une réponse s’est enregistrée sans geste').toEqual([]);
    const ligne = ligneDeLaTaxe();
    expect(ligne).toContain(`croisière ${fmt(manque.cruise)}`);
    expect(ligne).not.toMatch(/demandé|lissage décidé/);
  });

  it('[niveau 2] #184 point 5 (table #419, manque-lissage 2) — refuser, revenir sur le refus, puis lisser : la réponse se lit, la proposition ne revient pas, le manque qui reste se dit toujours', async () => {
    await ouvrirLExemple();
    await allerA('Plan');
    expect(await cliquerExactement('Retirer le lissage')).toBe(true);
    await leBlocDit(/Il manquera/);

    expect(await cliquerExactement('Refuser')).toBe(true);
    const refuse = await leBlocDit(/Lissage refusé/);
    expect(refuse.boutons).toEqual(['Revenir sur le refus']);
    expect(refuse.texte).toContain(`Il manquera ${fmt(manque.amount)}`);
    expect(refuse.texte).not.toMatch(/Proposé/);

    expect(await cliquerExactement('Revenir sur le refus')).toBe(true);
    const revenue = await leBlocDit(/Proposé/);
    expect(revenue.boutons).toEqual(expect.arrayContaining(['Lisser', 'Modifier', 'Refuser']));

    expect(await cliquerExactement('Lisser')).toBe(true);
    const lisse = await leBlocDit(/Lissage décidé/);
    expect(lisse.boutons).toEqual(['Retirer le lissage']);
    expect(lisse.texte).not.toMatch(/Il manquera|Proposé/);
    for (const part of manque.proposal!) expect(lisse.texte).toContain(fmt(part.amount));
    // Le plan de la période lit la part du lissage décidé sur la ligne de la taxe : celle que le cœur propose pour
    // la période où l'on lit.
    const [enCours] = periodsAround(exampleLedger(), LECTURE, 0, 0);
    const part = manque.proposal!.find((p) => p.date >= enCours!.start && p.date <= enCours!.end);
    expect(part, 'le cœur ne propose aucune part pour la période où l’on lit : ce test ne vérifie rien').toBeTruthy();
    expect(t(document.querySelector('main'))).toContain(`dont lissage décidé ${fmt(part!.amount)}`);
  });

  it('[niveau 1] #184 point 3 (table #419, manque-lissage 3) — une échéance qu’on vient d’enregistrer en manque se dit aussitôt à l’écran Tirelires : montant, date, croisière par période, proposition', async () => {
    await ouvrirLExemple();
    expect(await ecran('Tirelires')).toBe(true);
    // Une tirelire neuve, avec une échéance de 120 € tous les 24 mois, au 10 novembre : trop proche.
    expect(await cliquerExactement('Ajouter une tirelire')).toBe(true);
    const sorte = tous('main form.edit label').find((l) => t(l).startsWith('Quelle sorte'))?.querySelector('select') as HTMLSelectElement | null | undefined;
    const echeance = sorte && [...sorte.options].find((o) => t(o).startsWith('Dépense à échéance'));
    expect(echeance, 'choix « Dépense à échéance » introuvable').toBeTruthy();
    await saisir(sorte!, echeance!.value);
    const f = document.querySelector<HTMLFormElement>('main form.edit')!;
    const champ = (debut: string) => tous('label', f).find((l) => t(l).startsWith(debut))?.querySelector('input') as HTMLInputElement | null | undefined;
    for (const [debut, valeur] of [['Quoi', 'Contrôle technique'], ['Montant de l', '120,00'], ['Elle revient tous les', '24'], ['Prochaine échéance', '2026-11-10']] as const) {
      const c = champ(debut);
      expect(c, `champ « ${debut} » introuvable`).toBeTruthy();
      await saisir(c!, valeur);
    }
    f.requestSubmit();
    await attendre(() => !!document.querySelector('main [role="status"]'), 'l’annonce du manque');

    // Ce que le cœur annonce pour cette échéance, sur le projet enregistré, à la même date.
    const besoin = alive(projet().needs).find((n) => n.kind === 'dueDate' && n.periodicity?.anchorDate === '2026-11-10');
    expect(besoin, 'l’échéance ne s’est pas enregistrée').toBeTruthy();
    const attendu = dueDateShortfalls(projet(), app.asOf).find((s) => s.needId === besoin!.id);
    expect(attendu?.amount, 'le cœur n’annonce aucun manque pour cette échéance : ce test ne vérifie rien').toBeGreaterThan(0);

    const annonce = t(document.querySelector('main [role="status"]'));
    expect(annonce).toContain(`Il manquera ${fmt(attendu!.amount)} le 10 nov`);
    expect(annonce).toContain(`l’ordre permanent en demande ${fmt(attendu!.cruise)} par période`);
    expect(attendu!.cruise).toBe(euros(5));
    expect(annonce).toMatch(/Proposé : lisser/);
    for (const part of attendu!.proposal!) expect(annonce).toContain(fmt(part.amount));
    expect(tous('main [role="status"] button').map(t)).toEqual(expect.arrayContaining(['Lisser', 'Modifier', 'Refuser']));
    // Annoncer n'est pas répondre : rien ne s'enregistre pour cette échéance sans geste.
    expect(alive(projet().shortfallAnswers).filter((a) => a.needId === besoin!.id)).toEqual([]);
  });

  it('[niveau 0] #184 point 7 (table #419, manque-lissage 4) — l’éditeur de la ventilation de l’écran Opérations montre la date de chaque part de lissage, et la garde — modifiée ou non — à l’enregistrement', async () => {
    await ouvrirLExemple();
    await allerA('Opérations');
    // L'opération du lissage est verrouillée : l'affichage « Toutes » la montre.
    const filtre = tous<HTMLSelectElement>('main select').find((x) => [...x.options].some((o) => t(o) === 'Non traitées'));
    expect(filtre, 'le filtre « Toutes » est introuvable sur l’écran Opérations').toBeTruthy();
    await saisir(filtre!, [...filtre!.options].find((o) => t(o) === 'Toutes')!.value);

    const ouvrir = async () => {
      const r = tous('main .card .row')
        .filter((x) => x.querySelector(':scope > label.cocher'))
        .find((x) => t(x.querySelector(':scope > button.label strong')) === 'Lissage — Taxe foncière');
      const b = r?.querySelector<HTMLButtonElement>(':scope > button.label');
      expect(b, 'l’opération « Lissage — Taxe foncière » est introuvable').toBeTruthy();
      await presser(b!);
    };
    const dates = () => tous<HTMLInputElement>('main form.edit input[type="date"]').map((i) => i.value);
    /** Les dates des parts de l'opération, dans le projet enregistré, par identifiant. */
    const datesEnregistrees = () =>
      liveSubOperations(projet().subOperations)
        .filter((s) => s.operationId === 'op-lissage-tf')
        .map((s) => [s.id, s.date])
        .sort(([a], [b]) => (a! < b! ? -1 : 1));

    await ouvrir();
    expect(dates()).toEqual(['2026-08-28', '2026-09-28']);
    expect(datesEnregistrees()).toEqual([['al-lissage-tf-1', '2026-08-28'], ['al-lissage-tf-2', '2026-09-28']]);

    // La seconde part passe au 1er octobre, et on enregistre.
    await saisir(tous<HTMLInputElement>('main form.edit input[type="date"]')[1]!, '2026-10-01');
    document.querySelector<HTMLFormElement>('main form.edit')!.requestSubmit();
    await attendre(() => !document.querySelector('main form.edit'), 'l’enregistrement de la ventilation');
    expect(datesEnregistrees(), 'l’éditeur de la ventilation a perdu ou changé la date d’une part').toEqual([['al-lissage-tf-1', '2026-08-28'], ['al-lissage-tf-2', '2026-10-01']]);

    // Rouverte, l'opération montre ses deux dates : la première intacte, la seconde modifiée.
    await ouvrir();
    expect(dates()).toEqual(['2026-08-28', '2026-10-01']);
  });
});
