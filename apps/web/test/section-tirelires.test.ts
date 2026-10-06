/**
 * Tests du codeur de #361 — la section Tirelires, écrite une fois, et la règle des sections (D93).
 *
 * Sans navigateur, sur le texte des sources et des décisions : ce que l'assistant montre et fait,
 * inchangé, est tranché par les tests navigateur que le point 3 nomme. Ceux-ci vérifient la
 * construction : l'assistant n'écrit plus rien des tirelires à part, la section ne sait pas où elle
 * écrit, et la décision est posée.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (chemin: string) => readFileSync(resolve(__dirname, '..', chemin), 'utf8');
const wizard = lire('src/views/Wizard.svelte');
const composant = lire('src/lib/SectionTirelires.svelte');
const section = lire('src/lib/sectionTirelires.svelte.ts');
const decisions = lire('../../docs/decisions.md');

describe('[niveau 4] #361 · 1 — une section Tirelires, que les trois étapes de l’assistant emploient', () => {
  it('les trois étapes Budgets, « Pas tous les mois » et Épargne emploient la section, chacune pour son genre', () => {
    for (const genre of ['everyday', 'periodic', 'savings']) {
      expect(wizard).toMatch(new RegExp(`<SectionTirelires s=\\{section\\} genre="${genre}" cartes=\\{section\\.parTirelire\\('${genre}'\\)\\} />`));
    }
  });
  it('l’assistant n’écrit plus rien des tirelires à part : ni tirelire, ni besoin, ni carte, ni formulaire d’ajout', () => {
    // Le résumé, hors de la section, touche seulement le placement d'une tirelire (« où dort chaque tirelire »).
    for (const m of wizard.matchAll(/assistantUpsert\('tirelires', \{ \.\.\.\w+, (\w+)/g)) expect(m[1]).toBe('placement');
    expect([...wizard.matchAll(/assistantUpsert\('tirelires'/g)].length).toBe(2);
    expect(wizard).not.toMatch(/assistantUpsert\('needs'/);
    expect(wizard).not.toMatch(/class="card tirelire"/);
    expect(wizard).not.toMatch(/Ajouter un besoin|Garder ce qui n'a pas été dépensé|Montant de la facture|Cible \(facultatif\)/);
  });
});

describe('[niveau 4] #361 · 2 — la section ne sait pas où elle écrit : l’endroit qui l’emploie le lui donne', () => {
  it('ni le composant ni sa logique ne lisent l’application ni le brouillon', () => {
    for (const texte of [composant, section]) {
      expect(texte).not.toMatch(/from '\.\/state\.svelte'/);
      expect(texte).not.toMatch(/assistantUpsert|assistantRemove|assistantLedger/);
    }
  });
  it('l’assistant la construit sur son brouillon, et la garnit d’office lui-même (D46)', () => {
    expect(wizard).toMatch(/new Section\(\{[\s\S]*?app\.assistantLedger[\s\S]*?app\.assistantUpsert[\s\S]*?app\.assistantRemove/);
    expect(wizard).toMatch(/section\.garnir\(etape\)/);
    expect(section).not.toMatch(/projetVierge/);
  });
  it('le texte d’explication s’affiche, ou se replie quand l’endroit le demande', () => {
    expect(composant).toMatch(/explicationRepliee = false/);
    expect(composant).toMatch(/<details class="explication/);
  });
});

describe('[niveau 4] #361 · 4 — la décision : une section par partie du budget, et D40 la cite', () => {
  const d93 = decisions.slice(decisions.indexOf('### D93'));
  it('D93 pose la règle pour toutes les parties, ses différences, et ce qui n’y passe pas', () => {
    expect(decisions).toMatch(/### D93 · Une section par partie du budget, écrite une fois/);
    for (const mot of ['comptes', 'revenus et charges fixes', 'tirelires', 'catégories', 'ordres permanents']) expect(d93).toContain(mot);
    for (const mot of ['où elle écrit', 'garnissage d\'office', 'champs montrés', 'texte d\'explication', 'rangement des cartes']) expect(d93).toContain(mot);
    expect(d93).toMatch(/lissage proposé[\s\S]*évolution d'un ordre[\s\S]*adaptation du train de vie[\s\S]*ne passe\s+pas par une section/);
  });
  it('D40 cite D93', () => {
    const d40 = decisions.slice(decisions.indexOf('### D40'), decisions.indexOf('### D41'));
    expect(d40).toMatch(/L'assistant ne remplace pas les écrans de configuration[\s\S]*D93/);
  });
});
