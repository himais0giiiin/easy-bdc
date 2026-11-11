/**
 * Realtime Collaborative Editing UI Module for Easy Discord Bot Builder
 */

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

function sanitizeColor(color) {
    if (typeof color === 'string' && HEX_COLOR_REGEX.test(color.trim())) {
        return color.trim();
    }
    return '#3b82f6';
}

export class CollabUI {
    constructor(collabManager) {
        this.manager = collabManager;
        this.modal = document.getElementById('collabModal');
        this.btn = document.getElementById('collabBtn');
        this.statusBadge = document.getElementById('collabStatusBadge');
        this.userCountBadge = document.getElementById('collabUserCount');
        this.blockSelections = new Map(); // blockId -> Map<peerId, { user, path, originalStyle, safeColor }>

        this.initElements();
        this.initListeners();
        this.updateViewByStatus(this.manager.status);
        this.updateBackupView();
    }

    initElements() {
        this.elements = {
            closeBtn: document.getElementById('collabModalClose'),
            hostSection: document.getElementById('collabHostSection'),
            joinSection: document.getElementById('collabJoinSection'),
            activeSection: document.getElementById('collabActiveSection'),
            createBtn: document.getElementById('collabCreateRoomBtn'),
            joinBtn: document.getElementById('collabJoinRoomBtn'),
            roomIdInput: document.getElementById('collabRoomIdInput'),
            activeRoomId: document.getElementById('collabActiveRoomId'),
            copyIdBtn: document.getElementById('collabCopyIdBtn'),
            copyLinkBtn: document.getElementById('collabCopyLinkBtn'),
            disconnectBtn: document.getElementById('collabDisconnectBtn'),
            userNameInput: document.getElementById('collabUserNameInput'),
            userList: document.getElementById('collabUserList'),
            statusText: document.getElementById('collabStatusText'),
            restoreBtn: document.getElementById('collabRestoreBtn'),
        };

        if (this.elements.userNameInput) {
            this.elements.userNameInput.value = this.manager.myUser.name;
            this.elements.userNameInput.addEventListener('change', (e) => {
                this.manager.setUserName(e.target.value);
            });
        }
    }

    initListeners() {
        // Toggle modal
        this.btn?.addEventListener('click', () => {
            this.openModal();
        });

        this.elements.closeBtn?.addEventListener('click', () => {
            this.closeModal();
        });

        this.modal?.addEventListener('click', (e) => {
            if (e.target === this.modal) this.closeModal();
        });
        this.modal?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModal();
            if (e.key === 'Tab') {
                const items = [...this.modal.querySelectorAll('button, input')].filter(el => !el.disabled && el.getClientRects().length);
                const first = items[0], last = items.at(-1);
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
            }
        });
        this.elements.roomIdInput?.addEventListener('keydown', e => {
            if (e.key === 'Enter') this.elements.joinBtn?.click();
        });
        this.elements.restoreBtn?.addEventListener('click', () => this.restoreBackup());

        // Create room
        this.elements.createBtn?.addEventListener('click', async () => {
            try {
                this.elements.createBtn.disabled = true;
                this.elements.createBtn.textContent = 'ルーム作成中...';
                await this.manager.createRoom();
                this.showToast('ルームを作成しました！', 'success');
            } catch (err) {
                this.showToast(err.message || '作成に失敗しました', 'error');
            } finally {
                if (this.elements.createBtn) {
                    this.elements.createBtn.disabled = false;
                    this.elements.createBtn.innerHTML = '<i data-lucide="plus-circle" class="w-4 h-4"></i> 新しいルームを開始';
                    if (window.lucide) window.lucide.createIcons();
                }
            }
        });

        // Join room
        this.elements.joinBtn?.addEventListener('click', async () => {
            const roomId = this.elements.roomIdInput?.value?.trim();
            if (!roomId) {
                this.showToast('ルームIDを入力してください', 'error');
                return;
            }

            const shouldJoin = await this.promptJoinConfirmation(roomId);
            if (!shouldJoin) return;

            try {
                this.elements.joinBtn.disabled = true;
                this.elements.joinBtn.textContent = '参加中...';
                await this.manager.joinRoom(roomId);
                this.showToast('共同編集ルームに参加しました！', 'success');
            } catch (err) {
                this.showToast(err.message || '参加に失敗しました', 'error');
            } finally {
                if (this.elements.joinBtn) {
                    this.elements.joinBtn.disabled = false;
                    this.elements.joinBtn.innerHTML = '<i data-lucide="log-in" class="w-4 h-4"></i> 参加';
                    if (window.lucide) window.lucide.createIcons();
                }
            }
        });

        // Copy Room ID
        this.elements.copyIdBtn?.addEventListener('click', async () => {
            if (this.manager.roomId) {
                await this.copyText(this.manager.roomId, this.elements.copyIdBtn, 'コピー完了');
            }
        });

        // Copy Share Link
        this.elements.copyLinkBtn?.addEventListener('click', async () => {
            if (this.manager.roomId) {
                const url = new URL(window.location.href);
                url.search = '';
                url.hash = '';
                url.searchParams.set('collab', this.manager.roomId);
                await this.copyText(url.toString(), this.elements.copyLinkBtn, 'リンクをコピーしました');
            }
        });

        // Disconnect
        this.elements.disconnectBtn?.addEventListener('click', async () => {
            if (this.manager.status === 'connecting') { this.manager.disconnect(); return; }
            if (!this.manager.isHost) { await this.promptHostDisconnected({ voluntary: true }); return; }
            const result = typeof Swal !== 'undefined'
                ? await Swal.fire({ title: '共同編集を終了しますか？', text: '全員との接続が終了します。作品は各参加者の画面に残ります。', icon: 'question', showCancelButton: true, confirmButtonText: 'ルームを終了', cancelButtonText: '続ける' })
                : { isConfirmed: window.confirm('全員との共同編集を終了しますか？') };
            if (result.isConfirmed) this.manager.disconnect();
        });

        // CollabManager events
        this.manager.onStateChange((type, data) => {
            switch (type) {
                case 'status_change':
                    this.updateViewByStatus(data.status);
                    if (data.status === 'disconnected') {
                        this.removeCollabUrlParam();
                    }
                    break;
                case 'users_updated':
                    this.renderUsers(data);
                    break;
                case 'backup_changed':
                    this.updateBackupView();
                    break;
                case 'selection_updated':
                    this.applyRemoteSelection(data.peerId, data.blockId, data.user);
                    break;
                case 'selection_cleared':
                    this.clearRemoteSelection(data.peerId);
                    break;
                case 'all_selections_cleared':
                    this.clearAllRemoteSelections();
                    break;
                case 'host_disconnected':
                    this.promptHostDisconnected(data);
                    break;
                case 'plugin_request_sent':
                    this.showToast(`「${data.plugin.name}」の利用をホストへリクエストしました`, 'info');
                    break;
                case 'plugin_unshareable':
                    this.showToast(`「${data.plugin.name}」は配布URLがないため共同編集では利用できません`, 'error');
                    break;
                case 'info':
                    this.showToast(data.message, 'info');
                    break;
                case 'error':
                    this.showToast(data.error, 'error');
                    break;
            }
        });

        // Sync Project Title change to other peers
        const projectTitleInput = document.getElementById('projectTitleInput');
        projectTitleInput?.addEventListener('input', (e) => {
            if (this.manager.isConnected()) {
                this.manager.broadcastTitleChange(e.target.value);
            }
        });
    }

    async promptHostDisconnected(data) {
        if (this.exitPromptOpen) return;
        this.exitPromptOpen = true;
        this.removeCollabUrlParam();
        let shouldKeep = true;
        if (typeof Swal !== 'undefined') {
            const result = await Swal.fire({
                title: data.voluntary ? '共同編集から退出しますか？' : 'ホストとの接続が切断されました',
                html: `
                    <p class="text-sm text-slate-600 dark:text-slate-300">
                        ${data.voluntary ? '退出後の作品を選んでください。' : '共同編集セッションが終了しました。'}
                    </p>
                    <div class="mt-3.5 p-3.5 text-left rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                        <p class="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                            ・<strong>このまま進める</strong>: 共同編集で同期された最新状態を維持して作業を続けます。<br>
                            ・<strong>参加前の作品に戻す</strong>: このタブに保存したバックアップを復元します。
                        </p>
                    </div>
                `,
                icon: 'warning',
                showCancelButton: !!data.voluntary,
                showDenyButton: !!this.manager.initialLocalBackup,
                confirmButtonColor: '#4f46e5',
                cancelButtonColor: '#059669',
                confirmButtonText: 'このまま進める（維持）',
                denyButtonText: '参加前の作品に戻す',
                cancelButtonText: '編集を続ける',
                allowOutsideClick: false,
                allowEscapeKey: false,
            });
            if (!result.isConfirmed && !result.isDenied) { this.exitPromptOpen = false; return; }
            shouldKeep = result.isConfirmed;
        } else {
            shouldKeep = window.confirm(
                'ホストとの接続が切断されました。\n\n[OK]: 共同編集の内容を維持してこのまま進める\n[キャンセル]: 参加前の保存データに復活する'
            );
        }

        if (data.voluntary) this.manager.disconnect();
        this.exitPromptOpen = false;
        if (shouldKeep) {
            this.manager.notify('local_edit_resumed', { restored: false });
            this.showToast('現在の内容を維持してローカル編集を継続します', 'success');
            // Auto save current state
            try {
                window.__edbb_storage?.save?.();
            } catch (e) { }
        } else {
            this.restoreBackup();
        }
    }

    restoreBackup() {
        if (!this.manager.restoreInitialBackup()) {
            this.showToast('バックアップを復元できませんでした。', 'error');
            return;
        }
        this.manager.notify('local_edit_resumed', { restored: true });
        window.__edbb_storage?.save?.();
        this.showToast('参加前の作品を復元しました', 'success');
    }

    updateBackupView() {
        this.elements.restoreBtn?.classList.toggle('hidden', !this.manager.initialLocalBackup || this.manager.status !== 'disconnected');
    }

    async copyText(text, button, message) {
        try { await navigator.clipboard.writeText(text); this.showCopyFeedback(button, message); }
        catch { this.showToast('コピーできませんでした。表示されたルームIDを選択してコピーしてください。', 'error'); }
    }

    openModal() {
        if (!this.modal) return;
        clearTimeout(this.closeTimer);
        this.previousFocus = document.activeElement;
        this.modal.setAttribute('aria-hidden', 'false');
        this.modal.classList.remove('hidden');
        this.modal.classList.add('flex');
        void this.modal.offsetWidth;
        this.modal.classList.add('show-modal');
        this.elements.closeBtn?.focus();
        if (window.lucide) window.lucide.createIcons();
    }

    closeModal() {
        if (!this.modal) return;
        this.modal.setAttribute('aria-hidden', 'true');
        this.previousFocus?.focus();
        this.modal.classList.remove('show-modal');
        this.closeTimer = setTimeout(() => {
            this.modal.classList.remove('flex');
            this.modal.classList.add('hidden');
        }, 200);
    }

    updateViewByStatus(status) {
        const isConnected = status === 'connected';
        const connecting = status === 'connecting';
        for (const element of [this.elements.createBtn, this.elements.joinBtn, this.elements.roomIdInput]) {
            if (element) element.disabled = connecting || isConnected;
        }
        for (const element of [this.elements.copyIdBtn, this.elements.copyLinkBtn]) {
            if (element) element.disabled = !isConnected;
        }
        if (this.elements.statusText) this.elements.statusText.textContent = connecting ? '接続・初期同期中…' : this.manager.isHost ? 'ホストとして共同編集中' : '共同編集中';
        if (this.elements.disconnectBtn) this.elements.disconnectBtn.textContent = connecting ? '接続をキャンセル' : this.manager.isHost ? 'ルームを終了する' : '共同編集から退出';
        this.btn?.setAttribute('aria-label', connecting ? '共同編集に接続中' : isConnected ? '共同編集の参加者と接続状態' : '共同編集を開始');
        this.updateBackupView();

        // Update header button & badges
        if (this.statusBadge) {
            if (isConnected) {
                this.statusBadge.classList.remove('bg-slate-400');
                this.statusBadge.classList.add('bg-emerald-500', 'animate-pulse');
            } else {
                this.statusBadge.classList.remove('bg-emerald-500', 'animate-pulse');
                this.statusBadge.classList.add('bg-slate-400');
            }
        }

        if (this.elements.activeSection && this.elements.hostSection && this.elements.joinSection) {
            if (isConnected || connecting) {
                this.elements.hostSection.classList.add('hidden');
                this.elements.joinSection.classList.add('hidden');
                this.elements.activeSection.classList.remove('hidden');

                if (this.elements.activeRoomId) {
                    this.elements.activeRoomId.textContent = this.manager.roomId;
                }
            } else {
                this.elements.hostSection.classList.remove('hidden');
                this.elements.joinSection.classList.remove('hidden');
                this.elements.activeSection.classList.add('hidden');
            }
        }

        if (this.userCountBadge) {
            this.userCountBadge.textContent = isConnected ? `${this.manager.getAllUsers().length}` : '';
            this.userCountBadge.classList.toggle('hidden', !isConnected);
        }

        if (window.lucide) window.lucide.createIcons();
    }

    renderUsers(users) {
        if (!this.elements.userList) return;
        this.elements.userList.innerHTML = '';

        if (this.userCountBadge && this.manager.isConnected()) {
            this.userCountBadge.textContent = `${users.length}`;
        }

        users.forEach((user) => {
            const isMe = user.id === this.manager.myUser.id;
            const li = document.createElement('div');
            li.className = 'flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-sm';

            const userLeft = document.createElement('div');
            userLeft.className = 'flex items-center gap-2.5';

            const dot = document.createElement('div');
            dot.className = 'w-3.5 h-3.5 rounded-full ring-2 ring-white dark:ring-slate-900 shadow-sm';
            dot.style.backgroundColor = sanitizeColor(user.color);
            userLeft.appendChild(dot);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'text-sm font-semibold text-slate-800 dark:text-slate-100';
            nameSpan.textContent = user.name || 'ユーザー';
            userLeft.appendChild(nameSpan);

            if (isMe) {
                const meBadge = document.createElement('span');
                meBadge.className = 'text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400';
                meBadge.textContent = 'あなた';
                userLeft.appendChild(meBadge);
            }

            const userRight = document.createElement('div');
            if (user.isHost) {
                userRight.innerHTML = '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">👑 ホスト</span>';
            } else {
                userRight.innerHTML = '<span class="text-[10px] font-medium text-slate-400">ゲスト</span>';
            }

            li.appendChild(userLeft);
            li.appendChild(userRight);
            this.elements.userList.appendChild(li);
        });
    }

    applyRemoteSelection(peerId, blockId, user) {
        this.clearRemoteSelection(peerId);
        if (!blockId) return;

        const blockGroup = this.manager.workspace.getBlockById(blockId)?.getSvgRoot();
        if (!blockGroup) return;

        const path = blockGroup.querySelector('path.blocklyPath');
        if (!path) return;

        if (!this.blockSelections.has(blockId)) {
            this.blockSelections.set(blockId, new Map());
        }

        const peerMap = this.blockSelections.get(blockId);
        const originalStyle = peerMap.size > 0
            ? Array.from(peerMap.values())[0].originalStyle
            : {
                stroke: path.style.stroke,
                strokeWidth: path.style.strokeWidth,
                filter: path.style.filter,
            };

        const safeColor = sanitizeColor(user.color);
        peerMap.set(peerId, { user, path, originalStyle, safeColor });

        // Apply latest peer color highlight
        path.style.stroke = safeColor;
        path.style.strokeWidth = '3.5px';
        path.style.filter = `drop-shadow(0 0 6px ${safeColor})`;
    }

    clearRemoteSelection(peerId) {
        for (const [blockId, peerMap] of this.blockSelections.entries()) {
            if (peerMap.has(peerId)) {
                const { path, originalStyle } = peerMap.get(peerId);
                peerMap.delete(peerId);

                if (peerMap.size === 0) {
                    // Restore original style if no peers selecting this block
                    if (path) {
                        path.style.stroke = originalStyle.stroke;
                        path.style.strokeWidth = originalStyle.strokeWidth;
                        path.style.filter = originalStyle.filter;
                    }
                    this.blockSelections.delete(blockId);
                } else {
                    // Reapply style of a remaining peer
                    const remainingPeer = Array.from(peerMap.values())[peerMap.size - 1];
                    if (path && remainingPeer) {
                        path.style.stroke = remainingPeer.safeColor;
                        path.style.strokeWidth = '3.5px';
                        path.style.filter = `drop-shadow(0 0 6px ${remainingPeer.safeColor})`;
                    }
                }
            }
        }
    }

    clearAllRemoteSelections() {
        for (const [blockId, peerMap] of this.blockSelections.entries()) {
            const firstEntry = Array.from(peerMap.values())[0];
            if (firstEntry && firstEntry.path) {
                firstEntry.path.style.stroke = firstEntry.originalStyle.stroke;
                firstEntry.path.style.strokeWidth = firstEntry.originalStyle.strokeWidth;
                firstEntry.path.style.filter = firstEntry.originalStyle.filter;
            }
        }
        this.blockSelections.clear();
    }

    checkUrlParams() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const collabRoomId = urlParams.get('collab') || urlParams.get('room');
            if (collabRoomId) {
                // Auto prompt join
                setTimeout(async () => {
                    const shouldJoin = await this.promptJoinConfirmation(collabRoomId);
                    if (shouldJoin) {
                        if (this.elements.roomIdInput) this.elements.roomIdInput.value = collabRoomId;
                        try {
                            await this.manager.joinRoom(collabRoomId);
                            this.showToast('共同編集ルームに参加しました！', 'success');
                        } catch (e) {
                            this.showToast(e.message || '参加に失敗しました', 'error');
                            this.removeCollabUrlParam();
                        }
                    } else {
                        // User canceled / declined invitation
                        this.removeCollabUrlParam();
                    }
                }, 600);
            }
        } catch (e) {
            console.error('Error parsing collab URL params:', e);
        }
    }

    async promptJoinConfirmation(roomId) {
        if (typeof Swal !== 'undefined') {
            const result = await Swal.fire({
                title: '👥 共同編集に参加しますか？',
                html: `
                    <p class="text-sm text-slate-600 dark:text-slate-300">
                        ルーム ID: <code class="font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded">${this.escapeHtml(roomId)}</code> への招待です。
                    </p>
                    <div class="mt-3.5 p-3.5 text-left rounded-xl bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 shadow-sm">
                        <div class="flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300 mb-1">
                            <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                            <span>自動バックアップと復元について</span>
                        </div>
                        <p class="text-xs text-emerald-900/90 dark:text-emerald-200/90 leading-relaxed">
                            参加する際、<strong>現在の作業データはローカルに自動保存</strong>されます。<br>
                            退出後は「参加前の作品を復元」から戻せます。ホストのブロックと作品データが共有されます。
                        </p>
                    </div>
                `,
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#4f46e5',
                cancelButtonColor: '#64748b',
                confirmButtonText: '参加する',
                cancelButtonText: 'キャンセル',
            });
            return result.isConfirmed;
        }
        return window.confirm(
            `共同編集ルーム (${roomId}) に参加しますか？\n\n※現在の作業データはローカルに自動保存されます。切断された際にこのデータは復活できます。`
        );
    }

    showToast(message, type = 'info') {
        if (typeof Swal !== 'undefined' && Swal.mixin) {
            const Toast = Swal.mixin({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000,
                timerProgressBar: true,
            });
            Toast.fire({
                icon: type,
                title: message,
            });
            return;
        }
        console.log(`[Collab ${type}]: ${message}`);
    }

    showCopyFeedback(button, text) {
        if (!button) return;
        const originalHtml = button.innerHTML;
        button.innerHTML = `<i data-lucide="check" class="w-4 h-4 text-emerald-500"></i> <span class="text-emerald-500">${text}</span>`;
        if (window.lucide) window.lucide.createIcons();
        setTimeout(() => {
            button.innerHTML = originalHtml;
            if (window.lucide) window.lucide.createIcons();
        }, 2000);
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    removeCollabUrlParam() {
        try {
            const url = new URL(window.location.href);
            if (url.searchParams.has('collab') || url.searchParams.has('room')) {
                url.searchParams.delete('collab');
                url.searchParams.delete('room');
                const cleanQuery = url.searchParams.toString();
                const newUrl = url.pathname + (cleanQuery ? `?${cleanQuery}` : '') + url.hash;
                window.history.replaceState({}, document.title, newUrl);
            }
        } catch (e) {
            console.error('Failed to clean collab URL param:', e);
        }
    }
}
