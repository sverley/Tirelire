// Assemble le dossier à déposer sur l'hébergement : la PWA construite avec le bon préfixe
// d'adresse, le relais PHP, `.htaccess` et `.ovhconfig`. Puis une archive zip.
//   TIRELIRE_BASE=/tirelire/ pnpm --filter @tirelire/hebergement assembler
//   (sans variable : le site est prévu à la racine du domaine ou du sous-domaine)
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(here, '../..');
const web = path.join(racine, 'apps/web');
const base = normaliserBase(process.env.TIRELIRE_BASE ?? '/');
const sortie = path.join(here, 'dist');
const zip = path.join(here, 'tirelire-hebergement.zip');

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
