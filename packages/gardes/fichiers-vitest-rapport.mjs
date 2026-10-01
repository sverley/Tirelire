/**
 * Rapporteur vitest du lanceur (#302) : ce que chaque fichier de test a donné, dans la forme du
 * rapport JSON de vitest (`testResults`, et pour chaque fichier ses `assertionResults`), pour que le
 * lanceur atteste ceux dont tous les tests ont tourné et fini verts. Il écrit dans le fichier que
 * nomme `TIRELIRE_FICHIERS`, et n'affiche rien : le lanceur le dit. Le statut d'un test se lit comme
 * dans le rapport JSON de vitest.
 */
import { writeFileSync } from 'node:fs';

const STATUTS = { fail: 'failed', only: 'pending', pass: 'passed', run: 'pending', skip: 'skipped', todo: 'todo', queued: 'pending' };

function tests(tache, titres, sortie) {
  for (const t of tache.tasks ?? []) {
    if (t.type === 'test') sortie.push({ ancestorTitles: titres, title: t.name, status: STATUTS[t.result?.state || t.mode] || 'skipped' });
    else tests(t, [...titres, t.name], sortie);
  }
  return sortie;
}

export default class Fichiers {
  onFinished(fichiers = []) {
    if (!process.env.TIRELIRE_FICHIERS) return;
    const testResults = fichiers.map((f) => {
      const assertionResults = tests(f, [], []);
      const rouge = f.result?.state === 'fail' || assertionResults.some((a) => a.status === 'failed');
      return { name: f.filepath, status: rouge ? 'failed' : 'passed', assertionResults };
    });
    writeFileSync(process.env.TIRELIRE_FICHIERS, `${JSON.stringify({ testResults })}\n`);
  }
}
