/**
 * Garde de #113 (D71) : un harnais joué en local ne sort pas de la machine.
 *
 * Ce module se précharge dans les lanceurs locaux : `node --import …/sans-sortie.mjs --test` pour
 * les paquets qui testent avec `node:test` et pour `pnpm amorcage`, `sans-sortie-vitest.mjs` en
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

/** Vrai si l'hôte désigne la machine elle-même. Un hôte absent vaut `localhost` pour Node. */
export function estLocal(hote) {
  if (hote === undefined || hote === null || hote === '') return true;
  const h = String(hote).trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  // « Toutes les adresses » désigne la machine quand on s'y connecte.
  if (h === '0.0.0.0' || h === '::') return true;
  const v4 = h.replace(/^::ffff:/, '');
  return net.isIPv4(v4) && v4.startsWith('127.');
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
