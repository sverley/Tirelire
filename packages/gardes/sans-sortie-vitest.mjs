/**
 * Branchement de la garde de #113 sur vitest, en `setupFiles`.
 *
 * Vitest ne donne pas le code de sortie d'un fichier de tests : la tentative retenue par
 * `sans-sortie.mjs` fait donc échouer le fichier qui l'a faite, à la fin de ses tests, en nommant
 * l'hôte — même si l'erreur a été interceptée.
 */
import { afterAll } from 'vitest';
import { message, tentatives, vider } from './sans-sortie.mjs';

vider();

afterAll(() => {
  const faites = tentatives();
  vider();
  if (faites.length) throw new Error(message(faites));
});
