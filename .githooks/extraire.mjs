// Dépendances d'une extraction (#121). La livraison juge l'arbre commis dans un dossier à part ;
// ce script y recrée les `node_modules` du clone, entrée par entrée, en liens vers leurs cibles
// réelles. Un lien vers un paquet du workspace (`@tirelire/core`…) pointe vers sa copie extraite,
// jamais vers la copie de travail : sinon l'extraction importerait du code non commis.
// Usage : node extraire.mjs <racine du clone> <dossier extrait>
import { existsSync, mkdirSync, readdirSync, readlinkSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const [source, cible] = process.argv.slice(2).map((p) => realpathSync(p));

const reel = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(dirname(p), readlinkSync(p));
  }
};

function lier(depuis, vers) {
  mkdirSync(vers, { recursive: true });
  for (const e of readdirSync(depuis, { withFileTypes: true })) {
    const s = join(depuis, e.name);
    const d = join(vers, e.name);
    if (e.name.startsWith('@') && e.isDirectory()) {
      lier(s, d);
      continue;
    }
    let lien = s;
    if (e.isSymbolicLink()) {
      lien = reel(s);
      const rel = relative(source, lien);
      const duDepot = !rel.startsWith('..') && !rel.split(sep).includes('node_modules');
      if (duDepot) lien = join(cible, rel);
    }
    symlinkSync(lien, d);
  }
}

const dossiers = ['.'];
for (const parent of ['apps', 'packages']) {
  const p = join(source, parent);
  if (!existsSync(p)) continue;
  for (const e of readdirSync(p, { withFileTypes: true })) if (e.isDirectory()) dossiers.push(join(parent, e.name));
}
for (const d of dossiers) {
  const nm = join(source, d, 'node_modules');
  if (existsSync(nm) && existsSync(join(cible, d))) lier(nm, join(cible, d, 'node_modules'));
}
