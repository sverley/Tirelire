import { describe, expect, it } from 'vitest';
import { euros, lireOfx } from '../src/index.js';

// Tests du codeur de #443 que le harnais (`ofx-harnais.test.ts`) ne retient pas. Relevés inventés.

function releve(version: 1 | 2, nl = '\r\n'): string {
  const f = (k: string, v: string) => (version === 2 ? `<${k}>${v}</${k}>` : `<${k}>${v}`);
  const ops = [
    ['20260828000000', '3400.00', 'VIR RECU DE: EMPLOYEUR SA'],
    ['20260903000000', '-85.40', 'CARTE X2009 02/09 SUPERMARCHE LYON'],
    ['20260905000000', '-950.00', 'ECHEANCE PRET 0001234'],
  ].flatMap(([d, m, n]) => ['<STMTTRN>', f('TRNTYPE', 'OTHER'), f('DTPOSTED', d!), f('TRNAMT', m!), f('FITID', 'ID' + d), f('NAME', n!), '</STMTTRN>']);
  const corps = ['<OFX>', '<BANKMSGSRSV1>', '<STMTTRNRS>', '<STMTRS>', '<BANKACCTFROM>', f('ACCTID', '00011111111'), '</BANKACCTFROM>', '<BANKTRANLIST>', ...ops, '</BANKTRANLIST>', '</STMTRS>', '</STMTTRNRS>', '</BANKMSGSRSV1>', '</OFX>'];
  const entete = version === 2 ? ['<?xml version="1.0" encoding="UTF-8" standalone="no"?>', '<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>'] : ['OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252', 'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', ''];
  return [...entete, ...corps].join(nl);
}

describe('[niveau 4] lecture d’un OFX · #443', () => {
  it('[niveau 4] un fichier tronqué se lit jusqu’où il va', () => {
    const entier = releve(1);
    const l = lireOfx(entier.slice(0, entier.indexOf('<NAME>ECHEANCE')));
    expect(l.rows).toHaveLength(3);
    expect(l.rows[2]).toMatchObject({ date: '2026-09-05', amount: euros(-950), label: '' }); // la dernière opération a perdu son libellé, pas sa date ni son montant
    expect(l.errors).toEqual([]);
    const plusCourt = lireOfx(entier.slice(0, entier.indexOf('<TRNAMT>-950')));
    expect(plusCourt.rows).toHaveLength(2);
    expect(plusCourt.errors).toHaveLength(1);
  });

  it('[niveau 4] la lecture ne dépend pas des fins de ligne', () => {
    const v1 = lireOfx(releve(1));
    expect(lireOfx(releve(1, '\n'))).toEqual(v1);
    expect(lireOfx(releve(1, ''))).toEqual(v1);
    expect(lireOfx(releve(2, '\n  '))).toEqual(v1);
  });
});
