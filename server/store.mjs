import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export function createStore(env = process.env) {
  const url = env.DUTY_SUPABASE_URL, secret = env.DUTY_SUPABASE_SECRET_KEY;
  if (url && secret) {
    if (new URL(url).protocol !== 'https:') throw new Error('Duty database must use HTTPS.');
    async function request(query, method = 'GET', body) {
      const headers = { apikey: secret, 'Content-Type': 'application/json', Prefer: 'return=representation' };
      if (!secret.startsWith('sb_secret_')) headers.Authorization = `Bearer ${secret}`;
      const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/yolo_duties${query}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        const error = new Error(response.status === 409 ? 'This player already has that item assigned for this date.' : 'Duty database unavailable. Check the server configuration and run database/schema.sql.');
        error.status = response.status === 409 ? 409 : 503; throw error;
      }
      return response.status === 204 ? [] : response.json();
    }
    return {
      mode: 'supabase',
      list: (from, to) => request(`?game_date=gte.${from}&game_date=lt.${to}&order=game_date.asc,item.asc`),
      insert: async row => (await request('', 'POST', row))[0],
      insertMany: rows => request('', 'POST', rows),
      update: async (id, patch) => (await request(`?id=eq.${id}`, 'PATCH', patch))[0],
      remove: async id => (await request(`?id=eq.${id}`, 'DELETE')).length > 0
    };
  }
  if (env.VERCEL || env.NODE_ENV === 'production') {
    const fail = () => { const e = new Error('Set DUTY_SUPABASE_URL and DUTY_SUPABASE_SECRET_KEY, then run database/schema.sql to enable shared duties.'); e.status = 503; throw e; };
    return { mode: 'unconfigured', list: fail, insert: fail, insertMany: fail, update: fail, remove: fail };
  }
  const file = resolve(env.DUTY_LOCAL_FILE || '.local/duties.json');
  let queue = Promise.resolve();
  const load = async () => { try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } };
  const mutate = operation => {
    const result = queue.then(async () => {
      const rows = await load(); const value = operation(rows);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(rows, null, 2), { mode: 0o600 });
      await rename(`${file}.tmp`, file); return value;
    });
    queue = result.catch(() => {}); return result;
  };
  return {
    mode: 'local',
    list: async (from, to) => { await queue; return (await load()).filter(r => r.game_date >= from && r.game_date < to).sort((a, b) => a.game_date.localeCompare(b.game_date) || a.item.localeCompare(b.item)); },
    insert: row => mutate(rows => {
      if (rows.some(r => r.game_date === row.game_date && r.item.toLowerCase() === row.item.toLowerCase() && r.player_id === row.player_id)) { const e = new Error('This player already has that item assigned for this date.'); e.status = 409; throw e; }
      rows.push(row); return row;
    }),
    insertMany: additions => mutate(rows => {
      const seen = new Set(rows.map(r => JSON.stringify([r.game_date, r.item.toLowerCase(), r.player_id])));
      for (const row of additions) {
        const key = JSON.stringify([row.game_date, row.item.toLowerCase(), row.player_id]);
        if (seen.has(key)) { const e = new Error('This player already has one of those items assigned for this date. No new items were saved.'); e.status = 409; throw e; }
        seen.add(key);
      }
      rows.push(...additions); return additions;
    }),
    update: (id, patch) => mutate(rows => {
      const row = rows.find(r => r.id === id);
      if (row && patch.player_id && rows.some(r => r.id !== id && r.game_date === row.game_date && r.item.toLowerCase() === row.item.toLowerCase() && r.player_id === patch.player_id)) { const e = new Error('This player already has that item assigned for this date.'); e.status = 409; throw e; }
      if (row) Object.assign(row, patch); return row;
    }),
    remove: id => mutate(rows => { const index = rows.findIndex(r => r.id === id); if (index < 0) return false; rows.splice(index, 1); return true; })
  };
}
