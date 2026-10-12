// @vitest-environment jsdom
/**
 * Tests du codeur pour #364 — « La section Revenus et charges fixes sert à l'assistant et à l'écran Flux prévus » :
 * l'écran Flux prévus et l'assistant ouvert sur la section, sur l'application montée sans navigateur (`ecran.ts`),
 * au jour des tests. Ce qui se lit ici est ce que l'écran montre et ce que le projet enregistré porte. Chaque titre
 * dit le point du « Fait quand » qu'il vérifie. Que les étapes de l'assistant complet restent ce qu'elles sont
 * (point 2) se vérifie par les tests que le point nomme.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, MAIN_ACCOUNT_ID, alive, budgetSuggestions, euros, type PlannedFlow } from '@tirelire/core';
import { app, attendre, champ, champs, cliquer, cliquerExactement, ecran, ouvrirLApplication, presser, projet, saisir, t, tous } from './ecran';

async function ouvrir(): Promise<void> {
  expect(await ecran('Flux prévus'), 'l’écran Flux prévus est introuvable').toBe(true);
  expect(t(document.querySelector('main h1'))).toBe('Flux prévus');
}
async function ouvrirLExemple(): Promise<void> {
  await ouvrirLApplication();
  expect(await cliquer('Charger l\'exemple')).toBe(true);
  await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A'), 'l’exemple');
  await ouvrir();
}
/** Les lignes de la section à l'écran, groupe par groupe : le titre du groupe, l'identifiant de la ligne (par son nom et son montant), ce qu'elle dit dessous. */
function lignes(): Array<{ groupe: string; nom: string; montant: string; sous: string }> {
  const sortie: Array<{ groupe: string; nom: string; montant: string; sous: string }> = [];
  let groupe = '';
  for (const e of tous('main h2, main .ligne-flux')) {
    if (e.tagName === 'H2') groupe = t(e);
    else
      sortie.push({
        groupe,
        nom: (e.querySelector('input.nom') as HTMLInputElement).value,
        montant: (e.querySelector('input.mt') as HTMLInputElement).value,
        sous: tous('.suite', e).map(t).join(' · '),
      });
  }
  return sortie;
}
const ligneDe = (nom: string, i = 0) => tous('main .ligne-flux').filter((l) => (l.querySelector('input.nom') as HTMLInputElement).value === nom)[i];
async function geste(nom: string, libelle: string, i = 0) {
  const b = tous<HTMLButtonElement>('button', ligneDe(nom, i)).find((x) => t(x) === libelle);
  expect(b, `« ${nom} » : pas de « ${libelle} »`).toBeTruthy();
  await presser(b!);
}
const raccourcisSous = (groupe: string): string[] => {
  const h = tous('main h2').find((x) => t(x) === groupe);
  let e = h?.nextElementSibling ?? null;
  while (e && e.tagName !== 'H2' && !e.classList.contains('propositions')) e = e.nextElementSibling;
  return e?.classList.contains('propositions') ? tous('.prop .n', e).map((n) => t(n).replace(/^\+\s*/, '')) : [];
};
const flux = (): PlannedFlow[] => alive(projet().plannedFlows);
async function completerAvecLAssistant() {
  const a = tous<HTMLAnchorElement>('main a').find((x) => t(x) === 'Compléter avec l’assistant');
  expect(a, 'pas de « Compléter avec l’assistant »').toBeTruthy();
  await presser(a!);
}
const exemple = budgetSuggestions();
const nomsDeLExemple = (genre: 'incomes' | 'charges') => [...new Set(exemple[genre].map((f) => f.name))];

describe('[niveau 4] #364 · 6, I5 — sur une base vide, l’écran porte les raccourcis, et rien n’est créé d’office', () => {
  it('aucun flux ; sous chaque groupe, ses raccourcis et son bouton d’ajout ; l’assistant est offert ; un raccourci crée le flux avec toutes ses versions, et disparaît', async () => {
    await ouvrirLApplication();
    await ouvrir();
    expect(flux()).toEqual([]);
    expect(tous('main .ligne-flux')).toHaveLength(0);
    expect(raccourcisSous('Revenus')).toEqual(nomsDeLExemple('incomes'));
    expect(raccourcisSous('Charges fixes')).toEqual(nomsDeLExemple('charges'));
    const boutons = tous('main button').map(t);
    expect(boutons).toEqual(expect.arrayContaining(['Ajouter un revenu', 'Ajouter une charge fixe', 'Ajouter une échéance ou un virement']));
    expect(boutons).not.toContain('Ajouter un flux');
    expect(tous('main a').map(t)).toContain('Compléter avec l’assistant');

    expect(await cliquer('+ Salaire')).toBe(true);
    const salaires = flux().filter((f) => f.name === 'Salaire');
    const versions = exemple.incomes.filter((f) => f.name === 'Salaire');
    expect(salaires).toHaveLength(versions.length);
    expect(salaires.map((f) => [f.amount, f.labelPattern, f.dateWindowDays, f.amountTolerance, !!f.variable, f.activeFrom, f.activeTo, f.accountId])).toEqual(
      versions.map((v) => [v.amount, v.labelPattern, v.dateWindowDays, v.amountTolerance, !!v.variable, v.activeFrom, v.activeTo, MAIN_ACCOUNT_ID]),
    );
    expect(raccourcisSous('Revenus')).not.toContain('Salaire');
    expect(lignes().filter((l) => l.nom === 'Salaire').map((l) => l.groupe)).toEqual(versions.map(() => 'Revenus'));
  });
});

describe('[niveau 4] #364 · 3 — les revenus et les charges fixes sont les lignes de la section', () => {
  it('dans l’ordre du projet ; corrigée sur place, une ligne s’écrit aussitôt et ne change pas de place ; le filtre d’état les range', async () => {
    await ouvrirLExemple();
    const ordre = (genre: string) => flux().filter((f) => f.kind === genre).map((f) => f.name);
    expect(lignes().filter((l) => l.groupe === 'Revenus').map((l) => l.nom)).toEqual(ordre('income'));
    expect(lignes().filter((l) => l.groupe === 'Charges fixes').map((l) => l.nom)).toEqual(ordre('fixedCharge'));

    const avant = lignes().map((l) => l.nom);
    await saisir(ligneDe('Allocations')!.querySelector('input.mt') as HTMLInputElement, '9 000,00');
    expect(flux().find((f) => f.name === 'Allocations')?.amount).toBe(euros(9000));
    expect(lignes().map((l) => l.nom), 'la ligne corrigée a changé de place').toEqual(avant);
    await saisir(ligneDe('Électricité')!.querySelector('input.mt') as HTMLInputElement, '12,00');
    expect(flux().find((f) => f.name === 'Électricité')?.amount, 'le signe suit le genre').toBe(-euros(12));

    // Le salaire revalorisé est à venir (D51) : éteindre « À venir » le range.
    expect(tous('main .ligne-flux .pill.dim').map(t)).toContain('à venir');
    const b = tous<HTMLButtonElement>('main button.filtre').find((x) => t(x).startsWith('À venir'))!;
    await presser(b);
    expect(lignes().filter((l) => l.nom === 'Salaire')).toHaveLength(1);
  });

  it('« Supprimer » demande confirmation ; refusée, rien ne part', async () => {
    await ouvrirLExemple();
    const avant = window.confirm;
    let question = '';
    try {
      window.confirm = (m?: string) => ((question = m ?? ''), false);
      await geste('Allocations', 'Supprimer');
      expect(question).toContain('Allocations');
      expect(flux().some((f) => f.name === 'Allocations')).toBe(true);
      window.confirm = () => true;
      await geste('Allocations', 'Supprimer');
      expect(flux().some((f) => f.name === 'Allocations')).toBe(false);
      expect(tous('main .ligne-flux button').map(t)).not.toContain('×');
    } finally {
      window.confirm = avant;
    }
  });
});

describe('[niveau 4] #364 · 4 — le panneau des champs avancés', () => {
  it('« Modifier » ouvre sous la ligne « Modifier le flux — nom », réduit à ce que la ligne ne corrige pas, et le genre entre revenu et charge fixe seulement', async () => {
    await ouvrirLExemple();
    await geste('Loyer locatif', 'Modifier');
    const panneau = ligneDe('Loyer locatif')!.nextElementSibling as HTMLElement;
    expect(panneau.matches('form.edit.attached')).toBe(true);
    expect(t(panneau.querySelector('.titre-panneau'))).toBe('Modifier le flux — Loyer locatif');
    expect(champs().map((c) => c.libelle)).toEqual([
      'Type',
      'Catégorie',
      'Fenêtre des échéances (± jours)',
      'Tolérance de montant (€)',
      'Tolérance de montant (%)',
      'Motif de libellé (regex)',
      'Actif à partir du',
      "Actif jusqu'au",
      'Montant variable (reprise à confirmer)',
      'Verrouiller les opérations que ce flux reprend',
    ]);
    expect([...(champ('Type').el as HTMLSelectElement).options].map((o) => o.value)).toEqual(['income', 'fixedCharge']);
  });

  it('changer le genre garde le flux, ses reprises et les parts de son action ; ce que la ligne a corrigé, panneau ouvert, reste ; la ligne passe dans l’autre groupe, à sa place', async () => {
    await ouvrirLExemple();
    const salaire = flux().find((f) => f.id === 'flow-salaire')!;
    const parts = [{ tirelireId: alive(projet().tirelires)[0]!.id, share: { kind: 'fixed' as const, amount: euros(100) } }];
    app.upsert('plannedFlows', { ...salaire, action: { ...salaire.action, allocation: parts } });
    const reprises = () => alive(projet().operations).filter((o) => o.plannedFlowId === 'flow-salaire');
    const avant = reprises();
    expect(avant.length, 'l’exemple n’a aucune reprise du salaire : ce test ne prouverait rien').toBeGreaterThan(0);
    const i = flux().filter((f) => f.name === 'Salaire').findIndex((f) => f.id === 'flow-salaire');
    await geste('Salaire', 'Modifier', i);
    await saisir(ligneDe('Salaire', i)!.querySelector('input.mt') as HTMLInputElement, '3 333,00');
    await saisir(champ('Type').el, 'fixedCharge');
    await saisir(champ('Motif de libellé (regex)').el, 'PAIE');
    expect(await cliquerExactement('Enregistrer')).toBe(true);
    const apres = flux().find((f) => f.id === 'flow-salaire')!;
    expect(apres.kind).toBe('fixedCharge');
    expect(apres.amount, 'la correction faite sur la ligne, panneau ouvert, s’est perdue').toBe(-euros(3333));
    expect(apres.labelPattern).toBe('PAIE');
    expect(apres.action?.allocation).toEqual(parts);
    expect(reprises()).toEqual(avant);
    const charges = flux().filter((f) => f.kind === 'fixedCharge').map((f) => f.id);
    const vues = tous('main .ligne-flux').filter((l) => {
      let x = l.previousElementSibling;
      while (x && x.tagName !== 'H2') x = x.previousElementSibling;
      return t(x) === 'Charges fixes';
    });
    expect(vues).toHaveLength(charges.length);
    expect(charges.indexOf('flow-salaire')).toBeGreaterThanOrEqual(0);
  });

  it('un motif de libellé invalide est refusé, et le dit', async () => {
    await ouvrirLExemple();
    await geste('Loyer locatif', 'Modifier');
    await saisir(champ('Motif de libellé (regex)').el, 'LOYER(');
    expect(await cliquerExactement('Enregistrer')).toBe(true);
    expect(tous('main .err').map(t)).toContain('Motif de libellé invalide (expression régulière).');
    expect(flux().find((f) => f.name === 'Loyer locatif')?.labelPattern).toBe('LOYER');
  });
});

describe('[niveau 4] #364 · 5 — l’ajout dans l’écran', () => {
  it('« Ajouter un revenu » ouvre sous lui le formulaire de la section, intitulé comme lui ; ses aides, champs avancés compris, viennent d’une même ligne de l’exemple ; nom et montant de l’aide font ce que fait le raccourci', async () => {
    await ouvrirLApplication();
    await ouvrir();
    expect(await cliquerExactement('Ajouter un revenu')).toBe(true);
    const form = document.querySelector('main form.edit') as HTMLFormElement;
    expect(t(form.querySelector('.titre-panneau'))).toBe('Ajouter un revenu');
    const v = exemple.incomes.find((f) => f.name === 'Salaire' && !f.activeFrom)!;
    expect(champ('Quoi ?').aide).toBe('Salaire');
    expect(champ('Combien ?').aide).toBe('3 400,00');
    expect(champ('Motif de libellé (regex)')).toMatchObject({ aide: v.labelPattern, valeur: '' });
    expect(champ('Fenêtre des échéances (± jours)').valeur).toBe(String(v.dateWindowDays));
    expect(champ('Tolérance de montant (%)').valeur).toBe(String(v.amountTolerance?.pct));
    expect(champ('Tolérance de montant (€)').aide, 'l’exemple ne donne pas de tolérance en euros : pas d’aide').toBe('');
    expect(champ("Actif jusqu'au").valeur).toBe(v.activeTo);
    expect(champ('Catégorie').valeur, 'l’exemple ne donne pas de catégorie au flux').toBe('');
    await saisir(champ('Quoi ?').el, 'Salaire');
    await saisir(champ('Combien ?').el, '3 400,00');
    expect(await cliquerExactement('Ajouter')).toBe(true);
    expect(document.querySelector('main form.edit'), 'le formulaire reste ouvert').toBeNull();
    const salaires = flux().filter((f) => f.name === 'Salaire');
    expect(salaires.map((f) => [f.amount, f.activeFrom, f.activeTo, f.labelPattern])).toEqual(
      exemple.incomes.filter((f) => f.name === 'Salaire').map((f) => [f.amount, f.activeFrom, f.activeTo, f.labelPattern]),
    );
  });

  it('un flux saisi autrement prend ce que disent ses champs avancés : touchés, ou à la valeur de la ligne d’aide', async () => {
    await ouvrirLApplication();
    await ouvrir();
    expect(await cliquerExactement('Ajouter une charge fixe')).toBe(true);
    await saisir(champ('Quoi ?').el, 'Cantine');
    await saisir(champ('Combien ?').el, '80,00');
    await saisir(champ('Motif de libellé (regex)').el, 'CANTINE');
    await saisir(champ("Actif jusqu'au").el, '');
    const v = exemple.charges[0]!;
    expect(await cliquerExactement('Ajouter')).toBe(true);
    const c = flux().find((f) => f.name === 'Cantine')!;
    expect(c).toMatchObject({ kind: 'fixedCharge', amount: -euros(80), labelPattern: 'CANTINE', dateWindowDays: v.dateWindowDays, accountId: MAIN_ACCOUNT_ID });
    expect(c.activeTo).toBeUndefined();
    expect(flux().filter((f) => f.name === v.name), 'saisi autrement, il n’est pas le raccourci').toEqual([]);
  });
});

describe('[niveau 4] #364 · 7 — ce que l’écran garde en propre', () => {
  it('« Ajouter une échéance ou un virement » ouvre le panneau d’aujourd’hui, intitulé comme lui, son type limité à ces deux genres ; une échéance garde sa ligne et son panneau', async () => {
    await ouvrirLExemple();
    expect(await cliquer('Ajouter une échéance ou un virement')).toBe(true);
    const form = document.querySelector('main form.edit') as HTMLFormElement;
    expect(t(form.querySelector('.titre-panneau'))).toBe('Ajouter une échéance ou un virement');
    expect([...(champ('Type').el as HTMLSelectElement).options].map((o) => o.value)).toEqual(['dueDate', 'transfer']);
    await cliquerExactement('Annuler');
    const echeance = tous('main .row').find((r) => /provisionnée par|aucune tirelire|ne porte aucun besoin/.test(t(r)));
    expect(echeance, 'aucune échéance à l’écran').toBeTruthy();
    await presser(tous<HTMLButtonElement>('button', echeance).find((b) => t(b) === 'Modifier')!);
    expect(champs().map((c) => c.libelle)).toEqual(expect.arrayContaining(['Nom', 'Type', 'Montant', 'Compte', 'Tirelire qui paie']));
  });
});

describe('[niveau 4] #364 · 8 — l’explication repliée', () => {
  it('« Comment ça marche ? » replie le texte de chaque genre et ce que l’écran explique de la sélection et de l’ordre permanent', async () => {
    await ouvrirLApplication();
    await ouvrir();
    const d = document.querySelector('main details.explication') as HTMLDetailsElement;
    expect(d).toBeTruthy();
    expect(d.open).toBe(false);
    expect(t(d.querySelector('summary'))).toBe('Comment ça marche ?');
    expect(t(d)).toContain('Déclarez ce qui rentre, avec la date à laquelle ça tombe.');
    expect(t(d)).toContain('Loyer, abonnements, mensualités');
    expect(t(d)).toContain('Le compte, le motif de libellé, la tolérance de montant et la fenêtre de dates sont les critères du flux');
    expect(t(d)).toContain('ordre permanent');
    const horsRepli = t(document.querySelector('main')).replace(t(d), '');
    expect(horsRepli).toContain('Revenus, charges fixes, échéances payées par une tirelire. Le montant se saisit en positif.');
    expect(horsRepli).not.toContain('Le compte, le motif de libellé');
  });
});

describe('[niveau 4] #364 · 9 — l’assistant ouvert sur la section', () => {
  it('sur une base vide, ouvert depuis l’écran et validé sans rien toucher : les revenus et charges fixes de l’exemple, toutes leurs versions, et le jour de début de période ; rien d’autre', async () => {
    await ouvrirLApplication();
    await ouvrir();
    await completerAvecLAssistant();
    expect(t(document.querySelector('main h1'))).toBe('Compléter mes revenus et charges fixes');
    expect(tous('main .wizard-steps .wstep').map(t)).toEqual(['Revenus', 'Charges fixes', 'Résumé']);
    expect(t(document.querySelector('main')).includes('Découpage du budget')).toBe(true);
    expect(flux(), 'rien ne s’écrit avant la validation').toEqual([]);
    expect(await cliquer('Suivant')).toBe(true);
    expect(await cliquer('Suivant')).toBe(true);
    expect(t(document.querySelector('main')).includes('Où dort chaque tirelire')).toBe(false);
    expect(await cliquerExactement('Valider')).toBe(true);
    const p = projet();
    const cle = (f: { name: string; amount: number; activeFrom?: string; activeTo?: string; labelPattern?: string }) => `${f.name}|${Math.abs(f.amount)}|${f.activeFrom ?? ''}|${f.activeTo ?? ''}|${f.labelPattern ?? ''}`;
    expect(alive(p.plannedFlows).map(cle).sort()).toEqual([...exemple.incomes, ...exemple.charges].map(cle).sort());
    expect(alive(p.plannedFlows).every((f) => f.accountId === MAIN_ACCOUNT_ID && (f.kind === 'income' || f.kind === 'fixedCharge'))).toBe(true);
    expect(p.settings.periodStartDay).toBe(exemple.periodStartDay);
    expect(p.settings.principalCushion).toBe(DEFAULT_SETTINGS.principalCushion);
    expect(alive(p.tirelires)).toEqual([]);
    expect(alive(p.needs)).toEqual([]);
    expect(alive(p.categories)).toEqual([]);
    expect(alive(p.accounts).map((a) => a.id)).toEqual([MAIN_ACCOUNT_ID]);
    expect(await cliquerExactement('Revenir aux flux prévus')).toBe(true);
    expect(t(document.querySelector('main h1'))).toBe('Flux prévus');
  });

  it('sur l’exemple, rien ne se garnit, et la validation n’écrit que ce que les étapes ont changé : ni échéance, ni ordre, ni tirelire, ni compte', async () => {
    await ouvrirLExemple();
    const avant = projet();
    await completerAvecLAssistant();
    await saisir(ligneDe('Allocations')!.querySelector('input.mt') as HTMLInputElement, '150,00');
    expect(await cliquer('Suivant')).toBe(true);
    expect(await cliquer('Suivant')).toBe(true);
    expect(await cliquerExactement('Valider')).toBe(true);
    const p = projet();
    const sans = (l: PlannedFlow[]) => l.filter((f) => f.name !== 'Allocations');
    expect(alive(p.plannedFlows).find((f) => f.name === 'Allocations')?.amount).toBe(euros(150));
    const comparable = (l: PlannedFlow[]) => sans(alive(l)).map((f) => ({ ...f, hlc: undefined, updatedAt: undefined }));
    expect(comparable(p.plannedFlows)).toEqual(comparable(avant.plannedFlows));
    expect(alive(p.tirelires)).toEqual(alive(avant.tirelires));
    expect(alive(p.accounts)).toEqual(alive(avant.accounts));
    expect(alive(p.categories)).toEqual(alive(avant.categories));
    expect(p.settings).toEqual(avant.settings);
  });
});
