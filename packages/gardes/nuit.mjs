/**
 * La nuit rouge se signale sans qu'on la cherche (#307, point 4). Chaque nuit, `nuit.yml` joue les
 * tests navigateur de non-régression sur le dernier commit de `main` ; ce module dit la suite :
 *
 * - une nuit rouge ouvre une issue, ou complète, d'un commentaire, celle d'une nuit précédente encore
 *   ouverte ; elle nomme les fichiers rouges et le commit de `main` jugé ;
 * - la nuit verte qui suit une nuit rouge le dit dans cette issue, sans la fermer ; une nuit verte
 *   qui suit une nuit verte ne dit rien, comme une nuit où rien ne s'est joué.
 *
 * Une nuit rouge ne bloque aucune fusion : rien d'autre que cette issue ne la porte.
 *
 *   node nuit.mjs signaler <vert|rouge> <commit> <rapport vitest JSON|-> <adresse de l'exécution>
 *
 * Lit `GH_TOKEN` et `GH_REPO` (propriétaire/dépôt) ; n'appelle que l'API de GitHub.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TITRE = 'Tests navigateur rouges la nuit, sur main';
/** La marque de l'issue de la nuit, dans son corps : elle la retrouve sans étiquette. */
export const MARQUE = '<!-- nuit : tests navigateur -->';
export const ROUGE = '<!-- nuit : rouge -->';
export const VERTE = '<!-- nuit : verte -->';

/**
 * Les fichiers rouges d'un rapport JSON de vitest, depuis `apps/web/` ; `null` si le rapport ne se lit
 * pas.
 */
export function fichiersRouges(rapport) {
  if (!Array.isArray(rapport?.testResults)) return null;
  return rapport.testResults
    .filter((f) => f.status === 'failed' || (f.assertionResults ?? []).some((a) => a.status === 'failed'))
    .map((f) => {
      const nom = String(f.name).split('\\').join('/');
      const i = nom.lastIndexOf('apps/web/');
      return i >= 0 ? nom.slice(i) : nom;
    })
    .sort();
}

/** Ce que dit une nuit rouge : le commit jugé, les fichiers rouges, l'exécution. */
export function texteRouge({ commit, rouges, execution }) {
  const liste = rouges === null ? ["- les fichiers rouges ne se lisent pas : le lancement n'a pas rendu son rapport, voir le journal de l'exécution"] : rouges.length ? rouges.map((f) => `- \`${f}\``) : ["- aucun fichier rouge dans le rapport : le lancement a échoué hors de tout test, voir le journal de l'exécution"];
  return [
    ROUGE,
    `Nuit rouge : les tests navigateur de non-régression rougissent sur le commit \`${commit}\` de \`main\`.`,
    '',
    'Fichiers rouges :',
    ...liste,
    '',
    `Exécution : ${execution}`,
    '',
    'Une nuit rouge ne bloque aucune fusion (#307). La nuit suivante rejoue ces fichiers.',
  ].join('\n');
}

/** Ce que dit la nuit verte qui suit une nuit rouge. */
export function texteVert({ commit, execution }) {
  return [VERTE, `Nuit verte : les tests navigateur de non-régression sont verts sur le commit \`${commit}\` de \`main\`.`, '', `Exécution : ${execution}`].join('\n');
}

/**
 * La suite d'une nuit. `verdict` : `vert` ou `rouge` ; `issue` : l'issue de la nuit encore ouverte,
 * `{ number }`, ou `null` ; `dernier` : le texte de son dernier commentaire, ou de son corps sans
 * commentaire. Rend `{ action: 'creer' | 'commenter' | 'rien', titre?, corps? }`.
 */
export function suiteDeLaNuit({ verdict, commit, rouges = null, execution, issue = null, dernier = '' }) {
  if (verdict === 'rouge') {
    const corps = texteRouge({ commit, rouges, execution });
    return issue ? { action: 'commenter', corps } : { action: 'creer', titre: TITRE, corps: `${MARQUE}\n${corps}` };
  }
  if (verdict === 'vert' && issue && String(dernier).includes(ROUGE)) return { action: 'commenter', corps: texteVert({ commit, execution }) };
  return { action: 'rien' };
}

/** L'issue de la nuit encore ouverte parmi des issues de l'API, ou `null` : la plus ancienne. */
export function issueDeLaNuit(issues) {
  return (issues ?? []).filter((i) => !i.pull_request && i.title === TITRE && String(i.body ?? '').includes(MARQUE)).sort((a, b) => a.number - b.number)[0] ?? null;
}

async function signaler([verdict, commit, fichierRapport, execution]) {
  const jeton = process.env.GH_TOKEN;
  const depot = process.env.GH_REPO;
  if (!jeton || !depot || !['vert', 'rouge'].includes(verdict)) {
    console.error('usage : GH_TOKEN=… GH_REPO=propriétaire/dépôt node nuit.mjs signaler <vert|rouge> <commit> <rapport|-> <adresse>');
    process.exit(2);
  }
  const api = async (chemin, options = {}) => {
    const r = await fetch(`https://api.github.com/repos/${depot}/${chemin}`, {
      ...options,
      headers: { authorization: `Bearer ${jeton}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    });
    if (!r.ok) throw new Error(`${options.method ?? 'GET'} ${chemin} : ${r.status} ${await r.text()}`);
    return r.json();
  };
  let rouges = null;
  if (fichierRapport && fichierRapport !== '-') {
    try {
      rouges = fichiersRouges(JSON.parse(readFileSync(fichierRapport, 'utf8')));
    } catch {
      rouges = null;
    }
  }
  const issue = issueDeLaNuit(await api('issues?state=open&per_page=100&sort=created&direction=asc'));
  let dernier = '';
  if (issue) {
    dernier = issue.body ?? '';
    if (issue.comments > 0) {
      const page = Math.ceil(issue.comments / 100);
      const commentaires = await api(`issues/${issue.number}/comments?per_page=100&page=${page}`);
      dernier = commentaires.at(-1)?.body ?? dernier;
    }
  }
  const suite = suiteDeLaNuit({ verdict, commit, rouges, execution, issue, dernier });
  if (suite.action === 'creer') {
    const cree = await api('issues', { method: 'POST', body: JSON.stringify({ title: suite.titre, body: suite.corps }) });
    console.log(`Nuit rouge : issue #${cree.number} ouverte.`);
  } else if (suite.action === 'commenter') {
    await api(`issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: suite.corps }) });
    console.log(`Nuit ${verdict === 'rouge' ? 'rouge' : 'verte'} : dite dans l'issue #${issue.number}.`);
  } else {
    console.log(verdict === 'vert' ? "Nuit verte : aucune nuit rouge à suivre, rien à dire." : 'Rien à signaler.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [commande, ...args] = process.argv.slice(2);
  if (commande === 'signaler') await signaler(args);
  else {
    console.error('usage : node nuit.mjs signaler …');
    process.exit(2);
  }
}
