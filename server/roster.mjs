import { parse } from 'acorn';

export const ORIGINAL = 'https://yoloformation.vercel.app';
const MAX_BYTES = 4_000_000;
let cached, pending;

async function textResponse(url, fetcher) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(12000), redirect: 'error' });
  if (!response.ok) throw new Error('Original YOLO website is unavailable.');
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Original website response is too large.');
  return text;
}
function visit(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') fn(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => visit(item, fn));
    else if (value && typeof value === 'object') visit(value, fn);
  }
}
const propertyName = p => p.key?.name ?? p.key?.value;
const stringValue = node => node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
const isTrue = n => n?.value === true || (n?.type === 'UnaryExpression' && n.operator === '!' && n.argument?.value === 0);

// Read static data from the published app without executing third-party code.
export function extractPublishedData(source) {
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  let names = null, url = null, anon = null, schedules = null;
  visit(tree, node => {
    const literal = stringValue(node);
    if (literal && /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(literal)) url = literal;
    if (literal?.startsWith('eyJ') && literal.split('.').length === 3) {
      try { if (JSON.parse(Buffer.from(literal.split('.')[1], 'base64url')).role === 'anon') anon = literal; } catch {}
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && node.callee.property?.name === 'map' && node.callee.object?.type === 'ArrayExpression') {
      const items = node.callee.object.elements.map(stringValue);
      if (!items.length || !items.every(Boolean)) return;
      let core = false, prefix = false;
      visit(node.arguments[0], child => {
        if (child.type === 'Property' && propertyName(child) === 'core' && isTrue(child.value)) core = true;
        if (child.type === 'TemplateElement' && child.value?.raw === 'core-') prefix = true;
      });
      if (core && prefix) names = items;
    }
    if (node.type === 'ArrayExpression' && node.elements.length >= 1 && node.elements.every(e => e?.type === 'ObjectExpression')) {
      const values = node.elements.map(e => Object.fromEntries(e.properties.filter(p => p.type === 'Property').map(p => [propertyName(p), p.value?.value])));
      if (values.every(v => Number.isInteger(v.weekday) && v.weekday >= 0 && v.weekday < 7 && typeof v.time === 'string' && typeof v.location === 'string' && typeof v.label === 'string')) schedules = values.map(({ weekday, time, location, label }) => ({ weekday, time, location, label }));
    }
  });
  if (!names?.length) throw new Error('The original roster format changed. Configure YOLO_ROSTER_URL with a roster JSON endpoint.');
  return { players: names.map(name => ({ id: `core-${name.toLowerCase()}`, name, kind: 'member' })), backend: url && anon ? { url, anon } : null, schedules: schedules || [] };
}

export function normalizePlayers(players) {
  if (!Array.isArray(players) || !players.length || players.length > 2000) throw new Error('Roster is empty or invalid.');
  const seen = new Set();
  return players.map(p => {
    if (typeof p.id !== 'string' || !p.id.trim() || p.id.length > 150 || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100 || seen.has(p.id)) throw new Error('Roster contains invalid or duplicate players.');
    seen.add(p.id);
    return { id: p.id, name: p.name.trim(), kind: p.kind === 'guest' ? 'guest' : 'member' };
  });
}

export async function loadRoster({ fetcher = fetch, force = false, now = Date.now(), rosterUrl = process.env.YOLO_ROSTER_URL } = {}) {
  if (!force && cached && now - cached.loaded < 300000) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    try {
      let data;
      if (rosterUrl) {
        if (new URL(rosterUrl).protocol !== 'https:') throw new Error('YOLO_ROSTER_URL must use HTTPS.');
        data = JSON.parse(await textResponse(rosterUrl, fetcher));
        data.players = normalizePlayers(data.players);
      } else {
        const html = await textResponse(ORIGINAL, fetcher);
        const assets = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)].map(m => new URL(m[1], ORIGINAL));
        let lastError;
        for (const asset of assets.filter(u => u.origin === ORIGINAL).slice(0, 6)) {
          try { data = extractPublishedData(await textResponse(asset, fetcher)); break; } catch (error) { lastError = error; }
        }
        if (!data) throw lastError || new Error('The original website did not publish a readable roster.');
      }
      let guestsSynced = false;
      if (data.backend) {
        const cutoff = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
        try {
          const response = await fetcher(`${data.backend.url}/rest/v1/guests?select=id,name&game_date=gte.${cutoff}&order=game_date.desc&limit=1000`, {
            headers: { apikey: data.backend.anon, Authorization: `Bearer ${data.backend.anon}` }, signal: AbortSignal.timeout(8000), redirect: 'error'
          });
          if (!response.ok) throw new Error('Guest roster unavailable');
          const guests = await response.json();
          const ids = new Set(data.players.map(p => p.id));
          for (const g of guests) if (typeof g.id === 'string' && typeof g.name === 'string' && !ids.has(g.id)) {
            data.players.push({ id: g.id, name: g.name, kind: 'guest' }); ids.add(g.id);
          }
          guestsSynced = true;
        } catch { /* Core roster remains usable; guest sync status is explicit. */ }
      }
      const value = { players: normalizePlayers(data.players), schedules: data.schedules || [], source: rosterUrl || ORIGINAL, syncedAt: new Date(now).toISOString(), stale: false, guestsSynced };
      cached = { loaded: now, value };
      return value;
    } catch (error) {
      if (cached) return { ...cached.value, stale: true, warning: error.message };
      throw error;
    } finally { pending = null; }
  })();
  return pending;
}

export function resetRosterCache() { cached = null; pending = null; }
