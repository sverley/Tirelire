// @vitest-environment jsdom
/**
 * Harnais d'audit de #418, composé parmi les tests du codeur :
 * ce que vérifiait `navigateur/importer-budget-harnais.test.ts`, harnais d'audit de #367
 * (« Importer un budget JSON depuis Configuration ou par une adresse, et le valider dans l'assistant »), sauf I7,
 * sans navigateur : l'application montée sous jsdom (`ecran.ts`), au 6 septembre 2026, projet vierge, l'exemple de
 * `docs/format-budget-json.md` (« Exemple complet »). Chaque titre dit le point du « Fait quand » de #367 qu'il
 * vérifie, et le numéro du test retiré dans la table de #418 (« import 1 » à « import 7 »).
 *
 * L'adresse d'ouverture est celle de la page neuve (`ouvrirLApplication('/#budget=…')`), lue par `app.init()` comme
 * dans le navigateur ; l'application déjà ouverte la reçoit par un changement de sa partie après « # »
 * (`hashchange`). « Rouverte » : la page se ferme, et l'application se rouvre sur ce qu'elle a enregistré. Le
 * brouillon seul : `importer-budget.test.ts`. Le message de refus lui-même : `packages/core/test/budget-json-harnais.test.ts`.
 * Reste dans le navigateur : « aucune requête ne porte le budget » (I7), `navigateur/importer-budget-harnais.test.ts`.
 *
 * Niveaux (D83) : ceux des tests retirés, que la table de #418 recopie. 1 pour import 1 (I10), rouge quand l'import
 * écrit le budget dans le projet sans attendre la validation ; 2 pour les autres.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computePlan, exampleLedger, periodReadingDate, periodsAround, type Ledger } from '@tirelire/core';
import { allerA, app, attendre, avancer, cliquer, fixerLeJour, lire, ouvrirLApplication, pause, projet, rendu, rouvrirLApplication, saisir, t, tous } from './ecran';

const JOUR = '2026-09-06';
fixerLeJour(JOUR);
const DOC = readFileSync(resolve(process.cwd(), '../../docs/format-budget-json.md'), 'utf8');
const EXEMPLE = [...DOC.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!).find((b) => b.includes('"planned_flows"'))!;
const ADRESSE = (json = EXEMPLE) => `/#budget=${encodeURIComponent(json)}`;
/** L'exemple sans ses salaires : l'assistant, s'il proposait d'office, les ajouterait. */
const SANS_SALAIRE = (() => {
  const j = JSON.parse(EXEMPLE) as { planned_flows: Array<{ name: string }> };
  j.planned_flows = j.planned_flows.filter((f) => f.name !== 'Salaire');
  return JSON.stringify(j);
})();
const FAUX = EXEMPLE.replace('"opening_balance": 234000', '"opening_balance": "deux"').replace('"opening_balance": 481500', '"opening_balance": "trois"');

const texte = () => t(document.querySelector('main'));
const auResume = () => lire().primaires.includes('Valider mon budget');

function plans(l: Ledger) {
  return periodsAround(l, JOUR, 0, 12).map((p) => {
    const plan = computePlan(l, periodReadingDate(p, JOUR), JOUR);
    return {
      periode: [p.start, p.end],
      totaux: plan.totals,
      lignes: plan.lines.map((x) => [x.name, x.kind, x.requested, x.funded, x.status]),
      virements: plan.transfers.map((x) => [x.accountName, x.permanent, x.standing, x.net, x.bankOrder?.amount ?? null]),
      annonces: plan.warnings.map((w) => [w.code, w.message]),
    };
  });
}
const sansOperations = (): Ledger => ({ ...exampleLedger(), operations: [], subOperations: [], shortfallAnswers: [] });
/** Le budget que porte le dépôt : comptes, tirelires, besoins, catégories, flux, réglages (sans l'identifiant de l'appareil). */
const budgetDe = (l: Ledger) => JSON.stringify({ accounts: l.accounts, tirelires: l.tirelires, needs: l.needs, categories: l.categories, plannedFlows: l.plannedFlows, settings: { ...l.settings, siteId: undefined } });

/** Plus, puis « Importer un budget (JSON) ». */
async function ouvrirLEntree() {
  await allerA('Plus');
  expect(await cliquer('Importer un budget (JSON)'), 'pas d’entrée « Importer un budget (JSON) »').toBe(true);
}

async function coller(json: string) {
  await saisir(document.querySelector('main textarea') as unknown as HTMLInputElement, json);
  expect(await cliquer('Importer ce texte')).toBe(true);
}

async function choisirLeFichier(json: string) {
  const champ = document.querySelector('main input[type="file"]') as HTMLInputElement | null;
  expect(champ, 'pas de champ fichier').toBeTruthy();
  Object.defineProperty(champ!, 'files', { configurable: true, value: [new File([json], 'budget.json', { type: 'application/json' })] });
  champ!.dispatchEvent(new Event('change', { bubbles: true }));
  await attendre(auResume, 'le résumé de l’assistant');
}

/** L'adresse de l'application déjà ouverte change sa partie après « # » : comme un lien suivi dans le même onglet. */
async function changerLAdresse(json = EXEMPLE) {
  window.location.hash = ADRESSE(json).slice(1);
  await pause();
  await rendu();
}

/**
 * De l'étape où l'on est, recule jusqu'à la première, puis avance par les boutons primaires jusqu'au résumé ; rend
 * les noms que chaque étape montrait. Les raccourcis restent offerts à un budget importé (D46) : ils ne sont pas des
 * lignes.
 */
async function parcourirLesEtapes() {
  for (let i = 0; i < 15 && (await cliquer('Précédent')); i++);
  const vues: string[] = [];
  for (let i = 0; i < 15 && !auResume(); i++) {
    vues.push(`${lire().h2} : ${tous<HTMLInputElement>('main input.nom').map((x) => x.value).join(', ')}`);
    await avancer();
  }
  expect(auResume(), 'l’assistant ne revient pas à son résumé').toBe(true);
  return vues;
}

describe('#418 · #367 point 4 — rien n’est enregistré avant « Valider mon budget », sans navigateur', () => {
  it('[niveau 1] #367 point 4, I10 (table #418, import 1) — importé par le texte collé, puis par l’adresse, l’assistant s’ouvre au résumé ; quitté sans valider, le projet reste vierge, et rouverte sur ce qu’elle a enregistré, l’application montre « Construire mon budget »', async () => {
    await ouvrirLApplication();
    const avant = budgetDe(projet());
    await ouvrirLEntree();
    await coller(EXEMPLE);
    expect(auResume(), 'le texte collé n’ouvre pas l’assistant au résumé').toBe(true);
    await allerA('Plan');
    expect(budgetDe(projet()), 'le projet a changé sans validation (texte collé)').toBe(avant);

    await rouvrirLApplication(ADRESSE());
    expect(auResume(), 'l’adresse n’ouvre pas l’assistant au résumé').toBe(true);
    await allerA('Plan');
    expect(budgetDe(projet()), 'le projet a changé sans validation (adresse)').toBe(avant);

    await rouvrirLApplication();
    expect(budgetDe(projet())).toBe(avant);
    expect(texte()).toContain('Construire mon budget');
  });
});

describe('#418 · #367 points 2, 3, 6 — le parcours de bout en bout, par chaque voie, sans navigateur', () => {
  for (const voie of ['texte collé', 'fichier choisi', 'adresse'] as const) {
    it(`[niveau 2] #367 points 2, 3, 6, D46 (table #418, import 2) — ${voie} : le résumé dit « Ce budget vient d’un import » et « Rien n’est encore enregistré », les étapes ne proposent rien d’office, « Valider mon budget » mène à « Votre budget est enregistré », et le plan est celui de l’exemple au centime`, async () => {
      if (voie === 'texte collé') {
        // L'exemple porte déjà les lignes que l'assistant proposerait : un budget auquel il en manque dit si elles s'ajoutent.
        await ouvrirLApplication();
        await ouvrirLEntree();
        await coller(SANS_SALAIRE);
        const importe = budgetDe(app.assistantLedger);
        await parcourirLesEtapes();
        expect(budgetDe(app.assistantLedger), 'une étape a ajouté d’office une ligne que le budget importé n’a pas').toBe(importe);
      }
      if (voie === 'adresse') {
        await ouvrirLApplication(ADRESSE());
        expect(window.location.hash, 'l’adresse garde le budget après lecture').toBe('');
      } else {
        await ouvrirLApplication();
        await ouvrirLEntree();
        if (voie === 'texte collé') await coller(EXEMPLE);
        else await choisirLeFichier(EXEMPLE);
      }
      expect(auResume()).toBe(true);
      expect(texte()).toContain('Ce budget vient d’un import');
      expect(texte()).toContain('Rien n’est encore enregistré');
      // Rien ne s'ajoute d'office en parcourant les étapes : ce que l'assistant montre reste le budget importé.
      const montre = budgetDe(app.assistantLedger);
      const vues = await parcourirLesEtapes();
      expect(vues.length, 'les étapes ne se parcourent pas').toBeGreaterThanOrEqual(8);
      expect(budgetDe(app.assistantLedger), 'une étape a ajouté des lignes d’office').toBe(montre);
      expect(await parcourirLesEtapes(), 'repasser par les étapes change leurs lignes').toEqual(vues);
      expect(await cliquer('Valider mon budget')).toBe(true);
      expect(texte()).toContain('Votre budget est enregistré');
      expect(plans(projet())).toEqual(plans(sansOperations()));
      if (voie === 'adresse') {
        await rouvrirLApplication();
        expect(auResume(), 'rouvrir refait l’import').toBe(false);
        expect(app.assistant, 'rouvrir refait l’import').toBeUndefined();
      }
    });
  }

  it('[niveau 2] #367 point 2 (table #418, import 3) — application déjà ouverte, assistant au début : une adresse #budget= ouvre l’assistant sur le budget importé', async () => {
    await ouvrirLApplication();
    await allerA('Plus');
    expect(await cliquer('Lancer')).toBe(true);
    expect(texte()).not.toContain('Ce budget vient d’un import');
    await changerLAdresse();
    expect(window.location.hash).toBe('');
    expect(texte(), 'l’assistant affiché ne montre pas le budget importé').toContain('Ce budget vient d’un import');
  });
});

describe('#418 · #367 point 4 — ce que l’assistant avait préparé est remplacé, et l’entrée le dit, sans navigateur', () => {
  /** Un assistant préparé : ouvert depuis Configuration, son principe franchi, l'étape suivante garnie de l'exemple (D46). */
  async function brouillonPrepare() {
    await ouvrirLApplication();
    await allerA('Plus');
    expect(await cliquer('Lancer')).toBe(true);
    expect(await avancer()).toBe(true);
    expect(app.assistantPrepare, 'l’assistant n’a rien préparé').toBe(true);
    await allerA('Plan');
  }

  it('[niveau 2] #367 point 4 (table #418, import 4) — un assistant préparé, l’écran d’import dit « Importer un budget les remplace »', async () => {
    await brouillonPrepare();
    await ouvrirLEntree();
    expect(texte()).toContain('Importer un budget les remplace');
  });

  it('[niveau 2] #367 point 4 (table #418, import 5) — par une adresse : « Garder mes changements » n’importe rien ; « Remplacer par ce budget » remplace le brouillon', async () => {
    await brouillonPrepare();
    await changerLAdresse();
    expect(window.location.hash).toBe('');
    expect(await cliquer('Garder mes changements')).toBe(true);
    await allerA('Plus');
    expect(await cliquer('Lancer')).toBe(true);
    expect(texte()).not.toContain('Ce budget vient d’un import');
    expect(app.assistant?.budgetImporte ?? false).toBe(false);
    await allerA('Plan');
    await changerLAdresse();
    expect(await cliquer('Remplacer par ce budget')).toBe(true);
    expect(texte()).toContain('Ce budget vient d’un import');
  });
});

describe('#418 · #367 point 5 — un JSON refusé n’ouvre pas l’assistant et ne change rien, sans navigateur', () => {
  it('[niveau 2] #367 point 5 (table #418, import 6) — sur l’écran d’import : « Ce budget JSON ne se lit pas », le premier problème (accounts, opening_balance) et « 1 autre problème » ; l’assistant ne s’ouvre pas, le projet ne change pas', async () => {
    await ouvrirLApplication();
    const avant = budgetDe(projet());
    await ouvrirLEntree();
    await coller(FAUX);
    const vu = texte();
    expect(vu).toContain('Importer un budget (JSON)');
    expect(vu).toMatch(/Ce budget JSON ne se lit pas/);
    expect(vu).toMatch(/accounts/);
    expect(vu).toMatch(/opening_balance/);
    expect(vu).toMatch(/1 autre problème/);
    expect(vu).not.toContain('Valider mon budget');
    expect(app.assistant).toBeUndefined();
    expect(budgetDe(projet())).toBe(avant);
  });

  it('[niveau 2] #367 point 5 (table #418, import 7) — à l’ouverture par une adresse : « Le budget de l’adresse n’a pas été importé », « 1 autre problème » ; l’assistant ne s’ouvre pas, le projet reste vierge', async () => {
    await ouvrirLApplication();
    const vierge = budgetDe(projet());
    await rouvrirLApplication(ADRESSE(FAUX));
    const vu = texte();
    expect(vu).toContain('Le budget de l\'adresse n\'a pas été importé');
    expect(vu).toMatch(/1 autre problème/);
    expect(auResume()).toBe(false);
    expect(app.assistant).toBeUndefined();
    expect(budgetDe(projet()), 'le refus a changé le projet').toBe(vierge);
  });
});
