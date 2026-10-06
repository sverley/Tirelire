/**
 * Tests du codeur de #199 — « Le format du fichier est documenté, et un test tient la documentation
 * à jour (D58) ». Tous de niveau 4 (D83).
 *
 * `docs/format-depot-sqlite.md` décrit le format ; ces tests le confrontent au format que porte le
 * cœur (`TABLES`, `SYSTEM_SQL`, `CLES_REGLAGES`, `FORMAT_VERSION`, les formes JSON), jouent le script de
 * l'exemple minimal tel qu'il est écrit, recalculent la clé d'exemple et rejouent la commande
 * `verifier-fichier` sur les deux exemples dont le document montre la sortie. Ce que le document dit
 * en prose (points 1 à 6) se vérifie en relisant (principe 10) ; ici, ce qu'un test tranche.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ACTION,
  CLES_REGLAGES,
  COLONNES_IMPORT,
  computePlan,
  createTableSQL,
  DEFAULT_SETTINGS,
  emptyLedger,
  FILE_FORMAT,
  FORMAT_VERSION,
  LedgerStore,
  lireBase,
  normalizeLabel,
  operationKey,
  PART,
  PLACEMENT,
  parseCsv,
  parseRows,
  prepareImport,
  problemeDeForme,
  REPORT,
  RYTHME,
  SELECTION,
  settingProblem,
  SYSTEM_SQL,
  TABLE_COMPTES,
  TABLES,
  TOLERANCE,
  valueProblem,
  verifierFichier,
  type Champ,
  type ColumnDef,
  type Description,
  type ImportProfile,
  type TableDef,
} from '../src/index.js';

const RACINE = resolve(import.meta.dirname, '../../..');
const DOC = readFileSync(join(RACINE, 'docs/format-depot-sqlite.md'), 'utf-8');

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

// ---------------------------------------------------------------------------
// Lecture du document
// ---------------------------------------------------------------------------

/** Les lignes d'un document, de l'intitulé `titre` (une ligne) jusqu'au prochain intitulé de niveau 2 ou 3. */
function section(titre: string): string[] {
  const lignes = DOC.split('\n');
  const debut = lignes.findIndex((l) => l === titre);
  if (debut < 0) throw new Error(`Le document n'a pas de section « ${titre} ».`);
  const fin = lignes.findIndex((l, i) => i > debut && /^#{2,3} /.test(l));
  return lignes.slice(debut + 1, fin < 0 ? undefined : fin);
}

/** Les cellules d'une ligne de tableau : séparées par `|`, hors `\|`. */
const cellules = (ligne: string): string[] =>
  ligne
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());

type Ligne = Record<string, string>;

/** Le n-ième tableau d'une section, une ligne par rangée, indexée par l'en-tête de sa colonne. */
function tableau(lignes: string[], n = 0): Ligne[] {
  const tables: string[][] = [];
  let courante: string[] | undefined;
  for (const l of lignes) {
    if (l.startsWith('|')) {
      if (!courante) tables.push((courante = []));
      courante.push(l);
    } else courante = undefined;
  }
  const t = tables[n];
  if (!t) throw new Error(`Pas de tableau n° ${n + 1} dans la section.`);
  const entetes = cellules(t[0]!);
  return t.slice(2).map((l) => Object.fromEntries(cellules(l).map((c, i) => [entetes[i]!, c])));
}

/** Les blocs de code d'un langage, dans l'ordre. */
function blocs(lignes: string[], langage: string): string[] {
  const out: string[] = [];
  let cur: string[] | undefined;
  for (const l of lignes) {
    if (cur === undefined) {
      if (l === '```' + langage) cur = [];
    } else if (l === '```') {
      out.push(cur.join('\n'));
      cur = undefined;
    } else cur.push(l);
  }
  return out;
}

/** Ce qui est entre accents graves dans une cellule, `\|` lu `|`. */
const codes = (cellule: string): string[] => [...cellule.matchAll(/`([^`]*)`/g)].map((m) => m[1]!);

const oui = (cellule: string | undefined): boolean => (cellule ?? '').startsWith('oui');

const sqlType = (col: ColumnDef): string => (col.type === 'integer' || col.type === 'boolean' ? 'INTEGER' : col.type === 'real' ? 'REAL' : 'TEXT');

const TOUTES = Object.values(TABLES);

// ---------------------------------------------------------------------------
// 8. Le document et le format ne divergent pas
// ---------------------------------------------------------------------------

describe('[niveau 4] #199 · 8. les tables et les colonnes du document sont celles du format', () => {
  it('chaque table du format a sa section, et le document n’en décrit aucune autre', () => {
    const titres = [...DOC.matchAll(/^### Table `([^`]+)`$/gm)].map((m) => m[1]!);
    expect(titres.sort()).toEqual([...TOUTES.map((t) => t.name), 'settings', 'meta'].sort());
  });

  for (const t of TOUTES) {
    it(`${t.name} : les colonnes, leurs types, leur caractère obligatoire, leurs valeurs et leurs références`, () => {
      const rangees = tableau(section(`### Table \`${t.name}\``));
      const doc = new Map(rangees.map((r) => [codes(r['Colonne']!)[0]!, r]));
      expect([...doc.keys()].sort(), `colonnes de ${t.name}`).toEqual([...t.columns.map((c) => c.col), 'hlc'].sort());
      for (const col of t.columns) verifierColonne(t, col, doc.get(col.col)!);
      // L'horloge n'est jamais obligatoire dans un fichier fabriqué : elle se date à l'ouverture.
      const hlc = doc.get('hlc')!;
      expect(hlc['Type'], `${t.name}.hlc : type`).toBe('TEXT');
      expect(oui(hlc['Obligatoire']), `${t.name}.hlc : obligatoire`).toBe(false);
      expect(oui(hlc['Peut manquer']), `${t.name}.hlc : peut manquer`).toBe(true);
    });

    it(`${t.name} : les contraintes de table sont nommées`, () => {
      for (const k of t.constraints ?? []) expect(DOC, `contrainte ${k.name}`).toContain(`\`${k.name}\``);
    });
  }

  function verifierColonne(t: TableDef, col: ColumnDef, r: Ligne): void {
    const nom = `${t.name}.${col.col}`;
    expect(r['Type'], `${nom} : type`).toBe(sqlType(col));
    expect(oui(r['Obligatoire']), `${nom} : obligatoire`).toBe(col.col === 'id' || !!col.required);
    expect(oui(r['Peut manquer']), `${nom} : peut manquer`).toBe(!(col.col === 'id' || col.required));
    expect(r['Origine'], `${nom} : origine`).toMatch(/^(saisie|importée|établie)( ou (saisie|importée|établie))?$/);
    const valeurs = r['Valeurs admises']!;
    const attendues = col.type === 'boolean' ? ['0', '1'] : col.values?.map((v) => (v === '\t' ? '<tabulation>' : v));
    if (attendues) expect(codes(valeurs).sort(), `${nom} : valeurs admises`).toEqual([...attendues].sort());
    else if (col.form === 'date') expect(valeurs, `${nom} : forme`).toContain('AAAA-MM-JJ');
    else if (col.form === 'instant') expect(valeurs, `${nom} : forme`).toContain('AAAA-MM-JJTHH:MM:SS.mmmZ');
    else if (col.type === 'json') expect(valeurs, `${nom} : forme JSON`).toMatch(/^JSON, forme « [^»]+ »$/);
    const designe = r['Désigne']!;
    if (col.ref) expect(codes(designe), `${nom} : table désignée`).toEqual([col.ref]);
    else expect(designe, `${nom} : ne désigne aucune table`).toBe('—');
    if (col.shape) expect(NOMMEES.get(/« ([^»]+) »/.exec(valeurs)![1]!), `${nom} : forme JSON désignée`).toBe(col.shape);
  }

  it('settings et meta : leurs colonnes, types et caractère obligatoire sont ceux de leur CREATE TABLE', () => {
    const db = new SQL.Database();
    for (const sql of SYSTEM_SQL) db.run(sql);
    for (const nom of ['settings', 'meta']) {
      const reel = (db.exec(`PRAGMA table_info(${nom})`)[0]?.values ?? []).map((r) => ({ col: r[1] as string, type: r[2] as string, notnull: r[3] === 1 }));
      const doc = tableau(section(`### Table \`${nom}\``));
      const attendues = nom === 'settings' ? reel.filter((c) => c.col !== 'hlc') : reel;
      const dites = doc.filter((r) => codes(r['Colonne']!)[0] !== 'hlc');
      expect(dites.map((r) => codes(r['Colonne']!)[0]).sort(), `colonnes de ${nom}`).toEqual(attendues.map((c) => c.col).sort());
      for (const c of attendues) {
        const r = dites.find((x) => codes(x['Colonne']!)[0] === c.col)!;
        expect(r, `${nom}.${c.col} : absente du document`).toBeDefined();
        expect(r['Type'], `${nom}.${c.col} : type`).toBe(c.type);
        expect(oui(r['Obligatoire']), `${nom}.${c.col} : obligatoire`).toBe(c.notnull);
        // Une colonne de `meta` ne peut jamais manquer : le fichier est alors refusé (#199, point 11).
        expect(oui(r['Peut manquer']), `${nom}.${c.col} : peut manquer`).toBe(nom === 'meta' ? false : !c.notnull);
      }
      if (nom === 'settings') expect(doc.find((r) => codes(r['Colonne']!)[0] === 'hlc'), 'settings.hlc').toBeDefined();
    }
    db.close();
  });

  it('le CREATE TABLE de chaque table dit les mêmes types et le même NOT NULL que le tableau du document', () => {
    const db = new SQL.Database();
    for (const t of TOUTES) {
      db.run(createTableSQL(t));
      const reel = (db.exec(`PRAGMA table_info(${t.name})`)[0]?.values ?? []).map((r) => ({ col: r[1] as string, type: r[2] as string, notnull: r[3] === 1 }));
      const doc = tableau(section(`### Table \`${t.name}\``));
      for (const c of reel.filter((x) => x.col !== 'hlc')) {
        const r = doc.find((x) => codes(x['Colonne']!)[0] === c.col)!;
        expect(r, `${t.name}.${c.col} : absente du document`).toBeDefined();
        expect(r['Type'], `${t.name}.${c.col} : type SQL`).toBe(c.type);
        expect(oui(r['Obligatoire']), `${t.name}.${c.col} : NOT NULL`).toBe(c.notnull);
      }
    }
    db.close();
  });

  it('seules deux colonnes portent un horodatage, et le document le dit', () => {
    const colonnes = TOUTES.flatMap((t) => t.columns.filter((c) => c.form === 'instant').map((c) => `${t.name}.${c.col}`));
    expect(colonnes.every((c) => /\.(deleted_at|last_seen)$/.test(c))).toBe(true);
    expect(DOC).toContain('`deleted_at` et `devices.last_seen`');
  });
});

/**
 * Les clés de `meta` que le format admet, telles que la vérification les dit : un fichier qui porte une
 * clé de plus est refusé en nommant celles du format.
 */
function clesDeMeta(): string[] {
  const db = new SQL.Database();
  for (const sql of SYSTEM_SQL) db.run(sql);
  db.run(`INSERT INTO meta (key, value) VALUES ('format', ?), ('format_version', ?), ('autre', 'x')`, [FILE_FORMAT, String(FORMAT_VERSION)]);
  const octets = db.export();
  db.close();
  const lecture = lireBaseDe(octets);
  const dit = lecture.problemes.find((p) => p.table === 'meta' && p.id === 'autre');
  const m = /meta ne porte que (.+)\.$/.exec(dit?.message ?? '');
  if (!m) throw new Error(`La vérification ne dit pas les clés de meta : ${dit?.message ?? 'aucun problème'}`);
  return m[1]!.split(' et ');
}

function lireBaseDe(octets: Uint8Array): ReturnType<typeof lireBase> {
  const db = new SQL.Database(octets);
  try {
    return lireBase(db);
  } finally {
    db.close();
  }
}

describe('[niveau 4] #199 · 8. les réglages, les clés de meta et la version du document sont ceux du format', () => {
  it('les réglages : les mêmes clés que le format, chacun avec son défaut', () => {
    const rangees = tableau(section('## Les réglages'));
    const doc = new Map(rangees.map((r) => [codes(r['Réglage']!)[0]!, r]));
    expect([...doc.keys()].sort(), 'réglages').toEqual([...CLES_REGLAGES].sort());
    for (const cle of CLES_REGLAGES) {
      const defaut = codes(doc.get(cle)!['Défaut']!)[0]!;
      expect(JSON.parse(defaut), `réglage ${cle} : défaut`).toEqual((DEFAULT_SETTINGS as unknown as Record<string, unknown>)[cle]);
      expect(settingProblem(cle, defaut), `réglage ${cle} : le défaut s'écrit`).toBeUndefined();
    }
    // Ce qui décrit une instance n'est pas un réglage du format.
    expect(settingProblem('siteId', '"x"')).toBeDefined();
    expect(DOC).toContain('comme `siteId`, fait refuser le fichier');
  });

  it('les clés de meta : les mêmes que le format, avec le marqueur et la version que l’application écrit', () => {
    const rangees = tableau(section('### Table `meta`'), 1);
    const doc = new Map(rangees.map((r) => [codes(r['Clé de `meta`']!)[0]!, r]));
    expect([...doc.keys()].sort(), 'clés de meta').toEqual(clesDeMeta().sort());
    expect(codes(doc.get('format')!['Valeur']!), 'meta « format » : valeur').toEqual([FILE_FORMAT]);
    expect(codes(doc.get('format_version')!['Valeur']!), 'meta « format_version » : valeur').toEqual([String(FORMAT_VERSION)]);
  });

  it('la version du format décrite est celle que l’application écrit', () => {
    const db = new SQL.Database();
    for (const sql of SYSTEM_SQL) db.run(sql);
    db.run(`INSERT INTO meta (key, value) VALUES ('format', ?), ('format_version', ?)`, [FILE_FORMAT, String(FORMAT_VERSION)]);
    const [marqueur, version] = (db.exec(`SELECT value FROM meta ORDER BY key`)[0]?.values ?? []).map((r) => r[0]);
    db.close();
    const texte = section('### La version du format').join('\n');
    expect(texte).toContain(`est **${String(version)}**`);
    expect(texte).toContain(`comme le texte \`${String(version)}\``);
    expect(texte).toContain(`valant \`${String(marqueur)}\``);
    expect(DOC).toContain(`version ${String(version)}`);
  });
});

// ---------------------------------------------------------------------------
// Les formes JSON
// ---------------------------------------------------------------------------

const NOMMEES = new Map<string, Description>([
  ['part', PART],
  ['placement', PLACEMENT],
  ['report', REPORT],
  ['rythme', RYTHME],
  ['tolérance', TOLERANCE],
  ['sélection', SELECTION],
  ['action', ACTION],
  ['colonnes', COLONNES_IMPORT],
  ['comptes', TABLE_COMPTES],
]);
const NOM_DE = new Map([...NOMMEES].map(([nom, d]) => [d, nom]));

interface Champ1 {
  champ: string;
  requis: boolean;
  ref?: string;
  quand?: string;
  forme?: string;
}

/** Les champs d'une forme, à plat, comme le document les liste : un chemin par champ. */
function aplatir(d: Description, prefixe: string): Champ1[] {
  const out: Champ1[] = [];
  const enfant = (k: string): string => (prefixe ? `${prefixe}.${k}` : k);
  const champ = (chemin: string, ch: Champ, quand?: string): void => {
    const nom = NOM_DE.get(ch.desc);
    out.push({
      champ: chemin,
      requis: !!ch.requis,
      ...(ch.desc.genre === 'valeur' && ch.desc.ref ? { ref: ch.desc.ref } : {}),
      ...(quand ? { quand } : {}),
      ...(nom ? { forme: nom } : {}),
    });
    if (!nom) out.push(...aplatir(ch.desc, chemin));
  };
  switch (d.genre) {
    case 'objet':
      for (const [k, ch] of Object.entries(d.champs)) champ(enfant(k), ch);
      break;
    case 'choix':
      out.push({ champ: enfant(d.cle), requis: true });
      for (const [cas, liste] of Object.entries(d.cas)) for (const [k, ch] of Object.entries(liste)) champ(enfant(k), ch, `${d.cle} = ${cas}`);
      break;
    case 'liste':
      out.push(...aplatir(d.de, `${prefixe}[]`));
      break;
    case 'table':
      if (d.de.genre === 'valeur') out.push({ champ: `${prefixe}{}`, requis: true, ...(d.de.ref ? { ref: d.de.ref } : {}) });
      else out.push(...aplatir(d.de, `${prefixe}{}`));
      break;
    case 'valeur':
      break;
  }
  return out;
}

describe('[niveau 4] #199 · 8. les formes JSON du document sont celles du format, et leurs exemples s’écrivent', () => {
  it('chaque forme du format a sa section, et le document n’en décrit aucune autre', () => {
    const titres = [...DOC.matchAll(/^### Forme « ([^»]+) »$/gm)].map((m) => m[1]!);
    expect(titres.sort()).toEqual([...NOMMEES.keys()].sort());
  });

  for (const [nom, forme] of NOMMEES) {
    it(`forme « ${nom} » : champs, caractère obligatoire, références et formes imbriquées`, () => {
      const rangees = tableau(section(`### Forme « ${nom} »`));
      const doc = rangees.map((r) => ({ champ: codes(r['Champ']!)[0]!, requis: oui(r['Obligatoire']), ref: codes(r['Désigne']!)[0], quand: codes(r['Seulement si']!)[0], texte: r['Forme']! }));
      const attendus = aplatir(forme, '');
      const cle = (c: { champ: string; quand?: string | undefined }): string => `${c.champ}${c.quand ? ` si ${c.quand}` : ''}`;
      expect(doc.map(cle).sort(), `champs de la forme « ${nom} »`).toEqual(attendus.map(cle).sort());
      for (const a of attendus) {
        const d = doc.find((x) => cle(x) === cle(a))!;
        expect(d.requis, `${cle(a)} de « ${nom} » : obligatoire`).toBe(a.requis);
        expect(d.ref, `${cle(a)} de « ${nom} » : table désignée`).toBe(a.ref);
        if (a.forme) expect(d.texte, `${cle(a)} de « ${nom} » : forme imbriquée`).toContain(`forme « ${a.forme} »`);
      }
    });

    it(`forme « ${nom} » : chaque exemple est accepté par la forme et par chaque colonne qui la porte`, () => {
      const exemples = blocs(section(`### Forme « ${nom} »`), 'json');
      expect(exemples.length, `exemples de « ${nom} »`).toBeGreaterThan(0);
      const colonnes = TOUTES.flatMap((t) => t.columns.filter((c) => c.shape === forme).map((c) => ({ t, c })));
      for (const e of exemples) {
        expect(problemeDeForme(`exemple « ${nom} »`, JSON.parse(e), forme), `exemple « ${nom} »`).toBeUndefined();
        for (const { t, c } of colonnes) expect(valueProblem(t, c, e), `exemple « ${nom} » dans ${t.name}.${c.col}`).toBeUndefined();
      }
    });
  }

  it('chaque colonne JSON du format désigne une forme du document', () => {
    for (const t of TOUTES)
      for (const c of t.columns.filter((x) => x.type === 'json')) expect(NOM_DE.get(c.shape!), `${t.name}.${c.col} : forme nommée`).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 9. L'exemple minimal et la clé d'exemple
// ---------------------------------------------------------------------------

const SCRIPT = blocs(section('## Un exemple minimal'), 'sql')[0]!;

/** Un fichier : le script du document collé dans une base vide, comme le ferait `sqlite3`. */
function fichierDeLExemple(apres = ''): Uint8Array {
  const db = new SQL.Database();
  db.exec(SCRIPT + '\n' + apres);
  const octets = db.export();
  db.close();
  return octets;
}

describe('[niveau 4] #199 · 9. l’exemple minimal du document', () => {
  it('collé dans une base vide, il donne un fichier que l’application ouvre', async () => {
    const verdict = await verifierFichier(fichierDeLExemple(), { sqlJs: SQL });
    expect(verdict, 'l’exemple minimal s’ouvre').toMatchObject({ ouvre: true });
    const s = await LedgerStore.create({ sqlJs: SQL, bytes: fichierDeLExemple(), verifier: true, siteId: 'ouvreur' });
    expect(s.load().settings.periodStartDay).toBe(DEFAULT_SETTINGS.periodStartDay);
  });

  it('son plan propose un virement permanent vers le compte d’accueil, ventilé sur la tirelire', async () => {
    const s = await LedgerStore.create({ sqlJs: SQL, bytes: fichierDeLExemple(), verifier: true, siteId: 'ouvreur' });
    const plan = computePlan(s.load(), '2026-10-15');
    const virement = plan.transfers.find((v) => v.accountId === 'acc-livret');
    expect(virement, 'un virement vers « acc-livret »').toBeDefined();
    expect(virement!.accountKind).toBe('epargne');
    expect(virement!.permanent).toBe(5000);
    expect(virement!.breakdown).toEqual([{ tirelireId: 'tir-vacances', tirelireName: 'Vacances', cruise: 5000 }]);
    expect(virement!.orders.map((o) => o.tirelireId)).toEqual(['tir-vacances']);
  });

  it('il ne porte que ce que son plan demande : le texte du document dit 50,00 € et le plan en demande autant', () => {
    expect(DOC).toContain('virement permanent de 50,00 €');
    expect(DOC).toContain('« Livret A »');
    expect(DOC).toContain('« Vacances »');
  });
});

describe('[niveau 4] #199 · 9. la clé d’exemple du document est celle que l’application calcule', () => {
  const section5 = section('## La clé d\'une opération importée');
  const releve = blocs(section5, 'csv')[0]!;
  const dit = (mot: string): string => new RegExp(`^- ${mot} : \`([^\`]+)\``, 'm').exec(section5.join('\n'))![1]!;
  const compte = dit('Compte');
  const rang = Number(dit('Rang'));
  const cle = dit('Clé');

  const profil: ImportProfile = {
    id: 'profil',
    name: 'Profil',
    source: 'bank',
    encoding: 'auto',
    delimiter: ';',
    headerRow: 0,
    columns: { date: 'Date', label: 'Libellé', amount: 'Montant' },
    dateFormat: 'DMY',
    accountMap: {},
    accountId: compte,
  };

  it('l’import de la ligne de relevé par l’application donne cette clé', () => {
    const lues = parseRows(parseCsv(releve, ';'), profil);
    expect(lues.errors).toEqual([]);
    expect(lues.rows).toHaveLength(1);
    const prep = prepareImport(emptyLedger(), lues.rows, profil);
    expect(prep.candidates[0]!.operation.id, 'la clé d’exemple du document').toBe(cle);
    expect(prep.candidates[0]!.operation.normalizedLabel).toBe('CARREFOUR MARKET');
  });

  it('la recette du document, écrite pas à pas, donne la même clé', () => {
    const lues = parseRows(parseCsv(releve, ';'), profil).rows[0]!;
    expect(normalizeLabel(lues.label)).toBe('CARREFOUR MARKET');
    expect(operationKey(compte, lues.date, lues.amount, normalizeLabel(lues.label), rang), 'la clé d’exemple du document').toBe(cle);
    expect(cle).toMatch(/^op_[0-9a-f]{16}$/);
    // Les entrées sont séparées par U+001F, ce que le document dit.
    expect(section5.join('\n')).toContain('U+001F');
  });

  it('une opération du fichier qui porte cette clé est reconnue comme déjà présente à l’import du même relevé', () => {
    const lues = parseRows(parseCsv(releve, ';'), profil).rows;
    const l = emptyLedger();
    l.operations.push({
      id: cle,
      accountId: compte,
      origin: 'imported',
      date: lues[0]!.date,
      label: lues[0]!.label,
      normalizedLabel: normalizeLabel(lues[0]!.label),
      amount: lues[0]!.amount,
      state: 'untreated',
    });
    const prep = prepareImport(l, lues, profil);
    expect(prep.counts, 'la clé d’exemple du document désigne la ligne importée').toMatchObject({ exact: 1, new: 0, probable: 0 });
  });

  it('une opération importée d’un autre identifiant s’ouvre, mais n’est pas reconnue comme déjà présente', async () => {
    const lues = parseRows(parseCsv(releve, ';'), profil).rows;
    const l = emptyLedger();
    l.operations.push({
      id: 'mon-identifiant',
      accountId: compte,
      origin: 'imported',
      date: lues[0]!.date,
      label: lues[0]!.label,
      normalizedLabel: normalizeLabel(lues[0]!.label),
      amount: lues[0]!.amount,
      state: 'untreated',
    });
    const prep = prepareImport(l, lues, profil);
    expect(prep.counts.exact).toBe(0);
    expect(prep.counts.probable).toBe(1);
    // Le fichier, lui, ne refuse pas l'identifiant.
    const db = new SQL.Database();
    db.exec(SCRIPT);
    db.exec(
      `CREATE TABLE operations (id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, origin TEXT NOT NULL, date TEXT NOT NULL, label TEXT NOT NULL, amount INTEGER NOT NULL, state TEXT NOT NULL);
       INSERT INTO operations VALUES ('mon-identifiant', 'acc-principal', 'imported', '2026-09-15', 'CARTE X2009 CARREFOUR MARKET 12/09', -5430, 'untreated');`,
    );
    const octets = db.export();
    db.close();
    expect(await verifierFichier(octets, { sqlJs: SQL })).toMatchObject({ ouvre: true });
  });
});

// ---------------------------------------------------------------------------
// La commande verifier-fichier, et ce que le document montre de sa sortie
// ---------------------------------------------------------------------------

/** Joue la commande du cœur sur un fichier, comme `pnpm --dir packages/core run verifier-fichier`. */
function verifierParLaCommande(octets: Uint8Array): { code: number | null; sortie: string } {
  const dossier = mkdtempSync(join(tmpdir(), 'verifier-fichier-'));
  writeFileSync(join(dossier, 'mon-budget.sqlite'), octets);
  const r = spawnSync(
    process.execPath,
    ['--experimental-transform-types', '--no-warnings', '--import', './bin/resolution-ts.mjs', 'bin/verifier-fichier.ts', 'mon-budget.sqlite'],
    { cwd: join(RACINE, 'packages/core'), env: { ...process.env, INIT_CWD: dossier }, encoding: 'utf-8' },
  );
  return { code: r.status, sortie: r.stdout.trimEnd() };
}

describe('[niveau 4] #199 · 9. la sortie de verifier-fichier montrée par le document est celle de la commande', () => {
  const textes = blocs(section('## Vérifier un fichier'), 'text');
  const sql = blocs(section('## Vérifier un fichier'), 'sql')[0]!;

  it('sur l’exemple minimal, la commande rend le texte du document, et sort 0', () => {
    const r = verifierParLaCommande(fichierDeLExemple());
    expect(r.code).toBe(0);
    expect(r.sortie).toBe(textes[0]);
  });

  it('sur l’exemple minimal avec le réglage que le document ajoute, la commande refuse comme le document le dit, et sort 1', () => {
    const r = verifierParLaCommande(fichierDeLExemple(sql));
    expect(r.code).toBe(1);
    expect(r.sortie).toBe(textes[1]);
  });
});
