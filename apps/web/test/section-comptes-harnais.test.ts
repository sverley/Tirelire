/**
 * Harnais d'audit de #362 — la section Comptes, écrite une fois, sert l'étape de l'assistant et l'écran Comptes.
 *
 * Sans navigateur, sur le texte des sources (tests du codeur, repris). Point 1, niveau 1 : le principe 13 et
 * I11 (« la section le rend vrai par construction », issue) ; vu rouge sur le `Wizard.svelte` de `main` et sur
 * une mutation de l'écran. Points 2 à 5, niveau 2 : D43, D45, D46, D40, D56, D59 (cas de règle). Point 6, la
 * réplique de l'explication : niveau 3 (même résultat, moins lisible). Le comportement se joue dans les tests
 * navigateur que l'issue nomme (points 2, 3, 7), adaptés par le codeur et relus.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { budgetSuggestions } from '@tirelire/core';

const lire = (chemin: string) => readFileSync(resolve(__dirname, '..', chemin), 'utf8');
const wizard = lire('src/views/Wizard.svelte');
const ecran = lire('src/views/Accounts.svelte');
const composant = lire('src/lib/SectionComptes.svelte');
const section = lire('src/lib/sectionComptes.svelte.ts');

describe('[niveau 1] #362 · 1 — une section Comptes, que l’étape de l’assistant et l’écran Comptes emploient', () => {
  it('l’étape et l’écran emploient le même composant, sur leur propre section', () => {
    expect(wizard).toMatch(/<SectionComptes s=\{sectionComptes\} \/>/);
    expect(ecran).toMatch(/<SectionComptes s=\{section\} [^>]*carte[^>]*\/>/);
  });
  it('ni l’assistant ni l’écran n’écrivent plus la ligne d’un compte, son formulaire d’ajout ni ses raccourcis', () => {
    // La seule écriture de compte restée dans l'assistant recale la clôture d'un compte clos qu'il a semé.
    expect([...wizard.matchAll(/assistantUpsert\('accounts'/g)]).toHaveLength(1);
    expect(wizard).not.toMatch(/Banque|FR76|Retirer ce compte|Ajouter un compte|class="ligne-compte|Coussin du compte/);
    // L'écran n'écrit un compte que par son panneau des champs avancés ; il supprime après confirmation.
    expect([...ecran.matchAll(/app\.upsert\('accounts'/g)]).toHaveLength(1);
    expect(ecran).not.toMatch(/Banque|FR76|Nom du compte|Ajouter en un geste/);
  });
  it('la ligne, le retrait, les raccourcis, le formulaire d’ajout, le coussin et l’explication sont dans la section', () => {
    for (const mot of ['placeholder="Banque"', 'placeholder="FR76 …"', 'title="Retirer ce compte"', 'Ajouter en un geste', 'Ajouter un compte', 'Coussin du compte principal', 'Uniquement des comptes bancaires réels']) {
      expect(composant, mot).toContain(mot);
    }
    for (const mot of ['editAccount', 'editAccountBalance', 'editCoussin', 'retirer', 'appliquer', 'garnir', 'ajouter']) expect(section, mot).toContain(mot);
  });
});

describe('[niveau 2] #362 · 2 — dans l’assistant, rien ne change : même texte, même garnissage d’office, même brouillon', () => {
  it('le texte de l’étape est celui de D43, affiché', () => {
    expect(composant).toMatch(/Uniquement des comptes bancaires réels — ceux dont vous recevez un relevé\. Le compte principal\s+est celui par lequel tout transite ; les autres sont facultatifs\./);
    expect(composant).toMatch(/\{:else\}\s*<p class="muted small">/);
  });
  it('l’assistant écrit dans son brouillon, y compris le coussin, et garnit lui-même un projet vierge (D46)', () => {
    expect(wizard).toMatch(/new SectionDesComptes\(\{[\s\S]*?app\.assistantLedger[\s\S]*?app\.assistantUpsert[\s\S]*?app\.assistantRemove[\s\S]*?app\.assistantSetSetting\('principalCushion'/);
    expect(wizard).toMatch(/if \(etape === 'accounts'\) \{\s*sectionComptes\.garnir\(\);/);
  });
});

describe('[niveau 2] #362 · 3 — l’écran écrit dans le projet, et dit « tiers » d’après le solde à régler (D45)', () => {
  it('l’écran construit la section sur le projet, avec le coussin de Réglages', () => {
    expect(ecran).toMatch(/new SectionDesComptes\(\{[\s\S]*?app\.ledger[\s\S]*?app\.upsert[\s\S]*?app\.remove[\s\S]*?app\.setSetting\('principalCushion'/);
    expect(lire('src/views/Settings.svelte')).toMatch(/app\.setSetting\('principalCushion'/);
  });
  it('un compte est tiers s’il suit un solde à régler, non selon son genre', () => {
    expect(section).toMatch(/estTiers = \(a: Account\) => !!a\.tracksSettlement/);
    expect(ecran).toMatch(/section\.estTiers\(a\)/);
    expect(ecran + composant).not.toMatch(/'accueil'|kind === 'courant'/);
  });
  it('la section ne lit ni l’application ni le brouillon : l’endroit lui donne où écrire', () => {
    expect(section).not.toMatch(/from '\.\/state\.svelte'/);
    expect(section).not.toMatch(/assistantUpsert|assistantRemove|assistantLedger|app\./);
    expect(composant).not.toMatch(/from '\.\/state\.svelte'/);
  });
});

describe('[niveau 2] #362 · 4 — ce que l’écran garde en propre', () => {
  it('le filtre d’état, les soldes, ce qui désigne un compte clos, la suppression confirmée sans supprimer le principal', () => {
    expect(ecran).toMatch(/<FiltreEtat/);
    expect(ecran).toContain('Solde reconstruit au');
    expect(ecran).toContain('Non affecté (solde − tirelires hébergées)');
    expect(ecran).toContain('Le compte principal lui doit');
    expect(ecran).toContain('compte clos, encore désigné par');
    expect(ecran).toMatch(/function remove\(a: Account\) \{\s*if \(isMain\(a\)\) return;\s*if \(confirm\(/);
    expect(ecran).toMatch(/\{#if !isMain\(a\)\}<button[\s\S]*?Supprimer/);
  });
  it('le panneau ne porte plus que les champs avancés (D59), nommé et attaché à sa ligne', () => {
    const panneau = ecran.slice(ecran.indexOf('<form class="edit attached"'), ecran.indexOf('</form>'));
    for (const mot of ['Date du solde initial', 'Compte ouvert à partir du', 'Compte clos le', 'Suivre un solde à régler', 'Seuil de règlement', 'Sens autorisé', 'titre-panneau']) expect(panneau, mot).toContain(mot);
    for (const mot of ['Numéro de compte', 'Banque', 'Type']) expect(panneau, mot).not.toContain(mot);
  });
});

describe('[niveau 2] #362 · 5 — raccourcis dans l’écran', () => {
  it('l’écran n’appelle jamais le garnissage d’office : rien n’est créé sans geste', () => {
    expect(ecran).not.toMatch(/garnir|appliquerPrincipal/);
  });
  it('les raccourcis sont les comptes de l’exemple, jamais le compte principal (D40), et disparaissent dès qu’un compte du même nom existe (D46)', () => {
    const { accounts } = budgetSuggestions();
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts.some((a) => (a.kind as string) === 'principal')).toBe(false);
    expect(section).toMatch(/restantes\(\)[\s\S]*?!this\.accounts\.some\(\(a\) => a\.name === x\.name\)/);
  });
});

describe('[niveau 3] #362 · 6 — l’explication se replie dans l’écran', () => {
  it('l’explication se replie sous « Comment ça marche ? » dans l’écran, et reste affichée dans l’assistant', () => {
    expect(composant).toMatch(/\{#if explicationRepliee\}\s*<details class="explication[^>]*><summary>Comment ça marche \?<\/summary>/);
    expect(ecran).toMatch(/<SectionComptes [^>]*\bexplicationRepliee\b/);
    expect(wizard).not.toMatch(/explicationRepliee/);
  });
});
