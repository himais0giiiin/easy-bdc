import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateController, isEditing, updatedPageUrl } from '../editor/app-update.js';

function fixture(overrides = {}) {
  let time = 0;
  let busy = false;
  const calls = [];
  const controller = createUpdateController({
    currentVersion: 'version1', fetchVersion: async () => 'version2',
    save: () => { calls.push('save'); return true; },
    beforeSave: () => calls.push('flush'), reload: version => calls.push(version),
    notify: message => calls.push(message), now: () => time, isBusy: () => busy,
    ...overrides,
  });
  return { controller, calls, tick: value => { time = value; }, busy: value => { busy = value; } };
}

test('new release waits for idle then flushes and saves before a single reload', async () => {
  const f = fixture();
  assert.equal(await f.controller.check(), false);
  assert.equal(f.calls.length, 1);
  f.tick(16000);
  assert.equal(await f.controller.apply(), true);
  assert.deepEqual(f.calls.slice(1), ['flush', 'save', 'version2']);
  await f.controller.apply();
  await f.controller.check();
  assert.equal(f.calls.length, 4);
});

test('typing, an open dialog, dragging or collaboration keep a release pending', async () => {
  const f = fixture();
  await f.controller.check();
  f.tick(16000); f.busy(true);
  assert.equal(await f.controller.apply(), false);
  f.busy(false); f.controller.activity(); f.tick(20000);
  assert.equal(await f.controller.apply(), false);
  f.tick(32000);
  assert.equal(await f.controller.apply(), true);
});

test('failed or throwing saves never reload; recovery can apply the pending update', async () => {
  for (const failure of [() => false, () => { throw new Error('quota'); }]) {
    let recovered = false;
    const f = fixture({ save: () => recovered ? true : failure() });
    await f.controller.check(); f.tick(16000);
    assert.equal(await f.controller.apply(), false);
    assert.equal(await f.controller.apply(), false);
    assert.equal(f.calls.includes('version2'), false);
    assert.equal(f.calls.filter(message => message.includes('保存できない')).length, 1);
    recovered = true;
    assert.equal(await f.controller.apply(), true);
  }
});

test('offline, malformed, unchanged and absent versions do not reload', async () => {
  for (const fetchVersion of [async () => { throw new Error('offline'); }, async () => null,
    async () => '../bad-version', async () => 'version1']) {
    const f = fixture({ fetchVersion }); f.tick(16000);
    assert.equal(await f.controller.check(), false);
    assert.deepEqual(f.calls, []);
  }
  const f = fixture({ currentVersion: '' }); f.tick(16000);
  await f.controller.check(); assert.deepEqual(f.calls, []);
});

test('hidden pages wait and a reverted deployment cancels the pending release', async () => {
  let version = 'version2'; let hidden = false;
  const f = fixture({ fetchVersion: async () => version, isHidden: () => hidden });
  await f.controller.check(); f.tick(16000); hidden = true;
  assert.equal(await f.controller.apply(), false);
  hidden = false; version = 'version1';
  assert.equal(await f.controller.check(), false);
  assert.equal(await f.controller.apply(), false);
  assert.equal(f.calls.includes('save'), false);
});

test('update cache key preserves repository path, shared data and hash', () => {
  const result = new URL(updatedPageUrl('https://edbplugin.github.io/easy-bdp/editor/index.html?share=data&_v=old#anchor', 'version2'));
  assert.equal(result.pathname, '/easy-bdp/editor/index.html');
  assert.equal(result.searchParams.get('share'), 'data');
  assert.equal(result.searchParams.get('_v'), 'version2');
  assert.equal(result.hash, '#anchor');
});

test('focused editors and open modal surfaces delay updates', () => {
  assert.equal(isEditing({ activeElement: { matches: () => true }, querySelector: () => null }), true);
  assert.equal(isEditing({ activeElement: null, querySelector: () => ({}) }), true);
  assert.equal(isEditing({ activeElement: { matches: () => false }, querySelector: () => null }), false);
});
