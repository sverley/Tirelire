/**
 * Harnais d'audit de #72 (chantier de #38, objectif primaire #58), écrit par la session d'audit.
 *
 * #72 demandait que I7 (« les données restent en local ») et I11 (« les assistants font partie de
 * la vie de l'application ») reçoivent chacun un harnais et son témoin rouge — jusque-là gardés
 * seulement par une vérification manuelle (`VM-I7-reseau`, `VM-I11-hors-assistant`). « Fait quand »
 * de #72 : « les deux ont leur harnais et leur témoin rouge. »
 *
 * La couverture générale (#59, #66, #69) accepte déjà qu'une entrée soit gardée par une simple
 * vérification manuelle : rien ne l'oblige à devenir un harnais automatisé. Un retrait silencieux
 * des deux harnais de #72 — retour à la seule vérification manuelle d'avant — resterait donc
 * invisible pour `pnpm amorcage`. Ce fichier verrouille spécifiquement ce que #72 a promis :
 *
 * 1. I7 cite au moins deux harnais sur `apps/web/test/navigateur/donnees-locales.test.ts` (parcours sans
 *    synchronisation ; relais chiffré après accord explicite), chacun avec un témoin rouge nommé,
 *    et ce témoin est déclaré `it.fails` dans le fichier réel — pas un test ordinaire qui passerait
 *    sans rien prouver (#66, #69).
 * 2. I11 cite au moins un harnais sur `apps/web/test/navigateur/assistant-equivalent.test.ts`, avec son témoin
 *    rouge nommé, déclaré `it.fails`.
 *
 * Chaque vérification a son témoin rouge ici même : les mêmes assertions rejouées sur un registre
 * où le harnais concerné a disparu (retombé à la vérification manuelle d'avant #72), ou sur un
 * témoin réécrit comme un test ordinaire — qui doivent échouer.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { RACINE, lireRegistre, temoinRouge } from '../packages/gardes/gardes.mjs';

const REGISTRE = 'docs/gardes.md';
const RELIRE = "le harnais d'audit de #72 est à relire";

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
 * nommé, et que ce témoin est déclaré `it.fails` dans la source réelle du fichier — pas un test
 * ordinaire qui passerait sans rien prouver.
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

// ─── I7 · apps/web/test/navigateur/donnees-locales.test.ts ──────────────────────────────────────────────────

const FICHIER_I7 = 'apps/web/test/navigateur/donnees-locales.test.ts';

test('#72 · I7 a bien ses deux harnais automatisés sur donnees-locales.test.ts, témoins rouges à l’appui', () => {
  verifierHarnaisAutomatise('I7', FICHIER_I7, 2, registre(), lire(FICHIER_I7));
});

const I7_SANS_HARNAIS = "## I7 · Les données restent en local\n\n- **Vérification manuelle** · `VM-I7-reseau` — Onglet Réseau, à la main.\n";

test('#72 · témoin rouge — un registre où I7 est retombé à la seule vérification manuelle fait échouer la vérification précédente', () => {
  assert.throws(() => verifierHarnaisAutomatise('I7', FICHIER_I7, 2, I7_SANS_HARNAIS, lire(FICHIER_I7)), /ne cite que 0 harnais/);
});

test('#72 · témoin rouge — un témoin d’I7 réécrit comme un test ordinaire fait échouer la vérification précédente', () => {
  const source = "it('témoin rouge · une requête réseau partie pendant un parcours sans synchronisation', () => {});";
  assert.throws(() => verifierHarnaisAutomatise('I7', FICHIER_I7, 2, registre(), source), /n'est pas déclaré avec `it\.fails`/);
});

// ─── I11 · apps/web/test/navigateur/assistant-equivalent.test.ts ────────────────────────────────────────────

const FICHIER_I11 = 'apps/web/test/navigateur/assistant-equivalent.test.ts';

test('#72 · I11 a bien son harnais automatisé sur assistant-equivalent.test.ts, témoin rouge à l’appui', () => {
  verifierHarnaisAutomatise('I11', FICHIER_I11, 1, registre(), lire(FICHIER_I11));
});

const I11_SANS_HARNAIS =
  "## I11 · Les assistants font partie de la vie de l'application\n\n- **Vérification manuelle** · `VM-I11-hors-assistant` — à la main.\n";

test('#72 · témoin rouge — un registre où I11 est retombé à la seule vérification manuelle fait échouer la vérification précédente', () => {
  assert.throws(() => verifierHarnaisAutomatise('I11', FICHIER_I11, 1, I11_SANS_HARNAIS, lire(FICHIER_I11)), /ne cite que 0 harnais/);
});

test('#72 · témoin rouge — le témoin d’I11 réécrit comme un test ordinaire fait échouer la vérification précédente', () => {
  const source = "it('témoin rouge · une ligne créée par l’assistant introuvable hors assistant', () => {});";
  assert.throws(() => verifierHarnaisAutomatise('I11', FICHIER_I11, 1, registre(), source), /n'est pas déclaré avec `it\.fails`/);
});
