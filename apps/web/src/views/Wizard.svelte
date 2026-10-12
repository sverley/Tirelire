<!--
  Assistant de configuration (D40) : construire un budget en répondant à des questions simples,
  pas en remplissant les écrans de configuration. Chaque réponse prépare les objets du modèle
  (tirelires, besoins, flux prévus) sans que l'utilisateur ait à connaître ces mots.
  L'assistant n'écrit dans le projet qu'à sa validation, au résumé : jusque-là il lit et écrit son
  brouillon (`app.assistantLedger`, `app.assistantUpsert`…), jamais le projet. Quitter l'assistant
  sans valider n'enregistre rien.
  Le compte principal existe dans toute base : l'assistant en renseigne les informations, il ne le
  crée pas ; les autres comptes sont proposés, jamais imposés.
  Depuis l'écran de sa partie, l'assistant s'ouvre sur sa seule section (D94, #363) : ses étapes,
  puis un résumé qui ne valide qu'elle ; le reste de l'assistant est celui de l'assistant complet.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/state.svelte';
  import Manque from '../lib/Manque.svelte';
  import SectionTirelires from '../lib/SectionTirelires.svelte';
  import SectionComptes from '../lib/SectionComptes.svelte';
  import SectionCategories from '../lib/SectionCategories.svelte';
  import SectionRevenusCharges from '../lib/SectionRevenusCharges.svelte';
  import VentilationOrdre from '../lib/VentilationOrdre.svelte';
  import ExplicationVentilation from '../lib/ExplicationVentilation.svelte';
  import ConsigneOrdre from '../lib/ConsigneOrdre.svelte';
  import ExplicationSuite from '../lib/ExplicationSuite.svelte';
  import { ordreAPoser } from '../lib/consigneOrdre';
  import { SectionTirelires as Section } from '../lib/sectionTirelires.svelte';
  import { SectionComptes as SectionDesComptes } from '../lib/sectionComptes.svelte';
  import { SectionCategories as SectionDesCategories } from '../lib/sectionCategories.svelte';
  import { SectionRevenusCharges as SectionDesFlux } from '../lib/sectionRevenusCharges.svelte';
  import { carteDeLOrdre, fichierAEnregistrer, ordreEnregistre, partsDeLOrdre, preparerValidation, titreDeLAssistant, type SectionAssistant } from '../lib/brouillon';
  import { direDifference } from '../lib/differenceAssistant';
  import { saveFile } from '../lib/platform';
  import { budgetDefiniEnJson } from '@tirelire/core';
  import { money, periodicityLabel, shortDate, centsToInput, openAccounts } from '../lib/format';
  import {
    activeAt,
    alive,
    addDays,
    divideCents,
    dueDateShortfalls,
    shortfallsForPeriod,
    parseDate,
    todayISO,
    budgetPeriodContaining,
    needName,
    budgetSuggestions,
    suggestedOrder,
    standingOrderTarget,
    MAIN_ACCOUNT_ID,
    type Cents,
    type OrderSuggestion,
    type Tirelire,
    type PlannedFlow,
  } from '@tirelire/core';
  import { aideCategorie } from '../lib/aides';

  type Step = 'intro' | 'income' | 'fixed' | 'everyday' | 'periodic' | 'savings' | 'categories' | 'accounts' | 'summary';

  const TOUTES_LES_ETAPES: Array<{ id: Step; label: string }> = [
    { id: 'intro', label: 'Le principe' },
    { id: 'accounts', label: 'Comptes' },
    { id: 'income', label: 'Revenus' },
    { id: 'fixed', label: 'Charges fixes' },
    { id: 'everyday', label: 'Budgets' },
    { id: 'periodic', label: 'Pas tous les mois' },
    { id: 'savings', label: 'Épargne' },
    { id: 'categories', label: 'Catégories' },
    { id: 'summary', label: 'Résumé' },
  ];

  /** Les étapes de chaque section, quand l'assistant s'ouvre sur elle seule (#363) : puis le résumé. */
  const ETAPES_DES_SECTIONS: Record<SectionAssistant, Step[]> = {
    comptes: ['accounts', 'summary'],
    tirelires: ['everyday', 'periodic', 'savings', 'summary'],
    categories: ['categories', 'summary'],
    revenus: ['income', 'fixed', 'summary'],
  };

  /**
   * Le brouillon : ce que l'assistant prépare, tenu par l'application. On y retrouve, en revenant, ce
   * qui a été préparé et l'étape où l'on s'était arrêté ; il n'entre dans le projet qu'à la validation.
   */
  const brouillon = app.ouvrirAssistant();

  /**
   * La section sur laquelle l'assistant est ouvert, depuis l'écran de sa partie (#363) ; absente,
   * l'assistant complet. Ses étapes sont celles de l'assistant complet, montrées et maniées de même.
   */
  const sectionOuverte = brouillon.section;
  const STEPS = sectionOuverte ? TOUTES_LES_ETAPES.filter((s) => ETAPES_DES_SECTIONS[sectionOuverte].includes(s.id)) : TOUTES_LES_ETAPES;
  /** L'écran d'où l'assistant ouvert sur une section a été ouvert, et où il ramène (#363, point 6). */
  const ECRAN_DE_LA_SECTION = {
    comptes: { vue: 'accounts', retour: 'Revenir aux comptes' },
    tirelires: { vue: 'tirelires', retour: 'Revenir aux tirelires' },
    categories: { vue: 'categories', retour: 'Revenir aux catégories' },
    revenus: { vue: 'flows', retour: 'Revenir aux flux prévus' },
  } as const;
  function revenirALEcran() {
    if (!sectionOuverte) return;
    const { vue } = ECRAN_DE_LA_SECTION[sectionOuverte];
    if (!app.back() || app.view !== vue) {
      app.switchTab('more');
      app.go(vue);
    }
  }

  let step = $state<Step>(untrack(() => brouillon.etape as Step));
  const stepIndex = $derived(STEPS.findIndex((s) => s.id === step));
  /** Le budget est validé : il est entré dans le projet, et l'assistant n'a plus rien à préparer. */
  let valide = $state(false);
  let erreurValidation = $state('');

  const accounts = $derived(alive(app.assistantLedger.accounts));
  const tirelires = $derived(alive(app.assistantLedger.tirelires));
  const needs = $derived(alive(app.assistantLedger.needs));
  const flows = $derived(alive(app.assistantLedger.plannedFlows));
  const categories = $derived(alive(app.assistantLedger.categories));
  const principal = $derived(accounts.find((a) => a.kind === 'principal'));
  /** Les comptes des menus : un compte clos n'en fait plus partie (D56) ; il reste listé à l'étape Comptes. */
  const comptesOuverts = $derived(openAccounts(accounts, app.asOf));
  const incomes = $derived(flows.filter((f) => f.kind === 'income'));
  const plan = $derived(app.assistantPlan);
  const totals = $derived(plan.totals);
  /**
   * Ce que le Plan de la période en cours annoncera une fois l'assistant validé : ses annonces, et ses
   * échéances en manque, lues comme le Plan les lit (`Plan.svelte`) mais sur ce que l'assistant montre.
   * Le résumé les dit toutes : rien ne se cache (principe 4), et il ne dit « Tout est finançable » que
   * si le Plan n'en annonce aucune.
   */
  const manques = $derived(shortfallsForPeriod(dueDateShortfalls(app.assistantLedger, app.asOf), plan.period, app.asOf));
  const nbAnnonces = $derived(plan.warnings.length + manques.length);

  /**
   * Date d'ouverture d'une tirelire : le début de la période en cours. La chronologie ne
   * démarre qu'à la première période entièrement postérieure à l'ouverture ; ouvrir « aujourd'hui »
   * priverait donc le budget de sa toute première période.
   */
  const periodStart = () => budgetPeriodContaining(app.asOf, Number(startDay) || 1).start;

  /**
   * Le compte principal existe dans toute base, sous la même identité partout (D40, D58) :
   * l'assistant ne le crée jamais, il y rattache ce qu'il écrit et en renseigne les informations.
   */
  function mainAccountId(): string {
    return principal?.id ?? MAIN_ACCOUNT_ID;
  }

  function goStep(s: Step) {
    sectionCategories.effacerErreurs();
    step = s;
    brouillon.etape = s;
    semer(s);
  }
  function next() {
    if (stepIndex < STEPS.length - 1) goStep(STEPS[stepIndex + 1]!.id);
  }
  function prev() {
    if (stepIndex > 0) goStep(STEPS[stepIndex - 1]!.id);
  }

  // --- Début de la période budgétaire : un choix du foyer, pas un champ de compte (D44) ---
  // Valeur initiale volontairement figée : le champ est ensuite piloté par la saisie.
  let startDay = $state(untrack(() => String(app.assistantLedger.settings.periodStartDay)));
  function saveStartDay() {
    const d = Math.min(31, Math.max(1, Number(startDay) || 1));
    startDay = String(d);
    if (app.assistantLedger.settings.periodStartDay !== d) app.assistantSetSetting('periodStartDay', d);
    recalerLesClotures();
  }
  /** Jour du plus gros revenu déclaré : ce que l'assistant propose comme début de période. */
  const jourDuRevenu = $derived.by(() => {
    const principal = [...incomes].sort((a, b) => b.amount - a.amount)[0];
    return principal ? parseDate(principal.periodicity.anchorDate).d : undefined;
  });

  // --- Revenus et charges fixes : la section, écrite une fois (#364), qui écrit ici dans le brouillon (#210) ---
  const sectionFlux = new SectionDesFlux({
    get ledger() {
      return app.assistantLedger;
    },
    upsert: (key, row) => app.assistantUpsert(key, row),
    remove: (key, id) => app.assistantRemove(key, id),
    newId: () => app.newId(),
    get asOf() {
      return app.asOf;
    },
    mainAccountId,
  });

  // --- Tirelires : la section, écrite une fois (#361), qui écrit ici dans le brouillon (#210) ---
  const section = new Section({
    get ledger() {
      return app.assistantLedger;
    },
    upsert: (key, row) => app.assistantUpsert(key, row),
    remove: (key, id) => app.assistantRemove(key, id),
    newId: () => app.newId(),
    get asOf() {
      return app.asOf;
    },
    periodStart,
    mainAccountId,
  });

  // --- Comptes : la section, écrite une fois (#362), qui écrit ici dans le brouillon (#210) ---
  const sectionComptes = new SectionDesComptes({
    get ledger() {
      return app.assistantLedger;
    },
    upsert: (key, row) => app.assistantUpsert(key, row),
    remove: (key, id) => app.assistantRemove(key, id),
    newId: () => app.newId(),
    get asOf() {
      return app.asOf;
    },
    periodStart,
    mainAccountId,
    get coussin() {
      return app.assistantLedger.settings.principalCushion;
    },
    setCoussin: (c) => app.assistantSetSetting('principalCushion', c),
    ordreEnregistre: (id) => enregistre(id),
  });

  // --- Catégories : la section, écrite une fois (#365), qui écrit ici dans le brouillon (#210) ---
  const sectionCategories = new SectionDesCategories(
    {
      get ledger() {
        return app.assistantLedger;
      },
      upsert: (key, row) => app.assistantUpsert(key, row),
      remove: (key, id) => app.assistantRemove(key, id),
      newId: () => app.newId(),
    },
    // L'aide du formulaire : la ligne du premier raccourci restant de l'étape, à défaut la première de l'exemple (D43).
    (restantes, toutes) => aideCategorie(restantes, toutes),
  );

  // --- Placement des réserves ---
  /** Placement voulu d'une tirelire (D38) : tout sur un compte, ou rien de déclaré. */
  function setPlacement(e: Tirelire, accountId: string) {
    const placement = accountId ? [{ accountId, share: { kind: 'variable' as const } }] : [];
    app.assistantUpsert('tirelires', { ...e, placement });
  }
  // --- Ordres permanents déjà posés chez la banque (D60) : ce qu'ils exécutent est un fait, le seul montant qui s'enregistre ---
  const ordres = $derived(flows.filter((f) => standingOrderTarget(f, mainAccountId()) !== undefined));
  /** Un ordre enregistré : le projet le porte (#407 ; `ordreEnregistre`). */
  const enregistre = (id: string): boolean => ordreEnregistre(app.ledger, id);
  /** Ce que montre la carte d'un ordre — ses comptes, ses parts, retirés compris et marqués (#407, point 8 ; #409, points 5 et 7). */
  const carte = (f: PlannedFlow) => carteDeLOrdre(app.ledger, app.assistantLedger, brouillon, f, mainAccountId());
  /** Ce que le budget de l'assistant demande comme ordre permanent vers ce compte (D60) : un calcul, relu à chaque lecture. */
  const demandeVers = (accountId?: string) => app.assistantPlan.transfers.find((t) => t.accountId === accountId)?.permanent ?? 0;
  /**
   * Les ordres à poser chez la banque (#13, points 1 à 4) : pour chaque compte d'accueil vers lequel
   * le budget que l'assistant montre demande un ordre, et vers lequel aucun ordre n'est montré, l'ordre
   * que l'écran Plan proposera une fois l'assistant validé — son montant, sa ventilation, son libellé
   * et son jour, lus sur le même calcul (`ordreAPoser`). Rien ne s'enregistre ici (D43, D60, I10) :
   * l'ordre s'enregistre sur l'écran Plan, une fois posé chez la banque (#394).
   */
  const aPoser = $derived(
    app.assistantPlan.transfers.flatMap((t) => {
      if (t.permanent <= 0 || !t.proposal || t.bankOrder || ordres.some((f) => standingOrderTarget(f, mainAccountId()) === t.accountId)) return [];
      const ordre = ordreAPoser(app.assistantPlan, t, mainAccountId());
      return ordre ? [{ t, proposal: t.proposal, ordre }] : [];
    }),
  );

  /**
   * Les propositions ne s'offrent que sur un projet vierge (D43), tel qu'il était à l'ouverture de
   * l'assistant : l'état est figé dans le brouillon, sinon la première ligne préparée ferait
   * disparaître les propositions suivantes. Sur un projet existant, l'assistant part de son contenu.
   */
  const projetVierge = brouillon.projetVierge;

  // --- Propositions (D43) : elles ne se présentent que dans l'assistant, rien n'entre d'office dans le projet (D40) ---
  // Les raccourcis sont toujours offerts : l'interface ne change pas d'un projet à l'autre (D46).
  // Flux et besoins se proposent avec toutes leurs versions, chacune avec ses dates, quelle que soit
  // la date de lecture (D51) : seul le montant d'un raccourci suit la version en vigueur.
  const propositions = budgetSuggestions();
  /** Un raccourci déjà repris disparaît : on ne propose pas ce qui existe déjà. */
  const dejaPris = (nom: string) => flows.some((f) => f.name === nom) || tirelires.some((t) => t.name === nom);
  /** Le compte du même nom, ici ; le compte principal se désigne par l'absence de nom. */
  const compteNomme = (nom: string) => accounts.find((a) => a.name === nom)?.id;
  /** La tirelire du même nom, ici : celle où se lie une part d'un ordre proposé (#395). */
  const tirelireNommee = (nom: string) => tirelires.find((t) => t.name === nom)?.id;
  /** Un ordre de l'exemple ne se propose que si ses deux comptes sont ici, et qu'aucun flux ne porte déjà son nom (D46). */
  const restantsOrdres = $derived(
    propositions.orders.filter((o) => !dejaPris(o.name) && suggestedOrder(o, { id: '', principalId: mainAccountId(), compte: compteNomme }) !== undefined),
  );

  /** L'ordre de l'exemple, déjà posé chez la banque : il s'enregistre à la validation, comme ce que la banque exécute (D60). */
  function appliquerOrdre(p: OrderSuggestion) {
    const f = suggestedOrder(p, { id: app.newId(), principalId: mainAccountId(), compte: compteNomme, tirelire: tirelireNommee });
    if (f) app.assistantUpsert('plannedFlows', f);
  }
  /**
   * À la validation, l'ordre que le projet ne porte pas ne garde que les parts que montre sa carte
   * (`partsDeLOrdre` : #395 ; #409, point 6) ; un ordre enregistré garde toutes les siennes (#407 ; D60, I10).
   */
  function elaguerLesParts() {
    for (const f of ordres) {
      const parts = f.action?.allocation;
      if (!parts?.length) continue;
      const gardees = partsDeLOrdre(app.ledger, app.assistantLedger, brouillon, f) ?? [];
      if (gardees.length === parts.length) continue;
      const { allocation: _retirees, ...action } = f.action!;
      app.assistantUpsert('plannedFlows', { ...f, action: gardees.length ? { ...action, allocation: gardees } : action });
    }
  }
  /**
   * Recale la clôture des comptes clos que l'assistant a lui-même créés sur le début de période qu'il
   * retient maintenant : à chaque changement de ce jour, et à la validation, de sorte que ce qui entre
   * dans le projet est la veille du premier jour de la période retenue, quel que soit le moment où le
   * compte a été semé. L'assistant ne donne pas de clôture lui-même : un compte clos qu'il a créé,
   * absent du projet, porte celle de l'exemple ; un compte clos du projet n'est jamais touché.
   */
  function recalerLesClotures() {
    const veille = sectionComptes.clotureDeLExemple();
    const duProjet = new Set(app.ledger.accounts.map((a) => a.id));
    for (const a of accounts) {
      if (a.activeTo !== undefined && !duProjet.has(a.id) && a.activeTo !== veille) {
        app.assistantUpsert('accounts', { ...a, activeTo: veille });
      }
    }
  }
  /**
   * Projet vierge : on présente d'office tous les raccourcis de l'étape, dans l'assistant — comme si
   * l'utilisateur les avait touchés un par un —, il n'a plus qu'à corriger et retrancher. Une seule
   * fois par étape : sans cette mémoire, tout supprimer les ferait repousser au retour sur l'étape.
   * La mémoire est celle du brouillon : elle se retrouve en revenant dans l'assistant.
   */
  function semer(etape: Step) {
    if (!projetVierge || brouillon.budgetImporte || brouillon.semees.includes(etape)) return;
    brouillon.semees.push(etape);
    if (etape === 'accounts') {
      sectionComptes.garnir();
    }
    if (etape === 'income') sectionFlux.garnir('income');
    if (etape === 'fixed') sectionFlux.garnir('fixedCharge');
    if (etape === 'everyday' || etape === 'periodic' || etape === 'savings') section.garnir(etape);
    // Les catégories viennent après les flux et les tirelires, vers lesquels elles se lient (D32).
    if (etape === 'categories') sectionCategories.garnir();
    // L'ordre se propose là où l'assistant demande où dort chaque tirelire : au résumé — de l'assistant
    // complet seulement : ouvert sur une section, il ne touche à aucun ordre permanent (#363, point 4).
    if (etape === 'summary' && !sectionOuverte) restantsOrdres.forEach(appliquerOrdre);
  }
  // Ouvert sur une section, l'assistant arrive sur sa première étape, qui se garnit comme si on y était allé (D46).
  if (sectionOuverte) untrack(() => semer(step));

  /**
   * Ce que la validation va changer au projet du moment (#379, point 3) : la différence entre le
   * brouillon et ce que l'assistant a lu, dite partie par partie, et les lignes changées des deux côtés.
   */
  const aValider = $derived.by(() => {
    const { difference, preparation } = preparerValidation(app.ledger, brouillon);
    const montre = app.assistantLedger;
    const nommer = (prop: string, id: string): string | undefined => {
      const table = prop === 'tirelireId' ? montre.tirelires : prop === 'categoryId' || prop === 'parentId' ? montre.categories : montre.accounts;
      return (table as Array<{ id: string; name?: string }>).find((l) => l.id === id)?.name;
    };
    // Les ordres enregistrés que la validation laisse en place, tels que l'assistant les montre (#407, point 7).
    const enregistres = alive(montre.plannedFlows).filter((f) => enregistre(f.id) && standingOrderTarget(f, mainAccountId()) !== undefined);
    return direDifference(difference, preparation.ok ? preparation.conflits : [], nommer, enregistres);
  });

  /**
   * Enregistre le brouillon sur l'appareil, en budget JSON version 2, nommé avec la date (#379,
   * point 5) : rien n'est validé, rien ne quitte l'appareil (I7).
   */
  let enregistrement = $state('');
  async function enregistrerBrouillon() {
    const json = budgetDefiniEnJson(fichierAEnregistrer(app.ledger, $state.snapshot(brouillon)));
    const nom = `tirelire-budget-${todayISO()}.json`;
    try {
      await saveFile(nom, new TextEncoder().encode(JSON.stringify(json, null, 2) + '\n'), 'application/json');
      enregistrement = `Brouillon enregistré sur cet appareil : ${nom}. Rien n’est validé.`;
    } catch {
      enregistrement = 'Le brouillon n’a pas pu être enregistré sur cet appareil.';
    }
  }

  /**
   * La validation : seul geste qui écrit dans le projet, et il n'y applique que la différence entre le
   * brouillon et ce que l'assistant a lu, tout en une fois (D40, #379). Refusée, elle n'écrit rien, dit
   * le premier problème et le nombre des autres, et garde le brouillon.
   */
  function valider() {
    try {
      if (!brouillon.budgetImporte) recalerLesClotures(); // un budget importé garde ses clôtures telles que le JSON les dit
      elaguerLesParts();
      app.validerAssistant();
      valide = true;
      erreurValidation = '';
    } catch (err) {
      erreurValidation = `Votre budget n’a pas été validé : ${err instanceof Error ? err.message : String(err)} Vos réponses sont toujours là : corrigez-les, puis validez de nouveau.`;
    }
  }
</script>

<p class="small">
  <!-- Ouvert sur une section, « ‹ Retour » ramène à son écran, sans rien enregistrer (#363, point 6). -->
  <a href="#top" onclick={(e) => { e.preventDefault(); if (sectionOuverte) revenirALEcran(); else if (!app.back()) app.switchTab('more'); }}>‹ Retour</a>
</p>
<h1>{titreDeLAssistant(sectionOuverte)}</h1>

{#if !valide}
  <div class="wizard-steps">
    {#each STEPS as s, i (s.id)}
      <button class="wstep" class:active={s.id === step} class:done={i < stepIndex} onclick={() => goStep(s.id)}>{s.label}</button>
    {/each}
  </div>
{/if}

{#if !valide && step !== 'intro' && step !== 'accounts' && !(sectionOuverte && step === 'summary')}
  <div class="stats">
    <div class="stat"><div class="v num pos">{money(totals.incomes)}</div><div class="k">Revenus par période</div></div>
    <div class="stat"><div class="v num">{money(-totals.fixedCharges)}</div><div class="k">Charges fixes</div></div>
    <div class="stat"><div class="v num">{money(totals.requested)}</div><div class="k">À mettre de côté</div></div>
    <div class="stat"><div class="v num {totals.margin < 0 ? 'neg' : 'pos'}">{money(totals.margin)}</div><div class="k">Reste à vivre</div></div>
  </div>
{/if}

{#if step === 'intro'}
  <div class="card accent">
    <h2 style="margin-top:0">Le problème que Tirelire résout</h2>
    <p>
      Certaines dépenses ne tombent pas tous les mois : l'assurance, les impôts, les vacances. Le mois
      où elles arrivent, le compte pique du nez — alors que la dépense était prévisible.
    </p>
    <p>
      Une <strong>tirelire</strong> est une réserve pour une de ces dépenses. Vous mettez un peu de côté
      à chaque paie, et l'argent est là le jour venu. Tirelire calcule combien : une facture de 1 200 €
      par an, c'est 100 € par mois. L'argent ne bouge pas de votre compte — la tirelire dit seulement
      quelle part est déjà réservée, et ce qui reste vraiment disponible.
    </p>
    <p class="muted small">
      Les questions qui suivent préparent ce budget : il n’est enregistré que lorsque vous le validez,
      à la fin. Rien n’est définitif : tout se modifie ensuite dans Configuration, et vous pouvez
      sauter une étape qui ne vous concerne pas.
    </p>
    <div class="actions" style="margin-bottom:0">
      <button class="btn primary" onclick={next}>Commencer</button>
    </div>
  </div>
  <p class="muted small">
    Vous avez enregistré un budget (JSON) ?
    <button class="btn small" onclick={() => app.go('importBudget')}>Reprendre un budget (JSON)</button>
  </p>
{:else if step === 'income'}
  <h2>Qu'est-ce qui rentre, et quand ?</h2>
  <SectionRevenusCharges s={sectionFlux} genre="income" />

  <h3>Découpage du budget</h3>
  <p class="muted small">
    Une période budgétaire n'est pas forcément le mois calendaire. Beaucoup de foyers la font
    commencer au jour de leur paie, pour savoir si l'argent tient jusqu'à la prochaine.
  </p>
  <div class="propositions">
    {#if jourDuRevenu !== undefined && Number(startDay) !== jourDuRevenu}
      <button class="prop" onclick={() => { startDay = String(jourDuRevenu); saveStartDay(); }}>
        <span class="n">Commencer au jour de ma paie</span><span class="v num">le {jourDuRevenu}</span>
      </button>
    {/if}
    {#if Number(startDay) !== 1}
      <button class="prop" onclick={() => { startDay = '1'; saveStartDay(); }}>
        <span class="n">Suivre le mois calendaire</span><span class="v num">le 1er</span>
      </button>
    {/if}
  </div>
  <form class="edit" onsubmit={(e) => { e.preventDefault(); saveStartDay(); }}>
    <div class="grid">
      <label class="f">La période commence le (jour) <input type="number" min="1" max="31" bind:value={startDay} onchange={saveStartDay} /></label>
    </div>
  </form>

{:else if step === 'fixed'}
  <h2>Qu'est-ce qui part tout seul, au même montant ?</h2>
  <SectionRevenusCharges s={sectionFlux} genre="fixedCharge" />
{:else if step === 'everyday'}
  <h2>Sur quoi voulez-vous vous tenir à un montant ?</h2>
  <SectionTirelires s={section} genre="everyday" cartes={section.parTirelire('everyday')} />
{:else if step === 'periodic'}
  <h2>Qu'est-ce qui ne tombe pas tous les mois ?</h2>
  <SectionTirelires s={section} genre="periodic" cartes={section.parTirelire('periodic')} />
{:else if step === 'savings'}
  <h2>Que voulez-vous mettre de côté ?</h2>
  <SectionTirelires s={section} genre="savings" cartes={section.parTirelire('savings')} />
{:else if step === 'categories'}
  <h2>Comment classer vos dépenses et vos rentrées ?</h2>
  <SectionCategories s={sectionCategories} />
{:else if step === 'accounts'}
  <h2>Vos comptes en banque</h2>
  <SectionComptes s={sectionComptes} />

{:else if step === 'summary' && sectionOuverte}
  <!-- Le résumé de l'assistant ouvert sur une section (#363, point 4) : ce qu'il montre, et rien d'autre. -->
  <h2>{valide ? 'Vos changements sont enregistrés' : 'Ce que vous avez préparé'}</h2>
  {#if valide}
    <p class="muted small">Ils sont entrés dans votre budget, et se modifient ensuite depuis l’écran comme d’habitude.</p>
    <div class="actions">
      <button class="btn primary" onclick={revenirALEcran}>{ECRAN_DE_LA_SECTION[sectionOuverte].retour}</button>
    </div>
  {:else}
    <div class="card">
      <p style="margin:0">
        <strong>Rien n’est encore enregistré.</strong> Vos changements n’entrent dans l’application que
        lorsque vous les validez ci-dessous. Si vous fermez ou rechargez l’application avant, ce que
        vous avez préparé ici est perdu.
      </p>
    </div>
    {@render ouDortChaqueTirelire()}
    {@render ceQueLaValidationVaChanger('Valider')}
  {/if}
{:else if step === 'summary'}
  <h2>{valide ? 'Votre budget est enregistré' : 'Votre budget'}</h2>
  {#if !valide && brouillon.budgetImporte}
    <div class="card accent">
      <p style="margin:0">
        <strong>Ce budget vient d’un import.</strong> Rien n’est enregistré avant que vous le validiez
        ci-dessous. Chaque étape montre les lignes importées : vous pouvez les corriger comme d’habitude
        avant de valider.
      </p>
    </div>
  {/if}
  {#if !valide}
    <div class="card">
      <p style="margin:0">
        <strong>Rien n’est encore enregistré.</strong> Votre budget n’entre dans l’application que
        lorsque vous le validez ci-dessous. Si vous fermez ou rechargez l’application avant, ce que
        vous avez préparé ici est perdu.
      </p>
    </div>
  {/if}
  <p class="muted small">
    Période du {shortDate(plan.period.start)} au {shortDate(plan.period.end)} : ce que le Plan dira de cette
    période une fois votre budget validé.
  </p>
  {#if nbAnnonces === 0}
    <div class="card accent">
      <p style="margin:0">
        Tout est finançable, et il vous reste <strong>{money(totals.margin)}</strong> par période une fois
        les réserves mises de côté.
      </p>
    </div>
  {:else}
    <div class="card warn">
      <p style="margin:0">
        <strong>Le plan annonce {nbAnnonces} point{nbAnnonces > 1 ? 's' : ''} à regarder.</strong> Ce n'est pas
        une erreur de votre part : c'est exactement ce que l'application est là pour montrer. Baissez un
        budget, étalez une échéance, ou mettez une épargne en attente.
      </p>
    </div>
  {/if}

  <div class="card">
    <div class="row"><div class="label">Revenus prévus</div><div class="num pos">{money(totals.incomes)}</div></div>
    <div class="row"><div class="label">Charges fixes</div><div class="num">{money(totals.fixedCharges)}</div></div>
    <div class="row"><div class="label">Dotations demandées ({needs.filter((n) => activeAt(n, app.asOf)).length})</div><div class="num">{money(totals.requested)}</div></div>
    <div class="row"><div class="label">Couvert par les revenus</div><div class="num">{money(totals.funded)}</div></div>
    {#if plan.warnings.some((w) => w.code === 'principalOverdrawn')}
      <div class="row"><div class="label">Non affecté sur le compte principal</div><div class="num neg">{money(totals.principalUnallocated)}</div></div>
    {/if}
    <div class="row total"><div class="label">Marge{totals.cushion ? ` (coussin ${money(totals.cushion)})` : ''}</div><div class="num {totals.margin < 0 ? 'neg' : 'pos'}">{money(totals.margin)}</div></div>
  </div>

  {#if plan.warnings.length}
    <div class="warnings">
      {#each plan.warnings as w}
        <div>{w.message}</div>
      {/each}
    </div>
  {/if}

  {#if manques.length}
    <h3>Échéances en manque</h3>
    <p class="muted small">Ce qui ne sera pas réuni à temps par les virements permanents. Rien ne se lisse sans vous : le Plan vous propose de lisser, une fois votre budget validé.</p>
    <div class="card warn">
      {#each manques as m (m.needId + m.dueDate)}
        <Manque manque={m} repondre={false} />
      {/each}
    </div>
  {/if}

  {@render ouDortChaqueTirelire()}
  {#if !valide && (ordres.length || restantsOrdres.length)}
    <h3>Vos virements permanents déjà en place</h3>
    <p class="muted small">
      Un virement que vous avez déjà programmé chez votre banque. Indiquez ce qu'il vire vraiment : le
      plan le compare à ce que votre budget demande, et vous dit quand le modifier.
    </p>
    <ExplicationVentilation />
    {#each ordres as f (f.id)}
      {@const c = carte(f)}
      <div class="card ordre">
        <div class="row">
          <div class="label">
            <strong>{f.name}</strong>
            <div class="muted small">
              {f.periodicity.unit === 'month' && f.periodicity.interval === 1 ? `Le ${parseDate(f.periodicity.anchorDate).d} de chaque mois` : periodicityLabel(f.periodicity)},
              de {c.de} vers {c.vers}{f.labelPattern ? ` · libellé « ${f.labelPattern} »` : ''}.
            </div>
          </div>
          <input class="mt" value={centsToInput(Math.abs(f.amount))} inputmode="decimal" aria-label="Ce que la banque vire" onchange={(e) => sectionFlux.changerMontant(f, e.currentTarget.value)} />
          <button class="btn small danger" title="Retirer ce virement" onclick={() => sectionFlux.retirer(f)}>×</button>
        </div>
        <VentilationOrdre {...c.ventilation} />
        <p class="muted small" style="margin:4px 0 0">
          Votre budget demande <strong class="num">{money(demandeVers(f.counterpartAccountId))}</strong> par mois pour {c.vers}.
        </p>
      </div>
    {/each}
    {#if restantsOrdres.length}
      <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
      <div class="propositions">
        {#each restantsOrdres as p (p.name)}
          <button class="prop" onclick={() => appliquerOrdre(p)}>
            <span class="n">+ {p.name}</span><span class="v num">{money(p.amount)}</span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}

  {#if !valide && tirelires.length}
    {#if aPoser.length}
      <h3>Vos ordres permanents à poser</h3>
      <p class="muted small">
        Votre budget demande un virement permanent du compte principal vers {aPoser.length > 1 ? 'ces comptes' : 'ce compte'}.
        L’application n’a pas accès à votre banque : posez-y l’ordre vous-même, avec ce montant, ce libellé et ce jour.
        Rien n’est enregistré ici : une fois votre budget validé et l’ordre posé, enregistrez-le sur l’écran Plan, qui le propose tel quel.
      </p>
      {#if !(ordres.length || restantsOrdres.length)}<ExplicationVentilation />{/if}
      {#each aPoser as o (o.t.accountId)}
        <div class="card ordre-a-poser">
          <div class="row">
            <div class="label"><strong>{o.t.accountName}</strong><span class="sub">ordre permanent à poser, chaque mois</span></div>
            <div class="num">{money(o.proposal.amount)}</div>
          </div>
          <VentilationOrdre montant={o.proposal.amount} allocation={o.proposal.allocation} compte={o.t.accountName} noms={{ tirelires, categories }} />
          <ConsigneOrdre ordre={o.ordre} />
        </div>
      {/each}
      <ExplicationSuite />
    {:else}
      <p class="muted small rien-a-poser">
        {ordres.length
          ? 'Aucun autre ordre permanent à poser chez votre banque : votre budget ne demande de virement permanent que vers les comptes qui en ont déjà un.'
          : 'Aucun ordre permanent à poser chez votre banque : votre budget ne demande aucun virement permanent du compte principal vers un autre compte.'}
      </p>
    {/if}
  {/if}

  {#if valide}
    <h3>Et maintenant</h3>
    {#if aPoser.length}
      <p class="small ordres-sur-le-plan">
        <strong>Vos ordres permanents se mettent en place sur l’écran Plan.</strong> Posez chacun chez votre banque,
        puis enregistrez-le sur le Plan, qui le propose avec son montant, sa ventilation, son libellé et son jour.
      </p>
    {/if}
    <p class="muted small">
      Le Plan détaille période par période ce qu'il faut mettre de côté et les virements à faire.
      Dans Configuration, vous pouvez affiner ce que l'assistant a créé : les besoins de chaque
      tirelire et leurs priorités de financement, la ventilation des dépenses par catégorie. L'import d'un relevé
      rapprochera ensuite vos opérations réelles de ce budget.
    </p>
    <div class="actions">
      <button class="btn primary" onclick={() => app.switchTab('plan')}>Voir le plan</button>
      <button class="btn" onclick={() => app.switchTab('more')}>Configuration</button>
      <button class="btn" onclick={() => app.switchTab('import')}>Importer un relevé</button>
    </div>
  {:else}
    {@render ceQueLaValidationVaChanger('Valider mon budget')}
    <p class="muted small">
      Pour le reprendre plus tard ou sur un autre appareil, sans rien valider :
      <button class="btn small" onclick={enregistrerBrouillon}>Enregistrer ce brouillon (JSON)</button>
    </p>
    {#if enregistrement}<p class="small" role="status">{enregistrement}</p>{/if}
  {/if}
{/if}

{#if step !== 'summary'}
  <div class="actions">
    {#if stepIndex > 0}<button class="btn" onclick={prev}>‹ Précédent</button>{/if}
    <button class="btn primary" onclick={next}>{step === 'intro' ? 'Commencer' : 'Suivant'} ›</button>
  </div>
{/if}

{#snippet ouDortChaqueTirelire()}
<!-- La question de l'assistant complet, aux mêmes conditions ; ouvert sur la section Comptes ou Catégories, il ne la pose pas (#363, point 4 ; #365, point 7). -->
{#if !valide && (!sectionOuverte || sectionOuverte === 'tirelires') && comptesOuverts.length > 1 && tirelires.length}
  <h3>Où dort chaque tirelire ?</h3>
  <p class="muted small">Le compte où son argent est mis de côté. Laissez « Peu importe » si vous ne savez pas : ça se change à tout moment.</p>
  {#each tirelires as e (e.id)}
    <div class="card">
      <div class="row">
        <div class="label"><strong>{e.name}</strong></div>
        <!-- Borné à sa ligne : un nom de compte long ne fait pas déborder le résumé à 375 px (C9, #13). -->
        <select style="max-width:55%;min-width:0" onchange={(ev) => setPlacement(e, (ev.currentTarget as HTMLSelectElement).value)}>
          <option value="" selected={e.placement.length === 0}>Peu importe</option>
          {#each openAccounts(accounts, app.asOf, e.placement[0]?.accountId) as a}
            <option value={a.id} selected={e.placement[0]?.accountId === a.id}>{a.name}</option>
          {/each}
        </select>
      </div>
    </div>
  {/each}
{/if}
{/snippet}

{#snippet ceQueLaValidationVaChanger(libelle: string)}
<h3>Ce que la validation va changer</h3>
{#if aValider.vide}
  <p class="muted small">Aucun changement : votre budget est déjà celui que l’assistant montre.</p>
{:else}
  <div class="card difference">
    {#each aValider.parties as partie (partie.nom)}
      <h4>{partie.nom}</h4>
      <ul>
        {#each partie.ajouts as l, i (i)}<li><span class="pill">Ajouté</span> {l.texte}</li>{/each}
        {#each partie.modifications as l, i (i)}<li><span class="pill">Modifié</span> {l.texte}{#if l.detail}<span class="muted small"> — {l.detail}</span>{/if}</li>{/each}
        {#each partie.retraits as l, i (i)}<li><span class="pill neg">Retiré</span> {l.texte}</li>{/each}
        <!-- Une ligne qui entre déjà retirée, telle que le fichier la dit : ce n'est pas un ajout (#409, point 5). -->
        {#each partie.entreesRetirees as l, i (i)}<li class="entree-retiree"><span class="pill">Ajouté, déjà retiré</span> {l.texte}{#if l.detail}<span class="muted small"> — {l.detail}</span>{/if}</li>{/each}
      </ul>
    {/each}
    {#if aValider.ordres.length}
      <!-- Ce que les retraits font aux ordres enregistrés : ils restent tels quels (#407, point 7). -->
      <h4>Virements permanents enregistrés</h4>
      <ul class="ordres-touches">
        {#each aValider.ordres as l, i (i)}<li><span class="pill">Inchangé</span> {l.texte}</li>{/each}
      </ul>
    {/if}
    {#if aValider.reglages.length}
      <h4>Réglages</h4>
      <ul>
        {#each aValider.reglages as l (l.texte)}<li><span class="pill">Modifié</span> {l.texte}<span class="muted small"> — {l.detail}</span></li>{/each}
      </ul>
    {/if}
  </div>
{/if}
{#if aValider.conflits.length}
  <div class="card warn" role="status">
    <p style="margin:0 0 6px"><strong>Changé aussi ailleurs.</strong> Ces lignes ont été modifiées hors de l’assistant depuis son ouverture : la version de l’assistant sera retenue.</p>
    <ul style="margin:0">
      {#each aValider.conflits as l, i (i)}<li>{l.texte}<span class="muted small"> — {l.detail}</span></li>{/each}
    </ul>
  </div>
{/if}
{#if erreurValidation}<div class="err">{erreurValidation}</div>{/if}
<div class="actions">
  <button class="btn" onclick={prev}>‹ Précédent</button>
  <button class="btn primary" onclick={valider}>{libelle}</button>
</div>
{/snippet}
