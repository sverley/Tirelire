/**
 * Rapporteur vitest du lanceur (#232) : compte les tests que le seuil écarte, d'après la marque la
 * plus proche de chacun (`[niveau N]` du test ou de ses suites, sinon 2), et l'écrit dans
 * `TIRELIRE_ECARTES`. Il n'affiche rien : le lanceur le dit.
 */
import { writeFileSync } from 'node:fs';
import { NIVEAU_PAR_DEFAUT, niveauDuTitre } from './niveaux.mjs';

export default class Ecartes {
  onFinished(fichiers = []) {
    const seuil = Number(process.env.TIRELIRE_SEUIL ?? 4);
    let nombre = 0;
    const parcourir = (tache, herite) => {
      const niveau = niveauDuTitre(tache.name) ?? herite;
      if (tache.type === 'test' && (niveau ?? NIVEAU_PAR_DEFAUT) > seuil) nombre++;
      for (const t of tache.tasks ?? []) parcourir(t, niveau);
    };
    for (const f of fichiers) for (const t of f.tasks ?? []) parcourir(t, null);
    if (process.env.TIRELIRE_ECARTES) writeFileSync(process.env.TIRELIRE_ECARTES, `${nombre}\n`);
  }
}
