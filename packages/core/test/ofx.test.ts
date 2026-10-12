import { describe, expect, it } from 'vitest';
import {
  bankMultiAccountProfile,
  decodeBytes,
  estOfx,
  euros,
  exampleLedger,
  lireOctetsOfx,
  lireOfx,
  parseCsv,
  parseRows,
  prepareImport,
  prepareOfxImport,
  type Ledger,
} from '../src/index.js';

// Relevés inventés. Aucune donnée réelle.

const ENTETE_V1 = ['OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252', 'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', ''];

/** Une opération en version 1 : valeurs sans balise fermante. */
function op1(champs: Record<string, string>, payee?: Record<string, string>): string[] {
  return [
    '<STMTTRN>',
    ...Object.entries(champs).map(([k, v]) => `<${k}>${v}`),
    ...(payee ? ['<PAYEE>', ...Object.entries(payee).map(([k, v]) => `<${k}>${v}`), '</PAYEE>'] : []),
    '</STMTTRN>',
  ];
}

/** Une opération en version 2 : toutes les balises fermées. */
function op2(champs: Record<string, string>, payee?: Record<string, string>): string[] {
  return [
    '<STMTTRN>',
    ...Object.entries(champs).map(([k, v]) => `<${k}>${v}</${k}>`),
    ...(payee ? ['<PAYEE>', ...Object.entries(payee).map(([k, v]) => `<${k}>${v}</${k}>`), '</PAYEE>'] : []),
    '</STMTTRN>',
  ];
}

const OPS = [
  { DTPOSTED: '20260828000000', TRNAMT: '3400.00', NAME: 'VIR RECU DE: EMPLOYEUR SA', MEMO: 'VIR RECU 123456789S DE: EMPLOYEUR SA MOTIF: SALAIRE AOUT' },
  { DTPOSTED: '20260903000000', TRNAMT: '-85.40', NAME: 'CARTE X2009 02/09 SUPERMARCHE LYON' },
  { DTPOSTED: '20260903000000', TRNAMT: '-85.40', NAME: 'CARTE X2009 02/09 SUPERMARCHE LYON' },
  { DTPOSTED: '20260905000000', TRNAMT: '-950.00', NAME: 'ECHEANCE PRET 0001234', MEMO: 'ECHEANCE PRET 0001234 CAPITAL 700 INTERETS 250' },
];

type Relevé = { acct: string; carte?: boolean; devise?: string; ops: Array<Record<string, string>> };

function fichier(version: 1 | 2, releves: Relevé[], opts: { sautDeLigne?: string } = {}): string {
  const nl = opts.sautDeLigne ?? '\r\n';
  const ferme = version === 2;
  const op = ferme ? op2 : op1;
  const feuille = (k: string, v: string) => (ferme ? `<${k}>${v}</${k}>` : `<${k}>${v}`);
  const corps: string[] = [];
  for (const r of releves) {
    const [rs, de, tr] = r.carte ? ['CCSTMTRS', 'CCACCTFROM', 'CCSTMTTRNRS'] : ['STMTRS', 'BANKACCTFROM', 'STMTTRNRS'];
    corps.push(
      `<${tr}>`,
      feuille('TRNUID', '1'),
      '<STATUS>',
      feuille('CODE', '0'),
      feuille('SEVERITY', 'INFO'),
      '</STATUS>',
      `<${rs}>`,
      ...(r.devise === undefined ? [] : [feuille('CURDEF', r.devise)]),
      `<${de}>`,
      ...(r.carte ? [] : [feuille('BANKID', '00000'), feuille('ACCTTYPE', 'CHECKING')]),
      feuille('ACCTID', r.acct),
      `</${de}>`,
      '<BANKTRANLIST>',
      feuille('DTSTART', '20260801'),
      feuille('DTEND', '20260930'),
      ...r.ops.flatMap((o) => {
        const { PAYEE_NAME, ...reste } = o;
        return op({ TRNTYPE: 'OTHER', FITID: 'ID' + Math.abs(hash(JSON.stringify(o))), ...reste }, PAYEE_NAME ? { NAME: PAYEE_NAME } : undefined);
      }),
      '</BANKTRANLIST>',
      '<LEDGERBAL>',
      feuille('BALAMT', '1234.56'),
      feuille('DTASOF', '20260930'),
      '</LEDGERBAL>',
      `</${rs}>`,
      `</${tr}>`,
    );
  }
  const racine = ['<OFX>', '<SIGNONMSGSRSV1>', '<SONRS>', '<STATUS>', feuille('CODE', '0'), feuille('SEVERITY', 'INFO'), '</STATUS>', feuille('DTSERVER', '20261001'), feuille('LANGUAGE', 'FRA'), '</SONRS>', '</SIGNONMSGSRSV1>', '<BANKMSGSRSV1>', ...corps, '</BANKMSGSRSV1>', '</OFX>'];
  if (version === 2) return ['<?xml version="1.0" encoding="UTF-8" standalone="no"?>', '<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>', ...racine].join(nl);
  return [...ENTETE_V1, ...racine].join(nl);
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

const latin1 = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0) & 0xff));
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('[niveau 4] lecture d’un OFX · #443', () => {
  describe('reconnaissance, quelle que soit l’extension (point 1)', () => {
    it('[niveau 4] reconnaît la version 1 et la version 2, et pas un CSV', () => {
      expect(estOfx(fichier(1, [{ acct: '00011111111', ops: OPS }]))).toBe(true);
      expect(estOfx(fichier(2, [{ acct: '00011111111', ops: OPS }]))).toBe(true);
      expect(estOfx('﻿' + fichier(1, [{ acct: '00011111111', ops: OPS }]))).toBe(true);
      expect(estOfx('<OFX>\n<SIGNONMSGSRSV1>\n</SIGNONMSGSRSV1>\n</OFX>')).toBe(true);
      expect(estOfx('Date transaction;Date comptabilisation;Num Compte;Libellé opération;Montant;\r\n28/08/2026;28/08/2026;0001;X;-1,00;')).toBe(false);
      expect(estOfx('')).toBe(false);
      expect(lireOctetsOfx(latin1('Date;Libellé;Montant\r\n28/08/2026;X;-1,00'))).toBeUndefined();
      expect(lireOctetsOfx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]))).toBeUndefined();
    });
  });

  describe('ce qui se lit d’une opération (point 2)', () => {
    it('[niveau 4] date, montant, libellé et libellé complet, relevé de compte et relevé de carte', () => {
      const l = lireOfx(
        fichier(1, [
          { acct: '00011111111', ops: OPS },
          { acct: 'CARTE-0042', carte: true, ops: [{ DTPOSTED: '20260910', TRNAMT: '-12.50', NAME: 'BOULANGERIE' }] },
        ]),
      );
      expect(l.errors).toEqual([]);
      expect(l.comptes).toEqual([
        { numero: '00011111111', devise: 'EUR', euro: true, carte: false, operations: 4 },
        { numero: 'CARTE-0042', devise: 'EUR', euro: true, carte: true, operations: 1 },
      ]);
      expect(l.rows).toHaveLength(5);
      expect(l.rows[0]).toEqual({
        line: 1,
        date: '2026-08-28',
        label: 'VIR RECU DE: EMPLOYEUR SA',
        fullLabel: 'VIR RECU 123456789S DE: EMPLOYEUR SA MOTIF: SALAIRE AOUT',
        amount: euros(3400),
        accountKey: '00011111111',
      });
      expect(l.rows[1]).toEqual({ line: 2, date: '2026-09-03', label: 'CARTE X2009 02/09 SUPERMARCHE LYON', amount: euros(-85.4), accountKey: '00011111111' });
      expect(l.rows[4]).toMatchObject({ accountKey: 'CARTE-0042', amount: euros(-12.5), date: '2026-09-10' });
      // Rien d'autre ne se garde : ni FITID, ni TRNTYPE, ni soldes, ni catégorie.
      for (const r of l.rows) expect(Object.keys(r).sort()).toEqual(['accountKey', 'amount', 'date', 'label', 'line', ...('fullLabel' in r ? ['fullLabel'] : [])].sort());
    });

    it('[niveau 4] la date d’opération DTUSER prime, sans décalage d’heure ni de fuseau', () => {
      const l = lireOfx(
        fichier(1, [
          {
            acct: '00011111111',
            ops: [
              { DTPOSTED: '20261003000000', DTUSER: '20261001000000[-5:EST]', TRNAMT: '-1.00', NAME: 'A' },
              { DTPOSTED: '20261003000000', DTUSER: '20261001235959[+2:CEST]', TRNAMT: '-2.00', NAME: 'B' },
              { DTPOSTED: '20261001235959[-5:EST]', TRNAMT: '-3.00', NAME: 'C' },
              { DTPOSTED: '20261001', DTUSER: '', TRNAMT: '-4.00', NAME: 'D' },
            ],
          },
        ]),
      );
      expect(l.rows.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-01', '2026-10-01', '2026-10-01']);
    });

    it('[niveau 4] montant signé au centime exact, virgule ou point', () => {
      const montants = ['-76.00', '-76,00', '+1250.5', '1250', '-0.05', '12.500', '1,250.50', '-1.250,50'];
      const l = lireOfx(fichier(2, [{ acct: '00011111111', ops: montants.map((m) => ({ DTPOSTED: '20260901', TRNAMT: m, NAME: 'X' })) }]));
      expect(l.errors).toEqual([]);
      expect(l.rows.map((r) => r.amount)).toEqual([-7600, -7600, 125050, 125000, -5, 1250, 125050, -125050]);
    });

    it('[niveau 4] libellé : NAME, à défaut le NAME du PAYEE, à défaut MEMO ; libellé complet : MEMO quand il diffère', () => {
      const l = lireOfx(
        fichier(1, [
          {
            acct: '00011111111',
            ops: [
              { DTPOSTED: '20260901', TRNAMT: '-1.00', NAME: 'COURT', MEMO: 'COURT' },
              { DTPOSTED: '20260901', TRNAMT: '-2.00', PAYEE_NAME: 'BENEFICIAIRE', MEMO: 'detail' },
              { DTPOSTED: '20260901', TRNAMT: '-3.00', MEMO: 'seulement le memo' },
              { DTPOSTED: '20260901', TRNAMT: '-4.00', NAME: 'LE NOM', PAYEE_NAME: 'AUTRE' },
            ],
          },
        ]),
      );
      expect(l.rows.map((r) => [r.label, r.fullLabel])).toEqual([
        ['COURT', undefined],
        ['BENEFICIAIRE', 'detail'],
        ['seulement le memo', undefined],
        ['LE NOM', undefined],
      ]);
    });

    it('[niveau 4] accents en Windows-1252 et en UTF-8, entités décodées, blancs retirés', () => {
      const ops = [
        { DTPOSTED: '20260901', TRNAMT: '-24.90', NAME: '  LIBRAIRIE DU PÈRE &amp; FILS  ', MEMO: 'Achat à l\'été &lt;rentrée&gt; &#233;&#xE9; &quot;x&quot; &unknown; AT&T' },
      ];
      const attendu = { label: 'LIBRAIRIE DU PÈRE & FILS', fullLabel: 'Achat à l\'été <rentrée> éé "x" &unknown; AT&T' };
      const v1 = fichier(1, [{ acct: '00011111111', ops }]);
      for (const octets of [latin1(v1), utf8(fichier(2, [{ acct: '00011111111', ops }])), utf8('\uFEFF' + v1)]) {
        const l = lireOctetsOfx(octets)!;
        expect(l.errors).toEqual([]);
        expect(l.rows[0]).toMatchObject(attendu);
      }
    });

    it('[niveau 4] une valeur se lit de la même façon, balise fermée ou non, et avec des fins de ligne différentes', () => {
      const releve: Relevé = { acct: '00011111111', ops: OPS };
      const v1 = lireOfx(fichier(1, [releve]));
      expect(lireOfx(fichier(2, [releve]))).toEqual(v1);
      expect(lireOfx(fichier(1, [releve], { sautDeLigne: '\n' }))).toEqual(v1);
      expect(lireOfx(fichier(1, [releve], { sautDeLigne: '' }))).toEqual(v1);
      expect(lireOfx(fichier(2, [releve], { sautDeLigne: '\n  ' }))).toEqual(v1);
    });
  });

  describe('les comptes du fichier (point 3)', () => {
    it('[niveau 4] un compte porté par plusieurs relevés se montre une fois, avec toutes ses opérations', () => {
      const l = lireOfx(fichier(1, [{ acct: '00011111111', ops: OPS.slice(0, 2) }, { acct: '00022222222', ops: OPS.slice(2, 3) }, { acct: '00011111111', ops: OPS.slice(3) }]));
      expect(l.comptes.map((c) => [c.numero, c.operations])).toEqual([
        ['00011111111', 3],
        ['00022222222', 1],
      ]);
      expect(l.rows.map((r) => r.line)).toEqual([1, 2, 3, 4]);
    });
  });

  describe('une autre devise (point 4)', () => {
    it('[niveau 4] un relevé hors euro se déclare avec sa devise ; sans devise déclarée, il vaut en euros', () => {
      const l = lireOfx(
        fichier(1, [
          { acct: '00011111111', ops: OPS.slice(0, 1) },
          { acct: '00033333333', devise: 'usd', ops: OPS.slice(1, 2) },
          { acct: '00044444444', devise: 'EUR', ops: OPS.slice(2, 3) },
        ]),
      );
      expect(l.comptes.map((c) => [c.numero, c.devise, c.euro])).toEqual([
        ['00011111111', 'EUR', true],
        ['00033333333', 'USD', false],
        ['00044444444', 'EUR', true],
      ]);
    });

    it('[niveau 4] aucune opération d’un relevé hors euro n’est préparée, même rattaché de force', () => {
      const l = lireOfx(fichier(1, [{ acct: '00033333333', devise: 'USD', ops: OPS.slice(0, 2) }, { acct: '00011111111', ops: OPS.slice(2, 3) }]));
      const prep = prepareOfxImport(exampleLedger(), l, { '00033333333': 'acc-principal', '00011111111': 'acc-principal' });
      expect(prep.candidates).toHaveLength(1);
      expect(prep.counts.unmapped).toBe(2);
      expect(prep.unmappedAccounts).toEqual(['00033333333']);
    });
  });

  describe('ce qui ne se lit pas (point 5)', () => {
    it('[niveau 4] un fichier OFX sans relevé de compte lisible n’a aucun compte', () => {
      const sansReleve = [...ENTETE_V1, '<OFX>', '<SIGNONMSGSRSV1>', '<SONRS>', '<STATUS>', '<CODE>15500', '<SEVERITY>ERROR', '</STATUS>', '</SONRS>', '</SIGNONMSGSRSV1>', '</OFX>'].join('\r\n');
      expect(lireOfx(sansReleve)).toEqual({ comptes: [], rows: [], errors: [] });
      const titres = [...ENTETE_V1, '<OFX>', '<INVSTMTMSGSRSV1>', '<INVSTMTTRNRS>', '<INVSTMTRS>', '<INVACCTFROM>', '<ACCTID>999', '</INVACCTFROM>', '<INVTRANLIST>', '<INVBANKTRAN>', '<STMTTRN>', '<DTPOSTED>20260901', '<TRNAMT>-5.00', '<NAME>X', '</STMTTRN>', '</INVBANKTRAN>', '</INVTRANLIST>', '</INVSTMTRS>', '</INVSTMTTRNRS>', '</INVSTMTMSGSRSV1>', '</OFX>'].join('\n');
      expect(lireOfx(titres).comptes).toEqual([]);
      expect(lireOfx(ENTETE_V1.join('\n')).comptes).toEqual([]);
    });

    it('[niveau 4] un fichier tronqué se lit jusqu’où il va', () => {
      const entier = fichier(1, [{ acct: '00011111111', ops: OPS }]);
      const coupe = entier.slice(0, entier.indexOf('<NAME>ECHEANCE'));
      const l = lireOfx(coupe);
      expect(l.rows).toHaveLength(4);
      expect(l.rows[3]).toMatchObject({ date: '2026-09-05', amount: euros(-950), label: '' }); // la dernière opération a perdu son libellé, pas sa date ni son montant
      expect(l.errors).toEqual([]);
      const plusCourt = lireOfx(entier.slice(0, entier.indexOf('<TRNAMT>-950')));
      expect(plusCourt.rows).toHaveLength(3);
      expect(plusCourt.errors).toHaveLength(1);
    });

    it('[niveau 4] une opération sans date ou sans montant lisible est comptée avec sa raison, les autres se lisent', () => {
      const l = lireOfx(
        fichier(1, [
          {
            acct: '00011111111',
            ops: [
              { DTPOSTED: '20260901', TRNAMT: '-1.00', NAME: 'BON' },
              { DTPOSTED: '2026-09-01', TRNAMT: '-2.00', NAME: 'DATE ILLISIBLE' },
              { DTPOSTED: '20261301', TRNAMT: '-3.00', NAME: 'MOIS 13' },
              { DTPOSTED: '20260230', TRNAMT: '-3.00', NAME: '30 FEVRIER' },
              { TRNAMT: '-4.00', NAME: 'SANS DATE' },
              { DTPOSTED: '20260901', TRNAMT: 'abc', NAME: 'MONTANT ILLISIBLE' },
              { DTPOSTED: '20260901', TRNAMT: '-1.005', NAME: 'SOUS LE CENTIME' },
              { DTPOSTED: '20260901', NAME: 'SANS MONTANT' },
              { DTPOSTED: '20260902', DTUSER: 'hier', TRNAMT: '-5.00', NAME: 'DTUSER ILLISIBLE' },
              { DTPOSTED: '20260901', TRNAMT: '-6.00', NAME: 'AUTRE BON' },
            ],
          },
        ]),
      );
      expect(l.rows.map((r) => [r.line, r.label])).toEqual([
        [1, 'BON'],
        [10, 'AUTRE BON'],
      ]);
      expect(l.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
      expect(l.errors[0]!.message).toContain('2026-09-01');
      expect(l.errors[3]!.message).toMatch(/absente/);
      expect(l.errors[7]!.message).toContain('hier');
      expect(l.comptes[0]!.operations).toBe(2);
    });
  });

  describe('la suite d’un CSV (point 6)', () => {
    const CSV = [
      'Date transaction;Date comptabilisation;Num Compte;Libellé Compte;Libellé opération;Libellé complet;Catégorie;Sous-Catégorie;Montant;Pointée;',
      '28/08/2026;28/08/2026;00011111111;Compte Joint;VIR RECU DE: EMPLOYEUR SA;VIR RECU 123456789S DE: EMPLOYEUR SA MOTIF: SALAIRE AOUT;;;3400,00;Non;',
      '03/09/2026;03/09/2026;00011111111;Compte Joint;CARTE X2009 02/09 SUPERMARCHE LYON;CARTE X2009 02/09 SUPERMARCHE LYON;;;-85,40;Non;',
      '03/09/2026;03/09/2026;00011111111;Compte Joint;CARTE X2009 02/09 SUPERMARCHE LYON;CARTE X2009 02/09 SUPERMARCHE LYON;;;-85,40;Non;',
      '05/09/2026;05/09/2026;00011111111;Compte Joint;ECHEANCE PRET 0001234;ECHEANCE PRET 0001234 CAPITAL 700 INTERETS 250;;;-950,00;Non;',
    ].join('\r\n');

    function base(): Ledger {
      const ledger = exampleLedger();
      ledger.operations = [];
      ledger.subOperations = [];
      return ledger;
    }
    const profil = () => ({ ...bankMultiAccountProfile('p'), accountMap: { '00011111111': 'acc-principal' } });
    const lectureOfx = () => lireOfx(fichier(1, [{ acct: '00011111111', ops: OPS }]));

    it('[niveau 4] à contenu égal, un OFX et un CSV donnent les mêmes opérations, mêmes identifiants compris', () => {
      const ledger = base();
      const csv = prepareImport(ledger, parseRows(parseCsv(decodeBytes(latin1(CSV))), profil()).rows, profil());
      const ofx = prepareOfxImport(ledger, lectureOfx(), { '00011111111': 'acc-principal' });
      expect(ofx.candidates.map((c) => c.operation)).toEqual(csv.candidates.map((c) => c.operation));
      expect(ofx.counts).toEqual(csv.counts);
      expect(new Set(ofx.candidates.map((c) => c.operation.id)).size).toBe(4); // deux achats identiques du jour : deux clés
      for (const c of ofx.candidates) expect(c.operation.suggestedCategory).toBeUndefined();
    });

    it('[niveau 4] l’un importé après l’autre n’ajoute rien, et un même OFX importé deux fois non plus', () => {
      const ledger = base();
      const premier = prepareOfxImport(ledger, lectureOfx(), { '00011111111': 'acc-principal' });
      const l2: Ledger = { ...ledger, operations: premier.candidates.map((c) => c.operation) };
      const parCsv = prepareImport(l2, parseRows(parseCsv(decodeBytes(latin1(CSV))), profil()).rows, profil());
      expect(parCsv.counts).toMatchObject({ new: 0, exact: 4, probable: 0 });
      const parOfx = prepareOfxImport(l2, lectureOfx(), { '00011111111': 'acc-principal' });
      expect(parOfx.counts).toMatchObject({ new: 0, exact: 4, probable: 0 });
    });

    it('[niveau 4] un doublon probable se propose, jamais fusionné d’office', () => {
      const ledger = base();
      const premier = prepareOfxImport(ledger, lectureOfx(), { '00011111111': 'acc-principal' });
      const l2: Ledger = { ...ledger, operations: premier.candidates.map((c) => c.operation) };
      const autre = lireOfx(fichier(1, [{ acct: '00011111111', ops: [{ DTPOSTED: '20260906000000', TRNAMT: '-950.00', NAME: 'ECHEANCE PRET 0001234 CAPITAL' }] }]));
      const prep = prepareOfxImport(l2, autre, { '00011111111': 'acc-principal' });
      expect(prep.counts).toMatchObject({ new: 0, exact: 0, probable: 1 });
      expect(prep.candidates[0]!.exact).toBe(false);
    });

    it('[niveau 4] un compte non rattaché est ignoré et compté', () => {
      const prep = prepareOfxImport(base(), lectureOfx(), {});
      expect(prep.candidates).toHaveLength(0);
      expect(prep.counts.unmapped).toBe(4);
      expect(prep.unmappedAccounts).toEqual(['00011111111']);
    });
  });
});
