// Relais Tirelire : un dépôt de paquets chiffrés par « salon », sans dépendance.
//   POST /r/:salon            { site, upTo, iv, blob }  → { id }
//   GET  /r/:salon?site=X&after=N  → { records: [{ id, site, upTo, iv, blob }] }  (paquets des autres appareils)
// Le salon est un secret partagé (identifiant aléatoire) ; le contenu est chiffré côté client.
import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 8787);
const DATA = process.env.TIRELIRE_RELAY_DATA ?? path.resolve('data');
const MAX_BODY = 20 * 1024 * 1024;
const ROOM = /^[A-Za-z0-9_-]{8,64}$/;

await mkdir(DATA, { recursive: true });

function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(s);
}

async function readRoom(room) {
  const file = path.join(DATA, `${room}.jsonl`);
  if (!existsSync(file)) return [];
  const text = await readFile(file, 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return json(res, 204, {});
    const url = new URL(req.url ?? '/', 'http://localhost');
    const m = /^\/r\/([^/]+)$/.exec(url.pathname);
    if (!m) return json(res, 404, { error: 'introuvable' });
    const room = decodeURIComponent(m[1]);
    if (!ROOM.test(room)) return json(res, 400, { error: 'salon invalide' });

    if (req.method === 'GET') {
      const site = url.searchParams.get('site') ?? '';
      const after = Number(url.searchParams.get('after') ?? 0);
      const records = (await readRoom(room)).filter((r) => r.id > after && r.site !== site);
      return json(res, 200, { records });
    }
    if (req.method === 'POST') {
      let size = 0;
      const chunks = [];
      for await (const c of req) {
        size += c.length;
        if (size > MAX_BODY) return json(res, 413, { error: 'trop gros' });
        chunks.push(c);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof body.site !== 'string' || typeof body.blob !== 'string' || typeof body.iv !== 'string')
        return json(res, 400, { error: 'paquet invalide' });
      const existing = await readRoom(room);
      const id = (existing[existing.length - 1]?.id ?? 0) + 1;
      const record = { id, site: body.site, upTo: Number(body.upTo ?? 0), iv: body.iv, blob: body.blob, at: new Date().toISOString() };
      await appendFile(path.join(DATA, `${room}.jsonl`), JSON.stringify(record) + '\n');
      return json(res, 201, { id });
    }
    return json(res, 405, { error: 'méthode' });
  } catch (err) {
    json(res, 500, { error: String(err?.message ?? err) });
  }
}).listen(PORT, () => console.log(`Relais Tirelire sur http://0.0.0.0:${PORT} (données : ${DATA})`));
