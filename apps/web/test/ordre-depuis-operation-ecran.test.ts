// @vitest-environment jsdom
/**
 * Tests du codeur de #435 — « Proposer, depuis l'opération, d'en faire l'ordre permanent » (#40, U3),
 * côté écran : l'application montée sans navigateur (`ecran.ts`). Chaque `describe` nomme le point du
 * « Fait quand » qu'il vérifie.
 *
 * Données inventées (D84) : un compte principal, un Livret A, un compte joint sans tirelire ; sur le
 * livret, une tirelire qui porte une échéance (400 €/mois) et un objectif (250 €/mois) : le budget y
 * demande 650 €, et le plan y propose un ordre. Lecture au jour des tests (20 septembre 2026), période
 * du 28 août au 27 septembre. Deux virements importés de 600 € vers le livret, du 29 août et du
 * 2 septembre, l'un rapproché par appariement, l'autre désigné à la main (verrouillé) ; un débit non
 * traité qui n'est encore désigné vers aucun compte ; un virement vers le compte joint ; un crédit.
 */
import { describe, expect, it } from 'vitest';
import { emptyLedger, euros, normalizeLabel, type Ledger, type Operation } from '@tirelire/core';
import { shortDate } from '../src/lib/format';
import { allerA, app, cliquer, cliquerExactement, ouvrirLApplication, presser, projet, rendu, rouvrirLApplication, saisir, t, tous } from './ecran';

const CC = 'acc-principal';
const LIVRET = 'livret';
const JOINT = 'joint';
const mensuel = (anchorDate: string) => ({ interval: 1, unit: 'month' as const, anchorDate });

function op(id: string, montant: number, date: string, label: string, o: Partial<Operation> = {}): Operation {
  return { id, accountId: CC, origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount: montant, state: 'untreated', ...o };
}

/** Le projet de départ ; `ops` remplace les opérations, s'il est donné. */
function projetDeDepart(ops?: Operation[], tirelires = true): Ledger {
  const l = emptyLedger({ periodStartDay: 28, orderRounding: euros(10) });
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(3000), openingDate: '2026-08-27' },
    { id: LIVRET, name: 'Livret A', kind: 'epargne', openingBalance: 0, openingDate: '2026-08-27' },
    { id: JOINT, name: 'Compte joint', kind: 'courant', openingBalance: 0, openingDate: '2026-08-27' },
  );
  if (tirelires) {
    l.tirelires.push(
      { id: 'taxe', name: 'Taxe foncière', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28' },
      { id: 'vac', name: 'Vacances', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28' },
    );
    l.needs.push(
      { id: 'n-taxe', tirelireId: 'taxe', kind: 'dueDate', amount: euros(4800), periodicity: { interval: 12, unit: 'month', anchorDate: '2027-08-15' }, priority: 10 },
      { id: 'n-vac', tirelireId: 'vac', kind: 'goal', amount: euros(9000), monthlyAmount: euros(250), priority: 30 },
    );
  }
  l.plannedFlows.push({ id: 'salaire', name: 'Salaire', kind: 'income', amount: euros(2500), accountId: CC, periodicity: mensuel('2026-08-28'), dateWindowDays: 3 });
  l.operations.push(
    ...(ops ?? [
      op('vir-aout', -euros(600), '2026-08-29', 'VIR SEPA EPARGNE LIVRET A M DUPONT', { state: 'reconciled', transferAccountId: LIVRET }),
      op('vir-sept', -euros(600), '2026-09-02', 'VIR SEPA EPARGNE LIVRET A M DUPONT', { state: 'locked', transferAccountId: LIVRET }),
      op('vir-brut', -euros(300), '2026-09-05', 'VIR SEPA MISE DE COTE M DUPONT'),
      op('vir-joint', -euros(200), '2026-09-03', 'VIR SEPA COMPTE JOINT', { state: 'locked', transferAccountId: JOINT }),
      op('salaire-sept', euros(2500), '2026-08-28', 'VIR SALAIRE ACME', { state: 'reconciled' }),
    ]),
  );
  return l;
}

async function ouvrir(l: Ledger, onglet = 'Opérations'): Promise<void> {
  await ouvrirLApplication();
  await app.replaceWith(l);
  await rendu();
  await allerA(onglet);
}

const AOUT = shortDate('2026-08-29');
const SEPT = shortDate('2026-09-02');
const BRUT = shortDate('2026-09-05');
const PROPOSITION = 'Proposition : en faire votre ordre permanent vers « Livret A »';

/** Les lignes d'opération de l'écran, chacune avec son libellé et le texte de sa ligne (hors l'opération ouverte). */
function lignes(): Array<{ libelle: string; texte: string; ligne: HTMLElement }> {
  return tous('main .card > .row').flatMap((r) => {
    const b = r.querySelector<HTMLButtonElement>(':scope > button.label');
    return b ? [{ libelle: t(b.querySelector('strong')), texte: t(b), ligne: r }] : [];
  });
}
const ligneDu = (date: string) => lignes().find((l) => l.texte.includes(date));

async function ouvrirLOperation(date: string): Promise<HTMLElement> {
  const l = ligneDu(date);
  expect(l, `pas de ligne du ${date}`).toBeTruthy();
  await presser(l!.ligne.querySelector<HTMLButtonElement>(':scope > button.label')!);
  return ligneDu(date)!.ligne;
}

describe('[niveau 4] #435 · 1 et 2. les opérations qui se proposent, sans chercher', () => {
  it('à l’ouverture, filtre par défaut : les deux virements vers le livret se lisent avec leur proposition, rapproché ou verrouillé', async () => {
    await ouvrir(projetDeDepart());
    const vus = lignes();
    const proposes = vus.filter((l) => l.texte.includes(PROPOSITION)).map((l) => l.texte);
    expect(proposes).toHaveLength(2);
    expect(proposes.some((x) => x.includes(AOUT) && x.includes('rapprochée'))).toBe(true);
    expect(proposes.some((x) => x.includes(SEPT) && x.includes('verrouillée'))).toBe(true);
    // Aucune autre opération ne le dit : ni le virement vers le compte joint, où le budget ne demande rien, ni un crédit.
    expect(tous('main').some((m) => t(m).includes('ordre permanent vers « Compte joint »'))).toBe(false);
    expect(vus.filter((l) => !l.texte.includes('Livret A')).every((l) => !l.texte.includes('Proposition : en faire'))).toBe(true);
  });

  it('une opération désignée à la main comme virement vers le livret ne quitte pas l’écran, et se propose aussitôt', async () => {
    await ouvrir(projetDeDepart());
    const ligne = await ouvrirLOperation(BRUT);
    const choix = ligne.querySelector<HTMLSelectElement>('select.btn')!;
    expect(t(choix.options[0])).toBe('Virement interne vers…');
    await saisir(choix, LIVRET);
    const apres = ligneDu(BRUT);
    expect(apres, 'la ligne a quitté l’écran').toBeTruthy();
    expect(apres!.texte).toContain('verrouillée');
    expect(apres!.texte).toContain(PROPOSITION);
    expect(projet().plannedFlows.filter((f) => f.kind === 'transfer')).toHaveLength(0); // rien d'autre ne s'écrit
  });

  it('sans tirelire (U5), rien ne se propose', async () => {
    await ouvrir(projetDeDepart(undefined, false));
    expect(t(document.querySelector('main'))).not.toContain('Proposition : en faire');
  });
});

describe('[niveau 4] #435 · 3. ce qui se propose', () => {
  it('l’opération ouverte montre le compte, le montant, la ventilation, le jour et l’écart, ce que devient l’opération, et les plus anciens', async () => {
    await ouvrir(projetDeDepart());
    const ligne = await ouvrirLOperation(SEPT);
    const bloc = ligne.querySelector('.ordre-depuis-operation');
    expect(bloc, 'pas d’ordre proposé dans l’opération ouverte').toBeTruthy();
    const texte = t(bloc);
    expect(texte).toContain('Ordre permanent vers « Livret A »');
    expect(texte).toContain('600,00');
    const parts = tous('.ventilation .row.part', bloc!).map(t);
    expect(parts.some((p) => p.includes('Taxe foncière') && p.includes('400,00'))).toBe(true);
    expect(parts.some((p) => p.includes('Vacances') && p.includes('200,00'))).toBe(true);
    expect(texte).toContain('le 2 de chaque mois');
    expect(texte).toMatch(/jusqu’à \d+ jours? avant ou après/);
    expect(texte).toContain('première occurrence de l’ordre, qu’elle reprend : elle prend ses parts.');
    expect(texte).toContain(`L’ordre commencera avec ce virement du ${SEPT}`);
    expect(texte).toContain(AOUT);
    // Le motif tiré du libellé n'est pas un libellé à recopier : pas de « Copier » ici.
    expect(bloc!.querySelector('.libelle-a-copier')).toBeNull();
    const primaires = tous<HTMLButtonElement>('button.primary', bloc!).map(t);
    expect(primaires).toContain('Enregistrer mon ordre permanent');
    expect(tous<HTMLButtonElement>('button', bloc!).map(t)).toContain('Modifier avant d’enregistrer');
  });

  it('une opération qui porte sa propre ventilation le dit', async () => {
    const l = projetDeDepart();
    l.subOperations.push({ id: 'p1', operationId: 'vir-sept', tirelireId: 'vac', share: { kind: 'variable' } });
    await ouvrir(l);
    const ligne = await ouvrirLOperation(SEPT);
    expect(t(ligne.querySelector('.ordre-depuis-operation'))).toContain('elle garde sa propre ventilation');
  });
});

describe('[niveau 4] #435 · 4. le garder, en un geste', () => {
  it('l’ordre et la reprise s’écrivent ; la ligne dit la reprise et ses parts ; plus rien ne se propose ; tout se relit après un redémarrage', async () => {
    await ouvrir(projetDeDepart());
    const ligne = await ouvrirLOperation(SEPT);
    await presser(tous<HTMLButtonElement>('button.primary', ligne.querySelector('.ordre-depuis-operation')!).find((b) => t(b) === 'Enregistrer mon ordre permanent')!);

    const lire = () => {
      const p = projet();
      const ordre = p.plannedFlows.find((f) => f.kind === 'transfer' && f.counterpartAccountId === LIVRET && !f.deletedAt);
      const o = p.operations.find((x) => x.id === 'vir-sept')!;
      const parts = p.subOperations.filter((s) => s.operationId === 'vir-sept' && !s.deletedAt);
      return { ordre, o, parts };
    };
    const verifier = () => {
      const { ordre, o, parts } = lire();
      expect(ordre, 'aucun ordre enregistré').toBeTruthy();
      expect(ordre!.amount).toBe(-euros(600));
      expect(ordre!.periodicity.anchorDate).toBe('2026-09-02');
      expect(ordre!.labelPattern).toBeTruthy();
      expect(o.plannedFlowId).toBe(ordre!.id);
      expect(o.plannedDate).toBe('2026-09-02');
      expect(o.state).toBe('locked'); // verrouillée, elle le reste (D22)
      expect(parts.map((s) => s.tirelireId).sort()).toEqual(['taxe', 'vac']);
    };
    verifier();
    await rendu();
    const apres = ligneDu(SEPT);
    expect(apres, 'la ligne a quitté l’écran').toBeTruthy();
    expect(apres!.texte).toMatch(new RegExp(`reprend l’opération prévue « .+ » du ${SEPT} · écart nul`));
    expect(apres!.texte).toContain('Taxe foncière');
    expect(apres!.texte).toContain('Vacances');
    expect(t(document.querySelector('main'))).not.toContain('Proposition : en faire');

    await rouvrirLApplication();
    verifier();
  });
});

describe('[niveau 4] #435 · 5, 6 et 7. le corriger, le refuser ; rien ne s’écrit avant le geste', () => {
  it('le panneau, nommé, suit le montant saisi ; annuler n’écrit rien, la base relue est identique', async () => {
    await ouvrir(projetDeDepart());
    const avant = JSON.stringify(projet());
    const ligne = await ouvrirLOperation(SEPT);
    await cliquer('Modifier avant d’enregistrer');
    const panneau = ligne.querySelector<HTMLFormElement>('.panneau-ventilation');
    expect(panneau, 'pas de panneau de correction').toBeTruthy();
    expect(t(panneau!.querySelector('.titre-panneau'))).toBe('Enregistrer mon ordre permanent — Livret A');
    const montant = tous<HTMLInputElement>('input', panneau!).find((i) => t(i.closest('label')).startsWith('Montant de l’ordre'))!;
    expect(montant.value).toBe('600,00');
    await saisir(montant, '500');
    const parts = tous('.ventilation .row.part', panneau!).map(t);
    expect(parts.some((p) => p.includes('Taxe foncière') && p.includes('400,00'))).toBe(true);
    expect(parts.some((p) => p.includes('Vacances') && p.includes('100,00'))).toBe(true);
    await cliquerExactement('Annuler');
    expect(ligne.querySelector('.panneau-ventilation')).toBeNull();
    expect(JSON.stringify(projet())).toBe(avant);
    // La proposition reste offerte.
    expect(ligneDu(SEPT)!.texte).toContain(PROPOSITION);
  });

  it('« Enregistrer » écrit exactement ce que montre le panneau, ancré sur l’opération, avec le motif tiré de son libellé', async () => {
    await ouvrir(projetDeDepart());
    const ligne = await ouvrirLOperation(SEPT);
    await cliquer('Modifier avant d’enregistrer');
    const panneau = ligne.querySelector<HTMLFormElement>('.panneau-ventilation')!;
    const montant = tous<HTMLInputElement>('input', panneau).find((i) => t(i.closest('label')).startsWith('Montant de l’ordre'))!;
    await saisir(montant, '500');
    await presser(tous<HTMLButtonElement>('button', panneau).find((b) => t(b) === 'Enregistrer')!);
    const p = projet();
    const ordre = p.plannedFlows.find((f) => f.kind === 'transfer' && f.counterpartAccountId === LIVRET && !f.deletedAt)!;
    expect(ordre.amount).toBe(-euros(500));
    expect(ordre.periodicity.anchorDate).toBe('2026-09-02');
    expect(ordre.labelPattern).toMatch(/EPARGNE/);
    const parts = ordre.action?.allocation ?? [];
    expect(parts.map((a) => a.tirelireId).sort()).toEqual(['taxe', 'vac']);
    expect(parts.find((a) => a.tirelireId === 'taxe')!.share).toEqual({ kind: 'fixed', amount: -euros(400) });
    const o = p.operations.find((x) => x.id === 'vir-sept')!;
    expect(o.plannedFlowId).toBe(ordre.id);
    expect(p.subOperations.filter((s) => s.operationId === 'vir-sept' && !s.deletedAt).map((s) => s.tirelireId).sort()).toEqual(['taxe', 'vac']);
  });

  it('fermer l’opération après avoir ouvert le panneau n’écrit rien', async () => {
    await ouvrir(projetDeDepart());
    const avant = JSON.stringify(projet());
    await ouvrirLOperation(SEPT);
    await cliquer('Modifier avant d’enregistrer');
    await cliquerExactement('Fermer');
    expect(JSON.stringify(projet())).toBe(avant);
  });
});

describe('[niveau 4] #435 · 8 et 9. sur l’écran Plan', () => {
  it('avant l’ordre : la carte du livret dit les virements qui peuvent devenir l’ordre, et mène aux opérations', async () => {
    await ouvrir(projetDeDepart(), 'Plan');
    const carte = tous('main .card').find((c) => t(c.querySelector(':scope > .row strong')) === 'Livret A')!;
    const bloc = carte.querySelector('.virements-ordre');
    expect(bloc, 'la carte ne dit pas les virements').toBeTruthy();
    expect(t(bloc)).toContain(AOUT);
    expect(t(bloc)).toContain(SEPT);
    expect(t(bloc)).toContain('600,00');
    await presser(tous<HTMLButtonElement>('button', bloc!).find((b) => t(b).includes('dans les opérations'))!);
    expect(lignes().filter((l) => l.texte.includes(PROPOSITION))).toHaveLength(2);
  });

  it('sans un tel virement, la carte ne le dit pas', async () => {
    await ouvrir(projetDeDepart([]), 'Plan');
    expect(document.querySelector('.virements-ordre')).toBeNull();
  });

  it('après l’ordre : la carte le montre enregistré, son motif comme ce que l’import reconnaît, sans « Copier »', async () => {
    await ouvrir(projetDeDepart());
    const ligne = await ouvrirLOperation(SEPT);
    await presser(tous<HTMLButtonElement>('button.primary', ligne.querySelector('.ordre-depuis-operation')!).find((b) => t(b) === 'Enregistrer mon ordre permanent')!);
    const motif = projet().plannedFlows.find((f) => f.kind === 'transfer' && f.counterpartAccountId === LIVRET)!.labelPattern!;
    await allerA('Plan');
    const carte = tous('main .card').find((c) => t(c.querySelector(':scope > .row strong')) === 'Livret A')!;
    const enregistre = carte.querySelector('.ordre-enregistre');
    expect(enregistre, 'pas d’ordre enregistré sur la carte').toBeTruthy();
    expect(t(enregistre)).toContain('600,00');
    expect(t(enregistre)).toContain('le 2 de chaque mois');
    expect(t(enregistre!.querySelector('.motif-reconnu'))).toContain(motif);
    expect(carte.querySelector('.libelle-a-copier')).toBeNull();
    expect(carte.querySelector('.virements-ordre')).toBeNull();
  });
});
