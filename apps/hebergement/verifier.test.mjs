/**
 * Harnais de C3 — « Une application web se sert depuis une adresse sûre » (docs/gardes.md).
 *
 * Ce que le registre lui demande de garder : après chaque dépôt depuis `main`, le site en ligne
 * redirige HTTP vers HTTPS. Cela se vérifie sur le site réel, par `verifier.sh`, que la CI lance
 * après le dépôt ; un test ne peut pas le faire à sa place, et un fichier `.sh` ne peut pas
 * accueillir de test. Ce fichier garde donc ce dont la vérification dépend : que le script
 * interroge bien l'adresse en `http://` et relève où elle mène (question posée dans #69, tranchée
 * dans la PR #77).
 *
 * L'échec attendu du témoin rouge tient dans une assertion : `node:test` n'a pas de `test.fails`
 * (docs/gardes.md, #66).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ICI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = 'apps/hebergement/verifier.sh';

const lire = () => readFileSync(join(ICI, 'verifier.sh'), 'utf8').replace(/\r\n?/g, '\n');

/**
 * Ce que C3 demande au script de vérification en ligne. Écrit à part de sa source pour être rejoué
 * tel quel sur un script volontairement cassé : c'est le témoin rouge, plus bas.
 */
function relèveLaRedirectionHttps(script) {
  const sansCommentaires = script
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  const section = sansCommentaires.match(/\n(if \[ "\$\{base#https:\/\/\}" != "\$base" \];[\s\S]*?\nfi\n)/);
  assert.ok(section, `${SCRIPT} : rien ne distingue une adresse en https, donc rien ne teste la redirection`);

  const bloc = section[1];
  assert.match(bloc, /curl[^\n]*"http:\/\/\$\{base#https:\/\/\}/, `${SCRIPT} : la redirection n'est pas sondée depuis une adresse en http://`);
  assert.match(bloc, /redirect_url/, `${SCRIPT} : le script ne relève pas vers où la réponse redirige`);
  assert.match(bloc, /echo\s+"\s*réponse : \$redirection"/, `${SCRIPT} : ce qu'il trouve n'est pas affiché dans le bilan`);
}

test('C3 · le script de vérification sonde l’adresse en http:// et relève la redirection', () => {
  relèveLaRedirectionHttps(lire());
});

/** Le script volontairement cassé : la redirection HTTPS n'est plus sondée du tout. */
const sansRedirection = (script) => script.replace(/\nif \[ "\$\{base#https:\/\/\}" != "\$base" \];[\s\S]*?\nfi\n/, '\n');

test('témoin rouge · un script de vérification qui ne sonde plus l’adresse en http://', () => {
  const cassé = sansRedirection(lire());
  assert.notEqual(cassé, lire(), 'la section de redirection n’a pas pu être retirée : le harnais de C3 est à relire');
  assert.throws(() => relèveLaRedirectionHttps(cassé), /rien ne teste la redirection/);
});
