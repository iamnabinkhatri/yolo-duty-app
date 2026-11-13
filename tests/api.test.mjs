import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler, monthRange, validDate } from '../server/handler.mjs';
import { createStore } from '../server/store.mjs';

const players = [{ id: 'core-alex', name: 'Alex', kind: 'member' }, { id: 'core-sam', name: 'Sam', kind: 'member' }];
async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'yolo-duty-test-'));
  const env = { DUTY_LOCAL_FILE: join(dir, 'duties.json'), ...overrides };
  const store = createStore(env);
  const server = http.createServer(createHandler({ env, store, roster: async () => ({ players, schedules: [], syncedAt: new Date().toISOString() }) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true }); });
  const request = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, headers: response.headers, data: await response.json() };
  };
  return { request, store, env };
}
const assignment = { game_date: '2026-11-12', item: 'Coffee', player_id: 'core-alex', note: 'Two flasks' };

test('calendar date validation covers leap years and December rollover', () => {
  assert.deepEqual(monthRange('2026-12'), ['2026-12-01', '2027-01-01']);
  assert.equal(validDate('2028-02-29'), true);
  for (const date of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-00-01', 'yesterday']) assert.equal(validDate(date), false);
  assert.throws(() => monthRange('2026-13'));
});
test('all duty operations and roster refresh work without an organizer key', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('roster')).data.players.length, 2);
  assert.equal((await request('roster?refresh=1')).status, 200);
  const created = await request('duties', { method: 'POST', body: assignment });
  assert.equal(created.status, 201);
  const id = created.data.duty.id;
  assert.equal((await request(`duties/${id}`, { method: 'PATCH', body: { status: 'done' } })).status, 200);
  assert.equal((await request(`duties/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request('organizer')).status, 404);
});
test('create/read/update/reassign/delete and restart preserve the same duty data', async t => {
  const { request, env } = await fixture(t);
  const result = await request('duties', { method: 'POST', body: { ...assignment, player_name: 'Forged name' } });
  assert.equal(result.status, 201);
  const row = result.data.duty;
  assert.equal(row.player_name, 'Alex');
  assert.equal((await createStore(env).list('2026-11-01', '2026-12-01'))[0].id, row.id);
  assert.equal((await request('duties?month=2026-12')).data.duties.length, 0);
  const updated = await request(`duties/${row.id}`, { method: 'PATCH', body: { status: 'done', player_id: 'core-sam' } });
  assert.equal(updated.data.duty.status, 'done'); assert.equal(updated.data.duty.player_name, 'Sam');
  const listed = await request('duties?month=2026-11'); assert.equal(listed.data.duties[0].player_name, 'Sam');
  assert.equal((await request(`duties/${row.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request('duties?month=2026-11')).data.duties.length, 0);
  assert.equal((await request(`duties/${row.id}`, { method: 'DELETE' })).status, 404);
});
test('unknown players, invalid dates, oversized notes and duplicate assignments are rejected', async t => {
  const { request } = await fixture(t);
  for (const body of [{ ...assignment, player_id: 'invented' }, { ...assignment, game_date: '2026-02-31' }, { ...assignment, note: 'x'.repeat(501) }, { ...assignment, item: '' }]) assert.equal((await request('duties', { method: 'POST', body })).status, 400);
  assert.equal((await request('duties', { method: 'POST', body: assignment })).status, 201);
  assert.equal((await request('duties', { method: 'POST', body: { ...assignment, item: 'coffee' } })).status, 409);
});
test('concurrent local writes do not lose assignments', async t => {
  const { request } = await fixture(t);
  const replies = await Promise.all(Array.from({ length: 8 }, (_, n) => request('duties', { method: 'POST', body: { ...assignment, item: `Snack ${n}` } })));
  assert.ok(replies.every(r => r.status === 201));
  assert.equal((await request('duties?month=2026-11')).data.duties.length, 8);
});
test('one player can be assigned several items in one atomic request', async t => {
  const { request } = await fixture(t);
  const created = await request('duties', { method: 'POST', body: { game_date: '2026-11-12', player_id: 'core-alex', items: ['Coffee', 'Donuts', 'Snacks'], note: 'For the squad' } });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.duties.map(d => d.item), ['Coffee', 'Donuts', 'Snacks']);
  assert.ok(created.data.duties.every(d => d.player_name === 'Alex' && d.note === 'For the squad'));
  const conflicted = await request('duties', { method: 'POST', body: { game_date: '2026-11-12', player_id: 'core-alex', items: ['Fruit', 'Coffee', 'Water'] } });
  assert.equal(conflicted.status, 409);
  const persisted = (await request('duties?month=2026-11')).data.duties;
  assert.equal(persisted.length, 3);
  assert.equal(persisted.some(d => d.item === 'Fruit' || d.item === 'Water'), false);
});
test('multi-item assignments reject empty, duplicate and oversized selections', async t => {
  const { request } = await fixture(t);
  for (const items of [[], ['Coffee', 'coffee'], [''], Array.from({ length: 11 }, (_, i) => `Item ${i}`), 'Coffee']) {
    assert.equal((await request('duties', { method: 'POST', body: { ...assignment, items } })).status, 400);
  }
  assert.equal((await request('duties?month=2026-11')).data.duties.length, 0);
});
test('production fails closed without durable storage instead of losing data in memory', async t => {
  const { request } = await fixture(t, { VERCEL: '1' });
  assert.equal((await request('config')).data.storage, 'unconfigured');
  assert.equal((await request('duties?month=2026-11')).status, 503);
  assert.equal((await request('duties', { method: 'POST', body: assignment })).status, 503);
});
test('CORS only permits explicitly configured native origins and responses never expose keys', async t => {
  const { request } = await fixture(t, { DUTY_ALLOWED_ORIGINS: 'capacitor://localhost' });
  const allowed = await request('config', { headers: { Origin: 'capacitor://localhost' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'capacitor://localhost');
  assert.equal(Object.keys(allowed.data).some(k => /key|secret/i.test(k)), false);
  assert.equal((await request('config', { headers: { Origin: 'https://unknown.example' } })).headers.get('access-control-allow-origin'), null);
});
