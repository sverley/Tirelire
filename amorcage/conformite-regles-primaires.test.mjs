/**
 * Harnais d'audit de #64, écrit par la session d'audit du 12 septembre 2026.
 *
 * #64 protège les **règles primaires** — les invariants et usages (`docs/invariants.md`), les
 * contraintes (`docs/contraintes.md`) et la garde de l'objectif primaire (#58, D61) — des PR qui
 * changent les règles. Changer une règle reste libre ; ce qui se vérifie, c'est que la règle
 * nouvelle ne les contredit pas. Une PR qui ajoute ou remplace une décision, modifie `CLAUDE.md` ou
 * modifie la garde (son code, sa vérification, ses harnais, le modèle de PR) reste donc rouge tant
 * que cette conformité n'est pas analysée puis validée par un développeur humain ; une PR qui
 * modifie un invariant, tant que l'accord explicite du porteur n'y figure pas — tranché le
 * 12 septembre 2026 : cet accord est une ligne « Accord du porteur : … » de la section, que la garde
 * lit et refuse quand elle manque ou reste vide, et non une consigne laissée à l'analyse.
 *
 * Le harnais part des « Fait quand » de #64, pas du code. Il ne présume ni du nom ni de la forme de
 * la vérification nouvelle : sur une copie du dépôt, il ouvre une PR qui modifie le vrai document,
 * lit ce que `cli.mjs demander` prépare pour elle, et le compare à ce qu'il prépare pour une PR qui
 * ne touche aucune règle ; la couleur se lit par `cli.mjs pr`, comme la vérification
 * « Vérifications manuelles ». La solution reste libre — famille d'entrées nouvelle au registre,
 * table de chemins à part, autre chose — tant que la demande paraît et que la PR reste rouge sans
 * elle.
 *
 * Tant que #64 n'est pas codé, ce fichier est rouge : c'est ce qu'on attend d'un harnais d'audit
 * écrit avant la solution.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = 'packages/gardes/cli.mjs';
const CE_HARNAIS = 'amorcage/conformite-regles-primaires.test.mjs';
const RELIRE = "le harnais d'audit de #64 est à relire";
const ANALYSE = "Relu par la session d'audit de #64 : essai sur un dépôt copié, rien de réel n'est vérifié.";

/** Rien de la CI ni du crochet git qui joue ce harnais n'atteint la garde lancée. */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([cle]) => !/^(GITHUB_|GIT_)/.test(cle) && !['CORPS', 'NODE_TEST_CONTEXT'].includes(cle)),
);

const temporaires = [];
after(() => {
  for (const dossier of temporaires) rmSync(dossier, { recursive: true, force: true });
});

// ─── Dépôt copié, garde lancée ───────────────────────────────────────────────────────────────

const lire = (racine, fichier) => readFileSync(join(racine, fichier), 'utf8');

function ecrire(racine, fichier, texte) {
  mkdirSync(dirname(join(racine, fichier)), { recursive: true });
  writeFileSync(join(racine, fichier), texte);
}

/** Copie de l'arbre de travail, fichiers suivis et nouveaux : la garde telle qu'elle serait commitée. */
function copierDepot() {
  const racine = mkdtempSync(join(tmpdir(), 'tirelire-audit-64-'));
  temporaires.push(racine);
  const liste = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: DEPOT, env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  for (const fichier of liste.split('\0').filter(Boolean)) {
    if (!existsSync(join(DEPOT, fichier))) continue; // supprimé dans l'arbre de travail
    mkdirSync(dirname(join(racine, fichier)), { recursive: true });
    cpSync(join(DEPOT, fichier), join(racine, fichier));
  }
  return racine;
}

/** Lance la garde du dépôt copié, comme la CI : `node packages/gardes/cli.mjs …`. */
function garde(racine, args) {
  const r = spawnSync(process.execPath, [join(racine, CLI), ...args], {
    cwd: racine, env: ENV, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const rouge = (r, cas) => assert.equal(r.code, 1, `attendu rouge : ${cas}\n${r.sortie}`);
const vert = (r, cas) => assert.equal(r.code, 0, `attendu vert : ${cas}\n${r.sortie}`);

/** Dépôt git copié : `main` porte le dépôt tel quel, la PR travaille sur `pr`. */
function depotGit() {
  const racine = copierDepot();
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Audit', '-c', 'user.email=audit@exemple.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
      { cwd: racine, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Base');
  git('checkout', '-q', '-b', 'pr');
  return { racine, git };
}

// ─── PR simulées ─────────────────────────────────────────────────────────────────────────────

/** Le document tel quel, plus ce que la PR y ajoute : la modification porte sur le vrai fichier. */
const ajoutA = (fichier, texte) => ({ [fichier]: `${lire(DEPOT, fichier).trimEnd()}\n\n${texte}\n` });
const commentaireJs = "// Essai du harnais d'audit de #64 : cette ligne ne change rien au comportement.";
const commentaireYaml = "# Essai du harnais d'audit de #64 : cette ligne ne change rien au comportement.";

/**
 * Une PR qui modifie `fichiers` : ce que `demander` prépare pour elle, et de quoi lancer la
 * vérification. La copie est faite par PR, pour qu'un cas n'en trouble pas un autre.
 */
function prQuiModifie(fichiers) {
  const depot = depotGit();
  for (const [fichier, texte] of Object.entries(fichiers)) {
    assert.ok(existsSync(join(depot.racine, fichier)), `${fichier} n'existe plus : ${RELIRE}`);
    assert.notEqual(texte, lire(depot.racine, fichier), `rien ne change dans ${fichier} : ${RELIRE}`);
    ecrire(depot.racine, fichier, texte);
  }
  depot.git('add', '-A');
  depot.git('commit', '-q', '-m', 'Ce que la PR change');
  const prepare = garde(depot.racine, ['demander', '--base', 'main', '--auteur', 'audit']);
  assert.equal(prepare.code, 0, `« demander » a échoué :\n${prepare.sortie}`);
  return { depot, section: prepare.sortie, cles: clesDe(prepare.sortie) };
}

/** Clés listées sous « Vérifications manuelles » par `demander`. */
const clesDe = (section) => [...section.matchAll(/^-\s+`([^`]+)`\s+·/gm)].map((m) => m[1]);

/** Consigne recopiée par `demander` pour une clé : ce que lira qui valide. */
function consigneDe(section, cle) {
  const ligne = section.split('\n').find((l) => l.startsWith(`- \`${cle}\``));
  return ligne ? ligne.split(' — ').slice(1).join(' — ') : '';
}

/**
 * Description au format du modèle, bâtie sur la section que `demander` prépare : ce qu'un
 * développeur ou un agent en fait, sans rien inventer sur la forme de la vérification.
 */
function corps(section, { analyse, validee = false, accord } = {}) {
  let rempli = section.replace(/^(Touchés|Lien possible masqué) : à analyser$/gm, '$1 : aucun');
  if (analyse) rempli = rempli.replace(/^(\s+-\s+Analyse\b[^:]*:)\s*à écrire$/gm, `$1 ${analyse}`);
  if (validee) rempli = rempli.replace(/\[ \] Validée/g, '[x] Validée');
  if (accord !== undefined) rempli = avecAccord(rempli, accord);
  return ["Pour #64 : essai du harnais d'audit.", '', '## Ce qui change', '', 'Essai.', '', rempli, ''].join('\n');
}

/**
 * Ligne d'accord du porteur, telle que la garde doit la reconnaître (tranché le 12 septembre 2026) :
 * un paragraphe à part de la section, pour qu'elle ne prolonge pas la déclaration qui la précède.
 */
const ACCORD = /^ {0,3}Accord du porteur\s*:.*$/m;
const avecAccord = (texte, valeur) =>
  ACCORD.test(texte)
    ? texte.replace(ACCORD, `Accord du porteur : ${valeur}`)
    : texte.replace(/^(Lien possible masqué : .*)$/m, `$1\n\nAccord du porteur : ${valeur}`);

/** `pr --base main` hors GitHub : une case cochée y compte comme validée. */
function prLocale(depot, texte) {
  const fichier = join(depot.racine, '.git', 'corps-audit-64.md');
  writeFileSync(fichier, texte);
  return garde(depot.racine, ['pr', '--base', 'main', '--corps-fichier', fichier]);
}

/** Ce qu'une PR qui ne touche aucune règle demande : le fond sur lequel se détache la demande de #64. */
let fond = null;
function fondDemande() {
  if (!fond) fond = prQuiModifie(ajoutA('README.md', "Ligne ajoutée par le harnais d'audit de #64.")).cles;
  return fond;
}

/** Vérifications demandées à cette PR et à elle seule. */
function enPlus({ section, cles }, quoi) {
  const nouvelles = cles.filter((cle) => !fondDemande().includes(cle));
  assert.ok(
    nouvelles.length,
    `#64 : une PR qui modifie ${quoi} ne se voit demander aucune vérification de plus qu'une PR qui ne touche aucune règle.\n` +
      `Section préparée par « demander » :\n${section}`,
  );
  return nouvelles;
}

/** Rouge sans analyse, rouge analysée mais non validée, verte une fois validée par un humain. */
function rougeJusquALaValidation(depot, section, quoi) {
  rouge(prLocale(depot, corps(section)), `${quoi} : vérification demandée, analyse non écrite`);
  rouge(prLocale(depot, corps(section, { analyse: ANALYSE })), `${quoi} : analysée, pas encore validée par un développeur humain`);
  vert(prLocale(depot, corps(section, { analyse: ANALYSE, validee: true })), `${quoi} : analysée et validée`);
}

// ─── Amorçage : sans lui, rien de ce qui suit ne prouve quoi que ce soit ──────────────────────

test("amorçage · le dépôt copié tient sa garde, et une PR qui ne touche aucune règle passe au vert", () => {
  const racine = copierDepot();
  vert(garde(racine, ['couverture']), 'couverture du dépôt tel quel');
  const pr = prQuiModifie(ajoutA('README.md', "Ligne ajoutée par le harnais d'audit de #64."));
  vert(prLocale(pr.depot, corps(pr.section, { analyse: ANALYSE, validee: true })), 'PR qui ne touche aucune règle');
});

/**
 * Témoin de la mesure : sur une entrée que le registre garde déjà, le harnais voit la demande
 * paraître, puis le rouge devenir vert. Un rouge des cas suivants dit donc bien que la demande de
 * #64 manque, et non que le harnais ne sait pas lire la garde.
 */
test("amorçage · la mesure sait voir une demande paraître, puis le rouge devenir vert", () => {
  const gardee = prQuiModifie(ajoutA('packages/core/src/automations.ts', commentaireJs));
  assert.ok(
    gardee.cles.filter((cle) => !fondDemande().includes(cle)).length,
    `un chemin gardé par le registre ne demande plus rien : ${RELIRE}\n${gardee.section}`,
  );
  rougeJusquALaValidation(gardee.depot, gardee.section, 'un chemin déjà gardé par le registre');
});

// ─── #64 · une règle nouvelle demande la vérification de sa conformité ────────────────────────

const REGLES = [
  ['une décision ajoutée à `docs/decisions.md`', () => ajoutA('docs/decisions.md', "## D99 · 2026-09-12 · Essai du harnais d'audit de #64\n\nEssai.")],
  ['les règles des sessions dans `CLAUDE.md`', () => ajoutA('CLAUDE.md', "- Ligne ajoutée par le harnais d'audit de #64.")],
  ['le code de la garde', () => ajoutA('packages/gardes/gardes.mjs', commentaireJs)],
  ['la vérification de la garde', () => ajoutA('.github/workflows/verifications.yml', commentaireYaml)],
  ['le modèle de PR', () => ajoutA('.github/pull_request_template.md', "<!-- Essai du harnais d'audit de #64. -->")],
  ['un harnais de la garde', () => ajoutA('amorcage/livraison-de-la-garde.test.mjs', commentaireJs)],
  [
    'à la fois la garde et son harnais',
    () => ({
      ...ajoutA('packages/gardes/gardes.mjs', commentaireJs),
      ...ajoutA('amorcage/livraison-de-la-garde.test.mjs', commentaireJs),
      ...ajoutA(CE_HARNAIS, commentaireJs),
    }),
  ],
];

for (const [quoi, fichiers] of REGLES) {
  test(`#64 · une PR qui modifie ${quoi} reste rouge tant que sa conformité aux règles primaires n'est pas analysée puis validée`, () => {
    const pr = prQuiModifie(fichiers());
    enPlus(pr, quoi);
    rougeJusquALaValidation(pr.depot, pr.section, quoi);
  });
}

test("#64 · la consigne demande de nommer les règles primaires touchées et de dire pourquoi la règle nouvelle ne les contredit pas", () => {
  const pr = prQuiModifie(ajoutA('docs/decisions.md', "## D99 · 2026-09-12 · Essai du harnais d'audit de #64\n\nEssai."));
  const consignes = enPlus(pr, 'une décision').map((cle) => consigneDe(pr.section, cle));
  assert.ok(
    consignes.some((t) => /r[èe]gles\s+primaires/i.test(t) && /(contredi|conform)/i.test(t)),
    `#64 : la consigne recopiée dans la PR ne dit pas de nommer les règles primaires touchées ni pourquoi la règle nouvelle ne les contredit pas.\n` +
      `Consignes demandées :\n${consignes.map((t) => `- ${t}`).join('\n') || '- aucune'}`,
  );
});

// ─── #64 · un invariant ne change qu'avec l'accord explicite du porteur ───────────────────────

test("#64 · `demander` prépare la ligne d'accord du porteur pour une PR qui modifie un invariant, et pour elle seule", () => {
  const pr = prQuiModifie(ajoutA('docs/invariants.md', "Précision ajoutée par le harnais d'audit de #64."));
  assert.ok(
    ACCORD.test(pr.section),
    `#64 : « demander » ne prépare aucune ligne « Accord du porteur : » pour une PR qui modifie un invariant.\n` +
      `Section préparée :\n${pr.section}`,
  );
  const neutre = prQuiModifie(ajoutA('README.md', "Autre ligne ajoutée par le harnais d'audit de #64."));
  assert.ok(
    !ACCORD.test(neutre.section),
    `#64 : la ligne « Accord du porteur : » est demandée à une PR qui ne touche aucun invariant : elle viserait tout, donc rien.\n` +
      `Section préparée :\n${neutre.section}`,
  );
});

test("#64 · une PR qui modifie un invariant reste rouge tant que l'accord explicite du porteur n'y figure pas", () => {
  const pr = prQuiModifie(ajoutA('docs/invariants.md', "Précision ajoutée par le harnais d'audit de #64."));
  const plein = { analyse: ANALYSE, validee: true };
  rouge(prLocale(pr.depot, corps(pr.section, plein)), 'invariant modifié, aucune ligne d\'accord du porteur');
  for (const vide of ['', 'à analyser', '…']) {
    rouge(prLocale(pr.depot, corps(pr.section, { ...plein, accord: vide })), `invariant modifié, accord laissé « ${vide || 'vide'} »`);
  }
  vert(
    prLocale(pr.depot, corps(pr.section, { ...plein, accord: 'https://github.com/sverley/Tirelire/issues/64#issuecomment-5647314489 (accord du 12 septembre 2026)' })),
    "invariant modifié, accord du porteur écrit, vérifications analysées et validées",
  );
});

// ─── #64 · la règle est écrite là où les sessions la lisent ───────────────────────────────────

test('#64 · la règle des règles primaires est écrite dans CLAUDE.md et dans le registre', () => {
  for (const fichier of ['CLAUDE.md', 'docs/gardes.md']) {
    assert.ok(
      /r[èe]gles\s+primaires/i.test(lire(DEPOT, fichier)),
      `#64 : ${fichier} n'écrit pas la règle : une règle nouvelle (décision, règle des sessions, changement de la garde) ne se fusionne pas sans une vérification de sa conformité aux règles primaires.`,
    );
  }
});
