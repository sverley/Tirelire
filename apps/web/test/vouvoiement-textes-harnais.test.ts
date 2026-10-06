/**
 * Harnais d'audit de #225 — « L'interface vouvoie partout, ses textes s'écrivent juste », sans navigateur.
 *
 * Phrase 1 (« L'application ne tutoie jamais ») : aucun fichier source de l'application — écrans, lib, cœur (dont
 * les messages d'erreur) — ne contient de forme du tutoiement : pronoms et possessifs de la deuxième personne
 * du singulier, impératifs courants. Le contrôle est plus large que la liste fermée du codeur (`vouvoiement-textes.test.ts`,
 * d'où le test 1 est remplacé) : il voit aussi les impératifs de Saisie, de l'assistant, de Tirelires et du cœur,
 * que le relevé de l'architecte ne nommait pas. Phrase 2 : `shortDate` donne le mois abrégé français pour les
 * douze mois, et le flux annuel s'écrit « chaque année le 2 oct. ». Phrase 3 : les titres de groupes sont au
 * pluriel juste et l'écran Flux prévus les lit dans cette table, le choix du type gardant le singulier.
 *
 * Retenus parmi les tests du codeur (déplacés ici) : les tests 2 et 3, sans changer ce qu'ils affirment ; le 3 est
 * complété du contrôle de l'écran. Niveau 2 (D83) pour tous : D85 est une décision, un texte qui tutoie ou un mois
 * mal écrit en est un cas faux, l'usage restant possible.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shortDate, periodicityLabel, FLOW_GROUP_TITLES, FLOW_KINDS } from '../src/lib/format';

const racine = process.cwd();
const dossiers = [resolve(racine, 'src'), resolve(racine, 'src/views'), resolve(racine, 'src/lib'), resolve(racine, '../../packages/core/src')];
const fichiers = dossiers.flatMap((d) =>
  readdirSync(d).filter((f) => /\.(svelte|ts)$/.test(f)).map((f) => resolve(d, f)),
);

describe('[niveau 2] #225 · 1 — l\'application ne tutoie jamais', () => {
  it('aucune forme du tutoiement dans les sources de l\'interface et du cœur', () => {
    // Pronoms et possessifs de la deuxième personne ; impératifs, qui ne se distinguent de la troisième personne
    // que par leur place : en tête de phrase ou de texte (après une apostrophe de chaîne, « > », un point, « : » ou « ; »).
    const pronoms = /\b(tu|toi|ton|tes|tien|tiens|tienne)\b|\b[Tt][’'](?=[a-zéèêàâîôûh])|\b(ta|te)\s+(banque|tirelire|budget|compte|ordre|salon|phrase|appareil|machine|propre)\b|-(toi|tu)\b/gi;
    const verbes = 'saisis|choisis|importe|ajoute|crée|donne|indique|commence|élargis|passe|scanne|sélectionne|détache|supprime|renseigne|laisse|fais|vérifie|clique|appuie|utilise|regarde|essaie|réessaie|ouvre|reviens|prends|colle|déplace|confirme|nomme|télécharge|envoie|connecte|relie|désactive|attends|patiente|exporte|enregistre|remplis|complète|précise|oublie|coche|décoche|retire|efface|annule|définis|entre';;
    const impératifs = new RegExp(`(?:^|['"\`>}]|[.!?:;]\\s+|\\s\\(|\\s—\\s)(?:${verbes})(?:-(?:le|la|les|en|y|moi|nous))?(?=[\\s.,;:!?)»'’"\`<]|$)`, 'gim');
    const trouves = fichiers.flatMap((f) => {
      const texte = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '') // commentaires de bloc
        .replace(/<!--[\s\S]*?-->/g, '') // commentaires de gabarit
        .replace(/^\s*\/\/.*$/gm, ''); // commentaires de ligne
      return [...texte.matchAll(pronoms), ...texte.matchAll(impératifs)].map((m) => `${f.split('/').slice(-2).join('/')} : ${m[0].trim()}`);
    });
    expect(trouves).toEqual([]);
  });
});

describe('[niveau 2] #225 · 2 — mois abrégés', () => {
  it('chaque mois s\'écrit comme en français', () => {
    const attendus = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    attendus.forEach((m, i) => {
      const iso = `2026-${String(i + 1).padStart(2, '0')}-02`;
      expect(shortDate(iso)).toBe(`2 ${m} 2026`);
    });
    expect(shortDate('2027-04-15')).toBe('15 avr. 2027');
    expect(shortDate('2026-05-01')).toBe('1 mai 2026');
  });
  it('flux annuel', () => {
    expect(periodicityLabel({ interval: 1, unit: 'year', anchorDate: '2026-10-02' } as never)).toBe('chaque année le 2 oct.');
  });
});

describe('[niveau 2] #225 · 3 — titres des groupes de Flux prévus', () => {
  it('pluriel juste, singulier dans le choix du type', () => {
    expect(FLOW_GROUP_TITLES).toEqual({
      income: 'Revenus',
      fixedCharge: 'Charges fixes',
      dueDate: 'Échéances payées par une tirelire',
      transfer: 'Virements internes attendus',
    });
    expect(FLOW_KINDS).toMatchObject({
      income: 'Revenu',
      fixedCharge: 'Charge fixe',
      dueDate: 'Échéance payée par une tirelire',
      transfer: 'Virement interne attendu',
    });
  });
  it('l\'écran écrit le titre du groupe depuis cette table, sans ajouter de « s »', () => {
    const ecran = readFileSync(resolve(racine, 'src/views/Flows.svelte'), 'utf8');
    expect(ecran).toContain('<h2>{FLOW_GROUP_TITLES[g.kind]}</h2>');
    expect(ecran).not.toMatch(/FLOW_KINDS\[[^\]]+\]\}s\b/);
  });
});
