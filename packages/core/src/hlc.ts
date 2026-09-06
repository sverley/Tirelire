/**
 * Horloge logique hybride : heure murale + compteur + identifiant d'appareil.
 * Donne un ordre total entre tous les changements de tous les appareils et
 * tolère une montre en avance ou en retard.
 *
 * Format texte (ordre lexicographique = ordre temporel) :
 *   `AAAAAAAAAAAAA:CCCC:site`  (ms sur 13 chiffres, compteur hexadécimal sur 4).
 */
export interface Timestamp {
  wall: number;
  counter: number;
  site: string;
}

export function formatTimestamp(t: Timestamp): string {
  return `${String(t.wall).padStart(13, '0')}:${t.counter.toString(16).padStart(4, '0')}:${t.site}`;
}

export function parseTimestamp(s: string): Timestamp {
  const m = /^(\d{13}):([0-9a-f]{4}):(.+)$/.exec(s);
  if (!m) throw new Error(`Horodatage logique invalide : ${s}`);
  return { wall: Number(m[1]), counter: parseInt(m[2]!, 16), site: m[3]! };
}

export class HLC {
  private wall = 0;
  private counter = 0;

  constructor(
    readonly site: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Restaure l'état depuis le dernier horodatage émis ou reçu. */
  restore(last: string | undefined): void {
    if (!last) return;
    const t = parseTimestamp(last);
    this.wall = t.wall;
    this.counter = t.counter;
  }

  /** Nouvel horodatage pour un changement local. */
  tick(): string {
    const now = this.now();
    if (now > this.wall) {
      this.wall = now;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return formatTimestamp({ wall: this.wall, counter: this.counter, site: this.site });
  }

  /** Prend en compte un horodatage reçu d'un autre appareil. */
  receive(remote: string): void {
    const r = parseTimestamp(remote);
    const now = this.now();
    if (now > this.wall && now > r.wall) {
      this.wall = now;
      this.counter = 0;
    } else if (r.wall > this.wall) {
      this.wall = r.wall;
      this.counter = r.counter + 1;
    } else if (r.wall === this.wall) {
      this.counter = Math.max(this.counter, r.counter) + 1;
    } else {
      this.counter++;
    }
  }
}
