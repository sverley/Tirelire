/**
 * Jeton d'application Enable Banking : JWT RS256 signé avec la clé privée
 * générée à la création de l'application, `kid` = identifiant d'application.
 * Durée maximale acceptée par l'API : 24 h. On en génère un court par lot d'appels.
 */
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

export interface ParametresJeton {
  appId: string;
  /** Clé privée au format PEM (PKCS#8 « BEGIN PRIVATE KEY » ou PKCS#1 « BEGIN RSA PRIVATE KEY »). */
  clePem: string;
  /** Validité en secondes (défaut 1 h, maximum 86 400). */
  dureeSecondes?: number;
  /** Horloge injectable pour les tests (secondes Unix). */
  maintenant?: () => number;
}

export function base64Url(data: string | Uint8Array): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function chargerClePrivee(pem: string): KeyObject {
  return createPrivateKey({ key: pem, format: 'pem' });
}

export function signerJeton(p: ParametresJeton): string {
  const duree = Math.min(p.dureeSecondes ?? 3600, 86_400);
  const iat = (p.maintenant ?? (() => Math.floor(Date.now() / 1000)))();
  const entete = base64Url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: p.appId }));
  const corps = base64Url(
    JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp: iat + duree }),
  );
  const signature = sign('sha256', Buffer.from(`${entete}.${corps}`), chargerClePrivee(p.clePem));
  return `${entete}.${corps}.${base64Url(signature)}`;
}
