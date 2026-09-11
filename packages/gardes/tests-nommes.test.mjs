/**
 * Harnais d'audit de #59, écrit par la session d'audit de la PR #63.
 *
 * Tranché par le porteur le 11 septembre, dans #59 (« ok pour ta lecture ») : un harnais déclaré,
 * c'est le test qu'il cite quand le registre en nomme un, sinon le fichier. Le registre nomme un test
 * entre guillemets, en tête de ce que le harnais garde :
 *
 *   - **Harnais** · `packages/core/test/plan.test.ts` — « positions et soldes (D19, D29) » : …
 *
 * Renommer ou supprimer ce test en gardant le fichier, ou nommer au registre un test que le fichier
 * ne contient pas, doit faire échouer la couverture en nommant le test : sinon plus rien ne garde
 * l'entrée, et le registre continue de dire le contraire. Une ligne qui ne nomme aucun test ne demande
 * que son fichier : le témoin le tient, puisque le registre du jour en compte.
 *
 * Mettre ce test en commentaire, en `//` ou dans un commentaire de bloc, revient à le supprimer : il
 * ne tourne plus. Le correctif `5da4f4d` le dit d'un nom cité dans un commentaire (décision 18 dans
 * #63) ; ces cas l'étendent au bloc entier, titre compris.
 *
 * Un test qui ne tourne pas ne garde rien. Tranché ensuite dans #59 (« oui, sinon c'est une faille
 * potentielle de couverture ») : un test nommé désactivé (`.skip`) ou seulement prévu (`.todo`) compte
 * comme absent. Lecture appliquée de la même faille : un test dont le `describe` est désactivé, et un
 * `describe` nommé dont aucun test ne tourne.
 *
 * Boîte noire, comme l'amorçage : copie du dépôt, fichier ou registre modifié, puis
 * `node packages/gardes/cli.mjs couverture`. Seuls comptent le code de sortie et le message. Les tests
 * nommés se cherchent dans le registre du jour ; s'il n'en nomme plus aucun, le harnais le dit au lieu
 * de passer.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = 'packages/gardes/cli.mjs';
const REGISTRE = 'docs/gardes.md';
const RELIRE = "le harnais d'audit de #59 est à relire";
// Sans apostrophe droite ni guillemet : le nom remplacé reste une chaîne valide dans le fichier de test.
const RENOMME = 'test renommé pour l’audit de #59';
const ABSENT = 'test absent, nommé pour l’audit de #59';

/** Rien du crochet git ni de la CI n'atteint la garde lancée : un GIT_DIR hérité lui ferait lire le vrai dépôt. */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([cle]) => !/^(GITHUB_|GIT_)/.test(cle) && cle !== 'NODE_TEST_CONTEXT'),
);

const temporaires = [];
after(() => {
  for (const dossier of temporaires) rmSync(dossier, { recursive: true, force: true });
});

// ─── Dépôt copié et garde lancée ─────────────────────────────────────────────────────────────

const IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', '.gradle']);

/**
 * Copie de l'arbre de travail : fichiers suivis et nouveaux, sans les ignorés. Hors dépôt git, quand
 * un autre harnais lance les tests du paquet dans sa propre copie, tout sauf les dossiers ignorés.
 */
function copierDepot() {
  const racine = mkdtempSync(join(tmpdir(), 'tirelire-audit-59-'));
  temporaires.push(racine);
  let fichiers = null;
  try {
    fichiers = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: DEPOT, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    }).split('\0').filter(Boolean);
  } catch {
    // pas un dépôt git
  }
  if (!fichiers) {
    cpSync(DEPOT, racine, {
      recursive: true,
      filter: (source) => !source.slice(DEPOT.length).split(sep).some((partie) => IGNORES.has(partie)),
    });
    return racine;
  }
  for (const fichier of fichiers) {
    try {
      mkdirSync(dirname(join(racine, fichier)), { recursive: true });
      cpSync(join(DEPOT, fichier), join(racine, fichier));
    } catch {
      // suivi par git mais retiré de l'arbre de travail
    }
  }
  return racine;
}

const lire = (racine, fichier) => readFileSync(join(racine, fichier), 'utf8');
const ecrire = (racine, fichier, texte) => writeFileSync(join(racine, fichier), texte);

function couverture(racine) {
  const r = spawnSync(process.execPath, [CLI, 'couverture'], { cwd: racine, env: ENV, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}

function rougeEtNomme(r, nom, cas) {
  assert.notEqual(r.code, 0, `la couverture passe alors que ${cas} : le registre déclare un harnais qui n'existe plus.`);
  assert.ok(r.sortie.includes(nom), `la couverture échoue sans nommer « ${nom} » :\n${r.sortie.slice(-2000)}`);
}

// ─── Tests nommés par le registre du jour ────────────────────────────────────────────────────

const lignesDe = (texte) => texte.replace(/\r\n?/g, '\n').split('\n');

/** Lignes « Harnais » qui nomment un test, lignes de suite comprises : entrée, chemins cités, nom. */
function testsNommes(registre) {
  const lignes = lignesDe(registre);
  const nommes = [];
  let entree = null;
  lignes.forEach((ligne, i) => {
    const titre = ligne.match(/^#{1,6}\s+(\S+)/);
    if (titre) {
      entree = /^[IUC]\d+$/.test(titre[1]) ? titre[1] : null;
      return;
    }
    if (!entree || !/^[-*]\s+\*\*Harnais\*\*/.test(ligne)) return;
    let texte = ligne;
    for (let j = i + 1; j < lignes.length && /^\s+\S/.test(lignes[j]); j++) texte += ` ${lignes[j].trim()}`;
    const corps = texte.replace(/^[-*]\s+\*\*Harnais\*\*\s*·\s*/, '');
    const tiret = corps.indexOf(' — ');
    const nom = tiret < 0 ? null : corps.slice(tiret + 3).match(/^«\s*(.+?)\s*»/);
    if (!nom) return;
    const chemins = [...corps.slice(0, tiret).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    nommes.push({ entree, chemins, nom: nom[1].replace(/\s+/g, ' ') });
  });
  return nommes;
}

const NOMMES = testsNommes(readFileSync(join(DEPOT, REGISTRE), 'utf8'));

// ─── Cas ─────────────────────────────────────────────────────────────────────────────────────

test('#59 · témoin : le dépôt copié tient sa garde, tests nommés compris', () => {
  const r = couverture(copierDepot());
  assert.equal(r.code, 0, `la couverture échoue déjà sur le dépôt copié :\n${r.sortie.slice(-2000)}`);
});

if (!NOMMES.length) {
  test('#59 · le registre nomme des tests', () => {
    assert.fail(`aucune ligne « Harnais » de ${REGISTRE} ne nomme de test (« nom » en tête de ce qu'elle garde) : ${RELIRE}`);
  });
}

for (const { entree, chemins, nom } of NOMMES) {
  test(`#59 · ${entree} : le test « ${nom} » renommé, son fichier gardé, fait échouer la couverture en le nommant`, () => {
    const racine = copierDepot();
    const contenant = chemins.filter((c) => existsSync(join(racine, c)) && lire(racine, c).includes(nom));
    assert.ok(contenant.length, `« ${nom} » n'est déjà dans aucun de ${chemins.join(', ')} : la couverture devrait déjà échouer`);
    for (const c of contenant) ecrire(racine, c, lire(racine, c).split(nom).join(RENOMME));
    rougeEtNomme(couverture(racine), nom, `« ${nom} » n'est plus dans ${contenant.join(', ')}`);
  });
}

/**
 * Bloc d'un test nommé : de la ligne de son titre à la première ligne qui le ferme au même
 * renfoncement, comme s'écrivent les fichiers du cœur.
 */
function blocDuTest(texte, nom) {
  const lignes = lignesDe(texte);
  const echappe = nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const titre = new RegExp(`\\b(?:describe|it|test)(?:\\.\\w+)*\\(\\s*['"\`]${echappe}['"\`]`);
  const debut = lignes.findIndex((x) => titre.test(x));
  if (debut < 0) return null;
  const renfoncement = lignes[debut].length - lignes[debut].trimStart().length;
  const fin = lignes.findIndex((x, i) => i > debut && x.trimStart().startsWith('}') && x.length - x.trimStart().length === renfoncement);
  return fin < 0 ? null : { lignes, debut, fin };
}

const COMMENTAIRES = [
  ['en « // »', ({ lignes, debut, fin }) => lignes.map((x, i) => (i >= debut && i <= fin ? `// ${x}` : x))],
  [
    'dans un commentaire de bloc',
    ({ lignes, debut, fin }) => {
      assert.ok(!lignes.slice(debut, fin + 1).some((x) => x.includes('*/')), `le bloc contient déjà une fin de commentaire : ${RELIRE}`);
      return [...lignes.slice(0, debut), '/*', ...lignes.slice(debut, fin + 1), '*/', ...lignes.slice(fin + 1)];
    },
  ],
];

for (const { entree, chemins, nom } of NOMMES) {
  for (const [style, commenter] of COMMENTAIRES) {
    test(`#59 · ${entree} : le test « ${nom} » mis en commentaire ${style}, son fichier gardé, fait échouer la couverture en le nommant`, () => {
      const racine = copierDepot();
      const fichier = chemins.find((c) => existsSync(join(racine, c)) && blocDuTest(lire(racine, c), nom));
      assert.ok(fichier, `le titre de « ${nom} » ou la fin de son bloc est introuvable dans ${chemins.join(', ')} : ${RELIRE}`);
      ecrire(racine, fichier, commenter(blocDuTest(lire(racine, fichier), nom)).join('\n'));
      rougeEtNomme(couverture(racine), nom, `« ${nom} » n'est plus qu'en commentaire dans ${fichier}`);
    });
  }
}

// ─── Tests qui ne tournent pas (tranché le 11 septembre dans #59) ───────────────────────────

const echapper = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const appelDuTitre = (nom) => new RegExp(`(\\b(?:describe|suite|context|it|test)(?:\\.\\w+)*)(\\s*\\(\\s*['"\`]${echapper(nom)}['"\`])`);
const renfoncementDe = (ligne) => ligne.length - ligne.trimStart().length;

/** Fichier cité, lignes et ligne du titre d'un test nommé. */
function titreDuTest(racine, chemins, nom) {
  for (const fichier of chemins) {
    if (!existsSync(join(racine, fichier))) continue;
    const lignes = lignesDe(lire(racine, fichier));
    const i = lignes.findIndex((x) => appelDuTitre(nom).test(x));
    if (i >= 0) return { fichier, lignes, i };
  }
  return null;
}

/** Ligne du `describe` qui contient la ligne `i` : la première ligne non vide, au-dessus, moins renfoncée. */
function ligneDuParent(lignes, i) {
  for (let j = i - 1; j >= 0; j--) {
    if (!lignes[j].trim() || renfoncementDe(lignes[j]) >= renfoncementDe(lignes[i])) continue;
    return /\b(?:describe|suite|context)(?:\.\w+)*\s*\(/.test(lignes[j]) ? j : -1;
  }
  return -1;
}

for (const { entree, chemins, nom } of NOMMES) {
  for (const [etat, modificateur] of [['désactivé par « .skip »', 'skip'], ['seulement prévu par « .todo »', 'todo']]) {
    test(`#59 · ${entree} : le test « ${nom} » ${etat}, son fichier gardé, fait échouer la couverture en le nommant`, () => {
      const racine = copierDepot();
      const cible = titreDuTest(racine, chemins, nom);
      assert.ok(cible, `le titre de « ${nom} » est introuvable dans ${chemins.join(', ')} : ${RELIRE}`);
      cible.lignes[cible.i] = cible.lignes[cible.i].replace(appelDuTitre(nom), `$1.${modificateur}$2`);
      ecrire(racine, cible.fichier, cible.lignes.join('\n'));
      rougeEtNomme(couverture(racine), nom, `« ${nom} » est marqué .${modificateur} dans ${cible.fichier}`);
    });
  }
}

const IMBRIQUES = NOMMES.filter(({ chemins, nom }) => {
  const cible = titreDuTest(DEPOT, chemins, nom);
  return cible && ligneDuParent(cible.lignes, cible.i) >= 0;
});
if (!IMBRIQUES.length) {
  test('#59 · un test nommé est contenu dans un describe', () => assert.fail(`aucun test nommé n'est contenu dans un describe : ${RELIRE}`));
}
for (const { entree, chemins, nom } of IMBRIQUES) {
  test(`#59 · ${entree} : le describe qui contient « ${nom} » désactivé par « .skip », fait échouer la couverture en le nommant`, () => {
    const racine = copierDepot();
    const cible = titreDuTest(racine, chemins, nom);
    const j = ligneDuParent(cible.lignes, cible.i);
    cible.lignes[j] = cible.lignes[j].replace(/(\b(?:describe|suite|context)(?:\.\w+)*)(\s*\()/, '$1.skip$2');
    ecrire(racine, cible.fichier, cible.lignes.join('\n'));
    rougeEtNomme(couverture(racine), nom, `le describe qui contient « ${nom} » est marqué .skip dans ${cible.fichier}`);
  });
}

const DESCRIBES = NOMMES.filter(({ chemins, nom }) => {
  const cible = titreDuTest(DEPOT, chemins, nom);
  return cible && /\b(?:describe|suite|context)\b/.test(cible.lignes[cible.i].match(appelDuTitre(nom))[1]);
});
for (const { entree, chemins, nom } of DESCRIBES) {
  test(`#59 · ${entree} : tous les tests du describe « ${nom} » désactivés par « .skip », fait échouer la couverture en le nommant`, () => {
    const racine = copierDepot();
    const fichier = chemins.find((c) => existsSync(join(racine, c)) && blocDuTest(lire(racine, c), nom));
    assert.ok(fichier, `le bloc de « ${nom} » est introuvable dans ${chemins.join(', ')} : ${RELIRE}`);
    const { lignes, debut, fin } = blocDuTest(lire(racine, fichier), nom);
    let desactives = 0;
    for (let k = debut + 1; k < fin; k++) {
      lignes[k] = lignes[k].replace(/(?<![\w$.])((?:it|test)(?:\.\w+)*)(\s*\()/g, (_, appel, parenthese) => {
        desactives++;
        return `${appel}.skip${parenthese}`;
      });
    }
    assert.ok(desactives, `« ${nom} » ne contient aucun it ni test : ${RELIRE}`);
    ecrire(racine, fichier, lignes.join('\n'));
    rougeEtNomme(couverture(racine), nom, `aucun test du describe « ${nom} » ne tourne dans ${fichier}`);
  });
}

test('#59 · un test que son fichier ne contient pas, nommé au registre, fait échouer la couverture en le nommant', () => {
  const racine = copierDepot();
  const registre = lire(racine, REGISTRE);
  const cible = NOMMES.find(({ nom }) => registre.includes(`« ${nom} »`));
  assert.ok(cible, `aucun test nommé sur une seule ligne de ${REGISTRE} : ${RELIRE}`);
  ecrire(racine, REGISTRE, registre.replace(`« ${cible.nom} »`, `« ${ABSENT} »`));
  rougeEtNomme(couverture(racine), ABSENT, `${cible.entree} nomme « ${ABSENT} », que ${cible.chemins.join(', ')} ne contient pas`);
});
