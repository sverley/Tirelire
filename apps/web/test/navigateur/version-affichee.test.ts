/**
 * Harnais d'audit de #142 — « La webapp affiche sa version et signale qu'une mise à jour est prête ».
 * Un seul fichier, hors registre (D81) : l'issue ne demande aucune entrée au registre ; tous les
 * niveaux y sont (D83), marqués dans chaque titre, et il se joue en entier comme harnais du besoin.
 *
 * Ce que le harnais garde, dans le « Fait quand » de l'issue, borné aux cibles actives (webapp sur
 * Chromium, Android et ordinateur) :
 *
 * 1. La version se lit, en deux gestes au plus depuis l'accueil (I5) : le nom du tag pour une version
 *    publiée, le nom d'une version forcée, et pour un build de développement qu'il s'agit du
 *    développement et de quel commit (`main` à la recette) ou de quelle PR ; un build local le dit
 *    aussi, sans numéro inventé.
 * 2. C'est celle qui tourne : la version du code exécuté par la page, pas la dernière disponible.
 * 3. Une mise à jour se dit, au plus tard quand l'utilisateur revient sur l'onglet, avec de quoi
 *    recharger ; rien ne se recharge à son insu (principe 4).
 * 4. Recharger ne perd rien ; refuser ou ignorer le signal laisse travailler, et la nouvelle version
 *    s'exécute à l'ouverture suivante.
 * 5. Ce qui tenait tient encore : l'application s'ouvre hors ligne après une première visite ; chaque
 *    aperçu de PR reste servi par lui-même, et la version de développement de la recette n'y déborde pas.
 *
 * Et « les textes vouvoient » (D85).
 *
 * **Comment les sites sont construits.** L'issue laisse au codeur le moyen de faire passer le nom du
 * tag ou du commit à la construction, et lui permet de modifier `ci.yml` à cette seule fin : le
 * harnais n'impose donc ni nom de variable ni fichier. Il construit chaque site comme la CI le
 * construit — `ci.yml` joué à blanc dans un dossier d'essai, événement par événement (tag poussé,
 * version forcée, push sur `main`, PR), ses étapes exécutées pour de vrai, sauf ce qui joue les tests,
 * installe, dépose ou publie — puis mesure ce que l'application dit dans le navigateur. Le dossier
 * d'essai est une copie des fichiers suivis (et des nouveaux, non ignorés) dans un dépôt git à
 * l'historique connu : la version publiée `v0.1` sur C0, `main` en C1 puis C2, la tête P d'une PR et
 * sa fusion M ; il n'est jamais poussé nulle part. Le build local, lui, est `pnpm build`, sans rien
 * de ce que pose la CI.
 *
 * **Ce que le harnais lit de l'application**, sans supposer ni la place ni les mots exacts :
 * - la version : le texte visible d'un écran atteint en deux gestes au plus depuis l'accueil (un
 *   onglet, puis une ligne ou un bouton de l'écran) porte le nom attendu — `v0.1`, `v0.1-<hash court>`,
 *   `main` et le hash court avec « développement », « PR 12 » avec « développement » ; pour le build
 *   local, un élément qui parle de version et dit « local » ou « développement », sans numéro pointé ;
 * - le signal de mise à jour : un élément visible qui dit « mise à jour », « nouvelle version » ou
 *   « plus récente » et porte une commande « Recharger », « Actualiser » ou « Mettre à jour » ;
 * - « revenir sur l'onglet » : la page passe cachée puis visible (`visibilitychange`, `blur`, `focus`),
 *   le serveur ayant changé de version entre les deux.
 *
 * Chaque test déclare son niveau (D83). Niveau 0 : recharger ou ignorer le signal ne doit jamais
 * perdre une donnée saisie (C4, C5, I7). Niveau 1 : la version se lit en deux gestes (I5), la version
 * affichée est celle qui tourne, le signal paraît sans recharger d'office (C8, principe 4), refuser
 * laisse travailler, la nouvelle version tourne à l'ouverture suivante. Niveau 2 : les noms des
 * quatre sortes de builds (D83, « Livraison »), pas de faux signal, chaque aperçu servi par lui-même
 * (#233), hors ligne après une première visite, le signal qui ne revient pas une fois la mise à jour
 * faite (un faux signal), les textes qui vouvoient (D85, une décision).
 */
// @ts-ignore — module JavaScript sans déclaration de types
import { CLÉ_ÉTAPE, STATUT, besoins, expression, jobs, scalaire, vrai, évaluer, étapes, commande } from '../../../../packages/gardes/workflow-a-blanc.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLExemple, RACINE, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Le dossier d'essai : une copie du dépôt, dans un dépôt git à l'historique connu
// ─────────────────────────────────────────────────────────────────────────────────────────────

const DÉPÔT = resolve(RACINE, '../..');
const WORKFLOW = '.github/workflows/ci.yml';
/** La version publiée du dossier d'essai, posée sur C0. */
const TAG = 'v0.1';
/** Le numéro de la PR jouée. */
const PR = 12;

interface Bac {
  dossier: string;
  /** Le commit de la version publiée (`v0.1`). */
  c0: string;
  /** `main`, un commit plus loin ; `c2`, un de plus (la version « plus récente » d'une mise à jour). */
  c1: string;
  c2: string;
  /** La tête de la PR, et sa fusion avec `main`. */
  p: string;
  m: string;
  /** Là où la CI joue ses commandes `gh`, `sudo`… : rien ne sort. */
  bin: string;
  temp: string;
  sites: string;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();
}

function créerLeBac(): Bac {
  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-ci-'));
  const fichiers = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: DÉPÔT, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\0').filter(Boolean);
  for (const f of fichiers) {
    const source = join(DÉPÔT, f);
    if (!existsSync(source) || statSync(source).isDirectory()) continue;
    mkdirSync(dirname(join(dossier, f)), { recursive: true });
    copyFileSync(source, join(dossier, f));
  }
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
  git(dossier, 'commit', '-q', '--allow-empty', '-m', 'C2 : main avance encore');
  const c2 = git(dossier, 'rev-parse', 'HEAD');

  // Les dépendances, celles du dépôt de travail (rien ne s'installe) : posées après les commits, pour
  // qu'aucun commit ne les porte.
  const paquets = ['.', ...['apps', 'packages'].flatMap((d) => readdirSync(join(DÉPÔT, d)).map((s) => `${d}/${s}`))];
  for (const d of paquets) {
    const modules = join(DÉPÔT, d, 'node_modules');
    if (existsSync(modules) && existsSync(join(dossier, d))) symlinkSync(modules, join(dossier, d, 'node_modules'));
  }
  const bin = mkdtempSync(join(tmpdir(), 'tirelire-ci-bin-'));
  for (const outil of ['gh', 'sudo', 'apt-get']) {
    writeFileSync(join(bin, outil), '#!/bin/sh\nexit 0\n');
    chmodSync(join(bin, outil), 0o755);
  }
  return { dossier, c0, c1, c2, p, m, bin, temp: mkdtempSync(join(tmpdir(), 'tirelire-ci-temp-')), sites: mkdtempSync(join(tmpdir(), 'tirelire-ci-sites-')) };
}

/** L'environnement d'un poste : rien de ce que pose la CI, ni des lanceurs de test. */
function environnementDePoste(bac: Bac): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(GITHUB_|RUNNER_|TIRELIRE_|npm_|PNPM_SCRIPT|INIT_CWD$|CI$|NODE_OPTIONS$|VITEST|VITE_)/.test(k)) continue;
    env[k] = v;
  }
  env['PATH'] = `${bac.bin}:${env['PATH'] ?? ''}`;
  return env;
}

function lancer(script: string, cwd: string, env: NodeJS.ProcessEnv, délai = 420_000): Promise<{ code: number | null; sortie: string }> {
  return new Promise((fin) => {
    const enfant = spawn('bash', ['-e', '-c', script], { cwd, env });
    let sortie = '';
    enfant.stdout.on('data', (d: Buffer) => (sortie += d.toString()));
    enfant.stderr.on('data', (d: Buffer) => (sortie += d.toString()));
    const minuteur = setTimeout(() => {
      sortie += '\n(délai dépassé)';
      enfant.kill('SIGKILL');
    }, délai);
    enfant.on('close', (code) => {
      clearTimeout(minuteur);
      fin({ code, sortie });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ci.yml joué à blanc, événement par événement, étapes exécutées pour de vrai
// ─────────────────────────────────────────────────────────────────────────────────────────────

type Sorte = 'tag' | 'forcée' | 'main' | 'main-suivant' | 'pr' | 'local';

/**
 * Les étapes qu'on ne joue pas : elles installent, jouent les tests, déposent ou publient, ou lisent
 * l'API de GitHub. Tout le reste s'exécute : les étapes du codeur qui nomment la version, comme
 * celles qui assemblent le site.
 */
const ÉCARTÉES: RegExp[] = [
  /\bpnpm\s+(?:--dir\s+\S+\s+)?(?:run\s+)?(?:install|typecheck|test)\b/,
  /\bpnpm\s+(?:-r\s+)?build\b/,
  /\b(?:lftp|gradlew|cap\s+sync|unzip)\b/,
  /apercu\.sh|deposer\.sh|verifier\.sh|attestation\.mjs|harnais-du-besoin\.sh/,
  /\bpython3\b|\bphp\b/,
];

interface Étape {
  nom: string;
  id: string;
  si: string;
  uses: string;
  run: string;
  env: Record<string, string>;
  avec: Record<string, string>;
  dossier: string;
  continuer: boolean;
}

function dédenter(lignes: string[]): string {
  const marge = Math.min(...lignes.map((l) => l.search(/\S/)).filter((n) => n >= 0));
  return lignes.map((l) => l.slice(Number.isFinite(marge) ? marge : 0)).join('\n');
}

/** Une étape de `steps:`, lue par renfoncement (la forme des workflows du dépôt : deux espaces). */
function lireÉtape(lignes: string[]): Étape {
  const é: Étape = { nom: '', id: '', si: '', uses: '', run: '', env: {}, avec: {}, dossier: '', continuer: false };
  const l = lignes.map((x, i) => (i === 0 ? x.replace(/^ {6}- /, '        ') : x));
  for (let i = 0; i < l.length; i += 1) {
    const m = l[i]!.match(/^ {8}([A-Za-z-]+):\s*(.*)$/);
    if (!m) continue;
    const clé = m[1]!;
    const reste = m[2]!.trim();
    const suite: string[] = [];
    while (i + 1 < l.length && /^ {9,}/.test(l[i + 1]!)) suite.push(l[(i += 1)]!);
    const carte = () => Object.fromEntries(suite.map((s) => s.match(/^ {10}([A-Za-z0-9_-]+):\s*(.*)$/)).filter((x): x is RegExpMatchArray => !!x).map((x) => [x[1]!, x[2]!.trim()]));
    if (clé === 'run') é.run = /^[|>][-+]?$/.test(reste) ? dédenter(suite) : reste;
    else if (clé === 'env') é.env = carte();
    else if (clé === 'with') é.avec = carte();
    else if (clé === 'name') é.nom = reste;
    else if (clé === 'id') é.id = reste;
    else if (clé === 'if') é.si = reste;
    else if (clé === 'uses') é.uses = reste;
    else if (clé === 'working-directory') é.dossier = reste;
    else if (clé === 'continue-on-error') é.continuer = reste === 'true';
  }
  return é;
}

/** Les entrées `clé: valeur` d'une section d'un job (`env:`, `outputs:`), au renfoncement de six espaces. */
function sectionDeJob(lignes: string[], clé: string): Record<string, string> {
  const début = lignes.findIndex((l) => new RegExp(`^ {4}${clé}:\\s*$`).test(l));
  if (début < 0) return {};
  const sortie: Record<string, string> = {};
  for (const l of lignes.slice(début + 1)) {
    const m = l.match(/^ {6}([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) sortie[m[1]!] = m[2]!.trim();
    else if (l.trim() && !l.trim().startsWith('#') && !/^ {7,}/.test(l)) break;
  }
  return sortie;
}

const sansCommentaire = (v: string) => (/\$\{\{/.test(v) ? v : v.replace(/\s+#.*$/, ''));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const remplacer = (texte: string, ctx: any) => texte.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, e: string) => String(évaluer(e, ctx) ?? ''));
const valeur = (v: string, ctx: unknown) => remplacer(sansCommentaire(v).trim().replace(/^(['"])(.*)\1$/, '$2'), ctx);

/** Ce que l'étape a écrit dans `GITHUB_OUTPUT` (`clé=valeur`, ou `clé<<FIN` … `FIN`). */
function sortiesÉcrites(fichier: string): Record<string, string> {
  if (!existsSync(fichier)) return {};
  const sortie: Record<string, string> = {};
  const lignes = readFileSync(fichier, 'utf8').split('\n');
  for (let i = 0; i < lignes.length; i += 1) {
    const bloc = lignes[i]!.match(/^([^=<]+)<<(.+)$/);
    if (bloc) {
      const corps: string[] = [];
      while (i + 1 < lignes.length && lignes[i + 1] !== bloc[2]) corps.push(lignes[(i += 1)]!);
      i += 1;
      sortie[bloc[1]!] = corps.join('\n');
      continue;
    }
    const m = lignes[i]!.match(/^([^=]+)=(.*)$/);
    if (m) sortie[m[1]!] = m[2]!;
  }
  return sortie;
}

interface Événement {
  github: Record<string, unknown>;
  inputs: Record<string, unknown>;
  /** Le commit que `actions/checkout` extrait sans `ref`. */
  tête: string;
  charge: Record<string, unknown>;
}

function événement(bac: Bac, sorte: Exclude<Sorte, 'local'>): Événement {
  const dépôt = 'sverley/Tirelire';
  const push = (ref: string, nom: string, type: string, sha: string): Événement => ({
    github: { event_name: 'push', ref, ref_name: nom, ref_type: type, sha, head_ref: '', event: { ref, after: sha } },
    inputs: {},
    tête: sha,
    charge: { ref, after: sha, repository: { full_name: dépôt } },
  });
  if (sorte === 'tag') return push(`refs/tags/${TAG}`, TAG, 'tag', bac.c0);
  if (sorte === 'main') return push('refs/heads/main', 'main', 'branch', bac.c1);
  if (sorte === 'main-suivant') return push('refs/heads/main', 'main', 'branch', bac.c2);
  if (sorte === 'forcée') {
    // `version-forcee.yml` appelle `ci.yml` : l'événement est celui du déclenchement manuel.
    return {
      github: { event_name: 'workflow_dispatch', ref: 'refs/heads/main', ref_name: 'main', ref_type: 'branch', sha: bac.c1, head_ref: '', event: {} },
      inputs: { version_forcee: true },
      tête: bac.c1,
      charge: { ref: 'refs/heads/main', inputs: {} },
    };
  }
  const pull = { number: PR, draft: false, head: { sha: bac.p, ref: 'audit/142-essai' }, base: { ref: 'main' } };
  return {
    github: { event_name: 'pull_request', ref: `refs/pull/${PR}/merge`, ref_name: `${PR}/merge`, ref_type: 'branch', sha: bac.m, head_ref: 'audit/142-essai', base_ref: 'main', event: { action: 'opened', number: PR, pull_request: pull } },
    inputs: {},
    tête: bac.m,
    charge: { action: 'opened', number: PR, pull_request: pull },
  };
}

/** Les variables `GITHUB_*` d'un exécuteur, pour ce contexte. */
function variablesGitHub(bac: Bac, ev: Événement, ctx: { github: Record<string, unknown> }, fichiers: { sortie: string; env: string; résumé: string; charge: string }): NodeJS.ProcessEnv {
  const g = ctx.github;
  const texte = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  return {
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_WORKSPACE: bac.dossier,
    GITHUB_REPOSITORY: 'sverley/Tirelire',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_ACTOR: 'porteur',
    GITHUB_RUN_ID: '4242',
    GITHUB_RUN_NUMBER: '7',
    GITHUB_WORKFLOW: 'CI et livraison',
    GITHUB_EVENT_NAME: texte(g['event_name']),
    GITHUB_REF: texte(g['ref']),
    GITHUB_REF_NAME: texte(g['ref_name']),
    GITHUB_REF_TYPE: texte(g['ref_type']),
    GITHUB_SHA: texte(g['sha']),
    GITHUB_HEAD_REF: texte(g['head_ref']),
    GITHUB_BASE_REF: texte(g['base_ref']),
    GITHUB_OUTPUT: fichiers.sortie,
    GITHUB_ENV: fichiers.env,
    GITHUB_STEP_SUMMARY: fichiers.résumé,
    GITHUB_EVENT_PATH: fichiers.charge,
    RUNNER_TEMP: bac.temp,
    RUNNER_OS: 'Linux',
    GH_TOKEN: '',
  };
}

/**
 * Joue `ci.yml` pour l'événement, dans le dossier d'essai, et rend le site que la CI dépose : le
 * dossier d'`apps/hebergement/dist`, copié à part. Seuls les jobs qui assemblent le site, et ceux
 * dont ils dépendent, sont joués ; chaque job qui passe sa condition joue ses étapes qui passent la
 * leur, sauf `ÉCARTÉES`. Une étape qui échoue arrête tout, en disant laquelle.
 */
async function jouerLaCI(bac: Bac, sorte: Exclude<Sorte, 'local'>): Promise<string> {
  const yaml = readFileSync(join(bac.dossier, WORKFLOW), 'utf8').replace(/\r\n?/g, '\n');
  const blocs = jobs(yaml) as Map<string, { lignes: string[] }>;
  const ev = événement(bac, sorte);
  git(bac.dossier, 'checkout', '-q', '--detach', ev.tête);
  rmSync(join(bac.dossier, 'apps/hebergement/dist'), { recursive: true, force: true });
  rmSync(join(bac.dossier, 'apps/web/dist'), { recursive: true, force: true });
  const charge = join(bac.temp, `evenement-${sorte}.json`);
  writeFileSync(charge, JSON.stringify(ev.charge));
  const fichiers = { sortie: join(bac.temp, 'sortie'), env: join(bac.temp, 'env'), résumé: join(bac.temp, 'résumé'), charge };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx: any = {
    github: { ...ev.github, workspace: bac.dossier, repository: 'sverley/Tirelire', token: 'jeton-de-l-essai', run_number: '7', run_id: '4242' },
    inputs: ev.inputs,
    vars: {},
    secrets: {},
    needs: {},
    steps: {},
    env: {},
    runner: { temp: bac.temp, os: 'Linux' },
    job: { status: 'success' },
  };

  const assemble = (nom: string) => (étapes(blocs.get(nom)!.lignes) as Array<{ lignes: string[] }>).some((é) => /\bassembler\b/.test(commande(é)));
  const voulus = new Set<string>();
  const vouloir = (nom: string) => {
    if (voulus.has(nom)) return;
    voulus.add(nom);
    for (const n of besoins(blocs.get(nom)!.lignes) as string[]) vouloir(n);
  };
  for (const nom of blocs.keys()) if (assemble(nom)) vouloir(nom);

  const faits = new Map<string, { tourne: boolean; réussi: boolean }>();
  let assemblé = false;
  const jouerLeJob = async (nom: string): Promise<{ tourne: boolean; réussi: boolean }> => {
    const déjà = faits.get(nom);
    if (déjà) return déjà;
    const { lignes } = blocs.get(nom)!;
    const amont = [];
    for (const n of besoins(lignes) as string[]) amont.push(await jouerLeJob(n));
    const si = expression(scalaire(lignes, /^ {4}if:/));
    const amontOk = amont.every((a) => a.réussi);
    const amontÉchec = amont.some((a) => a.tourne && !a.réussi);
    const tourne = !si ? amontOk : STATUT.test(si) ? vrai(évaluer(si, ctx, amontÉchec)) : amontOk && vrai(évaluer(si, ctx));
    if (!tourne) {
      const r = { tourne: false, réussi: false };
      faits.set(nom, r);
      return r;
    }
    ctx.steps = {};
    const envJob: Record<string, string> = {};
    const ajoutés: Record<string, string> = {};
    for (const [k, v] of Object.entries(sectionDeJob(lignes, 'env'))) envJob[k] = valeur(v, ctx);
    for (const brut of étapes(lignes) as Array<{ lignes: string[] }>) {
      const é = lireÉtape(brut.lignes);
      const c = expression(é.si);
      const passe = !c ? true : STATUT.test(c) ? vrai(évaluer(c, ctx, false)) : vrai(évaluer(c, ctx));
      if (!passe) continue;
      const titre = é.nom || é.run.split('\n')[0] || é.uses;
      if (é.uses) {
        if (/^actions\/checkout@/.test(é.uses)) git(bac.dossier, 'checkout', '-q', '--detach', valeur(é.avec['ref'] ?? '', ctx) || String(ctx.github.sha));
        continue;
      }
      ctx.env = { ...envJob, ...ajoutés };
      const script = remplacer(é.run, ctx);
      if (ÉCARTÉES.some((r) => r.test(script))) continue;
      for (const f of [fichiers.sortie, fichiers.résumé]) writeFileSync(f, '');
      writeFileSync(fichiers.env, '');
      const envÉtape: Record<string, string> = {};
      for (const [k, v] of Object.entries(é.env)) envÉtape[k] = valeur(v, ctx);
      const env = { ...environnementDePoste(bac), ...variablesGitHub(bac, ev, ctx, fichiers), ...envJob, ...ajoutés, ...envÉtape };
      const r = await lancer(script, é.dossier ? join(bac.dossier, é.dossier) : bac.dossier, env);
      if (r.code !== 0 && !é.continuer) {
        const fin = r.sortie.trim().split('\n').slice(-25).join('\n');
        throw new Error(`La CI jouée pour « ${sorte} » échoue à l'étape « ${titre} » du job « ${nom} » (code ${r.code}) :\n${fin}`);
      }
      for (const l of readFileSync(fichiers.env, 'utf8').split('\n')) {
        const m = l.match(/^([^=]+)=(.*)$/);
        if (m) ajoutés[m[1]!] = m[2]!;
      }
      if (é.id) ctx.steps[é.id] = { outputs: sortiesÉcrites(fichiers.sortie), outcome: 'success', conclusion: 'success' };
      if (/\bassembler\b/.test(script)) assemblé = true;
    }
    const sorties: Record<string, string> = {};
    for (const [k, v] of Object.entries(sectionDeJob(lignes, 'outputs'))) sorties[k] = valeur(v, ctx);
    ctx.needs[nom] = { result: 'success', outputs: sorties };
    const r = { tourne: true, réussi: true };
    faits.set(nom, r);
    return r;
  };
  for (const nom of blocs.keys()) if (voulus.has(nom)) await jouerLeJob(nom);
  if (!assemblé) throw new Error(`La CI jouée pour « ${sorte} » n'assemble aucun site : aucun job qui lance l'assemblage ne passe sa condition.`);
  const site = join(bac.dossier, 'apps/hebergement/dist');
  if (!existsSync(join(site, 'index.html'))) throw new Error(`La CI jouée pour « ${sorte} » n'a pas produit ${site}/index.html.`);
  const sortie = join(bac.sites, sorte);
  cpSync(site, sortie, { recursive: true });
  return sortie;
}

/** Un build local : `pnpm build`, comme le dit le README, sans rien de ce que pose la CI. */
async function construireEnLocal(bac: Bac): Promise<string> {
  git(bac.dossier, 'checkout', '-q', '--detach', bac.c1);
  rmSync(join(bac.dossier, 'apps/web/dist'), { recursive: true, force: true });
  const r = await lancer('pnpm build', bac.dossier, environnementDePoste(bac));
  if (r.code !== 0) throw new Error(`Le build local (pnpm build) échoue :\n${r.sortie.trim().split('\n').slice(-25).join('\n')}`);
  const sortie = join(bac.sites, 'local');
  cpSync(join(bac.dossier, 'apps/web/dist'), sortie, { recursive: true });
  return sortie;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Un serveur de fichiers, dont le contenu change entre deux visites
// ─────────────────────────────────────────────────────────────────────────────────────────────

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

interface Serveur {
  url: string;
  /** Préfixe d'adresse → dossier servi. Modifiable : c'est ainsi qu'un site « se met à jour ». */
  montages: Record<string, string>;
  fermer(): Promise<void>;
}

async function servir(montages: Record<string, string>): Promise<Serveur> {
  const serveur: Server = createServer((requête, réponse) => {
    const chemin = decodeURIComponent((requête.url ?? '/').split('?')[0]!.split('#')[0]!);
    const préfixe = Object.keys(montages).sort((a, b) => b.length - a.length).find((p) => chemin.startsWith(p));
    if (!préfixe) {
      if (montages[`${chemin}/`]) {
        réponse.writeHead(301, { Location: `${chemin}/` }).end();
        return;
      }
      réponse.writeHead(404).end('introuvable');
      return;
    }
    const racine = resolve(montages[préfixe]!);
    let relatif = chemin.slice(préfixe.length);
    if (relatif === '' || relatif.endsWith('/')) relatif += 'index.html';
    const fichier = normalize(join(racine, relatif));
    if (!fichier.startsWith(racine) || !existsSync(fichier) || statSync(fichier).isDirectory()) {
      réponse.writeHead(404).end('introuvable');
      return;
    }
    réponse.writeHead(200, { 'Content-Type': TYPES[extname(fichier)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(readFileSync(fichier));
  });
  await new Promise<void>((fin) => serveur.listen(0, '127.0.0.1', fin));
  const { port } = serveur.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    montages,
    fermer: () => new Promise<void>((fin) => (serveur.closeAllConnections(), serveur.close(() => fin()))),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Ce que la page dit
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface Lecture {
  /** Le texte visible de la page. */
  texte: string;
  /** Les plus petits éléments qui parlent de version et disent « local » ou « développement ». */
  versions: string[];
}

async function lire(page: Page): Promise<Lecture> {
  return page.evaluate(() => {
    const net = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      const c = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none';
    };
    const dit = (t: string) => /version|build|construction/i.test(t) && /local|développement/i.test(t);
    const tous = [...document.querySelectorAll('body *')].filter((e) => !e.closest('.tabbar') && visible(e));
    const versions = tous
      .filter((e) => {
        const t = net(e.textContent);
        return t.length <= 300 && dit(t) && ![...e.children].some((c) => dit(net(c.textContent)));
      })
      .map((e) => net(e.textContent));
    return { texte: document.body.innerText, versions };
  });
}

/** Une ouverture de l'application : la base ouverte, l'écran monté. */
async function attendrePrête(page: Page): Promise<void> {
  const fin = Date.now() + 20_000;
  while (Date.now() < fin) {
    const prête = await page.evaluate(() => !!document.querySelector('main') && !document.body.textContent?.includes('Ouverture de la base')).catch(() => false);
    if (prête) return;
    await pause(100);
  }
  throw new Error("l'application ne s'est pas ouverte");
}

function siteDe(url: string, chrome: Browser): Site {
  return { url, chrome, fermer: async () => {} };
}

/** Une page neuve sur ce site, base vide. */
async function ouvrirVide(site: Site, largeur = 375, hauteur = 812): Promise<Page> {
  const page = await nouvellePage(site, largeur, hauteur);
  page.on('dialog', (d) => void d.dismiss());
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await attendrePrête(page);
  return page;
}

async function libellés(page: Page, sélecteur: string): Promise<Array<{ i: number; libellé: string }>> {
  return page.evaluate((s: string) => {
    const net = (t: string | null) => (t ?? '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll(s)]
      .map((e, i) => ({ i, libellé: net(e.textContent), ok: (e as HTMLElement).offsetParent !== null && !(e as HTMLButtonElement).disabled }))
      .filter((x) => x.ok && x.libellé)
      .map(({ i, libellé }) => ({ i, libellé }));
  }, sélecteur);
}

async function toucher(page: Page, sélecteur: string, i: number): Promise<void> {
  await page.evaluate((s: string, n: number) => (document.querySelectorAll(s)[n] as HTMLElement | undefined)?.click(), sélecteur, i);
  await pause(180);
}

const ONGLETS = '.tabbar button';
const DANS_L_ÉCRAN = 'main button, main a[href]';
/** Ce qu'on ne touche jamais pour chercher : un geste qui écrit, efface, télécharge ou lance un parcours. */
const À_ÉVITER = /effac|supprim|vider|remplac|repartir|réinitial|import|export|enregistr|charger|synchroniser|valid|ajout|cré|modifi|masqu|annul|lancer|commenc|propos|retir|pointer|appliquer|confirm|quitt|copi|télécharg|fichier/i;

interface Trouvé {
  /** Les gestes depuis l'accueil, dans l'ordre : un onglet, puis une ligne ou un bouton de l'écran. */
  par: string[];
  lecture: Lecture;
}

async function àLAccueil(page: Page): Promise<void> {
  const [accueil] = await libellés(page, ONGLETS);
  if (accueil) await toucher(page, ONGLETS, accueil.i);
}

/** Refait un chemin déjà connu : chaque geste est le premier élément qui porte ce libellé. */
async function suivre(page: Page, par: string[]): Promise<Lecture> {
  await àLAccueil(page);
  let sélecteur = ONGLETS;
  for (const geste of par) {
    const cible = (await libellés(page, sélecteur)).find((x) => x.libellé.includes(geste));
    if (!cible) break;
    await toucher(page, sélecteur, cible.i);
    sélecteur = DANS_L_ÉCRAN;
  }
  return lire(page);
}

/**
 * Cherche, depuis l'accueil et en deux gestes au plus, un écran dont la lecture satisfait `cherche` :
 * l'accueil lui-même, puis chaque onglet ou bouton de l'accueil, puis chaque ligne ou bouton de chacun
 * de ces écrans. `connu` est un chemin déjà trouvé, essayé d'abord.
 */
async function trouver(page: Page, cherche: (l: Lecture) => boolean, connu?: string[]): Promise<Trouvé | undefined> {
  if (connu) {
    const lecture = await suivre(page, connu);
    if (cherche(lecture)) return { par: connu, lecture };
  }
  await àLAccueil(page);
  const accueil = await lire(page);
  if (cherche(accueil)) return { par: [], lecture: accueil };

  const premiers: Array<{ sélecteur: string; libellé: string }> = [];
  for (const x of await libellés(page, ONGLETS)) premiers.push({ sélecteur: ONGLETS, libellé: x.libellé });
  for (const x of await libellés(page, DANS_L_ÉCRAN)) if (!À_ÉVITER.test(x.libellé)) premiers.push({ sélecteur: DANS_L_ÉCRAN, libellé: x.libellé });
  const ouvrir = async (p: { sélecteur: string; libellé: string }) => {
    await àLAccueil(page);
    const cible = (await libellés(page, p.sélecteur)).find((x) => x.libellé === p.libellé);
    if (!cible) return false;
    await toucher(page, p.sélecteur, cible.i);
    return true;
  };
  for (const p of premiers) {
    if (!(await ouvrir(p))) continue;
    const lecture = await lire(page);
    if (cherche(lecture)) return { par: [p.libellé], lecture };
  }
  for (const p of premiers) {
    if (!(await ouvrir(p))) continue;
    const seconds = (await libellés(page, DANS_L_ÉCRAN)).filter((x) => !À_ÉVITER.test(x.libellé)).slice(0, 14);
    for (const s of seconds) {
      if (!(await ouvrir(p))) break;
      const cible = (await libellés(page, DANS_L_ÉCRAN)).find((x) => x.libellé === s.libellé);
      if (!cible) continue;
      await toucher(page, DANS_L_ÉCRAN, cible.i);
      const lecture = await lire(page);
      if (cherche(lecture)) return { par: [p.libellé, s.libellé], lecture };
    }
  }
  return undefined;
}

// Les noms qu'une sorte de build doit dire (D83) ─────────────────────────────────────────────

const échapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DÉVELOPPEMENT = /développement|\bdev\b/i;
/** Un numéro de version pointé : `0.1`, `v0.1.0`. */
const NUMÉRO = /(?<![\w.])v?\d+\.\d+(?:\.\d+)*(?![\w])/i;

const dit = {
  /** Le nom du tag : seul, sans suite (`v0.1` n'est pas `v0.1-1a2b3c4`). */
  nom: (nom: string) => (l: Lecture) => new RegExp(`(?<![\\w.-])${échapper(nom)}(?![\\w-]|\\.\\d)`).test(l.texte),
  /** `main` à la recette : le développement, `main` et le hash court du commit. */
  main: (court: string) => (l: Lecture) => l.texte.includes(court) && /\bmain\b/i.test(l.texte) && DÉVELOPPEMENT.test(l.texte),
  /** Le hash court d'un commit, sans plus. */
  commit: (court: string) => (l: Lecture) => l.texte.includes(court),
  /** Une PR : le développement et son numéro. */
  pr: (numéro: number) => (l: Lecture) =>
    DÉVELOPPEMENT.test(l.texte) && new RegExp(`(?:\\b(?:PR|pull\\s+request)\\b[\\s\\-#:n°]*|\\bpr-|#)${numéro}\\b`, 'i').test(l.texte),
  /** Un build local : un élément qui parle de version, dit « local » ou « développement », sans numéro. */
  local: (l: Lecture) => l.versions.some((v) => !NUMÉRO.test(v)),
};

const court = (sha: string) => sha.slice(0, 7);

// Le signal de mise à jour ────────────────────────────────────────────────────────────────────

interface Signal {
  texte: string;
  commande: string;
}

/** Le plus petit élément visible qui dit la mise à jour et porte une commande pour recharger. */
async function signal(page: Page): Promise<Signal | undefined> {
  return page
    .evaluate(() => {
      const net = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
      const visible = (e: Element) => {
        const r = e.getBoundingClientRect();
        const c = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none';
      };
      const DIT = /mise\s+à\s+jour|nouvelle\s+version|plus\s+récente|nouvelle\s+mise/i;
      const CMD = /recharg|actualis|mettre\s+à\s+jour|mettez\s+à\s+jour|relanc|redémarr/i;
      const commandes = (e: Element) => [...e.querySelectorAll('button, [role="button"], a[href]')].concat(e.matches('button, [role="button"], a[href]') ? [e] : []).filter((b) => visible(b) && CMD.test(net(b.textContent)));
      const porte = (e: Element) => visible(e) && net(e.textContent).length <= 600 && DIT.test(net(e.textContent)) && commandes(e).length > 0;
      const tous = [...document.querySelectorAll('body *')].filter((e) => !e.closest('.tabbar') && porte(e));
      const plus_petit = tous.filter((e) => ![...e.children].some((c) => porte(c)));
      const e = plus_petit[0];
      if (!e) return undefined;
      const b = commandes(e)[0]!;
      b.setAttribute('data-harnais-recharger', '1');
      return { texte: net(e.textContent), commande: net(b.textContent) };
    })
    .catch(() => undefined);
}

async function accepter(page: Page): Promise<boolean> {
  const cliqué = await page
    .evaluate(() => {
      const b = document.querySelector('[data-harnais-recharger="1"]') as HTMLElement | null;
      b?.click();
      return !!b;
    })
    .catch(() => false);
  return cliqué;
}

/** « Revenir sur l'onglet » : la page passe cachée, `pendant` se joue, puis elle redevient visible. */
async function quitterEtRevenir(page: Page, pendant: () => void | Promise<void>): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __visibilité?: string };
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => w.__visibilité ?? 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => w.__visibilité === 'hidden' });
    w.__visibilité = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
  });
  await pendant();
  await page.evaluate(() => {
    (window as unknown as { __visibilité?: string }).__visibilité = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
}

/**
 * Attend que le service worker soit actif ; `contrôle` : qu'il contrôle aussi la page ouverte, ce qui
 * n'arrive qu'à la visite suivante si rien ne le réclame (`clients.claim`). Actif, il répond déjà aux
 * navigations : c'est ce dont l'ouverture hors ligne a besoin.
 */
async function attendreLeServiceWorker(page: Page, contrôle = false): Promise<boolean> {
  const fin = Date.now() + 20_000;
  while (Date.now() < fin) {
    const état = await page
      .evaluate(async () => {
        if (!('serviceWorker' in navigator)) return 'absent';
        const r = await navigator.serviceWorker.getRegistration();
        return r?.active ? (navigator.serviceWorker.controller ? 'contrôle' : 'actif') : 'attente';
      })
      .catch(() => 'erreur');
    if (état === 'contrôle' || (!contrôle && état === 'actif')) return true;
    await pause(250);
  }
  return false;
}

async function attendre<T>(chercher: () => Promise<T | undefined>, délai: number): Promise<T | undefined> {
  const fin = Date.now() + délai;
  while (Date.now() < fin) {
    const v = await chercher();
    if (v) return v;
    await pause(300);
  }
  return undefined;
}

// Une donnée saisie, et l'état du plan ────────────────────────────────────────────────────────

/** Saisit le coussin du compte principal dans Réglages, et l'enregistre. */
async function réglerLeCoussin(page: Page, montant: string): Promise<void> {
  await allerÀ(page, 'Plus');
  await cliquer(page, 'Réglages');
  await page.evaluate((v: string) => {
    const étiquette = [...document.querySelectorAll('label.f')].find((x) => x.textContent?.includes('Coussin'));
    const champ = étiquette?.querySelector('input') as HTMLInputElement | null;
    if (!champ) return;
    champ.value = v;
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    (étiquette?.parentElement?.querySelector('button') as HTMLButtonElement | null)?.click();
  }, montant);
  await pause(300);
}

async function lireLeCoussin(page: Page): Promise<string> {
  await allerÀ(page, 'Plus');
  await cliquer(page, 'Réglages');
  return page.evaluate(() => {
    const étiquette = [...document.querySelectorAll('label.f')].find((x) => x.textContent?.includes('Coussin'));
    return ((étiquette?.querySelector('input') as HTMLInputElement | null)?.value ?? '').trim();
  });
}

/** Le plan tel qu'il se lit, sans ce que la version, le signal ou la sûreté des données y ajoutent. */
async function plan(page: Page): Promise<string[]> {
  await allerÀ(page, 'Plan');
  // La date de lecture n'est pas une donnée : elle repart d'aujourd'hui à chaque ouverture. On la fixe
  // au jour de l'exemple avant de lire, avant comme après.
  await page.evaluate(() => {
    const champ = document.querySelector('header input[type="date"]') as HTMLInputElement | null;
    if (!champ) return;
    champ.value = '2026-09-06';
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    champ.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await pause(300);
  const texte = await page.evaluate(() => (document.querySelector('main') as HTMLElement | null)?.innerText ?? '');
  return texte.split('\n').map((l) => l.trim()).filter((l) => l && !/version|mise à jour|recharg|bêta|copie|sauvegard|synchro|effac|navigateur|masquer|développement|local/i.test(l));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Le banc : les builds, le navigateur
// ─────────────────────────────────────────────────────────────────────────────────────────────

let bac: Bac | undefined;
let chrome: Browser | undefined;
const dossiers = {} as Record<Sorte, string>;

const bacPrêt = () => {
  if (!bac || !chrome) throw new Error('le banc du harnais de #142 ne s\'est pas monté');
  return { bac, chrome };
};

beforeAll(async () => {
  if (!navigateur) return;
  bac = créerLeBac();
  chrome = await puppeteer.launch({ executablePath: navigateur, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=BackForwardCache'] });
  // L'un après l'autre : ils partagent le dossier d'essai.
  for (const sorte of ['tag', 'forcée', 'main', 'main-suivant', 'pr'] as const) dossiers[sorte] = await jouerLaCI(bac, sorte);
  dossiers['local'] = await construireEnLocal(bac);
}, 1_200_000);

afterAll(async () => {
  await chrome?.close();
  if (bac) for (const d of [bac.dossier, bac.bin, bac.temp, bac.sites]) rmSync(d, { recursive: true, force: true });
});

/** Ce que dit un site, sorte par sorte : une page neuve, l'accueil, puis la recherche en deux gestes. */
const lectures = new Map<string, Promise<Trouvé | undefined>>();

function versionDe(sorte: Sorte, cherche: (l: Lecture) => boolean, largeur = 375, hauteur = 812): Promise<Trouvé | undefined> {
  const clé = `${sorte}@${largeur}`;
  const déjà = lectures.get(clé);
  if (déjà) return déjà;
  const p = (async () => {
    const { chrome: c } = bacPrêt();
    const préfixe = sorte === 'pr' ? `/pr-${PR}/` : '/';
    const serveur = await servir({ [préfixe]: dossiers[sorte] });
    const page = await ouvrirVide(siteDe(`${serveur.url}${préfixe.slice(1)}`, c), largeur, hauteur);
    try {
      return await trouver(page, cherche);
    } finally {
      await page.close().catch(() => {});
      await serveur.fermer();
    }
  })();
  lectures.set(clé, p);
  return p;
}

const CHERCHE = (): Record<Sorte, (l: Lecture) => boolean> => {
  const { bac: b } = bacPrêt();
  return {
    tag: dit.nom(TAG),
    forcée: dit.nom(`${TAG}-${court(b.c1)}`),
    main: dit.main(court(b.c1)),
    'main-suivant': dit.main(court(b.c2)),
    pr: dit.pr(PR),
    local: dit.local,
  };
};

const vu = (l: Lecture | undefined) => (l ? `« ${l.texte.replace(/\s+/g, ' ').slice(0, 260)} »` : 'rien');

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 1. La version se lit
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe.skipIf(!navigateur)('#142 · 1. la version se lit', () => {
  describe('[niveau 2] le nom de chaque sorte de build (D83, « Livraison »)', () => {
    it('une version publiée dit le nom de son tag', async () => {
      const t = await versionDe('tag', CHERCHE().tag);
      expect(t, `depuis l'accueil, en deux gestes au plus, rien ne dit « ${TAG} », le nom du tag`).toBeDefined();
    });

    it('une version forcée dit son nom : le dernier numéro publié, un tiret, le hash court du commit', async () => {
      const { bac: b } = bacPrêt();
      const t = await versionDe('forcée', CHERCHE().forcée);
      expect(t, `depuis l'accueil, en deux gestes au plus, rien ne dit « ${TAG}-${court(b.c1)} », le nom de la version forcée`).toBeDefined();
    });

    it('main, à la recette : le développement, main et le commit', async () => {
      const { bac: b } = bacPrêt();
      const t = await versionDe('main', CHERCHE().main);
      expect(t, `depuis l'accueil, en deux gestes au plus, rien ne dit à la fois « développement », « main » et le commit ${court(b.c1)}`).toBeDefined();
    });

    it('une PR : le développement et son numéro', async () => {
      const t = await versionDe('pr', CHERCHE().pr);
      expect(t, `depuis l'accueil, en deux gestes au plus, rien ne dit à la fois « développement » et « PR ${PR} »`).toBeDefined();
    });

    it('un build local dit le développement, sans numéro inventé', async () => {
      const t = await versionDe('local', CHERCHE().local);
      expect(t, `depuis l'accueil, en deux gestes au plus, aucun élément ne parle de version en disant « local » ou « développement » sans numéro pointé (un numéro serait inventé : le build local n'a pas de tag, et le dépôt d'essai en porte un, ${TAG}, sur un commit plus ancien)`).toBeDefined();
    });

    it('un tag ne dit pas le nom d\'une version forcée, ni l\'inverse', async () => {
      const { bac: b } = bacPrêt();
      const tag = await versionDe('tag', CHERCHE().tag);
      const forcée = await versionDe('forcée', CHERCHE().forcée);
      expect(tag, `la version publiée ne dit pas son nom, ${TAG}`).toBeDefined();
      expect(forcée, `la version forcée ne dit pas son nom, ${TAG}-${court(b.c1)}`).toBeDefined();
      expect(dit.commit(court(b.c1))(tag!.lecture), `la version publiée ${TAG} dit un hash de commit qui n'est pas le sien`).toBe(false);
      expect(dit.nom(TAG)(forcée!.lecture), `la version forcée se dit sous le nom du tag ${TAG} seul`).toBe(false);
    });
  });

  describe('[niveau 1] I5 · en deux gestes au plus depuis l\'accueil, sur un téléphone comme sur un ordinateur', () => {
    it('la version d\'une PR se lit en deux gestes au plus depuis l\'accueil, à 375 px', async () => {
      const t = await versionDe('pr', CHERCHE().pr);
      expect(t, 'la version ne se lit pas en deux gestes au plus depuis l\'accueil').toBeDefined();
      expect(t!.par.length).toBeLessThanOrEqual(2);
    });

    it('la version de main se lit en deux gestes au plus depuis l\'accueil, à 1280 px comme à 375 px', async () => {
      const t = await versionDe('main', CHERCHE().main, 1280, 800);
      expect(t, 'à 1280 px, la version de main ne se lit pas en deux gestes au plus depuis l\'accueil').toBeDefined();
      expect(t!.par.length).toBeLessThanOrEqual(2);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 2 à 4. Une mise à jour, sa version, ce qu'elle laisse
// ═════════════════════════════════════════════════════════════════════════════════════════════

interface Observation {
  /** Où la version se lisait avant. */
  avant?: Trouvé | undefined;
  signalAvant?: Signal | undefined;
  /** Le signal, après le retour sur l'onglet. */
  signal?: Signal | undefined;
  rechargéSeul: boolean;
  /** Ce que la page disait pendant que la mise à jour était prête. */
  pendant: { ancienne: boolean; nouvelle: boolean };
  travail: { onglets: boolean; modale: boolean; recouvert: boolean; dialogues: string[] };
  coussinAvant: string;
  planAvant: string[];
  /** Après avoir ignoré, puis rouvert ; ou après avoir accepté. */
  après: { rechargé: boolean; ancienne: boolean; nouvelle: boolean; signalRevenu: boolean; coussin: string; plan: string[] };
  cliquéSurLeSignal: boolean;
  texteDuSignal?: string | undefined;
}

/** Les trois façons de jouer la mise à jour ; voir `scénario`. */
type Mode = 'ignorer' | 'accepter' | 'accepter-à-la-première-visite';

/**
 * Une page ouverte sur la version A (le commit C1 de main), l'exemple chargé et une donnée saisie ;
 * le serveur passe à la version B (C2) pendant que l'onglet est caché ; l'utilisateur revient.
 * `ignorer` : il ne touche pas au signal, travaille, puis rouvre l'application. `accepter` : il
 * recharge par la commande du signal.
 */
async function scénario(mode: Mode): Promise<Observation> {
  const { bac: b, chrome: c } = bacPrêt();
  const A = court(b.c1);
  const B = court(b.c2);
  const serveur = await servir({ '/': dossiers['main'] });
  const obs: Observation = {
    rechargéSeul: false,
    pendant: { ancienne: false, nouvelle: false },
    travail: { onglets: false, modale: false, recouvert: false, dialogues: [] },
    coussinAvant: '',
    planAvant: [],
    après: { rechargé: false, ancienne: false, nouvelle: false, signalRevenu: false, coussin: '', plan: [] },
    cliquéSurLeSignal: false,
  };
  let page: Page | undefined;
  try {
    page = await ouvrirLExemple(siteDe(serveur.url, c));
    const p = page;
    const dialogues: string[] = [];
    p.on('dialog', (d) => {
      dialogues.push(d.message());
      void d.dismiss();
    });
    let navigations = 0;
    p.on('framenavigated', (f) => {
      if (f === p.mainFrame()) navigations += 1;
    });
    await attendreLeServiceWorker(p);
    if (mode !== 'accepter-à-la-première-visite') {
      // Un utilisateur qui revient : la page qu'il a sous les yeux est déjà sous le contrôle du service
      // worker, comme après toute visite qui suit la première. À la première visite, sans rechargement
      // depuis, elle ne l'est pas encore : c'est le troisième mode.
      await p.reload({ waitUntil: 'networkidle0' });
      await attendrePrête(p);
      await attendreLeServiceWorker(p, true);
    }

    await réglerLeCoussin(p, '137,42');
    obs.coussinAvant = await lireLeCoussin(p);
    obs.planAvant = await plan(p);
    obs.avant = await trouver(p, dit.main(A));
    const chemin = obs.avant?.par;
    await àLAccueil(p);
    obs.signalAvant = await signal(p);
    await p.evaluate(() => ((window as unknown as { __jeton?: string }).__jeton = 'A'));
    navigations = 0;

    // L'utilisateur quitte l'onglet ; la version B est déposée ; il revient.
    await quitterEtRevenir(p, async () => {
      serveur.montages['/'] = dossiers['main-suivant'];
      await pause(300);
    });
    obs.signal = await attendre(() => signal(p), 25_000);
    obs.texteDuSignal = obs.signal?.texte;
    await pause(4_000);
    const jeton = await p.evaluate(() => (window as unknown as { __jeton?: string }).__jeton).catch(() => 'navigation');
    obs.rechargéSeul = navigations > 0 || jeton !== 'A';

    if (!obs.rechargéSeul) {
      const l = await (chemin ? suivre(p, chemin) : lire(p));
      obs.pendant = { ancienne: dit.main(A)(l), nouvelle: dit.main(B)(l) };
    }

    if (mode === 'ignorer') {
      // Il ne touche pas au signal, et travaille.
      let onglets = true;
      for (const o of ['Opérations', 'Bilan', 'Plan']) {
        await allerÀ(p, o);
        const actif = await p.evaluate(() => document.querySelector('.tabbar button.active')?.textContent?.trim() ?? '').catch(() => '');
        onglets &&= actif.includes(o);
      }
      const bloque = await p
        .evaluate(() => {
          const modale = !!document.querySelector('dialog[open], [aria-modal="true"]');
          const boutons = [...document.querySelectorAll('.tabbar button')] as HTMLElement[];
          const recouvert = boutons.some((x) => {
            const r = x.getBoundingClientRect();
            const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !dessus || !x.contains(dessus);
          });
          return { modale, recouvert };
        })
        .catch(() => ({ modale: true, recouvert: true }));
      obs.travail = { onglets, modale: bloque.modale, recouvert: bloque.recouvert, dialogues };
      obs.après.coussin = await lireLeCoussin(p);
      obs.après.plan = await plan(p);

      // L'ouverture suivante : la fenêtre quitte l'application, plus aucune page ne l'exécute (la page
      // quittée n'est pas gardée en mémoire : voir le lancement du navigateur), puis elle y revient.
      // Une autre fenêtre aurait sa propre base et ne prouverait rien : c'est la même.
      await p.goto('about:blank');
      await pause(1_500);
      await p.goto(serveur.url, { waitUntil: 'networkidle0' });
      await attendrePrête(p);
      const l = await (chemin ? suivre(p, chemin) : lire(p));
      obs.après.rechargé = true;
      obs.après.ancienne = dit.main(A)(l);
      obs.après.nouvelle = dit.main(B)(l);
      obs.après.signalRevenu = !!(await signal(p));
      obs.après.coussin = await lireLeCoussin(p);
      obs.après.plan = await plan(p);
    } else if (obs.signal) {
      obs.cliquéSurLeSignal = await accepter(p);
      const fin = Date.now() + 30_000;
      let rechargé = false;
      while (Date.now() < fin) {
        const j = await p.evaluate(() => (window as unknown as { __jeton?: string }).__jeton).catch(() => 'navigation');
        if (j === undefined) {
          rechargé = true;
          break;
        }
        await pause(250);
      }
      if (rechargé) await attendrePrête(p).catch(() => {});
      obs.après.rechargé = rechargé;
      const l = await (chemin ? suivre(p, chemin) : lire(p));
      obs.après.ancienne = dit.main(A)(l);
      obs.après.nouvelle = dit.main(B)(l);
      await pause(3_000);
      await àLAccueil(p);
      obs.après.signalRevenu = !!(await signal(p));
      obs.après.coussin = await lireLeCoussin(p);
      obs.après.plan = await plan(p);
    }
    return obs;
  } finally {
    await page?.close().catch(() => {});
    await serveur.fermer();
  }
}

const scénarios = new Map<string, Promise<Observation>>();
const jouer = (mode: Mode) => {
  const déjà = scénarios.get(mode);
  if (déjà) return déjà;
  const p = scénario(mode);
  scénarios.set(mode, p);
  return p;
};

describe.skipIf(!navigateur)('#142 · 2 à 4. une mise à jour prête', () => {
  describe('[niveau 2] pas de faux signal', () => {
    it('tant que rien de plus récent n\'est prêt, l\'application ne signale aucune mise à jour', async () => {
      const o = await jouer('ignorer');
      expect(o.avant, `la version de départ ne se lit pas (${vu(undefined)}) : rien ne dit « développement », « main » et le commit`).toBeDefined();
      expect(o.signalAvant, `un signal de mise à jour paraît alors que la version servie n'a pas changé : « ${o.signalAvant?.texte} »`).toBeUndefined();
    });
  });

  describe('[niveau 1] 3 · une mise à jour se dit, sans recharger d\'office (C8, principe 4)', () => {
    it('au retour sur l\'onglet, l\'application signale la mise à jour et propose de recharger', async () => {
      const o = await jouer('ignorer');
      expect(o.signal, 'vingt-cinq secondes après le retour sur l\'onglet, aucun élément visible ne dit « mise à jour » (ou « nouvelle version », « plus récente ») avec une commande « Recharger », « Actualiser » ou « Mettre à jour »').toBeDefined();
    });

    it('rien ne se recharge à l\'insu de l\'utilisateur', async () => {
      const o = await jouer('ignorer');
      expect(o.rechargéSeul, 'la page s\'est rechargée d\'elle-même (une navigation, ou l\'état de la page perdu) alors que l\'utilisateur n\'avait rien demandé').toBe(false);
      expect(o.signal, 'aucun signal n\'a paru : la page est restée telle quelle sans rien dire, ce qui ne prouve pas qu\'elle ne recharge jamais d\'elle-même').toBeDefined();
    });
  });

  describe('[niveau 1] 2 · ce qui s\'affiche est la version qui tourne, pas la dernière disponible (C8)', () => {
    it('pendant que la mise à jour est prête, la page dit encore la version qu\'elle exécute', async () => {
      const o = await jouer('ignorer');
      expect(o.rechargéSeul, 'la page s\'est rechargée : impossible de lire ce qu\'elle disait pendant').toBe(false);
      expect(o.pendant.ancienne, 'la page n\'annonce plus la version qu\'elle exécute (le commit de départ)').toBe(true);
      expect(o.pendant.nouvelle, 'la page annonce la version disponible, pas celle qu\'elle exécute').toBe(false);
    });
  });

  describe('[niveau 1] 4 · ignorer le signal laisse travailler ; la nouvelle version s\'exécute à l\'ouverture suivante', () => {
    it('sans toucher au signal, chaque onglet reste sous le doigt : ni fenêtre, ni voile, ni boîte de dialogue', async () => {
      const o = await jouer('ignorer');
      expect(o.signal, 'aucun signal n\'a paru : rien à ignorer').toBeDefined();
      expect(o.travail.onglets, 'un onglet de la barre du bas ne répond plus une fois le signal paru').toBe(true);
      expect(o.travail.modale, 'le signal ouvre une fenêtre modale').toBe(false);
      expect(o.travail.recouvert, 'un onglet est recouvert par autre chose (le signal ?)').toBe(false);
      expect(o.travail.dialogues, `le signal ouvre une boîte de dialogue : ${o.travail.dialogues.join(' | ')}`).toEqual([]);
    });

    it('à l\'ouverture suivante, la page exécute la nouvelle version et le dit', async () => {
      const o = await jouer('ignorer');
      expect(o.après.nouvelle, 'rouverte après avoir ignoré le signal, la page ne dit pas la nouvelle version').toBe(true);
      expect(o.après.ancienne, 'rouverte, la page dit encore l\'ancienne version').toBe(false);
    });
  });

  describe('[niveau 0] 4 · ignorer, ou recharger, ne perd rien de ce qui a été saisi', () => {
    it('ignorer le signal, puis rouvrir : la donnée saisie et le plan sont là', async () => {
      const o = await jouer('ignorer');
      expect(o.signal, 'aucun signal n\'a paru : il n\'y a rien à ignorer, et ce test ne prouverait rien').toBeDefined();
      expect(o.coussinAvant, 'la donnée de départ n\'a pas pu s\'enregistrer (Réglages, coussin)').not.toBe('');
      expect(o.après.coussin, 'le coussin saisi n\'est plus là').toBe(o.coussinAvant);
      expect(o.après.plan, 'le plan n\'est plus celui d\'avant').toEqual(o.planAvant);
    });

    it('accepter la mise à jour : la page se recharge, et la donnée saisie et le plan sont toujours là', async () => {
      const o = await jouer('accepter');
      expect(o.signal, 'pas de signal à accepter').toBeDefined();
      expect(o.cliquéSurLeSignal, 'la commande du signal n\'a pas pu être touchée').toBe(true);
      expect(o.après.rechargé, 'accepter le signal ne recharge pas la page').toBe(true);
      expect(o.après.coussin, 'le coussin saisi n\'est plus là après le rechargement').toBe(o.coussinAvant);
      expect(o.après.plan, 'le plan n\'est plus celui d\'avant après le rechargement').toEqual(o.planAvant);
    });
  });

  describe('[niveau 1] 4 · accepter recharge la page, qui exécute la nouvelle version et le dit', () => {
    it('après avoir accepté, la page dit la nouvelle version et plus l\'ancienne', async () => {
      const o = await jouer('accepter');
      expect(o.après.rechargé, 'accepter le signal ne recharge pas la page').toBe(true);
      expect(o.après.nouvelle, 'rechargée, la page ne dit pas la nouvelle version').toBe(true);
      expect(o.après.ancienne, 'rechargée, la page dit encore l\'ancienne version').toBe(false);
    });
  });

  describe('[niveau 1] 4 · accepter recharge la page, même ouverte à la première visite et jamais rechargée depuis', () => {
    it('la commande du signal recharge la page, qui dit la nouvelle version', async () => {
      const o = await jouer('accepter-à-la-première-visite');
      expect(o.signal, 'pas de signal à accepter').toBeDefined();
      expect(o.cliquéSurLeSignal, 'la commande du signal n\'a pas pu être touchée').toBe(true);
      expect(o.après.rechargé, 'la commande du signal ne fait rien : la page reste sur l\'ancienne version, et le signal aussi').toBe(true);
      expect(o.après.nouvelle, 'rechargée, la page ne dit pas la nouvelle version').toBe(true);
      expect(o.après.ancienne, 'rechargée, la page dit encore l\'ancienne version').toBe(false);
    });
  });

  describe('[niveau 2] la mise à jour faite, le signal ne revient pas', () => {
    it('après avoir rechargé, aucun signal ne demande de recharger encore', async () => {
      const o = await jouer('accepter');
      expect(o.après.rechargé, 'accepter le signal ne recharge pas la page').toBe(true);
      expect(o.après.signalRevenu, 'le signal de mise à jour est encore là après le rechargement').toBe(false);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 5. Ce qui tenait tient encore
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe.skipIf(!navigateur)('#142 · 5. ce qui tenait tient encore', () => {
  describe('[niveau 2] hors ligne, après une première visite', () => {
    /** Une première visite, le service worker installé, puis la page rouverte sans réseau. */
    async function rouvrirSansRéseau<T>(suite: (page: Page) => Promise<T>): Promise<T> {
      const { chrome: c } = bacPrêt();
      const serveur = await servir({ '/': dossiers['main'] });
      const page = await ouvrirVide(siteDe(serveur.url, c));
      try {
        expect(await attendreLeServiceWorker(page), 'le service worker n\'est pas actif après la première visite').toBe(true);
        await page.setOfflineMode(true);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await attendrePrête(page);
        return await suite(page);
      } finally {
        await page.setOfflineMode(false).catch(() => {});
        await page.close().catch(() => {});
        await serveur.fermer();
      }
    }

    it('l\'application s\'ouvre sans réseau', async () => {
      await rouvrirSansRéseau(async (page) => {
        const panne = await page.evaluate(() => {
          const t = document.querySelector('main')?.textContent ?? '';
          return /Impossible d.ouvrir la base/.test(t) ? t.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
        });
        expect(panne, `sans réseau, l'application ne s'ouvre pas : ${panne}`).toBe('');
        const onglets = await libellés(page, '.tabbar button');
        expect(onglets.length, 'sans réseau, la barre d\'onglets n\'est pas là').toBeGreaterThan(0);
      });
    });

    it('la version se lit encore sans réseau', async () => {
      const { bac: b } = bacPrêt();
      await rouvrirSansRéseau(async (page) => {
        const t = await trouver(page, dit.main(court(b.c1)));
        expect(t, 'sans réseau, la version ne se lit plus en deux gestes au plus').toBeDefined();
      });
    });
  });

  describe('[niveau 2] D83, livraison (#233) · chaque aperçu reste servi par lui-même', () => {
    it('après une visite à la recette, l\'aperçu d\'une PR est servi par son propre service worker, de portée /pr-<n>/', async () => {
      const { chrome: c } = bacPrêt();
      const serveur = await servir({ '/': dossiers['main'], [`/pr-${PR}/`]: dossiers['pr'] });
      const page = await ouvrirVide(siteDe(serveur.url, c));
      try {
        await attendreLeServiceWorker(page);
        await page.goto(`${serveur.url}pr-${PR}/`, { waitUntil: 'networkidle0' });
        await attendrePrête(page);
        const portée = await attendre(async () => {
          const s = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope ?? '').catch(() => '');
          return s.endsWith(`/pr-${PR}/`) ? s : undefined;
        }, 10_000);
        expect(portée, `l'aperçu n'a pas son propre service worker, de portée /pr-${PR}/`).toBeDefined();
        const script = await page.evaluate(() => Array.from(document.scripts).map((s) => s.src).filter(Boolean));
        expect(script.length, 'aucun script dans l\'aperçu').toBeGreaterThan(0);
        for (const s of script) expect(new URL(s).pathname, `l'aperçu charge un script hors de /pr-${PR}/ : ${s}`).toContain(`/pr-${PR}/`);
      } finally {
        await page.close().catch(() => {});
        await serveur.fermer();
      }
    });

    it('après une visite à la recette, l\'aperçu d\'une PR dit sa propre version', async () => {
      const { chrome: c, bac: b } = bacPrêt();
      const serveur = await servir({ '/': dossiers['main'], [`/pr-${PR}/`]: dossiers['pr'] });
      const page = await ouvrirVide(siteDe(serveur.url, c));
      try {
        await attendreLeServiceWorker(page);
        await page.goto(`${serveur.url}pr-${PR}/`, { waitUntil: 'networkidle0' });
        await attendrePrête(page);
        const t = await trouver(page, dit.pr(PR));
        const dansLAperçu = await page.evaluate(() => document.body.innerText);
        expect(t, `l'aperçu de la PR ${PR}, ouvert après la recette, ne dit pas sa version (page : « ${dansLAperçu.replace(/\s+/g, ' ').slice(0, 200)} »)`).toBeDefined();
        expect(t && dit.commit(court(b.c1))(t.lecture), 'l\'aperçu dit la version de la recette').toBeFalsy();
      } finally {
        await page.close().catch(() => {});
        await serveur.fermer();
      }
    });

    it('après une visite à un aperçu, la recette dit sa propre version', async () => {
      const { chrome: c, bac: b } = bacPrêt();
      const serveur = await servir({ '/': dossiers['main'], [`/pr-${PR}/`]: dossiers['pr'] });
      const page = await ouvrirVide(siteDe(`${serveur.url}pr-${PR}/`, c));
      try {
        await attendreLeServiceWorker(page);
        await page.goto(serveur.url, { waitUntil: 'networkidle0' });
        await attendrePrête(page);
        const t = await trouver(page, dit.main(court(b.c1)));
        expect(t, 'la recette ne dit pas sa version après une visite à un aperçu').toBeDefined();
        expect(t && dit.pr(PR)(t.lecture), 'la recette dit la version d\'un aperçu').toBeFalsy();
      } finally {
        await page.close().catch(() => {});
        await serveur.fermer();
      }
    });

    it('après une visite à un aperçu, la recette est servie par son propre service worker, de portée /', async () => {
      const { chrome: c } = bacPrêt();
      const serveur = await servir({ '/': dossiers['main'], [`/pr-${PR}/`]: dossiers['pr'] });
      const page = await ouvrirVide(siteDe(`${serveur.url}pr-${PR}/`, c));
      try {
        await attendreLeServiceWorker(page);
        await page.goto(serveur.url, { waitUntil: 'networkidle0' });
        await attendrePrête(page);
        const portée = await attendre(async () => {
          const s = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope ?? '').catch(() => '');
          return s && !s.includes('/pr-') ? s : undefined;
        }, 10_000);
        expect(portée, 'la recette n\'a pas son propre service worker, de portée /').toBeDefined();
      } finally {
        await page.close().catch(() => {});
        await serveur.fermer();
      }
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D85 · Les textes vouvoient
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Un tutoiement : un pronom de la deuxième personne du singulier, ou un impératif qui la porte. */
const TUTOIEMENT = /\b(?:tu|toi|ton|ta|tes)\b|\bt['’]|\b(?:recharge|actualise|mets|clique|appuie|relance|redémarre|profite|installe|choisis|attends)\b/i;

describe.skipIf(!navigateur)('#142 · D85', () => {
  describe('[niveau 2] D85 · les textes que la version et la mise à jour ajoutent vouvoient', () => {
    it('ni le signal de mise à jour ni la ligne de la version ne tutoient', async () => {
      const o = await jouer('ignorer');
      expect(o.texteDuSignal, 'pas de signal à relire').toBeDefined();
      expect(o.texteDuSignal, `le signal tutoie : « ${o.texteDuSignal} »`).not.toMatch(TUTOIEMENT);
      expect(o.signal?.commande, `la commande du signal tutoie : « ${o.signal?.commande} »`).not.toMatch(TUTOIEMENT);
      const t = await versionDe('main', CHERCHE().main);
      expect(t, 'pas de version à relire').toBeDefined();
      const lignes = t!.lecture.texte.split('\n').filter((l) => /version|développement|main/i.test(l));
      for (const l of lignes) expect(l, `une ligne de la version tutoie : « ${l} »`).not.toMatch(TUTOIEMENT);
    });
  });
});
