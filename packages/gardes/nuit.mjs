/**
 * La nuit rouge se signale sans qu'on la cherche (#307, point 4 ; #383, point 4). Chaque nuit,
 * `nuit.yml` joue la suite entière au seuil 2 sur le dernier commit de `main` ; ce module dit la
 * suite, quel que soit l'ensemble où elle rougit :
 *
 * - une nuit rouge ouvre une issue, ou complète, d'un commentaire, celle d'une nuit précédente encore
 *   ouverte ; elle nomme les fichiers rouges et le commit de `main` jugé ;
 * - la nuit verte qui suit une nuit rouge le dit dans cette issue, sans la fermer ; une nuit verte
 *   qui suit une nuit verte ne dit rien, comme une nuit où rien ne s'est joué. Le dernier message de
 *   la nuit est le dernier, du corps de l'issue puis de ses commentaires, qui porte la marque d'une
 *   nuit rouge ou verte : les commentaires d'une session ou du porteur ne comptent pas (#431).
 *
 * Une nuit rouge ne bloque aucune fusion : rien d'autre que cette issue ne la porte.
 *
 *   node nuit.mjs signaler <vert|rouge> <commit> <journaux|rapport vitest JSON|-> <adresse de l'exécution>
 *
 * `<journaux>` : le dossier des lancements de la nuit (`lances` : `id<TAB>nom<TAB>vitest|node`, et
 * `<nom>.rapport` de chacun) ; les fichiers rouges s'y lisent depuis la racine du dépôt, le dossier
 * courant.
 *
 * Lit `GH_TOKEN` et `GH_REPO` (propriétaire/dépôt) ; n'appelle que l'API de GitHub.
 */
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TITRE = 'Suite rouge la nuit, sur main';
/** Le titre de l'issue de la nuit avant #383 : une issue encore ouverte sous ce titre se complète. */
export const ANCIEN_TITRE = 'Tests navigateur rouges la nuit, sur main';
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

/**
 * Les fichiers rouges d'un rapport du rapporteur `node --test` (`.githooks/rapport-node.mjs`, une
 * ligne JSON par événement), en chemins absolus ; `null` s'il ne se lit pas.
 */
export function fichiersRougesNode(texte) {
  const r = new Set();
  for (const l of String(texte).split('\n').filter(Boolean)) {
    let x;
    try {
      x = JSON.parse(l);
    } catch {
      return null;
    }
    if (x.type === 'echec' && x.file) r.add(x.file);
  }
  return [...r].sort();
}

/**
 * Les fichiers rouges de tous les lancements d'une nuit (#383), depuis `racine` : `null` si l'un
 * d'eux, rouge, n'a pas rendu de rapport lisible. `lire(chemin)` rend le texte d'un fichier, ou `null`.
 */
export function fichiersRougesDesJournaux(journaux, racine, lire) {
  const lances = (lire(join(journaux, 'lances')) ?? '').split('\n').filter(Boolean).map((l) => l.split('\t'));
  const tous = new Set();
  let illisible = false;
  for (const [, nom, sorte] of lances) {
    const code = (lire(join(journaux, `${nom}.code`)) ?? '').trim();
    const texte = lire(join(journaux, `${nom}.rapport`));
    let rouges = null;
    if (texte !== null) {
      if (sorte === 'node') rouges = fichiersRougesNode(texte);
      else {
        try {
          rouges = fichiersRouges(JSON.parse(texte));
        } catch {
          rouges = null;
        }
      }
    }
    if (rouges === null) {
      if (code !== '0') illisible = true;
      continue;
    }
    for (const f of rouges) tous.add(isAbsolute(f) ? relative(racine, f).split('\\').join('/') : f);
  }
  return illisible && !tous.size ? null : [...tous].sort();
}

/** Ce que dit une nuit rouge : le commit jugé, les fichiers rouges, l'exécution. */
export function texteRouge({ commit, rouges, execution }) {
  const liste = rouges === null ? ["- les fichiers rouges ne se lisent pas : le lancement n'a pas rendu son rapport, voir le journal de l'exécution"] : rouges.length ? rouges.map((f) => `- \`${f}\``) : ["- aucun fichier rouge dans le rapport : le lancement a échoué hors de tout test, voir le journal de l'exécution"];
  return [
    ROUGE,
    `Nuit rouge : la suite rougit sur le commit \`${commit}\` de \`main\`.`,
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
  return [VERTE, `Nuit verte : la suite est verte sur le commit \`${commit}\` de \`main\`.`, '', `Exécution : ${execution}`].join('\n');
}

/**
 * Le dernier message de la nuit dans une issue de la nuit (#431) : le dernier, du corps puis des
 * commentaires dans leur ordre, qui porte la marque d'une nuit rouge ou verte ; `''` si aucun. Les
 * autres commentaires, quel qu'en soit l'auteur, ne comptent pas.
 */
export function dernierMessageDeLaNuit(corps, commentaires = []) {
  const messages = [corps, ...(commentaires ?? []).map((c) => c?.body)].map((m) => String(m ?? ''));
  return messages.findLast((m) => m.includes(ROUGE) || m.includes(VERTE)) ?? '';
}

/**
 * La suite d'une nuit. `verdict` : `vert` ou `rouge` ; `issue` : l'issue de la nuit encore ouverte,
 * `{ number }`, ou `null` ; `dernier` : le texte du dernier message de la nuit dans l'issue
 * (`dernierMessageDeLaNuit`). Rend `{ action: 'creer' | 'commenter' | 'rien', titre?, corps? }`.
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
  return (issues ?? []).filter((i) => !i.pull_request && [TITRE, ANCIEN_TITRE].includes(i.title) && String(i.body ?? '').includes(MARQUE)).sort((a, b) => a.number - b.number)[0] ?? null;
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
  const dossier = fichierRapport && fichierRapport !== '-' ? (() => { try { return statSync(fichierRapport).isDirectory(); } catch { return false; } })() : false;
  if (dossier) {
    const lire = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
    rouges = fichiersRougesDesJournaux(fichierRapport, resolve('.'), lire);
  } else if (fichierRapport && fichierRapport !== '-') {
    try {
      rouges = fichiersRouges(JSON.parse(readFileSync(fichierRapport, 'utf8')));
    } catch {
      rouges = null;
    }
  }
  const issue = issueDeLaNuit(await api('issues?state=open&per_page=100&sort=created&direction=asc'));
  let dernier = '';
  if (issue) {
    const commentaires = [];
    for (let page = 1; commentaires.length < issue.comments; page++) {
      const lot = await api(`issues/${issue.number}/comments?per_page=100&page=${page}`);
      commentaires.push(...lot);
      if (lot.length < 100) break;
    }
    dernier = dernierMessageDeLaNuit(issue.body, commentaires);
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
