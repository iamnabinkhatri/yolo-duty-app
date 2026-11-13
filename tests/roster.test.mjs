import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPublishedData, loadRoster, resetRosterCache } from '../server/roster.mjs';

const token = `eyJheader.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
const source = (names = ['Alex', 'Sam']) => `globalThis.shouldNeverExecute = true; const roster=${JSON.stringify(names)}.map(n=>({id:\`core-\${n.toLowerCase()}\`,name:n,core:!0})); const url='https://example.supabase.co',key='${token}';const games=[{weekday:4,time:'19:30',location:'Park',label:'Thursday'}];`;
const response = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
test('reads static player data without executing the published app', () => {
  const result = extractPublishedData(source());
  assert.deepEqual(result.players.map(p => p.name), ['Alex', 'Sam']);
  assert.equal(result.schedules[0].weekday, 4);
  assert.equal(globalThis.shouldNeverExecute, undefined);
});
test('fails visibly if an unrelated array or a changed source format replaces the roster', () => {
  assert.throws(() => extractPublishedData('const unrelated=["Alex","Sam"].map(n=>n);'), /roster format changed/);
});
test('discovers new published players, merges server guests, caches and reports stale data', async () => {
  resetRosterCache(); let names = ['Alex', 'Sam'], broken = false, calls = 0;
  const fetcher = async url => {
    calls++;
    if (broken) throw new Error('offline');
    if (url === 'https://yoloformation.vercel.app') return response('<script src="https://untrusted.example/inject.js"></script><script type="module" src="/assets/app.js"></script>');
    if (String(url).startsWith('https://example.supabase.co/rest/v1/guests')) return response([{ id: 'guest-1', name: 'Taylor' }]);
    assert.equal(String(url), 'https://yoloformation.vercel.app/assets/app.js'); return response(source(names));
  };
  const first = await loadRoster({ fetcher, now: 1000000000 });
  assert.deepEqual(first.players.map(p => p.name), ['Alex', 'Sam', 'Taylor']);
  assert.equal(first.guestsSynced, true);
  assert.equal(JSON.stringify(first).includes(token), false);
  const before = calls; await loadRoster({ fetcher, now: 1000001000 }); assert.equal(calls, before);
  names = ['Alex', 'Sam', 'Jordan'];
  const next = await loadRoster({ fetcher, now: 1000300001 }); assert.ok(next.players.some(p => p.name === 'Jordan'));
  broken = true;
  const stale = await loadRoster({ fetcher, force: true, now: 1000400000 }); assert.equal(stale.stale, true); assert.equal(stale.players.length, 4);
  resetRosterCache();
});
test('supports a future official roster JSON endpoint', async () => {
  resetRosterCache();
  const result = await loadRoster({ rosterUrl: 'https://roster.example/players', fetcher: async () => response({ players: [{ id: 'member-new', name: 'New member' }], schedules: [] }) });
  assert.equal(result.players[0].id, 'member-new');
  resetRosterCache();
});
