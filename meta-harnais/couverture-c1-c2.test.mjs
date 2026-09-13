/**
 * Harnais d'audit de #73 (chantier de #38, objectif primaire #58), écrit par la session d'audit.
 *
 * #73 demandait un harnais, ou une vérification manuelle assumée par écrit disant pourquoi elle
 * ne l'est pas, pour C1, C2, C4 et C7. C1 (« aucun geste technique ») et C2 (« parcours essentiels
 * sans caméra ni QR ») reçoivent chacun un harnais programmé et son témoin rouge — jusque-là gardés
 * seulement par une vérification manuelle, C2 portant en plus une ligne « À bâtir ». C4 et C7
 * restent à la seule vérification manuelle, avec une analyse écrite qui dit pourquoi (le code de
 * #42 n'existe pas encore pour C4 ; un fait de plateforme qu'aucun test en CI n'observe pour C7) :
 * ce que #73 promet pour eux est cette analyse, pas un harnais.
 *
 * La couverture générale (#59, #66, #69) accepte qu'une entrée soit gardée par une simple
 * vérification manuelle : rien ne l'oblige à devenir un harnais automatisé, et une analyse écrite
 * n'a pas de forme que la couverture générale puisse reconnaître comme telle. Un retrait silencieux
 * des harnais de C1 et C2, ou de l'analyse de C4 et C7 — retour à une vérification manuelle nue,
 * comme avant #73 — resterait donc invisible pour `pnpm meta`. Ce fichier verrouille spécifiquement
 * ce que #73 a promis :
 *
 * 1. C1 cite au moins un harnais sur `apps/web/test/c1-sans-geste-technique.test.ts`, avec son
 *    témoin rouge nommé, déclaré `it.fails` dans le fichier réel — pas un test ordinaire qui
 *    passerait sans rien prouver (#66, #69).
 * 2. C2 cite au moins un harnais sur `apps/web/test/c2-parcours-sans-camera.test.ts`, de la même
 *    façon, et ne porte plus de ligne « À bâtir » sur les parcours essentiels sans caméra.
 * 3. C4 et C7 portent chacun, sous leur titre, un paragraphe d'analyse écrite (et non la seule
 *    ligne « Vérification manuelle », qui ne dit pas pourquoi elle suffit).
 *
 * Chaque vérification a son témoin rouge ici même : les mêmes assertions rejouées sur un registre
 * où la promesse de #73 a régressé, qui doit échouer.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { RACINE, lireRegistre, temoinRouge } from '../packages/gardes/gardes.mjs';

const REGISTRE = 'docs/gardes.md';
const RELIRE = "le harnais d'audit de #73 est à relire";

const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8');
const registre = () => lire(REGISTRE);

/** Les lignes « Harnais » d'une entrée du registre qui citent `fichier`, chacune avec son témoin rouge. */
function harnaisSur(id, fichier, texteDuRegistre) {
  const entree = lireRegistre(texteDuRegistre).entrees.get(id);
  if (!entree) assert.fail(`${id} n'a pas d'entrée dans ${REGISTRE} : ${RELIRE}`);
  return entree.harnais
    .filter((h) => h.chemins.includes(fichier))
    .map((h) => ({ description: h.description, rouge: temoinRouge(h.description) }));
}

/** Le titre tel qu'il est écrit dans la source : espaces libres, caractères spéciaux échappés. */
const motifDuTitre = (nom) =>
  nom.split(/\s+/).map((mot) => mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');

/** Modificateurs (`.fails`, `.skip`…) de l'appel `it`/`test` qui déclare ce titre ; `null` s'il n'y est pas. */
function modificateursDeclaration(source, nom) {
  const texte = String(source).replace(/\\(['"`])/g, '$1');
  const m = texte.match(new RegExp(`(?<![\\w$.])(?:it|test)((?:\\s*\\.\\s*\\w+)*)\\s*\\(\\s*(['"\`])${motifDuTitre(nom)}\\2`));
  return m ? m[1] : null;
}

/**
 * Vérifie qu'une entrée cite au moins `minimum` harnais sur `fichier`, chacun avec un témoin rouge
 * nommé, et que ce témoin est déclaré `it.fails` dans la source réelle du fichier.
 */
function verifierHarnaisAutomatise(id, fichier, minimum, texteDuRegistre, sourceDuFichier) {
  const lignes = harnaisSur(id, fichier, texteDuRegistre);
  assert.ok(lignes.length >= minimum, `${id} ne cite que ${lignes.length} harnais sur \`${fichier}\` (minimum ${minimum}) : ${RELIRE}`);
  for (const ligne of lignes) {
    assert.ok(ligne.rouge?.nom, `${id} : un harnais sur \`${fichier}\` ne cite pas de témoin rouge nommé : ${RELIRE}`);
    const mods = modificateursDeclaration(sourceDuFichier, ligne.rouge.nom);
    assert.ok(mods !== null, `${id} : le témoin « ${ligne.rouge.nom} » ne se trouve pas dans \`${fichier}\` : ${RELIRE}`);
    assert.match(mods, /\bfails\b/, `${id} : le témoin « ${ligne.rouge.nom} » n'est pas déclaré avec \`it.fails\` dans \`${fichier}\` (#66, #69)`);
  }
}

/** Le texte d'une entrée du registre, titre exclu, jusqu'au prochain titre `## ` ou la fin. */
function corpsDeLEntree(id, texteDuRegistre) {
  const debutTitre = texteDuRegistre.match(new RegExp(`^##\\s+${id}\\s+·.*$`, 'm'));
  if (!debutTitre) return '';
  const debut = debutTitre.index + debutTitre[0].length;
  const suite = texteDuRegistre.slice(debut).search(/\n##\s+[IUC]\d+\s+·/);
  return suite === -1 ? texteDuRegistre.slice(debut) : texteDuRegistre.slice(debut, debut + suite);
}

/** L'entrée porte, avant sa première ligne d'étiquette (`- **…**`), un paragraphe d'analyse non vide. */
function verifierAnalyseEcrite(id, texteDuRegistre) {
  const corps = corpsDeLEntree(id, texteDuRegistre);
  const avantEtiquettes = corps.split(/\n\s*[-*]\s+\*\*/)[0];
  const analyse = avantEtiquettes.replace(/^Chemins\s*:.*$/m, '').trim();
  assert.ok(analyse.length >= 80, `${id} n'a pas d'analyse écrite (paragraphe hors « Chemins » et hors liste d'étiquettes) : ${RELIRE}`);
}

// ─── C1 · apps/web/test/c1-sans-geste-technique.test.ts ──────────────────────────────────────────

const FICHIER_C1 = 'apps/web/test/c1-sans-geste-technique.test.ts';

test('#73 · C1 a bien son harnais automatisé sur c1-sans-geste-technique.test.ts, témoin rouge à l’appui', () => {
  verifierHarnaisAutomatise('C1', FICHIER_C1, 1, registre(), lire(FICHIER_C1));
});

const C1_SANS_HARNAIS = "## C1 · Aucun geste technique pour l'utilisateur\n\n- **Vérification manuelle** · `VM-C1-sans-geste` — à la main.\n";

test('#73 · témoin rouge — un registre où C1 est retombé à la seule vérification manuelle fait échouer la vérification précédente', () => {
  assert.throws(() => verifierHarnaisAutomatise('C1', FICHIER_C1, 1, C1_SANS_HARNAIS, lire(FICHIER_C1)), /ne cite que 0 harnais/);
});

test('#73 · témoin rouge — le témoin de C1 réécrit comme un test ordinaire fait échouer la vérification précédente', () => {
  const source = "it('témoin rouge · un texte d’interface qui invite à ouvrir un terminal', () => {});";
  assert.throws(() => verifierHarnaisAutomatise('C1', FICHIER_C1, 1, registre(), source), /n'est pas déclaré avec `it\.fails`/);
});

// ─── C2 · apps/web/test/c2-parcours-sans-camera.test.ts ──────────────────────────────────────────

const FICHIER_C2 = 'apps/web/test/c2-parcours-sans-camera.test.ts';

test('#73 · C2 a bien son harnais automatisé sur c2-parcours-sans-camera.test.ts, témoin rouge à l’appui', () => {
  verifierHarnaisAutomatise('C2', FICHIER_C2, 1, registre(), lire(FICHIER_C2));
});

test('#73 · C2 ne porte plus de ligne « À bâtir » sur les parcours essentiels sans caméra', () => {
  const entree = lireRegistre(registre()).entrees.get('C2');
  assert.ok(!entree.aBatir.some((a) => /caméra|QR/i.test(a)), `C2 porte encore une dette sur la caméra/le QR code : ${RELIRE}`);
});

const C2_SANS_HARNAIS =
  "## C2 · L'essentiel ne dépend d'aucune capacité propre à une plateforme\n\n- **Vérification manuelle** · `VM-C2-equivalent` — à la main.\n";

test('#73 · témoin rouge — un registre où C2 est retombé à la seule vérification manuelle fait échouer la vérification précédente', () => {
  assert.throws(() => verifierHarnaisAutomatise('C2', FICHIER_C2, 1, C2_SANS_HARNAIS, lire(FICHIER_C2)), /ne cite que 0 harnais/);
});

test('#73 · témoin rouge — le témoin de C2 réécrit comme un test ordinaire fait échouer la vérification précédente', () => {
  const source = "it('témoin rouge · un écran essentiel qui dépend de BarcodeDetector', () => {});";
  assert.throws(() => verifierHarnaisAutomatise('C2', FICHIER_C2, 1, registre(), source), /n'est pas déclaré avec `it\.fails`/);
});

// ─── C4 et C7 · analyse écrite ────────────────────────────────────────────────────────────────

test('#73 · C4 et C7 portent chacun un paragraphe d’analyse écrite, pas la seule vérification manuelle nue', () => {
  verifierAnalyseEcrite('C4', registre());
  verifierAnalyseEcrite('C7', registre());
});

test('#73 · témoin rouge — une entrée sans analyse, réduite à sa vérification manuelle, fait échouer la vérification précédente', () => {
  const sansAnalyse = "## C4 · Les données d'un navigateur tiennent à son adresse, et peuvent s'effacer\n\nChemins : `apps/web/src/lib/db.ts`\n\n- **Vérification manuelle** · `VM-C4-effacement` — à la main.\n";
  assert.throws(() => verifierAnalyseEcrite('C4', sansAnalyse), /n'a pas d'analyse écrite/);
});
