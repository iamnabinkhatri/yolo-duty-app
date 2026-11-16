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


test('live members override fallback first names, preserve IDs, and sync additions and deactivations', async () => {
  resetRosterCache();
  let members = [{ id: 'core-alex', name: 'Alex Morgan', active: true }, { id: 'core-sam', name: 'Sam Kerr', active: false }];
  let memberCalls = 0, assetCalls = 0, failMembers = false;
  const fetcher = async url => {
    if (url === 'https://yoloformation.vercel.app') return response('<script src="/assets/live.js"></script>');
    if (String(url).includes('/rest/v1/members?')) {
      memberCalls++;
      if (failMembers) return response({}, 503);
      return response(members);
    }
    if (String(url).includes('/rest/v1/guests?')) return response([]);
    assetCalls++;
    return response(source() + ';function fetchMembers(){return client.from("members").select("*")}');
  };
  const first = await loadRoster({ fetcher, now: 1000000000 });
  assert.deepEqual(first.players, [{ id: 'core-alex', name: 'Alex Morgan', kind: 'member' }]);
  assert.equal(first.membersSynced, true);
  assert.equal(first.refreshAfterSeconds, 30);
  assert.equal(JSON.stringify(first).includes(token), false);
  members = [{ id: 'core-alex', name: 'Alex Updated', active: true }, { id: 'new-id', name: 'New Full Name', active: true }];
  await loadRoster({ fetcher, now: 1000001000 });
  assert.equal(memberCalls, 1);
  const updated = await loadRoster({ fetcher, now: 1000030001 });
  assert.equal(updated.players[0].id, 'core-alex');
  assert.equal(updated.players[0].name, 'Alex Updated');
  assert.equal(updated.players[1].name, 'New Full Name');
  assert.equal(assetCalls, 1, 'live member refresh does not redownload the whole bundle');
  members[0].name = 'Alex Forced';
  const forced = await loadRoster({ fetcher, force: true, now: 1000031000 });
  assert.equal(forced.players[0].name, 'Alex Forced');
  failMembers = true;
  const stale = await loadRoster({ fetcher, force: true, now: 1000032000 });
  assert.equal(stale.stale, true);
  assert.equal(stale.players[0].name, 'Alex Forced', 'never revert to static first names after a live failure');
  resetRosterCache();
  await assert.rejects(loadRoster({ fetcher, now: 1000033000 }), /live YOLO member list/);
  resetRosterCache();
});

test('supports a members-backed app even if its static fallback roster is removed', () => {
  const result = extractPublishedData(`const url='https://example.supabase.co',key='${token}'; function fetchMembers(){ return client.from('members').select('*') }`);
  assert.equal(result.backend.membersTable, true);
  assert.deepEqual(result.players, []);
});
