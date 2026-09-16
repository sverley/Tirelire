/**
 * Harnais d'amorçage de la garde (#58), écrit par la session d'audit de la PR #63.
 *
 * Une garde ne se valide pas avec ses propres tests : ceux de `gardes.test.mjs` ont été écrits par la
 * session qui l'a codée, et la vérification qui juge #63 sort de la branche de #63. Ce harnais part
 * des « Fait quand » de #58 à #61 et de D61, pas du code. Il traite la garde en boîte noire : il copie
 * le dépôt dans un dossier temporaire, y casse ce que les issues désignent, et lance les commandes de
 * la CI et de « Vérifications manuelles » (`node packages/gardes/cli.mjs …`). Pour `pr --github`,
 * GitHub est simulé au niveau de `fetch`, avec l'adresse, le jeton et le fichier d'événement de la CI.
 * Seuls comptent le code de sortie, les messages et ce que la PR simulée donne à lire.
 *
 * Les cibles (entrée à retirer, chemin à modifier, harnais à supprimer) se cherchent dans le registre
 * du jour : le harnais dépend du format du registre, pas de son contenu, et dit quand il ne trouve plus
 * de cible plutôt que de passer. Il juge la garde telle qu'elle est ; il ne la protège pas d'une PR
 * qui la modifierait.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Consigne d'une vérification manuelle, mot pour mot : ce qui suit le tiret cadratin au registre, suite renfoncée comprise. */
function consigneDu(cle, racine = DEPOT) {
  const lignes = readFileSync(join(racine, 'docs/gardes.md'), 'utf8').split(/\r?\n/);
  const cle_ = cle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const i = lignes.findIndex((l) => new RegExp(`^[-*]\\s+\\*\\*Vérification manuelle\\*\\*\\s+·\\s+\`${cle_}\`\\s+—\\s+`).test(l));
  if (i < 0) return '';
  const morceaux = [lignes[i].replace(/^.*?`\s+—\s+/, '').trim()];
  for (let j = i + 1; j < lignes.length && /^\s+\S/.test(lignes[j]); j++) morceaux.push(lignes[j].trim());
  return morceaux.join(' ');
}
/** Tête d'une vérification listée dans la PR, consigne recopiée comme `demander` l'écrit (tranché dans #60). */
const teteVm = (cle) => `- \`${cle}\` · essai${consigneDu(cle) ? ` — ${consigneDu(cle)}` : ''}`;

const CLI = 'packages/gardes/cli.mjs';
const CE_HARNAIS = 'amorcage/livraison-de-la-garde.test.mjs';
const REGISTRE = 'docs/gardes.md';
const INVARIANTS = 'docs/invariants.md';
const CONTRAINTES = 'docs/contraintes.md';
const MODELE = '.github/pull_request_template.md';
const ANALYSE = "Relu par la session d'audit : essai sur un dépôt copié, rien de réel n'est vérifié.";
const RELIRE = "le harnais d'amorçage est à relire";

/** Rien de la CI qui joue ce harnais n'atteint la garde lancée : ni résumé, ni annotations, ni jeton, ni git. */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([cle]) => !/^(GITHUB_|GIT_)/.test(cle) && !['CORPS', 'NODE_TEST_CONTEXT'].includes(cle)),
);

const temporaires = [];
after(() => {
  for (const dossier of temporaires) rmSync(dossier, { recursive: true, force: true });
});

// ─── Dépôt copié et garde lancée ─────────────────────────────────────────────────────────────

const lire = (racine, fichier) => readFileSync(join(racine, fichier), 'utf8');

function ecrire(racine, fichier, texte) {
  mkdirSync(dirname(join(racine, fichier)), { recursive: true });
  writeFileSync(join(racine, fichier), texte);
}

/** Copie de l'arbre de travail, fichiers suivis et nouveaux, sans les ignorés : la garde telle qu'elle serait commitée. */
function copierDepot() {
  const racine = mkdtempSync(join(tmpdir(), 'tirelire-amorcage-'));
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
function garde(racine, args, { env = {}, avant } = {}) {
  const r = spawnSync(process.execPath, [...(avant ? ['--import', pathToFileURL(avant).href] : []), join(racine, CLI), ...args], {
    cwd: racine, env: { ...ENV, ...env }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const rouge = (r, cas) => assert.equal(r.code, 1, `attendu rouge : ${cas}\n${r.sortie}`);
const vert = (r, cas) => assert.equal(r.code, 0, `attendu vert : ${cas}\n${r.sortie}`);
const nomme = (r, ...noms) => {
  for (const nom of noms) assert.ok(r.sortie.includes(nom), `« ${nom} » n'est pas nommé :\n${r.sortie}`);
};

// ─── Registre, lu par son format ─────────────────────────────────────────────────────────────

/** Entrées du registre, de leur titre (`## I7 · …`, `### U1 · …`) au titre suivant, avec leurs puces. */
function entrees(texte) {
  const lignes = texte.split('\n');
  const liste = [];
  const fermer = (i) => {
    if (liste.length && liste.at(-1).fin === undefined) liste.at(-1).fin = i;
  };
  lignes.forEach((ligne, i) => {
    if (!/^#{1,6}\s/.test(ligne)) return;
    fermer(i);
    const titre = ligne.match(/^#{2,3}\s+([IUC]\d+)\s/);
    if (titre) liste.push({ id: titre[1], debut: i });
  });
  fermer(lignes.length);
  return liste.map((e) => {
    const puces = [];
    for (let i = e.debut; i < e.fin; i++) {
      const tete = lignes[i].match(/^[-*]\s+\*\*([^*]+)\*\*\s+·/);
      if (!tete) continue;
      let fin = i + 1;
      while (fin < e.fin && /^\s+\S/.test(lignes[fin])) fin++;
      const avantTiret = lignes.slice(i, fin).join(' ').split(' — ')[0];
      const ids = [...avantTiret.replace(/^[-*]\s+\*\*[^*]+\*\*\s+·/, '').matchAll(/\b([IUC]\d+)\b/g)].map((m) => m[1]);
      puces.push({ etiquette: tete[1].trim(), debut: i, fin, codes: [...avantTiret.matchAll(/`([^`]+)`/g)].map((m) => m[1]), ids });
    }
    const de = (etiquette) => puces.filter((p) => p.etiquette === etiquette);
    const chemins = lignes
      .slice(e.debut, e.fin)
      .filter((l) => /^Chemins\s*:/.test(l))
      .flatMap((l) => [...l.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
    return { ...e, chemins, harnais: de('Harnais'), verifications: de('Vérification manuelle'), renvois: de('Couvert par'), aBatir: de('À bâtir') };
  });
}

const registre = (racine) => entrees(lire(racine, REGISTRE));
const codesDe = (puces) => puces.flatMap((p) => p.codes);

function retirerLignes(texte, ...plages) {
  const lignes = texte.split('\n');
  for (const { debut, fin } of [...plages].sort((a, b) => b.debut - a.debut)) lignes.splice(debut, fin - debut);
  return lignes.join('\n');
}

/** Ajoute un titre avant l'historique du document, s'il en a un. */
function ajouterTitre(texte, titre) {
  const bloc = `${titre}\n\nAjouté par le harnais d'amorçage.\n\n`;
  const i = texte.search(/^## Historique/m);
  return i < 0 ? `${texte.trimEnd()}\n\n${bloc}` : `${texte.slice(0, i)}${bloc}${texte.slice(i)}`;
}

/** Ajoute un usage U99, écrit comme le premier usage défini dans les invariants. */
function ajouterUsage(texte) {
  const lignes = texte.split('\n');
  const i = lignes.findIndex((l) => /^\s*(?:[-*]\s+\*\*|#{2,4}\s+)U\d+\s+·/.test(l));
  assert.ok(i >= 0, `aucun usage U… défini dans ${INVARIANTS} : ${RELIRE}`);
  lignes.splice(i + 1, 0, lignes[i].replace(/U\d+(\s+·)/, 'U99$1'));
  return lignes.join('\n');
}

/** Un chemin que le registre désigne pour une seule entrée : le modifier n'impose que cette entrée. */
function cheminPropre(racine, filtre) {
  const liste = registre(racine);
  const motifs = liste.flatMap((e) => e.chemins.map((motif) => ({ id: e.id, motif })));
  for (const e of liste.filter(filtre)) {
    for (const chemin of e.chemins) {
      if (/[*?]/.test(chemin) || !existsSync(join(racine, chemin))) continue;
      const autres = motifs.filter(
        ({ id, motif }) => id !== e.id && (motif === chemin || (/[*?]/.test(motif) && chemin.startsWith(motif.split(/[*?]/)[0]))),
      );
      if (!autres.length) return { entree: e, chemin };
    }
  }
  return assert.fail(`aucun chemin du registre n'est propre à une entrée qui a une vérification manuelle : ${RELIRE}`);
}

// ─── PR simulées ─────────────────────────────────────────────────────────────────────────────

/** Dépôt git copié : `main` porte le dépôt tel quel, la PR travaille sur `pr`. */
function depotGit() {
  const racine = copierDepot();
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=Audit', '-c', 'user.email=audit@exemple.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: racine, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const commit = (message, fichiers) => {
    for (const [fichier, texte] of Object.entries(fichiers)) ecrire(racine, fichier, texte);
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'main');
  const base = commit('Base', {});
  git('checkout', '-q', '-b', 'pr');
  return { racine, git, commit, base };
}

/** Description au format du modèle et de la PR #63. */
function corps({ touches = 'aucun', masques = 'aucun', verifications = [] } = {}) {
  return [
    "Pour #… : essai du harnais d'amorçage.",
    '',
    '## Ce qui change',
    '',
    'Essai.',
    '',
    '## Invariants et contraintes',
    '',
    `Touchés : ${touches}`,
    `Lien possible masqué : ${masques}`,
    '',
    '### Vérifications manuelles',
    '',
    ...verifications.flatMap(({ cle, analyse = ANALYSE, validee = false }) => [
      teteVm(cle),
      `  - Analyse (audit, 2026-09-11) : ${analyse}`,
      `  - [${validee ? 'x' : ' '}] Validée par un développeur humain`,
    ]),
    '',
  ].join('\n');
}
const listees = (cles, options = {}) => cles.map((cle) => ({ cle, ...options }));

/** `pr --base main` hors GitHub : une case cochée y compte comme validée. */
function prLocale(depot, texte) {
  const fichier = join(depot.racine, '.git', 'corps-amorcage.md');
  writeFileSync(fichier, texte);
  return garde(depot.racine, ['pr', '--base', 'main', '--corps-fichier', fichier]);
}

const cocherTout = (texte) => texte.replace(/\[ \] Validée/g, '[x] Validée');
const decocherTout = (texte) => texte.replace(/\[[xX]\] Validée/g, '[ ] Validée');
const cochee = (texte) => /\[[xX]\] Validée/.test(texte);
const duBot = (e, marque) => e.commentaires.filter((c) => c.user.login === 'github-actions[bot]' && c.body.includes(marque));

/** GitHub simulé au niveau de `fetch`, chargé avant la garde : même adresse, même jeton, même API qu'en CI. */
const FAUX_GITHUB = `
import { readFileSync, writeFileSync } from 'node:fs';
const fichier = process.env.FAUX_GITHUB;
const pause = globalThis.setTimeout;
// Les relectures espacées de la vérification n'apprennent rien ici : elles ne font plus attendre.
globalThis.setTimeout = (fn, ms, ...args) => pause(fn, ms >= 1000 ? 0 : ms, ...args);
globalThis.fetch = async (adresse, options = {}) => {
  const etat = JSON.parse(readFileSync(fichier, 'utf8'));
  const methode = options.method || 'GET';
  const url = new URL(adresse);
  const repondre = (statut, donnees) => {
    writeFileSync(fichier, JSON.stringify(etat));
    return new Response(JSON.stringify(donnees), { status: statut, headers: { 'Content-Type': 'application/json' } });
  };
  etat.appels.push(methode + ' ' + url.pathname + url.search);
  if (url.origin !== 'https://api.github.com') return repondre(404, { message: 'Hors de GitHub' });
  if ((options.headers || {}).Authorization !== 'Bearer ' + etat.jeton) return repondre(401, { message: 'Bad credentials' });
  const m = url.pathname.match(/^\\/repos\\/([^/]+\\/[^/]+)\\/(pulls|issues)\\/(\\d+)(\\/comments)?$/);
  if (!m || m[1] !== etat.depot || Number(m[3]) !== etat.pr.number) return repondre(404, { message: 'Not Found' });
  const envoye = options.body ? JSON.parse(options.body) : {};
  if (m[2] === 'pulls' && !m[4] && methode === 'GET') return repondre(200, etat.pr);
  if (m[2] === 'pulls' && !m[4] && methode === 'PATCH') { etat.pr.body = envoye.body; return repondre(200, etat.pr); }
  if (m[2] === 'issues' && m[4] && methode === 'GET') {
    const page = Number(url.searchParams.get('page') || 1);
    const parPage = Number(url.searchParams.get('per_page') || 30);
    return repondre(200, etat.commentaires.slice((page - 1) * parPage, page * parPage));
  }
  if (m[2] === 'issues' && m[4] && methode === 'POST') {
    const commentaire = { id: etat.commentaires.length + 1, user: { login: 'github-actions[bot]', type: 'Bot' }, body: envoye.body, created_at: new Date().toISOString() };
    etat.commentaires.push(commentaire);
    return repondre(201, commentaire);
  }
  return repondre(405, { message: 'Non simulé' });
};
`;

function githubSimule(depot, pr) {
  const avant = join(depot.racine, '.git', 'faux-github.mjs');
  const fichier = join(depot.racine, '.git', 'faux-github.json');
  writeFileSync(avant, FAUX_GITHUB);
  writeFileSync(fichier, JSON.stringify({ depot: 'sverley/Tirelire', jeton: 'jeton-simule', pr, commentaires: [], appels: [] }));
  let n = 0;
  const etat = () => JSON.parse(readFileSync(fichier, 'utf8'));
  const modifier = (changer) => {
    const e = etat();
    changer(e);
    writeFileSync(fichier, JSON.stringify(e));
  };
  const evenement = (action, { changes, tete } = {}) => {
    const e = etat();
    const pull_request = structuredClone(e.pr);
    if (tete) pull_request.head.sha = tete;
    const chemin = join(depot.racine, '.git', `evenement-${++n}.json`);
    writeFileSync(chemin, JSON.stringify({ action, number: e.pr.number, pull_request, sender: { login: 'sverley', type: 'User' }, ...(changes ? { changes } : {}) }));
    return garde(depot.racine, ['pr', '--github'], {
      avant,
      env: { GITHUB_EVENT_PATH: chemin, GITHUB_REPOSITORY: e.depot, GITHUB_TOKEN: e.jeton, FAUX_GITHUB: fichier },
    });
  };
  /** Un humain modifie la description : GitHub envoie « edited » avec l'ancienne. */
  const editer = (transformer, options = {}) => {
    const from = etat().pr.body;
    modifier((e) => {
      e.pr.body = transformer(from);
    });
    return evenement('edited', { changes: { body: { from } }, ...options });
  };
  const pousser = (message, fichiers) => {
    const sha = depot.commit(message, fichiers);
    modifier((e) => {
      e.pr.head.sha = sha;
    });
    return sha;
  };
  return { etat, modifier, evenement, pousser, cocher: (options) => editer(cocherTout, options), decocher: () => editer(decocherTout) };
}

// ─── #59 et #58 : la couverture ──────────────────────────────────────────────────────────────

test("amorçage · le dépôt copié tient sa garde, sinon rien de ce qui suit ne prouve quoi que ce soit", () => {
  vert(garde(copierDepot(), ['couverture']), 'couverture du dépôt tel quel');
});

test('#59 · retirer une entrée du registre fait échouer la couverture, en nommant ce qui manque', () => {
  const racine = copierDepot();
  const texte = lire(racine, REGISTRE);
  const derniere = entrees(texte).at(-1);
  ecrire(racine, REGISTRE, retirerLignes(texte, derniere));
  const r = garde(racine, ['couverture']);
  rouge(r, `entrée ${derniere.id} retirée`);
  nomme(r, derniere.id);
});

test('#58 · un invariant, un usage ou une contrainte ajouté sans entrée se voit aussitôt', () => {
  for (const [fichier, id, ajouter] of [
    [INVARIANTS, 'I99', (t) => ajouterTitre(t, "## I99 · Invariant ajouté par le harnais d'amorçage")],
    [INVARIANTS, 'U99', ajouterUsage],
    [CONTRAINTES, 'C99', (t) => ajouterTitre(t, "## C99 · Contrainte ajoutée par le harnais d'amorçage")],
  ]) {
    const racine = copierDepot();
    ecrire(racine, fichier, ajouter(lire(racine, fichier)));
    const r = garde(racine, ['couverture']);
    rouge(r, `${id} ajouté sans entrée`);
    nomme(r, id);
  }
});

test("#59 · un harnais cité qui n'existe plus fait échouer la couverture, en le nommant", () => {
  const racine = copierDepot();
  const harnais = codesDe(registre(racine).flatMap((e) => e.harnais)).find((c) => existsSync(join(racine, c)));
  assert.ok(harnais, `aucun harnais cité dans le registre : ${RELIRE}`);
  rmSync(join(racine, harnais));
  const r = garde(racine, ['couverture']);
  rouge(r, `${harnais} supprimé`);
  nomme(r, harnais);
});

test('D61 · un harnais seulement prévu ne garde rien, un renvoi en boucle non plus', () => {
  let racine = copierDepot();
  const texte = lire(racine, REGISTRE);
  const cible = entrees(texte).find((e) => e.aBatir.length && e.verifications.length && !e.harnais.length && !e.renvois.length);
  assert.ok(cible, `aucune entrée gardée par vérification manuelle seule avec un harnais à bâtir : ${RELIRE}`);
  ecrire(racine, REGISTRE, retirerLignes(texte, ...cible.verifications));
  let r = garde(racine, ['couverture']);
  rouge(r, `${cible.id} gardé seulement par « À bâtir »`);
  nomme(r, cible.id);

  racine = copierDepot();
  ecrire(racine, INVARIANTS, ajouterTitre(lire(racine, INVARIANTS), '## I99 · Invariant en boucle'));
  ecrire(racine, CONTRAINTES, ajouterTitre(lire(racine, CONTRAINTES), '## C99 · Contrainte en boucle'));
  ecrire(
    racine,
    REGISTRE,
    `${lire(racine, REGISTRE).trimEnd()}\n\n## I99 · Invariant en boucle\n\n- **Couvert par** · C99 — renvoi en boucle.\n\n## C99 · Contrainte en boucle\n\n- **Couvert par** · I99 — renvoi en boucle.\n`,
  );
  r = garde(racine, ['couverture']);
  rouge(r, "I99 et C99 ne se gardent que l'un par l'autre");
  nomme(r, 'I99');
});

test('#59 · la couverture tourne dans les tests du paquet, donc au commit et dans la CI', () => {
  const racineJson = JSON.parse(lire(DEPOT, 'package.json'));
  assert.match(racineJson.scripts.test, /pnpm -r test|@tirelire\/gardes/, 'pnpm test ne lance pas les tests de la garde');
  // Depuis #120 (D73), le crochet est suivi dans .githooks et lance la garde quand le commit touche la
  // garde ou les règles ; l'amorçage de #120 le vérifie en le jouant.
  const preCommit = join(DEPOT, '.githooks', 'pre-commit');
  const crochet = existsSync(preCommit) ? readFileSync(preCommit, 'utf8') : '';
  assert.match(crochet, /@tirelire\/gardes|packages\/gardes/, 'le crochet de pré-commit ne lance pas la garde');
  const ci = lire(DEPOT, '.github/workflows/ci.yml');
  assert.match(ci, /^\s+push:/m, 'la CI ne tourne pas sur les push');
  assert.match(ci, /^\s+pull_request:/m, 'la CI ne tourne pas sur les PR');
  assert.match(ci, /run:\s*pnpm (-r )?test\b/, 'la CI ne lance pas pnpm test');

  // Boîte noire : un test du paquet qui passe sur le dépôt copié échoue dès qu'une entrée manque.
  // D'autres harnais d'audit peuvent être rouges à dessein : seuls comptent les tests qui changent d'état.
  const script = JSON.parse(lire(DEPOT, 'packages/gardes/package.json')).scripts.test;
  const racine = copierDepot();
  rmSync(join(racine, CE_HARNAIS)); // pas de récursion
  const bilan = () => {
    const r = spawnSync('sh', ['-c', script], { cwd: join(racine, 'packages/gardes'), env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const tests = new Map();
    for (const ligne of String(r.stdout).split('\n')) {
      const tap = ligne.match(/^(not ok|ok) \d+ - (.+?)(?: # .*)?$/);
      const spec = ligne.match(/^(✔|✖) (.+?) \(\d+(?:\.\d+)?ms\)$/);
      if (tap) tests.set(tap[2], tap[1] === 'ok');
      else if (spec) tests.set(spec[2], spec[1] === '✔');
    }
    assert.ok(tests.size, `aucun résultat lisible dans la sortie des tests du paquet : ${RELIRE}\n${String(r.stdout).slice(-2000)}`);
    return tests;
  };
  const intact = bilan();
  const texte = lire(racine, REGISTRE);
  const derniere = entrees(texte).at(-1);
  ecrire(racine, REGISTRE, retirerLignes(texte, derniere));
  const ampute = bilan();
  const rougis = [...intact].filter(([nom, passe]) => passe && ampute.get(nom) === false);
  assert.ok(rougis.length, `aucun test du paquet ne rougit quand ${derniere.id} n'a plus d'entrée`);
});

// ─── #60 : chaque PR déclare et demande ──────────────────────────────────────────────────────

test('#60 · la vérification des PR se relance à l’ouverture, à chaque push et quand la description change', () => {
  const flux = lire(DEPOT, '.github/workflows/verifications.yml');
  const types = flux.match(/pull_request(?:_target)?:\s*\n\s*types:\s*\[([^\]]*)\]/);
  assert.ok(types, 'déclencheur des PR introuvable dans verifications.yml');
  const liste = types[1].split(',').map((t) => t.trim());
  for (const t of ['opened', 'edited', 'synchronize', 'reopened']) assert.ok(liste.includes(t), `la vérification ne se relance pas sur « ${t} »`);
  assert.match(flux, /node packages\/gardes\/cli\.mjs pr --github/);
});

test('#60 · une PR sans déclaration est rouge, le modèle laissé tel quel aussi ; déclarée sans rien à vérifier, elle passe', () => {
  const depot = depotGit();
  depot.commit('Une note', { 'docs/essai-amorcage.md': '# Essai\n' });
  rouge(prLocale(depot, "Pour #… : essai.\n\n## Ce qui change\n\nUne note.\n"), 'aucune section « Invariants et contraintes »');
  rouge(prLocale(depot, lire(depot.racine, MODELE)), 'modèle laissé tel quel');
  vert(prLocale(depot, corps()), 'rien de touché, rien de masqué, aucun chemin gardé modifié');
});

test('#60, #61 · un chemin gardé impose sa déclaration, puis l’analyse, puis la validation de ses vérifications', () => {
  const depot = depotGit();
  const { entree, chemin } = cheminPropre(depot.racine, (e) => e.verifications.length && !e.renvois.length);
  const vms = codesDe(entree.verifications);
  depot.commit('Code touché', { [chemin]: `${lire(depot.racine, chemin)}\n// essai du harnais d'amorçage\n` });
  let r = prLocale(depot, corps());
  rouge(r, `${chemin} modifié sans déclarer ${entree.id}`);
  nomme(r, entree.id);
  r = prLocale(depot, corps({ touches: entree.id }));
  rouge(r, `${entree.id} déclaré sans ses vérifications`);
  nomme(r, ...vms);
  const avec = (options) => corps({ touches: entree.id, verifications: listees(vms, options) });
  rouge(prLocale(depot, avec({ analyse: 'à écrire' })), 'analyse à écrire');
  rouge(prLocale(depot, avec({ analyse: 'à écrire', validee: true })), 'case cochée sans analyse');
  rouge(prLocale(depot, avec({})), 'analysée, pas validée');
  vert(prLocale(depot, avec({ validee: true })), 'analysée et validée');
});

test('#58 · un lien possible masqué demande aussi ses vérifications', () => {
  const depot = depotGit();
  depot.commit('Une note', { 'docs/essai-amorcage.md': '# Essai\n' });
  const e = registre(depot.racine).find((x) => x.verifications.length && !x.renvois.length);
  const vms = codesDe(e.verifications);
  const r = prLocale(depot, corps({ masques: e.id }));
  rouge(r, `${e.id} déclaré comme lien masqué sans ses vérifications`);
  nomme(r, ...vms);
  vert(prLocale(depot, corps({ masques: e.id, verifications: listees(vms, { validee: true }) })), 'lien masqué analysé et validé');
});

test('D61 · retirer une vérification manuelle ou un harnais du registre demande la même validation', () => {
  for (const genre of ['Vérification manuelle', 'Harnais']) {
    const depot = depotGit();
    const texte = lire(depot.racine, REGISTRE);
    const e = entrees(texte).find((x) => x.harnais.length && x.verifications.length && !x.renvois.length);
    assert.ok(e, `aucune entrée gardée à la fois par un harnais et une vérification manuelle : ${RELIRE}`);
    const puce = genre === 'Harnais' ? e.harnais[0] : e.verifications[0];
    const cles = genre === 'Harnais' ? puce.codes.map((c) => `${e.id} · ${c}`) : puce.codes;
    depot.commit(`Garde retirée de ${e.id}`, { [REGISTRE]: retirerLignes(texte, puce) });
    const r = prLocale(depot, corps());
    rouge(r, `${genre} de ${e.id} retiré sans être listé`);
    nomme(r, ...cles);
    // Modifier le registre, c'est changer une règle (#64) : la section préparée porte la garde
    // retirée et ce que la PR demande par ailleurs ; on la remplit sans rien présumer de sa forme.
    const d = garde(depot.racine, ['demander', '--base', 'main']);
    vert(d, 'demander');
    for (const cle of cles) assert.ok(d.sortie.includes(`\`${cle}\``), `« demander » ne demande pas ${cle} : ${RELIRE}\n${d.sortie}`);
    const preparee = `Pour #… : essai.\n\n## Ce qui change\n\nEssai.\n\n${d.sortie.trim()}\n`;
    const remplie = cocherTout(
      preparee
        .replace(/Touchés : à analyser/, 'Touchés : aucun')
        .replace(/Lien possible masqué : à analyser/, 'Lien possible masqué : aucun')
        .replace(/: à écrire/g, `: ${ANALYSE}`),
    );
    vert(prLocale(depot, remplie), `${genre} retiré, listé, analysé, validé`);
  }
});

test("D61 · déclarer une entrée couverte par d'autres demande aussi leurs vérifications, de proche en proche", () => {
  const depot = depotGit();
  const liste = registre(depot.racine);
  const parId = new Map(liste.map((e) => [e.id, e]));
  const demandees = (id, vues = new Set()) => {
    const e = parId.get(id);
    if (!e || vues.has(id)) return [];
    vues.add(id);
    return [...codesDe(e.verifications), ...e.renvois.flatMap((p) => p.ids).flatMap((c) => demandees(c, vues))];
  };
  const e = liste.find((x) => x.renvois.flatMap((p) => p.ids).some((c) => demandees(c).length));
  assert.ok(e, `aucune entrée couverte par des entrées qui ont des vérifications manuelles : ${RELIRE}`);
  const vms = [...new Set(demandees(e.id))];
  depot.commit('Une note', { 'docs/essai-amorcage.md': '# Essai\n' });
  const r = prLocale(depot, corps({ touches: e.id }));
  rouge(r, `${e.id} déclaré sans les vérifications des entrées qui le couvrent`);
  nomme(r, ...vms);
  vert(prLocale(depot, corps({ touches: e.id, verifications: listees(vms, { validee: true }) })), `${e.id} et ses renvois analysés et validés`);
});

test('CLAUDE.md · la section préparée par « demander » reste rouge tant que l’analyse n’est pas écrite', () => {
  const depot = depotGit();
  const { chemin } = cheminPropre(depot.racine, (e) => e.verifications.length && !e.renvois.length);
  depot.commit('Code touché', { [chemin]: `${lire(depot.racine, chemin)}\n// essai du harnais d'amorçage\n` });
  const d = garde(depot.racine, ['demander', '--base', 'main']);
  vert(d, 'demander');
  const preparee = `Pour #… : essai.\n\n## Ce qui change\n\nCode touché.\n\n${d.sortie.trim()}\n`;
  rouge(prLocale(depot, preparee), 'section préparée, analyse à écrire');
  const remplie = cocherTout(preparee.replace(/Lien possible masqué : à analyser/, 'Lien possible masqué : aucun').replace(/: à écrire/g, `: ${ANALYSE}`));
  vert(prLocale(depot, remplie), 'section préparée, analysée et validée');
});

// ─── #61 : analyse et validation, sur GitHub ─────────────────────────────────────────────────

test("#61 · sur GitHub, une validation s'enregistre datée et attribuée, et ne tient qu'au code validé", () => {
  const depot = depotGit();
  const { entree, chemin } = cheminPropre(depot.racine, (e) => e.verifications.length && !e.renvois.length);
  const vms = codesDe(entree.verifications);
  const code = (note) => ({ [chemin]: `${lire(depot.racine, chemin)}\n// ${note}\n` });
  const h1 = depot.commit('Code touché', code('première modification'));
  const gh = githubSimule(depot, {
    number: 7,
    body: cocherTout(corps({ touches: entree.id, verifications: listees(vms) })),
    head: { sha: h1, ref: 'pr' },
    base: { sha: depot.base, ref: 'main' },
  });

  // D61 : une case cochée dès l'ouverture ne vaut rien.
  rouge(gh.evenement('opened'), "case cochée dans la description d'ouverture");
  assert.equal(duBot(gh.etat(), 'Validation enregistrée').length, 0, "une case cochée à l'ouverture a été enregistrée");
  if (cochee(gh.etat().pr.body)) gh.decocher();

  // #61 : cochée par un humain, la validation s'enregistre, datée et attribuée, sur la tête relue.
  vert(gh.cocher(), 'case cochée par un humain après analyse');
  const [enregistrement] = duBot(gh.etat(), 'Validation enregistrée');
  assert.ok(enregistrement, 'aucun commentaire « Validation enregistrée »');
  for (const attendu of ['sverley', h1.slice(0, 7), ...vms]) assert.ok(enregistrement.body.includes(attendu), `« ${attendu} » manque :\n${enregistrement.body}`);
  assert.match(enregistrement.body, /\d{4}-\d{2}-\d{2}/, "l'enregistrement n'est pas daté");

  // D61 : documentation, harnais et fusion propre de la cible laissent la validation en place.
  gh.pousser('Une note', { 'docs/essai-amorcage.md': '# Essai\n' });
  vert(gh.evenement('synchronize'), 'commit de documentation après validation');
  gh.pousser('Un harnais', { 'packages/core/test/essai-amorcage.test.ts': '// essai\n' });
  vert(gh.evenement('synchronize'), 'commit de harnais après validation');
  const gardes = new Set(registre(depot.racine).flatMap((e) => e.chemins));
  const ailleurs = depot.git('ls-files', 'packages/core/src').split('\n').find((f) => f.endsWith('.ts') && f !== chemin && !gardes.has(f));
  assert.ok(ailleurs, `aucun fichier de code hors du registre dans packages/core/src : ${RELIRE}`);
  depot.git('checkout', '-q', 'main');
  const cible = depot.commit('La cible avance', { [ailleurs]: `${lire(depot.racine, ailleurs)}\n// la cible avance\n` });
  depot.git('checkout', '-q', 'pr');
  depot.git('merge', '-q', '--no-edit', 'main');
  const fusion = depot.git('rev-parse', 'HEAD');
  gh.modifier((e) => {
    e.pr.head.sha = fusion;
    e.pr.base.sha = cible;
  });
  vert(gh.evenement('synchronize'), 'fusion propre de la branche cible');
  assert.ok(cochee(gh.etat().pr.body), 'la case a été décochée sans raison');

  // D61 : un commit de code annule ; la case se décoche et un commentaire dit pourquoi.
  const h5 = gh.pousser('Code encore', code('deuxième modification'));
  rouge(gh.evenement('synchronize'), 'commit de code après validation');
  assert.ok(!cochee(gh.etat().pr.body), 'la case annulée est restée cochée');
  assert.ok(duBot(gh.etat(), 'Validation annulée').length, 'aucun commentaire « Validation annulée »');

  // Décision 10 : un enregistrement imité avec le compte du porteur ne valide rien.
  gh.modifier((e) => {
    const imite = enregistrement.body.replaceAll(h1, h5).replaceAll(h1.slice(0, 7), h5.slice(0, 7));
    e.commentaires.push({ id: 999, user: { login: 'sverley', type: 'User' }, body: imite, created_at: new Date().toISOString() });
    e.pr.body = cocherTout(e.pr.body);
  });
  rouge(gh.evenement('edited', { changes: { title: { from: 'Ancien titre' } } }), 'enregistrement imité par le compte du porteur');
  if (cochee(gh.etat().pr.body)) gh.decocher();
  vert(gh.cocher(), 'case recochée après relecture');

  // Décision 10 : une coche croisée avec un push n'enregistre rien pour un code que personne n'a relu.
  const h6 = gh.pousser('Code pendant la relecture', code('troisième modification'));
  rouge(gh.evenement('synchronize'), 'commit de code après la seconde validation');
  gh.pousser('Code poussé pendant la coche', code('quatrième modification'));
  const avantCourse = duBot(gh.etat(), 'Validation enregistrée').length;
  rouge(gh.cocher({ tete: h6 }), 'case cochée sur une tête déjà dépassée');
  assert.equal(duBot(gh.etat(), 'Validation enregistrée').length, avantCourse, 'une validation a été enregistrée pour une tête dépassée');
  rouge(gh.evenement('synchronize'), 'case cochée sans enregistrement pour la tête poussée');
  assert.ok(!cochee(gh.etat().pr.body), 'une case sans enregistrement est restée cochée après le push');

  // D61 : changer de branche cible annule la validation.
  vert(gh.cocher(), 'case recochée sur la tête poussée');
  const ancienne = gh.etat().pr.base;
  gh.modifier((e) => {
    e.pr.base.ref = 'autre';
  });
  rouge(gh.evenement('edited', { changes: { base: { ref: { from: ancienne.ref }, sha: { from: ancienne.sha } } } }), 'branche cible changée après validation');
});

// ─── #58 : la règle écrite pour les sessions ─────────────────────────────────────────────────

test('#58, #61 · CLAUDE.md écrit la règle : registre, pas de coche sans autorisation explicite, pas de fusion au rouge', () => {
  const regle = lire(DEPOT, 'CLAUDE.md');
  assert.match(regle, /docs\/gardes\.md/);
  assert.match(regle, /ne coche jamais[^.]*sans une autorisation explicite/i);
  assert.match(regle, /ne fusionne jamais[^.]*rouge/i);
});
