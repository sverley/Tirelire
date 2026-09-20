/**
 * Garde de #113 (D71) : un harnais joué en local ne sort pas de la machine.
 *
 * Ce module se précharge dans les lanceurs locaux : `node --import …/sans-sortie.mjs --test` pour
 * les paquets qui testent avec `node:test`, `sans-sortie-vitest.mjs` en
 * `setupFiles` pour ceux qui testent avec vitest. Il intercepte `net.Socket.prototype.connect`, par
 * où passent `fetch`, `node:http`, `node:https` et `node:tls` :
 *
 * - une connexion vers la boucle locale (`localhost`, `127.0.0.0/8`, `::1`) ou un socket de
 *   fichier passe telle quelle ;
 * - toute autre est refusée avant même la résolution du nom, le socket échoue avec une erreur qui
 *   nomme l'hôte, et la tentative est retenue. Le processus sort alors en échec en la nommant, même
 *   si le harnais ou le code testé a intercepté l'erreur : une sortie avalée reste une sortie.
 *
 * Limites, hors du périmètre de #113 (D62) : les processus enfants qui ne sont pas des lanceurs
 * (serveur du relais, PHP, navigateur) ne sont pas préchargés, et ni `dgram` ni les requêtes DNS
 * ne sont des connexions.
 */
import net from 'node:net';

const ETAT = Symbol.for('tirelire.gardes.sans-sortie');

/**
 * Les seize octets d'une adresse IPv6, ou `null` si l'écriture n'en est pas une. Toutes les
 * écritures d'une même adresse donnent les mêmes octets : `::1`, `0::1` et `0:0:0:0:0:0:0:1` ;
 * `::ffff:127.0.0.1` et `::ffff:7f00:1` (#118).
 */
function octetsIPv6(h) {
  if (!net.isIPv6(h)) return null;
  const [avant, apres = null] = h.split('::');
  const groupes = (p) => (p ? p.split(':').filter(Boolean) : []);
  const tete = groupes(avant);
  const queue = groupes(apres);
  const derniers = [];
  const pointee = queue.length ? queue.at(-1) : tete.at(-1);
  if (pointee && pointee.includes('.')) {
    if (!net.isIPv4(pointee)) return null;
    (queue.length ? queue : tete).pop();
    for (const n of pointee.split('.')) derniers.push(Number(n));
  }
  const octets = [];
  for (const g of tete) octets.push(parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff);
  const restants = 16 - octets.length - queue.length * 2 - derniers.length;
  if (apres === null && restants !== 0) return null;
  if (restants < 0) return null;
  for (let i = 0; i < restants; i++) octets.push(0);
  for (const g of queue) octets.push(parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff);
  octets.push(...derniers);
  return octets.length === 16 ? octets : null;
}

/** Vrai si l'hôte désigne la machine elle-même. Un hôte absent vaut `localhost` pour Node. */
export function estLocal(hote) {
  if (hote === undefined || hote === null || hote === '') return true;
  const h = String(hote).trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  // « Toutes les adresses » désigne la machine quand on s'y connecte.
  if (h === '0.0.0.0' || h === '::') return true;
  if (net.isIPv4(h)) return h.startsWith('127.');
  const o = octetsIPv6(h);
  if (!o) return false;
  // `::1`, sous toutes ses écritures.
  if (o.every((n, i) => n === (i === 15 ? 1 : 0))) return true;
  // IPv4 mappée (`::ffff:a.b.c.d`) : la boucle locale est `127.0.0.0/8`.
  const mappee = o.slice(0, 10).every((n) => n === 0) && o[10] === 0xff && o[11] === 0xff;
  return mappee && o[12] === 127;
}

/**
 * Cible d'un appel à `connect`, sous toutes ses formes : `(options[, cb])`, `(chemin[, cb])`,
 * `(port[, hôte][, cb])`, et le tableau déjà normalisé que passe `net.connect`.
 */
export function cibleDe(args) {
  const a = Array.isArray(args[0]) ? args[0] : args;
  const [premier, second] = a;
  if (premier !== null && typeof premier === 'object') {
    // Comme Node : seul un chemin non vide désigne un socket de fichier (`node:http` passe `null`).
    if (premier.path) return { chemin: String(premier.path) };
    return { hote: premier.host ?? premier.hostname, port: premier.port };
  }
  if (typeof premier === 'string' && !/^\d+$/.test(premier)) return { chemin: premier };
  return { hote: typeof second === 'string' ? second : undefined, port: premier };
}

/** Désignation lisible d'une cible, hôte en tête. */
export const designer = ({ hote, port }) => {
  const h = String(hote);
  const nom = h.includes(':') && !h.startsWith('[') ? `[${h}]` : h;
  return port === undefined || port === null || port === '' ? nom : `${nom}:${port}`;
};

/** Message d'échec, qui nomme chaque hôte visé. */
export function message(tentatives) {
  const cibles = [...new Set(tentatives.map(designer))];
  return (
    `Connexion hors de la machine tentée vers ${cibles.join(', ')} (#113, D71) : ` +
    "un harnais joué en local ne lit que des fichiers suivis et n'ouvre de connexion que sur la boucle locale."
  );
}

const etat = (globalThis[ETAT] ??= { tentatives: [], installe: false });

/** Tentatives retenues depuis le début, ou depuis le dernier `vider`. */
export const tentatives = () => [...etat.tentatives];
export const vider = () => {
  etat.tentatives.length = 0;
};

function installer() {
  if (etat.installe) return;
  etat.installe = true;
  const origine = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    const cible = cibleDe(args);
    if (cible.chemin !== undefined || estLocal(cible.hote)) return origine.apply(this, args);
    etat.tentatives.push(cible);
    const erreur = Object.assign(new Error(`Connexion refusée vers ${designer(cible)} : ${message([cible])}`), {
      code: 'ERR_TIRELIRE_HORS_MACHINE',
      hote: cible.hote,
      port: cible.port,
    });
    process.stderr.write(`${erreur.message}\n`);
    this.connecting = true;
    process.nextTick(() => this.destroy(erreur));
    return this;
  };
  process.on('exit', (code) => {
    if (!etat.tentatives.length) return;
    process.stderr.write(`\n${message(etat.tentatives)}\n`);
    if (!code) process.exitCode = 1;
  });
}

installer();
