// @vitest-environment jsdom
/**
 * Tests du codeur de #421 : ce que vérifiait, dans le navigateur, le harnais d'audit de #142
 * (`navigateur/version-affichee.test.ts`, « La webapp affiche sa version et signale qu'une mise à jour est prête ») sur
 * le nom de chaque sorte de build (D83, « Livraison ») et le vouvoiement de ses textes (D85), que #421 retire du
 * navigateur, se vérifie ici sans navigateur. Chaque titre dit le point du « Fait quand » de #142 qu'il vérifie, et le
 * numéro du test retiré dans la table de #421 (« version-affichee 1 » à « version-affichee 7 »).
 *
 * **D'où part chaque nom.** Pour chaque événement — le tag `v0.1` poussé, la version forcée que `version-forcee.yml`
 * lance sur `main`, un push sur `main`, la PR 12 —, `ci.yml`, tel qu'il est écrit, est joué à blanc
 * (`packages/gardes/workflow-a-blanc.mjs`) : l'étape qui assemble le site que la CI dépose
 * (`pnpm --filter @tirelire/hebergement assembler`) est celle, unique, qui passe ses conditions ; son environnement est
 * celui d'un exécuteur de GitHub pour cet événement, plus ce que son job et l'étape posent, interpolé. Ce qu'un job
 * amont lui passe (`needs.<job>.outputs`) vient des étapes de ce job, jouées pour de vrai : le nom d'une version forcée
 * est ce que `version-forcee.mjs nom` écrit, dans un petit dépôt git d'essai à l'historique connu — `v0.1` sur C0,
 * `main` en C1, la tête P d'une PR et sa fusion M. Le build local part d'une construction sans l'environnement de la CI.
 *
 * **Ce qui se lit.** La version que la construction tire de cet environnement : `vite.config.ts`, chargé sous cet
 * environnement, et la valeur qu'il fixe (`__TIRELIRE_VERSION__`) ; puis l'application montée sous jsdom (`ecran.ts`)
 * avec cette valeur, et ce que l'écran Plus en dit. Le test échoue si `ci.yml` cesse de donner à l'étape ce qui fait le
 * nom, ou si l'écran cesse de le dire. Le script seul (le nom d'une version forcée) est vérifié par
 * `packages/gardes/version-forcee.test.mjs` ; la version qui se lit en deux gestes depuis l'accueil, celle qui tourne,
 * le signal de mise à jour et ce qu'il laisse, hors ligne et dans chaque aperçu, restent au navigateur
 * (`navigateur/version-affichee.test.ts`).
 *
 * Le vouvoiement (D85) se lit dans le signal de mise à jour tel que l'application le montre quand une version plus
 * récente attend (`miseAJour.prete`), ses commandes, et la ligne de la version que Plus montre pour `main`, aux formes
 * que repérait le test retiré : son expression `TUTOIEMENT`, recopiée.
 */
// @ts-ignore — module JavaScript sans déclaration de types
import { besoins, interpoler, jobs, jouer, commande } from '../../../packages/gardes/workflow-a-blanc.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { VersionConstruite } from '../src/lib/version';
import { allerA, ouvrirLApplication, rendu, t, tous } from './ecran';

const DEPOT = resolve(process.cwd(), '../..');
const WORKFLOW = '.github/workflows/ci.yml';
const SCRIPT_DE_LA_VERSION_FORCEE = 'packages/gardes/version-forcee.mjs';
/** La version publiée du dépôt d'essai, posée sur C0. */
const TAG = 'v0.1';
/** Le numéro de la PR jouée. */
const PR = 12;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Le dépôt d'essai : un historique connu, où le script de la version forcée lit ses tags
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface Bac {
  dossier: string;
  c0: string;
  c1: string;
  p: string;
  m: string;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();
}

function creerLeBac(): Bac {
  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-version-'));
  mkdirSync(dirname(join(dossier, SCRIPT_DE_LA_VERSION_FORCEE)), { recursive: true });
  copyFileSync(join(DEPOT, SCRIPT_DE_LA_VERSION_FORCEE), join(dossier, SCRIPT_DE_LA_VERSION_FORCEE));
  git(dossier, 'init', '-q', '-b', 'main');
  git(dossier, 'add', '-A');
  git(dossier, 'commit', '-q', '-m', 'C0 : la version publiée');
  const c0 = git(dossier, 'rev-parse', 'HEAD');
  git(dossier, 'tag', TAG);
  git(dossier, 'commit', '-q', '--allow-empty', '-m', 'C1 : main avance');
  const c1 = git(dossier, 'rev-parse', 'HEAD');
  git(dossier, 'checkout', '-q', '-b', 'pr');
  git(dossier, 'commit', '-q', '--allow-empty', '-m', 'P : la tête de la PR');
  const p = git(dossier, 'rev-parse', 'HEAD');
  git(dossier, 'checkout', '-q', 'main');
  git(dossier, 'checkout', '-q', '-b', 'fusion');
  git(dossier, 'merge', '-q', '--no-ff', '-m', 'M : la fusion de la PR', 'pr');
  const m = git(dossier, 'rev-parse', 'HEAD');
  git(dossier, 'checkout', '-q', 'main');
  return { dossier, c0, c1, p, m };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ci.yml joué à blanc : l'environnement de l'étape qui assemble le site déposé
// ─────────────────────────────────────────────────────────────────────────────────────────────

type Sorte = 'tag' | 'forcée' | 'main' | 'pr';

/** Le contexte de l'événement, comme GitHub le donne à `ci.yml`. */
function evenement(bac: Bac, sorte: Sorte) {
  const commun = { vars: {}, secrets: {}, steps: {}, needs: {}, inputs: {} as Record<string, unknown> };
  const push = (ref: string, nom: string, type: string, sha: string) => ({
    ...commun,
    github: { event_name: 'push', ref, ref_name: nom, ref_type: type, sha, head_ref: '', base_ref: '', repository: 'sverley/Tirelire', event: { ref, after: sha } },
  });
  if (sorte === 'tag') return push(`refs/tags/${TAG}`, TAG, 'tag', bac.c0);
  if (sorte === 'main') return push('refs/heads/main', 'main', 'branch', bac.c1);
  if (sorte === 'forcée') {
    // `version-forcee.yml` appelle `ci.yml` : le contexte `github` est celui du déclenchement manuel, sur `main`.
    const declenchement = readFileSync(join(DEPOT, '.github/workflows/version-forcee.yml'), 'utf8');
    expect(declenchement, 'version-forcee.yml n’appelle plus ci.yml en version forcée').toMatch(/^ {6}version_forcee:\s*true\s*$/m);
    return {
      ...commun,
      inputs: { version_forcee: true },
      github: { event_name: 'workflow_dispatch', ref: 'refs/heads/main', ref_name: 'main', ref_type: 'branch', sha: bac.c1, head_ref: '', base_ref: '', repository: 'sverley/Tirelire', event: {} },
    };
  }
  const pull = { number: PR, draft: false, head: { sha: bac.p, ref: 'codage/12-essai' }, base: { ref: 'main' } };
  return {
    ...commun,
    github: { event_name: 'pull_request', ref: `refs/pull/${PR}/merge`, ref_name: `${PR}/merge`, ref_type: 'branch', sha: bac.m, head_ref: 'codage/12-essai', base_ref: 'main', repository: 'sverley/Tirelire', event: { action: 'opened', number: PR, pull_request: pull } },
  };
}

/** Les variables qu'un exécuteur de GitHub pose pour cet événement. */
function variablesDeLExecuteur(github: Record<string, unknown>): Record<string, string> {
  const texte = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  return {
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'sverley/Tirelire',
    GITHUB_EVENT_NAME: texte(github['event_name']),
    GITHUB_REF: texte(github['ref']),
    GITHUB_REF_NAME: texte(github['ref_name']),
    GITHUB_REF_TYPE: texte(github['ref_type']),
    GITHUB_SHA: texte(github['sha']),
    GITHUB_HEAD_REF: texte(github['head_ref']),
    GITHUB_BASE_REF: texte(github['base_ref']),
  };
}

/** L'environnement d'un poste : rien de ce que pose la CI, ni des lanceurs de test. */
function environnementDePoste(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /^(GITHUB_|RUNNER_|TIRELIRE_|npm_|PNPM_SCRIPT|INIT_CWD$|CI$|NODE_OPTIONS$|VITEST|VITE_)/.test(k)) continue;
    env[k] = v;
  }
  return env;
}

const sansCommentaire = (v: string) => (/\$\{\{/.test(v) ? v : v.replace(/\s+#.*$/, ''));

/** Les entrées `clé: valeur` d'une section, sous la ligne `marge` + `clé:`, au renfoncement `marge + 2`. */
function section(lignes: string[], marge: number, cle: string): Record<string, string> {
  const debut = lignes.findIndex((l) => new RegExp(`^(?: {${marge}}|(?: {${marge - 2}}- ))${cle}:\\s*$`).test(l));
  if (debut < 0) return {};
  const sortie: Record<string, string> = {};
  for (const l of lignes.slice(debut + 1)) {
    if (!l.trim() || l.trim().startsWith('#')) continue;
    const m = l.match(new RegExp(`^ {${marge + 2}}([A-Za-z0-9_-]+):\\s*(.*)$`));
    if (m) sortie[m[1]!] = sansCommentaire(m[2]!);
    else if (!new RegExp(`^ {${marge + 3},}`).test(l)) break;
  }
  return sortie;
}

interface Job {
  nom: string;
  lignes: string[];
  tourne: boolean;
  joués: Array<{ lignes: string[]; texte: string }>;
}

/** Ce que les étapes d'un job, jouées pour de vrai dans le dépôt d'essai, écrivent dans `GITHUB_OUTPUT`. */
function sortiesDesEtapes(bac: Bac, job: Job, ctx: { github: Record<string, unknown> }, ids: string[]): Record<string, { outputs: Record<string, string> }> {
  const steps: Record<string, { outputs: Record<string, string> }> = {};
  for (const id of ids) {
    const etape = job.joués.find((é) => new RegExp(`^ +(?:- )?id:\\s*${id}\\s*$`, 'm').test(é.texte));
    if (!etape) continue;
    const run = section(etape.lignes, 8, 'run');
    const ligne = etape.lignes.find((l) => /^ {8}run:\s*\S/.test(l) || /^ {6}- run:\s*\S/.test(l));
    const script = Object.keys(run).length ? '' : interpoler(ligne!.replace(/^\s*(?:- )?run:\s*/, ''), ctx);
    expect(script, `l’étape « ${id} » du job « ${job.nom} » n’a pas de commande d’une ligne à jouer`).not.toBe('');
    const sortie = join(bac.dossier, '.sortie');
    writeFileSync(sortie, '');
    execFileSync('bash', ['-e', '-c', script], {
      cwd: bac.dossier,
      env: { ...environnementDePoste(), ...variablesDeLExecuteur(ctx.github), GITHUB_OUTPUT: sortie, GITHUB_STEP_SUMMARY: join(bac.dossier, '.resume') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const outputs: Record<string, string> = {};
    for (const l of readFileSync(sortie, 'utf8').split('\n')) {
      const m = l.match(/^([^=]+)=(.*)$/);
      if (m) outputs[m[1]!] = m[2]!;
    }
    steps[id] = { outputs };
  }
  return steps;
}

/**
 * L'environnement de l'étape qui assemble le site que la CI dépose, pour cet événement : celui de l'exécuteur, puis
 * ce que son job et l'étape posent, interpolé ; les sorties des jobs dont il dépend viennent de leurs étapes.
 */
function environnementDeLAssemblage(bac: Bac, sorte: Sorte): Record<string, string> {
  const yaml = readFileSync(join(DEPOT, WORKFLOW), 'utf8').replace(/\r\n?/g, '\n');
  const ctx = evenement(bac, sorte);
  const partie = jouer(yaml, ctx) as Job[];
  const assemblages = partie.flatMap((j) => j.joués.filter((é) => /\bhebergement\s+assembler\b/.test(commande(é))).map((é) => ({ job: j, etape: é })));
  expect(assemblages.map((a) => a.job.nom), `${WORKFLOW} : pour « ${sorte} », une et une seule étape doit assembler le site déposé`).toHaveLength(1);
  const { job, etape } = assemblages[0]!;

  const needs: Record<string, { outputs: Record<string, string> }> = {};
  for (const amont of besoins(job.lignes) as string[]) {
    const j = partie.find((x) => x.nom === amont)!;
    const declarees = section(j.lignes, 4, 'outputs');
    const ids = [...new Set(Object.values(declarees).flatMap((v) => [...v.matchAll(/steps\.(\w+)\.outputs/g)].map((m) => m[1]!)))];
    const ctxJob = { ...ctx, steps: j.tourne ? sortiesDesEtapes(bac, j, ctx, ids) : {} };
    needs[amont] = { outputs: Object.fromEntries(Object.entries(declarees).map(([k, v]) => [k, interpoler(v, ctxJob)])) };
  }
  const ctxEtape = { ...ctx, needs };
  const env = { ...environnementDePoste(), ...variablesDeLExecuteur(ctx.github) };
  for (const [k, v] of Object.entries(section(job.lignes, 4, 'env'))) env[k] = interpoler(v, ctxEtape);
  for (const [k, v] of Object.entries(section(etape.lignes, 8, 'env'))) env[k] = interpoler(v, ctxEtape);
  return env;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// La construction, puis l'écran Plus
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * La version que `vite.config.ts` fixe à la construction, sous cet environnement : la configuration chargée comme
 * `vite build` la charge (`loadConfigFromFile`), dans un processus à part qui n'a que cet environnement.
 */
function versionDeLaConstruction(env: Record<string, string>): VersionConstruite {
  const script = [
    "const { loadConfigFromFile } = await import('vite');",
    "const r = await loadConfigFromFile({ command: 'build', mode: 'production' }, 'vite.config.ts', undefined, 'silent');",
    "process.stdout.write(String(r?.config.define?.__TIRELIRE_VERSION__ ?? ''));",
  ].join('\n');
  const fixee = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  expect(fixee, 'vite.config.ts ne fixe plus __TIRELIRE_VERSION__').not.toBe('');
  return JSON.parse(fixee) as VersionConstruite;
}

/** Ce que l'écran Plus montre, l'application construite avec cette version. */
async function ecranPlus(version: VersionConstruite): Promise<string> {
  (globalThis as unknown as { __TIRELIRE_VERSION__?: VersionConstruite }).__TIRELIRE_VERSION__ = version;
  await ouvrirLApplication();
  await allerA('Plus');
  return t(document.querySelector('main'));
}

/** Le texte d'un élément tel qu'il se lit : ses nœuds de texte, chacun séparé du suivant. */
function texteLu(e: Element): string {
  const parcours = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  const morceaux: string[] = [];
  for (let n = parcours.nextNode(); n; n = parcours.nextNode()) morceaux.push(n.textContent ?? '');
  return morceaux.join(' ').replace(/\s+/g, ' ').trim();
}

/** Les plus petits éléments de l'écran dont le texte répond à `dit`. */
const plusPetits = (dit: (s: string) => boolean): string[] =>
  tous('main *')
    .filter((e) => dit(texteLu(e)) && ![...e.children].some((c) => dit(texteLu(c))))
    .map(texteLu);

// Les noms qu'une sorte de build doit dire (D83), recopiés du test retiré ──────────────────────

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DEVELOPPEMENT = /développement|\bdev\b/i;
/** Un numéro de version pointé : `0.1`, `v0.1.0`. */
const NUMERO = /(?<![\w.])v?\d+\.\d+(?:\.\d+)*(?![\w])/i;
const dit = {
  /** Le nom du tag : seul, sans suite (`v0.1` n'est pas `v0.1-1a2b3c4`). */
  nom: (nom: string) => (texte: string) => new RegExp(`(?<![\\w.-])${echapper(nom)}(?![\\w-]|\\.\\d)`).test(texte),
  /** `main` à la recette : le développement, `main` et le hash court du commit. */
  main: (court: string) => (texte: string) => texte.includes(court) && /\bmain\b/i.test(texte) && DEVELOPPEMENT.test(texte),
  /** Une PR : le développement et son numéro. */
  pr: (numero: number) => (texte: string) => DEVELOPPEMENT.test(texte) && new RegExp(`(?:\\b(?:PR|pull\\s+request)\\b[\\s\\-#:n°]*|\\bpr-|#)${numero}\\b`, 'i').test(texte),
};
const court = (sha: string) => sha.slice(0, 7);

/** Un tutoiement, recopié du test retiré : un pronom de la deuxième personne du singulier, ou un impératif qui la porte. */
const TUTOIEMENT = /\b(?:tu|toi|ton|ta|tes)\b|\bt['’]|\b(?:recharge|actualise|mets|clique|appuie|relance|redémarre|profite|installe|choisis|attends)\b/i;

// ─────────────────────────────────────────────────────────────────────────────────────────────

let bac: Bac;
const versions = {} as Record<Sorte | 'local', VersionConstruite>;

beforeAll(() => {
  bac = creerLeBac();
  for (const sorte of ['tag', 'forcée', 'main', 'pr'] as const) versions[sorte] = versionDeLaConstruction(environnementDeLAssemblage(bac, sorte));
  versions.local = versionDeLaConstruction(environnementDePoste());
});

afterAll(() => {
  if (bac && existsSync(bac.dossier)) rmSync(bac.dossier, { recursive: true, force: true });
});

describe('#421 · #142 point 1 — le nom de chaque sorte de build (D83, « Livraison »), sans navigateur', () => {
  it('[niveau 4] #142 point 1, D83 (table #421, version-affichee 1) — une version publiée : Plus dit « v0.1 », seul, sans suite', async () => {
    const texte = await ecranPlus(versions.tag);
    expect(dit.nom(TAG)(texte), `Plus ne dit pas « ${TAG} », le nom du tag : « ${texte} »`).toBe(true);
  });

  it('[niveau 4] #142 point 1, D83 (table #421, version-affichee 2) — une version forcée : Plus dit « v0.1- » suivi du hash court du commit construit', async () => {
    const texte = await ecranPlus(versions['forcée']);
    expect(dit.nom(`${TAG}-${court(bac.c1)}`)(texte), `Plus ne dit pas « ${TAG}-${court(bac.c1)} », le nom de la version forcée : « ${texte} »`).toBe(true);
  });

  it('[niveau 4] #142 point 1, D83 (table #421, version-affichee 3) — main, à la recette : Plus dit le développement, « main » et le hash court du commit', async () => {
    const texte = await ecranPlus(versions.main);
    expect(dit.main(court(bac.c1))(texte), `Plus ne dit pas à la fois « développement », « main » et le commit ${court(bac.c1)} : « ${texte} »`).toBe(true);
  });

  it('[niveau 4] #142 point 1, D83 (table #421, version-affichee 4) — une PR : Plus dit le développement et le numéro 12 de la PR', async () => {
    const texte = await ecranPlus(versions.pr);
    expect(dit.pr(PR)(texte), `Plus ne dit pas à la fois « développement » et « PR ${PR} » : « ${texte} »`).toBe(true);
  });

  it('[niveau 4] #142 point 1, D83 (table #421, version-affichee 5) — un build local : Plus dit une construction locale ou le développement, sans numéro pointé', async () => {
    await ecranPlus(versions.local);
    const lignes = plusPetits((s) => s.length <= 300 && /version|build|construction/i.test(s) && /local|développement/i.test(s));
    expect(lignes.some((l) => !NUMERO.test(l)), `aucun élément de Plus ne parle de version en disant « local » ou « développement » sans numéro pointé (${lignes.map((l) => `« ${l} »`).join(', ') || 'aucun'})`).toBe(true);
  });

  it('[niveau 4] #142 point 1, D83 (table #421, version-affichee 6) — la version publiée ne dit aucun hash de commit, et la version forcée ne se dit pas sous le nom du tag seul', async () => {
    const tag = await ecranPlus(versions.tag);
    expect(dit.nom(TAG)(tag), `la version publiée ne dit pas son nom, ${TAG}`).toBe(true);
    for (const sha of [bac.c0, bac.c1, bac.p, bac.m]) expect(tag.includes(court(sha)), `la version publiée ${TAG} dit le hash ${court(sha)} : « ${tag} »`).toBe(false);
    expect(tag, `la version publiée ${TAG} dit un hash de commit : « ${tag} »`).not.toMatch(/\b[0-9a-f]{7,40}\b/);
    const forcee = await ecranPlus(versions['forcée']);
    expect(dit.nom(`${TAG}-${court(bac.c1)}`)(forcee), `la version forcée ne dit pas son nom, ${TAG}-${court(bac.c1)}`).toBe(true);
    expect(dit.nom(TAG)(forcee), `la version forcée se dit sous le nom du tag ${TAG} seul : « ${forcee} »`).toBe(false);
  });
});

describe('#421 · #142, D85 — les textes que la version et la mise à jour ajoutent vouvoient, sans navigateur', () => {
  it('[niveau 4] #142, D85 (table #421, version-affichee 7) — le signal de mise à jour, quand une version plus récente attend, ses commandes, et la ligne de la version que Plus montre pour main ne tutoient pas', async () => {
    (globalThis as unknown as { __TIRELIRE_VERSION__?: VersionConstruite }).__TIRELIRE_VERSION__ = versions.main;
    await ouvrirLApplication();
    // Une version plus récente est installée et attend : ce que le service worker dit à l'application (`onNeedRefresh`).
    const { miseAJour } = await import('../src/lib/miseAJour.svelte');
    miseAJour.prete = true;
    await rendu();
    const DIT = /mise\s+à\s+jour|nouvelle\s+version|plus\s+récente|nouvelle\s+mise/i;
    const CMD = /recharg|actualis|mettre\s+à\s+jour|mettez\s+à\s+jour|relanc|redémarr/i;
    const commandes = (e: Element) => [...e.querySelectorAll('button, [role="button"], a[href]')].concat(e.matches('button, [role="button"], a[href]') ? [e] : []).filter((b) => CMD.test(texteLu(b)));
    const porte = (e: Element) => texteLu(e).length <= 600 && DIT.test(texteLu(e)) && commandes(e).length > 0;
    const signal = tous('body *').filter((e) => !e.closest('.tabbar') && porte(e)).find((e) => ![...e.children].some((c) => porte(c)));
    expect(signal, 'aucun élément ne dit la mise à jour avec une commande pour recharger').toBeDefined();
    const texteDuSignal = texteLu(signal!);
    expect(texteDuSignal, `le signal tutoie : « ${texteDuSignal} »`).not.toMatch(TUTOIEMENT);
    for (const b of tous('button, [role="button"], a[href]', signal!).map(texteLu)) expect(b, `une commande du signal tutoie : « ${b} »`).not.toMatch(TUTOIEMENT);

    await allerA('Plus');
    expect(dit.main(court(bac.c1))(t(document.querySelector('main'))), 'Plus ne dit pas la version de main').toBe(true);
    const lignes = plusPetits((s) => /version|développement|main/i.test(s));
    expect(lignes.length, 'pas de ligne de la version à relire').toBeGreaterThan(0);
    for (const l of lignes) expect(l, `une ligne de la version tutoie : « ${l} »`).not.toMatch(TUTOIEMENT);
  });
});
