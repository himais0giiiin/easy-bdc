/**
 * EDBP Plugin UI
 * Market-style plugin management with uninstallation.
 */
const PLUGIN_MOBILE_WARNING_SKIP_KEY = 'edbb_plugin_mobile_warning_skip';
const PLUGIN_BLOCK_VISIBILITY_STORAGE_KEY = 'edbb_plugin_block_visibility_v1';
export const PLUGIN_FEATURE_TOGGLES_STORAGE_KEY = 'edbb_plugin_feature_toggles_v1';
const PLUGIN_NEWS_FEED_URL = 'https://raw.githubusercontent.com/EDBPlugin/News/refs/heads/main/news.json';
const PLUGIN_NEWS_FETCH_TIMEOUT_MS = 5000;
const MAX_CONCURRENT_MANIFEST_FETCHES = 4;

const confirmWithDialog = async (text, options = {}) => {
    if (typeof window !== 'undefined' && typeof window.Swal?.fire === 'function') {
        const result = await window.Swal.fire({
            text,
            icon: options.icon || 'question',
            showCancelButton: true,
            confirmButtonText: options.confirmButtonText || 'OK',
            cancelButtonText: options.cancelButtonText || 'Cancel',
            reverseButtons: options.reverseButtons ?? true,
            focusCancel: options.focusCancel ?? true,
            ...options.swal,
        });
        return !!result.isConfirmed;
    }
    return confirm(text);
};

export class PluginUI {
    constructor(pluginManager) {
        this.pluginManager = pluginManager;
        this.modal = document.getElementById('pluginModal');
        this.btn = document.getElementById('pluginBtn');
        this.closeBtn = document.getElementById('pluginModalClose');
        this.pluginList = document.getElementById('pluginList');
        this.pluginDetailEmpty = document.getElementById('pluginDetailEmpty');
        this.pluginDetailContent = document.getElementById('pluginDetailContent');
        this.mobileWarningModal = document.getElementById('pluginMobileWarningModal');
        this.mobileWarningProceedBtn = document.getElementById('pluginMobileWarningProceedBtn');
        this.mobileWarningCancelBtn = document.getElementById('pluginMobileWarningCancelBtn');
        this.mobileWarningCloseBtn = document.getElementById('pluginMobileWarningClose');
        this.mobileWarningSkipCheckbox = document.getElementById('pluginMobileWarningSkipCheckbox');

        this.isOnlyInstalled = false;
        this.searchQuery = '';
        this.githubResults = [];
        this.githubManifestTagCache = new Map();
        this.quickTagDisplayLimit = 30;
        this.quickTagExpanded = false;
        this.mobileWarningResolver = null;

        this.bulkInstallModal = document.getElementById('pluginBulkInstallModal');
        this.bulkInstallList = document.getElementById('pluginBulkInstallList');
        this.bulkInstallConfirmBtn = document.getElementById('pluginBulkInstallConfirmBtn');
        this.bulkInstallCancelBtn = document.getElementById('pluginBulkInstallCancelBtn');
        this.bulkInstallCloseBtn = document.getElementById('pluginBulkInstallClose');
        this.settingsModal = document.getElementById('pluginSettingsModal');
        this.settingsCloseBtn = document.getElementById('pluginSettingsClose');
        this.settingsResetBtn = document.getElementById('pluginSettingsResetBtn');
        this.settingsList = document.getElementById('pluginSettingsList');
        this.settingsTargetPluginId = null;
        this.pluginBlockVisibility = this.loadPluginBlockVisibility();
        this.pluginFeatureToggles = this.loadPluginFeatureToggles();
        this.allowedFeatureToggleKeys = new Set(Object.keys(this.getDefaultPluginFeatureToggles()));
        this.newsItems = [];
        this.newsFetchState = 'idle';
        this.newsFetchError = '';
        this.newsFetchedAt = 0;
        this.currentDetailPluginKey = null;
        this.updateCheckCache = new Map();
        this.sideErrorToastTimer = null;
        this.deleteAgreementModal = null;
        this.dangerousInstallModal = null;

        this.init();
    }

    showSideToast(message, state = 'success') {
        if (!message) return;
        if (!this.sideErrorToast) {
            const toast = document.createElement('div');
            toast.setAttribute('role', 'alert');
            toast.setAttribute('aria-live', 'assertive');
            Object.assign(toast.style, {
                position: 'fixed',
                top: '88px',
                right: '16px',
                maxWidth: 'min(420px, calc(100vw - 24px))',
                padding: '12px 14px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: '600',
                lineHeight: '1.4',
                boxShadow: '0 12px 28px -12px rgba(15, 23, 42, 0.65)',
                zIndex: '220',
                whiteSpace: 'pre-wrap',
                pointerEvents: 'none',
                opacity: '0',
                transform: 'translateX(120%)',
                transition: 'opacity 220ms ease, transform 220ms ease'
            });
            document.body.appendChild(toast);
            this.sideErrorToast = toast;
        }

        if (state === 'error') {
            this.sideErrorToast.style.border = '1px solid rgba(248, 113, 113, 0.45)';
            this.sideErrorToast.style.background = 'rgba(127, 29, 29, 0.95)';
            this.sideErrorToast.style.color = '#fee2e2';
        } else if (state === 'share') {
            this.sideErrorToast.style.border = '1px solid rgba(96, 165, 250, 0.45)';
            this.sideErrorToast.style.background = 'rgba(30, 64, 175, 0.95)';
            this.sideErrorToast.style.color = '#dbeafe';
        } else {
            this.sideErrorToast.style.border = '1px solid rgba(74, 222, 128, 0.45)';
            this.sideErrorToast.style.background = 'rgba(22, 101, 52, 0.95)';
            this.sideErrorToast.style.color = '#dcfce7';
        }

        this.sideErrorToast.textContent = String(message);
        this.sideErrorToast.style.opacity = '1';
        this.sideErrorToast.style.transform = 'translateX(0)';

        if (this.sideErrorToastTimer) {
            clearTimeout(this.sideErrorToastTimer);
        }
        this.sideErrorToastTimer = setTimeout(() => {
            if (!this.sideErrorToast) return;
            this.sideErrorToast.style.opacity = '0';
            this.sideErrorToast.style.transform = 'translateX(120%)';
        }, 4200);
    }

    showSideError(message) {
        this.showSideToast(message, 'error');
    }

    showSideSuccess(message) {
        this.showSideToast(message, 'success');
    }

    showSideShare(message) {
        this.showSideToast(message, 'share');
    }

    /**
     * Collaboration never installs a plugin silently. The room owner may offer a
     * block plugin, or a guest may ask the owner to add one; both paths land here.
     */
    async confirmCollabPluginInstall(plugin, { requester = null } = {}) {
        if (!plugin?.id || !plugin?.repo) {
            this.showSideError('このプラグインは共有用のGitHub情報がないため取得できません。');
            return false;
        }
        const installed = this.pluginManager.getRegistry().find(item => item.id === plugin.id);
        const requestPrefix = requester?.name ? `${requester.name} さんから` : '共同編集ルームから';
        const text = installed
            ? `${requestPrefix}「${plugin.name || plugin.id}」を共同編集で使います。有効にしますか？`
            : `${requestPrefix}「${plugin.name || plugin.id}」のブロックが追加されました。ダウンロードして共同編集に参加しますか？`;
        const confirmed = typeof window.Swal?.fire === 'function'
            ? (await window.Swal.fire({
                title: 'プラグインを取得しますか？', text, icon: 'question',
                showCancelButton: true, confirmButtonText: installed ? '有効にする' : 'ダウンロードする',
                cancelButtonText: '今はしない', reverseButtons: true,
            })).isConfirmed
            : window.confirm(text);
        if (!confirmed) return false;

        try {
            let target = installed;
            if (!target) {
                const repoInfo = this.pluginManager.parseGitHubUrl(plugin.repo);
                if (!repoInfo?.fullName) throw new Error('プラグインの配布URLが不正です。');
                target = await this.pluginManager.installFromGitHub(repoInfo.fullName, plugin.installRef || 'main');
                const trust = this.pluginManager.getManifestTrustLevel(target);
                if ((trust?.level ?? trust) === 'danger') {
                    const agreed = await this.confirmDangerousInstall(target.name || plugin.name || plugin.id, trust?.reason);
                    if (!agreed) {
                        await this.pluginManager.uninstallPlugin(target.id);
                        return false;
                    }
                }
            }
            await this.pluginManager.enablePlugin(target.id);
            this.renderMarketplace?.();
            this.showSideSuccess(`「${target.name || plugin.name || plugin.id}」を有効にしました。`);
            return true;
        } catch (error) {
            console.error('Failed to install collaboration plugin:', error);
            this.showSideError(`プラグインを取得できませんでした: ${error.message || '不明なエラー'}`);
            return false;
        }
    }

    ensureDeleteAgreementModal() {
        if (this.deleteAgreementModal) return this.deleteAgreementModal;
        const modal = document.createElement('div');
        modal.className = 'hidden fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">
                <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                    <h3 class="text-base font-bold text-slate-900 dark:text-white">プラグインを削除</h3>
                </div>
                <div class="px-5 py-4 space-y-3">
                    <p id="deleteAgreementText" class="text-sm text-slate-600 dark:text-slate-300"></p>
                    <label class="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                        <input id="deleteAgreementCheckbox" type="checkbox" class="mt-0.5 w-4 h-4 rounded border-slate-300 text-red-600 focus:ring-red-500">
                        <span>説明を確認し、削除に同意します</span>
                    </label>
                </div>
                <div class="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                    <button id="deleteAgreementCancelBtn" type="button" class="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">キャンセル</button>
                    <button id="deleteAgreementConfirmBtn" type="button" disabled class="px-4 py-2 rounded-lg bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-700">削除する</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        this.deleteAgreementModal = modal;
        return modal;
    }

    ensureDangerousInstallModal() {
        if (this.dangerousInstallModal) return this.dangerousInstallModal;
        const modal = document.createElement('div');
        modal.className = 'hidden fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300" role="dialog" aria-modal="true" aria-labelledby="dangerousInstallTitle">
                <div class="px-5 py-4 border-b border-red-100 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10 flex items-center gap-3">
                    <i data-lucide="alert-triangle" class="w-5 h-5 text-red-500"></i>
                    <h3 id="dangerousInstallTitle" class="text-base font-bold text-red-600 dark:text-red-400">セキュリティ警告</h3>
                </div>
                <div class="px-5 py-6 space-y-4">
                    <p class="text-sm text-slate-700 dark:text-slate-200 leading-relaxed font-bold">
                        注意: このプラグインは危険であるということが運営チームによって報告されています。
                    </p>
                    <p id="dangerousInstallPluginName" class="text-xs text-slate-500 dark:text-slate-400 font-mono p-2 bg-slate-50 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700"></p>
                    <div id="dangerousInstallReason" class="p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 text-xs text-red-600 dark:text-red-400 leading-relaxed whitespace-pre-wrap"></div>
                    <p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        信頼できないプラグインをインストールすると、あなたのボットのトークンやデータが盗まれたり、ボットが悪用されたりする危険があります。
                    </p>
                    <label class="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer group">
                        <input id="dangerousInstallCheckbox" type="checkbox" class="mt-1 w-4 h-4 rounded border-slate-300 text-red-600 focus:ring-red-500 transition-all group-hover:border-red-400">
                        <span class="select-none">リスクを理解し、自己責任でインストールを続行します</span>
                    </label>
                </div>
                <div class="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 bg-slate-50/50 dark:bg-slate-900/50">
                    <button id="dangerousInstallCancelBtn" type="button" class="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">インストールを中止</button>
                    <button id="dangerousInstallConfirmBtn" type="button" disabled class="px-4 py-2 rounded-lg bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-700 shadow-lg shadow-red-500/20 transition-all">続行する</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        this.dangerousInstallModal = modal;
        lucide.createIcons({ root: modal });
        return modal;
    }

    confirmDeleteWithAgreement(pluginName) {
        const modal = this.ensureDeleteAgreementModal();
        const text = modal.querySelector('#deleteAgreementText');
        const checkbox = modal.querySelector('#deleteAgreementCheckbox');
        const cancelBtn = modal.querySelector('#deleteAgreementCancelBtn');
        const confirmBtn = modal.querySelector('#deleteAgreementConfirmBtn');
        if (!text || !checkbox || !cancelBtn || !confirmBtn) return Promise.resolve(false);

        text.textContent = `「${pluginName}」を削除します。削除後は元に戻せません。`;
        checkbox.checked = false;
        confirmBtn.disabled = true;
        modal.classList.remove('hidden');

        return new Promise((resolve) => {
            const close = (result) => {
                modal.classList.add('hidden');
                checkbox.removeEventListener('change', onChange);
                cancelBtn.removeEventListener('click', onCancel);
                confirmBtn.removeEventListener('click', onConfirm);
                modal.removeEventListener('click', onBackdrop);
                resolve(result);
            };
            const onChange = () => {
                confirmBtn.disabled = !checkbox.checked;
            };
            const onCancel = () => close(false);
            const onConfirm = () => close(true);
            const onBackdrop = (event) => {
                if (event.target === modal) close(false);
            };

            checkbox.addEventListener('change', onChange);
            cancelBtn.addEventListener('click', onCancel);
            confirmBtn.addEventListener('click', onConfirm);
            modal.addEventListener('click', onBackdrop);
        });
    }

    confirmDangerousInstall(pluginName, reason) {
        const modal = this.ensureDangerousInstallModal();
        const reasonEl = modal.querySelector('#dangerousInstallReason');
        const checkbox = modal.querySelector('#dangerousInstallCheckbox');
        const cancelBtn = modal.querySelector('#dangerousInstallCancelBtn');
        const confirmBtn = modal.querySelector('#dangerousInstallConfirmBtn');
        const nameEl = modal.querySelector('#dangerousInstallPluginName');
        if (!reasonEl || !checkbox || !cancelBtn || !confirmBtn || !nameEl) return Promise.resolve(false);

        nameEl.textContent = pluginName || '(unknown)';
        reasonEl.textContent = reason || 'このプラグインには悪意のあるコードが含まれているか、重大なセキュリティ上の問題がある可能性があります。';
        checkbox.checked = false;
        confirmBtn.disabled = true;
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        const previousFocus = document.activeElement;
        checkbox.focus();

        return new Promise((resolve) => {
            const close = (result) => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
                checkbox.removeEventListener('change', onChange);
                cancelBtn.removeEventListener('click', onCancel);
                confirmBtn.removeEventListener('click', onConfirm);
                modal.removeEventListener('click', onBackdrop);
                modal.removeEventListener('keydown', onKeydown);
                if (previousFocus) previousFocus.focus();
                resolve(result);
            };
            const onChange = () => {
                confirmBtn.disabled = !checkbox.checked;
            };
            const onCancel = () => close(false);
            const onConfirm = () => close(true);
            const onBackdrop = (event) => {
                if (event.target === modal) close(false);
            };
            const onKeydown = (event) => {
                if (event.key === 'Escape') {
                    event.stopPropagation();
                    close(false);
                } else if (event.key === 'Tab') {
                    const focusable = [checkbox, cancelBtn, confirmBtn].filter(el => !el.disabled);
                    const first = focusable[0];
                    const last = focusable[focusable.length - 1];
                    if (event.shiftKey) {
                        if (document.activeElement === first) {
                            event.preventDefault();
                            last.focus();
                        }
                    } else {
                        if (document.activeElement === last) {
                            event.preventDefault();
                            first.focus();
                        }
                    }
                }
            };

            checkbox.addEventListener('change', onChange);
            cancelBtn.addEventListener('click', onCancel);
            confirmBtn.addEventListener('click', onConfirm);
            modal.addEventListener('click', onBackdrop);
            modal.addEventListener('keydown', onKeydown);
        });
    }

    init() {
        this.btn.addEventListener('click', () => this.open());
        this.closeBtn.addEventListener('click', () => this.close());
        const headerSettingsBtn = document.getElementById('pluginHeaderSettingsBtn');
        headerSettingsBtn?.addEventListener('click', () => this.openSettingsModal(null));

        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });

        // フィルターUIの取得
        const filterToggle = this.modal?.querySelector('button[data-filter-installed]'); // インストール済みのみ表示

        if (filterToggle) {
            this.updateInstalledFilterToggleState(filterToggle);
            filterToggle.addEventListener('click', () => {
                this.isOnlyInstalled = !this.isOnlyInstalled;
                this.updateInstalledFilterToggleState(filterToggle);
                this.renderMarketplace();
            });
        }

        if (this.pluginList) {
            this.pluginList.addEventListener('click', (event) => {
                const clickedItem = event.target.closest('[data-plugin-key]');
                if (!clickedItem) return;
            });
        }

        this.mobileWarningProceedBtn?.addEventListener('click', () => this.resolveMobileWarning(true));
        this.mobileWarningCancelBtn?.addEventListener('click', () => this.resolveMobileWarning(false));
        this.mobileWarningCloseBtn?.addEventListener('click', () => this.resolveMobileWarning(false));
        this.mobileWarningModal?.addEventListener('click', (e) => {
            if (e.target === this.mobileWarningModal) this.resolveMobileWarning(false);
        });
        this.boundMobileWarningEscHandler = (event) => {
            if (event.key === 'Escape' && this.isMobileWarningOpen()) {
                this.resolveMobileWarning(false);
            }
        };
        document.addEventListener('keydown', this.boundMobileWarningEscHandler);

        // ZIPインストールボタン
        const installBtn = document.getElementById('pluginInstallBtn');
        const installInput = document.getElementById('pluginInstallInput');
        if (installBtn && installInput) {
            installBtn.addEventListener('click', () => installInput.click());
            installInput.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                    const manifest = await this.pluginManager.peekManifestFromZip(file);

                    // 危険なプラグインのチェック
                    const level = manifest.trustLevel?.level ?? manifest.trustLevel;
                    if (level === 'danger') {
                        const agreed = await this.confirmDangerousInstall(manifest.name, manifest.trustLevel?.reason);
                        if (!agreed) {
                            e.target.value = '';
                            return;
                        }
                    }

                    await this.pluginManager.installFromZip(file);
                    this.renderMarketplace();
                    this.showSideSuccess('プラグインをインストールしました。');
                } catch (err) {
                    this.showSideError('プラグインのインストールに失敗しました: ' + err.message);
                }
                e.target.value = '';
            });
        }
        this.renderMarketplace();

        // システムリセットボタン（履歴を消すボタン等から呼び出し可能にする）
        const resetBtn = document.getElementById('resetSystemBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', async () => {
                const confirmed = await confirmWithDialog('すべてのプラグインと設定を完全に削除し、初期状態に戻しますか？\nこの操作は取り消せません。', {
                    icon: 'warning',
                    confirmButtonText: '削除',
                });
                if (confirmed) {
                    this.pluginManager.resetSystem();
                    this.renderMarketplace();
                    this.showSideSuccess('システムが完全にリセットされました。');
                }
            });
        }

        this.bulkInstallCloseBtn?.addEventListener('click', () => this.closeBulkInstall());
        this.bulkInstallCancelBtn?.addEventListener('click', () => this.closeBulkInstall());
        this.bulkInstallModal?.addEventListener('click', (e) => {
            if (e.target === this.bulkInstallModal) this.closeBulkInstall();
        });
        this.initSettingsModal();
        this.applyPluginFeatureToggles();
        this.applyBlockVisibilityConfig();

        // URLパラメータによるプラグインインストールのチェック
        this.handleUrlParams();

        // 一括共有ボタン
        const bulkShareBtn = document.getElementById('pluginBulkShareBtn');
        if (bulkShareBtn) {
            bulkShareBtn.addEventListener('click', () => {
                const enabledPlugins = this.pluginManager.getRegistry().filter(p =>
                    this.pluginManager.isPluginEnabled(p.id) && p.installedFrom === 1 && p.repo
                );

                if (enabledPlugins.length === 0) {
                    this.showSideError('共有可能な有効なプラグインがありません。\n(GitHubからインストールされたものが対象です)');
                    return;
                }

                const repoNames = enabledPlugins.map(p => {
                    const info = this.pluginManager.parseGitHubUrl(p.repo);
                    if (!info) return null;
                    let name = info.fullName;
                    if (p.installRef && p.installRef !== 'main') {
                        name += `@${p.installRef}`;
                    }
                    return name;
                }).filter(name => name !== null);

                if (repoNames.length === 0) {
                    this.showSideError('共有可能なプラグインが見つかりませんでした。');
                    return;
                }

                const baseUrl = window.location.origin + window.location.pathname;
                const shareUrl = `${baseUrl}?install-plugins=${encodeURIComponent(repoNames.join(','))}`;

                navigator.clipboard.writeText(shareUrl).then(() => {
                    this.showSideShare('有効なプラグインを一括インストールするためのURLをコピーしました！');
                }).catch(err => {
                    this.showSideError('URLのコピーに失敗しました。\n' + shareUrl);
                });
            });
        }
    }

    initSettingsModal() {
        this.settingsCloseBtn?.addEventListener('click', () => this.closeSettingsModal());
        this.settingsModal?.addEventListener('click', (e) => {
            if (e.target === this.settingsModal) this.closeSettingsModal();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.settingsModal && !this.settingsModal.classList.contains('hidden')) {
                this.closeSettingsModal();
            }
        });
        this.settingsResetBtn?.addEventListener('click', () => {
            if (!this.settingsTargetPluginId) {
                this.pluginFeatureToggles = this.getDefaultPluginFeatureToggles();
                this.savePluginFeatureToggles();
                this.applyPluginFeatureToggles();
                this.renderSettingsList();
                return;
            }

            delete this.pluginBlockVisibility[this.settingsTargetPluginId];
            this.savePluginBlockVisibility();
            this.applyBlockVisibilityConfig();
            this.renderSettingsList();
        });
    }

    openSettingsModal(pluginId = null) {
        this.settingsTargetPluginId = pluginId;
        if (!this.settingsModal) return;
        this.renderSettingsList();
        this.settingsModal.classList.remove('hidden');
        this.settingsModal.classList.add('flex');
        this.settingsModal.setAttribute('aria-hidden', 'false');
        void this.settingsModal.offsetWidth;
        this.settingsModal.classList.add('show-modal');
    }

    closeSettingsModal() {
        if (!this.settingsModal) return;
        this.settingsModal.classList.remove('show-modal');

        // aria-hiddenを設定する前にフォーカスをモーダル外に移動する（WAI-ARIA準拠）
        if (this.settingsModal.contains(document.activeElement)) {
            this.modal?.querySelector('#pluginSettingsClose')?.blur();
            this.modal?.focus();
        }

        this.settingsModal.setAttribute('aria-hidden', 'true');
        setTimeout(() => {
            this.settingsModal?.classList.remove('flex');
            this.settingsModal?.classList.add('hidden');
        }, 300);
    }

    loadPluginBlockVisibility() {
        try {
            const raw = localStorage.getItem(PLUGIN_BLOCK_VISIBILITY_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    savePluginBlockVisibility() {
        localStorage.setItem(PLUGIN_BLOCK_VISIBILITY_STORAGE_KEY, JSON.stringify(this.pluginBlockVisibility));
    }

    getDefaultPluginFeatureToggles() {
        return {
            blockSearch: false,
            zipInstall: false,
            darkModeButton: false
        };
    }

    loadPluginFeatureToggles() {
        const defaults = this.getDefaultPluginFeatureToggles();
        try {
            const raw = localStorage.getItem(PLUGIN_FEATURE_TOGGLES_STORAGE_KEY);
            if (!raw) return defaults;
            const parsed = JSON.parse(raw);
            return {
                blockSearch: Boolean(parsed?.blockSearch),
                zipInstall: Boolean(parsed?.zipInstall),
                darkModeButton: Boolean(parsed?.darkModeButton)
            };
        } catch (error) {
            return defaults;
        }
    }

    savePluginFeatureToggles() {
        localStorage.setItem(PLUGIN_FEATURE_TOGGLES_STORAGE_KEY, JSON.stringify(this.pluginFeatureToggles));
    }

    applyPluginFeatureToggles() {
        const toggles = this.pluginFeatureToggles || this.getDefaultPluginFeatureToggles();

        const blockSearchContainer = document.getElementById('blockSearchContainer');
        const blockSearchInput = document.getElementById('blockSearchInput');
        if (blockSearchContainer) {
            blockSearchContainer.style.display = toggles.blockSearch ? '' : 'none';
        }
        if (!toggles.blockSearch && blockSearchInput) {
            blockSearchInput.value = '';
            if (window.blockSearch && typeof window.blockSearch.updateToolbox === 'function') {
                window.blockSearch.updateToolbox(true);
            }
        }

        const installBtn = document.getElementById('pluginInstallBtn');
        if (installBtn) {
            installBtn.style.display = toggles.zipInstall ? '' : 'none';
        }

        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.style.display = toggles.darkModeButton ? '' : 'none';
            const divider = themeToggle.previousElementSibling;
            const isThemeDivider = !!divider && (
                divider.hasAttribute('data-theme-divider')
                || divider.classList.contains('w-px')
            );
            if (isThemeDivider) {
                divider.style.display = toggles.darkModeButton ? '' : 'none';
            }
        }

        window.dispatchEvent(new Event('edbb-plugin-feature-settings-changed'));
    }

    getHiddenBlockSetForPlugin(pluginId) {
        if (!pluginId) return new Set();
        const raw = this.pluginBlockVisibility[pluginId];
        if (!Array.isArray(raw)) return new Set();
        return new Set(raw);
    }

    getHiddenBlockTypesUnion() {
        const allHidden = new Set();
        Object.values(this.pluginBlockVisibility).forEach((items) => {
            if (!Array.isArray(items)) return;
            items.forEach((type) => allHidden.add(type));
        });
        return allHidden;
    }

    getToolboxTemplate() {
        const toolbox = document.getElementById('toolbox');
        if (!toolbox) return null;
        return toolbox.cloneNode(true);
    }

    applyBlockVisibilityConfig() {
        const workspace = this.pluginManager.workspace;
        const template = this.getToolboxTemplate();
        if (!workspace || !template || typeof workspace.updateToolbox !== 'function') return;
        const hiddenBlockTypes = this.getHiddenBlockTypesUnion();

        const filtered = template.cloneNode(true);
        const categories = Array.from(filtered.querySelectorAll('category'));
        categories.forEach((category) => {
            Array.from(category.querySelectorAll('block')).forEach((block) => {
                const type = block.getAttribute('type');
                if (type && hiddenBlockTypes.has(type)) {
                    block.remove();
                }
            });

            const hasCustom = category.hasAttribute('custom');
            const hasBlocks = !!category.querySelector('block');
            if (!hasCustom && !hasBlocks) {
                category.remove();
            }
        });

        const remainingCategories = filtered.querySelectorAll('category').length;
        if (remainingCategories === 0) {
            workspace.updateToolbox(template.cloneNode(true));
            return;
        }

        workspace.updateToolbox(filtered);
    }

    renderSettingsList() {
        if (!this.settingsList) return;
        this.settingsList.innerHTML = '';
        const pluginId = this.settingsTargetPluginId;
        const titleEl = document.getElementById('pluginSettingsTargetLabel');
        if (!pluginId) {
            if (titleEl) titleEl.textContent = 'Global';
            const toggles = this.pluginFeatureToggles || this.getDefaultPluginFeatureToggles();
            this.settingsList.innerHTML = `
                <div class="grid grid-cols-1 gap-3">
                    <label class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                        <span class="text-sm font-semibold text-slate-700 dark:text-slate-200">ブロック検索</span>
                        <span class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" data-feature-toggle="blockSearch" ${toggles.blockSearch ? 'checked' : ''} class="sr-only peer">
                            <span class="w-10 h-6 rounded-full bg-slate-300 dark:bg-slate-700 transition-colors peer-checked:bg-indigo-600"></span>
                            <span class="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white transition-transform peer-checked:translate-x-4 shadow-sm"></span>
                        </span>
                    </label>
                    <label class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                        <span class="text-sm font-semibold text-slate-700 dark:text-slate-200">ZIPでインストール</span>
                        <span class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" data-feature-toggle="zipInstall" ${toggles.zipInstall ? 'checked' : ''} class="sr-only peer">
                            <span class="w-10 h-6 rounded-full bg-slate-300 dark:bg-slate-700 transition-colors peer-checked:bg-indigo-600"></span>
                            <span class="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white transition-transform peer-checked:translate-x-4 shadow-sm"></span>
                        </span>
                    </label>
                    <label class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                        <span class="text-sm font-semibold text-slate-700 dark:text-slate-200">ダークモードボタン</span>
                        <span class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" data-feature-toggle="darkModeButton" ${toggles.darkModeButton ? 'checked' : ''} class="sr-only peer">
                            <span class="w-10 h-6 rounded-full bg-slate-300 dark:bg-slate-700 transition-colors peer-checked:bg-indigo-600"></span>
                            <span class="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white transition-transform peer-checked:translate-x-4 shadow-sm"></span>
                        </span>
                    </label>
                </div>
                <p class="text-xs text-slate-500 dark:text-slate-400">デフォルトは全てOFFです。</p>
            `;
            this.settingsList.querySelectorAll('input[data-feature-toggle]').forEach((el) => {
                el.addEventListener('change', (event) => {
                    const key = String(event.target?.getAttribute('data-feature-toggle') || '');
                    if (!key || !this.allowedFeatureToggleKeys.has(key)) {
                        console.warn('Ignored unknown feature toggle key:', key);
                        return;
                    }
                    this.pluginFeatureToggles[key] = Boolean(event.target.checked);
                    this.savePluginFeatureToggles();
                    this.applyPluginFeatureToggles();
                });
            });
            return;
        }
        const targetPlugin = this.pluginManager.getRegistry().find((item) => item.id === pluginId);
        const pluginName = targetPlugin?.name || pluginId;
        if (titleEl) titleEl.textContent = pluginName;
        const blockTypes = (this.pluginManager.getPluginBlockTypes?.(pluginId) || []).filter(Boolean);
        if (blockTypes.length === 0) {
            this.settingsList.innerHTML = '<div class="text-sm text-slate-500 dark:text-slate-400">このプラグインのブロック情報がありません。プラグインを有効化してから再度開いてください。</div>';
            return;
        }
        const hiddenSet = this.getHiddenBlockSetForPlugin(pluginId);

        const listHtml = blockTypes.map((type) => {
            const checked = hiddenSet.has(type) ? '' : 'checked';
            return `
                <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                    <input data-block-type="${this.escapeHtml(type)}" type="checkbox" ${checked} class="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
                    <span class="font-mono">${this.escapeHtml(type)}</span>
                </label>
            `;
        }).join('');
        this.settingsList.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${listHtml}</div>`;

        this.settingsList.querySelectorAll('input[data-block-type]').forEach((el) => {
            el.addEventListener('change', (event) => {
                const type = event.target.getAttribute('data-block-type');
                if (!type || !this.settingsTargetPluginId) return;
                const mutableSet = this.getHiddenBlockSetForPlugin(this.settingsTargetPluginId);
                if (event.target.checked) mutableSet.delete(type);
                else mutableSet.add(type);
                this.pluginBlockVisibility[this.settingsTargetPluginId] = Array.from(mutableSet);
                this.savePluginBlockVisibility();
                this.applyBlockVisibilityConfig();
            });
        });
    }

    async handleUrlParams() {
        const params = new URLSearchParams(window.location.search);

        // パラメータの取得（単数・複数どちらも一括インストールのUIで処理する）
        const single = params.get('install-plugin');
        const multiple = params.get('install-plugins');

        if (single) {
            this.clearUrlParam('install-plugin');
            await this.handleBulkInstall(single);
        } else if (multiple) {
            this.clearUrlParam('install-plugins');
            await this.handleBulkInstall(multiple);
        }
    }

    clearUrlParam(key) {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete(key);
        window.history.replaceState({}, '', newUrl);
    }

    async handleBulkInstall(installRepos) {
        const repos = installRepos.split(',').map(r => r.trim()).filter(r => r.length > 0);
        if (repos.length === 0) return;

        this.bulkInstallList.innerHTML = '<div class="p-8 text-center text-slate-500">プラグイン情報を取得中...</div>';
        this.bulkInstallModal.classList.remove('hidden');
        this.bulkInstallModal.classList.add('flex');
        void this.bulkInstallModal.offsetWidth;
        this.bulkInstallModal.classList.add('show-modal');

        const repoInfos = await Promise.all(repos.map(async (entry) => {
            // URLか fullName@ref かを判定してパース
            let info = this.pluginManager.parseGitHubUrl(entry);
            let repoUrl = entry;

            if (!info && entry.includes('/')) {
                // 旧形式 fullName@ref
                const [fullName, ref] = entry.split('@');
                repoUrl = `https://github.com/${fullName}${ref ? `/tree/${ref}` : ''}`;
                info = this.pluginManager.parseGitHubUrl(repoUrl);
            }

            if (!info) return null;

            // 既にインストールされているかチェック
            const installed = this.pluginManager.getRegistry();
            const cleanTarget = repoUrl.split('?')[0].replace(/\/$/, '').replace(/\.git$/, '');
            const existing = installed.find(p => {
                const pClean = p.repo?.split('?')[0].replace(/\/$/, '').replace(/\.git$/, '');
                return pClean === cleanTarget;
            });

            return {
                fullName: info.fullName,
                repoUrl: repoUrl,
                ref: info.branch || 'main',
                author: info.owner,
                name: info.repo,
                existing: !!existing
            };
        }));

        const validInfos = repoInfos.filter(i => i !== null);
        this.renderBulkInstallList(validInfos);

        this.bulkInstallConfirmBtn.onclick = async () => {
            const selectedEntries = Array.from(this.bulkInstallList.querySelectorAll('input[type="checkbox"]:checked'))
                .map(cb => cb.value);

            if (selectedEntries.length === 0) {
                this.showSideError('インストールするプラグインを選択してください。');
                return;
            }

            this.bulkInstallConfirmBtn.disabled = true;
            const originalText = this.bulkInstallConfirmBtn.innerHTML;
            this.bulkInstallConfirmBtn.innerHTML = '<i class="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></i> <span>インストール中...</span>';

            let successCount = 0;
            let failCount = 0;
            let skippedCount = 0;

            for (const entryUrl of selectedEntries) {
                const info = this.pluginManager.parseGitHubUrl(entryUrl);
                if (!info) {
                    failCount++;
                    continue;
                }
                try {
                    // 危険なプラグインのチェック (マーケットプレイスの検索結果から取得)
                    const results = this.githubResults || [];
                    const pluginData = results.find(p => p.fullName === info.fullName);
                    let level = pluginData?.trustLevel?.level ?? pluginData?.trustLevel;
                    let trustReason = pluginData?.trustLevel?.reason;
                    let pName = pluginData?.name || info.fullName;

                    if (!level) {
                        try {
                            const manifestUrl = `https://raw.githubusercontent.com/${info.fullName}/${info.branch || 'main'}/manifest.json`;
                            const ctrl = new AbortController();
                            const timeoutId = setTimeout(() => ctrl.abort(), 5000);
                            const fetchRes = await fetch(manifestUrl, { signal: ctrl.signal });
                            clearTimeout(timeoutId);
                            if (fetchRes.ok) {
                                const fetchedManifest = await fetchRes.json();
                                const fetchedTrust = this.pluginManager.getManifestTrustLevel(fetchedManifest);
                                level = fetchedTrust?.level ?? fetchedTrust;
                                trustReason = fetchedTrust?.reason;
                                pName = fetchedManifest.name || pName;
                            }
                        } catch (e) {
                            console.warn(`Failed to fetch manifest for ${info.fullName}:`, e);
                        }
                    }

                    if (level === 'danger') {
                        const agreed = await this.confirmDangerousInstall(pName, trustReason);
                        if (!agreed) {
                            skippedCount++;
                            continue;
                        }
                    }

                    await this.pluginManager.installFromGitHub(info.fullName, entryUrl);
                    successCount++;
                } catch (e) {
                    console.error(`Failed to install ${info.fullName}:`, e);
                    failCount++;
                }
            }

            let message = `${successCount}個のプラグインをインストールしました。`;
            if (failCount > 0) message += `\n${failCount}個のインストールに失敗しました。`;
            if (skippedCount > 0) message += `\n${skippedCount}個のインストールをユーザーの操作でスキップしました。`;

            if (failCount > 0) {
                this.showSideError(message);
            } else {
                this.showSideSuccess(message);
            }
            this.bulkInstallConfirmBtn.disabled = false;
            this.bulkInstallConfirmBtn.innerHTML = originalText;
            this.closeBulkInstall();
            this.renderMarketplace();
        };
    }

    renderBulkInstallList(infos) {
        this.bulkInstallList.innerHTML = '';
        infos.forEach(info => {
            const container = document.createElement('div');
            container.className = 'flex flex-col gap-2';

            const item = document.createElement('div');
            item.className = `flex items-center gap-3 p-4 rounded-xl border transition-all ${info.existing ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 opacity-60' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-500 cursor-pointer'}`;

            const value = info.repoUrl;
            const versionLabel = info.ref !== 'main' ? `<span class="ml-2 px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 font-mono text-[10px]">${this.escapeHtml(info.ref)}</span>` : '';
            const safeValue = this.escapeHtml(value);

            item.innerHTML = `
                <input type="checkbox" value="${safeValue}" ${info.existing ? 'disabled' : 'checked'} class="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 shrink-0">
                <div class="flex-grow info-area">
                    <div class="font-bold text-lg text-slate-900 dark:text-white flex items-center">${this.escapeHtml(info.name)}${versionLabel}</div>
                    <div class="text-sm text-slate-500 dark:text-slate-400">開発者: ${this.escapeHtml(info.author)} ${info.existing ? '(インストール済み)' : ''}</div>
                </div>
                <i data-lucide="chevron-down" class="w-4 h-4 text-slate-300 detail-icon"></i>
            `;

            const detailView = document.createElement('div');
            detailView.className = 'hidden p-4 rounded-xl bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 text-sm overflow-hidden';
            detailView.innerHTML = '<div class="animate-pulse flex flex-col gap-2"><div class="h-3 bg-slate-200 dark:bg-slate-800 rounded w-full"></div><div class="h-3 bg-slate-200 dark:bg-slate-800 rounded w-5/6"></div></div>';

            const checkbox = item.querySelector('input[type="checkbox"]');
            const infoArea = item.querySelector('.info-area');
            const detailIcon = item.querySelector('.detail-icon');

            const toggleDetail = async (e) => {
                // チェックボックス自体のクリックなら無視（デフォルト挙動に任せる）
                if (e.target === checkbox) return;

                const isHidden = detailView.classList.contains('hidden');

                // 他のプラグインの詳細を閉じる
                this.bulkInstallList.querySelectorAll('.detail-view').forEach(el => {
                    if (el !== detailView) el.classList.add('hidden');
                });
                this.bulkInstallList.querySelectorAll('.detail-icon').forEach(el => {
                    if (el !== detailIcon) el.style.transform = 'rotate(0deg)';
                });

                if (isHidden) {
                    detailView.classList.remove('hidden');
                    detailView.classList.add('detail-view');
                    detailIcon.style.transform = 'rotate(180deg)';
                    detailIcon.style.transition = 'transform 0.2s';

                    // READMEの読み込み
                    try {
                        const readme = await this.pluginManager.getREADME(info.repoUrl);
                        detailView.innerHTML = `<div class="prose dark:prose-invert max-w-none 
                            prose-h1:text-2xl prose-h1:font-bold prose-h1:mb-4 prose-h1:text-slate-900 dark:prose-h1:text-white
                            prose-h2:text-xl prose-h2:font-bold prose-h2:mt-6 prose-h2:mb-3 prose-h2:text-slate-800 dark:prose-h2:text-slate-100
                            prose-h3:text-lg prose-h3:font-bold prose-h3:mt-4 prose-h3:mb-2
                            prose-p:text-slate-600 dark:prose-p:text-slate-300 prose-p:leading-relaxed">${this.renderMarkdown(readme)}</div>`;
                    } catch (err) {
                        detailView.innerHTML = `<p class="text-xs text-red-500">READMEの取得に失敗しました: ${this.escapeHtml(err?.message || String(err))}</p>`;
                    }
                } else {
                    detailView.classList.add('hidden');
                    detailIcon.style.transform = 'rotate(0deg)';
                }
            };

            item.addEventListener('click', toggleDetail);

            container.appendChild(item);
            container.appendChild(detailView);
            this.bulkInstallList.appendChild(container);
        });
        lucide.createIcons();
    }

    updateInstalledFilterToggleState(button) {
        if (!button) return;
        button.setAttribute('aria-pressed', this.isOnlyInstalled ? 'true' : 'false');
        button.classList.toggle('bg-indigo-500', this.isOnlyInstalled);
        button.classList.toggle('dark:bg-indigo-500', this.isOnlyInstalled);
        button.classList.toggle('bg-slate-200', !this.isOnlyInstalled);
        button.classList.toggle('dark:bg-slate-700', !this.isOnlyInstalled);
        const knob = button.querySelector('div');
        if (knob) {
            knob.classList.toggle('translate-x-4', this.isOnlyInstalled);
            knob.classList.toggle('translate-x-0', !this.isOnlyInstalled);
        }
    }

    async open() {
        if (this.shouldShowMobileWarning()) {
            const canOpen = await this.showMobileWarning();
            if (!canOpen) return;
        }

        // Blocklyのポップアップ（ツールチップやメニュー）を閉じる
        if (this.pluginManager.workspace && typeof Blockly !== 'undefined') {
            Blockly.hideChaff();
        }

        // 既存の終了タイマーがあればクリア
        if (this.closeTimer) {
            clearTimeout(this.closeTimer);
            this.closeTimer = null;
        }

        this.modal.classList.remove('hidden');
        this.modal.classList.add('flex');
        this.modal.setAttribute('aria-hidden', 'false');
        void this.modal.offsetWidth;
        this.modal.classList.add('show-modal');
        void this.ensureNewsLoaded();
        this.showEmptyDetail();
        this.renderMarketplace();
    }

    close() {
        // 既存の終了タイマーがあればクリア
        if (this.closeTimer) {
            clearTimeout(this.closeTimer);
            this.closeTimer = null;
        }

        // モバイル表示用の詳細画面状態もリセット
        this.modal.classList.remove('detail-open');
        this.modal.classList.remove('show-modal');

        // モバイル警告モーダルが開いていればそれも閉じる
        if (this.isMobileWarningOpen()) {
            this.resolveMobileWarning(false);
        }

        // aria-hiddenを設定する前にフォーカスをモーダル外に移動する（WAI-ARIA準拠）
        if (this.modal.contains(document.activeElement)) {
            this.btn?.focus();
        }

        this.closeTimer = setTimeout(() => {
            if (!this.modal) return;
            this.modal.classList.remove('flex');
            this.modal.classList.add('hidden');
            this.modal.setAttribute('aria-hidden', 'true');
            this.closeTimer = null;
        }, 300);
    }

    getPluginSelectionKey(plugin, isInstalled) {
        if (isInstalled) return String(plugin?.id || '');
        return String(plugin?.fullName || plugin?.repo || plugin?.name || '');
    }

    getPluginRepoKey(plugin) {
        const raw = String(
            plugin?.repo
            || plugin?.source
            || plugin?.fullName
            || ''
        ).trim();
        if (!raw) return '';
        const parsed = this.pluginManager.parseGitHubUrl(raw);
        if (parsed?.fullName) {
            return String(parsed.fullName).toLowerCase();
        }
        return raw
            .replace(/^https?:\/\/github\.com\//i, '')
            .replace(/\.git$/i, '')
            .replace(/\/+$/g, '')
            .toLowerCase();
    }

    updateSidebarSelectionState() {
        const nodes = this.pluginList?.querySelectorAll('[data-plugin-key]');
        if (!nodes) return;
        nodes.forEach((node) => {
            const isActive = node.dataset.pluginKey === this.currentDetailPluginKey;
            node.classList.toggle('ring-2', isActive);
            node.classList.toggle('ring-indigo-500/60', isActive);
            node.classList.toggle('dark:ring-indigo-400/60', isActive);
        });
    }

    showEmptyDetail() {
        this.currentDetailPluginKey = null;
        this.updateSidebarSelectionState();
        this.pluginDetailContent.classList.add('hidden');
        this.pluginDetailEmpty.classList.remove('hidden');
        const quickTags = this.getQuickSearchTags();
        const visibleTags = this.quickTagExpanded
            ? quickTags
            : quickTags.slice(0, this.quickTagDisplayLimit);
        const quickTagButtons = visibleTags.map((tag) => `<button type="button" data-quick-query="tag:${this.escapeHtml(tag)}" class="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-500 transition-colors">tag:${this.escapeHtml(tag)}</button>`).join('');
        const hasMoreTags = quickTags.length > this.quickTagDisplayLimit;
        const toggleLabel = this.quickTagExpanded ? '閉じる' : 'もっと見る';
        const quickTagToggle = hasMoreTags
            ? `<button type="button" data-quick-tags-toggle="1" class="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors">${toggleLabel}</button>`
            : '';
        this.pluginDetailEmpty.innerHTML = `
            <div class="w-full h-full max-w-6xl mx-auto flex flex-col">
                <div class="mb-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 p-5 text-left flex-1 min-h-0 flex flex-col">
                    <label for="pluginSearchFromDetailInput" class="text-xs font-semibold uppercase tracking-widest text-indigo-500 dark:text-indigo-300">Search Plugins</label>
                    <input id="pluginSearchFromDetailInput" type="text" placeholder="名前・開発者・タグ (例: utility badge:公式)"
                        value="${this.escapeHtml(this.searchQuery)}"
                        class="mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-base text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <p class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">通常検索: 名前/開発者/タグ ・ 指定検索: <code>tag:</code> <code>author:</code> ・ 旧形式: <code>badge:公式</code></p>
                    <div class="mt-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4 space-y-3 flex-1 min-h-0 overflow-y-auto">
                        <div class="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Quick Panel</div>
                        <div class="flex flex-wrap gap-2">
                            <button type="button" data-quick-query="badge:公認" class="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-500 transition-colors">公認</button>
                            <button type="button" data-quick-query="badge:公式" class="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-500 transition-colors">公式</button>
                            <button type="button" data-quick-query="badge:不可" class="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-500 transition-colors">不可</button>
                            <button type="button" data-quick-query="badge:危険" class="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-500 transition-colors">危険</button>
                            <button type="button" data-quick-query="" class="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 hover:border-slate-400 transition-colors">クリア</button>
                        </div>
                        <div class="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Tags (manifest)</div>
                        <div class="flex flex-wrap gap-2">
                            ${quickTagButtons}
                        </div>
                        ${quickTagToggle ? `<div class="flex justify-start">${quickTagToggle}</div>` : ''}
                    </div>
                </div>
            </div>
        `;
        const searchInput = this.pluginDetailEmpty.querySelector('#pluginSearchFromDetailInput');
        if (searchInput) {
            searchInput.addEventListener('input', (event) => {
                this.searchQuery = String(event.target?.value || '');
                this.renderMarketplace();
            });
        }
        this.pluginDetailEmpty.querySelectorAll('[data-quick-query]').forEach((button) => {
            button.addEventListener('click', () => {
                const query = String(button.getAttribute('data-quick-query') || '');
                this.setSearchQuery(query);
            });
        });
        const toggleBtn = this.pluginDetailEmpty.querySelector('[data-quick-tags-toggle]');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.quickTagExpanded = !this.quickTagExpanded;
                this.showEmptyDetail();
            });
        }
        lucide.createIcons();
    }

    setSearchQuery(query) {
        this.searchQuery = String(query || '');
        const searchInput = this.pluginDetailEmpty?.querySelector('#pluginSearchFromDetailInput');
        if (searchInput) {
            searchInput.value = this.searchQuery;
            searchInput.focus();
        }
        this.renderMarketplace();
    }

    getQuickSearchTags() {
        const tagSet = new Set();
        const collect = (items) => {
            items.forEach((plugin) => {
                if (!Array.isArray(plugin?.tags)) return;
                plugin.tags.forEach((tag) => {
                    const normalized = String(tag || '').trim();
                    if (!normalized) return;
                    tagSet.add(normalized);
                });
            });
        };

        collect(this.pluginManager.getRegistry() || []);
        collect(this.githubResults || []);
        return Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'ja'));
    }

    async enrichGitHubPluginsWithManifestTags(plugins) {
        if (!Array.isArray(plugins) || plugins.length === 0) return;
        const fetchManifestTags = async (plugin) => {
            const fullName = String(plugin?.fullName || '');
            if (!fullName) return;
            const defaultBranch = String(plugin?.defaultBranch || 'main');
            const cacheKey = `${fullName}#${defaultBranch}`;

            if (this.githubManifestTagCache.has(cacheKey)) {
                const cached = this.githubManifestTagCache.get(cacheKey) || [];
                if (cached.length > 0) plugin.tags = cached;
                return;
            }

            let tags = Array.isArray(plugin?.tags) ? plugin.tags.filter(Boolean).map((tag) => String(tag)) : [];
            try {
                const skipManifestFetch = await this.pluginManager.isInExternalManifestList(fullName);
                if (!skipManifestFetch) {
                    const manifest = await this.pluginManager.getManifestFromGitHub(fullName, defaultBranch);
                    if (Array.isArray(manifest?.tags) && manifest.tags.length > 0) {
                        tags = manifest.tags.filter(Boolean).map((tag) => String(tag));
                    }
                }
            } catch (error) {
                // noop
            }

            this.githubManifestTagCache.set(cacheKey, tags);
            if (tags.length > 0) {
                plugin.tags = tags;
            }
        };

        const limit = Math.max(1, Math.min(MAX_CONCURRENT_MANIFEST_FETCHES, plugins.length));
        const queue = [...plugins];
        const workers = Array.from({ length: limit }, async () => {
            while (queue.length > 0) {
                const plugin = queue.shift();
                if (!plugin) return;
                await fetchManifestTags(plugin);
            }
        });
        await Promise.all(workers);
    }

    parseQuery(query) {
        const filter = { text: [], authors: [], tags: [], badges: [] };
        if (!query) return filter;

        const parts = String(query).trim().split(/\s+/).filter(Boolean);
        parts.forEach((part) => {
            const token = part.toLowerCase();
            if (token.startsWith('tag:')) {
                const tag = token.substring(4);
                if (tag) filter.tags.push(tag);
                return;
            }
            if (token.startsWith('author:')) {
                const author = token.substring(7);
                if (author) filter.authors.push(author);
                return;
            }
            if (token.startsWith('badge:')) {
                const val = token.split(':')[1] || '';
                const badgeMap = {
                    'official': 'official', '公式': 'official',
                    'certified': 'certified', '公認': 'certified',
                    'danger': 'danger', '危険': 'danger',
                    'invalid': 'invalid', '使用不可': 'invalid', '不可': 'invalid',
                };
                filter.badges.push(badgeMap[val] || val);
                return;
            }
            filter.text.push(token);
        });
        return filter;
    }

    matchesPluginFilter(plugin, filter) {
        if (!filter) return true;
        const name = String(plugin?.name || '').toLowerCase();
        const author = String(plugin?.author || '').toLowerCase();
        const tags = Array.isArray(plugin?.tags)
            ? plugin.tags.map((t) => String(t || '').toLowerCase())
            : [];
        const level = String(plugin?.trustLevel?.level ?? plugin?.trustLevel ?? '').toLowerCase();

        const matchesText = filter.text.length === 0 || filter.text.every((txt) =>
            name.includes(txt) || author.includes(txt) || tags.some((tag) => tag.includes(txt))
        );
        const matchesAuthor = filter.authors.length === 0 || filter.authors.every((a) =>
            author.includes(a)
        );
        const matchesTag = filter.tags.length === 0 || filter.tags.every((tag) =>
            tags.some((pt) => pt.includes(tag))
        );
        const matchesBadge = filter.badges.length === 0 || filter.badges.includes(level);
        return matchesText && matchesAuthor && matchesTag && matchesBadge;
    }

    closeBulkInstall() {
        this.bulkInstallModal.classList.remove('show-modal');
        setTimeout(() => {
            this.bulkInstallModal.classList.add('hidden');
            this.bulkInstallModal.classList.remove('flex');
        }, 300);
    }

    isMobileDevice() {
        return document.documentElement.classList.contains('is-mobile')
            || (typeof window !== 'undefined' && window.innerWidth < 768);
    }

    shouldSkipMobileWarning() {
        try {
            return window.localStorage?.getItem(PLUGIN_MOBILE_WARNING_SKIP_KEY) === '1';
        } catch (error) {
            return false;
        }
    }

    setSkipMobileWarning(shouldSkip) {
        try {
            if (shouldSkip) {
                window.localStorage?.setItem(PLUGIN_MOBILE_WARNING_SKIP_KEY, '1');
            } else {
                window.localStorage?.removeItem(PLUGIN_MOBILE_WARNING_SKIP_KEY);
            }
        } catch (error) {
            // localStorage unavailable
        }
    }

    shouldShowMobileWarning() {
        return this.isMobileDevice() && !this.shouldSkipMobileWarning();
    }

    isMobileWarningOpen() {
        return !!this.mobileWarningModal && !this.mobileWarningModal.classList.contains('hidden');
    }

    async showMobileWarning() {
        if (!this.mobileWarningModal) return true;
        if (this.mobileWarningSkipCheckbox) {
            this.mobileWarningSkipCheckbox.checked = false;
        }
        this.mobileWarningModal.setAttribute('aria-hidden', 'false');
        this.mobileWarningModal.classList.remove('hidden');
        this.mobileWarningModal.classList.add('flex');
        void this.mobileWarningModal.offsetWidth;
        this.mobileWarningModal.classList.add('show-modal');
        setTimeout(() => this.mobileWarningProceedBtn?.focus(), 0);
        return new Promise((resolve) => {
            this.mobileWarningResolver = resolve;
        });
    }

    hideMobileWarning() {
        if (!this.mobileWarningModal) return Promise.resolve();
        this.mobileWarningModal.classList.remove('show-modal');

        // aria-hiddenを設定する前にフォーカスをモーダル外に移動する（WAI-ARIA準拠）
        if (this.mobileWarningModal.contains(document.activeElement)) {
            this.mobileWarningModal.querySelector('button')?.blur();
        }

        this.mobileWarningModal.setAttribute('aria-hidden', 'true');
        return new Promise((resolve) => {
            setTimeout(() => {
                this.mobileWarningModal?.classList.remove('flex');
                this.mobileWarningModal?.classList.add('hidden');
                resolve();
            }, 300);
        });
    }

    resolveMobileWarning(accepted) {
        if (!this.mobileWarningResolver) return;
        if (accepted) {
            this.setSkipMobileWarning(Boolean(this.mobileWarningSkipCheckbox?.checked));
        }
        const resolver = this.mobileWarningResolver;
        this.mobileWarningResolver = null;
        this.hideMobileWarning().then(() => resolver(accepted));
    }

    normalizeNewsItems(payload) {
        const rawItems = Array.isArray(payload)
            ? payload
            : (Array.isArray(payload?.news) ? payload.news : []);
        return rawItems
            .map((raw, index) => {
                if (!raw || typeof raw !== 'object') return null;
                const title = String(raw.title || '').trim();
                const content = String(raw.content || raw.message || '').trim();
                if (!title && !content) return null;
                const levelRaw = String(raw.level || raw.severity || 'info').toLowerCase();
                const level = ['info', 'warning', 'danger'].includes(levelRaw) ? levelRaw : 'info';
                const url = String(raw.url || raw.link || '').trim();
                const pluginTargets = Array.isArray(raw.plugins)
                    ? raw.plugins.map((item) => String(item || '').toLowerCase()).filter(Boolean)
                    : [];
                const id = String(raw.id || `news-${index}`);
                const dateText = String(raw.date || raw.created_at || '').trim();
                return {
                    id,
                    title,
                    content,
                    level,
                    url,
                    dateText,
                    pluginTargets,
                };
            })
            .filter(Boolean);
    }

    async ensureNewsLoaded(force = false) {
        const cacheAge = Date.now() - this.newsFetchedAt;
        const hasFreshCache = this.newsFetchState === 'ready' && cacheAge < 5 * 60 * 1000;
        if (!force && (this.newsFetchState === 'loading' || hasFreshCache)) return;

        this.newsFetchState = 'loading';
        this.newsFetchError = '';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), PLUGIN_NEWS_FETCH_TIMEOUT_MS);

        try {
            const response = await fetch(PLUGIN_NEWS_FEED_URL, {
                method: 'GET',
                signal: controller.signal,
                cache: 'no-store',
            });
            if (!response.ok) throw new Error(`HTTP_${response.status}`);
            const rawText = await response.text();
            const payload = this.parseNewsPayload(rawText);
            this.newsItems = this.normalizeNewsItems(payload);
            this.newsFetchState = 'ready';
            this.newsFetchedAt = Date.now();
        } catch (error) {
            this.newsItems = [];
            this.newsFetchState = 'error';
            this.newsFetchError = String(error?.message || 'failed');
        } finally {
            clearTimeout(timeoutId);
        }
    }

    parseNewsPayload(rawText) {
        const source = String(rawText || '').trim();
        if (!source) return [];

        try {
            return JSON.parse(source);
        } catch (error) {
            // Tolerate common hand-edited JSON mistakes: missing comma between objects in arrays.
            const repaired = source
                .replace(/^\uFEFF/, '')
                .replace(/\}\s*\{/g, '},{');
            return JSON.parse(repaired);
        }
    }

    getNewsItemsForPlugin(plugin) {
        const pluginKeys = new Set([
            String(plugin?.id || '').toLowerCase(),
            String(plugin?.name || '').toLowerCase(),
            String(plugin?.fullName || '').toLowerCase(),
        ].filter(Boolean));
        return this.newsItems.filter((item) => {
            if (!Array.isArray(item.pluginTargets) || !item.pluginTargets.length) return true;
            return item.pluginTargets.some((target) => pluginKeys.has(String(target || '').toLowerCase()));
        });
    }

    renderNewsPanelHtml(plugin) {
        const levelClassMap = {
            info: 'border-blue-200 bg-blue-50/70 text-blue-900 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-100',
            warning: 'border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100',
            danger: 'border-red-200 bg-red-50/80 text-red-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-100',
        };

        if (this.newsFetchState === 'loading' || this.newsFetchState === 'idle') {
            return `
                <div class="mb-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 p-4">
                    <div class="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">News</div>
                    <div class="mt-2 text-sm text-slate-500 dark:text-slate-400">ニュースを取得中...</div>
                </div>
            `;
        }

        if (this.newsFetchState === 'error') {
            return `
                <div class="mb-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 p-4">
                    <div class="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">News</div>
                    <div class="mt-2 text-sm text-slate-500 dark:text-slate-400">ニュースを読み込めませんでした。</div>
                </div>
            `;
        }

        const items = this.getNewsItemsForPlugin(plugin).slice(0, 1);
        if (!items.length) {
            return `
                <div class="mb-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 p-4">
                    <div class="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">News</div>
                    <div class="mt-2 text-sm text-slate-500 dark:text-slate-400">現在表示できるニュースはありません。</div>
                </div>
            `;
        }

        const cards = items.map((item) => {
            const toneClasses = levelClassMap[item.level] || levelClassMap.info;
            const title = this.escapeHtml(item.title || 'お知らせ');
            const content = this.escapeHtml(item.content || '');
            const dateText = this.escapeHtml(item.dateText || '');
            const link = item.url
                ? `<a href="${this.escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="mt-2 inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2">詳細</a>`
                : '';
            const dateBadge = dateText
                ? `<span class="text-[10px] font-semibold opacity-80">${dateText}</span>`
                : '';
            return `
                <article class="rounded-lg border p-3 ${toneClasses}">
                    <div class="flex items-center justify-between gap-2">
                        <div class="text-sm font-bold">${title}</div>
                        ${dateBadge}
                    </div>
                    ${content ? `<p class="mt-1 text-xs leading-relaxed opacity-90 whitespace-pre-wrap">${content}</p>` : ''}
                    ${link}
                </article>
            `;
        }).join('');

        return `
            <div class="mb-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 p-4">
                <div class="mb-3 flex items-center justify-between gap-2">
                    <div class="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Plugin News</div>
                    <button id="pluginNewsRefreshBtn" type="button" class="text-xs font-semibold text-indigo-600 dark:text-indigo-300 hover:underline">更新</button>
                </div>
                <div class="space-y-2">${cards}</div>
            </div>
        `;
    }

    bindNewsPanelEvents(plugin) {
        const refreshBtn = document.getElementById('pluginNewsRefreshBtn');
        if (!refreshBtn) return;
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            refreshBtn.textContent = '更新中...';
            await this.ensureNewsLoaded(true);
            const panel = document.getElementById('pluginNewsPanel');
            if (panel) panel.innerHTML = this.renderNewsPanelHtml(plugin);
            this.bindNewsPanelEvents(plugin);
        });
    }

    async renderMarketplace() {
        this.pluginList.innerHTML = '';
        const installed = this.pluginManager.getRegistry();
        const filter = this.parseQuery(this.searchQuery);
        const filteredInstalled = installed.filter((plugin) => this.matchesPluginFilter(plugin, filter));
        const installedRepoKeys = new Set(installed.map((plugin) => this.getPluginRepoKey(plugin)).filter(Boolean));

        if (filteredInstalled.length > 0) {
            const header = document.createElement('div');
            header.className = 'px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider';
            header.textContent = 'インストール済み';
            this.pluginList.appendChild(header);

            filteredInstalled.forEach(plugin => {
                this.addPluginItem(plugin, true);
            });
        }

        // 2. GitHub Marketplace (トピック表示)
        if (!this.isOnlyInstalled) {
            const header = document.createElement('div');
            header.className = 'px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 flex justify-between items-center';
            header.innerHTML = '<span>注目のコミュニティプラグイン (GitHub Topic)</span><span class="animate-pulse">GitHubから取得中...</span>';
            this.pluginList.appendChild(header);

            const results = await this.pluginManager.searchGitHubPlugins();
            this.githubResults = results;
            if (filter.tags.length > 0 || filter.text.length > 0) {
                await this.enrichGitHubPluginsWithManifestTags(results);
            } else {
                void this.enrichGitHubPluginsWithManifestTags(results);
            }
            const filteredResults = results.filter((plugin) => this.matchesPluginFilter(plugin, filter));

            const statusSpan = header.querySelector('span:last-child');
            if (statusSpan) statusSpan.remove();

            if (filteredResults.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'px-3 py-4 text-center text-xs text-slate-400';
                empty.textContent = this.searchQuery ? '該当するプラグインが見つかりません' : '注目のプラグインがありません';
                this.pluginList.appendChild(empty);
            } else {
                const renderedRepoKeys = new Set();
                filteredResults.forEach(async plugin => {
                    const repoKey = this.getPluginRepoKey(plugin);
                    // すでにインストール済みのもの、または同一結果の重複は表示しない
                    if (repoKey && (installedRepoKeys.has(repoKey) || renderedRepoKeys.has(repoKey))) return;
                    if (repoKey) renderedRepoKeys.add(repoKey);

                    const item = this.addPluginItem(plugin, false);
                    if (!item?.isConnected) return;

                    // 非同期でマニフェストを確認して使用不可バッジを付与
                    try {
                        if (!item.isConnected) return;
                        const skipManifestFetch = await this.pluginManager.isInExternalManifestList(plugin.fullName);
                        if (!item.isConnected) return;
                        const manifest = skipManifestFetch ? null : await this.pluginManager.getManifestFromGitHub(plugin.fullName, plugin.defaultBranch);
                        if (!item.isConnected) return;
                        if (manifest?.author) {
                            plugin.author = String(manifest.author);
                            const authorEl = item.querySelector('[data-plugin-author]');
                            if (authorEl) authorEl.textContent = plugin.author;
                        }
                        if (manifest && Object.prototype.hasOwnProperty.call(manifest, 'icon')) {
                            plugin.icon = manifest.icon;
                        }
                        const iconSlot = item.querySelector('[data-plugin-icon-slot]');
                        if (iconSlot) {
                            iconSlot.outerHTML = this.getPluginIconHtml(plugin, false);
                        }
                        const validation = skipManifestFetch
                            ? { valid: true }
                            : (manifest ? this.pluginManager.validateManifest(manifest) : { valid: false, missing: ['manifest.jsonが見つかりません'] });

                        if (!validation.valid) {
                            if (!item.isConnected) return;
                            const nameEl = item.querySelector('.font-bold');
                            if (nameEl && !nameEl.innerHTML.includes('不可')) {
                                const reason = validation.missing ? `必須項目が不足しています: ${validation.missing.join(', ')}` : '必須項目が不足しています。';
                                const badge = document.createElement('span');
                                badge.className = 'ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-400 text-white leading-none cursor-help';
                                badge.title = reason;
                                badge.textContent = '不可';
                                nameEl.appendChild(badge);
                            }
                        }

                        const hasDeps = manifest && ((manifest.pipInstall && manifest.pipInstall.length > 0) || (manifest.externalPackages && manifest.externalPackages.length > 0));
                        if (hasDeps) {
                            if (!item.isConnected) return;
                            const nameEl = item.querySelector('.font-bold');
                            if (nameEl && !nameEl.innerHTML.includes('追加')) {
                                const badge = document.createElement('span');
                                badge.className = 'ml-1 text-[10px] px-1.5 py-0.5 rounded bg-orange-500 text-white leading-none';
                                badge.textContent = '追加';
                                nameEl.appendChild(badge);
                            }
                        }
                    } catch (e) {
                        // レート制限などのエラーは無視
                    }
                });
            }
        }
        lucide.createIcons();
    }

    addPluginItem(plugin, isInstalled) {
        const isEnabled = isInstalled && this.pluginManager.isPluginEnabled(plugin.id);
        const item = document.createElement('div');
        item.className = `p-3 rounded-lg cursor-pointer transition-colors ${isEnabled ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`;
        const pluginKey = this.getPluginSelectionKey(plugin, isInstalled);
        item.dataset.pluginKey = pluginKey;
        if (pluginKey && pluginKey === this.currentDetailPluginKey) {
            item.classList.add('ring-2', 'ring-indigo-500/60', 'dark:ring-indigo-400/60');
        }

        const level = plugin.trustLevel?.level ?? plugin.trustLevel;

        const badges = [];
        const isOfficial = plugin.author === 'EDBPlugin' || level === 'official';
        if (isOfficial) badges.push('<span class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-500 text-white leading-none">公式</span>');
        if (level === 'certified') badges.push('<span class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-green-500 text-white leading-none">公認</span>');
        if (level === 'danger') {
            const reason = plugin.trustLevel?.reason ?? '危険性が報告されています。';
            badges.push(`<span class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-red-500 text-white leading-none cursor-help" title="危険の理由: ${this.escapeHtml(reason)}">危険</span>`);
        }

        // 不可バッジ (独立判定)
        const isInvalid = level === 'invalid' || plugin.trustLevel?.invalid;
        const validation = isInstalled ? this.pluginManager.validateManifest(plugin) : { valid: !isInvalid };
        if (!validation.valid || isInvalid) {
            const reason = validation.missing ? `必須項目が不足しています: ${validation.missing.join(', ')}` : (plugin.trustLevel?.invalidReason || plugin.trustLevel?.reason || '必須項目が不足しています。');
            badges.push(`<span class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-400 text-white leading-none cursor-help" title="${this.escapeHtml(reason)}">不可</span>`);
        }

        const trustBadge = badges.join('');

        // アイコンの処理
        const iconHtml = this.getPluginIconHtml(plugin, isInstalled);

        item.innerHTML = `
            <div class="flex gap-3 items-center">
                ${iconHtml}
                <div class="flex-grow min-w-0">
                    <div class="flex justify-between items-start">
                        <div class="font-bold text-sm text-slate-900 dark:text-white flex flex-wrap items-center gap-y-1">
                            <span class="break-words">${this.escapeHtml(plugin.name)}</span>${trustBadge}
                        </div>
                        ${isEnabled ? '<div class="w-2 h-2 rounded-full bg-indigo-500 mt-1.5 ml-1 shrink-0"></div>' : ''}
                        ${!isInstalled ? '<i data-lucide="download-cloud" class="w-3.5 h-3.5 text-slate-300 ml-1 shrink-0"></i>' : ''}
                    </div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">開発者: <span data-plugin-author>${this.escapeHtml(String(plugin.author || ''))}</span></div>
                </div>
            </div>
        `;
        if (isInstalled && plugin.installedFrom === 1) {
            const content = item.querySelector('.flex-grow.min-w-0');
            if (content) {
                const badgeWrap = document.createElement('div');
                badgeWrap.className = 'mt-1';
                badgeWrap.innerHTML = '<span data-update-badge class="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">checking...</span>';
                content.appendChild(badgeWrap);
            }
        }
        item.addEventListener('click', () => {
            if (this.currentDetailPluginKey && this.currentDetailPluginKey === pluginKey) {
                this.showEmptyDetail();
                return;
            }
            if (isInstalled) {
                this.showDetail(plugin);
            } else {
                this.showGitHubDetail(plugin);
            }
        });
        this.pluginList.appendChild(item);
        if (isInstalled) {
            void this.refreshInstalledUpdateBadge(plugin, item, pluginKey);
        }
        return item;
    }

    getPluginIconUrl(plugin, isInstalled) {
        const rawIcon = String(plugin?.icon || '').trim();
        if (!rawIcon) {
            const avatarOwner = this.getAvatarOwner(plugin, isInstalled);
            if (avatarOwner) {
                return `https://github.com/${encodeURIComponent(avatarOwner)}.png?size=64`;
            }
            return '';
        }
        if (/^(https?:\/\/|data:image\/)/i.test(rawIcon)) return rawIcon;

        // Marketplace items can specify icons as relative paths in manifest.json.
        if (!isInstalled && plugin?.fullName) {
            // Keep emoji/character icons as text; only treat path-like values as files.
            const looksLikePath = rawIcon.includes('/') || rawIcon.includes('.');
            if (!looksLikePath) return '';
            const branch = String(plugin?.defaultBranch || 'main').trim() || 'main';
            const cleanPath = rawIcon.replace(/^\.?\//, '');
            if (cleanPath) {
                const encodedPath = cleanPath
                    .split('/')
                    .filter(Boolean)
                    .map((segment) => encodeURIComponent(segment))
                    .join('/');
                return `https://raw.githubusercontent.com/${plugin.fullName}/${encodeURIComponent(branch)}/${encodedPath}`;
            }
        }

        return '';
    }

    getAvatarOwner(plugin, isInstalled) {
        if (!plugin) return '';
        if (!isInstalled && plugin?.fullName && String(plugin.fullName).includes('/')) {
            return String(plugin.fullName).split('/')[0];
        }
        const repoInfo = this.pluginManager.parseGitHubUrl(plugin.source || plugin.repo || '');
        if (repoInfo?.fullName && String(repoInfo.fullName).includes('/')) {
            return String(repoInfo.fullName).split('/')[0];
        }
        return String(plugin?.author || '').trim();
    }

    getPluginIconHtml(plugin, isInstalled) {
        const resolvedIconUrl = this.getPluginIconUrl(plugin, isInstalled);
        if (resolvedIconUrl) {
            const escapedUrl = this.escapeHtml(resolvedIconUrl);
            const escapedAlt = this.escapeHtml(String(plugin?.name || 'plugin icon'));
            return `<div data-plugin-icon-slot class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-lg shrink-0 overflow-hidden"><img src="${escapedUrl}" alt="${escapedAlt}" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><span style="display:none;" class="w-full h-full items-center justify-center text-slate-400">🧩</span></div>`;
        }

        const iconText = String(plugin?.icon || '').trim();
        if (iconText) {
            return `<div data-plugin-icon-slot class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-lg shrink-0 overflow-hidden"><span>${this.escapeHtml(iconText)}</span></div>`;
        }

        return '<div data-plugin-icon-slot class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-lg shrink-0 overflow-hidden"><i data-lucide="puzzle" class="w-4 h-4 text-slate-400"></i></div>';
    }

    getInstalledUpdateCacheKey(plugin, fullName) {
        return [
            plugin?.id || '',
            plugin?.version || '',
            plugin?.installRef || 'main',
            fullName || ''
        ].join('::');
    }

    applyInstalledUpdateBadge(item, pluginKey, status) {
        if (!item?.isConnected) return;
        if (item.dataset.pluginKey !== pluginKey) return;
        const badge = item.querySelector('[data-update-badge]');
        if (!badge) return;

        if (!status?.hasUpdate) {
            badge.parentElement?.remove();
            return;
        }

        badge.className = 'inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300';
        badge.textContent = 'update';
        badge.title = status?.title || 'Update available';
    }

    async refreshInstalledUpdateBadge(plugin, item, pluginKey) {
        if (!plugin || plugin.installedFrom !== 1) return;
        const repoInfo = this.pluginManager.parseGitHubUrl(plugin.source || plugin.repo || '');
        if (!repoInfo?.fullName) return;

        const cacheKey = this.getInstalledUpdateCacheKey(plugin, repoInfo.fullName);
        const now = Date.now();
        const cached = this.updateCheckCache.get(cacheKey);
        if (cached && (now - cached.checkedAt) < this.updateCheckTtlMs) {
            this.applyInstalledUpdateBadge(item, pluginKey, cached);
            return;
        }

        try {
            const updateContext = await this.resolveUpdateContext(repoInfo.fullName, plugin);
            const hasUpdate = Boolean(updateContext?.hasUpdate);
            const latestVersion = updateContext?.latestVersion || null;
            const title = updateContext?.branchMissing
                ? `branch missing: ${updateContext?.targetRef || 'unknown'}`
                : updateContext?.installChannel === 'branch'
                    ? `branch: ${updateContext.targetRef} / latest: ${String(updateContext?.latestCommitSha || '').slice(0, 7) || 'unknown'}`
                    : `release: ${String(plugin?.installReleaseTag || plugin?.installRef || 'unknown')} -> ${updateContext?.targetRef || 'unknown'}`;
            const status = {
                hasUpdate,
                title: latestVersion ? `current: ${plugin.version} / latest: ${latestVersion}` : title,
                checkedAt: now
            };
            this.updateCheckCache.set(cacheKey, status);
            this.applyInstalledUpdateBadge(item, pluginKey, status);
        } catch (error) {
            const status = { hasUpdate: false, checkedAt: now };
            this.updateCheckCache.set(cacheKey, status);
            this.applyInstalledUpdateBadge(item, pluginKey, status);
        }
    }

    async showGitHubDetail(plugin) {
        this.currentDetailPluginKey = this.getPluginSelectionKey(plugin, false);
        this.updateSidebarSelectionState();
        this.pluginDetailEmpty.classList.add('hidden');
        this.pluginDetailContent.classList.remove('hidden');
        this.pluginDetailContent.innerHTML = '<div class="p-8 text-center text-slate-500">GitHubから情報を取得中...</div>';

        const isMock = plugin.id && plugin.id.startsWith('test-');
        let readme = 'READMEが見つかりませんでした。';
        let releases = [];
        let branches = [];
        let showReadmeAd = false;
        let fetchedManifest = null;
        let isRateLimited = false;
        if (!isMock) {
            try {
                // タイムアウト付きのフェッチ (5秒)
                const fetchWithTimeout = async (promise, timeout = 5000) => {
                    return Promise.race([
                        promise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
                    ]);
                };

                const safeFetch = async (promise, fallback = null) => {
                    try {
                        return await promise;
                    } catch (e) {
                        if (e.message?.includes('rate limit')) isRateLimited = true;
                        console.warn('Silent fetch error:', e);
                        return fallback;
                    }
                };

                const results = await fetchWithTimeout(Promise.all([
                    safeFetch(this.pluginManager.getREADME(plugin.fullName, plugin.defaultBranch), 'READMEが見つかりませんでした。'),
                    safeFetch(this.pluginManager.getReleases(plugin.fullName), []),
                    safeFetch(this.pluginManager.getBranches(plugin.fullName), []),
                    safeFetch(this.pluginManager.hasExternalDocOverride(plugin.fullName), false),
                    safeFetch(this.pluginManager.getManifestFromGitHub(plugin.fullName, plugin.defaultBranch), null)
                ]), 10000); // 全体で10秒制限

                readme = results[0] || 'READMEが見つかりませんでした。';
                releases = results[1] || [];
                branches = results[2] || [];
                showReadmeAd = results[3];
                fetchedManifest = results[4];
            } catch (err) {
                if (err.message?.includes('rate limit')) isRateLimited = true;
                console.error('Failed to fetch GitHub info or timed out', err);
            }
        } else {
            readme = plugin.description || 'テスト用プラグインのデモページです。';
        }

        const level = plugin.trustLevel?.level ?? plugin.trustLevel;
        const badges = [];
        if (plugin.author === 'EDBPlugin' || level === 'official') {
            badges.push('<span class="text-[10px] px-2 py-1 rounded bg-blue-500 text-white font-bold leading-none shrink-0">公式プラグイン</span>');
        }
        if (level === 'certified') {
            badges.push('<span class="text-[10px] px-2 py-1 rounded bg-green-500 text-white font-bold leading-none shrink-0">公認プラグイン</span>');
        }
        if (level === 'danger') {
            badges.push('<span class="text-[10px] px-2 py-1 rounded bg-red-500 text-white font-bold leading-none shrink-0">危険なプラグイン</span>');
        }

        const dangerReason = level === 'danger' ? (plugin.trustLevel?.reason || '悪意のあるコードが含まれているか、重大なセキュリティリスクがある可能性があるため、インストールは推奨されません。') : '';

        const dangerWarning = level === 'danger' ? `
            <div class="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-start gap-3">
                <i data-lucide="alert-triangle" class="w-5 h-5 text-red-500 shrink-0 mt-0.5"></i>
                <div class="text-sm">
                    <div class="font-bold text-red-600 dark:text-red-400">警告: このプラグインはブラックリストに登録されています</div>
                    <div class="text-red-500/80 dark:text-red-400/80 mt-1">理由: ${this.escapeHtml(dangerReason)}</div>
                </div>
            </div>
        ` : '';

        const rateLimitWarning = isRateLimited ? `
            <div class="mb-6 p-4 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 flex items-start gap-3">
                <i data-lucide="alert-circle" class="w-5 h-5 text-orange-500 shrink-0 mt-0.5"></i>
                <div class="text-sm">
                    <div class="font-bold text-orange-600 dark:text-orange-400">GitHub API レート制限</div>
                    <div class="text-orange-500/80 dark:text-orange-400/80 mt-1">リクエスト回数が上限に達したため、リリースやブランチ情報の一部が表示できません。しばらくしてから再度お試しください。</div>
                </div>
            </div>
        ` : '';

        // マニフェスト取得とバリデーション
        let validation = { valid: true };
        const manifest = fetchedManifest;
        if (manifest) {
            validation = this.pluginManager.validateManifest(manifest);
        } else if (!isMock) {
            validation = { valid: false, missing: ['manifest.jsonが見つかりません'] };
        }

        if (!validation.valid) {
            badges.push('<span class="text-[10px] px-2 py-1 rounded bg-slate-400 text-white font-bold leading-none shrink-0">使用不可のプラグイン</span>');
        }

        // マニフェストから正確な依存関係を再確認
        let hasDependencies = (plugin.pipInstall && plugin.pipInstall.length > 0) || (plugin.externalPackages && plugin.externalPackages.length > 0);
        const realManifest = fetchedManifest;
        if (realManifest) {
            const reallyHasDeps = (realManifest.pipInstall && realManifest.pipInstall.length > 0) || (realManifest.externalPackages && realManifest.externalPackages.length > 0);
            if (reallyHasDeps && !hasDependencies) {
                hasDependencies = true;
                badges.push('<span class="text-[10px] px-2 py-1 rounded bg-orange-500 text-white font-bold leading-none shrink-0">追加ライブラリ</span>');
                // 一部のフィールドをマニフェストから補完
                plugin.pipInstall = realManifest.pipInstall;
                plugin.externalPackages = realManifest.externalPackages;
            }
        }

        const displayAuthor = String((fetchedManifest && fetchedManifest.author) || plugin.author || '');
        const trustBadge = badges.join(' ');
        const branchOptions = branches
            .filter((branchName) => branchName && branchName !== plugin.defaultBranch)
            .map((branchName) => `<option value="branch:${this.escapeHtml(branchName)}">Branch: ${this.escapeHtml(branchName)}</option>`)
            .join('');

        const invalidWarning = !validation.valid ? `
            <div class="mb-6 p-4 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-start gap-3">
                <i data-lucide="slash" class="w-5 h-5 text-slate-500 shrink-0 mt-0.5"></i>
                <div class="text-sm">
                    <div class="font-bold text-slate-700 dark:text-slate-200">このプラグインは使用できません</div>
                    <div class="text-slate-500 dark:text-slate-400 mt-1">理由: 必須項目（${this.escapeHtml(validation.missing.join(', '))}）がマニフェストに含まれていません。</div>
                </div>
            </div>
        ` : '';

        const dependencyWarning = '';

        this.pluginDetailContent.innerHTML = `
            <div id="pluginNewsPanel">${this.renderNewsPanelHtml(plugin)}</div>
            ${rateLimitWarning}
            ${dangerWarning}
            ${invalidWarning}
            ${dependencyWarning}
            <div class="flex flex-col mb-6">
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <h1 class="text-3xl font-bold text-slate-900 dark:text-white flex flex-wrap items-center gap-3">${this.escapeHtml(plugin.name)} ${trustBadge}</h1>
                        <div class="flex flex-wrap items-center gap-4 mt-2 text-sm text-slate-500 dark:text-slate-400">
                            <span class="flex items-center gap-1"><i data-lucide="user" class="w-3.5 h-3.5"></i> 開発者: ${this.escapeHtml(displayAuthor)}</span>
                            <span class="flex items-center gap-1"><i data-lucide="star" class="w-3.5 h-3.5"></i> ${Number(plugin.stars) || 0} Stars</span>
                        </div>
                    </div>
                    <div class="text-sm text-indigo-500 dark:text-indigo-400">
                        <a href="${this.safeExternalUrl(plugin.repo)}" target="_blank" rel="noopener noreferrer" class="hover:underline flex items-center gap-1">
                            <i data-lucide="github" class="w-3.5 h-3.5"></i> GitHub
                        </a>
                    </div>
                </div>

                <!-- インストール設定 UI -->
                <div class="bg-slate-50 dark:bg-slate-950/20 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">バージョン (リリース)</label>
                            <select id="ghVersionSelect" class="w-full pl-3 pr-10 py-2.5 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem_1.25rem] bg-[right_0.5rem_center] bg-no-repeat transition-all">
                                <option value="default">デフォルト (${this.escapeHtml(plugin.defaultBranch)})</option>
                                ${branchOptions}
                                ${releases.map(r => `<option value="release:${this.escapeHtml(r.tag_name)}">${this.escapeHtml(r.tag_name)} ${r.prerelease ? '(Pre-release)' : ''}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">ファイル (Zip)</label>
                            <select id="ghFileSelect" class="w-full pl-3 pr-10 py-2.5 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem_1.25rem] bg-[right_0.5rem_center] bg-no-repeat transition-all">
                                <option value="default-zip">Source code (zip)</option>
                            </select>
                        </div>
                    </div>
                    <button id="installFromGhBtn" ${!validation.valid ? 'disabled' : ''} class="w-full py-3 rounded-lg font-bold ${!validation.valid ? 'bg-slate-300 dark:bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/20'} active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                        <i data-lucide="${!validation.valid ? 'lock' : 'download'}" class="w-5 h-5"></i> <span>${!validation.valid ? 'インストール不可' : 'インストールを実行'}</span>
                    </button>
                </div>
            </div>
            
            <div class="prose dark:prose-invert max-w-none border-t border-slate-100 dark:border-slate-800 pt-6">
                <div class="bg-slate-50 dark:bg-slate-950/50 rounded-xl p-6 border border-slate-100 dark:border-slate-800 font-sans text-sm leading-relaxed">
                    <div class="readme-content prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-h1:font-bold prose-h2:font-bold">${this.renderMarkdown(readme)}</div>
                    ${showReadmeAd ? this.getReadmeAdHtml() : ''}
                </div>
            </div>
        `;
        lucide.createIcons();
        this.initReadmeAds(this.pluginDetailContent);
        this.bindNewsPanelEvents(plugin);
        void this.ensureNewsLoaded().then(() => {
            const panel = document.getElementById('pluginNewsPanel');
            if (!panel) return;
            panel.innerHTML = this.renderNewsPanelHtml(plugin);
            this.bindNewsPanelEvents(plugin);
        });

        const versionSelect = document.getElementById('ghVersionSelect');
        const fileSelect = document.getElementById('ghFileSelect');
        const installBtn = document.getElementById('installFromGhBtn');

        const updateFiles = () => {
            const selectedRef = String(versionSelect.value || '');
            fileSelect.innerHTML = '';

            if (selectedRef === 'default' || selectedRef.startsWith('branch:')) {
                fileSelect.innerHTML = '<option value="default-zip">Source code (zip)</option>';
            } else {
                const releaseTag = selectedRef.startsWith('release:') ? selectedRef.substring(8) : selectedRef;
                const release = releases.find(r => r.tag_name === releaseTag);
                if (release) {
                    // ZIPアセットのみ抽出 (tar.gzは除外)
                    const assets = release.assets.filter(a => a.name.toLowerCase().endsWith('.zip'));
                    assets.forEach(a => {
                        const option = document.createElement('option');
                        option.value = a.browser_download_url;
                        option.textContent = a.name;
                        fileSelect.appendChild(option);
                    });

                    // Source code (zip) を最後に追加
                    const sourceZip = document.createElement('option');
                    sourceZip.value = release.zipball_url;
                    sourceZip.textContent = 'Source code (zip)';
                    fileSelect.appendChild(sourceZip);
                }
            }
        };

        versionSelect.addEventListener('change', updateFiles);
        updateFiles();

        installBtn.addEventListener('click', async () => {
            let zipUrl = fileSelect.value;
            if (zipUrl === 'default-zip') {
                const selectedRef = String(versionSelect.value || '');
                if (selectedRef.startsWith('branch:')) {
                    zipUrl = selectedRef.substring(7) || plugin.defaultBranch;
                } else {
                    zipUrl = plugin.defaultBranch;
                }
            }

            installBtn.disabled = true;
            const originalContent = installBtn.innerHTML;
            installBtn.innerHTML = '<i class="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></i> <span>インストール中...</span>';

            try {
                if (isMock) {
                    // モックプラグインのインストール擬似処理
                    const mockManifest = {
                        ...plugin,
                        installedFrom: 0, // 0: local (擬似的に)
                        updateDate: new Date().toISOString().split('T')[0],
                        trustLevel: plugin.trustLevel
                    };
                    delete mockManifest.stars;

                    this.pluginManager.installedPlugins[plugin.id] = mockManifest;
                    this.pluginManager.saveInstalledPlugins();

                    this.renderMarketplace();
                    this.showDetail(mockManifest);
                    this.showSideSuccess('テスト用プラグインを擬似インストールしました！');
                    return;
                }

                // 危険なプラグインのチェック
                const level = plugin.trustLevel?.level ?? plugin.trustLevel;
                if (level === 'danger') {
                    const agreed = await this.confirmDangerousInstall(plugin.name, plugin.trustLevel?.reason);
                    if (!agreed) {
                        installBtn.disabled = false;
                        installBtn.innerHTML = originalContent;
                        lucide.createIcons();
                        return;
                    }
                }

                const manifest = await this.pluginManager.installFromGitHub(plugin.fullName, zipUrl);
                this.renderMarketplace();
                this.showDetail(manifest);
                this.showSideSuccess('インストールが完了しました！');
            } catch (err) {
                this.showSideError('インストールに失敗しました: ' + err.message);
                installBtn.disabled = false;
                installBtn.innerHTML = originalContent;
                lucide.createIcons();
            }
        });
    }

    showDetail(plugin) {
        this.currentDetailPluginKey = this.getPluginSelectionKey(plugin, true);
        this.updateSidebarSelectionState();
        this.pluginDetailEmpty.classList.add('hidden');
        this.pluginDetailContent.classList.remove('hidden');

        const isEnabled = this.pluginManager.isPluginEnabled(plugin.id);
        const isBuiltin = plugin.id === 'vanilla-plugin';
        const repoInfo = this.pluginManager.parseGitHubUrl(plugin.source || plugin.repo || '');

        const level = plugin.trustLevel?.level ?? plugin.trustLevel;
        const badges = [];
        if (plugin.author === 'EDBPlugin' || level === 'official') {
            badges.push('<span class="text-[10px] px-2 py-1 rounded bg-blue-500 text-white font-bold leading-none shrink-0">公式プラグイン</span>');
        }
        if (level === 'certified') {
            badges.push('<span class="text-[10px] px-2 py-1 rounded bg-green-500 text-white font-bold leading-none shrink-0">公認プラグイン</span>');
        }
        if (level === 'danger') {
            badges.push('<span class="text-[10px] px-2 py-1 rounded bg-red-500 text-white font-bold leading-none shrink-0">危険なプラグイン</span>');
        }
        let hasDependencies = (plugin.pipInstall && plugin.pipInstall.length > 0) || (plugin.externalPackages && plugin.externalPackages.length > 0);
        if (hasDependencies) {
            badges.push('<span class="text-[10px] px-2 py-1 rounded bg-orange-500 text-white font-bold leading-none shrink-0">追加ライブラリ</span>');
        }


        // 使用不可バッジ (独立判定)
        const isInvalid = level === 'invalid' || plugin.trustLevel?.invalid;
        const validation = this.pluginManager.validateManifest(plugin);
        const invalidReason = !validation.valid ? `必須項目が不足しています: ${validation.missing.join(', ')}` : (plugin.trustLevel?.invalidReason || '');

        if (!validation.valid || isInvalid) {
            badges.push('<span class="text-[10px] px-2 py-1 rounded bg-slate-400 text-white font-bold leading-none shrink-0">使用不可のプラグイン</span>');
        }

        const trustBadge = badges.join(' ');


        const dangerReason = level === 'danger' ? (plugin.trustLevel?.reason || 'このプラグインの使用は推奨されません。速やかにアンインストールすることを検討してください。') : '';

        const dangerWarning = level === 'danger' ? `
            <div class="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-start gap-3">
                <i data-lucide="alert-triangle" class="w-5 h-5 text-red-500 shrink-0 mt-0.5"></i>
                <div class="text-sm">
                    <div class="font-bold text-red-600 dark:text-red-400">警告: このプラグインはブラックリストに登録されています</div>
                    <div class="text-red-500/80 dark:text-red-400/80 mt-1">理由: ${this.escapeHtml(dangerReason)}</div>
                </div>
            </div>
        ` : '';

        const rateLimitWarning = '';
        const dependencyWarning = '';

        const invalidWarning = (!validation.valid || isInvalid) ? `
            <div class="mb-6 p-4 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-start gap-3">
                <i data-lucide="slash" class="w-5 h-5 text-slate-500 shrink-0 mt-0.5"></i>
                <div class="text-sm">
                    <div class="font-bold text-slate-700 dark:text-slate-200">このプラグインは使用できません</div>
                    <div class="text-slate-500 dark:text-slate-400 mt-1">理由: ${this.escapeHtml(invalidReason)}</div>
                </div>
            </div>
        ` : '';

        const sourceUrl = this.safeExternalUrl(plugin.source || plugin.repo || '');

        this.pluginDetailContent.innerHTML = `
            <div id="pluginNewsPanel">${this.renderNewsPanelHtml(plugin)}</div>
            ${rateLimitWarning}
            ${dangerWarning}
            ${invalidWarning}
            ${dependencyWarning}
            <div class="flex justify-between items-start mb-6">
                <div class="min-w-0 flex-grow">
                    <h1 class="text-3xl font-bold text-slate-900 dark:text-white flex flex-wrap items-center gap-3 break-words">${this.escapeHtml(plugin.name)} ${trustBadge}</h1>
                    <div class="flex flex-wrap items-center gap-4 mt-2 text-sm text-slate-500 dark:text-slate-400">
                        <span class="flex items-center gap-1"><i data-lucide="user" class="w-3.5 h-3.5"></i> 開発者: ${this.escapeHtml(plugin.author)}</span>
                        <span class="flex items-center gap-1"><i data-lucide="tag" class="w-3.5 h-3.5"></i> バージョン: ${this.escapeHtml(plugin.version)}</span>
                    </div>
                    <div class="mt-1 text-xs font-mono text-slate-400">UUID: ${this.escapeHtml(plugin.uuid)}</div>
                    <div class="mt-2 flex gap-2 items-center">
                        ${sourceUrl ? `
                        <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer" class="text-xs text-indigo-500 hover:underline flex items-center gap-1">
                            <i data-lucide="github" class="w-3 h-3"></i> リポジトリ
                        </a>` : ''}
                        <span class="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
                            Source: ${plugin.installedFrom === 1 ? 'GitHub' : 'Local ZIP'}
                        </span>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button id="sharePluginBtn" class="p-2 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:text-slate-400 dark:hover:text-indigo-400 dark:hover:bg-indigo-900/20 transition-all" title="共有・エクスポート">
                        <i data-lucide="share-2" class="w-5 h-5"></i>
                    </button>
                    <span id="pluginUpdateBtnSlot"></span>
                    <button id="togglePluginBtn" ${(!validation.valid || isInvalid) ? 'disabled' : ''} class="flex items-center justify-center gap-2 px-6 py-2 rounded-lg font-bold ${(!validation.valid || isInvalid) ? 'bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:text-slate-600' : isEnabled ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200' : 'bg-indigo-600 text-white hover:bg-indigo-700'} transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                        <span class="btn-text">${(!validation.valid || isInvalid) ? '使用不可' : isEnabled ? '無効化' : '有効化'}</span>
                    </button>
                    ${!isBuiltin ? `
                    <button id="uninstallPluginBtn" class="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all" title="削除">
                        <i data-lucide="trash-2" class="w-5 h-5"></i>
                    </button>
                    ` : ''}
                </div>
            </div>
            
            <div class="prose dark:prose-invert max-w-none border-t border-slate-100 dark:border-slate-800 pt-6">
                <div id="readme-container" class="bg-slate-50 dark:bg-slate-950/50 rounded-xl p-6 border border-slate-100 dark:border-slate-800">
                    <div class="animate-pulse flex flex-col gap-3">
                        <div class="h-4 bg-slate-200 dark:bg-slate-800 rounded w-3/4"></div>
                        <div class="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/2"></div>
                        <div class="h-4 bg-slate-200 dark:bg-slate-800 rounded w-5/6"></div>
                    </div>
                </div>
            </div>
        `;
        lucide.createIcons();
        this.bindNewsPanelEvents(plugin);
        void this.ensureNewsLoaded().then(() => {
            const panel = document.getElementById('pluginNewsPanel');
            if (!panel) return;
            panel.innerHTML = this.renderNewsPanelHtml(plugin);
            this.bindNewsPanelEvents(plugin);
        });
        const shareBtn = document.getElementById('sharePluginBtn');
        if (shareBtn && shareBtn.parentElement) {
            const settingsBtn = document.createElement('button');
            settingsBtn.id = 'pluginSettingsBtn';
            settingsBtn.className = 'p-2 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:text-slate-400 dark:hover:text-indigo-400 dark:hover:bg-indigo-900/20 transition-all';
            settingsBtn.title = 'Settings';
            settingsBtn.innerHTML = '<i data-lucide="settings" class="w-5 h-5"></i>';
            shareBtn.parentElement.insertBefore(settingsBtn, shareBtn);
            settingsBtn.addEventListener('click', () => this.openSettingsModal(plugin.id));
            lucide.createIcons();
        }

        this.loadLocalREADME(plugin);

        void this.mountUpdateButtonIfNeeded(plugin, repoInfo);

        const toggleBtn = document.getElementById('togglePluginBtn');
        toggleBtn.addEventListener('click', async () => {
            if (toggleBtn.disabled) return;

            const btnText = toggleBtn.querySelector('.btn-text');
            const originalText = btnText.textContent;

            try {
                toggleBtn.disabled = true;
                btnText.textContent = '処理中...';

                // 現在の状態を再確認（クロージャ内のisEnabledは古い可能性があるため）
                const currentlyEnabled = this.pluginManager.isPluginEnabled(plugin.id);

                if (currentlyEnabled) {
                    await this.pluginManager.disablePlugin(plugin.id);
                } else {
                    await this.pluginManager.enablePlugin(plugin.id);
                }

                // リストの更新はバックグラウンドで（GitHub通信が含まれる可能性があるため待たない）
                this.renderMarketplace();

                // 詳細表示を即座に更新してレスポンスを良くする
                this.showDetail(plugin);
            } catch (error) {
                this.showSideError('プラグインの切り替えに失敗しました: ' + error.message);
                btnText.textContent = originalText;
                toggleBtn.disabled = false;
            }
        });

        document.getElementById('sharePluginBtn').addEventListener('click', async () => {
            const isSharable = this.pluginManager.isPluginSharable(plugin.id);

            if (isSharable) {
                // インストール用URLを生成
                const installUrl = this.pluginManager.getInstallUrl(plugin.id);
                if (installUrl) {
                    try {
                        await navigator.clipboard.writeText(installUrl);
                        this.showSideShare('このプラグインを共有するためのURLをコピーしました！\nこのリンクを開くと、直接インストール画面が表示されます。');
                    } catch (e) {
                        this.showSideError('URLのコピーに失敗しました: ' + installUrl);
                    }
                } else if (plugin.repo) {
                    // フォールバック: リポジトリURL
                    try {
                        await navigator.clipboard.writeText(plugin.repo);
                        this.showSideShare('リポジトリのURLをコピーしました！');
                    } catch (e) {
                        this.showSideError('URLのコピーに失敗しました: ' + plugin.repo);
                    }
                }
            } else if (!isSharable) {
                // 共有不可（ローカル）な場合はZIPエクスポートを提案
                if (await confirmWithDialog('このプラグインはローカルに保存されています。ZIPファイルとしてエクスポートして共有しますか？', {
                    icon: 'question',
                    confirmButtonText: 'エクスポート',
                })) {
                    try {
                        await this.pluginManager.exportPluginAsZip(plugin.id);
                    } catch (e) {
                        this.showSideError('エクスポートに失敗しました: ' + e.message);
                    }
                }
            }
        });

        const uninstallBtn = document.getElementById('uninstallPluginBtn');
        if (uninstallBtn) {
            uninstallBtn.addEventListener('click', async () => {
                const agreed = await this.confirmDeleteWithAgreement(plugin.name);
                if (!agreed) return;
                try {
                    await this.pluginManager.uninstallPlugin(plugin.id);
                    this.renderMarketplace();
                    this.showEmptyDetail();
                    this.showSideSuccess('プラグインを削除しました。');
                } catch (err) {
                    this.showSideError('削除に失敗しました: ' + err.message);
                }
            });
        }
    }

    async resolveUpdateContext(fullName, plugin) {
        const releases = await this.pluginManager.getReleases(fullName);
        const releaseTags = Array.isArray(releases)
            ? releases
                .filter((release) => !release?.draft && release?.tag_name)
                .map((release) => String(release.tag_name))
            : [];
        const releaseTagSet = new Set(releaseTags);

        const installRef = String(plugin?.installRef || 'main').trim() || 'main';
        const storedInstallChannel = String(plugin?.installChannel || '').trim().toLowerCase();
        const installChannel = (storedInstallChannel === 'release' || storedInstallChannel === 'branch')
            ? storedInstallChannel
            : (releaseTagSet.has(installRef) ? 'release' : 'branch');

        if (installChannel === 'branch') {
            const targetRef = String(plugin?.installBranch || installRef || 'main').trim() || 'main';
            const stable = releases.find((release) => !release?.draft && !release?.prerelease && release?.tag_name);
            const firstTagged = releases.find((release) => !release?.draft && release?.tag_name);
            const latestReleaseRef = String(stable?.tag_name || firstTagged?.tag_name || '').trim();
            const [branches, latestManifest, latestCommitSha] = await Promise.all([
                this.pluginManager.getBranches(fullName),
                this.pluginManager.getManifestFromGitHub(fullName, targetRef),
                this.pluginManager.getLatestCommitSha(fullName, targetRef)
            ]);
            const branchSet = new Set(Array.isArray(branches) ? branches : []);
            const branchExists = branchSet.has(targetRef);
            const latestVersion = latestManifest?.version;
            const currentCommitSha = String(plugin?.installCommitSha || '').trim();
            const hasCommitUpdate = Boolean(currentCommitSha && latestCommitSha && currentCommitSha !== latestCommitSha);

            if (!branchExists) {
                const fallbackBranch = String(
                    plugin?.defaultBranch
                    || (Array.isArray(branches) && branches.length > 0 ? branches[0] : '')
                    || 'main'
                ).trim() || 'main';
                return {
                    installChannel,
                    targetRef,
                    hasUpdate: true,
                    branchMissing: true,
                    fallbackBranch,
                    fallbackReleaseRef: latestReleaseRef || null,
                    latestVersion: null,
                    latestCommitSha: null
                };
            }

            return {
                installChannel,
                targetRef,
                hasUpdate: hasCommitUpdate || this.isUpdateAvailable(plugin.version, latestVersion),
                branchMissing: false,
                latestVersion,
                latestCommitSha: latestCommitSha || null
            };
        }

        if (!Array.isArray(releases) || releases.length === 0) {
            return {
                installChannel: 'release',
                targetRef: installRef,
                hasUpdate: false,
                latestVersion: null,
                latestCommitSha: null
            };
        }

        const stable = releases.find((release) => !release?.draft && !release?.prerelease && release?.tag_name);
        const firstTagged = releases.find((release) => !release?.draft && release?.tag_name);
        const latestReleaseRef = String(stable?.tag_name || firstTagged?.tag_name || '').trim();
        if (!latestReleaseRef) {
            return {
                installChannel: 'release',
                targetRef: installRef,
                hasUpdate: false,
                latestVersion: null,
                latestCommitSha: null
            };
        }

        const latestManifest = await this.pluginManager.getManifestFromGitHub(fullName, latestReleaseRef);
        const latestVersion = latestManifest?.version;
        const currentReleaseRef = String(plugin?.installReleaseTag || installRef).trim();

        return {
            installChannel: 'release',
            targetRef: latestReleaseRef,
            hasUpdate: currentReleaseRef !== latestReleaseRef,
            latestVersion,
            latestCommitSha: null
        };
    }

    compareVersionNumbers(currentVersion, latestVersion) {
        const currentTokens = String(currentVersion || '').match(/\d+/g)?.map((n) => Number(n)) || [];
        const latestTokens = String(latestVersion || '').match(/\d+/g)?.map((n) => Number(n)) || [];
        if (currentTokens.length === 0 || latestTokens.length === 0) return null;

        const maxLength = Math.max(currentTokens.length, latestTokens.length);
        for (let i = 0; i < maxLength; i++) {
            const current = currentTokens[i] ?? 0;
            const latest = latestTokens[i] ?? 0;
            if (latest > current) return 1;
            if (latest < current) return -1;
        }
        return 0;
    }

    isUpdateAvailable(currentVersion, latestVersion) {
        const currentText = String(currentVersion || '').trim();
        const latestText = String(latestVersion || '').trim();
        if (!currentText || !latestText) return false;
        if (currentText === latestText) return false;

        const compared = this.compareVersionNumbers(currentText, latestText);
        if (compared === null) {
            return true;
        }
        return compared > 0;
    }

    async mountUpdateButtonIfNeeded(plugin, repoInfo) {
        if (plugin.installedFrom !== 1 || !repoInfo?.fullName) return;

        const expectedDetailKey = this.getPluginSelectionKey(plugin, true);
        const slot = document.getElementById('pluginUpdateBtnSlot');
        if (!slot) return;
        slot.innerHTML = '';

        try {
            const updateContext = await this.resolveUpdateContext(repoInfo.fullName, plugin);
            const hasUpdate = Boolean(updateContext?.hasUpdate);

            if (!hasUpdate) return;
            if (this.currentDetailPluginKey !== expectedDetailKey) return;

            slot.innerHTML = `
                <button id="updatePluginBtn" class="flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-all" title="GitHub から最新版に更新">
                    <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                    <span>更新</span>
                </button>
            `;
            lucide.createIcons();

            const updateBtn = document.getElementById('updatePluginBtn');
            if (!updateBtn) return;
            updateBtn.addEventListener('click', async () => {
                await this.updateInstalledPlugin(plugin, repoInfo.fullName, updateBtn);
            });
        } catch (error) {
            // 更新判定の失敗は画面を壊さない
        }
    }

    async updateInstalledPlugin(plugin, fullName, buttonElement) {
        if (!buttonElement) return;

        const wasEnabled = this.pluginManager.isPluginEnabled(plugin.id);
        const previousManifest = typeof structuredClone === 'function'
            ? structuredClone(this.pluginManager.installedPlugins[plugin.id])
            : JSON.parse(JSON.stringify(this.pluginManager.installedPlugins[plugin.id]));
        let installedManifest = null;
        const originalHtml = buttonElement.innerHTML;
        buttonElement.disabled = true;
        buttonElement.innerHTML = '<i class="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></i><span>更新中...</span>';

        try {
            const updateContext = await this.resolveUpdateContext(fullName, plugin);
            let targetRef = updateContext.targetRef;

            if (updateContext?.branchMissing) {
                const fallbackBranch = String(updateContext?.fallbackBranch || 'main').trim() || 'main';
                const fallbackReleaseRef = String(updateContext?.fallbackReleaseRef || '').trim();
                if (!fallbackReleaseRef) {
                    const useFallbackBranch = await confirmWithDialog(`インストール元ブランチ「${updateContext.targetRef}」は存在しません。\n代わりにブランチ「${fallbackBranch}」を使用して更新しますか？`, {
                        icon: 'warning',
                        confirmButtonText: '更新する',
                    });
                    if (!useFallbackBranch) {
                        buttonElement.disabled = false;
                        buttonElement.innerHTML = originalHtml;
                        lucide.createIcons();
                        return;
                    }
                    targetRef = fallbackBranch;
                } else {
                    const useRelease = await confirmWithDialog(`インストール元ブランチ「${updateContext.targetRef}」は存在しません。\nOK: リリース「${fallbackReleaseRef}」で更新\nキャンセル: ブランチ「${fallbackBranch}」で更新`, {
                        icon: 'question',
                        confirmButtonText: 'リリースで更新',
                        cancelButtonText: 'ブランチで更新',
                        focusCancel: false,
                    });
                    targetRef = useRelease ? fallbackReleaseRef : fallbackBranch;
                }
            }

            if (wasEnabled) {
                await this.pluginManager.disablePlugin(plugin.id, { allowDependents: true });
            }

            const manifest = await this.pluginManager.installFromGitHub(fullName, targetRef);
            installedManifest = manifest;
            if (wasEnabled) {
                await this.pluginManager.enablePlugin(manifest.id);
            }

            const beforeLabel = updateContext.installChannel === 'branch'
                ? (String(plugin?.installCommitSha || '').slice(0, 7) || plugin.version)
                : (String(plugin?.installReleaseTag || plugin?.installRef || plugin.version));
            const afterLabel = updateContext.installChannel === 'branch'
                ? (String(manifest?.installCommitSha || '').slice(0, 7) || manifest.version)
                : (String(manifest?.installReleaseTag || manifest?.installRef || manifest.version));

            this.renderMarketplace();
            this.showDetail(manifest);
            this.showSideSuccess(`プラグインを更新しました: ${beforeLabel} -> ${afterLabel}`);
        } catch (error) {
            if (installedManifest?.id && installedManifest.id !== plugin.id) {
                delete this.pluginManager.installedPlugins[installedManifest.id];
            }
            if (previousManifest) {
                this.pluginManager.installedPlugins[plugin.id] = previousManifest;
                this.pluginManager.saveInstalledPlugins();
            }
            if (wasEnabled && !this.pluginManager.isPluginEnabled(plugin.id)) {
                try {
                    await this.pluginManager.enablePlugin(plugin.id);
                } catch (restoreError) {
                    console.error('Failed to restore plugin state after update failure:', restoreError);
                }
            }
            this.showSideError('プラグインの更新に失敗しました: ' + error.message);
            buttonElement.disabled = false;
            buttonElement.innerHTML = originalHtml;
            lucide.createIcons();
        }
    }

    async loadLocalREADME(plugin) {
        const container = document.getElementById('readme-container');
        if (!container) return;

        const sourceUrl = plugin.source || plugin.repo;
        if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
            // source/repo URL をそのまま渡して README を解決させる
            const [readme, showReadmeAd] = await Promise.all([
                this.pluginManager.getREADME(sourceUrl, plugin.installRef || 'main'),
                this.pluginManager.hasExternalDocOverride(sourceUrl)
            ]);
            container.innerHTML = `<div class="font-sans text-sm leading-relaxed"><div class="readme-content">${this.renderMarkdown(readme)}</div>${showReadmeAd ? this.getReadmeAdHtml() : ''}</div>`;
            this.initReadmeAds(container);
        } else {
            container.innerHTML = `<p class="text-sm text-slate-500">${this.escapeHtml(plugin.description || '')}</p>`;
        }
    }

    getReadmeAdHtml() {
        const adClient = document.querySelector('meta[name="google-adsense-account"]')?.getAttribute('content') || '';
        const adSlot = (typeof window !== 'undefined' && window.EDBB_ADSENSE_SLOT) ? String(window.EDBB_ADSENSE_SLOT) : '';

        if (adClient && adSlot) {
            return `
                <div class="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
                    <ins class="adsbygoogle"
                        style="display:block"
                        data-ad-client="${this.escapeHtml(adClient)}"
                        data-ad-slot="${this.escapeHtml(adSlot)}"
                        data-ad-format="auto"
                        data-full-width-responsive="true"></ins>
                </div>
            `;
        }

        return `
            <div class="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
                <div class="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    Ad space
                </div>
            </div>
        `;
    }

    initReadmeAds(rootElement) {
        if (!rootElement || typeof window === 'undefined') return;
        if (!window.adsbygoogle) return;

        const adElements = rootElement.querySelectorAll('.adsbygoogle');
        adElements.forEach(() => {
            try {
                (window.adsbygoogle = window.adsbygoogle || []).push({});
            } catch (e) { }
        });
    }

    renderMarkdown(markdown) {
        if (typeof marked === 'undefined') return this.escapeHtml(markdown);

        // marked.js のオプション設定
        marked.setOptions({
            gfm: true,
            breaks: true,
            headerIds: true,
            mangle: false
        });

        // marked.js を使用して Markdown を HTML に変換
        // HTMLタグをそのまま通すようにパース
        const rawHtml = marked.parse(markdown);

        // DOMPurify を使用して安全な HTML にサニタイズ
        if (typeof DOMPurify !== 'undefined') {
            return DOMPurify.sanitize(rawHtml, {
                // GitHubのREADMEでよく使われるタグと属性を許可
                ADD_TAGS: ['div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'span', 'img', 'a', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre', 'blockquote', 'hr', 'details', 'summary', 'b', 'i', 'strong', 'em', 'del', 'center'],
                ADD_ATTR: ['class', 'style', 'src', 'href', 'target', 'alt', 'width', 'height', 'align', 'valign', 'border'],
                // インラインスタイルを許可 (中央揃えなどに必要)
                FORBID_ATTR: [],
                FORBID_TAGS: []
            });
        }
        return this.escapeHtml(markdown);
    }

    safeExternalUrl(value) {
        try {
            const source = String(value || '').trim();
            if (!source) return '';
            const parsed = new URL(source, window.location.origin);
            if (!['http:', 'https:'].includes(parsed.protocol)) return '';
            return this.escapeHtml(parsed.href);
        } catch (_) {
            return '';
        }
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}
