/**
 * Harnais d'audit de #488 — « Virements internes : appariement automatique seulement quand la
 * destination est connue, et reconnaissance souple des libellés » (D11, D22, D24, D33, D88). Côté
 * cœur ; ce que montrent et font les écrans Opérations et Import :
 * `apps/web/test/virements-internes-ecran-harnais.test.ts`. Chaque `describe` reprend un point du
 * « Fait quand » sous son numéro ; chaque test porte son niveau (D83).
 *
 * Composé après le codage (auditeur.md, étape 2), parmi les tests du codeur
 * (`virements-internes-488.test.ts`, déplacé ici en entier). Est de moi : au point 3, la lecture des
 * propositions et des alertes, et l'import, qui n'écrivent rien de ce qui reste à confirmer, relus dans
 * la base (I10). Au second tour, le point 8 amendé (porteur, 16/10) : les tests du codeur
 * (`virements-internes-488-fin-coupee.test.ts`, déplacé ici en entier), à la fin de ce fichier. Au
 * troisième tour, le point 8 amendé une seconde fois (porteur, 16/10, « dans le doute, on propose ») :
 * les tests du codeur (`virements-internes-488-doute.test.ts`, déplacé ici en entier), après eux. Au
 * quatrième tour, le point 8 amendé une troisième fois (porteur, 16/10) : le piège de l'ordre de Noël,
 * repris des tests du codeur (`virements-internes-488-noel.test.ts`), avant le point 5. Au cinquième
 * tour, sur mes deux retours : un flux sans motif retient le virement, et une destination connue n'est
 * reprise d'office que par un ordre vers elle, crédit compris, repris des tests du codeur
 * (`virements-internes-488-candidats.test.ts`), après le piège de l'ordre de Noël.
 *
 * Niveaux (D83), par le besoin que couvre chaque phrase :
 * - 0 · ce qu'une correction du code ne rendrait pas : une opération sans destination connue jamais
 *   appariée sans confirmation, ni avec un autre compte que celui désigné, ni une opération verrouillée
 *   sans désignation (points 1 à 3) ; une proposition qui ne s'écrit pas (point 3, I10) ; un côté
 *   désigné qui reste verrouillé avec sa ventilation (point 2) ; défaire un appariement sans laisser de
 *   côté pointer dans le vide, l'autre gardant son état et sa ventilation (point 5).
 * - 1 · I2 : la désignation à la main qui apparie le seul candidat retire le double compte (point 4) ;
 *   un ordre ne se propose que sur une paire sûre (point 6 ; principes 1.3, 4.4, I10).
 * - 0 aussi · le piège des ordres d'une famille (point 8) : aucune fausse paire, rien d'apparié ni de
 *   repris d'office sur un libellé que plusieurs ordres ne reconnaissent que souplement, ni par l'ordre
 *   d'un autre enfant — le besoin du piège des comptes enfants (point 2) ; de même, le piège des
 *   prénoms dont l'un commence l'autre (« … LEA », « … LEANE »), et la reprise par l'ordre d'un autre
 *   compte qui défait l'appariement des deux côtés (point 5).
 * - 2 · les autres cas des règles : les destinations connues, les départages, l'import suivant, la
 *   proposition qui disparaît, le rapport, la reconnaissance souple, exacte ou souple, l'égalité entre
 *   ordres, la reprise qui n'a qu'un candidat, flux sans motif compris, le piège de l'ordre de Noël, et
 *   la reprise d'office par un ordre vers la destination connue seul (points 1, 2, 3, 4, 7, 8 ; D11,
 *   D12) : dans ces derniers, tout va vers Léa, aucune fausse paire n'y est possible ; un flux qui reprend
 *   à tort laisse l'appariement, et la reprise, classée, se corrige.
 * - 4 · deux diagnostics du codeur : un seul flux reconnaît le libellé, il le reprend comme avant ; une
 *   reprise par l'ordre du compte déjà désigné laisse l'appariement.
 *
 * Données inventées (D84) : un compte principal, deux comptes enfants, « Léa » et « Tom », et un
 * Livret A. Le principal vire 45 € à chaque enfant le 1er du mois, par un ordre enregistré vers
 * chacun ; chaque enfant reverse aussitôt 45 € par un prélèvement vers un plan d'épargne, qui n'est
 * pas un compte suivi.
 */
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import {
  LedgerStore,
  applyMatch,
  readAlerts,
  LABEL_SCORE_MIN,
  acceptInternalTransfer,
  applyPatchToLedger,
  designateTransfer,
  emptyLedger,
  euros,
  indexLedger,
  labelCutScore,
  labelMatcher,
  labelRecognizer,
  labelScore,
  matchTirelireTransfers,
  normalizeLabel,
  pairInternalTransfers,
  proposeInternalTransfers,
  proposeMatches,
  runPipeline,
  tirelireComponents,
  transfersToOrder,
  unpairTransfer,
  type Ledger,
  type Operation,
  type Patch,
  type PlannedFlow,
} from '../src/index.js';

const CC = 'acc-principal';
const LEA = 'acc-lea';
const TOM = 'acc-tom';
const LIVRET = 'acc-livret';

function op(id: string, accountId: string, date: string, label: string, amount: number, o: Partial<Operation> = {}): Operation {
  return { id, accountId, origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount, state: 'untreated', ...o };
}

function ordre(id: string, vers: string, motif: string, montant = euros(45)): PlannedFlow {
  return { id, name: `Virement ${vers}`, kind: 'transfer', amount: -montant, accountId: CC, counterpartAccountId: vers, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-01' }, dateWindowDays: 3, labelPattern: motif };
}

/** Les comptes ; avec `ordres`, un ordre enregistré du principal vers chaque enfant. */
function comptes(ordres = true): Ledger {
  const l = emptyLedger();
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(2000), openingDate: '2025-12-31' },
    { id: LEA, name: 'Léa', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
    { id: TOM, name: 'Tom', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
    { id: LIVRET, name: 'Livret A', kind: 'epargne', openingBalance: 0, openingDate: '2025-12-31' },
  );
  if (ordres) l.plannedFlows.push(ordre('ordre-lea', LEA, 'ARGENT POCHE LEA'), ordre('ordre-tom', TOM, 'ARGENT POCHE TOM'));
  return l;
}

const avec = (l: Ledger, ...ops: Operation[]): Ledger => ({ ...l, operations: [...l.operations, ...ops] });
const appliquer = (l: Ledger, p: Patch) => applyPatchToLedger(l, p);
const apparie = (l: Ledger) => appliquer(l, pairInternalTransfers(l));
const de = (l: Ledger, id: string) => l.operations.find((o) => o.id === id)!;
const paires = (l: Ledger) =>
  l.operations
    .filter((o) => !o.deletedAt && o.transferOperationId && o.amount < 0)
    .map((o) => `${o.id}>${o.transferOperationId}`)
    .sort();
const proposees = (l: Ledger) => proposeInternalTransfers(l).map((p) => `${p.debitId}>${p.creditId}`).sort();

/** Un mois du piège des comptes enfants : `jours` donne la date de chacun des quatre virements et des deux prélèvements. */
function moisEnfants(m: string, jours: { versLea: string; versTom: string; recuLea: string; recuTom: string; prlvLea: string; prlvTom: string }): Operation[] {
  return [
    op(`${m}-vers-lea`, CC, jours.versLea, 'VIR SEPA ARGENT POCHE LEA', -euros(45)),
    op(`${m}-vers-tom`, CC, jours.versTom, 'VIR SEPA ARGENT POCHE TOM', -euros(45)),
    op(`${m}-recu-lea`, LEA, jours.recuLea, 'VIR RECU DE: M OU MME DUPONT', euros(45)),
    op(`${m}-recu-tom`, TOM, jours.recuTom, 'VIR RECU DE: M OU MME DUPONT', euros(45)),
    op(`${m}-prlv-lea`, LEA, jours.prlvLea, 'PRLV SEPA PLAN EPARGNE LEA', -euros(45)),
    op(`${m}-prlv-tom`, TOM, jours.prlvTom, 'PRLV SEPA PLAN EPARGNE TOM', -euros(45)),
  ];
}

const JUSTES = (m: string) => [`${m}-vers-lea>${m}-recu-lea`, `${m}-vers-tom>${m}-recu-tom`];

describe('#488 · 1. une destination connue', () => {
  it('[niveau 2] désignée, reconnue par le libellé d’un ordre, ou « TIRELIRE <COMPTE> » sans ordre : elle apparie', () => {
    const l = avec(
      comptes(),
      op('designe', CC, '2026-03-10', 'VIR SEPA MISE DE COTE', -euros(80), { state: 'locked', transferAccountId: LIVRET }),
      op('recu-designe', LIVRET, '2026-03-11', 'VIR RECU', euros(80)),
      op('par-ordre', CC, '2026-03-01', 'VIR SEPA ARGENT POCHE LEA', -euros(45)),
      op('recu-ordre', LEA, '2026-03-02', 'VIR RECU', euros(45)),
      op('par-nom', CC, '2026-03-15', 'VIR TIRELIRE LIVRET A', -euros(30)),
      op('recu-nom', LIVRET, '2026-03-15', 'VIR RECU', euros(30)),
    );
    expect(paires(apparie(l))).toEqual(['designe>recu-designe', 'par-nom>recu-nom', 'par-ordre>recu-ordre']);
  });

  it('[niveau 0] ni le nom d’un compte cité dans le libellé, ni son numéro, ni un montant égal n’en font une', () => {
    const l = comptes(false);
    l.accounts = l.accounts.map((a) => (a.id === LEA ? { ...a, accountNumber: '00099999999' } : a));
    const ops = [
      op('nomme', CC, '2026-03-01', 'VIR SEPA LEA', -euros(45)),
      op('numero', CC, '2026-03-05', 'VIR SEPA 00099999999', -euros(46)),
      op('titulaire', TOM, '2026-03-08', 'VIR DE: M OU MME LEA DUPONT', -euros(47)),
      op('recu-1', LEA, '2026-03-01', 'VIR RECU', euros(45)),
      op('recu-2', LEA, '2026-03-05', 'VIR RECU', euros(46)),
      op('recu-3', LEA, '2026-03-08', 'VIR RECU', euros(47)),
    ];
    const l2 = apparie(avec(l, ...ops));
    expect(paires(l2)).toEqual([]);
    // Chacune se propose, à confirmer (point 3).
    expect(proposees(l2)).toEqual(['nomme>recu-1', 'numero>recu-2', 'titulaire>recu-3']);
  });
});

describe('#488 · 2. l’appariement automatique ne se fait qu’avec la destination', () => {
  it('[niveau 0] le piège des comptes enfants : les deux vraies paires de chaque mois, aucune fausse, quel que soit l’ordre des dates ; le prélèvement vers le plan d’épargne n’est apparié à rien', () => {
    const variantes = [
      // L'exemple du besoin : le prélèvement de Léa, daté du 30, passe avant le virement du principal, daté du 1er.
      { versLea: '2026-04-01', versTom: '2026-04-01', recuLea: '2026-04-01', recuTom: '2026-04-01', prlvLea: '2026-03-30', prlvTom: '2026-03-31' },
      { versLea: '2026-04-01', versTom: '2026-04-02', recuLea: '2026-04-02', recuTom: '2026-04-01', prlvLea: '2026-04-02', prlvTom: '2026-04-01' },
      { versLea: '2026-04-02', versTom: '2026-04-01', recuLea: '2026-04-03', recuTom: '2026-03-31', prlvLea: '2026-04-01', prlvTom: '2026-04-03' },
      { versLea: '2026-04-03', versTom: '2026-04-03', recuLea: '2026-04-01', recuTom: '2026-04-02', prlvLea: '2026-04-03', prlvTom: '2026-04-03' },
    ];
    for (const [i, j] of variantes.entries()) {
      for (const sens of [1, -1]) {
        const ops = moisEnfants('avr', j);
        const l = apparie(avec(comptes(), ...(sens === 1 ? ops : [...ops].reverse())));
        expect(paires(l), `variante ${i}, sens ${sens}`).toEqual(JUSTES('avr'));
        for (const p of ['avr-prlv-lea', 'avr-prlv-tom']) expect(de(l, p).transferOperationId, `${p}, variante ${i}`).toBeUndefined();
        for (const c of ['avr-vers-lea', 'avr-recu-lea', 'avr-vers-tom', 'avr-recu-tom']) expect(de(l, c).state, c).toBe('reconciled');
      }
    }
  });

  it('[niveau 2] plusieurs mois dans un seul import, ou un import par mois et par compte : les mêmes paires', () => {
    const jours = (m: string, prev: string) => ({ versLea: `${m}-01`, versTom: `${m}-01`, recuLea: `${m}-01`, recuTom: `${m}-02`, prlvLea: `${prev}-30`, prlvTom: `${m}-01` });
    const mois = [moisEnfants('fev', jours('2026-02', '2026-01')), moisEnfants('mar', jours('2026-03', '2026-02')), moisEnfants('avr', jours('2026-04', '2026-03'))];
    const attendu = [...JUSTES('fev'), ...JUSTES('mar'), ...JUSTES('avr')].sort();

    let seul = avec(comptes(), ...mois.flat());
    runPipeline(seul, '2026-01-01', '2026-05-01', (p) => (seul = appliquer(seul, p)));
    expect(paires(seul)).toEqual(attendu);

    // Un import par mois et par compte : le principal d'abord, les comptes enfants ensuite.
    let parMois = comptes();
    for (const ops of mois)
      for (const compte of [CC, LEA, TOM]) {
        const nouvelles = ops.filter((o) => o.accountId === compte);
        parMois = avec(parMois, ...nouvelles);
        const dates = nouvelles.map((o) => o.date).sort();
        runPipeline(parMois, dates[0]!, dates.at(-1)!, (p) => (parMois = appliquer(parMois, p)));
      }
    expect(paires(parMois)).toEqual(attendu);
    expect(proposeInternalTransfers(parMois)).toEqual([]);
  });

  it('[niveau 2] deux candidats à la même distance : aucun appariement, ils se proposent', () => {
    const l = apparie(
      avec(comptes(), op('vers', CC, '2026-04-02', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('c1', LEA, '2026-04-01', 'VIR RECU', euros(45)), op('c2', LEA, '2026-04-03', 'VIR RECU', euros(45))),
    );
    expect(paires(l)).toEqual([]);
    expect(proposees(l)).toEqual(['vers>c1', 'vers>c2']);
  });

  it('[niveau 0] deux candidats, dont un sur un autre compte que celui désigné : l’appariement se fait avec le compte désigné, seul proposé sinon', () => {
    const l = apparie(avec(comptes(), op('vers', CC, '2026-04-02', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('lea', LEA, '2026-04-03', 'VIR RECU', euros(45)), op('tom', TOM, '2026-04-02', 'VIR RECU', euros(45))));
    expect(paires(l)).toEqual(['vers>lea']);
    expect(de(l, 'tom').transferOperationId).toBeUndefined();
  });

  it('[niveau 2] deux débits qui se disputent un crédit : le plus proche en date l’emporte ; à égalité, aucun', () => {
    const proche = apparie(
      avec(comptes(), op('loin', CC, '2026-04-01', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('pres', CC, '2026-04-03', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('c', LEA, '2026-04-03', 'VIR RECU', euros(45))),
    );
    expect(paires(proche)).toEqual(['pres>c']);
    const egal = apparie(
      avec(comptes(), op('d1', CC, '2026-04-01', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('d2', CC, '2026-04-05', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('c', LEA, '2026-04-03', 'VIR RECU', euros(45))),
    );
    expect(paires(egal)).toEqual([]);
    expect(proposees(egal)).toEqual(['d1>c', 'd2>c']);
  });

  it('[niveau 0] une désignation à la main, verrouillée, s’apparie à l’import qui apporte l’autre côté ; elle reste verrouillée, sa ventilation ne change pas', () => {
    let l = avec(comptes(false), op('vers', CC, '2026-04-02', 'VIR SEPA MISE DE COTE', -euros(80), { state: 'locked', transferAccountId: LIVRET }));
    l.tirelires.push({ id: 'vac', name: 'Vacances', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-01-01' });
    l.subOperations.push({ id: 's1', operationId: 'vers', tirelireId: 'vac', share: { kind: 'variable' } });
    l = avec(l, op('recu', LIVRET, '2026-04-03', 'VIR RECU', euros(80)));
    runPipeline(l, '2026-04-03', '2026-04-04', (p) => (l = appliquer(l, p)));
    expect(paires(l)).toEqual(['vers>recu']);
    expect([de(l, 'vers').state, de(l, 'recu').state]).toEqual(['locked', 'reconciled']);
    expect(l.subOperations.filter((s) => !s.deletedAt).map((s) => [s.id, s.operationId, s.tirelireId])).toEqual([['s1', 'vers', 'vac']]);
  });

  it('[niveau 0] une opération verrouillée sans désignation n’est pas appariée', () => {
    const l = apparie(avec(comptes(), op('vers', CC, '2026-04-01', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('recu', LEA, '2026-04-01', 'VIR RECU', euros(45), { state: 'locked' })));
    expect(paires(l)).toEqual([]);
  });
});

describe('#488 · 3. une proposition, sinon', () => {
  it('[niveau 0] la coïncidence : rien n’est apparié, une proposition est faite ; confirmée, la paire est verrouillée', () => {
    const l = apparie(avec(comptes(), op('vers-tiers', LEA, '2026-05-12', 'VIR SEPA CLUB DE FOOT', -euros(34)), op('sante', CC, '2026-05-12', 'VIR RECU CPAM REMBOURSEMENT', euros(34))));
    expect(paires(l)).toEqual([]);
    const props = proposeInternalTransfers(l);
    expect(props).toEqual([{ debitId: 'vers-tiers', creditId: 'sante' }]);
    // Rien ne s'écrit avant le geste : proposer ne change pas le grand livre.
    expect(l.operations.every((o) => o.state === 'untreated' && !o.transferAccountId)).toBe(true);
    const l2 = appliquer(l, acceptInternalTransfer(l, props[0]!));
    expect(paires(l2)).toEqual(['vers-tiers>sante']);
    expect([de(l2, 'vers-tiers').state, de(l2, 'sante').state]).toEqual(['locked', 'locked']);
    expect([de(l2, 'vers-tiers').transferAccountId, de(l2, 'sante').transferAccountId]).toEqual([CC, LEA]);
    expect(proposeInternalTransfers(l2)).toEqual([]);
  });

  it('[niveau 2] la proposition disparaît dès qu’un côté est apparié, verrouillé, désigné ou supprimé ; ignorée, elle reste', () => {
    const base = avec(comptes(false), op('d', LEA, '2026-05-12', 'VIR SEPA CLUB', -euros(34)), op('c', CC, '2026-05-12', 'VIR RECU CPAM', euros(34)));
    expect(proposees(base)).toEqual(['d>c']);
    expect(proposees(apparie(base)), 'ignorée : rien ne la retire').toEqual(['d>c']);
    const change = (id: string, o: Partial<Operation>) => ({ ...base, operations: base.operations.map((x) => (x.id === id ? { ...x, ...o } : x)) });
    expect(proposees(change('c', { state: 'locked' })), 'verrouillé').toEqual([]);
    expect(proposees(change('d', { deletedAt: '2026-05-13T00:00:00Z' })), 'supprimé').toEqual([]);
    expect(proposees(change('d', { transferAccountId: TOM, state: 'locked' })), 'désigné vers un autre compte').toEqual([]);
    expect(proposees(change('c', { transferAccountId: TOM, transferOperationId: 'x' })), 'apparié ailleurs').toEqual([]);
  });

  it('[niveau 0] sans destination connue nulle part (U5, aucun budget, aucun ordre) : tout se propose, rien ne s’apparie seul', () => {
    const l = emptyLedger();
    l.accounts.push({ id: 'a', name: 'Courant', kind: 'courant', openingBalance: 0, openingDate: '2026-01-01' }, { id: 'b', name: 'Épargne', kind: 'epargne', openingBalance: 0, openingDate: '2026-01-01' });
    let u5 = avec(l, op('d1', 'a', '2026-05-01', 'VIR SEPA EPARGNE', -euros(100)), op('c1', 'b', '2026-05-02', 'VIR RECU', euros(100)), op('d2', 'b', '2026-05-10', 'VIR SEPA RETOUR', -euros(20)), op('c2', 'a', '2026-05-10', 'VIR RECU', euros(20)));
    const rapport = runPipeline(u5, '2026-05-01', '2026-05-11', (p) => (u5 = appliquer(u5, p)));
    expect(rapport.transfersPaired).toBe(0);
    expect(rapport.transferProposals).toBe(2);
    expect(paires(u5)).toEqual([]);
    expect(proposees(u5)).toEqual(['d1>c1', 'd2>c2']);
  });
  it('[niveau 0] lire les propositions et les alertes, puis importer, n’écrit rien de ce qui reste à confirmer, dans le grand livre lu ni dans la base (I10)', async () => {
    const SQL = await initSqlJs();
    const s = await LedgerStore.create({ sqlJs: SQL, siteId: 'audit-488' });
    const l = avec(comptes(), op('vers-tiers', LEA, '2026-05-12', 'VIR SEPA CLUB DE FOOT', -euros(34)), op('sante', CC, '2026-05-12', 'VIR RECU CPAM REMBOURSEMENT', euros(34)));
    for (const a of l.accounts) s.upsert('accounts', a);
    for (const f of l.plannedFlows) s.upsert('plannedFlows', f);
    for (const o of l.operations) s.upsert('operations', o);
    const lu = s.load();
    const avant = structuredClone(lu);
    const baseAvant = JSON.stringify(s.load());
    expect(proposeInternalTransfers(lu)).toHaveLength(1);
    expect(readAlerts(lu, { today: '2026-05-20' }, ['transferPairProposal'])).toHaveLength(1);
    expect(lu).toEqual(avant);
    expect(JSON.stringify(s.load())).toBe(baseAvant);
    // L'import écrit ce qu'il établit, et rien de la paire à confirmer.
    runPipeline(s.load(), '2026-05-01', '2026-05-31', (p) => {
      for (const o of p.operations) s.upsert('operations', o);
      return s.load();
    });
    const relu = (await LedgerStore.create({ sqlJs: SQL, siteId: 'audit-488', bytes: s.export() })).load();
    for (const id of ['vers-tiers', 'sante']) {
      const o = relu.operations.find((x) => x.id === id)!;
      expect([o.transferAccountId, o.transferOperationId, o.state], id).toEqual([undefined, undefined, 'untreated']);
    }
    s.close();
  });
});

describe('#488 · 4. désigner à la main un virement', () => {
  const ventile = (l: Ledger) => {
    l.tirelires.push({ id: 'vac', name: 'Vacances', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-01-01' });
    l.subOperations.push({ id: 's-d', operationId: 'd', tirelireId: 'vac', share: { kind: 'variable' } }, { id: 's-c', operationId: 'c', tirelireId: 'vac', share: { kind: 'variable' } });
    return l;
  };

  it('[niveau 1] un seul candidat : les deux côtés appariés et verrouillés ; le double compte des composantes disparaît (I2)', () => {
    const l = ventile(avec(comptes(false), op('d', CC, '2026-06-02', 'VIR SEPA MISE DE COTE', -euros(600)), op('c', LIVRET, '2026-06-03', 'VIR RECU', euros(600))));
    // Sans appariement, désigné seul, le débit porte aussi la composante du livret, que le crédit porte déjà.
    const seul = appliquer(l, { operations: [{ ...de(l, 'd'), state: 'locked', transferAccountId: LIVRET }], subOperations: [] });
    const vac = (x: Ledger) => tirelireComponents(indexLedger(x).tireliresById.get('vac')!, indexLedger(x), '2026-06-30');
    expect(vac(seul).get(LIVRET)).toBe(euros(1200));
    const l2 = appliquer(l, designateTransfer(l, 'd', LIVRET));
    expect(paires(l2)).toEqual(['d>c']);
    expect([de(l2, 'd').state, de(l2, 'c').state]).toEqual(['locked', 'locked']);
    expect(vac(l2).get(LIVRET)).toBe(euros(600));
    expect(vac(l2).get(CC)).toBe(-euros(600));
  });

  it('[niveau 2] le crédit désigné « depuis » un compte s’apparie de même', () => {
    const l = avec(comptes(false), op('d', CC, '2026-06-02', 'VIR SEPA MISE DE COTE', -euros(600)), op('c', LIVRET, '2026-06-03', 'VIR RECU', euros(600)));
    expect(paires(appliquer(l, designateTransfer(l, 'c', CC)))).toEqual(['d>c']);
  });

  it('[niveau 2] deux candidats : désignée sans être appariée, les candidats du compte désigné se proposent', () => {
    const l = avec(comptes(false), op('d', CC, '2026-06-02', 'VIR SEPA MISE DE COTE', -euros(600)), op('c1', LIVRET, '2026-06-01', 'VIR RECU', euros(600)), op('c2', LIVRET, '2026-06-03', 'VIR RECU', euros(600)), op('t', TOM, '2026-06-02', 'VIR RECU', euros(600)));
    const l2 = appliquer(l, designateTransfer(l, 'd', LIVRET));
    expect(paires(l2)).toEqual([]);
    expect([de(l2, 'd').state, de(l2, 'd').transferAccountId]).toEqual(['locked', LIVRET]);
    expect(proposees(l2)).toEqual(['d>c1', 'd>c2']);
  });

  it('[niveau 2] sans candidat : désignée seule, puis appariée à l’import qui apporte l’autre côté', () => {
    let l = avec(comptes(false), op('d', CC, '2026-06-02', 'VIR SEPA MISE DE COTE', -euros(600)));
    l = appliquer(l, designateTransfer(l, 'd', LIVRET));
    expect([de(l, 'd').state, de(l, 'd').transferAccountId, de(l, 'd').transferOperationId]).toEqual(['locked', LIVRET, undefined]);
    l = avec(l, op('c', LIVRET, '2026-06-04', 'VIR RECU', euros(600)));
    const rapport = runPipeline(l, '2026-06-04', '2026-06-05', (p) => (l = appliquer(l, p)));
    expect(rapport.transfersPaired).toBe(1);
    expect(paires(l)).toEqual(['d>c']);
    expect(de(l, 'd').state).toBe('locked');
  });
});

describe('#488 · 5. défaire un appariement ne laisse pas un côté pointer dans le vide', () => {
  const paire = () => apparie(avec(comptes(), op('d', CC, '2026-06-01', 'VIR SEPA ARGENT POCHE LEA', -euros(45)), op('c', LEA, '2026-06-01', 'VIR RECU', euros(45))));
  const coherent = (l: Ledger) => {
    const vivants = new Map(l.operations.filter((o) => !o.deletedAt).map((o) => [o.id, o]));
    for (const o of vivants.values()) if (o.transferOperationId) expect(vivants.get(o.transferOperationId)?.transferOperationId, `${o.id} désigne ${o.transferOperationId}`).toBe(o.id);
  };

  it('[niveau 0] défaire un côté : l’autre ne le désigne plus ni son compte, et garde son état et sa ventilation', () => {
    let l = paire();
    l.subOperations.push({ id: 's-c', operationId: 'c', categoryId: 'cat', share: { kind: 'variable' } });
    l = appliquer(l, unpairTransfer(l, 'd'));
    expect(de(l, 'd').transferOperationId).toBeUndefined();
    expect([de(l, 'c').transferAccountId, de(l, 'c').transferOperationId, de(l, 'c').state]).toEqual([undefined, undefined, 'reconciled']);
    expect(l.subOperations.map((s) => s.id)).toEqual(['s-c']);
    coherent(l);
  });

  it('[niveau 0] désigner un côté apparié vers un autre compte défait l’appariement des deux côtés', () => {
    let l = paire();
    l = appliquer(l, designateTransfer(l, 'd', TOM));
    expect([de(l, 'd').transferAccountId, de(l, 'd').transferOperationId, de(l, 'd').state]).toEqual([TOM, undefined, 'locked']);
    expect([de(l, 'c').transferAccountId, de(l, 'c').transferOperationId, de(l, 'c').state]).toEqual([undefined, undefined, 'reconciled']);
    coherent(l);
  });

  it('[niveau 0] un côté supprimé : défaire l’appariement libère l’autre', () => {
    let l = paire();
    l = appliquer(l, unpairTransfer(l, 'c'));
    l = { ...l, operations: l.operations.map((o) => (o.id === 'c' ? { ...o, deletedAt: '2026-06-02T00:00:00Z' } : o)) };
    expect(de(l, 'd').transferOperationId).toBeUndefined();
    coherent(l);
  });
});

describe('#488 · 6. un ordre ne se propose que sur une paire sûre', () => {
  const budget = (l: Ledger) => {
    l.tirelires.push({ id: 'vac', name: 'Vacances', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-01-01' });
    l.needs.push({ id: 'n-vac', tirelireId: 'vac', kind: 'goal', amount: euros(9000), monthlyAmount: euros(250), priority: 30 });
    l.plannedFlows.push({ id: 'salaire', name: 'Salaire', kind: 'income', amount: euros(2500), accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-28' }, dateWindowDays: 3 });
    return l;
  };
  it('[niveau 1] à confirmer, aucune proposition d’ordre ; confirmée, le débit la propose, le crédit non', () => {
    const l = apparie(budget(avec(comptes(false), op('d', CC, '2026-06-02', 'VIR SEPA MISE DE COTE', -euros(250)), op('c', LIVRET, '2026-06-03', 'VIR RECU', euros(250)))));
    expect(proposees(l)).toEqual(['d>c']);
    expect(transfersToOrder(l, '2026-06-10').size).toBe(0);
    const l2 = appliquer(l, acceptInternalTransfer(l, { debitId: 'd', creditId: 'c' }));
    expect([...transfersToOrder(l2, '2026-06-10')]).toEqual([['d', LIVRET]]);
  });
});

describe('#488 · 7. le rapport d’import', () => {
  it('[niveau 2] compte les virements internes appariés et les paires à confirmer', () => {
    let l = avec(comptes(), ...moisEnfants('avr', { versLea: '2026-04-01', versTom: '2026-04-01', recuLea: '2026-04-01', recuTom: '2026-04-01', prlvLea: '2026-03-30', prlvTom: '2026-03-31' }), op('d', LEA, '2026-04-12', 'VIR SEPA CLUB', -euros(34)), op('c', CC, '2026-04-12', 'VIR RECU CPAM', euros(34)));
    const r = runPipeline(l, '2026-03-30', '2026-04-13', (p) => (l = appliquer(l, p)));
    expect([r.transfersPaired, r.transferProposals]).toEqual([2, 1]);
  });
});

describe('#488 · 8. reconnaissance souple des libellés d’un flux', () => {
  it('[niveau 2] le score, sur les exemples du « Fait quand »', () => {
    expect(LABEL_SCORE_MIN).toBe(0.8);
    expect(labelScore('vir sepa tirelire léa', 'VIR SEPA TIRELIRE LEA')).toBe(1);
    expect(labelScore('TIRELIRE-LIVRET', 'TIRELIRE LIVRET')).toBe(1);
    expect(labelScore('TIRELIRE LIVRET', 'PRLV 123 TIRELIRE LIVRET REF 9')).toBe(1);
    expect(labelScore('A B C', 'A X Y B Z W C')).toBe(1);
    expect(labelScore('A B C', 'A X Y Z B C')).toBeCloseTo(2 / 3);
    expect(labelScore('BOURSO', 'VIR BOURSORAMA')).toBe(1);
    expect(labelScore('ARGENT POCHE MENSUEL', 'VIR ARGENT POCHE MEN')).toBe(1);
    expect(labelScore('ARGENT POCHE MENSUEL', 'VIR ARGENT POCHE ME')).toBeCloseTo(2 / 3);
    expect(labelScore('A B C D', 'A B C')).toBe(0.75);
    expect(labelScore('A B C D E', 'A B C D')).toBe(0.8);
    expect(labelScore('TIRELIRE LEA', 'TIRELIRE TOM')).toBe(0.5);
  });

  it('[niveau 2] un motif littéral reconnaît chaque altération du tableau, une à la fois ; ce qu’il reconnaissait, il le reconnaît encore', () => {
    const motif = 'ARGENT DE POCHE MENSUEL LÉA';
    const brut = 'VIR SEPA ARGENT DE POCHE MENSUEL LÉA REF 2026';
    const libelle = (label: string, details?: string) => op('x', CC, '2026-04-01', label, -euros(45), details ? { details } : {});
    const reconnait = labelMatcher(motif);
    expect(reconnait(libelle(brut))).toBe(true);
    const alterations: Array<[string, string]> = [
      ['préfixe ajouté', `PRLV 0042 ${brut}`],
      ['minuscules et accents', 'vir sepa argent de poche mensuel lea ref 2026'],
      ['ponctuation et blancs changés', 'VIR-SEPA ARGENT/DE  POCHE.MENSUEL-LÉA REF:2026'],
      // Coupé par la source : « MENSU » commence « MENSUEL », et 4 mots sur 5 font 0,8.
      ['dernier mot tronqué', 'VIR SEPA ARGENT DE POCHE MENSU'],
    ];
    const regex = new RegExp(motif, 'i');
    for (const [nom, texte] of alterations) {
      expect(reconnait(libelle(texte)), nom).toBe(true);
      if (nom !== 'préfixe ajouté') expect(regex.test(texte), `${nom} : la regex seule ne le reconnaît pas`).toBe(false);
    }
    // Le libellé complet compte comme le libellé.
    expect(reconnait(libelle('VIR SEPA', 'vir sepa argent de poche mensuel lea'))).toBe(true);
    // « texte.*texte » : chaque partie.
    expect(labelMatcher('ARGENT.*POCHE LÉA')(libelle('vir argent de poche lea'))).toBe(true);
    expect(labelMatcher('ARGENT.*POCHE LÉA')(libelle('vir argent de poche tom'))).toBe(false);
  });

  it('[niveau 2] « TIRELIRE LEA » ne reconnaît pas « TIRELIRE TOM » ; trois mots insérés, non ; une coupure qui fait disparaître la référence, non', () => {
    const lit = (motif: string, label: string) => labelMatcher(motif)(op('x', CC, '2026-04-01', label, -euros(45)));
    expect(lit('TIRELIRE LEA', 'VIR TIRELIRE TOM')).toBe(false);
    expect(lit('ARGENT POCHE', 'ARGENT DE LA BELLE POCHE')).toBe(false);
    expect(lit('ARGENT POCHE LEA', 'VIR SEPA ARGENT')).toBe(false);
  });

  it('[niveau 2] une expression régulière garde sa seule lecture, sans le score', () => {
    const lit = (motif: string, label: string) => labelMatcher(motif)(op('x', CC, '2026-04-01', label, -euros(45)));
    expect(lit('^VIR (EMENT)?SALAIRE', 'vir salaire')).toBe(true);
    expect(lit('^VIR (EMENT)?SALAIRE', 'PRLV VIR SALAIRE')).toBe(false);
    expect(lit('DGFIP|TAXE FONC', 'dgfip')).toBe(true);
    // Littéral, « TAXE FONC » reconnaîtrait « TAXE D FONCIERE » (un mot inséré) ; écrit en expression, non.
    expect(lit('TAXE FONC', 'PRLV TAXE D FONCIERE')).toBe(true);
    expect(lit('(TAXE) FONC', 'PRLV TAXE D FONCIERE')).toBe(false);
  });

  it('[niveau 2] la destination connue suit la lecture souple du libellé de l’ordre', () => {
    const l = avec(comptes(), op('d', CC, '2026-04-01', 'prlv vir-sepa argent poche léa', -euros(45)), op('c', LEA, '2026-04-01', 'VIR RECU', euros(45)));
    expect(matchTirelireTransfers(l).operations.map((o) => [o.id, o.transferAccountId])).toEqual([['d', LEA]]);
    expect(paires(apparie(l))).toEqual(['d>c']);
  });
});

// Le point 8 amendé (porteur, 16/10) : données inventées (D84), « Léa » et « Thomas », et les libellés du
// « piège des ordres d'une famille » de l'issue.
const THOMAS = 'acc-thomas';
const MOTIF_LEA = 'VIR SEPA ARGENT POCHE LEA';
const MOTIF_THOMAS = 'VIR SEPA ARGENT POCHE THOMAS';
const COUPE = 'VIR SEPA ARGENT POCHE';

function ordreFamille(id: string, vers: string, motif: string): PlannedFlow {
  return { id, name: `Virement ${vers}`, kind: 'transfer', amount: -euros(20), accountId: CC, counterpartAccountId: vers, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-01' }, dateWindowDays: 5, labelPattern: motif, amountTolerance: { pct: 20 } };
}

/** Les comptes, et les ordres demandés : `lea`, `thomas`. */
function famille(...ordres: Array<'lea' | 'thomas'>): Ledger {
  const l = emptyLedger();
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(2000), openingDate: '2025-12-31' },
    { id: LEA, name: 'Léa', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
    { id: THOMAS, name: 'Thomas', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
  );
  if (ordres.includes('lea')) l.plannedFlows.push(ordreFamille('ordre-lea', LEA, MOTIF_LEA));
  if (ordres.includes('thomas')) l.plannedFlows.push(ordreFamille('ordre-thomas', THOMAS, MOTIF_THOMAS));
  return l;
}

function importer(l: Ledger): Ledger {
  let out = l;
  runPipeline(out, '2026-03-25', '2026-04-10', (p) => (out = applyPatchToLedger(out, p)));
  return out;
}

const crédits = () => [op('c-lea', LEA, '2026-04-01', 'VIR RECU', euros(20)), op('c-thomas', THOMAS, '2026-04-02', 'VIR RECU', euros(20))];

describe('#488 · 8. les 20 % tolérés ne couvrent que la fin coupée', () => {
  it('[niveau 2] le score de la fin coupée, sur les exemples du « Fait quand »', () => {
    // Coupé par la source : 4 mots sur 5, oui.
    expect(labelCutScore(MOTIF_LEA, COUPE)).toBe(0.8);
    expect(labelCutScore(MOTIF_THOMAS, COUPE)).toBe(0.8);
    // Un autre mot à la place du mot absent : non, alors que la part des mots présents est 0,8.
    expect(labelScore(MOTIF_THOMAS, MOTIF_LEA)).toBe(0.8);
    expect(labelCutScore(MOTIF_THOMAS, MOTIF_LEA)).toBe(0);
    // Un mot du motif absent au milieu ou au début du texte : non.
    expect(labelCutScore(MOTIF_LEA, 'VIR SEPA POCHE LEA')).toBe(0);
    expect(labelCutScore(MOTIF_LEA, 'SEPA ARGENT POCHE LEA')).toBe(0);
    // Un suffixe ajouté après la fin coupée : le texte ne s'arrête plus avant le mot absent.
    expect(labelCutScore(MOTIF_LEA, `${COUPE} REF 9`)).toBe(0);
    // 3 mots sur 4, même coupés : sous le seuil.
    expect(labelCutScore('A B C D', 'X A B C')).toBe(0.75);
    // Ce que la reconnaissance tolérait déjà reste : préfixe, suffixe, deux mots insérés, dernier mot tronqué.
    expect(labelCutScore(MOTIF_LEA, `PRLV 12 ${MOTIF_LEA} REF 9`)).toBe(1);
    expect(labelCutScore('A B C', 'A X Y B C')).toBe(1);
    expect(labelCutScore('A B C', 'A X Y Z B C')).toBe(0);
    expect(labelCutScore('ARGENT POCHE MENSUEL', 'VIR ARGENT POCHE MEN')).toBe(1);
    expect(labelCutScore('TIRELIRE LEA', 'TIRELIRE TOM')).toBe(0);
  });

  it('[niveau 2] la reconnaissance du motif : exacte, souple ou aucune', () => {
    const lit = (motif: string, label: string) => labelRecognizer(motif)(op('x', CC, '2026-04-01', label, -euros(20)));
    expect(lit(MOTIF_LEA, `PRLV ${MOTIF_LEA}`)).toBe('exact');
    expect(lit(MOTIF_LEA, 'vir sepa argent poche léa')).toBe('exact');
    expect(lit(MOTIF_LEA, COUPE)).toBe('souple');
    expect(lit(MOTIF_THOMAS, MOTIF_LEA)).toBeUndefined();
    expect(labelMatcher(MOTIF_THOMAS)(op('x', CC, '2026-04-01', MOTIF_LEA, -euros(20)))).toBe(false);
    // Une expression régulière garde sa seule lecture.
    expect(lit('VIR SEPA (ARGENT|AP) POCHE LEA', 'VIR SEPA ARGENT POCHE LEA')).toBe('exact');
    expect(lit('VIR SEPA (ARGENT|AP) POCHE LEA', COUPE)).toBeUndefined();
  });
});

describe('#488 · 8. le piège des ordres d’une famille', () => {
  it('[niveau 0] chaque virement s’apparie à son crédit, aucune fausse paire', () => {
    const l = importer(avec(famille('lea', 'thomas'), op('d-lea', CC, '2026-04-01', MOTIF_LEA, -euros(20)), op('d-thomas', CC, '2026-04-04', MOTIF_THOMAS, -euros(20)), ...crédits()));
    const lien = (id: string) => l.operations.find((o) => o.id === id)?.transferOperationId;
    expect([lien('d-lea'), lien('d-thomas')]).toEqual(['c-lea', 'c-thomas']);
    expect([lien('c-lea'), lien('c-thomas')]).toEqual(['d-lea', 'd-thomas']);
    expect(l.operations.find((o) => o.id === 'd-lea')?.plannedFlowId).toBe('ordre-lea');
    expect(l.operations.find((o) => o.id === 'd-thomas')?.plannedFlowId).toBe('ordre-thomas');
  });

  it('[niveau 0] le libellé coupé n’a pas de destination connue : il se propose avec chaque crédit, rien ne s’apparie seul ni ne se rapproche d’office', () => {
    const avant = avec(famille('lea', 'thomas'), op('d', CC, '2026-04-01', COUPE, -euros(20)), ...crédits());
    expect(matchTirelireTransfers(avant).operations).toEqual([]);
    expect(proposeMatches(avant, '2026-03-25', '2026-04-10').filter((p) => p.operationId === 'd' && p.auto)).toEqual([]);
    const l = importer(avant);
    const d = l.operations.find((o) => o.id === 'd')!;
    expect(d.transferOperationId).toBeUndefined();
    expect(d.transferAccountId).toBeUndefined();
    expect(d.plannedFlowId).toBeUndefined();
    expect(proposeInternalTransfers(l).filter((p) => p.debitId === 'd').map((p) => p.creditId).sort()).toEqual(['c-lea', 'c-thomas']);
  });

  it('[niveau 0] avec le seul ordre de Thomas, le virement « … LEA » n’est pas rapproché de lui', () => {
    const avant = avec(famille('thomas'), op('d', CC, '2026-04-01', MOTIF_LEA, -euros(20)), ...crédits());
    expect(matchTirelireTransfers(avant).operations).toEqual([]);
    expect(proposeMatches(avant, '2026-03-25', '2026-04-10').filter((p) => p.operationId === 'd')).toEqual([]);
    const d = importer(avant).operations.find((o) => o.id === 'd')!;
    expect([d.plannedFlowId, d.transferAccountId, d.transferOperationId]).toEqual([undefined, undefined, undefined]);
  });

  it('[niveau 2] un seul ordre reconnaît le libellé coupé : son compte en est la destination', () => {
    const avant = avec(famille('lea'), op('d', CC, '2026-04-01', COUPE, -euros(20)), ...crédits());
    expect(matchTirelireTransfers(avant).operations.map((o) => [o.id, o.transferAccountId])).toEqual([['d', LEA]]);
    const d = importer(avant).operations.find((o) => o.id === 'd')!;
    expect([d.transferAccountId, d.transferOperationId]).toEqual([LEA, 'c-lea']);
  });

  it('[niveau 2] plusieurs comptes, l’un exactement et l’autre souplement : aucune destination, et la reprise se propose avec chacun', () => {
    const l = famille('lea');
    // Un ordre vers Thomas au motif plus long, qui ne reconnaît le libellé que souplement (fin coupée).
    l.plannedFlows.push(ordreFamille('ordre-thomas', THOMAS, `${COUPE} THOMAS MENSUEL`));
    l.plannedFlows[0] = { ...l.plannedFlows[0]!, labelPattern: COUPE };
    const avant = avec(l, op('d', CC, '2026-04-01', `${COUPE} THOMAS`, -euros(20)));
    expect(labelRecognizer(`${COUPE} THOMAS MENSUEL`)(avant.operations[0]!)).toBe('souple');
    expect(labelRecognizer(COUPE)(avant.operations[0]!)).toBe('exact');
    // Dans le doute, on propose (porteur, 16/10) : ni l'une ni l'autre ne l'emporte.
    expect(matchTirelireTransfers(avant).operations).toEqual([]);
    const reprises = proposeMatches(avant, '2026-03-25', '2026-04-10').filter((p) => p.operationId === 'd');
    expect(reprises.map((p) => [p.flowId, p.auto]).sort()).toEqual([
      ['ordre-lea', false],
      ['ordre-thomas', false],
    ]);
  });
});

// Le point 8 amendé une seconde fois (porteur, 16/10, « dans le doute, on propose ») : les tests du
// codeur du troisième tour (`virements-internes-488-doute.test.ts`, déplacé ici en entier). Données
// inventées (D84) : « Léa », « Léane » et « Thomas », et les libellés du « piège des prénoms dont l'un
// commence l'autre » de l'issue.
const LEANE = 'acc-leane';
const MOTIF_LEANE = 'VIR SEPA ARGENT POCHE LEANE';

function base(flows: PlannedFlow[], ...ops: Operation[]): Ledger {
  const l = emptyLedger();
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(2000), openingDate: '2025-12-31' },
    { id: LEA, name: 'Léa', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
    { id: LEANE, name: 'Léane', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
    { id: THOMAS, name: 'Thomas', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
  );
  l.plannedFlows.push(...flows);
  l.operations.push(...ops);
  return l;
}

const creditsLeaLeane = () => [op('c-lea', LEA, '2026-04-01', 'VIR RECU', euros(20)), op('c-leane', LEANE, '2026-04-02', 'VIR RECU', euros(20))];

describe('#488 · 8. exacte ou souple : la lecture d’avant, ou le score seul', () => {
  it('[niveau 2] un score de 1 est une reconnaissance souple ; l’expression régulière, sur le libellé normalisé compris, est exacte', () => {
    const lit = (motif: string, label: string) => labelRecognizer(motif)(op('x', CC, '2026-04-01', label, -euros(20)));
    // « LEA », dernier mot du libellé, lu comme « LEANE » coupé : score de 1, mais souple.
    expect(lit(MOTIF_LEANE, MOTIF_LEA)).toBe('souple');
    expect(lit(MOTIF_LEA, MOTIF_LEA)).toBe('exact');
    expect(lit(MOTIF_LEA, `PRLV ${MOTIF_LEA} REF 9`)).toBe('exact');
    expect(lit(MOTIF_LEA, 'vir sepa argent poche léa')).toBe('exact');
    // Ce que seul le score reconnaît, sans mot absent : souple aussi.
    expect(lit(MOTIF_LEA, 'VIR-SEPA ARGENT DE POCHE LEA')).toBe('souple');
  });
});

describe('#488 · 8. le piège des prénoms dont l’un commence l’autre', () => {
  it('[niveau 0] « … LEANE », reconnu exactement par les deux ordres : le plus long l’emporte, il s’apparie au crédit de Léane et l’ordre de Léane le reprend', () => {
    const avant = base([ordreFamille('ordre-lea', LEA, MOTIF_LEA), ordreFamille('ordre-leane', LEANE, MOTIF_LEANE)], op('d-leane', CC, '2026-04-04', MOTIF_LEANE, -euros(20)), ...creditsLeaLeane());
    expect(matchTirelireTransfers(avant).operations.map((o) => [o.id, o.transferAccountId])).toEqual([['d-leane', LEANE]]);
    // La reprise ne diverge pas de la destination : l'ordre de Léa ne la sélectionne pas.
    expect(proposeMatches(avant, '2026-03-25', '2026-04-10').map((p) => [p.flowId, p.auto])).toEqual([['ordre-leane', true]]);
    const d = de(importer(avant), 'd-leane');
    expect([d.transferAccountId, d.transferOperationId, d.plannedFlowId]).toEqual([LEANE, 'c-leane', 'ordre-leane']);
  });

  it('[niveau 0] « … LEA », exact pour Léa et souple pour Léane : pas de destination, la paire se propose avec chaque crédit, et la reprise avec chaque ordre, sans rien d’office', () => {
    const avant = base([ordreFamille('ordre-lea', LEA, MOTIF_LEA), ordreFamille('ordre-leane', LEANE, MOTIF_LEANE)], op('d-lea', CC, '2026-04-01', MOTIF_LEA, -euros(20)), ...creditsLeaLeane());
    expect(matchTirelireTransfers(avant).operations).toEqual([]);
    const reprises = proposeMatches(avant, '2026-03-25', '2026-04-10');
    expect(reprises.map((p) => [p.operationId, p.flowId, p.auto]).sort()).toEqual([
      ['d-lea', 'ordre-lea', false],
      ['d-lea', 'ordre-leane', false],
    ]);
    const l = importer(avant);
    const d = de(l, 'd-lea');
    expect([d.transferAccountId, d.transferOperationId, d.plannedFlowId]).toEqual([undefined, undefined, undefined]);
    expect(proposeInternalTransfers(l).filter((p) => p.debitId === 'd-lea').map((p) => p.creditId).sort()).toEqual(['c-lea', 'c-leane']);
  });

  it('[niveau 0] les deux virements du mois : « … LEANE » s’apparie, « … LEA » se propose, aucune fausse paire', () => {
    const l = importer(
      base([ordreFamille('ordre-lea', LEA, MOTIF_LEA), ordreFamille('ordre-leane', LEANE, MOTIF_LEANE)], op('d-lea', CC, '2026-04-01', MOTIF_LEA, -euros(20)), op('d-leane', CC, '2026-04-04', MOTIF_LEANE, -euros(20)), ...creditsLeaLeane()),
    );
    expect(de(l, 'd-leane').transferOperationId).toBe('c-leane');
    expect(de(l, 'c-leane').transferOperationId).toBe('d-leane');
    expect(de(l, 'd-lea').transferOperationId).toBeUndefined();
    expect(de(l, 'c-lea').transferOperationId).toBeUndefined();
    expect(proposeInternalTransfers(l).map((p) => [p.debitId, p.creditId])).toEqual([['d-lea', 'c-lea']]);
  });

  it('[niveau 2] avec le seul ordre de Léane, « … LEA » est reconnu par lui seul : sa destination est Léane', () => {
    const avant = base([ordreFamille('ordre-leane', LEANE, MOTIF_LEANE)], op('d-lea', CC, '2026-04-01', MOTIF_LEA, -euros(20)), ...creditsLeaLeane());
    expect(matchTirelireTransfers(avant).operations.map((o) => [o.id, o.transferAccountId])).toEqual([['d-lea', LEANE]]);
    const d = de(importer(avant), 'd-lea');
    expect([d.transferAccountId, d.transferOperationId]).toEqual([LEANE, 'c-leane']);
  });

  it('[niveau 2] deux ordres reconnaissent exactement, à égalité de longueur : aucune destination, aucune reprise d’office, chacun se propose', () => {
    const avant = base([ordreFamille('ordre-lea', LEA, 'LEA'), ordreFamille('ordre-thomas', THOMAS, 'TOM')], op('d', CC, '2026-04-01', 'VIR LEA TOM', -euros(20)));
    expect(matchTirelireTransfers(avant).operations).toEqual([]);
    expect(proposeMatches(avant, '2026-03-25', '2026-04-10').map((p) => [p.flowId, p.auto]).sort()).toEqual([
      ['ordre-lea', false],
      ['ordre-thomas', false],
    ]);
  });
});

describe('#488 · 8. une reprise automatique n’a qu’un candidat', () => {
  it('[niveau 2] deux flux reconnaissent un libellé, l’un souplement : aucun ne le reprend d’office, chacun se propose', () => {
    const flux = (id: string, motif: string): PlannedFlow => ({ id, name: id, kind: 'fixedCharge', amount: -euros(30), accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-05' }, dateWindowDays: 5, labelPattern: motif });
    const avant = base([flux('court', 'ABONNEMENT SALLE SPORT'), flux('long', 'ABONNEMENT SALLE SPORT CLUB ANNUEL')], op('d', CC, '2026-04-05', 'PRLV ABONNEMENT SALLE SPORT CLUB', -euros(30)));
    expect(labelRecognizer('ABONNEMENT SALLE SPORT')(avant.operations[0]!)).toBe('exact');
    expect(labelRecognizer('ABONNEMENT SALLE SPORT CLUB ANNUEL')(avant.operations[0]!)).toBe('souple');
    expect(proposeMatches(avant, '2026-03-25', '2026-04-10').map((p) => [p.flowId, p.auto]).sort()).toEqual([
      ['court', false],
      ['long', false],
    ]);
    expect(de(importer(avant), 'd').plannedFlowId).toBeUndefined();
  });

  it('[niveau 4] un seul flux reconnaît le libellé, exactement : il le reprend d’office, comme avant', () => {
    const flux: PlannedFlow = { id: 'court', name: 'court', kind: 'fixedCharge', amount: -euros(30), accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-05' }, dateWindowDays: 5, labelPattern: 'ABONNEMENT SALLE SPORT' };
    const avant = base([flux], op('d', CC, '2026-04-05', 'PRLV ABONNEMENT SALLE SPORT CLUB', -euros(30)));
    expect(proposeMatches(avant, '2026-03-25', '2026-04-10').map((p) => [p.flowId, p.auto])).toEqual([['court', true]]);
  });
});

// Le point 8 amendé une troisième fois (porteur, 16/10) : « Le piège de l'ordre de Noël » de l'issue,
// libellés inventés (D84). Seuls comptent les flux qui retiennent le virement, leur sélection entière.
const MOTIF_NOEL = 'VIR SEPA ARGENT POCHE LEA NOEL';

/** L'ordre de Noël vers Léa, 50 € chaque 1er décembre, sauf ce que le test change. */
function ordreNoel(o: Partial<PlannedFlow> = {}): PlannedFlow {
  return { ...ordreFamille('ordre-noel', LEA, MOTIF_NOEL), amount: -euros(50), periodicity: { interval: 1, unit: 'year', anchorDate: '2025-12-01' }, ...o };
}

const avril = () => [op('d-avril', CC, '2026-04-01', MOTIF_LEA, -euros(20)), op('c-avril', LEA, '2026-04-01', 'VIR RECU', euros(20))];
const reprisesAvril = (l: Ledger) => proposeMatches(l, '2026-03-25', '2026-04-10').map((p) => [p.operationId, p.flowId, p.auto]);
const MENSUEL_PAR_MOIS = { periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-01' } } as const;

describe('#488 · 8. le piège de l’ordre de Noël : seuls comptent les flux qui retiennent le virement', () => {
  it('[niveau 2] l’ordre de Noël, que son montant et sa fenêtre écartent, ne compte pas : l’ordre mensuel reprend le virement d’office, et l’appariement se fait', () => {
    const avant = base([ordreFamille('ordre-mois', LEA, MOTIF_LEA), ordreNoel()], ...avril());
    expect([labelRecognizer(MOTIF_LEA)(avant.operations[0]!), labelRecognizer(MOTIF_NOEL)(avant.operations[0]!)]).toEqual(['exact', 'souple']);
    expect(reprisesAvril(avant)).toEqual([['d-avril', 'ordre-mois', true]]);
    const d = de(importer(avant), 'd-avril');
    expect([d.transferAccountId, d.transferOperationId, d.plannedFlowId, d.state]).toEqual([LEA, 'c-avril', 'ordre-mois', 'reconciled']);
  });

  it('[niveau 2] le montant seul, ou la fenêtre seule, l’écarte : l’ordre mensuel le reprend d’office', () => {
    expect(reprisesAvril(base([ordreFamille('ordre-mois', LEA, MOTIF_LEA), ordreNoel(MENSUEL_PAR_MOIS)], ...avril()))).toEqual([['d-avril', 'ordre-mois', true]]);
    expect(reprisesAvril(base([ordreFamille('ordre-mois', LEA, MOTIF_LEA), ordreNoel({ amount: -euros(20) })], ...avril()))).toEqual([['d-avril', 'ordre-mois', true]]);
  });

  it('[niveau 2] si le montant et la fenêtre de l’ordre de Noël le retenaient aussi, aucun ne le reprend d’office : la reprise se propose avec chacun', () => {
    const avant = base([ordreFamille('ordre-mois', LEA, MOTIF_LEA), ordreNoel({ amount: -euros(20), ...MENSUEL_PAR_MOIS })], ...avril());
    expect(reprisesAvril(avant).sort()).toEqual([
      ['d-avril', 'ordre-mois', false],
      ['d-avril', 'ordre-noel', false],
    ]);
    const d = de(importer(avant), 'd-avril');
    expect([d.transferAccountId, d.transferOperationId, d.plannedFlowId]).toEqual([LEA, 'c-avril', undefined]);
  });
});

// Cinquième tour : un flux sans motif retient le virement (sa sélection entière), et une destination
// connue n'est reprise d'office que par un ordre vers elle. Tests du codeur
// (`virements-internes-488-candidats.test.ts`), repris sur les données du piège de l'ordre de Noël.
const NOEL_20 = ordreNoel({ amount: -euros(20), ...MENSUEL_PAR_MOIS });
const fluxMensuel = (o: Partial<PlannedFlow> & Pick<PlannedFlow, 'id' | 'kind' | 'amount' | 'accountId'>): PlannedFlow => ({ name: o.id, ...MENSUEL_PAR_MOIS, dateWindowDays: 5, amountTolerance: { pct: 20 }, ...o });
/** Une dépense sans motif, 20 € chaque mois, sur le compte principal. */
const DEPENSE = fluxMensuel({ id: 'depense', kind: 'fixedCharge', amount: -euros(20), accountId: CC });

describe('#488 · 8. une reprise automatique n’a qu’un candidat : un flux sans motif retient le virement', () => {
  it('[niveau 2] l’ordre de Noël à 20 € chaque mois et une dépense sans motif de 20 € : aucun ne le reprend d’office, la reprise se propose avec chacun', () => {
    const avant = base([NOEL_20, DEPENSE], ...avril());
    expect(reprisesAvril(avant).sort()).toEqual([
      ['d-avril', 'depense', false],
      ['d-avril', 'ordre-noel', false],
    ]);
    const d = de(importer(avant), 'd-avril');
    expect([d.transferAccountId, d.transferOperationId, d.plannedFlowId]).toEqual([LEA, 'c-avril', undefined]);
  });

  it('[niveau 2] de même avec un ordre vers Léa sans motif', () => {
    const sansMotif = fluxMensuel({ id: 'ordre-sans-motif', kind: 'transfer', amount: -euros(20), accountId: CC, counterpartAccountId: LEA });
    expect(reprisesAvril(base([NOEL_20, sansMotif], ...avril())).sort()).toEqual([
      ['d-avril', 'ordre-noel', false],
      ['d-avril', 'ordre-sans-motif', false],
    ]);
  });
});

describe('#488 · 8. un virement n’est repris d’office que par un ordre vers sa destination connue', () => {
  it('[niveau 2] l’ordre mensuel, hors de sa fenêtre, donne la destination Léa : la dépense sans motif de 20 € se propose seulement', () => {
    const le15 = { ...ordreFamille('ordre-mois', LEA, MOTIF_LEA), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-15' } } as PlannedFlow;
    const avant = base([le15, DEPENSE], ...avril());
    expect(reprisesAvril(avant)).toEqual([['d-avril', 'depense', false]]);
    const d = de(importer(avant), 'd-avril');
    expect([d.transferAccountId, d.transferOperationId, d.plannedFlowId]).toEqual([LEA, 'c-avril', undefined]);
  });

  it('[niveau 2] un crédit désigné depuis le principal : un revenu sans motif du compte de Léa se propose seulement, un ordre de Léa depuis le principal le reprend d’office', () => {
    const credit = op('c-avril', LEA, '2026-04-01', 'VIR RECU', euros(20), { transferAccountId: CC, state: 'reconciled' });
    const revenu = fluxMensuel({ id: 'revenu', kind: 'income', amount: euros(20), accountId: LEA });
    const recu = fluxMensuel({ id: 'ordre-recu', kind: 'transfer', amount: euros(20), accountId: LEA, counterpartAccountId: CC });
    expect(reprisesAvril(base([revenu], credit))).toEqual([['c-avril', 'revenu', false]]);
    expect(reprisesAvril(base([recu], credit))).toEqual([['c-avril', 'ordre-recu', true]]);
  });
});

describe('#488 · 5. une reprise par l’ordre d’un autre compte défait l’appariement', () => {
  it('[niveau 0] le côté apparié repris par un ordre vers un autre compte : les deux côtés ne se désignent plus, l’autre garde son état', () => {
    const l = importer(base([ordreFamille('ordre-lea', LEA, MOTIF_LEA)], op('d', CC, '2026-04-01', MOTIF_LEA, -euros(20)), op('c', LEA, '2026-04-01', 'VIR RECU', euros(20))));
    expect(de(l, 'd').transferOperationId).toBe('c');
    // L'utilisateur confirme une reprise par un ordre vers Thomas (« Reprendre une occurrence »).
    const avecThomas: Ledger = { ...l, plannedFlows: [...l.plannedFlows, ordreFamille('ordre-thomas', THOMAS, 'AUTRE MOTIF')] };
    const apres = applyPatchToLedger(avecThomas, applyMatch(avecThomas, { operationId: 'd', flowId: 'ordre-thomas', expectedDate: '2026-04-01', expectedAmount: -euros(20), score: 1, auto: false, reasons: [] }));
    const d = de(apres, 'd');
    const c = de(apres, 'c');
    expect([d.transferAccountId, d.transferOperationId]).toEqual([THOMAS, undefined]);
    expect([c.transferAccountId, c.transferOperationId, c.state]).toEqual([undefined, undefined, de(l, 'c').state]);
  });

  it('[niveau 4] repris par un ordre vers le compte qu’il désigne déjà : l’appariement reste', () => {
    const avant = base([ordreFamille('ordre-lea', LEA, 'AUTRE MOTIF')], op('d', CC, '2026-04-01', 'VIR SEPA', -euros(20), { transferAccountId: LEA, transferOperationId: 'c', state: 'reconciled' }), op('c', LEA, '2026-04-01', 'VIR RECU', euros(20), { transferAccountId: CC, transferOperationId: 'd', state: 'reconciled' }));
    const apres = applyPatchToLedger(avant, applyMatch(avant, { operationId: 'd', flowId: 'ordre-lea', expectedDate: '2026-04-01', expectedAmount: -euros(20), score: 1, auto: false, reasons: [] }));
    expect([de(apres, 'd').transferOperationId, de(apres, 'c').transferOperationId]).toEqual(['c', 'd']);
  });
});
