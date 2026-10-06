/**
 * Tests du codeur de #361 — la section Tirelires, écrite une fois, et la règle des sections (D93).
 *
 * Sans navigateur, sur le texte des décisions : la décision est posée. Les tests des points 1 et 2
 * sont passés dans le harnais d'audit (`section-tirelires-harnais.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (chemin: string) => readFileSync(resolve(__dirname, '..', chemin), 'utf8');
const decisions = lire('../../docs/decisions.md');

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
