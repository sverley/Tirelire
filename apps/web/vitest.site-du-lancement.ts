/**
 * Mise en place de chaque lancement des tests de l'interface (#302, point 8) : un dossier jetable,
 * propre au lancement, où le premier fichier de test qui ouvre le site le construit, une seule fois ;
 * les autres le servent tel quel (`ouvrirLeSite`, `harnais.ts`). Rien ne se construit tant qu'aucun
 * fichier n'ouvre le site : un lancement sans tests navigateur ne paie rien. Le dossier disparaît à la
 * fin du lancement.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Le dossier du site construit une fois pour tout le lancement. */
    siteDuLancement: string;
  }
}

export default function miseEnPlace(projet: TestProject): () => void {
  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-lancement-'));
  projet.provide('siteDuLancement', dossier);
  return () => rmSync(dossier, { recursive: true, force: true });
}
