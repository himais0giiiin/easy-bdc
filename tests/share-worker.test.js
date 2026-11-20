import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.ts';

function createEnv(extra = {}) {
  const store = new Map();
  const puts = [];
  return {
    store,
    puts,
    env: {
      SHORT_KV: {
        async get(key) { return store.has(key) ? store.get(key) : null; },
        async put(key, value, options) { store.set(key, value); puts.push({ key, value, options }); },
      },
      ...extra,
    },
  };
}

function createRequest(share, headers = {}) {
  return new Request('https://share.example/share/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ share }),
  });
}

test('short share links redirect to the editor with the stored payload', async () => {
  const { env } = createEnv();

  const created = await worker.fetch(createRequest('abc123'), env);
  assert.equal(created.status, 200);
  const slug = new URL((await created.json()).url).pathname.slice(1);
  assert.match(slug, /^[A-Za-z0-9]{7}$/);

  const redirect = await worker.fetch(new Request(`https://share.example/${slug}`), env);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('Location'), 'https://himais0giiiin.com/editor/?share=abc123');
});

test('share creation rejects oversized payloads without writing to KV', async () => {
  const { env, puts } = createEnv();
  const response = await worker.fetch(createRequest('x'.repeat(256 * 1024 + 1)), env);
  assert.equal(response.status, 413);
  assert.equal(puts.length, 0);

  const accepted = await worker.fetch(createRequest('x'.repeat(256 * 1024)), env);
  assert.equal(accepted.status, 200);
  assert.equal(puts.length, 1);
});

test('share creation honours the optional rate limiter and TTL', async () => {
  const keys = [];
  let allowed = true;
  const { env, puts } = createEnv({
    SHARE_TTL_SECONDS: '3600',
    SHARE_RATE_LIMITER: { async limit({ key }) { keys.push(key); return { success: allowed }; } },
  });

  const ok = await worker.fetch(createRequest('abc', { 'CF-Connecting-IP': '203.0.113.5' }), env);
  assert.equal(ok.status, 200);
  assert.deepEqual(keys, ['203.0.113.5']);
  assert.deepEqual(puts[0].options, { expirationTtl: 3600 });

  allowed = false;
  const limited = await worker.fetch(createRequest('abc', { 'CF-Connecting-IP': '203.0.113.5' }), env);
  assert.equal(limited.status, 429);
  assert.equal(puts.length, 1);
});

test('share payloads are stored without expiry unless a TTL is configured', async () => {
  const { env, puts } = createEnv();
  await worker.fetch(createRequest('abc'), env);
  assert.equal(puts[0].options, undefined);
});
