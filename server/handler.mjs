import { randomUUID } from 'node:crypto';
import { loadRoster } from './roster.mjs';
import { createStore } from './store.mjs';

export function monthRange(month) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw Object.assign(new Error('Use a month in YYYY-MM format.'), { status: 400 });
  const [year, number] = month.split('-').map(Number);
  return [`${month}-01`, new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10)];
}
export function validDate(value) {
  return typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
const error = (message, status = 400) => Object.assign(new Error(message), { status });
async function readBody(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw error('Send application/json.', 415);
  if (req.body && typeof req.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(req.body)) > 16384) throw error('Request too large.', 413);
    return req.body;
  }
  let text = '', size = 0;
  if (typeof req.body === 'string') text = req.body;
  else for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > 16384) throw error('Request too large.', 413); text += chunk; }
  if (Buffer.byteLength(text) > 16384) throw error('Request too large.', 413);
  try { const body = JSON.parse(text); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; } catch { throw error('Invalid JSON body.'); }
}
function text(value, max, label, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.trim().length > max || (!optional && !value.trim())) throw error(`${label} must be ${optional ? 'at most' : 'between 1 and'} ${max} characters.`);
  return value.trim();
}
export function createHandler({ env = process.env, store = createStore(env), roster = loadRoster } = {}) {
  return async function handle(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const allowedOrigins = (env.DUTY_ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
    if (req.headers.origin && allowedOrigins.includes(req.headers.origin)) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    const send = (status, value) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    try {
      if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
      const url = new URL(req.url, 'http://localhost');
      const path = url.searchParams.get('path') ? `/api/${url.searchParams.get('path').replace(/^\/+/, '')}` : url.pathname.replace(/\/$/, '');
      if (path === '/api/config' && req.method === 'GET') return send(200, { storage: store.mode, development: store.mode === 'local', originalUrl: 'https://yoloformation.vercel.app/', apiVersion: 1 });
      if (path === '/api/roster' && req.method === 'GET') {
        return send(200, await roster({ force: url.searchParams.get('refresh') === '1' }));
      }
      if (path === '/api/duties' && req.method === 'GET') {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(new Date()).map(p => [p.type, p.value]));
        const month = url.searchParams.get('month') || `${parts.year}-${parts.month}`;
        const [from, to] = monthRange(month);
        return send(200, { duties: await store.list(from, to) });
      }
      if (path === '/api/duties' && req.method === 'POST') {
        const body = await readBody(req);
        if (!validDate(body.game_date)) throw error('Choose a valid game date.');
        const data = await roster();
        const player = data.players.find(p => p.id === body.player_id);
        if (!player) throw error('Choose a player from the current YOLO roster. Refresh the list if someone was just added.');
        const multiple = body.items !== undefined;
        const items = multiple ? body.items : [body.item];
        if (!Array.isArray(items) || items.length < 1 || items.length > 10) throw error('Choose between 1 and 10 items.');
        const cleaned = items.map(item => text(item, 60, 'Item'));
        if (new Set(cleaned.map(item => item.toLowerCase())).size !== cleaned.length) throw error('Choose each item only once.');
        const now = new Date().toISOString(), note = text(body.note, 500, 'Note', true);
        const additions = cleaned.map(item => ({ id: randomUUID(), game_date: body.game_date, item, player_id: player.id, player_name: player.name, note, status: 'assigned', created_at: now, updated_at: now }));
        if (multiple) return send(201, { duties: await store.insertMany(additions) });
        return send(201, { duty: await store.insert(additions[0]) });
      }
      const match = path.match(/^\/api\/duties\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
      if (match && ['PATCH', 'DELETE'].includes(req.method)) {
        if (req.method === 'DELETE') {
          if (!await store.remove(match[1])) throw error('Assignment not found.', 404);
          return send(200, { deleted: true });
        }
        const body = await readBody(req), patch = { updated_at: new Date().toISOString() };
        if (body.status !== undefined) { if (!['assigned', 'done'].includes(body.status)) throw error('Status must be assigned or done.'); patch.status = body.status; }
        if (body.note !== undefined) patch.note = text(body.note, 500, 'Note', true);
        if (body.player_id !== undefined) {
          const player = (await roster()).players.find(p => p.id === body.player_id);
          if (!player) throw error('Choose a player from the current YOLO roster.');
          patch.player_id = player.id; patch.player_name = player.name;
        }
        if (Object.keys(patch).length === 1) throw error('Provide status, note or player_id.');
        const row = await store.update(match[1], patch);
        if (!row) throw error('Assignment not found.', 404);
        return send(200, { duty: row });
      }
      throw error('API endpoint or method not found.', 404);
    } catch (e) { return send(e.status || 502, { error: e.status ? e.message : 'Could not reach the original roster or duty backend. Please try again.' }); }
  };
}
