/**
 * État réactif de l'application : le grand livre chargé depuis le dépôt,
 * la date de calcul, et le plan dérivé.
 */
import {
  computePlan,
  diffDays,
  emptyLedger,
  exampleLedger,
  LEDGER_KEYS,
  lireBudgetJson,
  marqueDesDonnees,
  refusalAnswer,
  sauvegardeARappeler,
  smoothingAnswer,
  withdrawnAnswer,
  todayISO,
  uuidv7,
  type Ledger,
  type LedgerStore,
  type Patch,
  type Plan,
  type Conflict,
  type Settings,
  type DerniereSauvegarde,
  type SmoothingPart,
} from '@tirelire/core';
import type { LedgerKey } from '@tirelire/core';
import { lireSauvegarde, lireSynchronisation, noterSauvegarde, noterSynchronisation, type DerniereSynchronisation, type Moyen } from './sauvegarde';
import {
  brouillonDImport,
  brouillonIntact,
  ecrire as ecrireDansLeBrouillon,
  montrer,
  nouveauBrouillon,
  reglage as reglerDansLeBrouillon,
  retirer as retirerDuBrouillon,
  valider as validerLeBrouillon,
  type Brouillon,
} from './brouillon';
import { eraseStore, openStore, OuvertureRefusee, type OpenedStore } from './db';
import { demanderPersistance, type EtatPersistance } from './persistance';
import { saveFile } from './platform';
import { adressePorteUnBudget, budgetDeLAdresse } from './importBudget';

export type View = 'plan' | 'operations' | 'import' | 'review' | 'more' | 'accounts' | 'tirelires' | 'categories' | 'flows' | 'entries' | 'settings' | 'sync' | 'wizard' | 'importBudget';

class AppState {
  ledger = $state<Ledger>(emptyLedger());
  /** Date de lecture : jusqu'où les soldes sont connus (D52). Tous les écrans la suivent. */
  asOf = $state<string>(todayISO());
  view = $state<View>('plan');
  /** Vues traversées pour revenir en arrière (geste Android, chevron) sans quitter l'appli. */
  history = $state<View[]>([]);
  ready = $state(false);
  error = $state<string | undefined>(undefined);
  /**
   * Le fichier enregistré n'est pas au format de cette version (D58) : il n'est pas ouvert, et rien
   * n'en est effacé tant que l'utilisateur n'a pas choisi — l'enregistrer tel quel, repartir d'un
   * fichier neuf ou de l'exemple.
   */
  refused = $state<{ message: string; bytes: Uint8Array } | undefined>(undefined);
  /**
   * Lignes modifiées des deux côtés, rendues par la synchronisation qui les a détectées (D58). Le
   * conflit est déjà résolu ; il n'est gardé nulle part, ni dans le fichier ni à côté : cette liste
   * ne vit que le temps de la session.
   */
  conflicts = $state<Conflict[]>([]);
  /**
   * Ce que le navigateur a répondu à la demande de garder les données (C4). Refusée ou impossible,
   * l'accueil le signale et Réglages le redit ; accordée, le signal disparaît.
   */
  persistance = $state<EtatPersistance>('inconnue');
  /**
   * Le signal de l'accueil sur la sûreté des données, masqué par l'utilisateur pour cette ouverture ;
   * Réglages le redit.
   */
  signalDonneesMasque = $state(false);
  /** Les données peuvent-elles encore être effacées par le navigateur faute de place ? */
  effacable: boolean = $derived(this.persistance === 'refusee' || this.persistance === 'impossible');
  /** La dernière sauvegarde de cette instance, s'il y en a eu une depuis que ces données sont là (C5). */
  sauvegarde = $state<DerniereSauvegarde | undefined>(undefined);
  /** La dernière synchronisation de cette instance, et par où (C5). */
  synchronisation = $state<DerniereSynchronisation | undefined>(undefined);
  private opened: OpenedStore | undefined;

  /** La marque de l'état des données, relue à chaque changement ; vide tant que rien n'est saisi. */
  marqueDonnees: string = $derived.by(() => {
    void this.ledger;
    return this.opened ? marqueDesDonnees(this.opened.store) : '';
  });

  /**
   * Faut-il rappeler d'enregistrer une copie ? Jamais sauvegardé, dès qu'il y a des données ; sinon
   * quand elles ont changé depuis et que la sauvegarde date de plus d'une période budgétaire (#41).
   * Une synchronisation n'en dispense pas.
   */
  rappelSauvegarde: boolean = $derived(
    sauvegardeARappeler({ derniere: this.sauvegarde, marque: this.marqueDonnees, aujourdhui: todayISO(), debutPeriode: this.ledger.settings.periodStartDay }),
  );

  plan: Plan = $derived(computePlan(this.ledger, this.asOf));

  /**
   * Le brouillon de l'assistant (D40) : tout ce que l'assistant change tient là, à côté du projet,
   * jusqu'à sa validation. Il vit avec l'application : quitter l'assistant le garde, recharger ou
   * fermer l'application le perd ; il est vide quand aucun assistant n'est en cours.
   */
  assistant = $state<Brouillon | undefined>(undefined);

  /**
   * Change quand l'assistant reçoit un autre brouillon (un import) : l'écran de l'assistant, qui lit son
   * brouillon au montage, se remonte alors sur le nouveau, même s'il est déjà affiché (#367).
   */
  versionAssistant = $state(0);

  /** Ce que l'assistant a préparé sans le valider : un import le remplacerait (#367). */
  get assistantPrepare(): boolean {
    return !!this.assistant && !brouillonIntact(this.assistant);
  }

  /** Le refus d'un budget JSON porté par l'adresse d'ouverture (#367) : il se montre à l'ouverture, jusqu'à ce qu'on le ferme. */
  refusAdresse = $state<string | undefined>(undefined);

  /**
   * Lit un budget JSON (#366) sur le projet : accepté, il ouvre l'assistant sur son résumé, avec le
   * budget posé sur le projet, dans le brouillon — rien n'est écrit dans le projet avant la
   * validation, et ce que l'assistant avait préparé est remplacé. Refusé, rien ne change.
   */
  importerBudget(texte: string): { ok: true } | { ok: false; message: string } {
    const lu = lireBudgetJson(texte, this.ledger);
    if (!lu.ok) return { ok: false, message: lu.message };
    this.assistant = brouillonDImport(this.ledger, lu.budget);
    this.versionAssistant++;
    return { ok: true };
  }

  /**
   * L'adresse porte un budget (`#budget=` et le JSON encodé pour une adresse) : elle est lue, retirée
   * de l'adresse sans recharger la page — recharger ou revenir en arrière ne refait pas l'import —, et
   * le budget entre par l'assistant comme depuis Configuration. Rien n'est envoyé nulle part (I7).
   */
  ouvrirParAdresse(): void {
    if (typeof window === 'undefined' || !adressePorteUnBudget(window.location.hash)) return;
    const lue = budgetDeLAdresse(window.location.hash);
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    if ('texte' in lue && this.assistantPrepare) {
      // Un brouillon non vide : l'import le remplace, il ne se fait qu'avec l'accord de l'utilisateur.
      this.importEnAttente = lue.texte;
      return;
    }
    this.lireImportDeLAdresse('texte' in lue ? lue.texte : undefined, 'refus' in lue ? lue.refus : '');
  }

  /** Un budget porté par l'adresse attend l'accord de l'utilisateur : le brouillon non validé serait remplacé (#367). */
  importEnAttente = $state<string | undefined>(undefined);

  /** L'utilisateur accepte (ou non) que le budget de l'adresse remplace ce que l'assistant avait préparé. */
  repondreImportEnAttente(accepte: boolean): void {
    const texte = this.importEnAttente;
    this.importEnAttente = undefined;
    if (accepte && texte !== undefined) this.lireImportDeLAdresse(texte, '');
  }

  private lireImportDeLAdresse(texte: string | undefined, refusDeLecture: string): void {
    const r = texte !== undefined ? this.importerBudget(texte) : { ok: false as const, message: refusDeLecture };
    if (r.ok) {
      this.refusAdresse = undefined;
      this.switchTab('more');
      this.go('wizard');
    } else {
      this.refusAdresse = r.message;
    }
  }

  /** Le projet tel que l'assistant le montre : le projet, avec son brouillon dessus. Sans brouillon, le projet. */
  assistantLedger: Ledger = $derived(this.assistant ? montrer(this.ledger, this.assistant) : this.ledger);

  /** Le plan de ce que l'assistant montre : ce que le projet donnerait une fois l'assistant validé. */
  assistantPlan: Plan = $derived(computePlan(this.assistantLedger, this.asOf));

  /** Date de la dernière opération connue, tous comptes confondus (undefined sans opération). */
  lastOperationDate: string | undefined = $derived.by(() => {
    let last: string | undefined;
    for (const o of this.ledger.operations) if (!o.deletedAt && (last === undefined || o.date > last)) last = o.date;
    return last;
  });

  /**
   * Jours entre la dernière opération connue et la date de lecture. Au-delà de quelques jours,
   * les soldes et le plan supposent qu'il ne s'est rien passé depuis le dernier relevé importé :
   * l'interface doit le dire, sans quoi on lit un plan optimiste sans le savoir.
   */
  staleDays: number = $derived(this.lastOperationDate ? diffDays(this.lastOperationDate, this.asOf) : 0);

  /** La date de lecture est-elle le jour même ? Sinon, toute l'application lit une autre date. */
  readingToday: boolean = $derived(this.asOf === todayISO());

  /** Revenir à aujourd'hui après avoir consulté une autre date. */
  backToToday(): void {
    this.asOf = todayISO();
  }

  get store(): LedgerStore {
    if (!this.opened) throw new Error('Dépôt non ouvert');
    return this.opened.store;
  }

  async init(): Promise<void> {
    void this.demanderPersistance();
    if (typeof window !== 'undefined') {
      window.addEventListener('appinstalled', () => void this.demanderPersistance());
      // Une adresse qui ne change que sa partie après « # » ne recharge pas la page.
      window.addEventListener('hashchange', () => this.ready && this.ouvrirParAdresse());
    }
    try {
      this.opened = await openStore();
      this.reload();
      this.ready = true;
      this.ouvrirParAdresse();
    } catch (err) {
      if (err instanceof OuvertureRefusee) this.refused = { message: err.message, bytes: err.bytes };
      else this.error = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * Demande au navigateur de garder les données, sans geste de l'utilisateur : à chaque ouverture
   * tant qu'elles ne sont pas persistantes, et à l'installation, qu'il accorde plus volontiers.
   */
  async demanderPersistance(): Promise<void> {
    if (this.persistance === 'accordee') return;
    this.persistance = await demanderPersistance();
  }

  /** Après un refus : repartir d'un fichier neuf, ou de l'exemple. C'est ici seulement que l'ancien est effacé. */
  async startOver(example: boolean): Promise<void> {
    await eraseStore();
    this.opened = await openStore();
    this.refused = undefined;
    this.assistant = undefined;
    this.reload();
    this.ready = true;
    if (example) await this.loadExample();
  }

  reload(): void {
    this.ledger = this.store.load();
    this.lireDates();
  }

  /** Relit les dates que l'instance garde à côté du fichier. */
  private lireDates(): void {
    this.sauvegarde = lireSauvegarde(this.store);
    this.synchronisation = lireSynchronisation(this.store);
  }

  /** Une synchronisation vient d'aboutir : elle se date, avec son moyen. Un essai qui échoue n'appelle pas ceci. */
  noteSynchronisation(moyen: Moyen): void {
    noterSynchronisation(this.store, { date: todayISO(), moyen });
    this.lireDates();
  }

  /** Montre les conflits qu'une synchronisation vient de rendre. */
  showConflicts(conflicts: Conflict[]): void {
    if (conflicts.length) this.conflicts = [...this.conflicts, ...conflicts];
  }

  /** L'utilisateur a vu un conflit. */
  dismissConflict(id: string): void {
    this.conflicts = this.conflicts.filter((c) => c.id !== id);
  }

  upsert<K extends LedgerKey>(key: K, row: Ledger[K][number]): void {
    this.store.upsert(key, row);
    this.reload();
  }

  remove(key: LedgerKey, id: string): void {
    this.store.remove(key, id);
    this.reload();
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.store.setSetting(key, value);
    this.reload();
  }

  /**
   * Ouvre l'assistant : reprend son brouillon s'il y a déjà quelque chose de préparé, sinon repart du
   * projet tel qu'il est (D43 : son état d'ouverture, projet vierge ou non, se relit alors).
   */
  ouvrirAssistant(): Brouillon {
    if (!this.assistant || brouillonIntact(this.assistant)) this.assistant = nouveauBrouillon(this.ledger);
    return this.assistant;
  }

  /** L'écriture de l'assistant : dans son brouillon, jamais dans le projet. */
  assistantUpsert<K extends LedgerKey>(key: K, row: Ledger[K][number]): void {
    ecrireDansLeBrouillon(this.brouillonOuvert(), key, row);
  }

  /** Le retrait de l'assistant : dans son brouillon, jamais dans le projet. */
  assistantRemove(key: LedgerKey, id: string): void {
    retirerDuBrouillon(this.brouillonOuvert(), this.ledger, key, id);
  }

  /** Le réglage de l'assistant : dans son brouillon, jamais dans le projet. */
  assistantSetSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    reglerDansLeBrouillon(this.brouillonOuvert(), key, value);
  }

  private brouillonOuvert(): Brouillon {
    if (!this.assistant) throw new Error('Aucun assistant n’est ouvert : rien ne s’écrit dans le projet à sa place.');
    return this.assistant;
  }

  /**
   * Valide l'assistant : ce qu'il montre entre dans le projet, tout en une fois, puis son brouillon
   * se vide. Si une écriture est refusée, l'erreur remonte et le brouillon reste : valider de nouveau
   * écrit ce qui manque (`brouillon.ts`).
   */
  validerAssistant(): void {
    const brouillon = this.assistant;
    if (!brouillon) return;
    try {
      validerLeBrouillon(this.store, this.ledger, brouillon);
    } finally {
      this.reload();
    }
    this.assistant = undefined;
  }

  newId(): string {
    return uuidv7();
  }

  /** Change d'onglet principal : repart d'une pile vide (nouveau contexte de navigation). */
  switchTab(view: View): void {
    this.history = [];
    this.view = view;
  }

  /** Ouvre une vue en gardant trace de la précédente pour le retour. */
  go(view: View): void {
    if (view === this.view) return;
    this.history = [...this.history, this.view];
    this.view = view;
  }

  /**
   * Revient à la vue précédente s'il y en a une. Renvoie `false` quand la pile est
   * vide (on est à la racine d'un onglet) : c'est à l'appelant de décider, par
   * exemple quitter l'application sur le geste Android.
   */
  back(): boolean {
    const rest = this.history.slice(0, -1);
    const previous = this.history.at(-1);
    if (previous === undefined) return false;
    this.history = rest;
    this.view = previous;
    return true;
  }

  /** Écrit un patch (opérations + ventilations) d'un seul coup. */
  applyPatch(patch: Patch): void {
    for (const o of patch.operations) this.store.upsert('operations', o);
    for (const a of patch.subOperations) this.store.upsert('subOperations', a);
    for (const id of patch.removedSubOperations ?? []) this.store.remove('subOperations', id);
    if (patch.operations.length || patch.subOperations.length || patch.removedSubOperations?.length) this.reload();
  }

  /** Applique un patch sans recharger (pour enchaîner), puis rend le grand livre relu. */
  applyPatchQuiet(patch: Patch): Ledger {
    for (const o of patch.operations) this.store.upsert('operations', o);
    for (const a of patch.subOperations) this.store.upsert('subOperations', a);
    for (const id of patch.removedSubOperations ?? []) this.store.remove('subOperations', id);
    this.ledger = this.store.load();
    return this.ledger;
  }

  /**
   * Accepte, tel quel ou modifié, le lissage d'un manque (#184) : la saisie divisée en parts datées,
   * puis la réponse qui la désigne. Rend le message d'une saisie refusée, sinon rien.
   */
  acceptSmoothing(needId: string, dueDate: string, parts: SmoothingPart[]): string | undefined {
    let w: ReturnType<typeof smoothingAnswer>;
    try {
      w = smoothingAnswer(this.ledger, needId, dueDate, parts);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    for (const o of w.patch.operations) this.store.upsert('operations', o);
    for (const a of w.patch.subOperations) this.store.upsert('subOperations', a);
    this.store.upsert('shortfallAnswers', w.answer);
    this.reload();
    return undefined;
  }

  /** Refuse de lisser le manque d'une échéance (#184) : la réponse s'enregistre, sans opération. */
  refuseSmoothing(needId: string, dueDate: string): void {
    this.upsert('shortfallAnswers', refusalAnswer(needId, dueDate));
  }

  /** Retire le lissage décidé, ou revient sur le refus (#184) : la proposition revient. */
  withdrawAnswer(answerId: string): void {
    const w = withdrawnAnswer(this.ledger, answerId);
    for (const id of w.subOperationIds) this.store.remove('subOperations', id);
    if (w.operationId) this.store.remove('operations', w.operationId);
    this.store.remove('shortfallAnswers', w.answerId);
    this.reload();
  }

  /** Charge le jeu d'exemple de l'analyse (remplace les données courantes). */
  async loadExample(): Promise<void> {
    await this.replaceWith(exampleLedger());
    this.asOf = '2026-09-06';
  }

  /**
   * Remplace le dépôt par un grand livre complet (l'exemple, un jeu de démonstration).
   *
   * Les tables sont parcourues depuis `LEDGER_KEYS`, jamais énumérées à la main : la liste écrite
   * à la main avait oublié les besoins (D28), et charger l'exemple donnait des tirelires vides,
   * donc un plan sans une seule ligne. Une table ajoutée au modèle est reprise ici d'office.
   *
   * Les réglages suivent le même principe, à une exception près : `siteId` désigne *cette*
   * instance (D58) et n'appartient pas au grand livre recopié.
   */
  async replaceWith(l: Ledger): Promise<void> {
    await this.eraseAll();
    const s = this.store;
    // Boucle sur `LEDGER_KEYS` plutôt qu'une table après l'autre : la liste écrite à la main avait
    // oublié `needs`, si bien que charger l'exemple donnait des tirelires sans aucun besoin — donc
    // un plan vide. Ajouter une table au modèle ne peut plus laisser cette fonction en arrière.
    for (const key of LEDGER_KEYS) for (const row of l[key]) s.upsert(key, row as never);
    // Les réglages suivent la même règle, pour la même raison : on les parcourt au lieu de les
    // citer un par un. Seul `siteId` reste dehors — il désigne cette instance, pas les données (D58).
    for (const key of Object.keys(l.settings) as Array<keyof Settings>) {
      if (key === 'siteId') continue;
      s.setSetting(key, l.settings[key]);
    }
    this.reload();
  }

  /** Efface tout et repart d'un dépôt vide. Le brouillon de l'assistant ne parlait que des données effacées : il s'en va. */
  async eraseAll(): Promise<void> {
    this.assistant = undefined;
    await this.opened?.flush();
    this.opened?.store.close();
    await eraseStore();
    this.opened = await openStore();
    this.reload();
  }

  /** Écrit aussitôt ce qui attendait de l'être : avant de recharger la page (#142). */
  async ecrireMaintenant(): Promise<void> {
    await this.opened?.flush();
  }

  /** Export du fichier SQLite. */
  async exportBytes(): Promise<Uint8Array> {
    await this.opened?.flush();
    return this.store.export();
  }

  /**
   * Remet à l'utilisateur une copie du fichier : sa sauvegarde (C5), qui se réimporte dans Réglages.
   * Elle se date aussitôt, avec la marque des données qu'elle porte : le rappel disparaît.
   */
  async saveBackup(): Promise<void> {
    const bytes = await this.exportBytes();
    const marque = marqueDesDonnees(this.store);
    await saveFile(`tirelire-${this.asOf}.sqlite`, bytes, 'application/x-sqlite3');
    noterSauvegarde(this.store, { date: todayISO(), marque });
    this.lireDates();
  }

  /**
   * Remplace la base par un fichier SQLite importé. Le fichier est ouvert avant que rien ne soit
   * remplacé : refusé (autre format), les données courantes restent telles quelles.
   */
  async importFile(bytes: Uint8Array): Promise<void> {
    await this.opened?.flush();
    const next = await openStore(bytes);
    this.opened?.store.close();
    this.opened = next;
    this.assistant = undefined;
    this.reload();
  }
}

export const app = new AppState();
