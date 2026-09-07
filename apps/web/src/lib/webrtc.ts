/**
 * Transport WebRTC pair-à-pair avec signalisation manuelle : l'offre et la
 * réponse (SDP) circulent par QR code ou copier-coller, sans serveur.
 * Sur le même réseau local, les candidats « host » suffisent ; un STUN public
 * est ajouté pour tenter la traversée d'Internet.
 */
import type { SyncMessage, Transport } from '@tirelire/core';

const CHUNK = 12_000; // caractères par message DataChannel (16 Ko max en pratique)

async function deflate(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return toBase64Url(bytes);
}

async function inflate(b64: string): Promise<string> {
  const bytes = fromBase64Url(b64);
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** Réduit une SDP à l'essentiel pour tenir dans un QR code. */
function minifySdp(sdp: string): string {
  return sdp
    .split(/\r?\n/)
    .filter((l) => l && !/^a=(extmap|rtcp-fb|fmtp|rtpmap|ssrc|msid|ice-options|end-of-candidates)/.test(l))
    .join('\n');
}

export interface Signal {
  /** Texte compact à transmettre à l'autre appareil (QR ou copier-coller). */
  code: string;
}

function waitIceComplete(pc: RTCPeerConnection, ms = 2500): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(done, ms);
  });
}

export class WebRtcPeer {
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel | undefined;
  private onMsg: ((m: SyncMessage) => void) | undefined;
  private parts = new Map<string, Array<string | undefined>>();
  readonly connected: Promise<void>;
  private resolveConnected!: () => void;
  private rejectConnected!: (e: Error) => void;

  constructor(private readonly role: 'offer' | 'answer') {
    this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    this.connected = new Promise((res, rej) => {
      this.resolveConnected = res;
      this.rejectConnected = rej;
    });
    this.pc.addEventListener('connectionstatechange', () => {
      if (this.pc.connectionState === 'failed') this.rejectConnected(new Error('Connexion pair-à-pair impossible'));
    });
    if (role === 'offer') {
      this.attach(this.pc.createDataChannel('tirelire', { ordered: true }));
    } else {
      this.pc.addEventListener('datachannel', (e) => this.attach(e.channel));
    }
  }

  private attach(ch: RTCDataChannel): void {
    this.channel = ch;
    ch.addEventListener('open', () => this.resolveConnected());
    ch.addEventListener('message', (e) => this.receive(String(e.data)));
    ch.addEventListener('close', () => undefined);
  }

  /** Côté « proposer » : produit le code à transmettre. */
  async createOffer(): Promise<Signal> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitIceComplete(this.pc);
    return { code: await deflate(minifySdp(this.pc.localDescription!.sdp)) };
  }

  /** Côté « rejoindre » : consomme l'offre et produit la réponse. */
  async acceptOffer(code: string): Promise<Signal> {
    const sdp = await inflate(code.trim());
    await this.pc.setRemoteDescription({ type: 'offer', sdp: sdp.endsWith('\n') ? sdp : sdp + '\n' });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitIceComplete(this.pc);
    return { code: await deflate(minifySdp(this.pc.localDescription!.sdp)) };
  }

  /** Côté « proposer » : consomme la réponse ; la connexion s'établit ensuite. */
  async acceptAnswer(code: string): Promise<void> {
    const sdp = await inflate(code.trim());
    await this.pc.setRemoteDescription({ type: 'answer', sdp: sdp.endsWith('\n') ? sdp : sdp + '\n' });
  }

  transport(): Transport {
    return {
      send: (m) => this.send(m),
      onMessage: (cb) => {
        this.onMsg = cb;
      },
      close: () => this.close(),
    };
  }

  private send(m: SyncMessage): void {
    if (!this.channel || this.channel.readyState !== 'open') throw new Error('Canal non ouvert');
    const text = JSON.stringify(m);
    const id = Math.random().toString(36).slice(2, 10);
    const n = Math.max(1, Math.ceil(text.length / CHUNK));
    for (let i = 0; i < n; i++) {
      this.channel.send(JSON.stringify({ id, i, n, part: text.slice(i * CHUNK, (i + 1) * CHUNK) }));
    }
  }

  private receive(raw: string): void {
    const { id, i, n, part } = JSON.parse(raw) as { id: string; i: number; n: number; part: string };
    let parts = this.parts.get(id);
    if (!parts) {
      parts = new Array<string | undefined>(n).fill(undefined);
      this.parts.set(id, parts);
    }
    parts[i] = part;
    if (parts.every((p) => p !== undefined)) {
      this.parts.delete(id);
      this.onMsg?.(JSON.parse(parts.join('')) as SyncMessage);
    }
  }

  close(): void {
    this.channel?.close();
    this.pc.close();
  }
}
