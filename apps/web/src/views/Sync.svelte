<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { alive, runSync, knownPeers, type Device, type SyncResult } from '@tirelire/core';
  import { WebRtcPeer } from '../lib/webrtc';
  import { relaySync, newRoomId, type RelayConfig } from '../lib/relay';
  import { isNative } from '../lib/platform';
  import QRCode from 'qrcode';

  // --- Appareil et utilisateur ---------------------------------------------
  let deviceName = $state('');
  let userName = $state('');
  const me = $derived(alive(app.ledger.devices).find((d) => d.id === app.ledger.settings.siteId));
  $effect(() => {
    if (me) {
      deviceName = me.name;
      userName = me.user ?? '';
    }
  });
  function saveDevice() {
    const d: Device = { id: app.ledger.settings.siteId, name: deviceName.trim() || 'Appareil', ...(userName.trim() ? { user: userName.trim() } : {}), lastSeen: new Date().toISOString() };
    app.upsert('devices', d);
    try {
      localStorage.setItem('tirelire.deviceName', d.name);
    } catch {
      /* rien */
    }
    msg = 'Appareil enregistré.';
  }
  const devices = $derived(alive(app.ledger.devices));
  const peers = $derived(app.ready ? knownPeers(app.store) : []);

  // --- Direct (WebRTC) --------------------------------------------------------
  type Phase = 'idle' | 'offering' | 'waitAnswer' | 'joining' | 'answered' | 'connecting' | 'syncing' | 'done' | 'error';
  let phase = $state<Phase>('idle');
  let myCode = $state('');
  let myQr = $state('');
  let theirCode = $state('');
  let peer: WebRtcPeer | undefined;
  let result = $state<SyncResult | undefined>(undefined);
  let msg = $state('');
  let scanning = $state(false);
  let video: HTMLVideoElement | undefined = $state(undefined);
  let stream: MediaStream | undefined;

  async function showQr(code: string) {
    try {
      myQr = await QRCode.toDataURL(code, { errorCorrectionLevel: 'L', margin: 1, width: 320 });
    } catch {
      myQr = '';
    }
  }

  async function propose() {
    try {
      phase = 'offering';
      peer = new WebRtcPeer('offer');
      const { code } = await peer.createOffer();
      myCode = code;
      await showQr(code);
      phase = 'waitAnswer';
    } catch (err) {
      fail(err);
    }
  }

  async function join() {
    try {
      phase = 'joining';
      peer = new WebRtcPeer('answer');
      const { code } = await peer.acceptOffer(theirCode);
      myCode = code;
      await showQr(code);
      phase = 'answered';
      await connectAndSync();
    } catch (err) {
      fail(err);
    }
  }

  async function finishOffer() {
    try {
      if (!peer) return;
      await peer.acceptAnswer(theirCode);
      phase = 'connecting';
      await connectAndSync();
    } catch (err) {
      fail(err);
    }
  }

  async function connectAndSync() {
    if (!peer) return;
    await peer.connected;
    phase = 'syncing';
    result = await runSync(app.store, peer.transport(), { ...(deviceName ? { name: deviceName } : {}), timeoutMs: 60_000 });
    app.reload();
    peer.close();
    peer = undefined;
    phase = 'done';
  }

  function fail(err: unknown) {
    msg = err instanceof Error ? err.message : String(err);
    phase = 'error';
    peer?.close();
    peer = undefined;
  }

  function resetDirect() {
    peer?.close();
    peer = undefined;
    phase = 'idle';
    myCode = '';
    myQr = '';
    theirCode = '';
    result = undefined;
    stopScan();
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(myCode);
      msg = 'Code copié.';
    } catch {
      msg = 'Copie impossible : sélectionne le texte.';
    }
  }

  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

  async function startScan() {
    try {
      scanning = true;
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      await new Promise((r) => setTimeout(r, 50));
      if (!video) return stopScan();
      video.srcObject = stream;
      await video.play();
      const Detector = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
      const detector = new Detector({ formats: ['qr_code'] });
      const loop = async () => {
        if (!scanning || !video) return;
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) {
            theirCode = codes[0].rawValue;
            stopScan();
            return;
          }
        } catch {
          /* image pas prête */
        }
        setTimeout(loop, 250);
      };
      void loop();
    } catch (err) {
      msg = `Caméra indisponible : ${err instanceof Error ? err.message : String(err)}`;
      stopScan();
    }
  }
  function stopScan() {
    scanning = false;
    stream?.getTracks().forEach((t) => t.stop());
    stream = undefined;
  }

  // --- Relais -----------------------------------------------------------------
  let relay = $state<RelayConfig>(readRelay());
  let relayBusy = $state(false);
  /** Adresse du relais proposée par défaut : le site lui-même quand il est servi par un hébergement
   * (le dossier `apps/hebergement` y installe `relais.php` à côté de la PWA). */
  function relaisParDefaut(): string {
    if (isNative || typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return '';
    return location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');
  }
  function readRelay(): RelayConfig {
    try {
      const saved = JSON.parse(localStorage.getItem('tirelire.relay') ?? '') as RelayConfig;
      return { ...saved, url: saved.url || relaisParDefaut() };
    } catch {
      return { url: relaisParDefaut(), room: '', passphrase: '' };
    }
  }
  function saveRelay() {
    try {
      localStorage.setItem('tirelire.relay', JSON.stringify($state.snapshot(relay)));
      msg = 'Relais enregistré.';
    } catch {
      msg = 'Enregistrement impossible.';
    }
  }
  async function doRelay() {
    relayBusy = true;
    try {
      const r = await relaySync(app.store, $state.snapshot(relay), deviceName || undefined);
      app.reload();
      msg = `Relais : ${r.pushed} changements envoyés, ${r.pulledBundles} paquets reçus, ${r.applied} changements appliqués.`;
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    } finally {
      relayBusy = false;
    }
  }
</script>

<p class="small"><a href="#top" onclick={(e) => { e.preventDefault(); app.view = 'more'; }}>‹ Configuration</a></p>
<h1>Synchronisation</h1>

<h2>Cet appareil</h2>
<div class="card">
  <div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
    <label class="f">Nom de l'appareil <input bind:value={deviceName} placeholder="Téléphone" /></label>
    <label class="f">Utilisé par <input bind:value={userName} placeholder="Prénom" /></label>
  </div>
  <div class="actions" style="margin-bottom:0"><button class="btn" onclick={saveDevice}>Enregistrer</button></div>
  {#if devices.length}
    <h3>Appareils du foyer</h3>
    {#each devices as d (d.id)}
      <div class="row"><div class="label">{d.name}{d.user ? ` · ${d.user}` : ''}<span class="sub num">{d.id}{peers.find((p) => p.site === d.id) ? ` · dernier échange : seq ${peers.find((p) => p.site === d.id)!.cursor}` : ''}</span></div></div>
    {/each}
  {/if}
</div>

<h2>Direct, d'appareil à appareil</h2>
<div class="card">
  <p class="small muted">Sans serveur, sur le même Wi‑Fi (et souvent au-delà). L'un propose et montre un QR code, l'autre le scanne et montre sa réponse, le premier la scanne : la connexion s'établit et les changements s'échangent.</p>
  {#if phase === 'idle'}
    <div class="actions" style="margin-bottom:0">
      <button class="btn primary" onclick={propose}>Proposer</button>
      <button class="btn" onclick={() => (phase = 'joining')}>Rejoindre</button>
    </div>
  {:else if phase === 'offering'}
    <p class="muted">Préparation de l'offre…</p>
  {:else if phase === 'waitAnswer' || phase === 'answered'}
    <p class="small">{phase === 'waitAnswer' ? '1. Fais scanner ce code par l’autre appareil (« Rejoindre »).' : 'Fais scanner ce code par l’appareil qui a proposé.'}</p>
    {#if myQr}<img src={myQr} alt="QR code" style="width:min(320px,100%);image-rendering:pixelated;background:#fff;padding:6px;border-radius:8px" />{/if}
    <div class="actions"><button class="btn small" onclick={copyCode}>Copier le code texte</button></div>
    {#if phase === 'waitAnswer'}
      <p class="small">2. Puis scanne (ou colle) la réponse de l'autre appareil :</p>
      {#if canScan}<div class="actions"><button class="btn" onclick={scanning ? stopScan : startScan}>{scanning ? 'Arrêter la caméra' : 'Scanner la réponse'}</button></div>{/if}
      {#if scanning}<video bind:this={video} muted playsinline style="width:100%;max-height:320px;border-radius:8px"></video>{/if}
      <label class="f">Réponse (code texte) <textarea bind:value={theirCode} rows="3" style="width:100%"></textarea></label>
      <div class="actions" style="margin-bottom:0">
        <button class="btn primary" onclick={finishOffer} disabled={!theirCode.trim()}>Connecter</button>
        <button class="btn" onclick={resetDirect}>Annuler</button>
      </div>
    {:else}
      <p class="muted">En attente de la connexion…</p>
    {/if}
  {:else if phase === 'joining'}
    <p class="small">Scanne (ou colle) le code de l'appareil qui propose :</p>
    {#if canScan}<div class="actions"><button class="btn" onclick={scanning ? stopScan : startScan}>{scanning ? 'Arrêter la caméra' : 'Scanner le code'}</button></div>{/if}
    {#if scanning}<video bind:this={video} muted playsinline style="width:100%;max-height:320px;border-radius:8px"></video>{/if}
    <label class="f">Code (texte) <textarea bind:value={theirCode} rows="3" style="width:100%"></textarea></label>
    <div class="actions" style="margin-bottom:0">
      <button class="btn primary" onclick={join} disabled={!theirCode.trim()}>Répondre</button>
      <button class="btn" onclick={resetDirect}>Annuler</button>
    </div>
  {:else if phase === 'connecting'}
    <p class="muted">Connexion…</p>
  {:else if phase === 'syncing'}
    <p class="muted">Échange des changements…</p>
  {:else if phase === 'done' && result}
    <div class="card accent" style="margin:0">
      <strong>Synchronisé avec {result.peerName ?? result.peer}</strong>
      <div class="row"><div class="label">Envoyés</div><div class="num">{result.sent}</div></div>
      <div class="row"><div class="label">Reçus / appliqués</div><div class="num">{result.received} / {result.applied}</div></div>
    </div>
    <div class="actions" style="margin-bottom:0"><button class="btn" onclick={resetDirect}>Terminer</button></div>
  {:else if phase === 'error'}
    <div class="err">{msg}</div>
    <div class="actions" style="margin-bottom:0"><button class="btn" onclick={resetDirect}>Réessayer</button></div>
  {/if}
</div>

<h2>Par un serveur privé (relais)</h2>
<div class="card">
  <p class="small muted">Un serveur à toi stocke des paquets chiffrés sans pouvoir les lire : soit le petit serveur Node (dossier <span class="num">apps/relay</span>), soit ce site lui-même quand il est installé sur un hébergement web (dossier <span class="num">apps/hebergement</span>, adresse proposée d'office). Même salon et même phrase sur tous les appareils du foyer.</p>
  <div class="grid" style="display:grid;gap:10px">
    <label class="f">Adresse du relais <input bind:value={relay.url} placeholder="https://maison.exemple.fr/tirelire" /></label>
    <label class="f">Salon <span style="display:flex;gap:6px"><input bind:value={relay.room} placeholder="identifiant secret" /><button class="btn small" type="button" onclick={() => (relay.room = newRoomId())}>Générer</button></span></label>
    <label class="f">Phrase de chiffrement <input type="password" bind:value={relay.passphrase} /></label>
  </div>
  <div class="actions" style="margin-bottom:0">
    <button class="btn" onclick={saveRelay}>Enregistrer</button>
    <button class="btn primary" onclick={doRelay} disabled={relayBusy || !relay.url || !relay.room || !relay.passphrase}>{relayBusy ? 'Échange…' : 'Synchroniser maintenant'}</button>
  </div>
</div>

{#if msg && phase !== 'error'}<p class="small">{msg}</p>{/if}
