/**
 * `node:test` par niveaux (#232). Même interface que `node:test` ; `test`, `it` (et leurs `skip`,
 * `todo`, `only`) n'inscrivent pas un test dont le niveau dépasse `TIRELIRE_SEUIL`, et le comptent
 * dans `TIRELIRE_ECARTES`. Les suites s'inscrivent toujours, pour que leurs tests de niveau plus bas
 * se jouent ; elles transmettent leur marque aux tests qu'elles contiennent. Les crochets
 * (`before`, `after`…) d'une suite dont aucun test n'est inscrit ne s'exécutent pas : rien ne se
 * prépare pour des tests écartés. Ceux du fichier, que node peut jouer dès leur inscription,
 * s'exécutent toujours. Les sous-tests (`t.test`) font partie de leur
 * test.
 */
import reel, * as original from 'node:test';
import { appendFileSync } from 'node:fs';
import { NIVEAU_PAR_DEFAUT, niveauDuTitre } from './niveaux.mjs';

const seuil = Number(process.env.TIRELIRE_SEUIL ?? 4);
let ecartes = 0;
/** Suites en construction : niveau hérité (`null` sans marque au-dessus) et tests inscrits. */
const fichier = { niveau: null, tests: 0 };
const pile = [fichier];
const herite = () => pile.at(-1).niveau;

const nomDe = (args) => (typeof args[0] === 'string' ? args[0] : (args.find((a) => typeof a === 'function')?.name ?? ''));

function copierVariantes(cible, source, envelopper) {
  for (const cle of ['skip', 'todo', 'only']) if (typeof source[cle] === 'function') cible[cle] = envelopper(source[cle], false);
  return cible;
}

function enveloppeTest(fonction, variantes = true) {
  const enveloppe = function (...args) {
    const niveau = niveauDuTitre(nomDe(args)) ?? herite() ?? NIVEAU_PAR_DEFAUT;
    if (niveau > seuil) {
      ecartes++;
      return Promise.resolve();
    }
    for (const s of pile) s.tests++;
    return fonction.apply(this, args);
  };
  return variantes ? copierVariantes(enveloppe, fonction, enveloppeTest) : enveloppe;
}

function enveloppeSuite(fonction, variantes = true) {
  const enveloppe = function (...args) {
    const suite = { niveau: niveauDuTitre(nomDe(args)) ?? herite(), tests: 0 };
    const i = args.findIndex((a) => typeof a === 'function');
    if (i >= 0) {
      const corps = args[i];
      if (typeof args[0] !== 'string') args.unshift(corps.name);
      const j = args.indexOf(corps);
      args[j] = function (...b) {
        pile.push(suite);
        try {
          return corps.apply(this, b);
        } finally {
          pile.pop();
        }
      };
    }
    return fonction.apply(this, args);
  };
  return variantes ? copierVariantes(enveloppe, fonction, enveloppeSuite) : enveloppe;
}

/** Un crochet de suite ne s'exécute que si la suite a au moins un test inscrit. */
function enveloppeCrochet(fonction) {
  return function (...args) {
    const suite = pile.at(-1);
    if (suite === fichier) return fonction.apply(this, args);
    const i = args.findIndex((a) => typeof a === 'function');
    if (i >= 0) {
      const corps = args[i];
      args[i] = function (...b) {
        return suite.tests ? corps.apply(this, b) : undefined;
      };
    }
    return fonction.apply(this, args);
  };
}

const defaut = enveloppeTest(reel);
for (const [cle, valeur] of Object.entries(reel)) {
  if (cle === 'test' || cle === 'it') defaut[cle] = cle === 'test' ? defaut : enveloppeTest(valeur);
  else if (cle === 'describe' || cle === 'suite') defaut[cle] = enveloppeSuite(valeur);
  else if (cle === 'skip' || cle === 'todo' || cle === 'only') defaut[cle] = enveloppeTest(valeur, false);
  else if (['before', 'after', 'beforeEach', 'afterEach'].includes(cle)) defaut[cle] = enveloppeCrochet(valeur);
  else defaut[cle] = valeur;
}

process.on('exit', () => {
  if (!ecartes || !process.env.TIRELIRE_ECARTES) return;
  try {
    appendFileSync(process.env.TIRELIRE_ECARTES, `${ecartes}\n`);
  } catch {
    // le compte n'est qu'affiché
  }
});

export default defaut;
export const { test, it, describe, suite, skip, todo, only, after, afterEach, before, beforeEach } = defaut;
export const { mock, run, snapshot, assert } = original;
