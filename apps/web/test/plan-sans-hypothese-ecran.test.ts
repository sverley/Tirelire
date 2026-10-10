// @vitest-environment jsdom
/**
 * Harnais d'audit de #419, composé parmi les tests du codeur :
 * ce que vérifiait, dans le navigateur, le harnais d'audit de #183 côté écran (« Le plan des
 * périodes à venir suppose exécutés ses propres virements (D52), contre le principe 1.3 »), que #419 retire, se vérifie
 * ici sans navigateur : l'application montée sous jsdom (`ecran.ts`). Chaque titre dit le point du « Fait quand » de
 * #183 qu'il vérifie, et le numéro du test retiré dans la table de #419 (« sans hypothèse 1 » à « sans hypothèse 7 »).
 *
 * Ce qui se lit ici : l'écran Plan comme le porteur le lit — les boutons de période, la légende de la période, les
 * cartes « Virements à faire depuis le compte principal », la liste « Tirelires » —, et la ligne de chaque flux à
 * l'écran Flux prévus. Aucun montant n'est figé : ce que les tirelires demandent est relu dans la liste « Tirelires »
 * du même écran, et recalculé par le cœur sur le même projet, à la même date. Le calcul de chaque point :
 * `packages/core/test/plan-sans-hypothese.test.ts`, sous le même numéro.
 *
 * Décors : l'exemple chargé par « Charger l'exemple », lu au 6 septembre 2026 (`loadExample`) ; pour les points 5 et 7,
 * un projet écrit ici, posé dans l'application comme elle pose l'exemple (`replaceWith`), lu au jour des tests, le
 * 20 septembre 2026. Deux lectures à des dates différentes ne se comparent jamais entre elles.
 *
 * Niveaux (D83) : ceux des tests retirés, que la table de #419 recopie. 1 pour les sept (principe 1.3 : le plan sans
 * hypothèse ; U1 : le plan sans suivi des opérations ; U3 : le plan qui ne change pas quand on commence à importer),
 * chacun vu rouge à l'audit sur une mutation ciblée de l'application.
 */
import { describe, expect, it } from 'vitest';
import {
  alive,
  applyMatch,
  applyPatchToLedger,
  computePlan,
  emptyLedger,
  euros,
  exampleLedger,
  missingFlows,
  normalizeLabel,
  periodsAround,
  proposeMatches,
  standingTransferFlow,
  type Ledger,
  type Operation,
} from '@tirelire/core';
import { JOUR, allerA, app, attendre, cliquer, cliquerExactement, ecran, ouvrirLApplication, rendu, t, tous } from './ecran';

const COMPTE = 'Livret A';
const LECTURE_EXEMPLE = '2026-09-06';
const PRINCIPAL = 'acc-principal';

/** Les périodes de l'exemple lu à sa date : celle où l'on lit, puis les trois à venir. */
const [SEPTEMBRE, ...A_VENIR] = periodsAround(exampleLedger(), LECTURE_EXEMPLE, 0, 3);

/** « 1 234,56 € » → 123456 centimes ; `NaN` sans montant. */
function centimes(texte: string): number {
  const m = texte.replace(/[\s  ]/g, '').match(/-?−?\d+(?:,\d{1,2})?/);
  if (!m) return NaN;
  const signe = m[0].startsWith('-') || m[0].startsWith('−') ? -1 : 1;
  const [e, c = '0'] = m[0].replace(/^[-−]/, '').split(',');
  return signe * (Number(e) * 100 + Number(c.padEnd(2, '0')));
}

/** Ce que D52 fait dire à la légende d'une période à venir, et que l'issue retire (principe 1.3). */
const SUPPOSITION = /soldes?\s+projet[ée]s?|suppos[ée]s?\s+(?:faits?|exécut[ée]s?)/i;
/** Une position de compte, dans une période dont aucun relevé n'existe. */
const POSITION_DE_COMPTE = /à\s+rapatrier|non\s+couvertes?\s+par\s+le\s+solde/i;
/** Un manquement, ou l'état d'une occurrence attendue : ce qu'un plan sans suivi ne montre pas. */
const SUIVI = /non\s+re[çc]u|manquement|attendu/i;

/** Ouvre l'application et charge l'exemple, comme le bouton de l'accueil, puis va au Plan. */
async function ouvrirLExemple(): Promise<void> {
  await ouvrirLApplication();
  expect(await cliquer('Charger l\'exemple')).toBe(true);
  await attendre(() => alive(app.ledger.accounts).some((a) => a.name === COMPTE) && app.asOf === LECTURE_EXEMPLE, 'l’exemple');
  await allerA('Plan');
}

/** Ouvre l'application sur ce projet, posé comme l'application pose l'exemple (`replaceWith`), et va au Plan. */
async function ouvrirSur(l: Ledger): Promise<void> {
  await ouvrirLApplication();
  await app.replaceWith(l);
  await rendu();
  expect(app.asOf).toBe(JOUR);
  await allerA('Plan');
}

/** Choisit une période par son bouton, et vérifie que l'écran l'a prise. */
async function allerALaPeriode(periode: string): Promise<void> {
  expect(await cliquerExactement(periode), `bouton de la période « ${periode} » introuvable`).toBe(true);
  expect(lireLEcran().periode, `la période « ${periode} » n’est pas affichée`).toBe(periode);
}

/** La période choisie, la légende sous les boutons de période (« Période du … au … »), et tout le texte de l'écran. */
function lireLEcran() {
  const main = document.querySelector('main')!;
  return {
    periode: tous('.actions .btn.small.primary', main).map(t).find((x) => /^\S+ \d{4}$/.test(x)) ?? '',
    legende: t(tous('p', main).find((p) => /^\s*Période du/.test(p.textContent ?? ''))),
    texte: t(main),
  };
}

interface Carte {
  /** Le montant en gros, en tête de la carte : ce qu'il faut virer. */
  titre: number;
  lignes: Array<{ libelle: string; montant: number }>;
  texte: string;
}

/** La carte « Virements à faire depuis le compte principal » d'un compte, telle qu'affichée. */
function carte(compte = COMPTE): Carte | null {
  const c = tous('main .card').find((x) => t(x.querySelector(':scope > .row strong')) === compte);
  if (!c) return null;
  const rows = tous(':scope > .row', c);
  const valeur = (r: Element) => t(r.querySelector(':scope > .num, :scope > div:last-child'));
  const titre = valeur(rows[0]!);
  return {
    titre: (titre.includes('←') ? -1 : 1) * centimes(titre),
    lignes: rows.slice(1).map((r) => ({ libelle: t(r.querySelector('.label')), montant: centimes(valeur(r)) })),
    texte: t(c),
  };
}

/** La liste « Tirelires » de l'écran : une ligne par besoin, avec le compte où il se place et ce qu'il demande. */
function tirelires(): { lignes: Array<{ nom: string; compte: string; demande: number }>; texte: string } {
  const h = tous('main h2').find((x) => t(x) === 'Tirelires');
  const c = h?.nextElementSibling;
  if (!c) return { lignes: [], texte: '' };
  const lignes = tous(':scope > .row:not(.total)', c).map((r) => {
    const subs = tous('.sub', r).map(t);
    const compte = (subs[0] ?? '').split(' · ')[1]?.replace(/\s*\(réservé sur place\)$/, '').trim() ?? '';
    const chiffres = subs.find((s) => /croisière/.test(s)) ?? '';
    const demande = chiffres.match(/demandé\s+([^·]+)/)?.[1] ?? chiffres.match(/croisière\s+([^·]+)/)?.[1] ?? '';
    return { nom: t(r.querySelector('.label strong')), compte, demande: centimes(demande) };
  });
  return { lignes, texte: t(c) };
}

/** Ce que les tirelires d'un compte demandent, lu dans la liste « Tirelires » de l'écran. */
const demandeALEcran = (compte = COMPTE) => tirelires().lignes.filter((l) => l.compte === compte).reduce((s, l) => s + l.demande, 0);

/** Des lignes de relevé du compte principal, non classées : commencer à importer. */
function avecImport(l: Ledger): Ledger {
  const ligne = (id: string, date: string, libelle: string, montant: number): Operation => ({
    id,
    accountId: PRINCIPAL,
    origin: 'imported',
    date,
    label: libelle,
    normalizedLabel: normalizeLabel(libelle),
    amount: montant,
    state: 'untreated',
  });
  return { ...l, operations: [...l.operations, ligne('imp-1', '2026-09-02', 'CB CARREFOUR', -euros(45.3)), ligne('imp-2', '2026-09-03', 'CB BOULANGERIE', -euros(12.8))] };
}

/** Rapproche une ligne de relevé de l'occurrence d'un flux, comme l'import (D12). */
function pointer(l: Ledger, op: Operation): Ledger {
  const avec: Ledger = { ...l, operations: [...l.operations, op] };
  const proposition = proposeMatches(avec, '2026-07-01', '2026-11-30').find((p) => p.operationId === op.id);
  if (!proposition) throw new Error(`la ligne « ${op.label} » n’est pas reconnue comme l’occurrence d’un flux : le projet du test est faux`);
  return applyPatchToLedger(avec, applyMatch(avec, proposition));
}

/**
 * Un budget avec suivi des opérations et trois virements permanents, un par état d'occurrence, lu le 20 septembre
 * 2026 (fenêtre de cinq jours pour chacun) :
 * - « Livret A » : occurrence du 28 août, pointée par une ligne de relevé du 29 août ;
 * - « Livret B » : occurrence du 18 septembre, sans ligne ; sa fenêtre court jusqu'au 23 : attendue ;
 * - « Livret C » : occurrence du 3 septembre, sans ligne ; sa fenêtre s'est close le 8 : attendue non reçue.
 * Chaque flux ne commence qu'à son occurrence : aucune autre ne compte.
 */
function grandLivreAvecTroisVirements(): Ledger {
  const l = emptyLedger({ periodStartDay: 28, principalCushion: euros(300) });
  l.accounts.push({ id: PRINCIPAL, name: 'Compte courant', kind: 'principal', openingBalance: euros(3000), openingDate: '2026-08-27' });
  const livrets = [
    { cle: 'a', nom: 'Livret A', ancre: '2026-08-28' },
    { cle: 'b', nom: 'Livret B', ancre: '2026-09-18' },
    { cle: 'c', nom: 'Livret C', ancre: '2026-09-03' },
  ];
  for (const { cle, nom } of livrets) {
    l.accounts.push({ id: `liv-${cle}`, name: nom, kind: 'epargne', openingBalance: 0, openingDate: '2026-08-27' });
    l.tirelires.push({ id: `tir-${cle}`, name: `Projet ${cle.toUpperCase()}`, placement: [{ accountId: `liv-${cle}`, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28' });
    l.needs.push({ id: `bes-${cle}`, tirelireId: `tir-${cle}`, kind: 'goal', amount: euros(5000), monthlyAmount: euros(100), priority: 30 } as never);
  }
  l.plannedFlows.push({
    id: 'flux-salaire',
    name: 'Salaire',
    kind: 'income',
    amount: euros(2000),
    accountId: PRINCIPAL,
    periodicity: { interval: 1, unit: 'month', anchorDate: '2026-08-28' },
    dateWindowDays: 3,
    labelPattern: 'SALAIRE',
  } as never);

  const plan = computePlan(l, JOUR);
  for (const { cle, ancre } of livrets) {
    const v = plan.transfers.find((x) => x.accountId === `liv-${cle}`);
    const flux = v && standingTransferFlow(plan, v, PRINCIPAL, `flux-vir-${cle}`, euros(100));
    if (!flux) throw new Error(`le budget du test ne demande rien vers le Livret ${cle.toUpperCase()}`);
    l.plannedFlows.push({ ...flux, activeFrom: ancre, periodicity: { ...flux.periodicity, anchorDate: ancre } });
  }

  const ligne = (id: string, date: string, libelle: string, montant: number): Operation => ({ id, accountId: PRINCIPAL, origin: 'imported', date, label: libelle, normalizedLabel: normalizeLabel(libelle), amount: montant, state: 'untreated' });
  let suivi = pointer(l, ligne('op-salaire', '2026-08-28', 'VIR SALAIRE ACME', euros(2000)));
  suivi = pointer(suivi, ligne('op-vir-a', '2026-08-29', 'VIR PERMANENT TIRELIRE LIVRET A', -euros(100)));

  // Les états attendus, vérifiés ici pour que le projet du test ne se trompe pas.
  const manque = missingFlows(suivi, '2026-07-01', JOUR).map((m) => m.name);
  if (manque.join() !== 'Virement Livret C') throw new Error(`le projet du test devrait avoir un seul virement non reçu (Livret C) : ${manque.join(', ') || 'aucun'}`);
  if (!alive(suivi.operations).some((o) => o.id === 'op-vir-a' && o.plannedFlowId === 'flux-vir-a')) throw new Error('l’occurrence du Livret A n’est pas pointée dans le projet du test');
  return suivi;
}

/**
 * Ce que l'écran dit d'un compte ou de son virement : sa carte, et chaque ligne qui le nomme, chacune précédée, sur le
 * Plan, du titre de son bloc (« Attendus, non reçus » dit l'état de ses lignes). Les titres de l'écran Flux prévus
 * rangent les flux par nature et ne disent rien d'un état : ils ne comptent pas. Seule la plus petite ligne compte.
 */
function passages(nom: string, surLePlan = true): string[] {
  const dit = (el: Element) => {
    const mots: string[] = [];
    const marche = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = marche.nextNode(); n; n = marche.nextNode()) mots.push(n.textContent ?? '');
    return mots.join(' ').replace(/\s+/g, ' ').trim();
  };
  const titre = (el: Element) => {
    const h = el.closest('.card')?.previousElementSibling;
    return surLePlan && h && h.tagName === 'H2' ? `${dit(h)} — ` : '';
  };
  const sorties: string[] = [];
  if (surLePlan) for (const c of tous('main .card')) if (t(c.querySelector(':scope > .row strong')) === nom) sorties.push(titre(c.firstElementChild ?? c) + dit(c));
  const lignes = tous('main .row, main li, main tr').filter((r) => dit(r).includes(nom));
  for (const r of lignes) {
    if (lignes.some((autre) => autre !== r && r.contains(autre))) continue;
    sorties.push(titre(r) + dit(r));
  }
  return sorties;
}

/** Les états qu'un ensemble de passages dit. Le genre et le nombre importent peu. */
function etats(textes: string[]) {
  const tout = textes.join(' | ');
  return {
    // « repris » : depuis #306, l'occurrence que réalise une opération est reprise par elle (D88).
    pointee: /(?:(?:point|rapproch)[ée]|repris)e?s?(?![a-zé])/i.test(tout),
    attendue: /attendu(?:e|s|es)?(?![a-zé])/i.test(tout.replace(/attendus?,?\s+non\s+re[çc]us?/gi, '')),
    nonRecue: /non\s+re[çc]u(?:e|s|es)?(?![a-zé])/i.test(tout),
  };
}

/** Ce que disent d'un virement le Plan de septembre et sa ligne à l'écran Flux prévus. */
async function lecture(compte: string) {
  const surLePlan = passages(compte);
  expect(await ecran('Flux prévus')).toBe(true);
  const surLesFlux = passages(`Virement ${compte}`, false);
  expect(surLesFlux.length, `aucune ligne de « Virement ${compte} » à l’écran Flux prévus`).toBeGreaterThan(0);
  await allerA('Plan');
  return { surLePlan, surLesFlux, ...etats([...surLePlan, ...surLesFlux]) };
}

describe('#419 · #183 — le plan sans hypothèse, sans navigateur', () => {
  describe('l’exemple, sans suivi des opérations', () => {
    it('[niveau 1] #183 points 2 et 6 (table #419, sans hypothèse 1) — aucune période à venir ne dit « soldes projetés » ni « virements supposés faits », ni ne montre de position de compte', async () => {
      await ouvrirLExemple();
      for (const p of A_VENIR) {
        await allerALaPeriode(p.label);
        const e = lireLEcran();
        expect(e.legende, `« ${p.label} » : pas de légende de période`).toMatch(/^Période du/);
        expect(e.legende, `« ${p.label} » : la légende d’une période à venir suppose des virements exécutés (D52) : « ${e.legende} »`).not.toMatch(SUPPOSITION);
        expect(e.texte, `une position de compte apparaît dans « ${p.label} », où aucun relevé n’existe`).not.toMatch(POSITION_DE_COMPTE);
        expect(carte(), `carte « ${COMPTE} » absente en ${p.label} : un plan sans hypothèse reste complet`).not.toBeNull();
      }
    });

    it('[niveau 1] #183 points 3 et 4 (table #419, sans hypothèse 2) — pour chaque période à venir, le virement vers le Livret A vaut ce que ses tirelires demandent, lu sur la même page', async () => {
      await ouvrirLExemple();
      for (const p of A_VENIR) {
        await allerALaPeriode(p.label);
        const c = carte();
        expect(c, `carte « ${COMPTE} » absente en ${p.label}`).not.toBeNull();
        const demande = demandeALEcran();
        expect(demande, `aucune tirelire du ${COMPTE} ne demande rien en ${p.label} : le test lit mal la liste « Tirelires »`).toBeGreaterThan(0);
        expect(c!.titre, `${p.label} : la carte du ${COMPTE} ne vire pas ce que ses tirelires demandent — ${c!.texte.slice(0, 300)}`).toBe(demande);
        // Le même montant, recalculé par le cœur sur le même projet, à la même date.
        const plan = computePlan(exampleLedger(), p.start, LECTURE_EXEMPLE);
        expect(demande).toBe(plan.lines.filter((l) => l.accountId === 'acc-livret').reduce((s, l) => s + l.requested, 0));
      }
    });

    it('[niveau 1] #183 point 6 (table #419, sans hypothèse 3) — sans suivi des opérations, le plan ne montre, en aucune période, ni manquement ni état d’occurrence', async () => {
      await ouvrirLExemple();
      for (const p of [SEPTEMBRE!, ...A_VENIR]) {
        await allerALaPeriode(p.label);
        expect(lireLEcran().texte, `sans opération importée, « ${p.label} » parle de suivi`).not.toMatch(SUIVI);
        expect(carte(), `carte « ${COMPTE} » absente en ${p.label} : le plan sans suivi est complet`).not.toBeNull();
      }
    });
  });

  // Le point 5 dit « se lit sur son flux » : l'état de chaque occurrence se lit sur la ligne du flux (écran Flux
  // prévus). Le manquement se voit en plus depuis le plan de sa période.
  describe('un budget avec suivi des opérations et trois virements permanents, lu le 20 septembre', () => {
    async function ouvrirLeBudgetSuivi(): Promise<void> {
      await ouvrirSur(grandLivreAvecTroisVirements());
      const e = lireLEcran();
      expect(e.periode).toBe('septembre 2026');
      expect(e.legende).toMatch(/soldes au 20 sept/i);
    }

    it('[niveau 1] #183 point 5 (table #419, sans hypothèse 4) — le virement pointé se lit « pointé » sur son flux, et n’est pas un manquement', async () => {
      await ouvrirLeBudgetSuivi();
      const v = await lecture('Livret A');
      expect(etats(v.surLesFlux).pointee, `rien ne dit, sur le flux, que l’occurrence du 28 août du « Virement Livret A » est pointée : ${v.surLesFlux.join(' | ')}`).toBe(true);
      expect(v.nonRecue, 'un virement pointé ne remonte pas en « attendu, non reçu »').toBe(false);
    });

    it('[niveau 1] #183 point 5 (table #419, sans hypothèse 5) — le virement dont la fenêtre est ouverte se lit « attendu » sur son flux, sans être un manquement', async () => {
      await ouvrirLeBudgetSuivi();
      const v = await lecture('Livret B');
      expect(etats(v.surLesFlux).attendue, `rien ne dit, sur le flux, que l’occurrence du 18 septembre du « Virement Livret B » est attendue dans sa fenêtre : ${v.surLesFlux.join(' | ')}`).toBe(true);
      expect(v.nonRecue, 'sa fenêtre est ouverte : ce n’est pas encore un manquement').toBe(false);
      expect(v.pointee, 'aucune ligne de relevé ne l’a rapproché').toBe(false);
    });

    it('[niveau 1] #183 point 5 (table #419, sans hypothèse 6) — le virement attendu non reçu se lit « non reçu » sur son flux, et se voit depuis le plan de sa période', async () => {
      await ouvrirLeBudgetSuivi();
      const v = await lecture('Livret C');
      expect(etats(v.surLesFlux).nonRecue, `le « Virement Livret C » du 3 septembre, fenêtre close le 8, n’est pas dit non reçu sur son flux : ${v.surLesFlux.join(' | ')}`).toBe(true);
      // Depuis le plan de sa période, sans avoir à changer d'écran.
      expect(etats(v.surLePlan).nonRecue, 'le manquement se voit depuis le plan de septembre, sans ouvrir les flux').toBe(true);
      expect(v.pointee).toBe(false);
    });
  });

  describe('commencer à importer', () => {
    it('[niveau 1] #183 point 7 (table #419, sans hypothèse 7) — le même projet, avec des lignes de relevé en plus, affiche les mêmes virements permanents et les mêmes tirelires', async () => {
      const periodes = periodsAround(exampleLedger(), JOUR, 0, 3).map((p) => p.label);
      const lire = async () => {
        const lu: Array<{ periode: string; permanent: number | undefined; tirelires: string }> = [];
        for (const periode of periodes) {
          await allerALaPeriode(periode);
          const c = carte();
          expect(c, `carte « ${COMPTE} » absente en ${periode}`).not.toBeNull();
          const permanent = c!.lignes.find((l) => /^Virement permanent/.test(l.libelle))?.montant;
          expect(permanent, `${periode} : la carte « ${COMPTE} » ne dit pas de virement permanent`).not.toBeUndefined();
          const tl = tirelires();
          expect(tl.lignes.length).toBeGreaterThan(0);
          lu.push({ periode, permanent, tirelires: tl.texte });
        }
        return lu;
      };
      await ouvrirSur(exampleLedger());
      const sans = await lire();
      await ouvrirSur(avecImport(exampleLedger()));
      expect(alive(app.ledger.operations).some((o) => o.id === 'imp-1'), 'les lignes de relevé ne sont pas dans le projet').toBe(true);
      const avec = await lire();
      expect(avec, 'les virements permanents ou les tirelires changent quand on commence à importer').toEqual(sans);
    });
  });
});
