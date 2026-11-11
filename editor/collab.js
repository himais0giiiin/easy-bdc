/** Host-ordered collaboration. Guests retain unacknowledged edits across snapshots. */
const PROTOCOL = 4;
const BACKUP_KEY = 'edbb_collab_backup_v2';
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];
const clone = value => JSON.parse(JSON.stringify(value));
const titleInput = () => document.getElementById('projectTitleInput');

export class CollabManager {
    constructor(workspace) {
        this.workspace = workspace;
        this.peer = null;
        this.connections = new Map();
        this.remoteUsers = new Map();
        this.remoteSelections = new Map();
        this.listeners = new Set();
        this.status = 'disconnected';
        this.isHost = false;
        this.roomId = null;
        this.isApplyingRemote = false;
        this.isSyncing = false;
        this.pending = [];
        this.sequence = 0;
        this.acknowledged = new Map();
        this.revision = 0;
        this.lastRevision = -1;
        this.generation = 0;
        this.initialLocalBackup = null;
        this.pluginManager = null;
        this.sessionPlugins = new Map();
        this.offeredPlugins = new Set();
        this.lastAcceptedSnapshot = null;
        let name;
        try { name = localStorage.getItem('edbb_collab_user_name'); } catch { /* optional preference */ }
        this.myUser = { id: null, name: name || `ねこ_${Math.floor(Math.random() * 900 + 100)}`,
            color: COLORS[Math.floor(Math.random() * COLORS.length)], isHost: false };
        // Session storage separates backups when two rooms are open in different tabs.
        try { this.initialLocalBackup = JSON.parse(sessionStorage.getItem(BACKUP_KEY)); } catch { /* unavailable */ }
        this.blocklyListener = event => {
            if (this.isApplyingRemote || !this.isConnected()) return;
            if (event.type === Blockly.Events.SELECTED) {
                this.broadcast({ type: 'selection_change', blockId: event.newElementId || null, senderId: this.myUser.id });
                return;
            }
            if (event.isUiEvent || event.type === Blockly.Events.FINISHED_LOADING) return;
            const allowed = this.eventTypes();
            if (allowed.has(event.type)) {
                const plugin = this.getPluginForEvent(event);
                if (plugin && !this.isHost && !this.sessionPlugins.has(plugin.id)) {
                    this.requestPlugin(plugin);
                    return;
                }
                if (plugin && this.isHost) this.announcePlugin(plugin);
                this.submit({ type: 'event', event: event.toJson() });
            }
        };
        workspace.addChangeListener(this.blocklyListener);
    }

    eventTypes() {
        return new Set(['BLOCK_CREATE', 'BLOCK_DELETE', 'BLOCK_CHANGE', 'BLOCK_MOVE',
            'VAR_CREATE', 'VAR_DELETE', 'VAR_RENAME', 'COMMENT_CREATE', 'COMMENT_DELETE',
            'COMMENT_CHANGE', 'COMMENT_MOVE'].map(key => Blockly.Events[key]).filter(Boolean));
    }

    onStateChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    notify(type, data = {}) {
        for (const listener of this.listeners) {
            try { listener(type, data); } catch (error) { console.error('Collaboration UI:', error); }
        }
    }
    setStatus(status) {
        this.status = status;
        this.isSyncing = status === 'connecting';
        this.notify('status_change', { status, isHost: this.isHost, roomId: this.roomId });
    }
    isConnected() { return this.status === 'connected'; }
    getAllUsers() { return [this.myUser, ...this.remoteUsers.values()]; }
    setPluginManager(pluginManager) { this.pluginManager = pluginManager || null; }
    getPluginDescriptor(id) {
        const plugin = this.pluginManager?.getRegistry?.().find(item => item?.id === id);
        if (!plugin?.affectsBlocks || !this.pluginManager?.isPluginEnabled?.(id)) return null;
        if (!this.pluginManager?.isPluginSharable?.(id)) {
            return { id, name: plugin.name || id, unshareable: true };
        }
        return {
            id,
            uuid: typeof plugin.uuid === 'string' ? plugin.uuid : '',
            name: typeof plugin.name === 'string' ? plugin.name : id,
            version: typeof plugin.version === 'string' ? plugin.version : '',
            repo: typeof plugin.repo === 'string' ? plugin.repo : '',
            installRef: typeof plugin.installRef === 'string' ? plugin.installRef : 'main',
            blockTypes: (this.pluginManager.getPluginBlockTypes?.(id) || []).filter(type => typeof type === 'string'),
        };
    }
    getPluginForBlock(block) {
        if (!block?.type || !this.pluginManager) return null;
        for (const plugin of this.pluginManager.getRegistry?.() || []) {
            if (this.pluginManager.isPluginEnabled?.(plugin.id)
                && this.pluginManager.getPluginBlockTypes?.(plugin.id)?.includes(block.type)) {
                return this.getPluginDescriptor(plugin.id);
            }
        }
        return null;
    }
    getPluginForEvent(event) {
        const ids = event?.ids || [event?.blockId];
        for (const id of ids) {
            const descriptor = this.getPluginForBlock(this.workspace.getBlockById?.(id));
            if (descriptor) return descriptor;
        }
        return null;
    }
    getWorkspacePlugins() {
        const plugins = new Map();
        for (const block of this.workspace.getAllBlocks?.(false) || []) {
            const descriptor = this.getPluginForBlock(block);
            if (descriptor) plugins.set(descriptor.id, descriptor);
        }
        return [...plugins.values()];
    }
    setUserName(name) {
        if (typeof name !== 'string' || !name.trim()) return;
        this.myUser.name = name.trim().slice(0, 20);
        try { localStorage.setItem('edbb_collab_user_name', this.myUser.name); } catch { /* optional */ }
        if (this.isHost) this.publishUsers();
        else this.broadcast({ type: 'user_update', user: this.myUser });
        this.notify('users_updated', this.getAllUsers());
    }

    capture() {
        return clone({ state: Blockly.serialization.workspaces.save(this.workspace),
            extra: this.workspace.getExtraState?.() || {}, title: titleInput()?.value || '',
            plugins: this.getWorkspacePlugins() });
    }
    withoutEvents(action) {
        this.isApplyingRemote = true;
        Blockly.Events.disable();
        try { return action(); }
        finally { Blockly.Events.enable(); this.isApplyingRemote = false; }
    }
    loadSnapshot(snapshot) {
        if (!snapshot || !snapshot.state || typeof snapshot.state !== 'object') throw new Error('同期データが不正です。');
        // Unknown blocks must be checked before clearing the user's workspace.
        const inspect = value => {
            if (!value || typeof value !== 'object') return;
            if (typeof value.type === 'string' && typeof value.id === 'string' && !Blockly.Blocks[value.type]) {
                throw new Error(`ブロック「${value.type}」がありません。同じプラグインを有効にしてから参加してください。`);
            }
            Object.values(value).forEach(inspect);
        };
        inspect(snapshot.state.blocks);
        Blockly.serialization.workspaces.load(clone(snapshot.state), this.workspace);
        this.workspace.setExtraState?.(clone(snapshot.extra || {}));
        if (titleInput()) titleInput().value = snapshot.title || '';
    }
    sanitizePlugin(plugin) {
        if (!plugin || typeof plugin !== 'object' || typeof plugin.id !== 'string') return null;
        const id = plugin.id.trim().slice(0, 100);
        const repo = typeof plugin.repo === 'string' ? plugin.repo.trim() : '';
        if (!id) return null;
        return {
            id,
            uuid: typeof plugin.uuid === 'string' ? plugin.uuid.slice(0, 200) : '',
            name: typeof plugin.name === 'string' ? plugin.name.slice(0, 100) : id,
            version: typeof plugin.version === 'string' ? plugin.version.slice(0, 100) : '',
            repo: /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/i.test(repo) ? repo.replace(/\/$/, '') : '',
            installRef: typeof plugin.installRef === 'string' ? plugin.installRef.slice(0, 100) : 'main',
            blockTypes: Array.isArray(plugin.blockTypes) ? plugin.blockTypes.filter(type => typeof type === 'string').slice(0, 200) : [],
            unshareable: plugin.unshareable === true,
        };
    }
    isPluginReady(plugin) {
        const local = this.getPluginDescriptor(plugin?.id);
        if (!local || local.unshareable) return false;
        if (plugin?.uuid && local.uuid !== plugin.uuid) return false;
        if (plugin?.version && local.version !== plugin.version) return false;
        return plugin.blockTypes.every(type => Blockly.Blocks[type]);
    }
    missingPlugins(snapshot) {
        const plugins = Array.isArray(snapshot?.plugins) ? snapshot.plugins.map(plugin => this.sanitizePlugin(plugin)).filter(Boolean) : [];
        return plugins.filter(plugin => !this.isPluginReady(plugin));
    }
    offerPlugin(plugin, request = false) {
        const safe = this.sanitizePlugin(plugin);
        if (!safe) return;
        const key = `${request ? 'request' : 'offer'}:${safe.id}:${safe.installRef}`;
        if (this.offeredPlugins.has(key)) return;
        this.offeredPlugins.add(key);
        this.notify(request ? 'plugin_request' : 'plugin_download_offer', { plugin: safe });
    }
    announcePlugin(plugin) {
        const safe = this.sanitizePlugin(plugin);
        if (!safe) return;
        if (safe.unshareable || !safe.repo) {
            this.notify('plugin_unshareable', { plugin: safe });
            return;
        }
        this.sessionPlugins.set(safe.id, safe);
        this.broadcast({ type: 'plugin_offer', plugin: safe });
        this.scheduleSnapshot();
    }
    requestPlugin(plugin) {
        const safe = this.sanitizePlugin(plugin);
        if (!safe) return;
        if (safe.unshareable || !safe.repo) {
            this.notify('plugin_unshareable', { plugin: safe });
            return;
        }
        this.broadcast({ type: 'plugin_request', plugin: safe });
        this.notify('plugin_request_sent', { plugin: safe });
        // The host has not approved this plugin for the room; undo the local-only edit.
        if (this.lastAcceptedSnapshot) {
            try { this.withoutEvents(() => this.loadSnapshot(this.lastAcceptedSnapshot)); }
            catch (error) { this.notify('error', { error: error.message }); }
        }
    }
    pluginReady(plugin) {
        const safe = this.sanitizePlugin(plugin);
        if (!safe || !this.isPluginReady(safe)) return false;
        this.offeredPlugins.delete(`offer:${safe.id}:${safe.installRef}`);
        if (this.isHost) this.announcePlugin(safe);
        else this.broadcast({ type: 'snapshot_request' });
        return true;
    }
    restoreInitialBackup() {
        if (!this.initialLocalBackup || this.status !== 'disconnected') return false;
        const current = this.capture();
        try {
            this.withoutEvents(() => this.loadSnapshot(this.initialLocalBackup));
            this.workspace.clearUndo();
            this.notify('workspace_updated');
            return true;
        } catch (error) {
            this.withoutEvents(() => this.loadSnapshot(current));
            this.notify('error', { error: error.message });
            return false;
        }
    }
    discardBackup() {
        this.initialLocalBackup = null;
        try { sessionStorage.removeItem(BACKUP_KEY); } catch { /* unavailable */ }
        this.notify('backup_changed');
    }
    normalizeRoomId(value) {
        let id = String(value || '').trim();
        if (/^https?:\/\//i.test(id)) {
            const url = new URL(id);
            id = url.searchParams.get('collab') || url.searchParams.get('room') || '';
        }
        if (!/^edbb-[a-zA-Z0-9-]{7,64}$/.test(id)) throw new Error('有効なルームIDまたは招待リンクを入力してください。');
        return id;
    }

    createRoom() { return this.start(true, `edbb-${crypto.randomUUID()}`); }
    joinRoom(value) {
        try { return this.start(false, this.normalizeRoomId(value)); }
        catch (error) { return Promise.reject(error); }
    }
    start(host, roomId) {
        if (this.status !== 'disconnected') return Promise.reject(new Error('現在の接続を終了してから操作してください。'));
        if (typeof Peer === 'undefined') return Promise.reject(new Error('接続ライブラリを読み込めませんでした。ページを再読み込みしてください。'));
        if (!host) {
            try {
                const backup = this.capture();
                sessionStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
                this.initialLocalBackup = backup;
                this.notify('backup_changed');
            } catch { return Promise.reject(new Error('参加前のバックアップを保存できません。作品をファイルに保存し、ブラウザの保存領域を確認してください。')); }
        }
        this.isHost = host;
        this.myUser.isHost = host;
        this.roomId = roomId;
        this.setStatus('connecting');
        const generation = ++this.generation;
        return new Promise((resolve, reject) => {
            this.openPromise = { resolve, reject };
            this.connectionTimer = setTimeout(() => this.fail(new Error('接続がタイムアウトしました。ルームIDとホストの接続を確認してください。')), 15000);
            try {
                const peer = host ? new Peer(roomId, { debug: 1 }) : new Peer({ debug: 1 });
                this.peer = peer;
                const active = () => this.generation === generation && this.peer === peer;
                peer.on('open', id => {
                    if (!active()) return;
                    this.myUser.id = id;
                    if (host) this.finishConnecting();
                    else if (!this.connections.size) this.attachConnection(peer.connect(roomId, { reliable: true }), generation);
                });
                peer.on('connection', conn => {
                    if (active() && host) this.attachConnection(conn, generation);
                    else conn.close();
                });
                peer.on('error', error => {
                    if (!active()) return;
                    // Signalling outages do not invalidate established data channels.
                    if (this.isConnected() && ['network', 'socket-error', 'socket-closed'].includes(error.type)) {
                        this.notify('info', { message: '招待サーバーへ再接続中です。接続済みの共同編集は継続します。' });
                        return;
                    }
                    this.fail(new Error(error.type === 'peer-unavailable' ? 'ルームが見つかりません。ホストがルームを開いているか確認してください。' : error.message));
                });
                peer.on('disconnected', () => {
                    if (!active()) return;
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = setTimeout(() => {
                        if (active() && peer.disconnected && !peer.destroyed) peer.reconnect();
                    }, 1000);
                });
                peer.on('close', () => { if (active()) this.fail(new Error('共同編集の接続が終了しました。')); });
            } catch (error) { this.fail(error); }
        });
    }
    finishConnecting() {
        clearTimeout(this.connectionTimer);
        this.setStatus('connected');
        const promise = this.openPromise;
        this.openPromise = null;
        promise?.resolve(this.roomId);
        this.notify('users_updated', this.getAllUsers());
    }
    fail(error) {
        const joined = this.isConnected() && !this.isHost;
        const promise = this.openPromise;
        this.openPromise = null;
        this.disconnect(true);
        if (promise) promise.reject(error);
        else this.notify('error', { error: error.message || '接続に失敗しました。' });
        if (joined) this.notify('host_disconnected', { hasBackup: !!this.initialLocalBackup });
    }
    attachConnection(conn, generation) {
        if (this.connections.has(conn.peer)) { conn.close(); return; }
        this.connections.set(conn.peer, conn);
        const active = () => generation === this.generation && this.connections.get(conn.peer) === conn;
        const handshakeTimer = setTimeout(() => { if (active() && !this.remoteUsers.has(conn.peer) && this.isHost) conn.close(); }, 15000);
        conn.on('open', () => {
            if (!active()) return;
            if (!this.isHost) this.send(conn, { type: 'hello', protocol: PROTOCOL, user: this.myUser });
        });
        conn.on('data', data => {
            if (!active()) return;
            try { this.receive(data, conn); }
            catch (error) {
                if (this.isHost) {
                    this.send(conn, { type: 'rejected', message: error.message });
                    this.scheduleSnapshot();
                } else this.fail(error);
            }
        });
        conn.on('close', () => {
            clearTimeout(handshakeTimer);
            if (!active()) return;
            if (!this.isHost) { this.fail(new Error('ホストとの接続が切断されました。')); return; }
            this.connections.delete(conn.peer);
            this.remoteUsers.delete(conn.peer);
            this.remoteSelections.delete(conn.peer);
            this.acknowledged.delete(conn.peer);
            this.notify('selection_cleared', { peerId: conn.peer });
            this.publishUsers();
        });
        conn.on('error', error => {
            clearTimeout(handshakeTimer);
            if (!active()) return;
            if (!this.isHost) this.fail(error);
            else conn.close();
        });
    }
    sanitizeUser(user, id, isHost = false) {
        return { id, isHost, name: typeof user?.name === 'string' ? user.name.trim().slice(0, 20) || 'ゲスト' : 'ゲスト',
            color: /^#[\da-f]{6}$/i.test(user?.color) ? user.color : COLORS[0] };
    }
    publishUsers() {
        this.broadcast({ type: 'users', users: this.getAllUsers() });
        this.notify('users_updated', this.getAllUsers());
    }
    receive(data, conn) {
        if (!data || typeof data !== 'object') return;
        if (this.isHost) {
            if (data.type === 'hello') {
                if (data.protocol !== PROTOCOL) {
                    this.send(conn, { type: 'fatal', message: '共同編集のバージョンが異なります。全員がページを再読み込みしてください。' });
                    return;
                }
                this.remoteUsers.set(conn.peer, this.sanitizeUser(data.user, conn.peer));
                this.publishUsers();
                this.scheduleSnapshot();
                return;
            }
            if (!this.remoteUsers.has(conn.peer)) return;
            if (data.type === 'operation') {
                if (!Number.isSafeInteger(data.sequence) || data.sequence < 1) return;
                const previous = this.acknowledged.get(conn.peer) || 0;
                if (data.sequence <= previous) return;
                if (data.sequence !== previous + 1) throw new Error('編集の順序が一致しません。退出して再参加してください。');
                this.acknowledged.set(conn.peer, data.sequence);
                const before = this.capture();
                try { this.withoutEvents(() => this.applyOperation(data.operation)); }
                catch (error) { this.withoutEvents(() => this.loadSnapshot(before)); throw error; }
                this.notify('workspace_updated');
                this.scheduleSnapshot();
            } else if (data.type === 'user_update') {
                this.remoteUsers.set(conn.peer, this.sanitizeUser(data.user, conn.peer));
                this.publishUsers();
            } else if (data.type === 'selection_change') {
                if (data.blockId !== null && typeof data.blockId !== 'string') return;
                this.applySelectionChange(conn.peer, data.blockId);
                this.broadcast({ type: 'selection_change', senderId: conn.peer, blockId: data.blockId });
            } else if (data.type === 'plugin_request') {
                const plugin = this.sanitizePlugin(data.plugin);
                if (plugin) this.notify('plugin_request', { plugin, user: this.remoteUsers.get(conn.peer) });
            } else if (data.type === 'snapshot_request') {
                this.scheduleSnapshot();
            }
            // Guests cannot send snapshots, member lists, or impersonate the host.
        } else if (conn.peer === this.roomId) {
            if (data.type === 'snapshot') this.applySnapshot(data);
            else if (data.type === 'plugin_offer') {
                const plugin = this.sanitizePlugin(data.plugin);
                if (plugin) {
                    this.sessionPlugins.set(plugin.id, plugin);
                    if (!this.isPluginReady(plugin)) this.offerPlugin(plugin);
                }
            }
            else if (data.type === 'users' && Array.isArray(data.users)) {
                const previous = this.remoteUsers;
                this.remoteUsers = new Map(data.users.filter(u => u?.id && u.id !== this.myUser.id)
                    .map(u => [u.id, this.sanitizeUser(u, u.id, u.id === this.roomId)]));
                for (const id of previous.keys()) if (!this.remoteUsers.has(id)) {
                    this.remoteSelections.delete(id);
                    this.notify('selection_cleared', { peerId: id });
                }
                this.notify('users_updated', this.getAllUsers());
            } else if (data.type === 'selection_change') this.applySelectionChange(data.senderId, data.blockId);
            else if (data.type === 'fatal') throw new Error(data.message);
            else if (data.type === 'rejected') this.notify('error', { error: `編集を反映できませんでした: ${data.message}` });
        }
    }
    submit(operation) {
        if (!this.isConnected() || this.isApplyingRemote) return;
        if (this.isHost) this.scheduleSnapshot();
        else {
            const message = { type: 'operation', sequence: ++this.sequence, operation: clone(operation) };
            this.pending.push(message);
            this.broadcast(message);
        }
    }
    applyOperation(operation) {
        if (operation?.type === 'event' && this.eventTypes().has(operation.event?.type)) {
            const event = Blockly.Events.fromJson(clone(operation.event), this.workspace);
            event.recordUndo = false;
            event.run(true);
        } else if (operation?.type === 'title' && typeof operation.title === 'string') {
            if (titleInput()) titleInput().value = operation.title.slice(0, 200);
        } else if (operation?.type === 'extra' && operation.extra && typeof operation.extra === 'object') {
            // Each top-level data store is independent of block edits.
            this.workspace.setExtraState?.({ ...this.workspace.getExtraState?.(), ...clone(operation.extra) });
        } else throw new Error('対応していない編集データです。');
    }
    scheduleSnapshot() {
        if (this.snapshotTimer) return;
        this.snapshotTimer = setTimeout(() => {
            this.snapshotTimer = null;
            if (!this.isHost || !this.isConnected()) return;
            try {
                this.broadcast({ type: 'snapshot', revision: ++this.revision, snapshot: this.capture(),
                    acknowledged: Object.fromEntries(this.acknowledged) });
            } catch (error) { this.notify('error', { error: error.message }); }
        }, 50);
    }
    applySnapshot(data) {
        if (!Number.isSafeInteger(data.revision) || data.revision <= this.lastRevision) return;
        // Avoid replacing blocks while a drag or field gesture is still generating events.
        if (this.workspace.isDragging?.() || Blockly.Gesture?.inProgress?.() || Blockly.WidgetDiv?.isVisible?.() || Blockly.DropDownDiv?.isVisible?.()) {
            this.deferredSnapshot = data;
            clearTimeout(this.applyTimer);
            this.applyTimer = setTimeout(() => this.applyDeferredSnapshot(), 80);
            return;
        }
        const missing = this.missingPlugins(data.snapshot);
        if (missing.length) {
            this.blockedSnapshot = data;
            missing.forEach(plugin => {
                this.sessionPlugins.set(plugin.id, plugin);
                this.offerPlugin(plugin);
            });
            return;
        }
        for (const plugin of data.snapshot?.plugins || []) {
            const safe = this.sanitizePlugin(plugin);
            if (safe) this.sessionPlugins.set(safe.id, safe);
        }
        const before = this.capture();
        const selectedId = Blockly.getSelected?.()?.id;
        const pending = this.pending.filter(message => message.sequence > (data.acknowledged?.[this.myUser.id] || 0));
        try {
            this.withoutEvents(() => {
                // An acknowledgement with an identical document must not reset focus/undo.
                if (pending.length || JSON.stringify(before) !== JSON.stringify(data.snapshot)) {
                    this.loadSnapshot(data.snapshot);
                    for (const message of pending) {
                        try { this.applyOperation(message.operation); }
                        catch { /* A concurrently deleted block wins; host will acknowledge rejection. */ }
                    }
                    this.workspace.clearUndo();
                    if (selectedId) this.workspace.getBlockById(selectedId)?.select?.();
                }
            });
        } catch (error) {
            this.withoutEvents(() => this.loadSnapshot(before));
            throw error;
        }
        this.pending = pending;
        this.lastRevision = data.revision;
        this.lastAcceptedSnapshot = clone(data.snapshot);
        this.blockedSnapshot = null;
        this.notify('workspace_updated');
        for (const [peerId, blockId] of this.remoteSelections) this.applySelectionChange(peerId, blockId);
        if (this.isSyncing) this.finishConnecting();
    }
    applyDeferredSnapshot() {
        const data = this.deferredSnapshot;
        this.deferredSnapshot = null;
        if (data && this.status !== 'disconnected') {
            try { this.applySnapshot(data); } catch (error) { this.fail(error); }
        }
    }
    broadcastTitleChange(title) { this.submit({ type: 'title', title }); }
    broadcastExtraChange(extra) { this.submit({ type: 'extra', extra }); }
    applySelectionChange(peerId, blockId) {
        if (peerId === this.myUser.id || !this.remoteUsers.has(peerId)) return;
        if (blockId) {
            this.remoteSelections.set(peerId, blockId);
            this.notify('selection_updated', { peerId, blockId, user: this.remoteUsers.get(peerId) });
        } else {
            this.remoteSelections.delete(peerId);
            this.notify('selection_cleared', { peerId });
        }
    }
    send(conn, data) {
        if (!conn.open) return;
        try { conn.send(data); }
        catch (error) { if (!this.isHost) this.fail(error); else conn.close(); }
    }
    broadcast(data) {
        for (const conn of this.connections.values()) {
            if (!this.isHost || this.remoteUsers.has(conn.peer)) this.send(conn, data);
        }
    }
    disconnect(preserveBackup = true) {
        ++this.generation; // Invalidate callbacks before closing transports (close may fire synchronously).
        for (const timer of ['connectionTimer', 'snapshotTimer', 'applyTimer', 'reconnectTimer']) {
            clearTimeout(this[timer]); this[timer] = null;
        }
        const promise = this.openPromise;
        this.openPromise = null;
        promise?.reject(new Error('接続をキャンセルしました。'));
        const connections = [...this.connections.values()];
        const peer = this.peer;
        this.connections.clear();
        this.peer = null;
        for (const conn of connections) { try { conn.close(); } catch { /* already closed */ } }
        try { peer?.destroy(); } catch { /* already destroyed */ }
        this.isHost = false;
        this.roomId = null;
        this.myUser.id = null;
        this.myUser.isHost = false;
        this.pending = [];
        this.sequence = 0;
        this.revision = 0;
        this.lastRevision = -1;
        this.deferredSnapshot = null;
        this.acknowledged.clear();
        this.remoteUsers.clear();
        this.remoteSelections.clear();
        if (!preserveBackup) this.discardBackup();
        this.setStatus('disconnected');
        this.notify('all_selections_cleared');
        this.notify('users_updated', []);
    }
}
