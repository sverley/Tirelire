/**
 * Harnais d'audit de #73 (chantier de #38, objectif primaire #58), écrit par la session d'audit.
 *
 * **Où il vit, et pourquoi ici**. Le besoin de #73 est un besoin de **produit** — quatre
 * contraintes du produit reçoivent leur garde — et non une règle du projet : #73 ne crée ni ne
 * change aucune règle, il applique celle que #58 a déjà posée. C'est donc un harnais du besoin, qui
 * tient un comportement devant continuer de tenir, et qui tourne dans `pnpm test`. Il rejoint ses
 * deux frères de #38, écrits par les sessions d'audit de #70 et #71 (`usages-de-bout-en-bout`,
 * `simplicite-acces-gestes`). Qu'il lise le registre n'en fait pas un test de la garde : un harnais
 * se range selon le besoin qu'il vérifie, jamais selon ce que le fichier regarde.
 *
 * #73 demandait, pour C1, C2, C4 et C7, un harnais — ou une vérification manuelle assumée par écrit
 * qui dise pourquoi il n'y en a pas. C1 et C2 ont reçu le leur ; C4 et C7 gardent leur vérification
 * manuelle, avec une analyse écrite sous leur titre.
 *
 * Ce que la couverture générale (#59, #66, #69) ne voit pas, et que ce fichier tient :
 *
 * - elle accepte qu'une entrée retombe à une simple vérification manuelle ;
 * - elle n'exige un test précis que si la ligne `Harnais` le **nomme** entre guillemets ; une ligne
 *   qui décrit sa garde en prose libre ne fait vérifier que l'existence du fichier, de sorte que
 *   désactiver ou supprimer les tests laisse tout vert ;
 * - elle ne sait pas reconnaître une analyse écrite, ni la distinguer d'un paragraphe de
 *   remplissage.
 *
 * Première version de ce fichier (14 septembre) : elle comptait les lignes `Harnais` citant un
 * fichier et vérifiait que chacune citait un témoin rouge en `it.fails`. Trois mutations passaient
 * au vert — désactiver les deux tests du classement des documents, vider une description de son
 * sens, réduire une analyse à du remplissage — parce qu'elle vérifiait la **forme** du registre et
 * non le **fond de la promesse**. Refaite autour de trois règles :
 *
 * 1. **Chaque garantie promise est nommée** : les lignes `Harnais` de C1 et C2 nomment leur test
 *    entre guillemets, et chaque nom attendu ci-dessous y figure. La couverture générale exige
 *    alors que ce test précis existe et tourne ; le désactiver rougit `pnpm test`.
 *
 *    Ce que `PROMESSES` retient de C1 est le seul balayage du code de l'interface. Tranché par le
 *    porteur le 14 septembre : la garde vérifie que les règles de codage ne sont pas enfreintes, et
 *    un document destiné à l'utilisateur n'entre pas dans son périmètre — il reste à la revue
 *    `VM-C1-sans-geste`, qui le nomme déjà (« les textes que la PR ajoute à l'interface **et à la
 *    documentation destinée à l'utilisateur** »). Le classement des documents du dépôt n'est donc
 *    pas exigé ici : s'il est retiré du harnais, la règle 2 ci-dessous suffit à ce que le registre
 *    suive.
 * 2. **Aucune garantie muette** : tout test actif de ces fichiers, hors témoins rouges et titres de
 *    suite, est nommé par une ligne du registre. Une garantie ajoutée au code sans être écrite au
 *    registre rougit ici — c'est ce qui manquait quand le classement des documents est arrivé.
 * 3. **Les analyses de C4 et C7 renvoient à ce qui les lèvera** : celle de C4 cite #42, qui bâtira
 *    la demande de persistance ; celle de C7 cite le catalogue des cibles (`cibles.md`), où une cible native deviendra active. Un paragraphe de
 *    remplissage ne les cite pas.
 *
 * Chaque règle a ici son **témoin vert** — le registre réel, qui doit passer — et son **témoin
 * rouge** — le même contrôle rejoué sur un registre volontairement régressé, qui doit échouer. Le
 * témoin vert n'est pas décoratif : sans lui, un contrôle qui cesserait de contrôler (un motif qui
 * ne reconnaît plus rien, une entrée lue vide) passerait pour vert au lieu de se voir.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { RACINE, analyserTests, fichiersDuDepot, globVersRegex, lireRegistre, temoinRouge, testNomme } from './gardes.mjs';

const REGISTRE = 'docs/gardes.md';
const RELIRE = "le harnais d'audit de #73 est à relire";

const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8');
const registre = () => lire(REGISTRE);

/**
 * Ce que #73 a promis, entrée par entrée : les tests que le registre doit nommer. Les garder ici en
 * toutes lettres est le but même d'un amorçage — le registre peut évoluer, ces garanties-là ne
 * se retirent pas sans que cette liste le dise.
 */
const PROMESSES = Object.freeze({
  C1: Object.freeze({
    fichier: 'apps/web/test/c1-sans-geste-technique.test.ts',
    tests: Object.freeze(['aucun fichier de apps/web/src ne porte un des motifs interdits']),
  }),
  C2: Object.freeze({
    fichier: 'apps/web/test/c2-parcours-sans-camera.test.ts',
    tests: Object.freeze(['aucun fichier essentiel ne fait appel à la caméra ou au QR code, hors Sync.svelte et webrtc.ts']),
  }),
});

/**
 * Analyses de C4 et C7 : ce qu'elles doivent citer, faute de quoi elles ne disent rien d'utile — pour
 * C4, l'issue qui bâtira la persistance ; pour C7, le catalogue des cibles, où une cible native
 * deviendra active (#162 : aucun document ne renvoie plus une cible à une issue).
 */
const RENVOIS_ATTENDUS = Object.freeze({ C4: Object.freeze(['#42']), C7: Object.freeze(['cibles.md']) });

// ─── Lecture ─────────────────────────────────────────────────────────────────────────────────

/** Les lignes « Harnais » d'une entrée qui citent `fichier`, avec le test nommé et le témoin rouge. */
function harnaisSur(id, fichier, texteDuRegistre) {
  const entree = lireRegistre(texteDuRegistre).entrees.get(id);
  if (!entree) assert.fail(`${id} n'a pas d'entrée dans ${REGISTRE} : ${RELIRE}`);
  return entree.harnais
    .filter((h) => h.chemins.includes(fichier))
    .map((h) => ({ nomme: testNomme(h.description), rouge: temoinRouge(h.description) }));
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

/** Le corps d'une entrée du registre, titre exclu, jusqu'au titre suivant ou la fin. */
function corpsDeLEntree(id, texteDuRegistre) {
  const titre = texteDuRegistre.match(new RegExp(`^##\\s+${id}\\s+·.*$`, 'm'));
  if (!titre) assert.fail(`${id} n'a pas d'entrée dans ${REGISTRE} : ${RELIRE}`);
  const debut = titre.index + titre[0].length;
  const suite = texteDuRegistre.slice(debut).search(/\n##\s+[IUC]\d+\s+·/);
  return suite === -1 ? texteDuRegistre.slice(debut) : texteDuRegistre.slice(debut, debut + suite);
}

/** Le paragraphe d'analyse d'une entrée : ce qui précède sa première ligne d'étiquette, hors « Chemins ». */
const analyseDe = (id, texteDuRegistre) =>
  corpsDeLEntree(id, texteDuRegistre)
    .split(/\n\s*[-*]\s+\*\*/)[0]
    .replace(/^Chemins\s*:.*$/m, '')
    .trim();

// ─── Règle 1 · chaque garantie promise est nommée au registre ────────────────────────────────

/**
 * Chaque test promis pour `id` est nommé par une ligne `Harnais` du registre, cette ligne cite un
 * témoin rouge nommé, et ce témoin est déclaré `it.fails` dans la source réelle — pas un test
 * ordinaire qui passerait sans rien prouver (#66, #69).
 */
function verifierPromessesNommees(id, texteDuRegistre, sourceDuFichier) {
  const { fichier, tests } = PROMESSES[id];
  const lignes = harnaisSur(id, fichier, texteDuRegistre);
  for (const attendu of tests) {
    const ligne = lignes.find((l) => l.nomme === attendu);
    assert.ok(ligne, `${id} : aucune ligne « Harnais » de ${REGISTRE} ne nomme « ${attendu} » sur \`${fichier}\` : ${RELIRE}`);
    assert.ok(ligne.rouge?.nom, `${id} : la ligne qui nomme « ${attendu} » ne cite pas de témoin rouge nommé : ${RELIRE}`);
    const mods = modificateursDeclaration(sourceDuFichier, ligne.rouge.nom);
    assert.ok(mods !== null, `${id} : le témoin « ${ligne.rouge.nom} » ne se trouve pas dans \`${fichier}\` : ${RELIRE}`);
    assert.match(mods, /\bfails\b/, `${id} : le témoin « ${ligne.rouge.nom} » n'est pas déclaré avec \`it.fails\` dans \`${fichier}\` (#66, #69)`);
  }
}

test('#73 · témoin vert — chaque garantie promise par C1 et C2 est nommée au registre, témoin rouge en it.fails à l’appui', () => {
  for (const id of Object.keys(PROMESSES)) verifierPromessesNommees(id, registre(), lire(PROMESSES[id].fichier));
});

test('#73 · témoin rouge — une ligne qui décrit sa garde en prose au lieu de nommer son test fait échouer la règle 1', () => {
  const enProse = registre().replace(/« aucun fichier essentiel ne fait\s+appel[^»]*»\s*:/, 'la caméra, en gros, reste de côté —');
  assert.throws(() => verifierPromessesNommees('C2', enProse, lire(PROMESSES.C2.fichier)), /ne nomme «/);
});

test('#73 · témoin rouge — un témoin rouge réécrit comme un test ordinaire fait échouer la règle 1', () => {
  const source = "it('témoin rouge · un écran essentiel qui dépend de BarcodeDetector', () => {});";
  assert.throws(() => verifierPromessesNommees('C2', registre(), source), /n'est pas déclaré avec `it\.fails`/);
});

// ─── Règle 2 · aucune garantie muette ────────────────────────────────────────────────────────

/**
 * Tout test actif du fichier de `id` est nommé par une ligne `Harnais` du registre. Les témoins
 * rouges et le titre de la suite n'en sont pas : l'un prouve l'échec, l'autre ne garde rien.
 */
function verifierAucuneGarantieMuette(id, texteDuRegistre, sourceDuFichier) {
  const { fichier } = PROMESSES[id];
  const nommes = new Set(harnaisSur(id, fichier, texteDuRegistre).map((l) => l.nomme));
  const muets = [...analyserTests(sourceDuFichier).actifs].filter(
    (nom) => !/^témoin rouge/i.test(nom) && !new RegExp(`^${id} ·`).test(nom) && !nommes.has(nom),
  );
  assert.deepEqual(
    muets,
    [],
    `${id} : ces tests de \`${fichier}\` gardent quelque chose qu'aucune ligne du registre ne nomme — ` +
      `les écrire au registre, sans quoi les retirer ne se verrait pas :\n${muets.join('\n')}`,
  );
}

test('#73 · témoin vert — aucun test de C1 et C2 ne garde quelque chose que le registre ne nomme pas', () => {
  for (const id of Object.keys(PROMESSES)) verifierAucuneGarantieMuette(id, registre(), lire(PROMESSES[id].fichier));
});

test('#73 · témoin rouge — une garantie ajoutée au code sans être écrite au registre fait échouer la règle 2', () => {
  const source = `${lire(PROMESSES.C2.fichier)}\nit('une garantie neuve que personne n’a écrite au registre', () => {});\n`;
  assert.throws(() => verifierAucuneGarantieMuette('C2', registre(), source), /qu'aucune ligne du registre ne nomme/);
});

// ─── Règle 3 · les analyses de C4 et C7 renvoient à ce qui les lèvera ────────────────────────

/**
 * L'entrée porte, avant sa première ligne d'étiquette, un paragraphe d'analyse qui cite les issues
 * attendues. Citer l'issue est ce qui distingue une analyse d'un paragraphe de remplissage : elle
 * dit à quelle condition la vérification manuelle cessera d'être la seule garde.
 */
function verifierAnalyseEcrite(id, texteDuRegistre) {
  const analyse = analyseDe(id, texteDuRegistre);
  assert.ok(analyse.length >= 80, `${id} n'a pas d'analyse écrite sous son titre : ${RELIRE}`);
  for (const renvoi of RENVOIS_ATTENDUS[id]) {
    assert.match(
      analyse,
      new RegExp(renvoi.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&') + '\\b'),
      `${id} : l'analyse ne renvoie pas à ${renvoi}, qui lèvera ce que la vérification manuelle tient seule pour l'instant : ${RELIRE}`,
    );
  }
}

test('#73 · témoin vert — les analyses de C4 et C7 sont écrites et renvoient aux issues qui les lèveront', () => {
  for (const id of Object.keys(RENVOIS_ATTENDUS)) verifierAnalyseEcrite(id, registre());
});

test('#73 · témoin rouge — une analyse réduite à du remplissage, sans renvoi à son issue, fait échouer la règle 3', () => {
  const remplissage = registre().replace(
    analyseDe('C4', registre()),
    'Rien de particulier à signaler ici, mais il faut bien écrire quelques lignes pour remplir la place.',
  );
  assert.throws(() => verifierAnalyseEcrite('C4', remplissage), /ne renvoie pas à #42/);
});

test('#73 · témoin rouge — une entrée réduite à sa seule vérification manuelle fait échouer la règle 3', () => {
  const nue = "## C7 · Hors magasin, les systèmes alertent ou bloquent\n\n- **Vérification manuelle** · `VM-C7-installation` — à la main.\n";
  assert.throws(() => verifierAnalyseEcrite('C7', nue), /n'a pas d'analyse écrite/);
});

// ─── Règle 4 · les `Chemins` couvrent ce que le harnais balaie ───────────────────────────────

/**
 * Ce que chaque harnais balaie réellement, au 14 septembre 2026. Une entrée du registre annonce sous
 * `Chemins` un **plancher** : modifier un fichier qui y répond impose de déclarer l'entrée, donc de
 * demander sa vérification manuelle. Si le harnais lit un fichier que le plancher ignore, une PR
 * peut toucher ce que C1 ou C2 garde sans que personne ait à relire quoi que ce soit — et le
 * registre affirme le contraire de ce qu'il fait.
 *
 * La couverture ne peut pas le voir : elle refuse un motif qui ne désigne aucun fichier, jamais un
 * fichier qu'aucun motif ne désigne. C'est un silence, pas une alerte, et c'est pour cela que cette
 * vérification est ici.
 */
const BALAYES = Object.freeze({
  C1: (tous) => [...tous.filter((f) => f.startsWith('apps/web/src/') && /\.(svelte|ts)$/.test(f)), 'apps/web/index.html', 'apps/web/vite.config.ts'],
  C2: (tous) => tous.filter((f) => f.startsWith('apps/web/src/') && /\.(svelte|ts)$/.test(f)),
});

/** Chaque fichier balayé par le harnais de `id` répond à l'un des motifs `Chemins`, tels que la garde les lit. */
function verifierCheminsCouvrentLeBalayage(id, texteDuRegistre, balayes) {
  const entree = lireRegistre(texteDuRegistre).entrees.get(id);
  if (!entree) assert.fail(`${id} n'a pas d'entrée dans ${REGISTRE} : ${RELIRE}`);
  const motifs = entree.chemins.map(globVersRegex);
  const oublies = balayes.filter((f) => !motifs.some((re) => re.test(f)));
  assert.deepEqual(
    oublies,
    [],
    `${id} : le harnais balaie des fichiers qu'aucun motif \`Chemins\` ne désigne — les modifier ne demanderait ` +
      `aucune vérification manuelle, alors que le registre dit le contraire :\n${oublies.join('\n')}`,
  );
}

/**
 * Rouge au 14 septembre 2026 : `Chemins` de C1 tenait sur deux lignes depuis `7c974a3`, et
 * `lireRegistre` ne lisait que la première — `apps/web/vite.config.ts`, écrit au registre, n'était
 * jamais lu. Vert depuis `5a2ea94`, qui apprend à la garde à prolonger la ligne ; le `todo` qui
 * portait cette dette est retiré le même jour, sans quoi ce test passerait sans plus rien dire.
 */
test('#73 · les Chemins de C1 et C2 couvrent chaque fichier que leur harnais balaie', () => {
  const tous = fichiersDuDepot();
  for (const id of Object.keys(BALAYES)) verifierCheminsCouvrentLeBalayage(id, registre(), BALAYES[id](tous));
});

const C1_UNE_SEULE_LIGNE =
  "## C1 · Aucun geste technique pour l'utilisateur\n\nChemins : `apps/web/src/**/*.svelte`, `apps/web/src/**/*.ts`, `apps/web/index.html`, `apps/web/vite.config.ts`\n\n- **Vérification manuelle** · `VM-C1-sans-geste` — une consigne assez longue pour être acceptée par la lecture du registre.\n";

test('#73 · témoin vert — des Chemins qui couvrent tout le balayage sont acceptés', () => {
  verifierCheminsCouvrentLeBalayage('C1', C1_UNE_SEULE_LIGNE, ['apps/web/src/main.ts', 'apps/web/src/views/Plan.svelte', 'apps/web/index.html', 'apps/web/vite.config.ts']);
});

test('#73 · témoin rouge — un fichier balayé qu’aucun motif ne désigne fait échouer la règle 4', () => {
  const sansManifeste = C1_UNE_SEULE_LIGNE.replace(', `apps/web/vite.config.ts`', '');
  assert.throws(() => verifierCheminsCouvrentLeBalayage('C1', sansManifeste, ['apps/web/index.html', 'apps/web/vite.config.ts']), /qu'aucun motif `Chemins` ne désigne/);
});
