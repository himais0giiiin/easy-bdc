/**
 * block-search.js - EDBB Block Search Core
 */

export class BlockSearch {
    constructor(workspace, pluginManager) {
        this.workspace = workspace;
        this.pluginManager = pluginManager;
        this.index = [];
        this.searchResults = [];
        this.query = "";
        this.originalToolboxXml = document.getElementById('toolbox');
    }

    /**
     * Build the search index from all available sources
     */
    async buildIndex() {
        // Use a temporary index to avoid clearing and leaving the search empty while building
        const newIndex = [];

        // Fetch blocks.js content for static analysis
        try {
            const response = await fetch('blocks.js');
            this.blocksJsContent = await response.text();
        } catch (e) {
            console.warn("Failed to fetch blocks.js for static analysis", e);
            this.blocksJsContent = "";
        }

        // 1. Core Blocks
        this.addCoreBlocksToIndex(newIndex);

        // 2. Installed Plugins (Enabled and Disabled)
        this.addInstalledPluginsToIndex(newIndex);

        // Swap to the new index immediately so core/installed are searchable
        this.index = newIndex;

        console.log(`Block search index built with ${this.index.length} items.`);
    }

    addCoreBlocksToIndex(index) {
        const toolboxXml = document.getElementById('toolbox');
        if (!toolboxXml) return;

        const categories = toolboxXml.querySelectorAll('category');
        categories.forEach(category => {
            const categoryName = category.getAttribute('name');
            const blocks = category.querySelectorAll('block');
            blocks.forEach(block => {
                const type = block.getAttribute('type');
                const blockDef = Blockly.Blocks[type];

                let extractedLabel = this.blocksJsContent ? this.extractLabelsFromCode(type, this.blocksJsContent) : "";
                let fallbackLabel = this.getFriendlyName(type);

                let label = extractedLabel || fallbackLabel || type;
                let keywords = [label, fallbackLabel, type].join(' ');

                index.push({
                    type: type,
                    label: label,
                    keywords: keywords,
                    category: categoryName,
                    source: 'core',
                    installed: true
                });
            });
        });
    }

    addInstalledPluginsToIndex(index) {
        const plugins = this.pluginManager.installedPlugins;
        for (const id in plugins) {
            const plugin = plugins[id];
            // Fix: script property is used to store code in PluginManager
            const code = plugin.script || plugin.code || "";

            // If blockTypes is missing (e.g. never enabled), try to extract from code
            let blockTypes = Array.isArray(plugin.blockTypes) ? plugin.blockTypes : [];
            if (blockTypes.length === 0 && code) {
                // Heuristic: find all Blockly.Blocks['...'] in the script
                const typeRegex = /Blockly\.Blocks\s*\[\s*(['"])(.*?)\1\s*\]/g;
                let match;
                while ((match = typeRegex.exec(code)) !== null) {
                    if (match[2]) blockTypes.push(match[2]);
                }
                blockTypes = Array.from(new Set(blockTypes));
            }

            blockTypes.forEach(type => {
                let extractedLabel = this.extractLabelsFromCode(type, code);
                let fallbackLabel = this.getFriendlyName(type);

                let label = extractedLabel || fallbackLabel || type;
                let keywords = [label, fallbackLabel, type].join(' ');

                index.push({
                    type: type,
                    label: label,
                    keywords: keywords,
                    category: plugin.name || id,
                    source: 'plugin',
                    pluginId: id,
                    installed: true,
                    enabled: this.pluginManager.isPluginEnabled(id)
                });
            });
        }
    }


    getFriendlyName(type) {
        // Mapping of common block types to Japanese/Friendly names
        // This could be improved by actually inspecting Blockly.Blocks[type]
        const map = {
            'on_ready': 'Botが起動したとき',
            'on_message_create': 'メッセージを受信したとき',
            'on_member_join': 'メンバーが参加したとき',
            'on_member_remove': 'メンバーが退出したとき',
            'on_reaction_add': 'リアクションが追加されたとき',
            'get_message_content': 'メッセージの内容',
            'message_contains_text': 'メッセージの内容に...を含む',
            'on_command_executed': '\u30b9\u30e9\u30c3\u30b7\u30e5\u30b3\u30de\u30f3\u30c9',
            'bc_slash_command': '\u5f15\u6570\u4ed8\u304d\u30b9\u30e9\u30c3\u30b7\u30e5\u30b3\u30de\u30f3\u30c9',
            'bc_str_arg': '\u6587\u5b57\u5217\u5f15\u6570',
            'bc_int_arg': '\u6574\u6570\u5f15\u6570',
            'bc_bool_arg': '\u771f\u507d\u5024\u5f15\u6570',
            'bc_member_arg': '\u30e1\u30f3\u30d0\u30fc\u5f15\u6570',
            'bc_channel_arg': '\u30c6\u30ad\u30b9\u30c8\u30c1\u30e3\u30f3\u30cd\u30eb\u5f15\u6570',
            'bc_vchannel_arg': 'VC\u30c1\u30e3\u30f3\u30cd\u30eb\u5f15\u6570',
            'bc_choice_arg': '\u9078\u629e\u80a2\u5f15\u6570',
            'bc_choice_item': '\u9078\u629e\u80a2\u9805\u76ee',
            'bc_get_arg': '\u5f15\u6570\u306e\u5024',
            'bc_get_choice_val': '\u9078\u629e\u80a2\u5f15\u6570\u306e\u5024',
            'prefix_command': 'プレフィックスコマンド',
            'on_button_click': 'ボタンがクリックされたとき',
            'on_modal_submit': 'モーダルが送信されたとき',
            'reply_message': '返信する',
            'send_dm': 'DMを送信',
            'add_reaction': 'リアクションを付ける',
            'print_to_console': 'コンソールに表示',
            'controls_if': 'もし...なら',
            'logic_compare': '比較',
            'logic_operation': '論理演算',
            'math_number': '数値',
            'math_arithmetic': '計算',
            'text': '文字列',
            'variables_set': '変数に代入',
            'variables_get': '変数の値',
            'join_voice_channel': 'ボイスチャンネルに参加',
            'play_audio_file': '音楽を再生',
            'leave_voice_channel': 'ボイスチャンネルから切断',
            'create_text_channel': 'テキストチャンネル作成',
            'delete_channel': 'チャンネル削除',
            'on_voice_state_update': 'ボイスチャンネルの状態が更新されたとき',
        };

        if (map[type]) return map[type];
        return type;
    }

    /**
     * Statically extracts text labels from a block's source code defintion.
     */
    extractLabelsFromCode(type, code) {
        if (!code) return "";
        let startIndex = code.indexOf(`Blockly.Blocks['${type}']`);
        if (startIndex === -1) {
            startIndex = code.indexOf(`Blockly.Blocks["${type}"]`);
        }
        if (startIndex === -1) return "";

        let endIndex = code.indexOf(`Blockly.Blocks[`, startIndex + 1);
        if (endIndex === -1) endIndex = code.length;

        const blockDef = code.substring(startIndex, endIndex);

        // find appendField('Text') strings, excluding Blockly.Field... objects implicitly by regex
        const appendFieldRegex = /appendField\s*\(\s*(['"])(.*?)\1(?:,|\))/g;
        let labels = [];
        let match;
        while ((match = appendFieldRegex.exec(blockDef)) !== null) {
            if (match[2]) {
                labels.push(match[2]);
            }
        }
        return labels.join(' ').trim();
    }

    search(query) {
        this.query = (query || "").trim().toLowerCase();
        if (!this.query) {
            this.searchResults = [];
            return false;
        }

        this.searchResults = this.index.filter(item => {
            const label = (item.label || "").toLowerCase();
            const type = (item.type || "").toLowerCase();
            const keywords = (item.keywords || "").toLowerCase();

            return label.includes(this.query) ||
                type.includes(this.query) ||
                keywords.includes(this.query);
        });
        return this.searchResults.length > 0;
    }

    /**
     * Update the Blockly toolbox with search results
     * @param {boolean} preventRefocus - If true, do not force focus back to the search input
     */
    updateToolbox(preventRefocus = false) {
        const searchInput = document.getElementById('blockSearchInput');
        const searchContainer = document.getElementById('blockSearchContainer');
        const query = searchInput ? searchInput.value : "";
        const workspaceContainer = document.getElementById('workspace-container');

        // デタッチして再構築時のDOM破棄を防ぐ
        if (searchContainer && searchContainer.parentNode) {
            if (workspaceContainer) workspaceContainer.appendChild(searchContainer);
            searchContainer.style.display = 'none';
        }

        if (!query) {
            // Restore original toolbox and close any open flyout
            this.workspace.updateToolbox(this.originalToolboxXml);
            const toolbox = this.workspace.getToolbox();
            if (toolbox) {
                toolbox.clearSelection();
            }
        } else {
            this.search(query);
            const toolboxXml = this.generateSearchResultToolbox();
            this.workspace.updateToolbox(toolboxXml);

            // Automatically select the "Search Results" category
            setTimeout(() => {
                const toolbox = this.workspace.getToolbox();
                if (toolbox) {
                    const searchCategory = toolbox.getToolboxItems().find(item =>
                        item.isSelectable() && item.getName() === "検索結果"
                    );
                    if (searchCategory) {
                        toolbox.setSelectedItem(searchCategory);
                    }
                }
            }, 50);
        }

        // ツールボックスが構築された後、内容コンテナの先頭に即座（同期的）に再アタッチする
        const toolboxContents = document.querySelector('.blocklyToolboxContents');
        if (toolboxContents && searchContainer) {
            toolboxContents.insertBefore(searchContainer, toolboxContents.firstChild);
            searchContainer.style.display = 'block';
            if (!preventRefocus && searchInput && document.activeElement !== searchInput) {
                // Keep the cursor position by storing it briefly
                const cursorStart = searchInput.selectionStart;
                const cursorEnd = searchInput.selectionEnd;
                searchInput.focus();
                searchInput.setSelectionRange(cursorStart, cursorEnd);
            }
        }
    }

    generateSearchResultToolbox() {
        const parser = new DOMParser();
        // Clone the original toolbox XML structure
        const combinedXml = this.originalToolboxXml.cloneNode(true);

        // Create the search result category
        const searchCategory = document.createElement('category');
        searchCategory.setAttribute('name', '検索結果');
        searchCategory.setAttribute('data-icon', '🔎');
        searchCategory.setAttribute('colour', '#6366f1');

        if (this.searchResults.length === 0) {
            const label = document.createElement('label');
            label.setAttribute('text', '見つかりませんでした');
            searchCategory.appendChild(label);
        } else {
            this.searchResults.forEach(item => {
                const block = document.createElement('block');
                // Only render as a real block if it's installed AND enabled (core blocks don't have 'enabled' so they default to not false)
                if (item.installed && item.enabled !== false) {
                    block.setAttribute('type', item.type);
                } else {
                    block.setAttribute('type', 'uninstalled_block_placeholder');
                    block.setAttribute('disabled', 'true'); // Visually grey out the block

                    const isUninstalled = item.installed === false;
                    const reqPrefix = isUninstalled ? "【未導入】" : "【無効】";
                    const statusText = isUninstalled ? "[未導入]" : "[無効]";
                    const statusIcon = isUninstalled ? "📦" : "🚫";
                    const pluginName = item.pluginName || item.category || "不明なプラグイン";

                    const fieldStatus = document.createElement('field');
                    fieldStatus.setAttribute('name', 'STATUS');
                    fieldStatus.textContent = statusText;
                    block.appendChild(fieldStatus);

                    const fieldIcon = document.createElement('field');
                    fieldIcon.setAttribute('name', 'ICON');
                    fieldIcon.textContent = statusIcon;
                    block.appendChild(fieldIcon);

                    const fieldName = document.createElement('field');
                    fieldName.setAttribute('name', 'NAME');
                    fieldName.textContent = item.label;
                    block.appendChild(fieldName);

                    const fieldPlugin = document.createElement('field');
                    fieldPlugin.setAttribute('name', 'PLUGIN');
                    fieldPlugin.textContent = pluginName;
                    block.appendChild(fieldPlugin);

                    const fieldPluginId = document.createElement('field');
                    fieldPluginId.setAttribute('name', 'PLUGIN_ID');
                    fieldPluginId.textContent = item.pluginId || '';
                    block.appendChild(fieldPluginId);
                }
                searchCategory.appendChild(block);
            });
        }

        // Insert at the beginning of the toolbox
        combinedXml.insertBefore(searchCategory, combinedXml.firstChild);

        // Add a separator after search results
        const sep = document.createElement('sep');
        combinedXml.insertBefore(sep, searchCategory.nextSibling);

        return combinedXml;
    }
}
