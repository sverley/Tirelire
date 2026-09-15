/**
 * Harnais d'audit de #89, écrit par la session d'audit du 14 septembre 2026.
 *
 * #89 ferme une brèche mesurée : une fonction neuve ajoutée à `packages/gardes/gardes.mjs`, sans un
 * seul test ni amorçage, laisse tout vert. `VM-regles-primaires` (#64) est bien demandée à cette
 * PR, mais sa consigne pose une autre question — « cette règle nouvelle contredit-elle les règles
 * primaires ? », jamais « cette règle nouvelle est-elle gardée ? ». Tranché par le porteur le
 * 14 septembre : le plus simple suffit — toute PR qui touche la garde se voit demander, sans
 * condition, de dire quel harnais couvre chacun de ses changements, ou pourquoi il ne se programme
 * pas ; un développeur humain valide.
 *
 * Le harnais part des « Fait quand » de #89, pas du code. Il ne présume **ni du nom ni du nombre de
 * clés** : la piste de l'issue propose `VM-garde-couverture` à côté de `VM-regles-primaires`, mais
 * l'issue laisse le choix à la session qui code, et allonger la consigne existante resterait une
 * solution. Ce qu'il mesure, c'est donc ce que la PR reçoit : sur une copie du dépôt, il ouvre une
 * PR qui modifie un vrai fichier de la garde, lit ce que `cli.mjs demander` prépare pour elle, et
 * cherche parmi les consignes recopiées celle qui pose la question de la couverture. La couleur se
 * lit par `cli.mjs pr`, comme la vérification « Vérifications manuelles ».
 *
 * Ce que « poser la question de la couverture » veut dire est lu par `parleDeCouverture()` : nommer
 * un harnais ou un test, et parler de ce qu'il couvre ou de ce qui ne se programme pas. La lecture
 * est volontairement large — le harnais juge le sens de la consigne, pas ses mots — et ses deux
 * témoins la tiennent : la consigne de #64, figée telle qu'elle était le 14 septembre, doit être lue
 * « non » (témoin rouge) ; une consigne qui pose la question doit être lue « oui » (témoin vert).
 *
 * Tant que #89 n'est pas codé, ce fichier est rouge : c'est ce qu'on attend d'un harnais d'audit
 * écrit avant la solution. Les trois cas d'amorçage, eux, restent verts — sans eux, un rouge des
 * autres ne prouverait rien.
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
const RELIRE = "le harnais d'audit de #89 est à relire";
const ANALYSE = "Relu par la session d'audit de #89 : essai sur un dépôt copié, rien de réel n'est vérifié.";

/** Rien de la CI ni du crochet git qui joue ce harnais n'atteint la garde lancée. */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([cle]) => !/^(GITHUB_|GIT_)/.test(cle) && !['CORPS', 'NODE_TEST_CONTEXT'].includes(cle)),
);

const temporaires = [];
after(() => {
  for (const dossier of temporaires) rmSync(dossier, { recursive: true, force: true });
});

// ─── Lire une consigne : pose-t-elle la question de la couverture ? ───────────────────────────

const NOMME_UN_HARNAIS = /harnais|\btests?\b|\.test\.(mjs|ts|js)/i;
const PARLE_DE_COUVERTURE = /couvr|couvert|couvertur|programm/i;

/**
 * Vrai quand la consigne demande, pour ce que la PR change, quel harnais le couvre ou pourquoi il
 * ne se programme pas. Deux mesures, pas une phrase attendue : la solution reste libre.
 */
const parleDeCouverture = (texte) => NOMME_UN_HARNAIS.test(texte) && PARLE_DE_COUVERTURE.test(texte);

/** Consigne de #64, figée telle qu'elle était le 14 septembre 2026 : témoin rouge du détecteur. */
const CONSIGNE_DE_64 =
  'Nommer les règles primaires (les invariants et usages de `docs/invariants.md`, les contraintes de ' +
  "`docs/contraintes.md`, la garde de l'objectif primaire #58) que la règle nouvelle touche, et dire " +
  'pourquoi elle ne les contredit pas. Une contradiction ne se tranche pas dans la PR : elle devient une ' +
  'question dans une issue.';

/** Une consigne qui pose bien la question : témoin vert du détecteur. */
const CONSIGNE_TEMOIN =
  'Nommer ce que la PR change dans la garde, et pour chaque changement dire quel harnais le couvre ' +
  "(`gardes.test.mjs`, un amorçage) ou pourquoi il n'est pas programmable.";

// ─── Dépôt copié, garde lancée ───────────────────────────────────────────────────────────────

const lire = (racine, fichier) => readFileSync(join(racine, fichier), 'utf8');

function ecrire(racine, fichier, texte) {
  mkdirSync(dirname(join(racine, fichier)), { recursive: true });
  writeFileSync(join(racine, fichier), texte);
}

/** Copie de l'arbre de travail, fichiers suivis et nouveaux : la garde telle qu'elle serait commitée. */
function copierDepot() {
  const racine = mkdtempSync(join(tmpdir(), 'tirelire-audit-89-'));
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
const commentaireJs = "// Essai du harnais d'audit de #89 : cette ligne ne change rien au comportement.";
const commentaireYaml = "# Essai du harnais d'audit de #89 : cette ligne ne change rien au comportement.";

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

/** Clé dont la consigne pose la question de la couverture, `null` quand aucune ne la pose. */
const cleDeCouverture = (section) => clesDe(section).find((cle) => parleDeCouverture(consigneDe(section, cle))) ?? null;

/**
 * Description au format du modèle, bâtie sur la section que `demander` prépare : ce qu'un
 * développeur ou un agent en fait, sans rien inventer sur la forme de la vérification. `sauf`
 * laisse une vérification en l'état — analyse non écrite, case non cochée — pour montrer que
 * c'est bien elle qui tient la PR au rouge.
 */
function corps(section, { analyse, validee = false, sauf } = {}) {
  let cleCourante = null;
  const rempli = section.split('\n').map((ligne) => {
    const entete = ligne.match(/^-\s+`([^`]+)`\s+·/);
    if (entete) cleCourante = entete[1];
    if (/^(Touchés|Lien possible masqué) : à analyser$/.test(ligne)) return ligne.replace(/à analyser$/, 'aucun');
    if (cleCourante === sauf) return ligne;
    if (analyse) ligne = ligne.replace(/^(\s+-\s+Analyse\b[^:]*:)\s*à écrire$/, `$1 ${analyse}`);
    if (validee) ligne = ligne.replace(/\[ \] Validée/, '[x] Validée');
    return ligne;
  }).join('\n');
  return ["Pour #89 : essai du harnais d'audit.", '', '## Ce qui change', '', 'Essai.', '', rempli, ''].join('\n');
}

/** `pr --base main` hors GitHub : une case cochée y compte comme validée. */
function prLocale(depot, texte) {
  const fichier = join(depot.racine, '.git', 'corps-audit-89.md');
  writeFileSync(fichier, texte);
  return garde(depot.racine, ['pr', '--base', 'main', '--corps-fichier', fichier]);
}

/** Rouge sans analyse, rouge analysée mais non validée, verte une fois validée par un humain. */
function rougeJusquALaValidation(depot, section, quoi, { sauf } = {}) {
  rouge(prLocale(depot, corps(section)), `${quoi} : vérification demandée, analyse non écrite`);
  rouge(prLocale(depot, corps(section, { analyse: ANALYSE })), `${quoi} : analysée, pas encore validée par un développeur humain`);
  if (sauf) {
    rouge(
      prLocale(depot, corps(section, { analyse: ANALYSE, validee: true, sauf })),
      `${quoi} : tout est analysé et validé sauf \`${sauf}\` — c'est elle qui doit tenir la PR au rouge`,
    );
  }
  vert(prLocale(depot, corps(section, { analyse: ANALYSE, validee: true })), `${quoi} : analysée et validée`);
}

// ─── Amorçage : sans lui, rien de ce qui suit ne prouve quoi que ce soit ──────────────────────

test('amorçage · le dépôt copié tient sa garde, et une PR qui ne touche aucune règle passe au vert', () => {
  const racine = copierDepot();
  vert(garde(racine, ['couverture']), 'couverture du dépôt tel quel');
  const pr = prQuiModifie(ajoutA('README.md', "Ligne ajoutée par le harnais d'audit de #89."));
  vert(prLocale(pr.depot, corps(pr.section, { analyse: ANALYSE, validee: true })), 'PR qui ne touche aucune règle');
});

/**
 * Témoins du détecteur : il sait dire oui, et il sait dire non. Sans le témoin rouge, la consigne de
 * #64 suffirait à faire passer les cas suivants, et le harnais serait vert sans que #89 soit livré.
 */
test('amorçage · la lecture des consignes sait dire oui, et sait dire non', () => {
  assert.ok(parleDeCouverture(CONSIGNE_TEMOIN), `témoin vert : une consigne qui pose la question de la couverture est lue « non » : ${RELIRE}`);
  assert.ok(
    !parleDeCouverture(CONSIGNE_DE_64),
    `témoin rouge : la consigne de #64 est lue comme une demande de couverture ; le harnais passerait au vert sans #89 : ${RELIRE}`,
  );
});

/**
 * Témoin de la mesure : sur une PR que la garde demande déjà de faire valider, le harnais voit la
 * demande paraître, puis le rouge devenir vert. Un rouge des cas suivants dit donc bien que la
 * demande de #89 manque, et non que le harnais ne sait pas lire la garde.
 */
test('amorçage · la mesure sait voir une demande paraître, puis le rouge devenir vert', () => {
  const pr = prQuiModifie(ajoutA('docs/decisions.md', "## D99 · 2026-09-14 · Essai du harnais d'audit de #89\n\nEssai."));
  assert.ok(pr.cles.length, `une PR qui ajoute une décision ne se voit rien demander : ${RELIRE}\n${pr.section}`);
  rougeJusquALaValidation(pr.depot, pr.section, 'une PR qui ajoute une décision');
});

// ─── #89 · toute PR qui touche la garde se voit demander la couverture de ce qu'elle change ────

/** Les chemins de la garde, tels que `CHEMINS_DES_REGLES` et `docs/gardes.md` les nomment. */
const LA_GARDE = [
  ['le code de la garde', () => ajoutA('packages/gardes/gardes.mjs', commentaireJs)],
  ['le harnais de la garde', () => ajoutA('packages/gardes/gardes.test.mjs', commentaireJs)],
  ['un amorçage', () => ajoutA('amorcage/livraison-de-la-garde.test.mjs', commentaireJs)],
  ['le registre des gardes', () => ajoutA('docs/gardes.md', "<!-- Essai du harnais d'audit de #89. -->")],
  ['la vérification de la garde', () => ajoutA('.github/workflows/verifications.yml', commentaireYaml)],
  ['le modèle de PR', () => ajoutA('.github/pull_request_template.md', "<!-- Essai du harnais d'audit de #89. -->")],
];

for (const [quoi, fichiers] of LA_GARDE) {
  test(`#89 · une PR qui modifie ${quoi} se voit demander de dire quel harnais couvre ce qu'elle change`, () => {
    const pr = prQuiModifie(fichiers());
    const cle = cleDeCouverture(pr.section);
    assert.ok(
      cle,
      `#89 : une PR qui modifie ${quoi} ne se voit demander aucune vérification qui pose la question de la couverture ` +
        `(nommer le harnais qui couvre chaque changement, ou dire pourquoi il ne se programme pas).\n` +
        `Section préparée par « demander » :\n${pr.section}`,
    );
    rougeJusquALaValidation(pr.depot, pr.section, quoi, { sauf: cle });
  });
}

test("#89 · la demande est faite sans condition : y joindre un test ne la fait pas disparaître", () => {
  const pr = prQuiModifie({ ...ajoutA('packages/gardes/gardes.mjs', commentaireJs), ...ajoutA('packages/gardes/gardes.test.mjs', commentaireJs) });
  assert.ok(
    cleDeCouverture(pr.section),
    `#89 : la vérification n'est plus demandée dès que la PR touche aussi un harnais ; elle doit l'être sans condition, ` +
      `la consigne se proportionnant à la PR (D62) plutôt que la demande disparaissant.\n${pr.section}`,
  );
});

test("#89 · la brèche mesurée : une fonction neuve dans `gardes.mjs`, sans test, ne passe plus sans que la vérification soit demandée", () => {
  const fonctionNeuve =
    "/** Fonction neuve ajoutée par le harnais d'audit de #89 : aucun test ne la couvre. */\n" +
    'export const brecheMesureeDe89 = (valeur) => valeur;';
  const pr = prQuiModifie(ajoutA('packages/gardes/gardes.mjs', fonctionNeuve));
  vert(garde(pr.depot.racine, ['couverture']), 'la brèche est bien réelle : la couverture ne voit pas la fonction neuve');
  const cle = cleDeCouverture(pr.section);
  assert.ok(
    cle,
    `#89 : la brèche mesurée passe encore — une fonction neuve dans \`packages/gardes/gardes.mjs\`, sans un seul test, ` +
      `ne se voit demander aucune vérification de sa couverture.\nSection préparée par « demander » :\n${pr.section}`,
  );
  rougeJusquALaValidation(pr.depot, pr.section, 'une fonction neuve dans la garde, sans test', { sauf: cle });
});

test("#89 · la vérification ne vise pas une PR qui ne touche aucune règle : sinon elle viserait tout, donc rien", () => {
  const pr = prQuiModifie(ajoutA('README.md', "Autre ligne ajoutée par le harnais d'audit de #89."));
  assert.equal(
    cleDeCouverture(pr.section),
    null,
    `#89 : la vérification de couverture de la garde est demandée à une PR qui ne touche aucune règle.\n${pr.section}`,
  );
});

// ─── #89 · la règle est écrite là où les sessions la lisent ───────────────────────────────────

test('#89 · la clé qui porte la question de la couverture est écrite dans CLAUDE.md et dans le registre', () => {
  const pr = prQuiModifie(ajoutA('packages/gardes/gardes.mjs', commentaireJs));
  const cle = cleDeCouverture(pr.section);
  assert.ok(cle, `#89 : aucune vérification ne pose la question de la couverture, la règle ne peut donc pas être écrite.\n${pr.section}`);
  for (const fichier of ['CLAUDE.md', 'docs/gardes.md']) {
    assert.ok(
      lire(DEPOT, fichier).includes(cle),
      `#89 : ${fichier} ne nomme pas \`${cle}\` : la règle n'est pas écrite pour les sessions — une PR qui modifie la garde ` +
        `dit quel harnais couvre chacun de ses changements, ou pourquoi il ne se programme pas, et un développeur humain valide.`,
    );
  }
});
