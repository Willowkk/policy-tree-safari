import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const origin = 'https://policy-tree.test';
const assets = ['/', '/index.html', '/assets/app.js', '/assets/app.css', '/icon.svg'];
const release = 'policy-tree-local-test';
const template = readFileSync(new URL('../src/service-worker.template.js', import.meta.url), 'utf8');
const code = template.replace('__RELEASE__', JSON.stringify(release)).replace('__PRECACHE__', JSON.stringify(assets));
function setup(overrides = {}) {
  const handlers = {};
  const buckets = new Map();
  const fetched = [];
  let skipped = 0, claimed = 0;
  const type = path => path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
  const caches = {
    keys: async () => [...buckets.keys()],
    delete: async key => buckets.delete(key),
    open: async key => {
      if (!buckets.has(key)) buckets.set(key, new Map());
      const bucket = buckets.get(key);
      return { put: async (key, response) => bucket.set(key, response.clone()), match: async key => bucket.get(key)?.clone() };
    },
  };
  const self = {
    location: { origin },
    addEventListener: (name, handler) => { handlers[name] = handler; },
    skipWaiting: () => { skipped++; },
    clients: { claim: async () => { claimed++; } },
  };
  const fetch = async request => {
    fetched.push(request);
    if (overrides.fetch) return overrides.fetch(request);
    const path = new URL(request.url).pathname;
    return new Response('body:' + path, { headers: { 'content-type': type(path) } });
  };
  class RelativeRequest extends Request {
    constructor(url, init) { super(new URL(url, origin), init); }
  }
  vm.runInNewContext(code, { self, caches, fetch, Request: RelativeRequest, URL, Set, Promise, Error });
  async function lifecycle(name) {
    let promise;
    handlers[name]({ waitUntil: value => { promise = value; } });
    await promise;
  }
  async function request(path, init) {
    let result;
    handlers.fetch({ request: new Request(new URL(path, origin), init), respondWith: value => { result = value; } });
    return result ? await result : undefined;
  }
  return { handlers, buckets, fetched, lifecycle, request, skipped: () => skipped, claimed: () => claimed };
}

test('install precaches the complete static application without identity credentials', async () => {
  const env = setup();
  await env.lifecycle('install');
  assert.equal(env.buckets.get(release).size, assets.length);
  assert.ok(env.fetched.every(request => request.credentials === 'omit'));
  assert.equal(env.skipped(), 0);
});
test('cached app and modules remain available without a network request', async () => {
  const env = setup();
  await env.lifecycle('install');
  const count = env.fetched.length;
  assert.equal(await (await env.request('/')).text(), 'body:/');
  assert.equal(await (await env.request('/assets/app.js')).text(), 'body:/assets/app.js');
  assert.equal(env.fetched.length, count);
});
test('API, external, queried and non-GET requests never enter the cache handler', async () => {
  const env = setup();
  for (const path of ['/api/state', '/api/session', '/?secret=value', 'https://other.test/assets/app.js']) {
    assert.equal(await env.request(path), undefined);
  }
  assert.equal(await env.request('/', { method: 'POST', body: 'private data' }), undefined);
  assert.equal(env.fetched.length, 0);
});
test('an uncached permitted asset falls back to the network', async () => {
  const env = setup();
  assert.equal(await (await env.request('/assets/app.js')).text(), 'body:/assets/app.js');
});
test('activation removes only older Policy Tree local caches', async () => {
  const env = setup();
  env.buckets.set('policy-tree-local-old', new Map());
  env.buckets.set(release, new Map());
  env.buckets.set('another-app-cache', new Map());
  await env.lifecycle('activate');
  assert.ok(!env.buckets.has('policy-tree-local-old'));
  assert.ok(env.buckets.has(release));
  assert.ok(env.buckets.has('another-app-cache'));
  assert.equal(env.claimed(), 1);
});
test('updates activate only after the explicit update message', () => {
  const env = setup();
  env.handlers.message({ data: { type: 'OTHER' } });
  assert.equal(env.skipped(), 0);
  env.handlers.message({ data: { type: 'SKIP_WAITING' } });
  assert.equal(env.skipped(), 1);
});
test('install rejects a redirect rather than caching a sign-in response', async () => {
  const env = setup({ fetch: async () => ({ ok: true, redirected: true, headers: new Headers({ 'content-type': 'text/html' }) }) });
  await assert.rejects(env.lifecycle('install'), /Offline asset/);
});
test('install rejects HTML in place of a JavaScript module', async () => {
  const env = setup({ fetch: async () => new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }) });
  await assert.rejects(env.lifecycle('install'), /Invalid script/);
});
