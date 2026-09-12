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
 * Le dépôt est copié une fois ; chaque cas y modifie un fichier, lit la couverture, puis le rétablit.
 * Le témoin passe par `node packages/gardes/cli.mjs couverture`, comme la CI ; les cas appellent
 * `verifierCouverture`, qu'utilisent la CLI et la vérification des PR, pour rester assez rapides pour
 * le crochet de pré-commit. Les tests nommés se cherchent dans le registre du jour ; s'il n'en nomme
 * plus aucun, le harnais le dit au lieu de passer.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEPOT, RELIRE, copieDuDepot, couvertureCli, lignesDe, lire, modifie, problemes } from './test/copie-du-depot.mjs';

const REGISTRE = 'docs/gardes.md';
// Sans apostrophe droite ni guillemet : le nom remplacé reste une chaîne valide dans le fichier de test.
const RENOMME = 'test renommé pour l’audit de #59';
const ABSENT = 'test absent, nommé pour l’audit de #59';
const RACINE = copieDuDepot();

function rougeEtNomme(liste, nom, cas) {
  assert.ok(liste.length, `la couverture passe alors que ${cas} : le registre déclare un harnais qui ne garde plus rien.`);
  assert.ok(liste.some((p) => p.includes(nom)), `la couverture échoue sans nommer « ${nom} » :\n${liste.join('\n').slice(-2000)}`);
}

/** Modifie chacun des fichiers le temps de `mesurer`. */
const modifies = (fichiers, transformer, mesurer) =>
  fichiers.length ? modifie(RACINE, fichiers[0], transformer, () => modifies(fichiers.slice(1), transformer, mesurer)) : mesurer();

// ─── Tests nommés par le registre du jour ────────────────────────────────────────────────────

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

const echapper = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const appelDuTitre = (nom) => new RegExp(`(\\b(?:describe|suite|context|it|test)(?:\\.\\w+)*)(\\s*\\(\\s*['"\`]${echapper(nom)}['"\`])`);
const renfoncementDe = (ligne) => ligne.length - ligne.trimStart().length;
const ligneDuTitre = (lignes, nom) => lignes.findIndex((x) => appelDuTitre(nom).test(x));

/** Bloc d'un test nommé : de la ligne de son titre à la première ligne qui le ferme au même renfoncement. */
function blocDuTest(texte, nom) {
  const lignes = lignesDe(texte);
  const debut = ligneDuTitre(lignes, nom);
  if (debut < 0) return null;
  const fin = lignes.findIndex((x, i) => i > debut && x.trimStart().startsWith('}') && renfoncementDe(x) === renfoncementDe(lignes[debut]));
  return fin < 0 ? null : { lignes, debut, fin };
}

/** Ligne du `describe` qui contient la ligne `i` : la première ligne non vide, au-dessus, moins renfoncée. */
function ligneDuParent(lignes, i) {
  for (let j = i - 1; j >= 0; j--) {
    if (!lignes[j].trim() || renfoncementDe(lignes[j]) >= renfoncementDe(lignes[i])) continue;
    return /\b(?:describe|suite|context)(?:\.\w+)*\s*\(/.test(lignes[j]) ? j : -1;
  }
  return -1;
}

/** Premier fichier cité où `trouve(texte)` répond, lu dans `racine`. */
const fichierCite = (racine, chemins, trouve) => chemins.find((c) => existsSync(join(racine, c)) && trouve(lire(racine, c)));

// ─── Cas ─────────────────────────────────────────────────────────────────────────────────────

test('#59 · témoin : le dépôt copié tient sa garde, tests nommés compris', () => {
  const r = couvertureCli(RACINE);
  assert.equal(r.code, 0, `la couverture échoue déjà sur le dépôt copié :\n${r.sortie.slice(-2000)}`);
});

if (!NOMMES.length) {
  test('#59 · le registre nomme des tests', () => {
    assert.fail(`aucune ligne « Harnais » de ${REGISTRE} ne nomme de test (« nom » en tête de ce qu'elle garde) : ${RELIRE}`);
  });
}

for (const { entree, chemins, nom } of NOMMES) {
  test(`#59 · ${entree} : le test « ${nom} » renommé, son fichier gardé, fait échouer la couverture en le nommant`, async () => {
    const contenant = chemins.filter((c) => existsSync(join(RACINE, c)) && lire(RACINE, c).includes(nom));
    assert.ok(contenant.length, `« ${nom} » n'est déjà dans aucun de ${chemins.join(', ')} : la couverture devrait déjà échouer`);
    await modifies(contenant, (t) => t.split(nom).join(RENOMME), async () =>
      rougeEtNomme(await problemes(RACINE), nom, `« ${nom} » n'est plus dans ${contenant.join(', ')}`));
  });
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
    test(`#59 · ${entree} : le test « ${nom} » mis en commentaire ${style}, son fichier gardé, fait échouer la couverture en le nommant`, async () => {
      const fichier = fichierCite(RACINE, chemins, (t) => blocDuTest(t, nom));
      assert.ok(fichier, `le titre de « ${nom} » ou la fin de son bloc est introuvable dans ${chemins.join(', ')} : ${RELIRE}`);
      await modifie(RACINE, fichier, (t) => commenter(blocDuTest(t, nom)).join('\n'), async () =>
        rougeEtNomme(await problemes(RACINE), nom, `« ${nom} » n'est plus qu'en commentaire dans ${fichier}`));
    });
  }
}

// ─── Tests qui ne tournent pas (tranché le 11 septembre dans #59) ───────────────────────────

for (const { entree, chemins, nom } of NOMMES) {
  for (const [etat, modificateur] of [['désactivé par « .skip »', 'skip'], ['seulement prévu par « .todo »', 'todo']]) {
    test(`#59 · ${entree} : le test « ${nom} » ${etat}, son fichier gardé, fait échouer la couverture en le nommant`, async () => {
      const fichier = fichierCite(RACINE, chemins, (t) => ligneDuTitre(lignesDe(t), nom) >= 0);
      assert.ok(fichier, `le titre de « ${nom} » est introuvable dans ${chemins.join(', ')} : ${RELIRE}`);
      const marquer = (t) => {
        const l = lignesDe(t);
        const i = ligneDuTitre(l, nom);
        l[i] = l[i].replace(appelDuTitre(nom), `$1.${modificateur}$2`);
        return l.join('\n');
      };
      await modifie(RACINE, fichier, marquer, async () =>
        rougeEtNomme(await problemes(RACINE), nom, `« ${nom} » est marqué .${modificateur} dans ${fichier}`));
    });
  }
}

const dansLeDepot = (chemins, nom) => {
  const fichier = fichierCite(DEPOT, chemins, (t) => ligneDuTitre(lignesDe(t), nom) >= 0);
  if (!fichier) return null;
  const lignes = lignesDe(lire(DEPOT, fichier));
  return { lignes, i: ligneDuTitre(lignes, nom) };
};

const IMBRIQUES = NOMMES.filter(({ chemins, nom }) => {
  const d = dansLeDepot(chemins, nom);
  return d && ligneDuParent(d.lignes, d.i) >= 0;
});
if (!IMBRIQUES.length) {
  test('#59 · un test nommé est contenu dans un describe', () => assert.fail(`aucun test nommé n'est contenu dans un describe : ${RELIRE}`));
}
for (const { entree, chemins, nom } of IMBRIQUES) {
  test(`#59 · ${entree} : le describe qui contient « ${nom} » désactivé par « .skip », fait échouer la couverture en le nommant`, async () => {
    const fichier = fichierCite(RACINE, chemins, (t) => ligneDuTitre(lignesDe(t), nom) >= 0);
    const marquer = (t) => {
      const l = lignesDe(t);
      const j = ligneDuParent(l, ligneDuTitre(l, nom));
      l[j] = l[j].replace(/(\b(?:describe|suite|context)(?:\.\w+)*)(\s*\()/, '$1.skip$2');
      return l.join('\n');
    };
    await modifie(RACINE, fichier, marquer, async () =>
      rougeEtNomme(await problemes(RACINE), nom, `le describe qui contient « ${nom} » est marqué .skip dans ${fichier}`));
  });
}

const DESCRIBES = NOMMES.filter(({ chemins, nom }) => {
  const d = dansLeDepot(chemins, nom);
  return d && /\b(?:describe|suite|context)\b/.test(d.lignes[d.i].match(appelDuTitre(nom))[1]);
});
for (const { entree, chemins, nom } of DESCRIBES) {
  test(`#59 · ${entree} : tous les tests du describe « ${nom} » désactivés par « .skip », fait échouer la couverture en le nommant`, async () => {
    const fichier = fichierCite(RACINE, chemins, (t) => blocDuTest(t, nom));
    assert.ok(fichier, `le bloc de « ${nom} » est introuvable dans ${chemins.join(', ')} : ${RELIRE}`);
    const desactiver = (t) => {
      const { lignes, debut, fin } = blocDuTest(t, nom);
      let desactives = 0;
      for (let k = debut + 1; k < fin; k++) {
        lignes[k] = lignes[k].replace(/(?<![\w$.])((?:it|test)(?:\.\w+)*)(\s*\()/g, (_, appel, parenthese) => {
          desactives++;
          return `${appel}.skip${parenthese}`;
        });
      }
      assert.ok(desactives, `« ${nom} » ne contient aucun it ni test : ${RELIRE}`);
      return lignes.join('\n');
    };
    await modifie(RACINE, fichier, desactiver, async () =>
      rougeEtNomme(await problemes(RACINE), nom, `aucun test du describe « ${nom} » ne tourne dans ${fichier}`));
  });
}

test('#59 · un test que son fichier ne contient pas, nommé au registre, fait échouer la couverture en le nommant', async () => {
  const registre = lire(RACINE, REGISTRE);
  const cible = NOMMES.find(({ nom }) => registre.includes(`« ${nom} »`));
  assert.ok(cible, `aucun test nommé sur une seule ligne de ${REGISTRE} : ${RELIRE}`);
  await modifie(RACINE, REGISTRE, (t) => t.replace(`« ${cible.nom} »`, `« ${ABSENT} »`), async () =>
    rougeEtNomme(await problemes(RACINE), ABSENT, `${cible.entree} nomme « ${ABSENT} », que ${cible.chemins.join(', ')} ne contient pas`));
});
