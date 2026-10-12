// @vitest-environment jsdom
/**
 * Tests du codeur de #443 : l'import d'un OFX sur l'écran Import, sans navigateur (`ecran.ts`).
 *
 * Les relevés sont inventés. Le choix du fichier se joue comme le fait un navigateur : le champ reçoit un `File`
 * et son `change`. La lecture d'un OFX (dates, montants, libellés, encodages) est testée au cœur,
 * `packages/core/test/ofx.test.ts` ; ici, ce que l'écran en fait : les étapes, les comptes, ce qu'il écrit.
 */
import { describe, expect, it } from 'vitest';
import { alive, type Operation } from '@tirelire/core';
import { allerA, app, attendre, cliquer, ouvrirLApplication, projet, rendu, saisir, t, tous } from './ecran';

const NUMERO = '00011111111';

/** Un relevé de compte inventé, en version 1 (valeurs sans balise fermante). */
function ofx(releves: Array<{ acct: string; devise?: string; ops: string[][] }>): string {
  const lignes = ['OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252', 'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '', '<OFX>', '<BANKMSGSRSV1>'];
  for (const r of releves) {
    lignes.push('<STMTTRNRS>', '<STMTRS>', ...(r.devise ? [`<CURDEF>${r.devise}`] : []), '<BANKACCTFROM>', `<ACCTID>${r.acct}`, '</BANKACCTFROM>', '<BANKTRANLIST>');
    for (const [date, montant, nom, memo] of r.ops) lignes.push('<STMTTRN>', '<TRNTYPE>OTHER', `<DTPOSTED>${date}`, `<TRNAMT>${montant}`, `<FITID>F${date}${montant}`, ...(nom ? [`<NAME>${nom}`] : []), ...(memo ? [`<MEMO>${memo}`] : []), '</STMTTRN>');
    lignes.push('</BANKTRANLIST>', '</STMTRS>', '</STMTTRNRS>');
  }
  lignes.push('</BANKMSGSRSV1>', '</OFX>');
  return lignes.join('\r\n');
}

const OPS = [
  ['20261001000000', '-76.00', 'PRELEVEMENT EUROPEEN DE: EAU DU VILLAGE', 'PRELEVEMENT EUROPEEN DE: EAU DU VILLAGE MOTIF: Facture'],
  ['20261002000000', '3400.00', 'VIR RECU DE: EMPLOYEUR SA'],
  ['20261003000000', '-24.90', 'CARTE X3001 31/08 LIBRAIRIE'],
];

async function ouvrirImport(mettreLeNumero = true) {
  await ouvrirLApplication();
  expect(await cliquer('Charger l\'exemple')).toBe(true);
  await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A'), 'l’exemple');
  if (mettreLeNumero) {
    const principal = alive(app.ledger.accounts).find((a) => a.id === 'acc-principal')!;
    app.store.upsert('accounts', { ...principal, accountNumber: NUMERO });
    app.reload();
  }
  await allerA('Import');
  expect(t(document.querySelector('main h1'))).toBe('Import d\'un relevé');
}

async function choisir(nom: string, contenu: string) {
  const champ = document.querySelector('main input[type="file"]') as HTMLInputElement | null;
  expect(champ, 'pas de champ fichier').toBeTruthy();
  const octets = new TextEncoder().encode(contenu);
  const fichier = { name: nom, arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) };
  Object.defineProperty(champ!, 'files', { configurable: true, value: [fichier] });
  champ!.dispatchEvent(new Event('change', { bubbles: true }));
  await attendre(() => tous('main button').some((b) => /Vérifier les doublons|Annuler/.test(t(b))) || !!document.querySelector('main .err'), 'la lecture du fichier');
}

const operationsImportees = (): Operation[] => alive(projet().operations).filter((o) => o.origin === 'imported');
const primaires = () => tous('main button.primary').map(t);

describe('[niveau 4] #443 · l’import d’un OFX sur l’écran Import', () => {
  it('[niveau 4] point 1 — le sélecteur propose .ofx et .qfx et le texte de l’écran nomme l’OFX', async () => {
    await ouvrirImport();
    const accept = (document.querySelector('main input[type="file"]') as HTMLInputElement).accept;
    expect(accept.split(',')).toEqual(expect.arrayContaining(['.csv', '.xlsx', '.xls', '.ofx', '.qfx']));
    expect(t(document.querySelector('main'))).toMatch(/CSV, Excel ou OFX/);
    expect(t(document.querySelector('main [data-apport-import]'))).toContain('n\'en a pas besoin');
  });

  it('[niveau 4] points 1, 3, 6, 7, 8 — comptes connus : du fichier à « Import terminé » par le seul bouton primaire de chaque étape, sans profil', async () => {
    await ouvrirImport();
    const profilsAvant = alive(projet().importProfiles).length;
    const avant = operationsImportees().length;
    // L'extension ne compte pas : le contenu fait l'OFX.
    await choisir('releve.csv', ofx([{ acct: NUMERO, ops: OPS }]));
    // L'étape des comptes et de l'aperçu : rien à décrire, ni nom de profil, ni colonne.
    const ecran = t(document.querySelector('main'));
    expect(ecran).toContain('fichier OFX');
    expect(ecran).toContain(`${NUMERO} · 3 opération(s)`);
    expect(ecran).toContain('Aperçu (3 opérations lisibles)');
    expect(ecran).not.toMatch(/Nom du profil|Colonnes|Format de date|Ligne d'en-tête/);
    const comptes = tous<HTMLSelectElement>('main select');
    expect(comptes).toHaveLength(1);
    expect(comptes[0]!.value).toBe('acc-principal');
    expect(tous('main input[type="checkbox"]'), 'le numéro est déjà mémorisé : rien à cocher').toHaveLength(0);
    expect(primaires()).toEqual(['Vérifier les doublons']);
    expect(await cliquer('Vérifier les doublons')).toBe(true);
    expect(t(document.querySelector('main'))).toContain('Nouvelles');
    expect(primaires()).toEqual(['Importer 3 opérations']);
    expect(await cliquer('Importer 3 opérations')).toBe(true);
    await attendre(() => t(document.querySelector('main')).includes('Import terminé'), '« Import terminé »');

    const ajoutees = operationsImportees().filter((o) => o.date >= '2026-10-01');
    expect(operationsImportees().length - avant).toBe(3);
    expect(ajoutees.map((o) => [o.accountId, o.date, o.amount, o.label, o.details]).sort()).toEqual(
      [
        ['acc-principal', '2026-10-01', -7600, 'PRELEVEMENT EUROPEEN DE: EAU DU VILLAGE', 'PRELEVEMENT EUROPEEN DE: EAU DU VILLAGE MOTIF: Facture'],
        ['acc-principal', '2026-10-02', 340000, 'VIR RECU DE: EMPLOYEUR SA', undefined],
        ['acc-principal', '2026-10-03', -2490, 'CARTE X3001 31/08 LIBRAIRIE', undefined],
      ].sort(),
    );
    for (const o of ajoutees) {
      expect(o.id).toMatch(/^op_[0-9a-f]{16}$/);
      expect(o.suggestedCategory).toBeUndefined();
    }
    // Point 7 : aucun profil enregistré.
    expect(alive(projet().importProfiles)).toHaveLength(profilsAvant);
  });

  it('[niveau 4] point 6 — le même OFX importé une seconde fois n’ajoute rien : doublons exacts, comptés', async () => {
    await ouvrirImport();
    await choisir('releve.ofx', ofx([{ acct: NUMERO, ops: OPS }]));
    await cliquer('Vérifier les doublons');
    await cliquer('Importer 3 opérations');
    await attendre(() => t(document.querySelector('main')).includes('Import terminé'), '« Import terminé »');
    const apres = operationsImportees().length;
    expect(await cliquer('Importer un autre fichier')).toBe(true);
    await choisir('releve.ofx', ofx([{ acct: NUMERO, ops: OPS }]));
    await cliquer('Vérifier les doublons');
    const stats = tous('main .stat').map((s) => [t(s.querySelector('.k')), t(s.querySelector('.v'))]);
    expect(stats).toEqual([['Nouvelles', '0'], ['Déjà connues', '3'], ['Doublons probables', '0'], ['Comptes ignorés', '0']]);
    expect((tous('main button.primary')[0] as HTMLButtonElement).disabled).toBe(true);
    expect(operationsImportees()).toHaveLength(apres);
  });

  it('[niveau 4] point 3 — un numéro inconnu : « — ignorer » jusqu’au choix, avec la case qui propose de le mémoriser ; rien ne s’écrit avant « Importer »', async () => {
    await ouvrirImport(false);
    const avant = JSON.stringify(projet());
    await choisir('releve.ofx', ofx([{ acct: NUMERO, ops: OPS }, { acct: '00099999999', ops: [['20261005', '-5.00', 'AUTRE']] }]));
    const selects = tous<HTMLSelectElement>('main select');
    expect(selects.map((s) => s.value)).toEqual(['', '']);
    expect(t(document.querySelector('main'))).toContain('— ignorer');
    expect(JSON.stringify(projet()), 'la lecture et les comptes n’écrivent rien').toBe(avant);

    await saisir(selects[0]!, 'acc-principal');
    const cases = tous<HTMLInputElement>('main input[type="checkbox"]');
    expect(cases).toHaveLength(1);
    expect(cases[0]!.checked).toBe(true);
    expect(t(cases[0]!.closest('label'))).toContain(`Mémoriser « ${NUMERO} » comme numéro de Compte courant`);
    await cliquer('Vérifier les doublons');
    // Le second compte est ignoré : ses opérations se comptent sous « Comptes ignorés ».
    const stats = tous('main .stat').map((s) => [t(s.querySelector('.k')), t(s.querySelector('.v'))]);
    expect(stats).toContainEqual(['Comptes ignorés', '1']);
    expect(t(document.querySelector('main'))).toContain('Ignoré : 00099999999');
    expect(JSON.stringify(projet()), 'l’aperçu n’écrit rien non plus').toBe(avant);

    await cliquer('Importer 3 opérations');
    await attendre(() => t(document.querySelector('main')).includes('Import terminé'), '« Import terminé »');
    expect(alive(projet().accounts).find((a) => a.id === 'acc-principal')!.accountNumber).toBe(NUMERO);
    expect(alive(projet().importProfiles)).toHaveLength(0);
  });

  it('[niveau 4] point 4 — un compte en dollars se montre avec sa devise, sans choix de compte, et ses opérations ne s’importent pas', async () => {
    await ouvrirImport();
    await choisir('releve.ofx', ofx([{ acct: NUMERO, ops: OPS.slice(0, 1) }, { acct: '00033333333', devise: 'USD', ops: OPS.slice(1) }]));
    expect(tous('main select')).toHaveLength(1);
    expect(t(document.querySelector('main [data-autre-devise]'))).toContain('USD');
    expect(t(document.querySelector('main'))).toContain('00033333333 · 2 opération(s)');
    await cliquer('Vérifier les doublons');
    expect(primaires()).toEqual(['Importer 1 opérations']);
    await cliquer('Importer 1 opérations');
    await attendre(() => t(document.querySelector('main')).includes('Import terminé'), '« Import terminé »');
    expect(operationsImportees().filter((o) => o.date >= '2026-10-01')).toHaveLength(1);
  });

  it('[niveau 4] point 5 — sans relevé de compte lisible : un message, l’écran reste au choix du fichier, rien ne s’écrit', async () => {
    await ouvrirImport();
    const avant = JSON.stringify(projet());
    await choisir('reponse.ofx', ['OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', '', '<OFX>', '<SONRS>', '<STATUS>', '<CODE>15500', '<SEVERITY>ERROR', '</STATUS>', '</SONRS>', '</OFX>'].join('\n'));
    expect(t(document.querySelector('main .err'))).toBe('Ce fichier est un OFX sans relevé de compte lisible : aucune opération n’est importée.');
    expect(document.querySelector('main input[type="file"]')).toBeTruthy();
    expect(tous('main button').map(t)).not.toContain('Vérifier les doublons');
    expect(JSON.stringify(projet())).toBe(avant);
  });

  it('[niveau 4] point 5 — une opération sans date ou sans montant lisible est comptée et listée avec sa raison ; les autres s’importent', async () => {
    await ouvrirImport();
    await choisir('releve.ofx', ofx([{ acct: NUMERO, ops: [...OPS.slice(0, 1), ['hier', '-1.00', 'DATE ILLISIBLE'], ['20261004', 'abc', 'MONTANT ILLISIBLE']] }]));
    const ecran = t(document.querySelector('main'));
    expect(ecran).toContain('Aperçu (1 opérations lisibles, 2 opérations illisibles)');
    expect(tous('main .warnings div').map(t)).toEqual(['Opération n° 2 : Date illisible : « hier »', 'Opération n° 3 : Montant illisible : « abc »']);
    await cliquer('Vérifier les doublons');
    await cliquer('Importer 1 opérations');
    await attendre(() => t(document.querySelector('main')).includes('Import terminé'), '« Import terminé »');
  });

  it('[niveau 4] point 5 — un fichier sans opération lisible ne va pas plus loin que l’aperçu', async () => {
    await ouvrirImport();
    await choisir('vide.ofx', ofx([{ acct: NUMERO, ops: [] }]));
    expect(t(document.querySelector('main'))).toContain('Aperçu (0 opérations lisibles)');
    expect((tous('main button.primary')[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('[niveau 4] point 5 — un fichier qui n’est pas un OFX suit le chemin du CSV : profil à décrire, enregistré à l’import', async () => {
    await ouvrirImport();
    const csv = ['Date transaction;Libellé opération;Montant;', '01/10/2026;PRELEVEMENT EAU;-76,00;'].join('\r\n');
    await choisir('releve.csv', csv);
    const ecran = t(document.querySelector('main'));
    expect(ecran).toContain('Nom du profil');
    expect(ecran).not.toContain('fichier OFX');
    await rendu();
  });
});
