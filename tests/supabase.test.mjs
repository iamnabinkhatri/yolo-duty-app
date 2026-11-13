import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.mjs';

test('Supabase adapter sends server-only credentials and returns durable API results', async t => {
  const calls = [];
  const row = { id: '00000000-0000-0000-0000-000000000001', game_date: '2026-11-12', item: 'Coffee', player_id: 'core-alex', player_name: 'Alex' };
  const mocked = mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.apikey, 'sb_secret_test-key');
    assert.equal(options.headers.Authorization, undefined);
    assert.match(url, /^https:\/\/duties\.supabase\.co\/rest\/v1\/yolo_duties/);
    const body = options.body ? JSON.parse(options.body) : null;
    return new Response(JSON.stringify(Array.isArray(body) ? body : [{ ...row, ...body }]), { status: 200 });
  });
  t.after(() => mocked.mock.restore());
  const store = createStore({ VERCEL: '1', DUTY_SUPABASE_URL: 'https://duties.supabase.co', DUTY_SUPABASE_SECRET_KEY: 'sb_secret_test-key' });
  assert.equal(store.mode, 'supabase');
  assert.equal((await store.insert(row)).id, row.id);
  assert.equal((await store.insertMany([row, { ...row, item: 'Donuts' }])).length, 2);
  assert.equal((await store.list('2026-11-01', '2026-12-01'))[0].player_name, 'Alex');
  assert.equal((await store.update(row.id, { status: 'done' })).status, 'done');
  assert.equal(await store.remove(row.id), true);
  assert.deepEqual(calls.map(c => c.options.method), ['POST', 'POST', 'GET', 'PATCH', 'DELETE']);
  assert.ok(Array.isArray(JSON.parse(calls[1].options.body)));
  assert.ok(calls[2].url.includes('game_date=gte.2026-11-01&game_date=lt.2026-12-01'));
});

test('Supabase failures are sanitized and duplicate assignments return conflict', async t => {
  let status = 409;
  const mocked = mock.method(globalThis, 'fetch', async () => new Response('sensitive database internals', { status }));
  t.after(() => mocked.mock.restore());
  const store = createStore({ DUTY_SUPABASE_URL: 'https://duties.supabase.co', DUTY_SUPABASE_SECRET_KEY: 'legacy-service-token' });
  await assert.rejects(store.insert({}), e => e.status === 409 && !e.message.includes('sensitive'));
  status = 500;
  await assert.rejects(store.list('2026-11-01', '2026-12-01'), e => e.status === 503 && !e.message.includes('sensitive'));
});
