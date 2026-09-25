/**
 * Harnais du besoin #145 — le résumé du dépôt FTP ne renvoie plus à la release `latest`.
 *
 * Quand les secrets FTP manquent, le job « Dépôt FTP sur l'hébergement » de
 * `.github/workflows/ci.yml` écrit un résumé qui envoyait le lecteur télécharger le site dans la
 * release `latest`. Cette release ne se déplace plus : depuis #45, l'archive du site ne sort qu'à
 * un tag `v*` (I9). Le résumé doit donc nommer un endroit où l'archive se trouve réellement :
 * l'artefact du passage, ou la release du dernier tag.
 *
 * Un fichier de workflow ne peut pas accueillir de test : ce harnais le lit et tient ses
 * assertions à côté, comme `distributions.test.mjs` (tranché dans #69).
 *
 * L'échec attendu du témoin rouge tient dans une assertion : `node:test` n'a pas de `test.fails`
 * (docs/gardes.md, #66).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { describe } from 'node:test';
import { RACINE } from './gardes.mjs';

const CI = '.github/workflows/ci.yml';

const lire = () => readFileSync(join(RACINE, CI), 'utf8').replace(/\r\n?/g, '\n');

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

/** Les étapes d'un job : le texte de chacune, depuis son tiret jusqu'au tiret suivant. */
function étapes(bloc) {
  const étapes = [];
  let courante = null;
  for (const ligne of bloc.split('\n')) {
    if (/^ {6}- /.test(ligne)) {
      if (courante) étapes.push(courante.join('\n'));
      courante = [ligne];
    } else if (courante) {
      courante.push(ligne);
    }
  }
  if (courante) étapes.push(courante.join('\n'));
  return étapes;
}

/** Les noms d'artefacts que le workflow manipule réellement (`name:` suivi de `path:`). */
const artefacts = (yaml) => [...yaml.matchAll(/name:\s*([^\s#]+)[^\n]*\n\s*path:/g)].map((m) => m[1]);

/** Le job qui dépose le site par FTP : celui dont une étape lance `deposer.sh`. */
function jobDuDépôt(yaml) {
  const trouvé = [...jobs(yaml)].find(([, bloc]) => /deposer\.sh/.test(bloc));
  assert.ok(trouvé, `${CI} : aucun job ne dépose le site par FTP (\`deposer.sh\`)`);
  return trouvé[1];
}

/**
 * L'étape qui constate l'absence des secrets FTP et l'écrit au résumé de la CI : la seule à la
 * fois à poser une sortie (`GITHUB_OUTPUT`) et à écrire au résumé (`GITHUB_STEP_SUMMARY`).
 */
function étapeDépôtIgnoré(yaml) {
  const trouvée = étapes(jobDuDépôt(yaml)).find(
    (é) => /GITHUB_OUTPUT/.test(é) && /GITHUB_STEP_SUMMARY/.test(é),
  );
  assert.ok(
    trouvée,
    `${CI} : le job de dépôt n'écrit plus au résumé de la CI quand les secrets FTP manquent`,
  );
  return trouvée;
}

/**
 * Ce que #145 demande au workflow. Écrit à part de sa source pour être rejoué tel quel sur un
 * workflow volontairement cassé : c'est le témoin rouge, plus bas.
 */
function résuméDitOùEstLArchive(yaml) {
  // 1 · la release `latest` n'est plus nommée nulle part (`ubuntu-latest` n'est pas une release).
  const sansCoureurs = yaml.replace(/ubuntu-latest/g, 'ubuntu');
  const fautive = sansCoureurs.split('\n').findIndex((l) => /latest/i.test(l));
  assert.equal(
    fautive,
    -1,
    `${CI} ligne ${fautive + 1} : la release \`latest\` est encore nommée — ` +
      `elle ne se déplace plus, l'archive ne sort qu'à un tag \`v*\` (#45).`,
  );

  // 2 · le résumé écrit quand le dépôt est ignoré dit où l'archive se trouve réellement.
  const étape = étapeDépôtIgnoré(yaml);
  const connus = artefacts(yaml);
  const citeUnArtefact = /artefact|artifact/i.test(étape) && connus.some((nom) => étape.includes(nom));
  const citeLaReleaseDUnTag = /release/i.test(étape) && /tag|`v\*`|version/i.test(étape);
  assert.ok(
    citeUnArtefact || citeLaReleaseDUnTag,
    `${CI} : quand le dépôt FTP est ignoré, le résumé ne dit pas où retrouver l'archive du site — ` +
      `nommer l'artefact du passage (l'un de ${connus.join(', ') || '(aucun)'}) ou la release du dernier tag \`v*\`.`,
  );
}

/** Rien d'autre du workflow ne change : le dépôt garde ses étapes et le site son artefact. */
function leResteDuDépôtEstIntact(yaml) {
  const dépôt = jobDuDépôt(yaml);
  assert.match(dépôt, /deposer\.sh/, `${CI} : le job de dépôt ne transfère plus le site`);
  assert.match(dépôt, /verifier\.sh/, `${CI} : le job de dépôt ne vérifie plus le site en ligne`);
  assert.ok(
    artefacts(yaml).includes('tirelire-hebergement'),
    `${CI} : l'artefact \`tirelire-hebergement\` n'est plus déposé : le résumé n'aurait plus où renvoyer`,
  );
}

describe('[niveau 1] harnais de la garde', () => {
  test("#145 · le résumé du dépôt FTP ignoré dit où l'archive du site se trouve vraiment", () => {
    résuméDitOùEstLArchive(lire());
  });

  test('#145 · le job de dépôt garde par ailleurs ses étapes et son artefact', () => {
    leResteDuDépôtEstIntact(lire());
  });

  /** Le workflow volontairement cassé : le résumé renvoie de nouveau vers la release `latest`. */
  function ciCassé(yaml) {
    return yaml.replace(
      /^(\s*)\} >> "\$GITHUB_STEP_SUMMARY"$/m,
      (fin, indentation) =>
        `${indentation}  echo "Le site reste téléchargeable dans la release \\\`latest\\\`."\n${fin}`,
    );
  }

  test('témoin rouge · un résumé qui renvoie vers la release `latest`', () => {
    const cassé = ciCassé(lire());
    assert.notEqual(cassé, lire(), 'le workflow n’a pas pu être cassé : le harnais de #145 est à relire');
    assert.throws(() => résuméDitOùEstLArchive(cassé), /la release `latest` est encore nommée/);
  });
});
