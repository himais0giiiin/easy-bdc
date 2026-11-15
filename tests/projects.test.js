import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectLibrary, PROJECTS_KEY, HISTORY_LIMIT } from '../editor/projects.js';

function fixture() {
  const values = new Map();
  const store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let time = 1000;
  const library = new ProjectLibrary(store, () => time);
  return { library, store, values, tick: () => { time += 61000; } };
}
const state = n => JSON.stringify({ blocks: {}, edbbExtraState: { score: n, edbb_json_store: { data: { note: `note-${n}` } } } });

test('projects preserve independent workspaces, names, extras and history across reloads', () => {
  const { library, store } = fixture();
  const first = library.create('最初のBot', state(1));
  library.save(state(2), '日本語のタイトル', '動作確認');
  const second = library.create('別のBot', state(3));
  library.activate(first);
  assert.equal(library.active.state, state(2));
  assert.equal(library.active.title, '日本語のタイトル');
  assert.equal(library.get(second).state, state(3));
  const reloaded = new ProjectLibrary(store);
  assert.deepEqual(reloaded.list(), library.list());
  const duplicate = reloaded.duplicate(first);
  assert.equal(reloaded.get(duplicate).state, state(2));
  reloaded.rename(duplicate, 'コピーを編集');
  reloaded.save(state(4), 'コピーを編集');
  assert.equal(reloaded.get(first).state, state(2));
  assert.throws(() => reloaded.remove(duplicate), /編集中/);
  reloaded.remove(second);
  assert.equal(reloaded.get(second), null);
});

test('history restore preserves current unsnapshotted work and title for recovery', () => {
  const { library, tick } = fixture();
  library.create('旧タイトル', state(1));
  const initial = library.active.history[0].id;
  library.save(state(2), '現在のタイトル');
  library.restore(initial);
  assert.equal(library.active.state, state(1));
  assert.equal(library.active.title, '旧タイトル');
  const before = library.active.history.find(h => h.label === '履歴の復元前');
  assert.equal(before.state, state(2));
  library.restore(before.id);
  assert.equal(library.active.state, state(2));
  assert.equal(library.active.title, '現在のタイトル');
  for (let n = 3; n < 50; n++) { tick(); library.save(state(n), 'Bot'); }
  assert.equal(library.active.history.length, HISTORY_LIMIT);
});

test('autosave avoids duplicate snapshots and manual checkpoints always persist', () => {
  const { library, tick } = fixture();
  library.create('Bot', state(1));
  library.save(state(2), 'Bot');
  assert.equal(library.active.history.length, 1);
  tick(); library.save(state(3), 'Bot');
  assert.equal(library.active.history.length, 2);
  tick(); library.save(state(3), 'Bot');
  assert.equal(library.active.history.length, 2);
  library.save(state(3), 'Bot', 'リリース前');
  assert.equal(library.active.history.at(-1).label, 'リリース前');
});

test('quota failures and stale tabs never advance or overwrite committed project data', () => {
  const { library, store, values } = fixture();
  library.create('Bot', state(1));
  const previous = library.active;
  const persisted = values.get(PROJECTS_KEY);
  const write = store.setItem;
  store.setItem = () => { throw new Error('quota exceeded'); };
  assert.throws(() => library.save(state(2), 'Bot'), /quota/);
  assert.deepEqual(library.active, previous);
  assert.equal(values.get(PROJECTS_KEY), persisted);
  store.setItem = write;
  const otherTab = new ProjectLibrary(store);
  otherTab.save(state(3), '他のタブ');
  assert.throws(() => library.save(state(4), '古いタブ'), /別のタブ/);
  assert.equal(new ProjectLibrary(store).active.state, state(3));
  values.set(PROJECTS_KEY, '{broken');
  assert.throws(() => new ProjectLibrary(store));
  assert.equal(values.get(PROJECTS_KEY), '{broken');
});
