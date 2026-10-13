// @vitest-environment jsdom
/**
 * Tests du codeur de #463 — les écrans prennent leurs alertes de la fonction du cœur (`readAlerts`). Tous de
 * niveau 4 (D83). Point 15 du « Fait quand » : pour chaque écran, sur un fichier qui porte chacune des alertes qu'il
 * montre, l'écran en montre ce que la fonction rend — les noms, les montants, les dates —, à la même lecture.
 *
 * Le fichier : l'exemple, sans le lissage décidé de la taxe foncière (une échéance en manque, sans réponse), le salaire
 * au tiers (des besoins non couverts), deux opérations importées sur le compte principal — un loyer qu'un flux
 * reprendrait, un virement vers la carte des enfants qui peut devenir l'ordre —, et une tirelire rangée sur un compte
 * retiré. Il est posé comme l'application pose l'exemple (`replaceWith`) et lu au 25 septembre 2026, vingt jours après sa
 * dernière opération. Ce que montrent les écrans se relit dans le cœur, sur le projet enregistré, à la même date.
 */
import { describe, expect, it } from 'vitest';
import { alive, euros, exampleLedger, formatCents, normalizeLabel, readAlerts, shortDate, type Ledger, type Operation } from '@tirelire/core';
import { allerA, app, attendre, cliquerExactement, ecran, fixerLeJour, ouvrirLApplication, presser, projet, rendu, saisir, t, tous } from './ecran';

const LECTURE = '2026-09-25';
fixerLeJour(LECTURE);

/** Un montant tel que l'écran l'écrit, espaces resserrés comme `t` les resserre. */
const serre = (x: string) => x.replace(/[\s  ]+/g, ' ').trim();
const fmt = (c: number) => serre(formatCents(c));

function fichier(): Ledger {
  const l = exampleLedger();
  l.shortfallAnswers = [];
  l.operations = l.operations.filter((o) => o.id !== 'op-lissage-tf');
  l.subOperations = l.subOperations.filter((s) => s.operationId !== 'op-lissage-tf');
  for (const f of l.plannedFlows) if (f.id.startsWith('flow-salaire')) f.amount = Math.round(f.amount / 3);
  const importee = (id: string, date: string, label: string, amount: number, extra: Partial<Operation> = {}): Operation => ({
    id,
    accountId: 'acc-principal',
    origin: 'imported',
    date,
    label,
    normalizedLabel: normalizeLabel(label),
    amount,
    state: 'untreated',
    ...extra,
  });
  l.operations.push(
    importee('op-loyer-imp', '2026-09-05', 'VIR LOYER DUPONT', euros(700)),
    importee('op-vir-carte', '2026-09-03', 'VIR CARTE ENFANTS', euros(-200), { transferAccountId: 'acc-enfants', state: 'locked' }),
  );
  l.accounts.push({ id: 'acc-ancien', name: 'Ancien livret', kind: 'epargne', openingBalance: 0, openingDate: '2025-01-01', deletedAt: '2026-06-01T00:00:00.000Z' });
  l.tirelires.push({ id: 'env-orpheline', name: 'Projet jardin', placement: [{ accountId: 'acc-ancien', share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28' });
  return l;
}

async function ouvrirLeFichier(): Promise<void> {
  await ouvrirLApplication();
  await app.replaceWith(fichier());
  await rendu();
  expect(app.asOf).toBe(LECTURE);
}

/** Les éléments qui suivent le titre `titre` de l'écran, jusqu'au titre suivant de même rang. */
function sousLeTitre(titre: RegExp, rang = 'H2'): Element[] {
  const h = tous('main h2, main h3').find((x) => x.tagName === rang && titre.test(t(x)));
  const out: Element[] = [];
  for (let el = h?.nextElementSibling ?? null; el && el.tagName !== rang; el = el.nextElementSibling) out.push(el);
  return out;
}

describe('#463 · 15. ce que les écrans montrent, pris de la fonction', () => {
  it('l’accueil : l’historique en retard, sa date et le nombre de jours [niveau 4]', async () => {
    await ouvrirLeFichier();
    const [a] = readAlerts(projet(), { today: app.asOf }, ['staleHistory']);
    expect(a, 'le fichier ne porte pas l’alerte : ce test ne vérifie rien').toBeTruthy();
    const carte = tous('.card.warn').find((c) => t(c).startsWith('Dernière opération connue'));
    expect(t(carte)).toContain(`Dernière opération connue le ${shortDate(a!.lastOperationDate)}`);
    expect(t(carte)).toContain(`Il y a ${a!.days} jours.`);
    expect(tous<HTMLButtonElement>('button', carte).map(t)).toContain(`Lire au ${shortDate(a!.lastOperationDate)}`);
  });

  it('le Plan, pour la période qu’il regarde : avertissements, échéances, attendus non reçus, virements qui peuvent devenir l’ordre, manques des soldes prévus [niveau 4]', async () => {
    await ouvrirLeFichier();
    await allerA('Plan');
    const lues = readAlerts(projet(), { today: app.asOf });
    const codes = new Set(lues.map((a) => a.code));
    for (const c of ['negativeMargin', 'unfunded', 'reduced', 'bankOrderDrift', 'dueDateShortfall', 'missingFlow', 'transferToOrder'] as const) expect(codes.has(c), c).toBe(true);

    // Ses avertissements, dans l'ordre, avec le message du plan.
    expect(tous('main .warnings > div').map(t)).toEqual(lues.filter((a) => 'period' in a && a.code !== 'forecastShortfall').map((a) => serre(a.message)));

    // Les échéances que son plan signale : le besoin, ce qui manquera, sa date.
    const echeances = t(sousLeTitre(/^Échéances en manque$/)[1] ?? null);
    for (const a of lues) if (a.code === 'dueDateShortfall' && a.signaledIn.includes('2026-09')) {
      expect(echeances).toContain(a.name);
      expect(echeances).toContain(`Il manquera ${fmt(a.amount)} le ${shortDate(a.dueDate)}`);
    }

    // Les attendus non reçus : le flux, la date attendue, la fin de la fenêtre, le montant.
    const attendus = tous('.row', sousLeTitre(/^Attendus, non reçus$/)[0]).map((r) => [t(r.querySelector('.label')), t(r.querySelector('.num'))]);
    expect(attendus).toEqual(lues.filter((a) => a.code === 'missingFlow').map((a) => [`${a.name}attendu le ${shortDate(a.expectedDate)}, fenêtre close le ${shortDate(a.windowEnd)}`, fmt(a.amount)]));

    // Sur la carte du compte d'accueil sans ordre : les virements qui peuvent en devenir l'ordre.
    const virement = lues.find((a) => a.code === 'transferToOrder')!;
    const bloc = t(document.querySelector('main .virements-ordre'));
    expect(bloc).toContain(`« ${virement.accountName} »`);
    const lignesVirement = tous('.row', document.querySelector('main .virements-ordre')!).map((r) => [t(r.querySelector('.label')), t(r.querySelector('.num'))]);
    expect(lignesVirement).toEqual([[`${virement.operationLabel}du ${shortDate(virement.date)}`, fmt(-virement.amount)]]);

    // Une période à venir : le manque de chaque solde prévu, son montant et sa date.
    const octobre = tous<HTMLButtonElement>('main .actions button').find((b) => t(b) === 'octobre 2026');
    await presser(octobre!);
    const aVenir = readAlerts(projet(), { today: app.asOf, from: '2026-10-01' }, ['forecastShortfall']);
    expect(aVenir.length, 'le fichier ne porte aucun manque de solde prévu en octobre').toBeGreaterThan(0);
    for (const a of aVenir) {
      const nom = 'accountName' in a ? a.accountName : a.tirelireName;
      const ligne = tous('main .row .label').find((x) => t(x.firstChild as Element | null) === nom && t(x).includes('Manque'));
      expect(t(ligne), nom).toContain(`Manque : ${fmt(a.amount)} le ${shortDate(a.date)}`);
    }
  });

  it('Opérations : le nombre des non traitées dans le titre, la reprise proposée et la proposition d’en faire l’ordre sur leur opération [niveau 4]', async () => {
    await ouvrirLeFichier();
    await allerA('Opérations');
    const lues = readAlerts(projet(), { today: app.asOf }, ['untreatedOperations', 'matchProposal', 'transferToOrder']);
    const nombre = lues.find((a) => a.code === 'untreatedOperations');
    expect(nombre?.count).toBeGreaterThan(0);
    expect(t(document.querySelector('main h1'))).toBe(`Opérations ${nombre!.count} non traitées`);

    const ligne = (libelle: string) => tous('main .card > .row').find((r) => t(r.querySelector('strong')) === libelle);
    const reprise = lues.find((a) => a.code === 'matchProposal')!;
    expect(t(ligne(reprise.operationLabel))).toContain(
      `Proposition : reprendre l’opération prévue « ${reprise.flowName} » du ${shortDate(reprise.expectedDate)} (${Math.round(reprise.score * 100)} %, ${reprise.reasons.join(', ')})`,
    );
    const ordre = lues.find((a) => a.code === 'transferToOrder')!;
    expect(t(ligne(ordre.operationLabel))).toContain(`Proposition : en faire votre ordre permanent vers « ${ordre.accountName} »`);
  });

  it('Tirelires : sous « Sans compte de placement », les tirelires de l’alerte ; l’annonce du manque de l’échéance qu’on vient d’enregistrer [niveau 4]', async () => {
    await ouvrirLeFichier();
    expect(await ecran('Tirelires')).toBe(true);
    const orphelines = readAlerts(projet(), { today: app.asOf }, ['orphanTirelire']);
    expect(orphelines.length).toBeGreaterThan(0);
    const noms = sousLeTitre(/^Sans compte de placement$/).flatMap((el) => tous<HTMLInputElement>('input.nom', el).map((i) => i.value));
    expect(noms).toEqual(orphelines.map((a) => a.tirelireName));

    // Une tirelire neuve, avec une échéance de 120 € tous les 24 mois, au 10 novembre : trop proche.
    expect(await cliquerExactement('Ajouter une tirelire')).toBe(true);
    const sorte = tous('main form.edit label').find((l) => t(l).startsWith('Quelle sorte'))?.querySelector('select') as HTMLSelectElement;
    await saisir(sorte, [...sorte.options].find((o) => t(o).startsWith('Dépense à échéance'))!.value);
    const f = document.querySelector<HTMLFormElement>('main form.edit')!;
    const champ = (debut: string) => tous('label', f).find((l) => t(l).startsWith(debut))?.querySelector('input') as HTMLInputElement;
    for (const [debut, valeur] of [['Quoi', 'Contrôle technique'], ['Montant de l', '120,00'], ['Elle revient tous les', '24'], ['Prochaine échéance', '2026-11-10']] as const) await saisir(champ(debut), valeur);
    f.requestSubmit();
    await attendre(() => !!document.querySelector('main [role="status"]'), 'l’annonce du manque');
    const besoin = alive(projet().needs).find((n) => n.kind === 'dueDate' && n.periodicity?.anchorDate === '2026-11-10')!;
    const a = readAlerts(projet(), { today: app.asOf }, ['dueDateShortfall']).find((x) => x.needId === besoin.id);
    expect(a?.amount, 'l’échéance n’est pas en manque : ce test ne vérifie rien').toBeGreaterThan(0);
    const annonce = t(document.querySelector('main [role="status"]'));
    expect(annonce).toContain(a!.name);
    expect(annonce).toContain(`Il manquera ${fmt(a!.amount)} le ${shortDate(a!.dueDate)}`);
    expect(annonce).toContain(`l’ordre permanent en demande ${fmt(a!.cruise)} par période`);
    expect(annonce).toContain(a!.proposal!.map((p) => `${fmt(p.amount)} le ${shortDate(p.date)}`).join(', '));
  });

  it('le Bilan, dans chaque période de son horizon : les besoins non couverts et ce qui n’en est pas couvert ; les échéances de l’horizon [niveau 4]', async () => {
    await ouvrirLeFichier();
    await allerA('Bilan');
    const horizon = 6;
    expect(tous<HTMLButtonElement>('main .actions button.primary').map(t)).toContain(`${horizon} périodes`);
    const lues = readAlerts(projet(), { today: app.asOf, count: horizon }, ['unfunded', 'reduced', 'dueDateShortfall']);
    const cartes = tous('[data-periode]');
    expect(cartes.length).toBe(horizon);
    let vus = 0;
    for (const carte of cartes) {
      const cle = carte.getAttribute('data-periode');
      const attendus = lues.filter((a) => (a.code === 'unfunded' || a.code === 'reduced') && a.period.key === cle);
      const lignes = tous(':scope > .row', carte).filter((r) => r.querySelector('.label.neg'));
      expect(lignes.map((r) => [t(r.querySelector('.label')), t(r.querySelector('.num')?.firstChild as Element | null), t(r.querySelector('.num .sub'))]), cle!).toEqual(
        attendus.map((a) => 'needName' in a && [`« ${a.needName} » ${a.code === 'unfunded' ? 'n’est pas couverte par les revenus' : 'n’est couverte qu’en partie par les revenus'}`, fmt(a.uncovered), 'non couverts']),
      );
      expect(carte.classList.contains('warn'), cle!).toBe(attendus.length > 0);
      vus += attendus.length;
    }
    expect(vus, 'le fichier ne porte aucun besoin non couvert : ce test ne vérifie rien').toBeGreaterThan(0);
    const echeances = t(sousLeTitre(/^Échéances en manque$/)[1] ?? null);
    const dansLHorizon = lues.filter((a) => a.code === 'dueDateShortfall' && a.inReading);
    expect(dansLHorizon.length).toBeGreaterThan(0);
    for (const a of dansLHorizon) if (a.code === 'dueDateShortfall') {
      expect(echeances).toContain(a.name);
      expect(echeances).toContain(`Il manquera ${fmt(a.amount)} le ${shortDate(a.dueDate)}`);
    }
  });
});
