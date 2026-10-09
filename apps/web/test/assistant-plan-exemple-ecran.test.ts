// @vitest-environment jsdom
/**
 * Tests du codeur de #418 : ce que vérifiait le harnais navigateur d'audit de #324 (« L'assistant conduit au plan,
 * et son résumé dit ce que dira le plan »), que #418 retire, sans navigateur : l'application
 * montée sous jsdom (`ecran.ts`), sur un projet vierge, au 6 septembre 2026, jour de l'exemple et du critère de
 * #324 (« L'exemple, lu au 6 septembre »). Chaque titre dit le point du « Fait quand » de #324 qu'il vérifie, et le
 * numéro du test retiré dans la table de #418 (« plan 1 » à « plan 9 »).
 *
 * Ce qui se lit ici : ce que l'assistant montre (étapes Comptes et Revenus, résumé), ce que montrent ensuite le
 * Plan et Réglages, et le projet que la validation a enregistré, relu dans le dépôt. Le réglage que le brouillon
 * propose, sans écran : `assistant-reglages-ouverture.test.ts`. Le point 6 (I4) est tenu par le harnais du registre
 * `navigateur/assistant-simple.test.ts` ; le point 7, par la relecture de D44.
 */
import { describe, expect, it } from 'vitest';
import { computePlan, dueDateShortfalls, exampleLedger, periodReadingDate, periodsAround, shortfallsForPeriod, type Ledger } from '@tirelire/core';
import { allerA, app, arriverAuxComptes, avancer, cliquer, ecran, fixerLeJour, lire, ouvrirLApplication, presser, projet, saisir, t, tous } from './ecran';

const JOUR = '2026-09-06';
fixerLeJour(JOUR);

/** Ce que le résumé de l'assistant dit : les montants, les annonces, les échéances en manque. */
const lireLeResume = () => ({
  titre: t(document.querySelector('main .card.accent, main .card.warn')),
  texte: t(document.querySelector('main')),
  montants: tous('main .card > .row')
    .filter((r) => !r.querySelector('.label strong'))
    .map((r): [string, string] => [t(r.querySelector('.label')), t(r.querySelector('.num'))]),
  annonces: tous('main .warnings > div').map(t),
  manques: tous('main .card.warn .row')
    .filter((r) => t(r.querySelector('.label')).includes('échéance du'))
    .map((r): [string, string, string] => [t(r.querySelector('.label strong')), t(r.querySelector('.sub.neg')), t(r.querySelector(':scope > .num'))]),
});

/** Ce que le Plan de la période en cours dit : les montants, les annonces, les échéances en manque. */
const lireLePlan = () => ({
  montants: tous('main .stats .stat').map((s): [string, string] => [t(s.querySelector('.k')), t(s.querySelector('.v'))]),
  annonces: tous('main .warnings > div').map(t),
  manques: tous('main .card.warn .row')
    .filter((r) => t(r.querySelector('.label')).includes('échéance du'))
    .map((r): [string, string, string] => [t(r.querySelector('.label strong')), t(r.querySelector('.sub.neg')), t(r.querySelector(':scope > .num'))]),
});

/** Le coussin que montre l'écran Réglages (Plus → Réglages). */
async function coussinDeReglages(): Promise<string> {
  expect(await ecran('Réglages')).toBe(true);
  const champ = tous('main label.f').find((l) => t(l).startsWith('Coussin'));
  return (champ?.querySelector('input') as HTMLInputElement | null)?.value ?? '';
}

/** L'exemple privé de ses opérations : les opérations, leurs sous-opérations, et la réponse de lissage qu'elles portent. */
function exempleSansOperations(): Ledger {
  const l = exampleLedger();
  l.operations = [];
  l.subOperations = [];
  l.shortfallAnswers = [];
  return l;
}

/**
 * Ce que dit le Plan de la période en cours et des douze suivantes, sans les identifiants (ceux de l'exemple ne sont
 * pas ceux d'un projet qui l'a reproduit) : de quoi comparer deux projets au centime.
 */
function lirePlans(l: Ledger) {
  return periodsAround(l, JOUR, 0, 12).map((p) => {
    const plan = computePlan(l, periodReadingDate(p, JOUR), JOUR);
    const manques = shortfallsForPeriod(dueDateShortfalls(l, JOUR), plan.period, JOUR);
    return {
      periode: [p.start, p.end],
      totaux: plan.totals,
      lignes: plan.lines.map((x) => ({ nom: x.name, genre: x.kind, demande: x.requested, couvert: x.funded, statut: x.status })),
      virements: plan.transfers.map((x) => ({
        compte: x.accountName,
        permanent: x.permanent,
        reguliers: x.standing,
        net: x.net,
        ordre: x.bankOrder ? { montant: x.bankOrder.amount, ecart: x.bankOrder.drift } : null,
      })),
      annonces: plan.warnings.map((w) => [w.code, w.message]),
      manques: manques.map((m) => ({ nom: m.name, date: m.dueDate, manque: m.amount, croisiere: m.cruise, propose: (m.proposal ?? []).map((q) => [q.date, q.amount]) })),
    };
  });
}

/** Passe d'étape en étape, par « Suivant », jusqu'à celle où l'on voit `ceQuOnVoit`. */
async function avancerJusqua(ceQuOnVoit: string): Promise<void> {
  for (let i = 0; i < 10 && !t(document.querySelector('main')).includes(ceQuOnVoit); i++) expect(await avancer(), 'plus de bouton primaire « Suivant »').toBe(true);
  expect(t(document.querySelector('main')), `l’assistant n’arrive pas à « ${ceQuOnVoit} »`).toContain(ceQuOnVoit);
}

/** Retire une tirelire de l'étape où l'on est, par son nom. */
async function retirerLaTirelire(nom: string): Promise<void> {
  const ligne = tous('main .ligne-tirelire').find((l) => (l.querySelector('input.nom') as HTMLInputElement | null)?.value === nom);
  const b = ligne?.querySelector('button[title="Retirer cette tirelire"]') as HTMLButtonElement | null | undefined;
  expect(b, `pas de tirelire « ${nom} » à retirer`).toBeTruthy();
  await presser(b!);
}

/** Saisit dans le `rang`-ième champ de ce sélecteur. */
async function saisirDans(selecteur: string, rang: number, valeur: string): Promise<void> {
  const champ = document.querySelectorAll<HTMLInputElement>(selecteur)[rang];
  expect(champ, `pas de champ « ${selecteur} » n°${rang}`).toBeTruthy();
  await saisir(champ!, valeur);
}

/** Un geste de l'utilisateur, fait à l'étape où l'on voit `ceQuOnVoit`. */
type Geste = [ceQuOnVoit: string, geste: () => Promise<void>];

/** Un projet vierge, l'assistant mené à son résumé en faisant les `gestes`, le résumé lu, le budget validé, puis le Plan de la période en cours. */
async function resumeEtPlan(gestes: Geste[]) {
  await ouvrirLApplication();
  await arriverAuxComptes();
  for (const [ceQuOnVoit, geste] of gestes) {
    await avancerJusqua(ceQuOnVoit);
    await geste();
  }
  await avancerJusqua('Valider mon budget');
  const resume = lireLeResume();
  expect(await cliquer('Valider mon budget')).toBe(true);
  await allerA('Plan');
  return { resume, plan: lireLePlan(), projet: projet() };
}

/** Les centimes d'un montant écrit à la française : « −1 234,50 € » dit −123450. */
const centimes = (x: string) => Math.round(Number(x.replace(/[^\d,−-]/g, '').replace('−', '-').replace(',', '.')) * 100);

/**
 * Le résumé dit ce que dit le Plan de la période en cours, une fois le budget validé : les mêmes montants — ceux
 * que l'écran du Plan montre, et ceux que le cœur calcule pour le projet enregistré —, les mêmes annonces, les mêmes
 * échéances en manque ; et « Tout est finançable » seulement si le Plan n'annonce rien.
 */
function leResumeEstLePlan({ resume, plan, projet: l }: Awaited<ReturnType<typeof resumeEtPlan>>): void {
  for (const [libelle, valeur] of plan.montants) {
    const dans = resume.montants.find(([x]) => x === libelle);
    expect(dans, `le résumé ne dit pas « ${libelle} »`).toBeDefined();
    expect(dans![1], libelle).toBe(valeur);
  }
  expect(resume.annonces).toEqual(plan.annonces);
  expect(resume.manques).toEqual(plan.manques);
  const [courante] = lirePlans(l);
  const dit = (debut: string | RegExp) => resume.montants.find(([x]) => (typeof debut === 'string' ? x === debut : debut.test(x)));
  expect(centimes(dit('Revenus prévus')![1]), 'revenus').toBe(courante!.totaux.incomes);
  expect(centimes(dit('Charges fixes')![1]), 'charges fixes').toBe(courante!.totaux.fixedCharges);
  expect(centimes(dit(/^Dotations demandées/)![1]), 'dotations demandées').toBe(courante!.totaux.requested);
  expect(centimes(dit('Couvert par les revenus')![1]), 'couvert').toBe(courante!.totaux.funded);
  expect(centimes(dit(/^Marge/)![1]), 'marge').toBe(courante!.totaux.margin);
  const coussin = /coussin ([^)]*)\)/.exec(dit(/^Marge/)![0])?.[1];
  expect(coussin ? centimes(coussin) : 0, 'coussin').toBe(courante!.totaux.cushion);
  const decouvert = courante!.annonces.some(([code]) => code === 'principalOverdrawn');
  expect(dit('Non affecté sur le compte principal') !== undefined, 'non affecté négatif annoncé').toBe(decouvert);
  if (decouvert) expect(centimes(dit('Non affecté sur le compte principal')![1])).toBe(courante!.totaux.principalUnallocated);
  expect(resume.annonces).toEqual(courante!.annonces.map(([, message]) => message!.replace(/[\s  ]+/g, ' ').trim()));
  expect(resume.manques.map(([nom, , montant]) => [nom, centimes(montant)])).toEqual(courante!.manques.map((m) => [m.nom, m.manque]));
  const rien = courante!.annonces.length === 0 && courante!.manques.length === 0;
  expect(resume.texte.includes('Tout est finançable'), `« Tout est finançable » : ${resume.titre}`).toBe(rien);
}

describe('#418 · #324 — un projet vierge, accepté tel quel par les seuls boutons primaires, au 6 septembre 2026, sans navigateur', () => {
  const vus: { periode?: string; propositions?: string[]; coussin?: string; coussinReglages?: string; resume?: ReturnType<typeof lireLeResume>; plan?: ReturnType<typeof lireLePlan>; projet?: Ledger } = {};

  it('[niveau 4] #324 point 1, D44 (table #418, plan 1) — la période commence le 28 dès l’arrivée sur l’étape Revenus, et seul « Suivre le mois calendaire » est proposé, de « Suivre le mois calendaire » et « Commencer au jour de ma paie »', async () => {
    await ouvrirLApplication();
    expect(app.asOf, 'l’application ne lit pas au jour de l’exemple').toBe(JOUR);
    await arriverAuxComptes();
    vus.coussin = (document.querySelector('.ligne-compte.principal input[aria-label="Coussin du compte principal"]') as HTMLInputElement | null)?.value ?? '';
    expect(await avancer()).toBe(true);
    expect(lire().h2).toMatch(/Qu.est-ce qui rentre/);
    const champ = tous('main label.f').find((l) => t(l).includes('La période commence le'));
    vus.periode = (champ?.querySelector('input') as HTMLInputElement | null)?.value ?? '';
    vus.propositions = tous('main .propositions .prop .n').map(t);
    expect(vus.periode).toBe('28');
    expect(vus.propositions.filter((p) => /mois calendaire|jour de ma paie/.test(p))).toEqual([expect.stringMatching(/^Suivre le mois calendaire/)]);

    for (let i = 0; i < 6; i++) expect(await avancer()).toBe(true);
    vus.resume = lireLeResume();
    expect(await cliquer('Valider mon budget')).toBe(true);
    vus.projet = projet();
    vus.coussinReglages = await coussinDeReglages();
  });

  it('[niveau 4] #324 point 2, D41 (table #418, plan 2) — l’étape Comptes montre le coussin de l’exemple, 600,00, sur la ligne du compte principal, et Réglages le montre une fois validé', () => {
    expect(vus.coussin).toBe('600,00');
    expect(vus.coussinReglages).toBe('600,00');
  });

  it('[niveau 4] #324 point 5 (table #418, plan 3) — le plan du projet validé aux seuls boutons primaires est celui de l’exemple privé de ses opérations, sur treize périodes', () => {
    expect(lirePlans(vus.projet!)).toEqual(lirePlans(exempleSansOperations()));
  });

  it('[niveau 4] #324 point 5 (table #418, plan 4) — les chiffres que dit l’issue : la période du 28 août au 27 septembre, les totaux, l’ordre vers Livret A, la taxe foncière et son lissage, treize périodes', () => {
    const plans = lirePlans(vus.projet!);
    const [courante] = plans;
    expect(courante!.periode).toEqual(['2026-08-28', '2026-09-27']);
    expect(courante!.totaux).toMatchObject({ incomes: 420000, fixedCharges: 122000, requested: 230000, funded: 230000, margin: 68000, cushion: 60000 });
    expect(courante!.virements.find((v) => v.compte === 'Livret A')).toMatchObject({ permanent: 65000, ordre: { montant: 60000 } });
    expect(courante!.manques).toEqual([expect.objectContaining({ nom: 'Taxe foncière', date: '2026-10-15', manque: 10000, propose: [['2026-08-28', 5000], ['2026-09-28', 5000]] })]);
    expect(plans).toHaveLength(13);
  });

  it('[niveau 4] #324 point 3 (table #418, plan 5) — le résumé dit ce que dit le Plan de la période en cours une fois validé', async () => {
    await allerA('Plan');
    vus.plan = lireLePlan();
    leResumeEstLePlan({ resume: vus.resume!, plan: vus.plan, projet: vus.projet! });
  });
});

describe('#418 · #324 — ce que l’assistant propose se corrige, sans navigateur', () => {
  it('[niveau 4] #324 points 1 et 2 (table #418, plan 6) — le coussin corrigé à 450,00 est celui que montre Réglages ; le plus gros revenu passé au 5, « Commencer au jour de ma paie … le 5 » et « Suivre le mois calendaire » sont proposés, et le début de période reste le 28 sans geste', async () => {
    let propositions: string[] = [];
    const lu = await resumeEtPlan([
      ['Numéro ou IBAN', () => saisirDans('input[aria-label="Coussin du compte principal"]', 0, '450,00')],
      [
        "Rentrées d'argent",
        async () => {
          const lignes = tous('main .ligne-flux').filter((l) => l.querySelector('input.jour'));
          const montant = (l: HTMLElement) => centimes((l.querySelector('input.mt') as HTMLInputElement).value);
          const plusGros = lignes.sort((a, b) => montant(b) - montant(a))[0];
          const jour = plusGros?.querySelector('input.jour') as HTMLInputElement | null | undefined;
          expect(jour, 'pas de jour de revenu à changer').toBeTruthy();
          await saisir(jour!, '5');
          propositions = tous('main .propositions .prop').map(t);
        },
      ],
    ]);
    expect(propositions.some((x) => x.startsWith('Commencer au jour de ma paie') && x.endsWith('le 5')), propositions.join(' | ')).toBe(true);
    expect(propositions.some((x) => x.startsWith('Suivre le mois calendaire')), propositions.join(' | ')).toBe(true);
    expect(lu.projet.settings.periodStartDay, 'rien ne change le début de période sans geste').toBe(28);
    expect(lu.projet.settings.principalCushion).toBe(45000);
    expect(await coussinDeReglages()).toBe('450,00');
  });
});

describe('#418 · #324 — le résumé dit ce que dira le Plan, sur des budgets qui ne se ressemblent pas, sans navigateur', () => {
  it('[niveau 4] #324 point 4 (table #418, plan 7) — accepté tel quel, avec 1 500,00 € sur le compte principal : le Plan annonce le non affecté négatif et la seule « Taxe foncière » en manque, et le résumé le dit', async () => {
    const lu = await resumeEtPlan([['Numéro ou IBAN', () => saisirDans('.ligne-compte.principal > input.mt', 0, '1500,00')]]);
    expect(lu.plan.annonces.some((a) => a.includes('non affecté est négatif'))).toBe(true);
    expect(lu.plan.manques.map(([nom]) => nom)).toEqual(['Taxe foncière']);
    leResumeEstLePlan(lu);
  });

  it('[niveau 4] #324 point 4 (table #418, plan 8) — les quatre revenus à 100,00 € : chaque ligne non couverte et la marge négative sont dites, pas « Tout est finançable »', async () => {
    const lu = await resumeEtPlan([
      [
        "Rentrées d'argent",
        async () => {
          for (let i = 0; i < 4; i++) await saisirDans('main .ligne-flux > input.mt', i, '100,00');
        },
      ],
    ]);
    expect(lu.plan.annonces.some((a) => a.includes('n’est pas couverte') || a.includes("n'est pas couverte"))).toBe(true);
    expect(lu.resume.texte).not.toContain('Tout est finançable');
    leResumeEstLePlan(lu);
  });

  it('[niveau 4] #324 point 3 (table #418, plan 9) — « Taxe foncière » et « Vacances » retirées, ce que la banque vire à 350,00 € : le Plan n’annonce rien, n’a aucune échéance en manque, et le résumé dit « Tout est finançable »', async () => {
    const lu = await resumeEtPlan([
      [
        'Dépenses à échéance',
        async () => {
          await retirerLaTirelire('Taxe foncière');
          await retirerLaTirelire('Vacances');
        },
      ],
      // Sans la taxe foncière ni les vacances, le budget demande 350,00 € vers le Livret A : l'ordre permanent les vire.
      ['Valider mon budget', () => saisirDans('input[aria-label="Ce que la banque vire"]', 0, '350,00')],
    ]);
    expect(lu.plan.annonces).toEqual([]);
    expect(lu.plan.manques).toEqual([]);
    expect(lu.resume.texte).toContain('Tout est finançable');
    leResumeEstLePlan(lu);
  });
});
