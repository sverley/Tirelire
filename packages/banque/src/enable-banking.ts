/**
 * Client minimal de l'API Enable Banking (information de compte seulement).
 * Aucune dépendance : `fetch` est injectable pour les tests.
 *
 * Parcours : `listerBanques` → `demarrerAutorisation` (URL à ouvrir dans le navigateur)
 * → retour sur `redirect_url?code=…` → `creerSession(code)` → `listerOperations(compte)`.
 */
import { signerJeton } from './jwt.ts';

export const API_ENABLE_BANKING = 'https://api.enablebanking.com';

export interface Banque {
  name: string;
  country: string;
  /** Validité maximale d'un consentement, en secondes (souvent 180 jours). */
  maximum_consent_validity?: number;
  psu_types?: Array<'personal' | 'business'>;
  beta?: boolean;
  required_psu_headers?: string[];
}

export interface CompteBanque {
  uid: string;
  /** Stable d'une session à l'autre : sert à reconnaître le compte. */
  identification_hash?: string;
  account_id?: { iban?: string; other?: { identification?: string; scheme_name?: string } };
  name?: string;
  product?: string;
  currency?: string;
  cash_account_type?: string;
}

export interface Session {
  session_id: string;
  status?: string;
  accounts: CompteBanque[];
  aspsp?: { name: string; country: string };
  access?: { valid_until?: string };
  psu_type?: string;
}

export type StatutOperation = 'BOOK' | 'PDNG' | 'RJCT' | 'SCHD' | 'CNCL' | 'OTHR';

export interface Operation {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount: { currency: string; amount: string };
  credit_debit_indicator?: 'CRDT' | 'DBIT';
  status: StatutOperation;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: { name?: string } | null;
  debtor?: { name?: string } | null;
  remittance_information?: string[] | null;
  bank_transaction_code?: { description?: string; code?: string; sub_code?: string } | null;
  merchant_category_code?: string | null;
  reference_number?: string | null;
  note?: string | null;
}

export interface ReponseOperations {
  transactions: Operation[];
  continuation_key?: string | null;
}

export class ErreurEnableBanking extends Error {
  readonly statut: number;
  readonly code: string | undefined;
  readonly corps: string;
  constructor(statut: number, code: string | undefined, corps: string) {
    super(`Enable Banking ${statut}${code ? ` ${code}` : ''} : ${corps.slice(0, 300)}`);
    this.statut = statut;
    this.code = code;
    this.corps = corps;
  }
  get sessionExpiree(): boolean {
    return this.code === 'EXPIRED_SESSION';
  }
  get limiteAtteinte(): boolean {
    return this.statut === 429;
  }
}

export interface OptionsClient {
  appId: string;
  clePem: string;
  base?: string;
  fetch?: typeof fetch;
  /** En-têtes PSU (ip, user-agent) : présents = l'utilisateur est en ligne, la limite
   *  de 4 appels/jour ne s'applique pas ; absents = récupération en arrière-plan. */
  psu?: { ip?: string; userAgent?: string };
}

export class ClientEnableBanking {
  private readonly o: OptionsClient;
  private readonly base: string;
  private readonly fetchFn: typeof fetch;

  constructor(o: OptionsClient) {
    this.o = o;
    this.base = (o.base ?? API_ENABLE_BANKING).replace(/\/$/, '');
    this.fetchFn = o.fetch ?? globalThis.fetch;
  }

  private entetes(): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${signerJeton({ appId: this.o.appId, clePem: this.o.clePem })}`,
      'Content-Type': 'application/json',
    };
    if (this.o.psu?.ip) h['psu-ip-address'] = this.o.psu.ip;
    if (this.o.psu?.userAgent) h['psu-user-agent'] = this.o.psu.userAgent;
    return h;
  }

  private async appel<T>(chemin: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const r = await this.fetchFn(`${this.base}${chemin}`, {
      method: init?.method ?? 'GET',
      headers: this.entetes(),
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const texte = await r.text();
    if (!r.ok) {
      let code: string | undefined;
      try {
        code = (JSON.parse(texte) as { code?: string }).code;
      } catch {
        /* corps non JSON */
      }
      throw new ErreurEnableBanking(r.status, code, texte);
    }
    return JSON.parse(texte) as T;
  }

  /** Détails de l'application (dont `redirect_urls` autorisées). */
  application(): Promise<{ name?: string; redirect_urls?: string[]; active?: boolean; environment?: string }> {
    return this.appel('/application');
  }

  async listerBanques(pays = 'FR'): Promise<Banque[]> {
    const r = await this.appel<{ aspsps: Banque[] }>(`/aspsps?country=${encodeURIComponent(pays)}`);
    return r.aspsps;
  }

  /** Renvoie l'URL d'autorisation à ouvrir dans un vrai navigateur (pas une WebView). */
  async demarrerAutorisation(p: {
    banque: { name: string; country: string };
    redirectUrl: string;
    validJusquau: Date;
    state: string;
    psuType?: 'personal' | 'business';
    langue?: string;
  }): Promise<{ url: string; authorization_id?: string }> {
    return this.appel('/auth', {
      method: 'POST',
      body: {
        access: { valid_until: p.validJusquau.toISOString() },
        aspsp: p.banque,
        state: p.state,
        redirect_url: p.redirectUrl,
        psu_type: p.psuType ?? 'personal',
        ...(p.langue ? { language: p.langue } : {}),
      },
    });
  }

  creerSession(code: string): Promise<Session> {
    return this.appel('/sessions', { method: 'POST', body: { code } });
  }

  session(id: string): Promise<Session> {
    return this.appel(`/sessions/${encodeURIComponent(id)}`);
  }

  /** Toutes les pages d'opérations d'un compte (suit `continuation_key`). */
  async listerOperations(
    compteUid: string,
    p: { depuis?: string; jusqua?: string; strategie?: 'default' | 'longest' } = {},
  ): Promise<Operation[]> {
    const out: Operation[] = [];
    let cle: string | null | undefined;
    do {
      const q = new URLSearchParams();
      if (p.depuis) q.set('date_from', p.depuis);
      if (p.jusqua) q.set('date_to', p.jusqua);
      if (p.strategie) q.set('strategy', p.strategie);
      if (cle) q.set('continuation_key', cle);
      const qs = q.toString();
      const r = await this.appel<ReponseOperations>(
        `/accounts/${encodeURIComponent(compteUid)}/transactions${qs ? `?${qs}` : ''}`,
      );
      out.push(...r.transactions);
      cle = r.continuation_key;
    } while (cle);
    return out;
  }
}

/** Cherche une banque par nom, sans tenir compte des accents ni de la casse. */
export function trouverBanque(banques: Banque[], nom: string, psuType: 'personal' | 'business' = 'personal'): Banque | undefined {
  const n = normaliserNom(nom);
  const candidates = banques.filter((b) => !b.psu_types || b.psu_types.includes(psuType));
  return candidates.find((b) => normaliserNom(b.name) === n) ?? candidates.find((b) => normaliserNom(b.name).startsWith(n));
}

export function normaliserNom(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
