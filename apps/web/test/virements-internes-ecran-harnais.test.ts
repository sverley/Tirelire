// @vitest-environment jsdom
/**
 * Harnais d'audit de #488 — les virements internes sur l'écran Opérations, l'application montée sans
 * navigateur (`ecran.ts`), l'issue disant « Navigateur : aucun ». Les règles elles-mêmes :
 * `packages/core/test/virements-internes-harnais.test.ts`. Chaque `describe` nomme le point du « Fait
 * quand » ; chaque test porte son niveau (D83).
 *
 * Composé après le codage (auditeur.md, étape 2), parmi les tests du codeur
 * (`virements-internes-488-ecran.test.ts`, déplacé ici en entier). Sont de moi : au point 3, une
 * opération à deux candidats qui montre chacun ; au point 5, la suppression d'un côté apparié.
 * Niveaux : 0 pour le point 5 (un côté qui pointe dans le vide resterait dans la base) ; 1 pour la
 * proposition lue sans budget ni tirelire (I3, U5) et la désignation qui apparie le seul candidat (I2) ;
 * 2 pour le reste. Au troisième tour, le test du codeur (`virements-internes-488-doute-ecran.test.ts`,
 * déplacé ici en entier, à la fin) : la reprise qui se propose avec chacun des ordres (point 8), niveau 2.
 *
 * Données inventées (D84) : un compte principal, un compte de Léa, un Livret A, sans budget ni ordre (U5).
 * Un virement de 34 € du compte de Léa vers un club, et un remboursement de 34 € le même jour sur le
 * principal : la coïncidence du besoin. Un virement de 600 € du principal, et un crédit de 600 € le
 * lendemain sur le livret, encore non désigné.
 */
import { describe, expect, it } from 'vitest';
import { emptyLedger, euros, normalizeLabel, type Ledger, type Operation, type PlannedFlow } from '@tirelire/core';
import { shortDate } from '../src/lib/format';
import { allerA, app, ouvrirLApplication, presser, projet, rendu, saisir, t, tous } from './ecran';

const CC = 'acc-principal';
const LEA = 'acc-lea';
const LIVRET = 'acc-livret';

function op(id: string, accountId: string, date: string, label: string, amount: number, o: Partial<Operation> = {}): Operation {
  return { id, accountId, origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount, state: 'untreated', ...o };
}

function projetDeDepart(): Ledger {
  const l = emptyLedger();
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(2000), openingDate: '2026-08-01' },
    { id: LEA, name: 'Léa', kind: 'courant', openingBalance: 0, openingDate: '2026-08-01' },
    { id: LIVRET, name: 'Livret A', kind: 'epargne', openingBalance: 0, openingDate: '2026-08-01' },
  );
  l.operations.push(
    op('club', LEA, '2026-09-12', 'VIR SEPA CLUB DE FOOT', -euros(34)),
    op('cpam', CC, '2026-09-12', 'VIR RECU CPAM REMBOURSEMENT', euros(34)),
    op('vers-livret', CC, '2026-09-02', 'VIR SEPA MISE DE COTE', -euros(600)),
    op('recu-livret', LIVRET, '2026-09-03', 'VIR RECU', euros(600)),
  );
  return l;
}

async function ouvrir(l: Ledger): Promise<void> {
  await ouvrirLApplication();
  await app.replaceWith(l);
  await rendu();
  await allerA('Opérations');
}

function lignes(): Array<{ texte: string; ligne: HTMLElement }> {
  return tous('main .card > .row').flatMap((r) => {
    const b = r.querySelector<HTMLButtonElement>(':scope > button.label');
    return b ? [{ texte: t(b.querySelector('strong')) + ' | ' + t(b), ligne: r }] : [];
  });
}
const ligneDe = (libelle: string) => lignes().find((l) => l.texte.startsWith(libelle + ' |'));
const de = (id: string) => projet().operations.find((o) => o.id === id)!;

describe('#488 · 3. une proposition, sur l’écran Opérations', () => {
  it('[niveau 1] la proposition se lit sur le débit et sur le crédit, avec un bouton « Apparier » ; sans budget ni tirelire (U5)', async () => {
    await ouvrir(projetDeDepart());
    const club = ligneDe('VIR SEPA CLUB DE FOOT');
    const cpam = ligneDe('VIR RECU CPAM REMBOURSEMENT');
    expect(club?.texte).toContain(`Virement avec Compte principal du ${shortDate('2026-09-12')} ?`);
    expect(cpam?.texte).toContain(`Virement avec Léa du ${shortDate('2026-09-12')} ?`);
    for (const l of [club!, cpam!]) expect(tous('button.apparier', l.ligne).map(t)).toEqual(['Apparier']);
    // Rien ne s'écrit avant le geste.
    expect(de('club').transferOperationId).toBeUndefined();
  });

  it('[niveau 2] « Apparier » lie les deux côtés et les verrouille ; la proposition disparaît', async () => {
    await ouvrir(projetDeDepart());
    await presser(tous<HTMLButtonElement>('button.apparier', ligneDe('VIR SEPA CLUB DE FOOT')!.ligne)[0]!);
    expect([de('club').transferOperationId, de('club').transferAccountId, de('club').state]).toEqual(['cpam', CC, 'locked']);
    expect([de('cpam').transferOperationId, de('cpam').transferAccountId, de('cpam').state]).toEqual(['club', LEA, 'locked']);
    // Les deux côtés restent à l'écran, sans proposition ; l'autre paire, elle, se propose toujours.
    for (const libelle of ['VIR SEPA CLUB DE FOOT', 'VIR RECU CPAM REMBOURSEMENT']) {
      expect(ligneDe(libelle)?.texte, libelle).not.toContain('Virement avec');
      expect(tous('button.apparier', ligneDe(libelle)!.ligne), libelle).toHaveLength(0);
    }
    expect(ligneDe('VIR SEPA MISE DE COTE')?.texte).toContain('Virement avec Livret A');
  });

  it('[niveau 2] la proposition se lit quelles que soient les dates, même hors de la période', async () => {
    const l = projetDeDepart();
    l.operations = l.operations.map((o) => (o.id === 'club' || o.id === 'cpam' ? { ...o, date: '2025-03-12' } : o));
    await ouvrir(l);
    expect(ligneDe('VIR SEPA CLUB DE FOOT')?.texte).toContain(`Virement avec Compte principal du ${shortDate('2025-03-12')} ?`);
  });
  it('[niveau 2] une opération à deux candidats montre chacun, avec son bouton « Apparier »', async () => {
    const l = projetDeDepart();
    l.operations.push(op('recu-lea', LEA, '2026-09-01', 'VIR RECU', euros(600)));
    await ouvrir(l);
    const vers = ligneDe('VIR SEPA MISE DE COTE')!;
    expect(vers.texte).toContain(`Virement avec Livret A du ${shortDate('2026-09-03')} ?`);
    expect(vers.texte).toContain(`Virement avec Léa du ${shortDate('2026-09-01')} ?`);
    expect(tous('button.apparier', vers.ligne).map(t)).toEqual(['Apparier', 'Apparier']);
  });
});

describe('#488 · 4. désigner à la main un virement, sur l’écran Opérations', () => {
  it('[niveau 1] « Virement interne vers… » apparie l’autre côté, seul candidat : les deux verrouillés', async () => {
    await ouvrir(projetDeDepart());
    const l = ligneDe('VIR SEPA MISE DE COTE')!;
    await presser(l.ligne.querySelector<HTMLButtonElement>(':scope > button.label')!);
    const choix = ligneDe('VIR SEPA MISE DE COTE')!.ligne.querySelector<HTMLSelectElement>('select.btn')!;
    await saisir(choix, LIVRET);
    expect([de('vers-livret').transferOperationId, de('vers-livret').state]).toEqual(['recu-livret', 'locked']);
    expect([de('recu-livret').transferOperationId, de('recu-livret').transferAccountId, de('recu-livret').state]).toEqual(['vers-livret', CC, 'locked']);
  });
});

describe('#488 · 5. « Tout remettre à zéro » sur un côté apparié', () => {
  it('[niveau 0] l’autre côté ne désigne plus l’opération ni son compte, et garde son état', async () => {
    const l = projetDeDepart();
    l.operations = l.operations.map((o) =>
      o.id === 'vers-livret' ? { ...o, state: 'locked', transferAccountId: LIVRET, transferOperationId: 'recu-livret' } : o.id === 'recu-livret' ? { ...o, state: 'locked', transferAccountId: CC, transferOperationId: 'vers-livret' } : o,
    );
    await ouvrir(l);
    await allerA('Opérations');
    const filtre = tous<HTMLSelectElement>('main select').find((s) => [...s.options].some((o) => o.value === 'all'))!;
    await saisir(filtre, 'all');
    await presser(ligneDe('VIR SEPA MISE DE COTE')!.ligne.querySelector<HTMLButtonElement>(':scope > button.label')!);
    const remettre = tous<HTMLButtonElement>('button', ligneDe('VIR SEPA MISE DE COTE')!.ligne).find((b) => t(b) === 'Tout remettre à zéro')!;
    await presser(remettre);
    expect([de('vers-livret').transferOperationId, de('vers-livret').transferAccountId, de('vers-livret').state]).toEqual([undefined, undefined, 'untreated']);
    expect([de('recu-livret').transferOperationId, de('recu-livret').transferAccountId, de('recu-livret').state]).toEqual([undefined, undefined, 'locked']);
  });
  it('[niveau 0] « Supprimer » un côté apparié : l’autre côté ne le désigne plus ni son compte, et garde son état', async () => {
    const l = projetDeDepart();
    l.operations = l.operations.map((o) =>
      o.id === 'vers-livret' ? { ...o, state: 'locked', transferAccountId: LIVRET, transferOperationId: 'recu-livret' } : o.id === 'recu-livret' ? { ...o, state: 'reconciled', transferAccountId: CC, transferOperationId: 'vers-livret' } : o,
    );
    await ouvrir(l);
    const filtre = tous<HTMLSelectElement>('main select').find((s) => [...s.options].some((o) => o.value === 'all'))!;
    await saisir(filtre, 'all');
    await presser(ligneDe('VIR SEPA MISE DE COTE')!.ligne.querySelector<HTMLButtonElement>(':scope > button.label')!);
    const confirmer = window.confirm;
    window.confirm = () => true;
    try {
      await presser(tous<HTMLButtonElement>('button', ligneDe('VIR SEPA MISE DE COTE')!.ligne).find((b) => t(b) === 'Supprimer')!);
    } finally {
      window.confirm = confirmer;
    }
    expect(de('vers-livret').deletedAt).toBeTruthy();
    expect([de('recu-livret').transferOperationId, de('recu-livret').transferAccountId, de('recu-livret').state]).toEqual([undefined, undefined, 'reconciled']);
  });
});

// Le point 8 amendé une seconde fois (porteur, 16/10, « dans le doute, on propose ») : le test du codeur
// du troisième tour (`virements-internes-488-doute-ecran.test.ts`, déplacé ici en entier). Données
// inventées (D84) : les comptes de Léa et de Léane, un ordre vers chacune.
const LEANE = 'acc-leane';

function ordreEnfant(id: string, nom: string, vers: string, motif: string): PlannedFlow {
  return { id, name: nom, kind: 'transfer', amount: -euros(20), accountId: CC, counterpartAccountId: vers, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-01' }, dateWindowDays: 5, labelPattern: motif };
}

function projetLeaLeane(): Ledger {
  const l = emptyLedger();
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(2000), openingDate: '2026-08-01' },
    { id: LEA, name: 'Léa', kind: 'courant', openingBalance: 0, openingDate: '2026-08-01' },
    { id: LEANE, name: 'Léane', kind: 'courant', openingBalance: 0, openingDate: '2026-08-01' },
  );
  l.plannedFlows.push(ordreEnfant('ordre-lea', 'Argent de poche Léa', LEA, 'VIR SEPA ARGENT POCHE LEA'), ordreEnfant('ordre-leane', 'Argent de poche Léane', LEANE, 'VIR SEPA ARGENT POCHE LEANE'));
  l.operations.push(op('d-lea', CC, '2026-09-01', 'VIR SEPA ARGENT POCHE LEA', -euros(20)));
  return l;
}

describe('#488 · 8. dans le doute, la reprise se propose avec chacun, à l’écran', () => {
  it('[niveau 2] la ligne montre une proposition par ordre, l’opération ouverte un bouton par ordre, et le bouton choisi reprend avec cet ordre', async () => {
    await ouvrirLApplication();
    await app.replaceWith(projetLeaLeane());
    await rendu();
    await allerA('Opérations');
    const ligne = tous('main .card > .row').find((r) => t(r.querySelector(':scope > button.label strong')) === 'VIR SEPA ARGENT POCHE LEA')!;
    expect(ligne, 'la ligne du virement n’est pas à l’écran').toBeTruthy();
    const texte = t(ligne.querySelector(':scope > button.label'));
    expect(texte).toMatch(/Proposition : reprendre l’opération prévue « Argent de poche Léa »/);
    expect(texte).toMatch(/Proposition : reprendre l’opération prévue « Argent de poche Léane »/);
    await presser(ligne.querySelector<HTMLButtonElement>(':scope > button.label')!);
    const boutons = tous<HTMLButtonElement>('main button.primary').filter((b) => /^Reprendre l’opération prévue/.test(t(b)));
    expect(boutons.map(t).sort()).toEqual([
      expect.stringMatching(/« Argent de poche Léa »/),
      expect.stringMatching(/« Argent de poche Léane »/),
    ]);
    await presser(boutons.find((b) => /« Argent de poche Léa »/.test(t(b)))!);
    const d = projet().operations.find((o) => o.id === 'd-lea')!;
    expect([d.plannedFlowId, d.transferAccountId]).toEqual(['ordre-lea', LEA]);
  });
});
