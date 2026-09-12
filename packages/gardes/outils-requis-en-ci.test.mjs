/**
 * Harnais d'audit de #59, écrit par la session d'audit de la PR #63.
 *
 * Tranché par le porteur le 11 septembre, dans #63 (« ok ») : l'outil d'un test est requis en CI,
 * l'abstention reste permise en local. C'est ce qui permet à la garde de compter un harnais qui se
 * saute sous condition (`skipIf`, `runIf`, option `skip` calculée) comme un harnais qui tourne
 * (décisions 21, 23 et 24 dans #63) : la CI pose `TIRELIRE_STRICT` sur `pnpm test`, et le harnais
 * échoue alors quand son outil manque.
 *
 * La garde vérifie que chaque harnais lit `TIRELIRE_STRICT` ; rien ne vérifiait que la CI le pose.
 * Sans lui, les gardes d'interface, le relais PHP et le dépôt FTP se sautent en CI, et la couverture
 * les compte toujours : c'est la faille que la décision ferme. Retirer la variable de l'étape
 * `pnpm test`, la mettre en commentaire, ou la poser sur une autre étape doit donc faire échouer la
 * couverture en nommant `TIRELIRE_STRICT`.
 *
 * Le dépôt est copié une fois ; chaque cas y modifie `ci.yml`, lit la couverture, puis le rétablit.
 * Le témoin passe par la CLI, comme la CI ; les cas appellent `verifierCouverture`. L'étape se cherche
 * dans le `ci.yml` du jour ; si elle a changé de forme, le harnais le dit au lieu de passer.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RELIRE, copieDuDepot, couvertureCli, lignesDe, modifie, problemes } from './test/copie-du-depot.mjs';

const CI = '.github/workflows/ci.yml';
const RACINE = copieDuDepot();
const renfoncementDe = (ligne) => ligne.length - ligne.trimStart().length;

/** Étape `pnpm test`, sa ligne `env:`, la ligne qui pose `TIRELIRE_STRICT`, et l'étape `pnpm build`. */
function reperes(texte) {
  const l = lignesDe(texte);
  const etape = l.findIndex((x) => /^\s*-\s+run:\s*pnpm test\s*$/.test(x));
  const strict = l.findIndex((x, i) => i > etape && /^\s*TIRELIRE_STRICT\s*:/.test(x));
  const env = l.findLastIndex((x, i) => i > etape && i < strict && /^\s*env:\s*$/.test(x));
  const build = l.findIndex((x) => /^\s*-\s+run:\s*pnpm build\s*$/.test(x));
  const autreEtape = l.slice(etape + 1, strict).some((x) => /^\s*-\s/.test(x) && renfoncementDe(x) <= renfoncementDe(l[etape]));
  assert.ok(etape >= 0 && env > etape && strict > env && build > strict && !autreEtape,
    `l'étape « pnpm test » et le TIRELIRE_STRICT qu'elle pose sont introuvables dans ${CI} : ${RELIRE}`);
  return { l, env, strict, build };
}

/** Retire la ligne, et la ligne `env:` si elle ne porte plus rien. */
function retirer({ l, env, strict }) {
  const r = l.filter((_, i) => i !== strict);
  const suivante = r.slice(env + 1).find((x) => x.trim());
  return suivante === undefined || renfoncementDe(suivante) <= renfoncementDe(r[env]) ? r.filter((_, i) => i !== env) : r;
}

const CAS = [
  ["retiré de l'étape « pnpm test »", (t) => retirer(reperes(t)).join('\n')],
  [
    'mis en commentaire',
    (t) => {
      const { l, strict } = reperes(t);
      l[strict] = l[strict].replace(/^(\s*)/, '$1# ');
      return l.join('\n');
    },
  ],
  [
    "posé sur l'étape « pnpm build » au lieu de « pnpm test »",
    (t) => {
      const r = retirer(reperes(t));
      const build = r.findIndex((x) => /^\s*-\s+run:\s*pnpm build\s*$/.test(x));
      const cle = ' '.repeat(renfoncementDe(r[build]) + 2);
      r.splice(build + 1, 0, `${cle}env:`, `${cle}  TIRELIRE_STRICT: '1'`);
      return r.join('\n');
    },
  ],
];

test('#59 · témoin : le dépôt copié tient sa garde, CI comprise', () => {
  const r = couvertureCli(RACINE);
  assert.equal(r.code, 0, `la couverture échoue déjà sur le dépôt copié :\n${r.sortie.slice(-2000)}`);
});

for (const [cas, transformer] of CAS) {
  test(`#59 · TIRELIRE_STRICT ${cas} dans ci.yml fait échouer la couverture en le nommant`, async () => {
    await modifie(RACINE, CI, transformer, async () => {
      const liste = await problemes(RACINE);
      assert.ok(liste.length, `la couverture passe alors que TIRELIRE_STRICT est ${cas} : les harnais qui se sautent sous condition passeraient pour verts en CI.`);
      assert.ok(liste.some((p) => p.includes('TIRELIRE_STRICT')), `la couverture échoue sans nommer TIRELIRE_STRICT :\n${liste.join('\n')}`);
    });
  });
}
