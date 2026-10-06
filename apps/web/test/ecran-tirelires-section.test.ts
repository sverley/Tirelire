/**
 * Tests du codeur de #369 — l'écran Tirelires emploie la section Tirelires de l'assistant.
 *
 * Sans navigateur, sur le texte des sources : la section est écrite une fois, et l'écran la donne à
 * construire sur le projet, sans réécrire ce qu'elle porte (D94). Le parcours sur le site construit est
 * dans `navigateur/ecran-tirelires-section.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (chemin: string) => readFileSync(resolve(__dirname, '..', chemin), 'utf8');
const ecran = lire('src/views/Tirelires.svelte');
const wizard = lire('src/views/Wizard.svelte');
const carte = lire('src/lib/CarteTirelire.svelte');
const formulaire = lire('src/lib/FormulaireTirelire.svelte');
const raccourcis = lire('src/lib/RaccourcisTirelires.svelte');
const explication = lire('src/lib/explicationTirelires.ts');

describe('[niveau 4] #369 · 1 — les mêmes cartes, écrites une fois', () => {
  it('l’écran construit la section sur le projet, et non sur le brouillon de l’assistant', () => {
    expect(ecran).toMatch(/new Section\(\{[\s\S]*?app\.ledger[\s\S]*?app\.upsert[\s\S]*?app\.remove/);
    expect(ecran).not.toMatch(/assistantUpsert|assistantRemove|assistantLedger/);
  });
  it('l’écran et l’assistant emploient la même carte, les mêmes raccourcis et le même formulaire', () => {
    expect(ecran).toMatch(/<CarteTirelire[\s\S]*?s=\{section\}/);
    expect(ecran).toMatch(/<RaccourcisTirelires s=\{section\}/);
    expect(ecran).toMatch(/<FormulaireTirelire s=\{section\}/);
    expect(lire('src/lib/SectionTirelires.svelte')).toMatch(/<CarteTirelire[\s\S]*<RaccourcisTirelires[\s\S]*<FormulaireTirelire/);
    expect(wizard).toMatch(/<SectionTirelires s=\{section\} genre="everyday"/);
  });
  it('l’écran ne réécrit aucune ligne de besoin, aucun formulaire d’ajout ni aucun raccourci', () => {
    for (const ecrit of ['aria-label="Nom de la tirelire"', 'aria-label="Nom du besoin"', 'Montant de la facture', 'Combien par période', 'Ajouter en un geste', 'class="prop"', 'Déjà de côté']) {
      expect(ecran, ecrit).not.toContain(ecrit);
    }
    for (const [ecrit, source] of [['aria-label="Nom de la tirelire"', carte], ['Prélèvement attendu', carte], ['Montant de la facture', formulaire], ['Ajouter en un geste', raccourcis]] as const) {
      expect(source, ecrit).toContain(ecrit);
    }
  });
  it('la carte lit chaque genre de besoin, versement compris, et l’écran lui donne tous les besoins de la tirelire', () => {
    for (const kind of ['recurring', 'dueDate', 'goal', 'payout']) expect(carte).toContain(`'${kind}'`);
    expect(ecran).toMatch(/besoins=\{besoinsVisibles\(e\)\}/);
  });
});

describe('[niveau 4] #369 · 2 — ce que l’écran garde en propre', () => {
  it('le rangement par compte, « Sans compte de placement », le filtre d’état, « Réviser », l’annonce du manque et les panneaux nommés', () => {
    for (const garde of ['byPlacement', 'Sans compte de placement', '<FiltreEtat', 'reviseNeed', 'Réviser', '<Manque', 'titre-panneau', 'startEditNeed', 'startEdit(', 'voulu :', 'réel :', 'priorité']) {
      expect(ecran, garde).toContain(garde);
    }
  });
});

describe('[niveau 4] #369 · 3 et 4 — raccourcis et explication', () => {
  it('l’écran offre les raccourcis des trois genres, sans rien garnir d’office', () => {
    expect(ecran).toMatch(/<RaccourcisTirelires s=\{section\} genres=\{\['everyday', 'periodic', 'savings'\]\}/);
    expect(ecran).not.toMatch(/\.garnir\(/);
  });
  it('le texte d’explication est écrit une fois : l’assistant et l’écran le lisent au même endroit, l’écran le replie sous « Comment ça marche ? »', () => {
    expect(explication).toMatch(/EXPLICATION/);
    expect(lire('src/lib/SectionTirelires.svelte')).toContain('EXPLICATION[genre]');
    expect(lire('src/lib/SectionTirelires.svelte')).not.toContain('Courses, essence');
    expect(ecran).toMatch(/<details class="explication[^>]*>\s*<summary>Comment ça marche \?<\/summary>/);
    expect(ecran).toContain('Object.values(EXPLICATION)');
  });
});
