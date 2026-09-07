import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { guessColumns, newProfileFromRows, parseCsv, parseRows } from '@tirelire/core';
import { ClientEnableBanking, ErreurEnableBanking, trouverBanque, type Operation } from '../src/enable-banking.ts';
import { signerJeton } from '../src/jwt.ts';
import { libelle, montantCentimes, versCsv, versLignes } from '../src/conversion.ts';
import { SOCIETE_GENERALE } from '../src/sg.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const clePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const clePkcs1 = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

function decoder(s: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

describe('jeton', () => {
  it('signe un JWT RS256 vérifiable avec la clé publique, kid = appId', () => {
    const jeton = signerJeton({ appId: 'app-1', clePem, dureeSecondes: 60, maintenant: () => 1_700_000_000 });
    const [h, c, s] = jeton.split('.') as [string, string, string];
    expect(decoder(h)).toEqual({ typ: 'JWT', alg: 'RS256', kid: 'app-1' });
    expect(decoder(c)).toEqual({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: 1_700_000_000, exp: 1_700_000_060 });
    const sig = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expect(verify('sha256', Buffer.from(`${h}.${c}`), publicKey, sig)).toBe(true);
  });
  it('accepte une clé PKCS#1 et plafonne la durée à 24 h', () => {
    const jeton = signerJeton({ appId: 'a', clePem: clePkcs1, dureeSecondes: 999_999, maintenant: () => 0 });
    expect(decoder(jeton.split('.')[1]!)['exp']).toBe(86_400);
  });
});

// Fausse API : enregistre les appels, sert des réponses par chemin.
function fauxFetch(reponses: Record<string, unknown | ((init: RequestInit) => unknown)>, appels: Array<{ url: string; init: RequestInit }> = []) {
  const f: typeof fetch = async (entree, init) => {
    const url = String(entree);
    appels.push({ url, init: init ?? {} });
    const chemin = url.replace('https://api.enablebanking.com', '');
    const cle = Object.keys(reponses).find((k) => chemin === k || chemin.startsWith(k));
    if (!cle) return new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 });
    const r = reponses[cle];
    const corps = typeof r === 'function' ? (r as (i: RequestInit) => unknown)(init ?? {}) : r;
    if (corps instanceof Response) return corps;
    return new Response(JSON.stringify(corps), { status: 200 });
  };
  return { f, appels };
}

const ops: Operation[] = [
  {
    entry_reference: 'R2',
    transaction_amount: { currency: 'EUR', amount: '76.00' },
    credit_debit_indicator: 'DBIT',
    status: 'BOOK',
    booking_date: '2026-09-03',
    value_date: '2026-09-03',
    creditor: { name: 'SUPERMARCHE DU COIN' },
    remittance_information: ['CARTE X1234 02/09 SUPERMARCHE DU COIN'],
    bank_transaction_code: { description: 'Paiement carte' },
  },
  {
    entry_reference: 'R1',
    transaction_amount: { currency: 'EUR', amount: '2450.00' },
    credit_debit_indicator: 'CRDT',
    status: 'BOOK',
    booking_date: '2026-08-28',
    value_date: '2026-08-29',
    debtor: { name: 'EMPLOYEUR SAS' },
    remittance_information: ['VIR RECU SALAIRE AOUT'],
  },
  {
    transaction_amount: { currency: 'EUR', amount: '12.50' },
    credit_debit_indicator: 'DBIT',
    status: 'PDNG',
    transaction_date: '2026-09-05',
    creditor: { name: 'BOULANGERIE' },
  },
  {
    entry_reference: 'R3',
    transaction_amount: { currency: 'EUR', amount: '-30.00' },
    status: 'BOOK',
    booking_date: '2026-09-03',
  },
];

describe('conversion', () => {
  it('signe le montant d\'après le sens, ou d\'après le signe si le sens manque', () => {
    expect(montantCentimes(ops[0]!)).toBe(-7600);
    expect(montantCentimes(ops[1]!)).toBe(245000);
    expect(montantCentimes(ops[3]!)).toBe(-3000);
  });
  it('construit un libellé court et un libellé complet', () => {
    expect(libelle(ops[0]!)).toEqual({
      court: 'CARTE X1234 02/09 SUPERMARCHE DU COIN',
      complet: 'CARTE X1234 02/09 SUPERMARCHE DU COIN · Paiement carte',
    });
    expect(libelle(ops[2]!)).toEqual({ court: 'BOULANGERIE' });
    expect(libelle(ops[3]!)).toEqual({ court: 'Opération' });
  });
  it('ne garde que les opérations comptabilisées, en ordre chronologique', () => {
    const lignes = versLignes(ops, { compte: 'FR76XXX' });
    expect(lignes.map((l) => [l.line, l.date, l.amount, l.externalRef])).toEqual([
      [1, '2026-08-28', 245000, 'R1'],
      [2, '2026-09-03', -7600, 'R2'],
      [3, '2026-09-03', -3000, 'R3'],
    ]);
    expect(lignes[0]).toMatchObject({ valueDate: '2026-08-29', accountKey: 'FR76XXX', label: 'VIR RECU SALAIRE AOUT' });
    expect(lignes[1]).not.toHaveProperty('valueDate');
    expect(versLignes(ops, { garderAttente: true })).toHaveLength(4);
  });
  it('produit un CSV que l\'importeur du cœur lit sans profil dédié', () => {
    const csv = versCsv(versLignes(ops, { compte: 'FR76XXX' }));
    expect(csv.split('\r\n')[0]).toBe('Date;Date de valeur;Compte;Libellé;Libellé complet;Montant;Référence');
    const cellules = parseCsv(csv);
    expect(guessColumns(cellules[0]!)).toMatchObject({
      date: 'Date',
      valueDate: 'Date de valeur',
      account: 'Compte',
      label: 'Libellé',
      fullLabel: 'Libellé complet',
      amount: 'Montant',
    });
    const profil = newProfileFromRows('p', 'test', cellules);
    const { rows, errors } = parseRows(cellules, profil);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.date, r.amount, r.label, r.accountKey])).toEqual([
      ['2026-08-28', 245000, 'VIR RECU SALAIRE AOUT', 'FR76XXX'],
      ['2026-09-03', -7600, 'CARTE X1234 02/09 SUPERMARCHE DU COIN', 'FR76XXX'],
      ['2026-09-03', -3000, 'Opération', 'FR76XXX'],
    ]);
    expect(rows[0]!.valueDate).toBe('2026-08-29');
    expect(rows[1]!.fullLabel).toBe('CARTE X1234 02/09 SUPERMARCHE DU COIN · Paiement carte');
  });
  it('échappe les guillemets et points-virgules dans le CSV', () => {
    const csv = versCsv([{ line: 1, date: '2026-09-01', label: 'A;B "C"', amount: -100 }]);
    expect(csv).toContain('"A;B ""C"""');
    expect(parseCsv(csv)[1]![3]).toBe('A;B "C"');
  });
});

describe('client', () => {
  const banques = [
    { name: 'Société Générale', country: 'FR', psu_types: ['personal' as const], maximum_consent_validity: 180 * 86_400 },
    { name: 'Société Générale Professionnels', country: 'FR', psu_types: ['business' as const] },
    { name: 'Boursorama', country: 'FR', psu_types: ['personal' as const] },
  ];

  it('trouve la banque sans accents ni casse, en respectant le type de client', () => {
    expect(trouverBanque(banques, 'societe generale')?.name).toBe('Société Générale');
    expect(trouverBanque(banques, SOCIETE_GENERALE.nom, 'business')?.name).toBe('Société Générale Professionnels');
    expect(trouverBanque(banques, 'bourso')?.name).toBe('Boursorama');
    expect(trouverBanque(banques, 'bnp')).toBeUndefined();
  });

  it('enchaîne autorisation, session et opérations paginées avec le jeton en en-tête', async () => {
    const { f, appels } = fauxFetch({
      '/aspsps': { aspsps: banques },
      '/auth': { url: 'https://banque.example/auth?x=1' },
      '/sessions/s1': { session_id: 's1', status: 'AUTHORIZED', accounts: [] },
      '/sessions': (init: RequestInit) => {
        expect(JSON.parse(String(init.body))).toEqual({ code: 'c0de' });
        return { session_id: 's1', accounts: [{ uid: 'u1', account_id: { iban: 'FR76XXX' }, name: 'Compte courant' }] };
      },
      '/accounts/u1/transactions?date_from=2026-06-01&continuation_key=p2': { transactions: [ops[1]], continuation_key: null },
      '/accounts/u1/transactions?date_from=2026-06-01': { transactions: [ops[0]], continuation_key: 'p2' },
    });
    const client = new ClientEnableBanking({ appId: 'app-1', clePem, fetch: f, psu: { ip: '10.0.0.1' } });
    const b = trouverBanque(await client.listerBanques(), 'Société Générale')!;
    const { url } = await client.demarrerAutorisation({
      banque: { name: b.name, country: b.country },
      redirectUrl: 'https://tirelire.example/retour',
      validJusquau: new Date('2027-03-01T00:00:00Z'),
      state: 'etat',
    });
    expect(url).toBe('https://banque.example/auth?x=1');
    const corpsAuth = JSON.parse(String(appels[1]!.init.body));
    expect(corpsAuth).toMatchObject({ aspsp: { name: 'Société Générale', country: 'FR' }, psu_type: 'personal', state: 'etat' });
    expect(corpsAuth.access.valid_until).toBe('2027-03-01T00:00:00.000Z');
    const session = await client.creerSession('c0de');
    expect(session.accounts[0]!.uid).toBe('u1');
    const recues = await client.listerOperations('u1', { depuis: '2026-06-01' });
    expect(recues.map((o) => o.entry_reference)).toEqual(['R2', 'R1']);
    const entetes = appels[0]!.init.headers as Record<string, string>;
    expect(entetes['Authorization']).toMatch(/^Bearer eyJ/);
    expect(entetes['psu-ip-address']).toBe('10.0.0.1');
  });

  it('remonte les erreurs de l\'API avec leur code', async () => {
    const { f } = fauxFetch({ '/sessions/x': new Response(JSON.stringify({ code: 'EXPIRED_SESSION' }), { status: 401 }) });
    const client = new ClientEnableBanking({ appId: 'a', clePem, fetch: f });
    await expect(client.session('x')).rejects.toSatisfy((e: unknown) => e instanceof ErreurEnableBanking && e.sessionExpiree);
  });
});
