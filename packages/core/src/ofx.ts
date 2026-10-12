/**
 * Lecture d'un fichier OFX (ou QFX) : les relevés de comptes bancaires (`STMTRS`) et de cartes
 * (`CCSTMTRS`) qu'il porte, et leurs opérations (`STMTTRN`).
 *
 * Deux formes se lisent de la même façon : la version 1 (en-tête `OFXHEADER:100`, balises
 * de valeur sans fermeture) et la version 2 (XML, toutes les balises fermées). L'opération lue
 * est une ligne de relevé comme celle d'un CSV (`ParsedRow`) : sa clé est celle de D09, calculée
 * par `prepareImport` sur ses date, montant, libellé et compte. L'identifiant de transaction de
 * la banque (`FITID`), le type, les soldes et les autres dates ne se lisent pas.
 */
import type { Cents, ISODate, Ledger } from './model.js';
import { daysInMonth, formatDate } from './dates.js';
import { decodeBytes } from './csv.js';
import { prepareImport, type ImportPreparation, type ParsedRow } from './importer.js';

/** Un compte ou une carte du fichier, tel que l'écran de l'import le montre. */
export interface OfxCompte {
  /** `ACCTID` ; vide quand le relevé n'en porte pas. Sert de clé de compte aux opérations lues. */
  numero: string;
  /** `CURDEF` en majuscules ; « EUR » quand le relevé n'en déclare pas. */
  devise: string;
  /** Le relevé est en euros : seul un compte en euros s'importe. */
  euro: boolean;
  /** Le relevé est celui d'une carte (`CCSTMTRS`) plutôt que d'un compte bancaire (`STMTRS`). */
  carte: boolean;
  /** Nombre de ses opérations lisibles. */
  operations: number;
}

export interface OfxLecture {
  /** Chaque compte du fichier, une fois, dans l'ordre où le fichier les donne. */
  comptes: OfxCompte[];
  /** Les opérations lisibles ; `line` est leur rang dans le fichier, à partir de 1. */
  rows: ParsedRow[];
  /** Les opérations dont la date ou le montant ne se lit pas ; `line` est leur rang dans le fichier. */
  errors: Array<{ line: number; message: string }>;
}

// ---------------------------------------------------------------------------
// Reconnaissance
// ---------------------------------------------------------------------------

/**
 * Le contenu est-il un OFX ? Version 1 : il s'ouvre sur l'en-tête `OFXHEADER:`. Version 2 : il
 * s'ouvre (après la déclaration XML et l'instruction `<?OFX …?>`) sur l'élément `<OFX>`.
 * Ne dépend pas de l'extension du fichier.
 */
export function estOfx(texte: string): boolean {
  const t = texte.replace(/^﻿/, '');
  if (/^\s*OFXHEADER\s*:/i.test(t)) return true;
  return /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<\?OFX[^>]*\?>\s*)?<OFX[\s>]/i.test(t);
}

/** Reconnaît un OFX dans les premiers octets d'un fichier, sans décoder le fichier entier. */
export function octetsOfx(octets: Uint8Array): boolean {
  return estOfx(decodeBytes(octets.subarray(0, 4096)));
}

/**
 * Lit un fichier OFX donné en octets (UTF-8 ou Windows-1252 / ISO-8859-1). `undefined` quand le
 * contenu n'est pas un OFX : l'appelant suit alors le chemin du CSV ou de l'Excel.
 */
export function lireOctetsOfx(octets: Uint8Array): OfxLecture | undefined {
  if (!octetsOfx(octets)) return undefined;
  return lireOfx(decodeBytes(octets));
}

// ---------------------------------------------------------------------------
// Découpage en éléments
// ---------------------------------------------------------------------------

interface Noeud {
  nom: string;
  /** Valeur d'un élément feuille ; `undefined` pour un élément qui en contient d'autres. */
  valeur?: string;
  enfants: Noeud[];
}

/** Les éléments des relevés qui en contiennent d'autres : un fichier tronqué ne les ferme pas toujours. */
const AGREGATS = new Set(['OFX', 'SIGNONMSGSRSV1', 'SONRS', 'STATUS', 'BANKMSGSRSV1', 'CREDITCARDMSGSRSV1', 'STMTTRNRS', 'CCSTMTTRNRS', 'STMTRS', 'CCSTMTRS', 'BANKACCTFROM', 'CCACCTFROM', 'BANKTRANLIST', 'STMTTRN', 'PAYEE', 'LEDGERBAL', 'AVAILBAL']);

const ENTITES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Décode les entités (`&amp;`, `&lt;`, `&#233;`…) d'un coup ; une entité inconnue reste telle quelle. */
export function decoderEntites(s: string): string {
  return s.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z]+));/g, (tout, dec?: string, hex?: string, nom?: string) => {
    if (nom !== undefined) return ENTITES[nom.toLowerCase()] ?? tout;
    const code = dec !== undefined ? Number(dec) : parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : tout;
  });
}

type Jeton = { t: 'ouvre' | 'ferme'; nom: string; auto?: boolean } | { t: 'texte'; texte: string };

function jetons(texte: string): Jeton[] {
  const out: Jeton[] = [];
  const re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<(\/?)([A-Za-z][\w.:-]*)[^>]*?(\/?)>/g;
  let dernier = 0;
  const pousseTexte = (s: string) => {
    if (s) out.push({ t: 'texte', texte: s });
  };
  for (let m = re.exec(texte); m; m = re.exec(texte)) {
    pousseTexte(texte.slice(dernier, m.index));
    dernier = m.index + m[0].length;
    if (m[1] !== undefined) out.push({ t: 'texte', texte: m[1].replace(/&/g, '&amp;') }); // CDATA : littéral
    else if (m[3] !== undefined) {
      const nom = m[3].toUpperCase();
      if (m[2]) out.push({ t: 'ferme', nom });
      else if (m[4]) {
        out.push({ t: 'ouvre', nom, auto: true });
      } else out.push({ t: 'ouvre', nom });
    }
  }
  pousseTexte(texte.slice(dernier));
  return out;
}

/**
 * Construit l'arbre des éléments. Un élément qui porte une valeur est une feuille, fermée ou non ;
 * un élément sans valeur qui contient d'autres éléments est fermé par sa balise. Un fichier
 * tronqué se lit jusqu'où il va.
 */
function arbre(texte: string): Noeud {
  const js = jetons(texte);
  const racine: Noeud = { nom: '', enfants: [] };
  const pile: Noeud[] = [racine];
  // Position de la dernière balise fermante de chaque nom, pour reconnaître un élément sans valeur qui contient d'autres éléments.
  const derniereFermeture = new Map<string, number>();
  js.forEach((j, i) => {
    if (j.t === 'ferme') derniereFermeture.set(j.nom, i);
  });
  for (let i = 0; i < js.length; i++) {
    const j = js[i]!;
    const courant = pile[pile.length - 1]!;
    if (j.t === 'ferme') {
      const rang = pile.map((n) => n.nom).lastIndexOf(j.nom);
      if (rang > 0) pile.length = rang;
      continue;
    }
    if (j.t === 'texte') continue; // texte hors d'une feuille : ignoré
    const noeud: Noeud = { nom: j.nom, enfants: [] };
    courant.enfants.push(noeud);
    if (j.auto) {
      noeud.valeur = '';
      continue;
    }
    // Le texte qui suit : plusieurs morceaux se suivent quand un CDATA coupe une valeur.
    let k = i + 1;
    let valeur = '';
    while (js[k]?.t === 'texte') valeur += (js[k] as { texte: string }).texte, k++;
    const f = js[k];
    const fermeSoi = f?.t === 'ferme' && f.nom === j.nom;
    if (valeur.trim() !== '') {
      noeud.valeur = decoderEntites(valeur).trim();
      i = fermeSoi ? k : k - 1;
    } else if (fermeSoi) {
      noeud.valeur = '';
      i = k;
    } else if (AGREGATS.has(j.nom) || (derniereFermeture.get(j.nom) ?? -1) > i) {
      pile.push(noeud); // un élément qui en contient d'autres
    } else {
      noeud.valeur = '';
    }
  }
  return racine;
}

function descendants(n: Noeud, nom: string, out: Noeud[] = []): Noeud[] {
  for (const e of n.enfants) {
    if (e.nom === nom) out.push(e);
    else descendants(e, nom, out);
  }
  return out;
}

/** La valeur de l'enfant direct de ce nom, `undefined` s'il manque ou est vide. */
function valeurDe(n: Noeud | undefined, nom: string): string | undefined {
  const e = n?.enfants.find((x) => x.nom === nom && x.valeur !== undefined);
  return e && e.valeur !== '' ? e.valeur : undefined;
}

// ---------------------------------------------------------------------------
// Valeurs : dates et montants
// ---------------------------------------------------------------------------

/** Le jour écrit dans une date OFX : ses huit premiers chiffres, sans décalage d'heure ni de fuseau. */
export function dateOfx(s: string): ISODate | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(s.trim());
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return undefined;
  return formatDate({ y, m: mo, d });
}

/** Un montant OFX, signé, au centime exact : `-76.00` et `-76,00` valent −7600, `+1250.5` vaut 125050. */
export function montantOfx(s: string): Cents | undefined {
  const t = s.trim();
  const m = /^([+-]?)(\d[\d.,]*)$/.exec(t);
  if (!m) return undefined;
  const corps = m[2]!;
  const dernier = Math.max(corps.lastIndexOf('.'), corps.lastIndexOf(','));
  let entier: string;
  let frac: string;
  if (dernier < 0) {
    entier = corps;
    frac = '';
  } else {
    entier = corps.slice(0, dernier);
    frac = corps.slice(dernier + 1);
    // L'autre séparateur, s'il y en a un, sépare les milliers ; deux fois le même n'est pas un montant.
    if (/[.,]/.test(frac)) return undefined;
    const autre = corps[dernier] === '.' ? ',' : '.';
    const sep = entier.replace(new RegExp(`\\${autre}`, 'g'), '');
    if (/[.,]/.test(sep)) return undefined;
    entier = sep;
  }
  if (!/^\d+$/.test(entier) || (frac !== '' && !/^\d+$/.test(frac))) return undefined;
  if (frac.length > 2 && !/^0+$/.test(frac.slice(2))) return undefined; // moins d'un centime
  if (entier.length > 13) return undefined;
  const cents = Number(entier) * 100 + Number(frac.slice(0, 2).padEnd(2, '0'));
  return m[1] === '-' ? -cents : cents;
}

// ---------------------------------------------------------------------------
// Lecture des relevés
// ---------------------------------------------------------------------------

export function lireOfx(texte: string): OfxLecture {
  const racine = arbre(texte);
  const comptes: OfxCompte[] = [];
  const parNumero = new Map<string, OfxCompte>();
  const rows: ParsedRow[] = [];
  const errors: OfxLecture['errors'] = [];
  let rang = 0;

  // Les relevés, dans l'ordre du fichier.
  const releves: Array<readonly [Noeud, boolean]> = [];
  (function parcourir(x: Noeud) {
    for (const e of x.enfants) {
      if (e.nom === 'STMTRS' || e.nom === 'CCSTMTRS') releves.push([e, e.nom === 'CCSTMTRS']);
      else parcourir(e);
    }
  })(racine);

  for (const [releve, carte] of releves) {
    const de = releve.enfants.find((e) => e.nom === (carte ? 'CCACCTFROM' : 'BANKACCTFROM'));
    const numero = valeurDe(de, 'ACCTID') ?? '';
    const devise = (valeurDe(releve, 'CURDEF') ?? 'EUR').toUpperCase();
    let compte = parNumero.get(numero);
    if (!compte) {
      compte = { numero, devise, euro: devise === 'EUR', carte, operations: 0 };
      parNumero.set(numero, compte);
      comptes.push(compte);
    } else if (devise !== 'EUR') {
      // Un même numéro déclaré dans une autre devise : rien ne s'importe en euros sans le dire.
      compte.devise = devise;
      compte.euro = false;
    }
    for (const op of descendants(releve, 'STMTTRN')) {
      rang++;
      const dateBrute = valeurDe(op, 'DTUSER') ?? valeurDe(op, 'DTPOSTED');
      const date = dateBrute === undefined ? undefined : dateOfx(dateBrute);
      if (!date) {
        errors.push({ line: rang, message: dateBrute === undefined ? 'Date absente.' : `Date illisible : « ${dateBrute} »` });
        continue;
      }
      const montantBrut = valeurDe(op, 'TRNAMT');
      const amount = montantBrut === undefined ? undefined : montantOfx(montantBrut);
      if (amount === undefined) {
        errors.push({ line: rang, message: montantBrut === undefined ? 'Montant absent.' : `Montant illisible : « ${montantBrut} »` });
        continue;
      }
      const memo = valeurDe(op, 'MEMO');
      const label = valeurDe(op, 'NAME') ?? valeurDe(op.enfants.find((e) => e.nom === 'PAYEE'), 'NAME') ?? memo ?? '';
      compte.operations++;
      rows.push({
        line: rang,
        date,
        label,
        ...(memo && memo !== label ? { fullLabel: memo } : {}),
        amount,
        accountKey: numero,
      });
    }
  }
  return { comptes, rows, errors };
}

// ---------------------------------------------------------------------------
// Préparation de l'import
// ---------------------------------------------------------------------------

/**
 * Prépare l'import des opérations lues : clés de D09, doublons exacts et probables, comme pour un
 * CSV. `accountMap` associe un numéro de compte du fichier à un compte de l'application ; un compte
 * absent de la table, ou d'une autre devise que l'euro, est ignoré.
 */
export function prepareOfxImport(ledger: Ledger, lecture: OfxLecture, accountMap: Record<string, string>): ImportPreparation {
  const retenue: Record<string, string> = {};
  for (const c of lecture.comptes) {
    const id = accountMap[c.numero];
    if (c.euro && id) retenue[c.numero] = id;
  }
  return prepareImport(ledger, lecture.rows, { columns: { account: 'ACCTID' }, accountMap: retenue });
}
