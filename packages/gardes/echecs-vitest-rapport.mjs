/**
 * Rapporteur vitest du lanceur (#352, point 4) : chaque test en échec, avec son message et
 * l'endroit de l'échec, une ligne JSON par test (`echecs.mjs`), dans le fichier que nomme
 * `TIRELIRE_ECHECS`. Un fichier qui ne se charge pas compte pour un échec, sous son nom.
 */
import { writeFileSync } from 'node:fs';
import { endroitDans, messageDe, premiereLigne } from './echecs.mjs';

function rouges(tache, fichier, titres, sortie) {
  for (const t of tache.tasks ?? []) {
    if (t.type === 'test') {
      if (t.result?.state !== 'fail') continue;
      const e = t.result.errors?.[0] ?? {};
      sortie.push({ fichier, test: [...titres, t.name].join(' > '), message: messageDe(e), endroit: endroitDans(e.stack ?? e.stackStr, fichier) });
    } else rouges(t, fichier, [...titres, t.name], sortie);
  }
  return sortie;
}

export default class Echecs {
  onFinished(fichiers = [], erreurs = []) {
    if (!process.env.TIRELIRE_ECHECS) return;
    const sortie = [];
    for (const f of fichiers) {
      const avant = sortie.length;
      rouges(f, f.filepath, [], sortie);
      if (sortie.length === avant && f.result?.state === 'fail') {
        const e = f.result.errors?.[0] ?? {};
        sortie.push({ fichier: f.filepath, test: 'le fichier ne se charge pas', message: premiereLigne(e.message), endroit: endroitDans(e.stack ?? e.stackStr, f.filepath) });
      }
    }
    for (const e of erreurs ?? []) sortie.push({ fichier: '(hors de tout fichier)', test: 'erreur non attrapée', message: premiereLigne(e?.message), endroit: endroitDans(e?.stack) });
    writeFileSync(process.env.TIRELIRE_ECHECS, sortie.map((x) => `${JSON.stringify(x)}\n`).join(''));
  }
}
