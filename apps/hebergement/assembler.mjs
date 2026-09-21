// Assemble le dossier à déposer sur l'hébergement : la PWA construite avec le bon préfixe
// d'adresse, le relais PHP, `.htaccess` et `.ovhconfig`. Puis une archive zip.
//   TIRELIRE_BASE=/tirelire/ pnpm --filter @tirelire/hebergement assembler
//   (sans variable : le site est prévu à la racine du domaine ou du sous-domaine)
//   TIRELIRE_COMMIT=<empreinte> : la page d'accueil porte <meta name="tirelire-commit">, que
//   verifier.sh compare à COMMIT_ATTENDU (aperçu d'une PR, #141). Sans elle, rien n'est ajouté.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(here, '../..');
const web = path.join(racine, 'apps/web');
const base = normaliserBase(process.env.TIRELIRE_BASE ?? '/');
const sortie = path.join(here, 'dist');
const zip = path.join(here, 'tirelire-hebergement.zip');

// Seule la page déposée est marquée : la construction de l'application (web, APK) ne change pas.
// Le service worker garde en cache la page sous une révision (empreinte md5 de son contenu) : elle
// est recalculée, pour qu'un nouveau commit mette à jour la page gardée par les appareils.
function marquerCommit(dossier, commit) {
  if (!commit) return;
  if (!/^[0-9a-f]{7,64}$/.test(commit)) throw new Error(`TIRELIRE_COMMIT « ${commit} » n'est pas une empreinte de commit.`);
  const page = path.join(dossier, 'index.html');
  const html = readFileSync(page, 'utf8');
  if (!html.includes('</head>')) throw new Error(`${page} : pas de </head> où poser l'empreinte du commit.`);
  const marquee = html.replace('</head>', `  <meta name="tirelire-commit" content="${commit}" />\n  </head>`);
  writeFileSync(page, marquee);
  const sw = path.join(dossier, 'sw.js');
  if (existsSync(sw)) {
    const revision = createHash('md5').update(marquee).digest('hex');
    const avant = readFileSync(sw, 'utf8');
    const apres = avant.replace(/(url:"index\.html",revision:")[0-9a-f]+(")/, `$1${revision}$2`);
    if (apres === avant) console.log('(révision de index.html introuvable dans sw.js : laissée telle quelle)');
    writeFileSync(sw, apres);
  }
  console.log(`Page d'accueil marquée du commit ${commit}.`);
}

function normaliserBase(b) {
  if (!b.startsWith('/')) b = '/' + b;
  if (!b.endsWith('/')) b += '/';
  return b;
}

console.log(`Construction de la PWA avec base « ${base} »…`);
execFileSync('pnpm', ['exec', 'vite', 'build', '--base', base], { cwd: web, stdio: 'inherit', env: { ...process.env, TIRELIRE_BASE: base } });

rmSync(sortie, { recursive: true, force: true });
mkdirSync(sortie, { recursive: true });
cpSync(path.join(web, 'dist'), sortie, { recursive: true });
cpSync(path.join(here, 'serveur'), sortie, { recursive: true });
marquerCommit(sortie, process.env.TIRELIRE_COMMIT);
// Jamais de configuration locale ni de données dans l'archive.
rmSync(path.join(sortie, 'relais.config.php'), { force: true });
for (const f of ['donnees']) {
  const d = path.join(sortie, f);
  if (existsSync(d)) {
    rmSync(d, { recursive: true });
    mkdirSync(d);
    cpSync(path.join(here, 'serveur', f, '.htaccess'), path.join(d, '.htaccess'));
  }
}

rmSync(zip, { force: true });
try {
  execFileSync('zip', ['-qr', zip, '.'], { cwd: sortie, stdio: 'inherit' });
  console.log(`Archive : ${zip}`);
} catch {
  console.log('(zip absent : le dossier dist/ est prêt, sans archive)');
}
console.log(`Dossier prêt : ${sortie} — à déposer par FTP/SFTP dans www${base === '/' ? '' : base.slice(0, -1)}`);
