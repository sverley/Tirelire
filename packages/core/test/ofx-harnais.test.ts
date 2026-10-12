/**
 * Harnais d'audit de #443 — « Importer des fichiers OFX pour les opérations » (D09, D18, D58). Côté
 * cœur ; ce que l'écran Import en fait se vérifie sans navigateur, sur l'application montée sous
 * jsdom, dans `apps/web/test/import-ofx-harnais.test.ts`.
 *
 * Composé après le codage (auditeur.md, étape 2) : pour chaque phrase du « Fait quand » qu'un test du
 * cœur peut trancher, un test — celui du codeur quand il la tranche (repris de `ofx.test.ts`, où ne
 * restent que ses tests non retenus), sinon le mien. Sont de moi : l'identité qui ne dépend pas de
 * l'identifiant de transaction de la banque (point 6 : même OFX avec d'autres `FITID`, et le CSV avant
 * l'OFX), et le numéro déclaré hors euro une fois pour tout le fichier (point 4).
 * Données inventées (D84) : de petits relevés écrits ici, et l'exemple.
 *
 * Niveaux (D83), par le besoin que couvre chaque phrase :
 * - 0 · un relevé hors euro n'écrit jamais ses montants comme des euros (point 4, principe 4) ; un
 *   même relevé, ou le même contenu venu d'un CSV, n'ajoute jamais une opération de plus à la base, et
 *   un doublon probable n'en fait jamais disparaître une (point 6, D09) : des opérations en double ou
 *   absentes dans la base de l'utilisateur ne se rétablissent pas en corrigeant le code.
 * - 1 · C1 : un fichier dont le contenu est un OFX se reconnaît seul, sans rien décrire (point 1).
 * - 2 · les règles de lecture d'une opération (point 2), des comptes du fichier (point 3) et de ce qui ne
 *   se lit pas (point 5), nominales comme limites.
 * Les points 7 à 9 se vérifient à l'écran ou à la relecture de `docs/formats-import.md`.
 */
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

/** `fitid` : le préfixe des identifiants de transaction de la banque, que l'import ne doit pas lire. */
function fichier(version: 1 | 2, releves: Relevé[], opts: { sautDeLigne?: string; fitid?: string } = {}): string {
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
      ...r.ops.flatMap((o, i) => {
        const { PAYEE_NAME, ...reste } = o;
        return op({ TRNTYPE: 'OTHER', FITID: `${opts.fitid ?? 'ID'}${r.acct}-${i}`, ...reste }, PAYEE_NAME ? { NAME: PAYEE_NAME } : undefined);
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

const latin1 = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0) & 0xff));
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('lecture d’un OFX · #443', () => {
  describe('[niveau 1] point 1 — reconnu par son contenu, sans rien décrire (C1)', () => {
    it('la version 1 et la version 2 se reconnaissent, quelle que soit l’extension, et rien d’autre', () => {
      const releve: Relevé = { acct: '00011111111', ops: OPS };
      expect(estOfx(fichier(1, [releve]))).toBe(true);
      expect(estOfx(fichier(2, [releve]))).toBe(true);
      expect(estOfx('﻿' + fichier(1, [releve]))).toBe(true);
      // Octets d'un fichier, comme l'écran les reçoit : le nom du fichier n'entre pas en compte.
      expect(lireOctetsOfx(latin1(fichier(1, [releve])))?.rows).toHaveLength(4);
      expect(lireOctetsOfx(utf8(fichier(2, [releve])))?.rows).toHaveLength(4);
      // Un CSV, un fichier binaire (Excel) ne sont pas un OFX : ils suivent leur chemin, inchangé.
      expect(estOfx('Date transaction;Date comptabilisation;Num Compte;Libellé opération;Montant;\r\n28/08/2026;28/08/2026;0001;X;-1,00;')).toBe(false);
      expect(lireOctetsOfx(latin1('Date;Libellé;Montant\r\n28/08/2026;X;-1,00'))).toBeUndefined();
      expect(lireOctetsOfx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]))).toBeUndefined();
    });
  });

  describe('[niveau 2] point 2 — ce qui se lit d’une opération', () => {
    it('date, montant, libellé et libellé complet, relevé de compte et relevé de carte ; rien d’autre ne se garde', () => {
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
      // Ni FITID, ni TRNTYPE, ni soldes, ni catégorie, ni seconde date.
      for (const r of l.rows) expect(Object.keys(r).sort()).toEqual(['accountKey', 'amount', 'date', 'label', 'line', ...('fullLabel' in r ? ['fullLabel'] : [])].sort());
    });

    it('la date d’opération DTUSER prime, sinon DTPOSTED, le jour écrit, sans décalage d’heure ni de fuseau', () => {
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

    it('montant signé au centime exact, la virgule décimale valant le point', () => {
      const montants = ['-76.00', '-76,00', '+1250.5', '1250', '-0.05', '12.500', '1,250.50', '-1.250,50'];
      const l = lireOfx(fichier(2, [{ acct: '00011111111', ops: montants.map((m) => ({ DTPOSTED: '20260901', TRNAMT: m, NAME: 'X' })) }]));
      expect(l.errors).toEqual([]);
      expect(l.rows.map((r) => r.amount)).toEqual([-7600, -7600, 125050, 125000, -5, 1250, 125050, -125050]);
    });

    it('libellé : NAME, à défaut le NAME du PAYEE, à défaut MEMO ; libellé complet : MEMO quand il diffère', () => {
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

    it('accents en Windows-1252 et en UTF-8, entités décodées, blancs retirés', () => {
      const ops = [{ DTPOSTED: '20260901', TRNAMT: '-24.90', NAME: '  LIBRAIRIE DU PÈRE &amp; FILS  ', MEMO: 'Achat à l\'été &lt;rentrée&gt; &#233;&#xE9; &quot;x&quot; &unknown; AT&T' }];
      const attendu = { label: 'LIBRAIRIE DU PÈRE & FILS', fullLabel: 'Achat à l\'été <rentrée> éé "x" &unknown; AT&T' };
      const v1 = fichier(1, [{ acct: '00011111111', ops }]);
      for (const octets of [latin1(v1), utf8(fichier(2, [{ acct: '00011111111', ops }])), utf8('﻿' + v1)]) {
        const l = lireOctetsOfx(octets)!;
        expect(l.errors).toEqual([]);
        expect(l.rows[0]).toMatchObject(attendu);
      }
    });

    it('une valeur se lit de la même façon, balise fermée ou non', () => {
      const releve: Relevé = { acct: '00011111111', ops: OPS };
      expect(lireOfx(fichier(2, [releve]))).toEqual(lireOfx(fichier(1, [releve])));
    });
  });

  describe('[niveau 2] point 3 — les comptes du fichier', () => {
    it('un compte porté par plusieurs relevés se montre une fois, avec toutes ses opérations', () => {
      const l = lireOfx(fichier(1, [{ acct: '00011111111', ops: OPS.slice(0, 2) }, { acct: '00022222222', ops: OPS.slice(2, 3) }, { acct: '00011111111', ops: OPS.slice(3) }]));
      expect(l.comptes.map((c) => [c.numero, c.operations])).toEqual([
        ['00011111111', 3],
        ['00022222222', 1],
      ]);
      expect(l.rows.map((r) => r.line)).toEqual([1, 2, 3, 4]);
    });

    it('un compte non rattaché est ignoré : ses opérations ne s’importent pas, et se comptent', () => {
      const prep = prepareOfxImport(base(), lireOfx(fichier(1, [{ acct: '00011111111', ops: OPS }])), {});
      expect(prep.candidates).toHaveLength(0);
      expect(prep.counts.unmapped).toBe(4);
      expect(prep.unmappedAccounts).toEqual(['00011111111']);
    });
  });

  describe('[niveau 0] point 4 — une autre devise ne s’importe pas en euros', () => {
    it('un relevé hors euro se déclare avec sa devise ; sans devise déclarée, il vaut en euros', () => {
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

    it('aucune opération d’un relevé hors euro n’est préparée, même rattaché de force', () => {
      const l = lireOfx(fichier(1, [{ acct: '00033333333', devise: 'USD', ops: OPS.slice(0, 2) }, { acct: '00011111111', ops: OPS.slice(2, 3) }]));
      const prep = prepareOfxImport(base(), l, { '00033333333': 'acc-principal', '00011111111': 'acc-principal' });
      expect(prep.candidates).toHaveLength(1);
      expect(prep.counts.unmapped).toBe(2);
      expect(prep.unmappedAccounts).toEqual(['00033333333']);
      // Le même numéro, déclaré une fois hors euro dans le fichier, l'est pour tout le fichier.
      const deux = lireOfx(fichier(1, [{ acct: '00033333333', ops: OPS.slice(0, 1) }, { acct: '00033333333', devise: 'GBP', ops: OPS.slice(1, 2) }]));
      expect(prepareOfxImport(base(), deux, { '00033333333': 'acc-principal' }).candidates).toHaveLength(0);
    });
  });

  describe('[niveau 2] point 5 — ce qui ne se lit pas', () => {
    it('un fichier OFX sans relevé de compte lisible n’a aucun compte', () => {
      const sansReleve = [...ENTETE_V1, '<OFX>', '<SIGNONMSGSRSV1>', '<SONRS>', '<STATUS>', '<CODE>15500', '<SEVERITY>ERROR', '</STATUS>', '</SONRS>', '</SIGNONMSGSRSV1>', '</OFX>'].join('\r\n');
      expect(lireOfx(sansReleve)).toEqual({ comptes: [], rows: [], errors: [] });
      const titres = [...ENTETE_V1, '<OFX>', '<INVSTMTMSGSRSV1>', '<INVSTMTTRNRS>', '<INVSTMTRS>', '<INVACCTFROM>', '<ACCTID>999', '</INVACCTFROM>', '<INVTRANLIST>', '<INVBANKTRAN>', '<STMTTRN>', '<DTPOSTED>20260901', '<TRNAMT>-5.00', '<NAME>X', '</STMTTRN>', '</INVBANKTRAN>', '</INVTRANLIST>', '</INVSTMTRS>', '</INVSTMTTRNRS>', '</INVSTMTMSGSRSV1>', '</OFX>'].join('\n');
      expect(lireOfx(titres).comptes).toEqual([]);
      expect(lireOfx(ENTETE_V1.join('\n')).comptes).toEqual([]);
    });

    it('une opération sans date ou sans montant lisible est comptée avec sa raison, les autres se lisent', () => {
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

  describe('[niveau 0] point 6 — la suite d’un CSV : l’identité est celle de D09, quelle que soit la source', () => {
    const CSV = [
      'Date transaction;Date comptabilisation;Num Compte;Libellé Compte;Libellé opération;Libellé complet;Catégorie;Sous-Catégorie;Montant;Pointée;',
      '28/08/2026;28/08/2026;00011111111;Compte Joint;VIR RECU DE: EMPLOYEUR SA;VIR RECU 123456789S DE: EMPLOYEUR SA MOTIF: SALAIRE AOUT;;;3400,00;Non;',
      '03/09/2026;03/09/2026;00011111111;Compte Joint;CARTE X2009 02/09 SUPERMARCHE LYON;CARTE X2009 02/09 SUPERMARCHE LYON;;;-85,40;Non;',
      '03/09/2026;03/09/2026;00011111111;Compte Joint;CARTE X2009 02/09 SUPERMARCHE LYON;CARTE X2009 02/09 SUPERMARCHE LYON;;;-85,40;Non;',
      '05/09/2026;05/09/2026;00011111111;Compte Joint;ECHEANCE PRET 0001234;ECHEANCE PRET 0001234 CAPITAL 700 INTERETS 250;;;-950,00;Non;',
    ].join('\r\n');
    const profil = () => ({ ...bankMultiAccountProfile('p'), accountMap: { '00011111111': 'acc-principal' } });
    const lectureOfx = (opts: { fitid?: string } = {}) => lireOfx(fichier(1, [{ acct: '00011111111', ops: OPS }], opts));
    const carte = { '00011111111': 'acc-principal' };
    const avec = (ledger: Ledger, prep: ReturnType<typeof prepareOfxImport>): Ledger => ({ ...ledger, operations: prep.candidates.map((c) => c.operation) });

    it('à contenu égal, un OFX et un CSV donnent les mêmes opérations, mêmes identifiants compris', () => {
      const ledger = base();
      const csv = prepareImport(ledger, parseRows(parseCsv(decodeBytes(latin1(CSV))), profil()).rows, profil());
      const ofx = prepareOfxImport(ledger, lectureOfx(), carte);
      expect(ofx.candidates.map((c) => c.operation)).toEqual(csv.candidates.map((c) => c.operation));
      expect(ofx.counts).toEqual(csv.counts);
      expect(new Set(ofx.candidates.map((c) => c.operation.id)).size).toBe(4); // deux achats identiques du jour : deux clés
      for (const c of ofx.candidates) expect(c.operation.suggestedCategory).toBeUndefined();
    });

    it('l’un importé après l’autre n’ajoute rien, un même OFX importé deux fois non plus, même avec d’autres identifiants de transaction', () => {
      const ledger = base();
      const l2 = avec(ledger, prepareOfxImport(ledger, lectureOfx(), carte));
      const parCsv = prepareImport(l2, parseRows(parseCsv(decodeBytes(latin1(CSV))), profil()).rows, profil());
      expect(parCsv.counts).toMatchObject({ new: 0, exact: 4, probable: 0 });
      const parOfx = prepareOfxImport(l2, lectureOfx(), carte);
      expect(parOfx.counts).toMatchObject({ new: 0, exact: 4, probable: 0 });
      // La banque a renuméroté ses transactions : l'identité ne les lit pas (D09).
      const autresIds = prepareOfxImport(l2, lectureOfx({ fitid: 'AUTRE' }), carte);
      expect(autresIds.counts).toMatchObject({ new: 0, exact: 4, probable: 0 });
      // Et dans l'autre sens : un CSV d'abord, l'OFX ensuite.
      const csvAvant = avec(ledger, prepareImport(ledger, parseRows(parseCsv(decodeBytes(latin1(CSV))), profil()).rows, profil()));
      expect(prepareOfxImport(csvAvant, lectureOfx(), carte).counts).toMatchObject({ new: 0, exact: 4, probable: 0 });
    });

    it('un doublon probable se propose, jamais fusionné d’office', () => {
      const ledger = base();
      const l2 = avec(ledger, prepareOfxImport(ledger, lectureOfx(), carte));
      const autre = lireOfx(fichier(1, [{ acct: '00011111111', ops: [{ DTPOSTED: '20260906000000', TRNAMT: '-950.00', NAME: 'ECHEANCE PRET 0001234 CAPITAL' }] }]));
      const prep = prepareOfxImport(l2, autre, carte);
      expect(prep.counts).toMatchObject({ new: 0, exact: 0, probable: 1 });
      expect(prep.candidates[0]!.exact).toBe(false);
      expect(prep.candidates[0]!.operation.id).not.toBe(prep.candidates[0]!.probable!.id);
    });
  });
});

/** Le grand livre de l'exemple, sans opération. */
function base(): Ledger {
  const ledger = exampleLedger();
  ledger.operations = [];
  ledger.subOperations = [];
  return ledger;
}
