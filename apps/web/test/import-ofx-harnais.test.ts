// @vitest-environment jsdom
/**
 * Harnais d'audit de #443 — « Importer des fichiers OFX pour les opérations » (D09, D18, D58). Côté
 * écran : l'écran Import monté sous jsdom, sans navigateur (`ecran.ts`, l'issue disant « Navigateur :
 * aucun »). La lecture d'un OFX (dates, montants, libellés, encodages) se tranche au cœur, dans
 * `packages/core/test/ofx-harnais.test.ts` ; ici, ce que l'écran en fait : les étapes, les comptes, ce
 * qu'il écrit.
 *
 * Composé après le codage (auditeur.md, étape 2) : pour chaque phrase du « Fait quand » que l'écran
 * peut trancher, un test — celui du codeur quand il la tranche (repris de `import-ofx-ecran.test.ts`,
 * où il ne reste rien : tous ses tests sont retenus), sinon le mien. Sont de moi : un OFX et un CSV de même
 * contenu laissent la même base après l'import, automatismes et virements internes compris (point 6) ; la
 * case de mémorisation du numéro, décochée (point 3) ; un fichier dont le seul relevé est en dollars
 * (point 4) ; les étapes du chemin d'un CSV, jusqu'au profil enregistré (point 5). Relevés inventés (D84).
 *
 * Niveaux (D83), par le besoin que couvre chaque phrase :
 * - 0 · rien ne s'écrit avant « Importer » et un fichier refusé n'écrit rien (point 5), un relevé hors
 *   euro n'écrit pas ses montants comme des euros (point 4, principe 4), le même OFX importé deux fois, ou
 *   le même contenu après un CSV, n'ajoute rien et la base est la même (point 6, D09).
 * - 1 · C1 : le sélecteur et le texte de l'écran, rien à décrire (point 1) ; I4 : du choix du fichier à
 *   « Import terminé » par le seul bouton primaire de chaque étape (point 8).
 * - 2 · les règles de D18 pour les comptes du fichier (point 3), ce qui ne se lit pas (point 5), l'absence
 *   de profil (point 7, D58), la suite d'un CSV (point 6, D22, D33).
 * Le point 9 est de la documentation, relue.
 */
import { describe, expect, it } from 'vitest';
import { alive, type Operation } from '@tirelire/core';
import { allerA, app, attendre, cliquer, ouvrirLApplication, projet, saisir, t, tous } from './ecran';

const NUMERO = '00011111111';
const NUMERO_LIVRET = '00022222222';

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

/** L'exemple chargé, le compte principal (et, si on le demande, le Livret A) portant son numéro, puis l'écran Import. */
async function ouvrirImport({ numeros = true, livret = false } = {}) {
  await ouvrirLApplication();
  expect(await cliquer('Charger l\'exemple')).toBe(true);
  await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A'), 'l’exemple');
  if (numeros) {
    const principal = alive(app.ledger.accounts).find((a) => a.id === 'acc-principal')!;
    app.store.upsert('accounts', { ...principal, accountNumber: NUMERO });
    if (livret) {
      const compte = alive(app.ledger.accounts).find((a) => a.id === 'acc-livret')!;
      app.store.upsert('accounts', { ...compte, accountNumber: NUMERO_LIVRET });
    }
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
const stats = () => tous('main .stat').map((s) => [t(s.querySelector('.k')), t(s.querySelector('.v'))]);
const fini = () => attendre(() => t(document.querySelector('main')).includes('Import terminé'), '« Import terminé »');

describe('l’import d’un OFX sur l’écran Import · #443', () => {
  describe('[niveau 1] point 1 — reconnu sans rien décrire (C1)', () => {
    it('le sélecteur propose .ofx et .qfx à côté des CSV et Excel, et le texte de l’écran nomme l’OFX', async () => {
      await ouvrirImport();
      const accept = (document.querySelector('main input[type="file"]') as HTMLInputElement).accept;
      expect(accept.split(',')).toEqual(expect.arrayContaining(['.csv', '.xlsx', '.xls', '.ofx', '.qfx']));
      expect(t(document.querySelector('main'))).toMatch(/CSV, Excel ou OFX/);
      expect(t(document.querySelector('main [data-apport-import]'))).toContain('n\'en a pas besoin');
    });

    it('un fichier dont le contenu est un OFX, quelle que soit son extension, mène aux comptes et à l’aperçu : aucun nom de profil, colonne, format ni en-tête', async () => {
      await ouvrirImport();
      await choisir('releve.csv', ofx([{ acct: NUMERO, ops: OPS }]));
      const ecran = t(document.querySelector('main'));
      expect(ecran).toContain('fichier OFX');
      expect(ecran).toContain(`${NUMERO} · 3 opération(s)`);
      expect(ecran).toContain('Aperçu (3 opérations lisibles)');
      expect(ecran).not.toMatch(/Nom du profil|Colonnes|Format de date|Ligne d'en-tête|Source|encodage|séparateur/i);
      expect(tous('main input:not([type="file"]):not([type="checkbox"])'), 'aucun champ à remplir').toHaveLength(0);
    });
  });

  describe('[niveau 1] point 8 — simple (I4)', () => {
    it('comptes connus : du choix du fichier à « Import terminé » par le seul bouton primaire de chaque étape', async () => {
      await ouvrirImport();
      await choisir('releve.ofx', ofx([{ acct: NUMERO, ops: OPS }]));
      const comptes = tous<HTMLSelectElement>('main select');
      expect(comptes).toHaveLength(1);
      expect(comptes[0]!.value, 'le compte qui porte ce numéro est déjà choisi').toBe('acc-principal');
      expect(tous('main input[type="checkbox"]'), 'le numéro est déjà mémorisé : rien à cocher').toHaveLength(0);
      expect(primaires()).toEqual(['Vérifier les doublons']);
      expect(await cliquer('Vérifier les doublons')).toBe(true);
      expect(tous('main input[type="checkbox"]'), 'aucun doublon probable à décider').toHaveLength(0);
      expect(primaires()).toEqual(['Importer 3 opérations']);
      expect(await cliquer('Importer 3 opérations')).toBe(true);
      await fini();
      expect(operationsImportees().filter((o) => o.date >= '2026-10-01')).toHaveLength(3);
    });
  });

  describe('[niveau 2] points 2, 3 et 7 — ce qui s’écrit, les comptes, aucun profil', () => {
    it('les opérations s’écrivent avec leurs champs et leur clé de D09, et aucun profil ne s’enregistre', async () => {
      await ouvrirImport();
      const profilsAvant = alive(projet().importProfiles).length;
      const avant = operationsImportees().length;
      await choisir('releve.ofx', ofx([{ acct: NUMERO, ops: OPS }]));
      await cliquer('Vérifier les doublons');
      await cliquer('Importer 3 opérations');
      await fini();
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
      expect(alive(projet().importProfiles)).toHaveLength(profilsAvant);
    });

    it('un numéro inconnu : « — ignorer » jusqu’au choix, avec la case qui propose de le mémoriser ; les comptes ignorés se comptent', async () => {
      await ouvrirImport({ numeros: false });
      await choisir('releve.ofx', ofx([{ acct: NUMERO, ops: OPS }, { acct: '00099999999', ops: [['20261005', '-5.00', 'AUTRE']] }]));
      const selects = tous<HTMLSelectElement>('main select');
      expect(selects.map((s) => s.value)).toEqual(['', '']);
      expect(t(document.querySelector('main'))).toContain('— ignorer');
      expect(t(document.querySelector('main'))).toContain('00099999999 · 1 opération(s)');
      await saisir(selects[0]!, 'acc-principal');
      const cases = tous<HTMLInputElement>('main input[type="checkbox"]');
      expect(cases).toHaveLength(1);
      expect(cases[0]!.checked).toBe(true);
      expect(t(cases[0]!.closest('label'))).toContain(`Mémoriser « ${NUMERO} » comme numéro de Compte courant`);
      await cliquer('Vérifier les doublons');
      expect(stats()).toContainEqual(['Comptes ignorés', '1']);
      expect(t(document.querySelector('main'))).toContain('Ignoré : 00099999999');
      await cliquer('Importer 3 opérations');
      await fini();
      expect(alive(projet().accounts).find((a) => a.id === 'acc-principal')!.accountNumber).toBe(NUMERO);
      expect(operationsImportees().filter((o) => o.date >= '2026-10-01')).toHaveLength(3);
    });

    it('le numéro non mémorisé quand la case est décochée', async () => {
      await ouvrirImport({ numeros: false });
      await choisir('releve.ofx', ofx([{ acct: NUMERO, ops: OPS }]));
      await saisir(tous<HTMLSelectElement>('main select')[0]!, 'acc-principal');
      const casee = tous<HTMLInputElement>('main input[type="checkbox"]')[0]!;
      casee.checked = false;
      casee.dispatchEvent(new Event('change', { bubbles: true }));
      await cliquer('Vérifier les doublons');
      await cliquer('Importer 3 opérations');
      await fini();
      expect(alive(projet().accounts).find((a) => a.id === 'acc-principal')!.accountNumber).toBeFalsy();
    });
  });

  describe('[niveau 0] point 4 — une autre devise ne s’importe pas en euros', () => {
    it('un compte en dollars se montre avec sa devise, sans choix de compte, et ses opérations ne s’importent pas', async () => {
      await ouvrirImport();
      await choisir('releve.ofx', ofx([{ acct: NUMERO, ops: OPS.slice(0, 1) }, { acct: '00033333333', devise: 'USD', ops: OPS.slice(1) }]));
      expect(tous('main select')).toHaveLength(1);
      expect(t(document.querySelector('main [data-autre-devise]'))).toContain('USD');
      expect(t(document.querySelector('main'))).toContain('00033333333 · 2 opération(s)');
      await cliquer('Vérifier les doublons');
      expect(primaires()).toEqual(['Importer 1 opérations']);
      await cliquer('Importer 1 opérations');
      await fini();
      expect(operationsImportees().filter((o) => o.date >= '2026-10-01').map((o) => o.amount)).toEqual([-7600]);
    });

    it('un fichier dont le seul relevé est en dollars n’importe rien, même le numéro d’un compte connu', async () => {
      await ouvrirImport();
      const avant = JSON.stringify(projet());
      await choisir('releve.ofx', ofx([{ acct: NUMERO, devise: 'USD', ops: OPS }]));
      expect(tous('main select'), 'aucun compte à choisir').toHaveLength(0);
      await cliquer('Vérifier les doublons');
      expect(stats()).toContainEqual(['Nouvelles', '0']);
      expect((tous('main button.primary')[0] as HTMLButtonElement).disabled).toBe(true);
      expect(JSON.stringify(projet())).toBe(avant);
    });
  });

  describe('[niveau 0] point 5 — rien ne s’écrit avant « Importer »', () => {
    it('ni la lecture du fichier, ni le choix des comptes, ni l’aperçu n’écrivent quoi que ce soit', async () => {
      await ouvrirImport({ numeros: false });
      const avant = JSON.stringify(projet());
      await choisir('releve.ofx', ofx([{ acct: NUMERO, ops: OPS }, { acct: '00099999999', ops: [['20261005', '-5.00', 'AUTRE']] }]));
      expect(JSON.stringify(projet()), 'la lecture n’écrit rien').toBe(avant);
      await saisir(tous<HTMLSelectElement>('main select')[0]!, 'acc-principal');
      expect(JSON.stringify(projet()), 'le choix d’un compte et la case du numéro n’écrivent rien').toBe(avant);
      await cliquer('Vérifier les doublons');
      expect(JSON.stringify(projet()), 'l’aperçu n’écrit rien').toBe(avant);
      expect(await cliquer('Retour')).toBe(true);
      expect(await cliquer('Annuler')).toBe(true);
      expect(JSON.stringify(projet()), 'annuler n’écrit rien').toBe(avant);
    });

    it('sans relevé de compte lisible : un message, l’écran reste au choix du fichier, rien ne s’écrit', async () => {
      await ouvrirImport();
      const avant = JSON.stringify(projet());
      await choisir('reponse.ofx', ['OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', '', '<OFX>', '<SONRS>', '<STATUS>', '<CODE>15500', '<SEVERITY>ERROR', '</STATUS>', '</SONRS>', '</OFX>'].join('\n'));
      expect(t(document.querySelector('main .err'))).toBe('Ce fichier est un OFX sans relevé de compte lisible : aucune opération n’est importée.');
      expect(document.querySelector('main input[type="file"]')).toBeTruthy();
      expect(tous('main button').map(t)).not.toContain('Vérifier les doublons');
      expect(JSON.stringify(projet())).toBe(avant);
    });
  });

  describe('[niveau 2] point 5 — ce qui ne se lit pas, et le chemin du CSV', () => {
    it('une opération sans date ou sans montant lisible est comptée et listée avec sa raison ; les autres s’importent', async () => {
      await ouvrirImport();
      await choisir('releve.ofx', ofx([{ acct: NUMERO, ops: [...OPS.slice(0, 1), ['hier', '-1.00', 'DATE ILLISIBLE'], ['20261004', 'abc', 'MONTANT ILLISIBLE']] }]));
      expect(t(document.querySelector('main'))).toContain('Aperçu (1 opérations lisibles, 2 opérations illisibles)');
      expect(tous('main .warnings div').map(t)).toEqual(['Opération n° 2 : Date illisible : « hier »', 'Opération n° 3 : Montant illisible : « abc »']);
      await cliquer('Vérifier les doublons');
      await cliquer('Importer 1 opérations');
      await fini();
      expect(operationsImportees().filter((o) => o.date >= '2026-10-01')).toHaveLength(1);
    });

    it('un fichier sans opération lisible ne va pas plus loin que l’aperçu', async () => {
      await ouvrirImport();
      await choisir('vide.ofx', ofx([{ acct: NUMERO, ops: [] }]));
      expect(t(document.querySelector('main'))).toContain('Aperçu (0 opérations lisibles)');
      expect((tous('main button.primary')[0] as HTMLButtonElement).disabled).toBe(true);
    });

    it('un fichier qui n’est pas un OFX suit le chemin du CSV : profil à décrire, enregistré à l’import', async () => {
      await ouvrirImport();
      const profilsAvant = alive(projet().importProfiles).length;
      await choisir('releve.csv', ['Date transaction;Libellé opération;Montant;', '01/10/2026;PRELEVEMENT EAU;-76,00;'].join('\r\n'));
      const ecran = t(document.querySelector('main'));
      expect(ecran).toContain('Nom du profil');
      expect(ecran).not.toContain('fichier OFX');
      // Le profil se complète comme avant : un compte cible, puis l'import l'enregistre.
      const cible = tous<HTMLSelectElement>('main select').find((s) => [...s.options].some((o) => o.value === 'acc-principal') && s.closest('label')?.textContent?.includes('Compte cible'));
      expect(cible, 'le compte cible d’un CSV sans colonne de compte').toBeTruthy();
      await saisir(cible!, 'acc-principal');
      await cliquer('Vérifier les doublons');
      await cliquer('Importer 1 opérations');
      await fini();
      expect(alive(projet().importProfiles)).toHaveLength(profilsAvant + 1);
    });
  });

  describe('[niveau 0] point 6 — la suite d’un CSV : mêmes opérations, même base, rien en double', () => {
    it('le même OFX importé une seconde fois n’ajoute rien : doublons exacts, comptés', async () => {
      await ouvrirImport();
      await choisir('releve.ofx', ofx([{ acct: NUMERO, ops: OPS }]));
      await cliquer('Vérifier les doublons');
      await cliquer('Importer 3 opérations');
      await fini();
      const apres = operationsImportees().length;
      expect(await cliquer('Importer un autre fichier')).toBe(true);
      await choisir('releve.ofx', ofx([{ acct: NUMERO, ops: OPS }]));
      await cliquer('Vérifier les doublons');
      expect(stats()).toEqual([['Nouvelles', '0'], ['Déjà connues', '3'], ['Doublons probables', '0'], ['Comptes ignorés', '0']]);
      expect((tous('main button.primary')[0] as HTMLButtonElement).disabled).toBe(true);
      expect(operationsImportees()).toHaveLength(apres);
    });

    it('à contenu égal, un OFX et un CSV laissent la même base après l’import, automatismes et virements internes compris', async () => {
      const operationsDeLaBase = () =>
        alive(projet().operations)
          .filter((o) => o.date >= '2026-10-01')
          .map((o) => JSON.stringify(o, Object.keys(o).sort()))
          .sort();
      const regle = () => {
        app.store.upsert('automations', { id: 'auto-supermarche-443', name: 'Supermarché', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim' }, rank: 'm' } as never);
        app.reload();
      };
      // Principal : un achat classé par l'automatisme, un virement vers le Livret A, deux achats identiques du même jour.
      const courant: string[][] = [
        ['20261001', '-85.40', 'CARTE X2009 01/10 SUPERMARCHE LYON', 'CARTE X2009 01/10 SUPERMARCHE LYON FACTURE 12'],
        ['20261001', '-85.40', 'CARTE X2009 01/10 SUPERMARCHE LYON', 'CARTE X2009 01/10 SUPERMARCHE LYON FACTURE 12'],
        ['20261002', '-200.00', 'VIR PERM LIVRET', 'VIR PERM LIVRET MOTIF: EPARGNE'],
      ];
      const livret: string[][] = [['20261003', '200.00', 'VIR RECU COMPTE COURANT']];
      const ligne = (num: string, nom: string, o: string[]) => {
        const d = `${o[0]!.slice(6, 8)}/${o[0]!.slice(4, 6)}/${o[0]!.slice(0, 4)}`;
        return `${d};${d};${num};${nom};${o[2]};${o[3] ?? o[2]};;;${o[1]!.replace('.', ',')};Non;`;
      };
      const csv = [
        'Date transaction;Date comptabilisation;Num Compte;Libellé Compte;Libellé opération;Libellé complet;Catégorie;Sous-Catégorie;Montant;Pointée;',
        ...courant.map((o) => ligne(NUMERO, 'Compte Joint', o)),
        ...livret.map((o) => ligne(NUMERO_LIVRET, 'Livret A', o)),
      ].join('\r\n');

      await ouvrirImport({ livret: true });
      regle();
      await choisir('releve.ofx', ofx([{ acct: NUMERO, ops: courant }, { acct: NUMERO_LIVRET, ops: livret }]));
      await cliquer('Vérifier les doublons');
      await cliquer('Importer 4 opérations');
      await fini();
      const rapportOfx = tous('main .card.accent .row').map((r) => t(r));
      const parOfx = operationsDeLaBase();

      await ouvrirImport({ livret: true });
      regle();
      await choisir('releve.csv', csv);
      expect(tous<HTMLSelectElement>('main select').filter((s) => s.value === 'acc-principal' || s.value === 'acc-livret').length, 'le CSV rattache aussi ses comptes par leur numéro').toBe(2);
      await cliquer('Vérifier les doublons');
      await cliquer('Importer 4 opérations');
      await fini();
      const rapportCsv = tous('main .card.accent .row').map((r) => t(r));
      const parCsv = operationsDeLaBase();

      expect(parCsv).toHaveLength(4);
      expect(parOfx).toEqual(parCsv);
      expect(rapportOfx).toEqual(rapportCsv);
      // Les automatismes et la reconnaissance des virements internes ont bien passé (point 6).
      expect(rapportOfx).toContain('Virements internes appariés1');
      expect(rapportOfx).toContain('Classées par un automatisme2');
    });
  });
});
