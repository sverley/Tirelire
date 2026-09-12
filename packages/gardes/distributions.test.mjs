/**
 * Harnais de I9 — « Plusieurs distributions » (docs/gardes.md).
 *
 * Ce que le registre lui demande de garder : sur chaque PR, le web et le site d'hébergement se
 * construisent ; l'APK Android, lui, ne se construit qu'après fusion sur `main`. La ligne `Harnais`
 * de I9 citait `.github/workflows/ci.yml`, qui ne peut pas accueillir de test : ce fichier lit le
 * workflow et tient les assertions à côté (question posée dans #69, tranchée dans la PR #77).
 *
 * L'échec attendu du témoin rouge tient dans une assertion : `node:test` n'a pas de `test.fails`
 * (docs/gardes.md, #66).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { RACINE } from './gardes.mjs';

const CI = '.github/workflows/ci.yml';

const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');

/** Les jobs du workflow : nom → texte de son bloc. `jobs:` est la dernière clé de premier niveau. */
function jobs(yaml) {
  const lignes = yaml.split('\n');
  const début = lignes.findIndex((l) => /^jobs:\s*$/.test(l));
  assert.ok(début >= 0, `${CI} : aucune section \`jobs:\``);
  const blocs = new Map();
  let courant;
  for (let i = début + 1; i < lignes.length; i += 1) {
    const m = lignes[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (m) {
      courant = m[1];
      blocs.set(courant, []);
    } else if (courant && lignes[i].trim()) {
      blocs.get(courant).push(lignes[i]);
    }
  }
  return new Map([...blocs].map(([nom, l]) => [nom, l.join('\n')]));
}

/** Le job dont une étape lance cette commande. */
const jobQui = (blocs, motif) => [...blocs].find(([, bloc]) => motif.test(bloc));

/** Le job est-il écarté des PR par sa condition ? */
const écartéDesPR = (bloc) => /^\s*if:.*event_name\s*!=\s*'pull_request'/m.test(bloc);

/**
 * Ce que I9 demande au workflow. Écrit à part de sa source pour être rejoué tel quel sur un
 * workflow volontairement cassé : c'est le témoin rouge, plus bas.
 */
function distributionsSurChaquePR(yaml) {
  const entête = yaml.split('\njobs:')[0];
  assert.match(entête, /^ {2}pull_request:\s*$/m, `${CI} : le workflow ne se déclenche pas sur les PR`);

  const blocs = jobs(yaml);
  const web = jobQui(blocs, /^\s*- run: pnpm build\s*$/m);
  assert.ok(web, `${CI} : aucun job ne construit le web (\`pnpm build\`)`);
  assert.equal(écartéDesPR(web[1]), false, `${CI} : le job « ${web[0]} » ne construit pas le web sur une PR`);

  const hébergement = jobQui(blocs, /hebergement assembler/);
  assert.ok(hébergement, `${CI} : aucun job n'assemble le site d'hébergement`);
  assert.equal(écartéDesPR(hébergement[1]), false, `${CI} : le job « ${hébergement[0]} » n'assemble pas le site sur une PR`);

  const apk = jobQui(blocs, /assembleRelease/);
  assert.ok(apk, `${CI} : aucun job ne construit l'APK Android`);
  assert.equal(écartéDesPR(apk[1]), true, `${CI} : le job « ${apk[0]} » construirait l'APK sur une PR, avant toute fusion`);
}

test("I9 · sur chaque PR, le web et le site d'hébergement se construisent ; l'APK attend la fusion", () => {
  distributionsSurChaquePR(lire(CI));
});

/** Le workflow volontairement cassé : l'APK se construit sur les PR, le site d'hébergement non. */
function ciCassé(yaml) {
  const blocs = jobs(yaml);
  const apk = jobQui(blocs, /assembleRelease/);
  const hébergement = jobQui(blocs, /hebergement assembler/);
  return yaml
    .replace(`  ${apk[0]}:\n`, `  ${apk[0]}:\n    # condition retirée : l'APK se construirait sur chaque PR\n`)
    .replace(/^\s*if:.*event_name\s*!=\s*'pull_request'.*$/m, '')
    .replace(`  ${hébergement[0]}:\n`, `  ${hébergement[0]}:\n    if: github.event_name != 'pull_request'\n`);
}

test("témoin rouge · une CI qui construit l'APK sur chaque PR et le site d'hébergement seulement après fusion", () => {
  const cassé = ciCassé(lire(CI));
  assert.notEqual(cassé, lire(CI), 'le workflow n’a pas pu être cassé : le harnais de I9 est à relire');
  assert.throws(() => distributionsSurChaquePR(cassé), /n'assemble pas le site sur une PR|construirait l'APK sur une PR/);
});
