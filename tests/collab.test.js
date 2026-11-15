import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { webcrypto } from 'node:crypto';
import { attachBotSettingsState, BOT_SETTINGS_EXTRA_STATE_KEY } from '../editor/bot-settings.js';

const source = readFileSync(new URL('../editor/collab.js', import.meta.url), 'utf8')
    .replace('export class CollabManager', 'globalThis.CollabManager = class CollabManager');
const copy = value => JSON.parse(JSON.stringify(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Separate JS globals, workspace, and storage for each browser. Transport delivery
// is asynchronous and ordered per connection, as it is for reliable data channels.
function room() {
    const peers = new Map();
    const clients = [];
    let nextId = 0;
    class Connection extends EventEmitter {
        constructor(peer) { super(); this.peer = peer; this.open = false; }
        send(data) {
            const payload = copy(data);
            setTimeout(() => { if (this.other.open) this.other.emit('data', payload); }, this.delay || 0);
        }
        close() {
            if (this.closed) return;
            this.closed = true;
            this.open = false;
            this.emit('close');
            this.other?.close();
        }
    }
    class Peer extends EventEmitter {
        constructor(id) {
            super(); this.id = typeof id === 'string' ? id : `guest-${++nextId}`;
            this.links = []; peers.set(this.id, this);
            setTimeout(() => this.emit('open', this.id), 0);
        }
        connect(id) {
            const conn = new Connection(id); this.links.push(conn);
            const target = peers.get(id);
            if (!target) {
                setTimeout(() => this.emit('error', { type: 'peer-unavailable' }), 0);
                return conn;
            }
            const incoming = new Connection(this.id);
            conn.other = incoming; incoming.other = conn; target.links.push(incoming);
            target.emit('connection', incoming);
            setTimeout(() => {
                conn.open = incoming.open = true;
                incoming.emit('open'); conn.emit('open');
            }, 0);
            return conn;
        }
        destroy() {
            this.destroyed = true; peers.delete(this.id);
            this.links.forEach(conn => conn.close()); this.emit('close');
        }
    }
    function client(initial = {}) {
        let disabled = 0;
        const title = { value: 'local' };
        const storage = new Map();
        const workspace = {
            state: copy(initial), extra: {}, listeners: [],
            addChangeListener(fn) { this.listeners.push(fn); },
            clearUndo() {}, getExtraState() { return this.extra; },
            setExtraState(extra) { this.extra = copy(extra); },
        };
        const Events = { BLOCK_CREATE: 'create', BLOCK_CHANGE: 'change', BLOCK_DELETE: 'delete',
            FINISHED_LOADING: 'finished_loading', SELECTED: 'selected',
            disable() { disabled++; }, enable() { disabled--; },
            fromJson(event, ws) { return { run() {
                if (event.bad) throw new Error('invalid event');
                if (event.type === 'delete') delete ws.state[event.blockId];
                else ws.state[event.blockId] = event.value;
                if (!disabled) ws.listeners.forEach(fn => fn({ ...event, toJson: () => event }));
            } }; },
        };
        const context = vm.createContext({ console, setTimeout, clearTimeout, crypto: webcrypto, URL, Peer,
            document: { getElementById: () => title },
            localStorage: { getItem: () => null, setItem() {} },
            sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
            Blockly: { Events, Blocks: {}, serialization: { workspaces: {
                save: ws => copy(ws.state),
                load(state, ws) { if (state.invalid) { ws.state = {}; throw new Error('invalid snapshot'); } ws.state = copy(state); },
            } } },
        });
        vm.runInContext(source, context);
        const manager = new context.CollabManager(workspace);
        const actor = { manager, workspace, title, context, storage,
            edit(id, value) { const event = { type: 'change', blockId: id, value }; Events.fromJson(event, workspace).run(); },
            comment(id, value) { const event = { type: 'change', element: 'comment', blockId: id, value }; Events.fromJson(event, workspace).run(); },
        };
        clients.push(actor);
        return actor;
    }
    return { client, cleanup: () => clients.forEach(c => c.manager.disconnect()) };
}

test('three peers converge after simultaneous changes, duplicates and delayed acknowledgements', async t => {
    const network = room(); t.after(network.cleanup);
    const host = network.client({ a: 0 });
    const first = network.client(), second = network.client();
    const id = await host.manager.createRoom();
    await Promise.all([first.manager.joinRoom(id), second.manager.joinRoom(id)]);
    assert.equal(host.manager.getAllUsers().length, 3);
    first.manager.connections.get(id).delay = 90;
    first.edit('a', 1); second.edit('b', 2); host.edit('c', 3);
    await sleep(75);
    assert.equal(first.workspace.state.a, 1, 'unacknowledged local edit survives host snapshot');
    await sleep(160);
    for (const actor of [first, second]) {
        assert.deepEqual(actor.workspace.state, host.workspace.state);
        assert.equal(actor.manager.pending.length, 0);
    }
    assert.deepEqual(host.workspace.state, { a: 1, b: 2, c: 3 });
    first.manager.connections.get(id).send({ type: 'operation', sequence: 1, operation: { type: 'event', event: { type: 'change', blockId: 'a', value: 99 } } });
    await sleep(110);
    assert.equal(host.workspace.state.a, 1, 'duplicate operation ignored');
});

test('native Blockly block comments still synchronize across peers and reconnect', async t => {
    const network = room(); t.after(network.cleanup);
    const host = network.client(), first = network.client(), second = network.client();
    const id = await host.manager.createRoom();
    await Promise.all([first.manager.joinRoom(id), second.manager.joinRoom(id)]);
    first.manager.connections.get(id).delay = 90;
    first.comment('a', '質問'); second.comment('b', '修正メモ'); host.comment('c', '確認');
    assert.equal(first.manager.pending[0].operation.type, 'event');
    assert.equal(first.manager.pending[0].operation.event.element, 'comment');
    await sleep(250);
    assert.deepEqual(host.workspace.state, { a: '質問', b: '修正メモ', c: '確認' });
    for (const actor of [first, second]) assert.deepEqual(actor.workspace.state, host.workspace.state);
    first.comment('a', '修正済み'); second.comment('b', '');
    await sleep(250);
    assert.equal(host.workspace.state.a, '修正済み');
    assert.equal(host.workspace.state.b, '');
    for (const actor of [first, second]) assert.deepEqual(actor.workspace.state, host.workspace.state);
    second.manager.disconnect();
    await second.manager.joinRoom(id);
    assert.deepEqual(second.workspace.state, host.workspace.state);
});

test('failed join and malformed initial sync preserve document and reject', async t => {
    const network = room(); t.after(network.cleanup);
    const guest = network.client({ mine: 42 });
    await assert.rejects(guest.manager.joinRoom('edbb-missing'), /ルームが見つかりません/);
    assert.deepEqual(guest.workspace.state, { mine: 42 });
    assert.equal(guest.manager.status, 'disconnected');
    const host = network.client({ invalid: true });
    const id = await host.manager.createRoom();
    await assert.rejects(guest.manager.joinRoom(id), /invalid snapshot/);
    assert.deepEqual(guest.workspace.state, { mine: 42 });
    assert.equal(guest.manager.isSyncing, false);
});

test('host loss notifies once and recovery restores blocks, title and extra data', async t => {
    const network = room(); t.after(network.cleanup);
    const host = network.client({ shared: true }), guest = network.client({ mine: true });
    guest.workspace.extra = { lists: [1, 2] };
    guest.title.value = 'original';
    const id = await host.manager.createRoom();
    await guest.manager.joinRoom(id);
    let losses = 0;
    guest.manager.onStateChange(type => { if (type === 'host_disconnected') losses++; });
    host.manager.disconnect();
    assert.equal(losses, 1);
    assert.equal(guest.manager.restoreInitialBackup(), true);
    assert.deepEqual(guest.workspace.state, { mine: true });
    assert.deepEqual(guest.workspace.extra, { lists: [1, 2] });
    assert.equal(guest.title.value, 'original');
});

test('bot settings converge across peers without rebroadcasting remote snapshots', async t => {
    const network = room(); t.after(network.cleanup);
    const host = network.client(), guest = network.client(), observer = network.client();
    const controllers = [host, guest, observer].map(actor => attachBotSettingsState(actor.workspace, (settings, source) => {
        if (source === 'local') actor.manager.broadcastExtraChange({ [BOT_SETTINGS_EXTRA_STATE_KEY]: settings });
    }));
    controllers[0].set({ commandPrefix: 'edb!' });
    controllers[1].set({ commandPrefix: 'mine!' });
    const id = await host.manager.createRoom();
    await Promise.all([guest.manager.joinRoom(id), observer.manager.joinRoom(id)]);
    assert.equal(controllers[1].get().commandPrefix, 'edb!');
    controllers[1].set({ commandPrefix: '?', members: true });
    await sleep(140);
    for (const controller of controllers) {
        assert.equal(controller.get().commandPrefix, '?');
        assert.equal(controller.get().members, true);
    }
    assert.equal(guest.manager.pending.length, 0);
    assert.equal(observer.manager.sequence, 0, 'remote loads never generate new operations');
    guest.manager.disconnect();
    assert.equal(guest.manager.restoreInitialBackup(), true);
    assert.equal(controllers[1].get().commandPrefix, 'mine!');
});

test('guest cannot forge snapshots, host identity, departures or another user selection', async t => {
    const network = room(); t.after(network.cleanup);
    const host = network.client({ safe: true }), guest = network.client();
    const id = await host.manager.createRoom(); await guest.manager.joinRoom(id);
    const conn = guest.manager.connections.get(id);
    conn.send({ type: 'snapshot', revision: 999, snapshot: { state: { hacked: true } } });
    conn.send({ type: 'user_update', user: { id, isHost: true, name: 'guest', color: 'url(evil)' } });
    conn.send({ type: 'users', users: [] });
    conn.send({ type: 'selection_change', senderId: id, blockId: 'safe' });
    await sleep(20);
    assert.deepEqual(host.workspace.state, { safe: true });
    const user = host.manager.remoteUsers.get(guest.manager.myUser.id);
    assert.equal(user.isHost, false);
    assert.equal(user.color, '#3b82f6');
    assert.equal(host.manager.remoteSelections.get(guest.manager.myUser.id), 'safe');
});

test('cancelled setup cannot be revived by stale peer callbacks; missing library leaves data intact', async t => {
    const network = room(); t.after(network.cleanup);
    const actor = network.client({ local: true });
    const creating = actor.manager.createRoom();
    actor.manager.disconnect();
    await assert.rejects(creating, /キャンセル/);
    await sleep(10);
    assert.equal(actor.manager.status, 'disconnected');
    actor.context.Peer = undefined;
    await assert.rejects(actor.manager.joinRoom('edbb-missing'), /ライブラリ/);
    assert.deepEqual(actor.workspace.state, { local: true });
});

test('plugin readiness rejects incompatible UUIDs and versions', t => {
    const network = room(); t.after(network.cleanup);
    const actor = network.client();
    actor.context.Blockly.Blocks.shared_block = {};
    actor.manager.setPluginManager({
        getRegistry: () => [{ id: 'shared', name: 'Shared', uuid: 'local-uuid', version: '1.0.0', affectsBlocks: true }],
        isPluginEnabled: () => true,
        isPluginSharable: () => true,
        getPluginBlockTypes: () => ['shared_block'],
    });
    assert.equal(actor.manager.isPluginReady({ id: 'shared', uuid: 'remote-uuid', version: '1.0.0', blockTypes: ['shared_block'] }), false);
    assert.equal(actor.manager.isPluginReady({ id: 'shared', uuid: 'local-uuid', version: '2.0.0', blockTypes: ['shared_block'] }), false);
    assert.equal(actor.manager.isPluginReady({ id: 'shared', uuid: 'local-uuid', version: '1.0.0', blockTypes: ['shared_block'] }), true);
});

test('title, extra data and member departures propagate; invalid operations recover', async t => {
    const network = room(); t.after(network.cleanup);
    const host = network.client({ a: 1 }), guest = network.client(), observer = network.client();
    const id = await host.manager.createRoom();
    await Promise.all([guest.manager.joinRoom(id), observer.manager.joinRoom(id)]);
    guest.title.value = 'team'; guest.manager.broadcastTitleChange('team');
    guest.workspace.extra = { lists: ['one'] }; guest.manager.broadcastExtraChange(guest.workspace.extra);
    guest.manager.submit({ type: 'event', event: { type: 'change', bad: true } });
    await sleep(120);
    assert.equal(observer.title.value, 'team');
    assert.deepEqual(observer.workspace.extra, { lists: ['one'] });
    assert.deepEqual(host.workspace.state, { a: 1 });
    assert.equal(guest.manager.pending.length, 0);
    guest.manager.disconnect(); await sleep(20);
    assert.equal(observer.manager.getAllUsers().length, 2);
});

test('plugin blocks advertise a downloadable GitHub plugin before a guest applies the snapshot', t => {
    const network = room(); t.after(network.cleanup);
    const host = network.client({}), guest = network.client({});
    const plugin = {
        id: 'team-tools', uuid: 'plugin-uuid', name: 'Team tools', version: '1.2.3',
        repo: 'https://github.com/example/team-tools', installRef: 'main', affectsBlocks: true, blockTypes: ['team_note'],
    };
    const managerFor = enabled => ({
        getRegistry: () => enabled ? [plugin] : [], isPluginEnabled: () => enabled,
        isPluginSharable: () => true, getPluginBlockTypes: () => ['team_note'],
    });
    const block = { id: 'note', type: 'team_note' };
    host.workspace.getAllBlocks = () => [block];
    host.workspace.getBlockById = id => id === 'note' ? block : null;
    host.manager.setPluginManager(managerFor(true));
    guest.manager.setPluginManager(managerFor(false));
    const snapshot = host.manager.capture();
    assert.equal(JSON.stringify(snapshot.plugins), JSON.stringify([{
        id: 'team-tools', uuid: 'plugin-uuid', name: 'Team tools', version: '1.2.3',
        repo: 'https://github.com/example/team-tools', installRef: 'main', blockTypes: ['team_note'],
    }]));
    const offers = [];
    guest.manager.onStateChange((type, data) => { if (type === 'plugin_download_offer') offers.push(data.plugin); });
    guest.manager.applySnapshot({ revision: 1, snapshot, acknowledged: {} });
    assert.equal(offers.length, 1);
    assert.equal(offers[0].id, 'team-tools');
    assert.equal(offers[0].repo, 'https://github.com/example/team-tools');
    assert.equal(guest.manager.lastAcceptedSnapshot, null, 'workspace waits for an enabled plugin');
});
