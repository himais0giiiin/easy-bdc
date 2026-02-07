import Blocks from './blocks.js';
import WorkspaceStorage from './storage.js';
import { initShareFeature } from "./share.js";

const PROJECT_TITLE_STORAGE_KEY = 'edbb_project_title';

let workspace;
let storage;

const LIST_STORE_KEY = 'edbb_list_store';

const listStore = (() => {
  let lists = new Map();

  const normalizeItems = (items) => {
    if (!Array.isArray(items)) return [];
    return items.map((item) => (item == null ? '' : String(item)));
  };

  const ensureList = (id) => {
    if (!id) return [];
    if (!lists.has(id)) lists.set(id, []);
    return lists.get(id) || [];
  };

  const setItems = (id, items) => {
    if (!id) return;
    lists.set(id, normalizeItems(items));
  };

  const getItems = (id) => lists.get(id) || [];

  const appendItem = (id, value = '') => {
    if (!id) return;
    const items = [...getItems(id), String(value)];
    lists.set(id, items);
  };

  const updateItem = (id, index, value) => {
    if (!id) return;
    const items = [...getItems(id)];
    if (index < 0 || index >= items.length) return;
    items[index] = String(value ?? '');
    lists.set(id, items);
  };

  const removeItem = (id, index) => {
    if (!id) return;
    const items = [...getItems(id)];
    if (index < 0 || index >= items.length) return;
    items.splice(index, 1);
    lists.set(id, items);
  };

  const removeList = (id) => {
    if (!id) return;
    lists.delete(id);
  };

  const getEntries = () =>
    Array.from(lists.entries()).map(([id, items]) => ({ id, items: [...items] }));

  const getIds = () => Array.from(lists.keys());

  const toJSON = (workspaceRef) => {
    const payload = { lists: [] };
    if (!workspaceRef) return payload;
    lists.forEach((items, id) => {
      const variable = workspaceRef.getVariableById(id);
      if (!variable) return;
      payload.lists.push({
        name: variable.name,
        items: [...items],
      });
    });
    return payload;
  };

  const fromJSON = (data, workspaceRef) => {
    lists = new Map();
    if (!data || typeof data !== 'object') return;

    if (Array.isArray(data.lists)) {
      data.lists.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const name = String(entry.name || '').trim();
        if (!name) return;
        let variable = null;
        if (workspaceRef?.getVariableMap) {
          const variableMap = workspaceRef.getVariableMap();
          variable =
            variableMap?.getVariable?.(name) ||
            variableMap?.getVariableByName?.(name) ||
            variableMap?.getAllVariables?.().find((item) => item.name === name) ||
            null;
        }
        if (!variable && workspaceRef?.createVariable) {
          variable = workspaceRef.createVariable(name);
        }
        if (!variable) return;
        lists.set(variable.getId(), normalizeItems(entry.items));
      });
      return;
    }

    // Backward compatibility: id -> items map
    Object.entries(data).forEach(([id, items]) => {
      if (!Array.isArray(items)) return;
      const variable = workspaceRef?.getVariableById?.(id);
      if (!variable) return;
      lists.set(variable.getId(), normalizeItems(items));
    });
  };

  return {
    ensureList,
    setItems,
    getItems,
    appendItem,
    updateItem,
    removeItem,
    removeList,
    getEntries,
    getIds,
    toJSON,
    fromJSON,
  };
})();

if (typeof Blockly !== 'undefined') {
  Blockly.edbbListStore = listStore;
}

const toPythonLiteral = (raw) => {
  const original = String(raw ?? '');
  const trimmed = original.trim();
  if (!trimmed) return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const lowered = trimmed.toLowerCase();
  if (lowered === 'true') return 'True';
  if (lowered === 'false') return 'False';
  if (lowered === 'none' || lowered === 'null') return 'None';
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  if (quoted) return trimmed;
  return JSON.stringify(original);
};

const buildListInitializationCode = (generator) => {
  if (!workspace) return '';
  const entries = listStore.getEntries();
  if (!entries.length) return '';
  if (!generator?.nameDB_) return '';
  const lines = [];
  entries.forEach(({ id, items }) => {
    const variable = workspace.getVariableById(id);
    if (!variable) return;
    const name = generator.nameDB_.getName(variable.name, Blockly.Names.VARIABLE_NAME);
    const serialized = items
      .map((item) => toPythonLiteral(item))
      .filter((item) => item !== null);
    lines.push(`${name} = [${serialized.join(', ')}]`);
  });
  return lines.join('\n');
};

const ensureListGenerator = (() => {
  let patched = false;
  return () => {
    if (patched || !Blockly?.Python?.finish) return;
    const originalFinish = Blockly.Python.finish;
    Blockly.Python.finish = function (code) {
      const listInit = buildListInitializationCode(this);
      if (listInit) {
        this.definitions_['edbb_list_init'] = listInit;
      } else if (this.definitions_) {
        delete this.definitions_['edbb_list_init'];
      }
      return originalFinish.call(this, code);
    };
    patched = true;
  };
})();

Blockly.Blocks['custom_python_code'] = {
  init: function () {
    this.appendDummyInput().appendField('🐍 Pythonコード実行');
    this.appendDummyInput().appendField(
      new FieldMultilineInput("print('Hello World')"),
      'CODE',
    );
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(60);
    this.setTooltip('任意のPythonコードをここに記述して実行させます。');
  },
};

const setupBlocklyEnvironment = () => {
  // Modern Theme Definition
  const modernLightTheme = Blockly.Theme.defineTheme('modernLight', {
    base: Blockly.Themes.Classic,
    componentStyles: {
      workspaceBackgroundColour: '#f8fafc', // slate-50
      toolboxBackgroundColour: '#ffffff',
      toolboxForegroundColour: '#475569',
      flyoutBackgroundColour: '#ffffff',
      flyoutForegroundColour: '#475569',
      flyoutOpacity: 0.95,
      scrollbarColour: '#cbd5e1',
      insertionMarkerColour: '#6366f1', // Indigo
      insertionMarkerOpacity: 0.3,
      cursorColour: '#6366f1',
    },
    fontStyle: {
      family: 'Plus Jakarta Sans, sans-serif',
      weight: '600',
      size: 12,
    },
  });

  const modernDarkTheme = Blockly.Theme.defineTheme('modernDark', {
    base: Blockly.Themes.Classic,
    componentStyles: {
      workspaceBackgroundColour: '#020617', // slate-950
      toolboxBackgroundColour: '#0f172a', // slate-900
      toolboxForegroundColour: '#cbd5e1',
      flyoutBackgroundColour: '#0f172a',
      flyoutForegroundColour: '#cbd5e1',
      flyoutOpacity: 0.95,
      scrollbarColour: '#334155',
      insertionMarkerColour: '#818cf8', // Indigo light
      insertionMarkerOpacity: 0.3,
      cursorColour: '#818cf8',
    },
    fontStyle: {
      family: 'Plus Jakarta Sans, sans-serif',
      weight: '600',
      size: 12,
    },
    blockStyles: {
      hat_blocks: { colourPrimary: '#a55b80' },
    },
  });

  Blockly.Python = Blocks.Python;
  Blockly.Blocks = Blocks.Blocks;
  Blockly.Python.INDENT = '    ';

  return { modernLightTheme, modernDarkTheme };
};

const html = document.documentElement;
const isMobileDevice =
  typeof window !== 'undefined' && window.innerWidth < 768;
if (isMobileDevice) {
  html.classList.add('is-mobile');
}

const applyMobileToolboxIcons = (toolboxEl) => {
  if (!isMobileDevice || !toolboxEl) return;
  const categories = toolboxEl.querySelectorAll('category');
  categories.forEach((cat) => {
    const icon = cat.getAttribute('data-icon');
    if (icon) {
      const currentName = cat.getAttribute('name') || '';
      cat.setAttribute('data-label', currentName);
      cat.setAttribute('name', icon);
    }
  });
};

const escapePyString = (value) =>
  String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const extractEventName = (line) => line.split(':').slice(1).join(':').trim();

const extractInteractionEvents = (rawCode) => {
  const lines = rawCode.split('\n');
  let filteredLines = [];
  let componentEvents = '';
  let modalEvents = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('# BUTTON_EVENT:')) {
      const currentEventName = extractEventName(line);
      const escapedEventName = escapePyString(currentEventName);
      componentEvents +=
        `            if interaction.data.get('custom_id') == '${escapedEventName}':\n` +
        `                await on_button_${currentEventName}(interaction)\n`;
      filteredLines.push(line);
    } else if (line.includes('# MODAL_EVENT:')) {
      const currentEventName = extractEventName(line);
      const escapedEventName = escapePyString(currentEventName);
      modalEvents +=
        `            if interaction.data.get('custom_id') == '${escapedEventName}':\n` +
        `                await on_modal_${currentEventName}(interaction)\n`;
      filteredLines.push(line);
    } else {
      filteredLines.push(line);
    }
  }

  const cleanedCode = filteredLines.join('\n');
  return {
    cleanedCode,
    componentEvents,
    modalEvents,
    hasComponentEvents: componentEvents.trim().length > 0,
    hasModalEvents: modalEvents.trim().length > 0,
  };
};

// --- Code Generation & UI Sync ---
const generatePythonCode = () => {
  if (!workspace) return '';
  const rawCode = Blockly.Python.workspaceToCode(workspace);
  const {
    cleanedCode,
    componentEvents: componentEventsRaw,
    modalEvents: modalEventsRaw,
    hasComponentEvents,
    hasModalEvents,
  } = extractInteractionEvents(rawCode);
  let componentEvents = componentEventsRaw;
  let modalEvents = modalEventsRaw;
  const bodyCode = cleanedCode;

  if (!componentEvents.trim()) componentEvents = '            pass';
  if (!modalEvents.trim()) modalEvents = '            pass';

  // --- Dependency Analysis ---
  const usesJson = bodyCode.includes('_load_json_data') || bodyCode.includes('_save_json_data') || bodyCode.includes('json.');
  const usesModal = bodyCode.includes('EasyModal');
  const usesRandom = bodyCode.includes('random.');
  const usesAsyncio = bodyCode.includes('asyncio.');
  const usesDatetime = bodyCode.includes('datetime.');
  const usesMath = bodyCode.includes('math.');
  const usesLogging = bodyCode.includes('logging.') || usesJson; // JSON helpers use logging
  const needInteractionHandler = hasComponentEvents || hasModalEvents;

  // --- Build Imports ---
  const imports = [
    'import discord',
    'from discord import app_commands',
    'from discord.ext import commands',
  ];
  if (needInteractionHandler || usesModal || bodyCode.includes('discord.ui')) imports.push('from discord import ui');
  if (usesRandom) imports.push('import random');
  if (usesAsyncio) imports.push('import asyncio');
  if (usesDatetime) imports.push('import datetime');
  if (usesMath) imports.push('import math');
  if (usesJson) {
    imports.push('import json');
    imports.push('import os');
  }
  if (usesLogging) imports.push('import logging');

  const header = imports.join('\n');

  const fullBoiler = `
# Easy Discord Bot Builderによって作成されました！ 製作：@himais0giiiin
# Created with Easy Discord Bot Builder! created by @himais0giiiin!
# Optimized Version

${header}

  boilerplate += `
intents = discord.Intents.default()
intents.message_content = True 
intents.members = True 
intents.voice_states = True

# Botの作成
bot = commands.Bot(command_prefix='!', intents=intents)
`;

  // Note: Global Error Handler removed as per issue #12

  // --- JSON Operations ---
  if (usesJson) {
    boilerplate += `
# ---JSON操作---
def _load_json_data(filename):
    if not os.path.exists(filename):
        return {}
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logging.error(f"JSON Load Error: {e}")
        return {}

def _save_json_data(filename, data):
    try:
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
    except Exception as e:
        logging.error(f"JSON Save Error: {e}")
`;
  }

  // --- Modal Class ---
  if (usesModal) {
    boilerplate += `
# --- モーダルクラス ---
class EasyModal(discord.ui.Modal):
    def __init__(self, title, custom_id, inputs):
        super().__init__(title=title, timeout=None, custom_id=custom_id)
        for item in inputs:
            self.add_item(discord.ui.TextInput(label=item['label'], custom_id=item['id']))
`;
  }

  // --- Interaction Handler ---
  if (needInteractionHandler) {
    boilerplate += `
# --- インタラクションハンドラー ---
@bot.event
async def on_interaction(interaction):
    try:
        if interaction.type == discord.InteractionType.component:
${componentEvents}
        elif interaction.type == discord.InteractionType.modal_submit:
${modalEvents}
    except Exception as e:
        print(f"Interaction Error: {e}")
`;
  }

  boilerplate += `
# ----------------------------

# --- ユーザー作成部分 ---
${bodyCode}
# --------------------------

if __name__ == "__main__":
    # Token check

    print('\\x1b[31m!!!!注意!!!! トークンを設定していない場合は、実行前にコードの最後にある"TOKEN"部分にトークンを設定してください。\\n\\x1b[0m')
    print('\\x1b[31m!!!!Warning!!!! If you have not set a token, please set the token in the “TOKEN” section at the end of the code before execution.\\x1b[0m')
    # トークン設定後は、注意を削除しても問題ありません。 / After setting the token, you may safely remove this warning message.

    bot.run('TOKEN')  # 実行時はここにTokenを入れてください!
    pass
`;

  return fullBoiler.trim();
};

const updateLivePreview = () => {
  const code = generatePythonCode();
  const preview = document.getElementById('codePreviewContent');
  preview.textContent = code;
  hljs.highlightElement(preview);
};

const setupListManager = ({ workspace, storage, shareFeature, workspaceContainer }) => {
  if (!workspace || !workspaceContainer) return null;
  ensureListGenerator();

  let panel = document.getElementById('listPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'listPanel';
    panel.className = 'list-panel hidden';

    const header = document.createElement('div');
    header.className = 'list-panel__header';
    const title = document.createElement('span');
    title.className = 'list-panel__title';
    title.textContent = 'リスト';
    header.appendChild(title);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'list-panel__body';
    panel.appendChild(body);
    workspaceContainer.appendChild(panel);
  }

  const body = panel.querySelector('.list-panel__body');
  let saveTimer = null;

  const showSaveStatus = () => {
    const saveStatus = document.getElementById('saveStatus');
    if (!saveStatus) return;
    saveStatus.setAttribute('data-show', 'true');
    setTimeout(() => saveStatus.setAttribute('data-show', 'false'), 2000);
  };

  const scheduleListSave = () => {
    if (shareFeature?.isShareViewMode?.()) return;
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      storage?.save();
      showSaveStatus();
      if (workspaceContainer.classList.contains('split-view')) updateLivePreview();
    }, 150);
  };

  const pruneLists = () => {
    const validIds = new Set(workspace.getAllVariables().map((variable) => variable.getId()));
    listStore.getIds().forEach((id) => {
      if (!validIds.has(id)) listStore.removeList(id);
    });
  };

  const renderListPanel = () => {
    if (!body) return;
    pruneLists();
    const entries = listStore.getEntries();
    body.innerHTML = '';

    if (!entries.length) {
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    entries.forEach(({ id, items }) => {
      const variable = workspace.getVariableById(id);
      if (!variable) return;

      const card = document.createElement('div');
      card.className = 'list-panel__list';
      card.dataset.listId = id;

      const cardHeader = document.createElement('div');
      cardHeader.className = 'list-panel__list-header';
      const name = document.createElement('span');
      name.className = 'list-panel__list-name';
      name.textContent = variable.name;
      cardHeader.appendChild(name);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'list-panel__list-delete';
      deleteBtn.type = 'button';
      deleteBtn.textContent = '削除';
      deleteBtn.addEventListener('click', () => {
        const confirmed = window.confirm(`リスト「${variable.name}」を削除しますか？`);
        if (!confirmed) return;
        if (typeof workspace.deleteVariableById === 'function') {
          workspace.deleteVariableById(id);
        } else if (typeof workspace.deleteVariable === 'function') {
          workspace.deleteVariable(variable);
        }
        listStore.removeList(id);
        renderListPanel();
        scheduleListSave();
      });
      cardHeader.appendChild(deleteBtn);
      card.appendChild(cardHeader);

      const itemList = document.createElement('div');
      itemList.className = 'list-panel__items';

      items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'list-panel__item';

        const indexLabel = document.createElement('span');
        indexLabel.className = 'list-panel__item-index';
        indexLabel.textContent = String(index + 1);

        const input = document.createElement('input');
        input.className = 'list-panel__item-input';
        input.type = 'text';
        input.value = item;
        input.addEventListener('input', () => {
          listStore.updateItem(id, index, input.value);
          scheduleListSave();
        });

        const removeBtn = document.createElement('button');
        removeBtn.className = 'list-panel__item-remove';
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
          listStore.removeItem(id, index);
          renderListPanel();
          scheduleListSave();
        });

        row.appendChild(indexLabel);
        row.appendChild(input);
        row.appendChild(removeBtn);
        itemList.appendChild(row);
      });

      card.appendChild(itemList);

      const addBtn = document.createElement('button');
      addBtn.className = 'list-panel__item-add';
      addBtn.type = 'button';
      addBtn.textContent = '+ 追加';
      addBtn.addEventListener('click', () => {
        listStore.appendItem(id, '');
        renderListPanel();
        scheduleListSave();
        const latestInput = panel.querySelector(
          `[data-list-id="${id}"] .list-panel__item:last-child input`,
        );
        latestInput?.focus();
      });
      card.appendChild(addBtn);
      body.appendChild(card);
    });
  };

  const promptForListName = (callback) => {
    const defaultName = 'list';
    if (typeof Blockly.prompt === 'function') {
      Blockly.prompt('リスト名を入力してください', defaultName, (name) => callback(name));
    } else {
      callback(window.prompt('リスト名を入力してください', defaultName));
    }
  };

  const handleCreateList = () => {
    promptForListName((name) => {
      if (!name) return;
      const variable = workspace.createVariable(name);
      if (!variable) return;
      listStore.ensureList(variable.getId());
      renderListPanel();
      scheduleListSave();
    });
  };

  workspace.registerButtonCallback('CREATE_LIST_BUTTON', handleCreateList);

  const originalGetExtraState = workspace.getExtraState?.bind(workspace);
  const originalSetExtraState = workspace.setExtraState?.bind(workspace);

  workspace.getExtraState = () => {
    const base = originalGetExtraState ? originalGetExtraState() : {};
    const safeBase = base && typeof base === 'object' ? base : {};
    return { ...safeBase, [LIST_STORE_KEY]: listStore.toJSON(workspace) };
  };

  workspace.setExtraState = (state) => {
    if (originalSetExtraState) originalSetExtraState(state);
    listStore.fromJSON(state?.[LIST_STORE_KEY], workspace);
    renderListPanel();
  };

  workspace.addChangeListener((event) => {
    if (event.type === Blockly.Events.VAR_DELETE) {
      listStore.removeList(event.varId);
      renderListPanel();
      scheduleListSave();
    }
    if (event.type === Blockly.Events.VAR_RENAME) {
      renderListPanel();
      scheduleListSave();
    }
  });

  renderListPanel();

  return { renderListPanel, scheduleListSave };
};

const indentBlock = (block, spaces = 4) =>
  block
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `${' '.repeat(spaces)}${line}`))
    .join('\n');

const addSelfParam = (block) =>
  block.replace(/async def ([^(]+)\(([^)]*)\)/, (match, name, params) => {
    const trimmed = params.trim();
    if (!trimmed) return `async def ${name}(self)`;
    if (trimmed.startsWith('self')) return `async def ${name}(${trimmed})`;
    return `async def ${name}(self, ${trimmed})`;
  });

const convertEventBlock = (block) => {
  let updated = block.replace('@bot.event', '@commands.Cog.listener()');
  updated = addSelfParam(updated);
  updated = updated.replace(/\bbot\./g, 'self.bot.');
  return updated;
};

const convertSlashCommandBlock = (block) => {
  let updated = block.replace('@bot.tree.command', '@app_commands.command');
  updated = addSelfParam(updated);
  updated = updated.replace(/\bbot\./g, 'self.bot.');
  return updated;
};

const convertPrefixCommandBlock = (block) => {
  let updated = block.replace('@bot.command', '@commands.command');
  updated = addSelfParam(updated);
  updated = updated.replace(/\bbot\./g, 'self.bot.');
  return updated;
};

const convertComponentBlock = (block) => {
  let updated = addSelfParam(block);
  updated = updated.replace(/\bbot\./g, 'self.bot.');
  return updated;
};

const buildInteractionHandler = (componentEvents, modalEvents) => {
  let componentBody = componentEvents.trim()
    ? componentEvents.replace(/await on_button_/g, 'await self.on_button_')
    : '            pass';
  let modalBody = modalEvents.trim()
    ? modalEvents.replace(/await on_modal_/g, 'await self.on_modal_')
    : '            pass';

  return `
@commands.Cog.listener()
async def on_interaction(self, interaction):
    try:
        if interaction.type == discord.InteractionType.component:
${componentBody}
        elif interaction.type == discord.InteractionType.modal_submit:
${modalBody}
    except Exception as e:
        print(f"Interaction Error: {e}")
`.trim();
};

const buildImports = (bodyCode, needsInteractionHandler) => {
  const imports = [
    'import discord',
    'from discord import app_commands',
    'from discord.ext import commands',
  ];
  if (needsInteractionHandler || bodyCode.includes('EasyModal') || bodyCode.includes('discord.ui')) {
    imports.push('from discord import ui');
  }
  if (bodyCode.includes('random.')) imports.push('import random');
  if (bodyCode.includes('asyncio.')) imports.push('import asyncio');
  if (bodyCode.includes('datetime.')) imports.push('import datetime');
  if (bodyCode.includes('math.')) imports.push('import math');
  if (
    bodyCode.includes('_load_json_data') ||
    bodyCode.includes('_save_json_data') ||
    bodyCode.includes('json.')
  ) {
    imports.push('import json');
    imports.push('import os');
  }
  if (bodyCode.includes('logging.') || bodyCode.includes('_load_json_data') || bodyCode.includes('_save_json_data')) {
    imports.push('import logging');
  }
  return imports;
};

const buildSharedModule = (bodyCode) => {
  const usesJson =
    bodyCode.includes('_load_json_data') ||
    bodyCode.includes('_save_json_data') ||
    bodyCode.includes('json.');
  const usesModal = bodyCode.includes('EasyModal');
  const usesLogging = bodyCode.includes('logging.') || usesJson;

  if (!usesJson && !usesModal && !usesLogging) return '';

  let content = `# Shared helpers\n`;
  if (usesLogging) {
    content += `import logging\n\n`;
    content += `logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')\n\n`;
  }
  if (usesJson) {
    content += `import json\nimport os\n\n`;
    content += `def _load_json_data(filename):\n`;
    content += `    if not os.path.exists(filename):\n`;
    content += `        return {}\n`;
    content += `    try:\n`;
    content += `        with open(filename, 'r', encoding='utf-8') as f:\n`;
    content += `            return json.load(f)\n`;
    content += `    except Exception as e:\n`;
    content += `        logging.error(f"JSON Load Error: {e}")\n`;
    content += `        return {}\n\n`;
    content += `def _save_json_data(filename, data):\n`;
    content += `    try:\n`;
    content += `        with open(filename, 'w', encoding='utf-8') as f:\n`;
    content += `            json.dump(data, f, ensure_ascii=False, indent=4)\n`;
    content += `    except Exception as e:\n`;
    content += `        logging.error(f"JSON Save Error: {e}")\n\n`;
  }
  if (usesModal) {
    content += `import discord\n\n`;
    content += `class EasyModal(discord.ui.Modal):\n`;
    content += `    def __init__(self, title, custom_id, inputs):\n`;
    content += `        super().__init__(title=title, timeout=None, custom_id=custom_id)\n`;
    content += `        for item in inputs:\n`;
    content += `            self.add_item(discord.ui.TextInput(label=item['label'], custom_id=item['id']))\n`;
  }
  return content.trim();
};

const buildCogFile = (className, blocks, imports, sharedImports = '', preamble = '') => {
  const body = blocks.map((block) => indentBlock(block)).join('\n\n');
  const header = `${imports.join('\n')}\n${sharedImports}`.trim();
  const preambleBlock = preamble ? `${preamble}\n\n` : '';
  return `
${header}

${preambleBlock}class ${className}(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

${body}

async def setup(bot):
    await bot.add_cog(${className}(bot))
`.trim();
};

const buildModuleFile = (imports, sharedImports, body, preamble = '') => {
  const header = `${imports.join('\n')}\n${sharedImports}`.trim();
  const preambleBlock = preamble ? `${preamble}\n\n` : '';
  return `
${header}

${preambleBlock}${body}

async def setup(bot):
    pass
`.trim();
};

const blockCodeToString = (code) => {
  if (!code) return '';
  if (Array.isArray(code)) return code[0] || '';
  return code;
};

const slugify = (value) => {
  const base = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || 'group';
};

const toPascalCase = (value) =>
  value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const deriveGroupMeta = (block) => {
  const type = block?.type || 'group';
  let kind = 'misc';
  let label = type;

  if (['on_ready', 'on_message_create', 'on_member_join', 'on_member_remove', 'on_reaction_add'].includes(type)) {
    kind = 'event';
  } else if (type === 'on_command_executed') {
    kind = 'slash';
  } else if (type === 'prefix_command') {
    kind = 'prefix';
  } else if (type === 'on_button_click') {
    kind = 'button';
  } else if (type === 'on_modal_submit') {
    kind = 'modal';
  }

  if (type === 'on_command_executed' || type === 'prefix_command') {
    label = block.getFieldValue('COMMAND_NAME') || type;
  } else if (type === 'on_button_click' || type === 'on_modal_submit') {
    label = block.getFieldValue('CUSTOM_ID') || type;
  }

  return { kind, label, type };
};

const generateSplitPythonFiles = () => {
  if (!workspace) return {};
  const topBlocks = workspace.getTopBlocks(true);
  const topBlockEntries = topBlocks.map((block) => ({
    block,
    rawGroup: blockCodeToString(Blockly.Python.blockToCode(block)),
  }));
  const rawAll = topBlockEntries.map(({ rawGroup }) => rawGroup).join('\n');
  const { cleanedCode: allCleaned } = extractInteractionEvents(rawAll);

  const sharedModule = buildSharedModule(allCleaned);
  const files = { 'cogs/__init__.py': '' };
  if (sharedModule) files['cogs/shared.py'] = sharedModule;

  const procedureDefs = topBlockEntries
    .filter(({ block, rawGroup }) => block?.type?.startsWith('procedures_def') && rawGroup?.trim())
    .map(({ rawGroup }) => rawGroup.trim());
  const nameCounter = new Map();
  const cogsToLoad = [];

  const makeUniqueSlug = (base) => {
    const current = nameCounter.get(base) || 0;
    nameCounter.set(base, current + 1);
    return current === 0 ? base : `${base}_${current + 1}`;
  };

  topBlockEntries.forEach(({ block, rawGroup }) => {
    if (!rawGroup || !rawGroup.trim()) return;
    if (block?.type?.startsWith('procedures_def')) {
      return;
    }

    const {
      cleanedCode,
      componentEvents,
      modalEvents,
      hasComponentEvents,
      hasModalEvents,
    } = extractInteractionEvents(rawGroup);

    const { kind, label } = deriveGroupMeta(block);
    const baseSlug = slugify(`${kind}_${label}`);
    const fileSlug = makeUniqueSlug(baseSlug);
    const className = `${toPascalCase(fileSlug)}Cog`.replace(/^[0-9]/, 'Cog$&');

    const needsInteractionHandler = hasComponentEvents || hasModalEvents;
    const imports = buildImports(cleanedCode, needsInteractionHandler);
    const usesJson =
      cleanedCode.includes('_load_json_data') ||
      cleanedCode.includes('_save_json_data') ||
      cleanedCode.includes('json.');
    const usesModal = cleanedCode.includes('EasyModal');
    const sharedSymbols = [];
    if (usesJson) sharedSymbols.push('_load_json_data', '_save_json_data');
    if (usesModal) sharedSymbols.push('EasyModal');
    const sharedImports =
      sharedModule && sharedSymbols.length
        ? `from .shared import ${sharedSymbols.join(', ')}`
        : '';

    let fileContent = '';
    const procedurePreamble = procedureDefs.length ? procedureDefs.join('\n\n') : '';

    if (kind === 'event') {
      fileContent = buildCogFile(
        className,
        [convertEventBlock(cleanedCode)],
        imports,
        sharedImports,
        procedurePreamble,
      );
    } else if (kind === 'slash') {
      fileContent = buildCogFile(
        className,
        [convertSlashCommandBlock(cleanedCode)],
        imports,
        sharedImports,
        procedurePreamble,
      );
    } else if (kind === 'prefix') {
      fileContent = buildCogFile(
        className,
        [convertPrefixCommandBlock(cleanedCode)],
        imports,
        sharedImports,
        procedurePreamble,
      );
    } else if (kind === 'button' || kind === 'modal') {
      const blocks = [];
      if (needsInteractionHandler) {
        blocks.push(buildInteractionHandler(componentEvents, modalEvents));
      }
      blocks.push(convertComponentBlock(cleanedCode));
      fileContent = buildCogFile(className, blocks, imports, sharedImports, procedurePreamble);
    } else {
      fileContent = buildModuleFile(imports, sharedImports, cleanedCode.trim(), procedurePreamble);
    }

    const filePath = `cogs/${fileSlug}.py`;
    files[filePath] = fileContent;
    cogsToLoad.push(filePath.replace('cogs/', 'cogs.').replace('.py', ''));
  });

  const botFile = `
# Easy Discord Bot Builder - Split Cogs Version

import discord
from discord.ext import commands

intents = discord.Intents.default()
intents.message_content = True 
intents.members = True 
intents.voice_states = True

class EasyBot(commands.Bot):
    async def setup_hook(self):
        for ext in ${JSON.stringify(cogsToLoad)}:
            await self.load_extension(ext)

bot = EasyBot(command_prefix='!', intents=intents)

if __name__ == "__main__":
    print('\\x1b[31m!!!!Warning!!!! If you have not set a token, please set the token in the "TOKEN" section at the end of the code before execution.\\x1b[0m')
    bot.run('TOKEN')
`.trim();

  files['bot.py'] = botFile;
  return files;
};

const downloadTextFile = (filename, content) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const renderSplitFiles = (files) => {
  const container = document.getElementById('splitFileList');
  container.innerHTML = '';
  Object.entries(files).forEach(([path, content]) => {
    if (content == null) return;
    const item = document.createElement('div');
    item.className =
      'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden';
    item.innerHTML = `
      <div class="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
        <div class="text-xs font-mono text-slate-600 dark:text-slate-300">${path}</div>
        <div class="flex items-center gap-2">
          <button class="splitCopyBtn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800" data-path="${path}">
            <i data-lucide="copy" class="w-3.5 h-3.5"></i> Copy
          </button>
          <button class="splitDownloadBtn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white" data-path="${path}">
            <i data-lucide="download" class="w-3.5 h-3.5"></i> DL
          </button>
        </div>
      </div>
      <pre class="p-4 text-xs font-mono bg-[#0f172a] text-[#e2e8f0] overflow-x-auto"></pre>
    `;
    const pre = item.querySelector('pre');
    if (pre) pre.textContent = content;
    container.appendChild(item);
  });

  container.querySelectorAll('.splitCopyBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const path = btn.getAttribute('data-path');
      if (!path || !files[path]) return;
      navigator.clipboard.writeText(files[path]);
      btn.textContent = 'Copied';
      setTimeout(() => {
        btn.innerHTML = '<i data-lucide="copy" class="w-3.5 h-3.5"></i> Copy';
        lucide.createIcons();
      }, 1200);
    });
  });

  container.querySelectorAll('.splitDownloadBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const path = btn.getAttribute('data-path');
      if (!path || !files[path]) return;
      const safeName = path.replace(/\//g, '__');
      downloadTextFile(safeName, files[path]);
    });
  });

  lucide.createIcons();
};

const initializeApp = () => {
  lucide.createIcons();
  const { modernLightTheme, modernDarkTheme } = setupBlocklyEnvironment();

  const blocklyDiv = document.getElementById('blocklyDiv');
  const toolbox = document.getElementById('toolbox');
  const themeToggle = document.getElementById('themeToggle');
  const headerActions = document.getElementById('headerActions');
  const mobileHeaderToggle = document.getElementById('mobileHeaderToggle');
  // ヘッダーのコード生成ボタン
  const showCodeBtn = document.getElementById('showCodeBtn');
  // モーダル関連
  const codeModal = document.getElementById('codeModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const codeOutput = document.getElementById('codeOutput');
  const copyCodeBtn = document.getElementById('copyCodeBtn');
  const splitCodeBtn = document.getElementById('splitCodeBtn');
  const splitCodeModal = document.getElementById('splitCodeModal');
  const splitModalClose = document.getElementById('splitModalClose');
  const splitDownloadAllBtn = document.getElementById('splitDownloadAllBtn');

  const importBtn = document.getElementById('importBtn');
  const exportBtn = document.getElementById('exportBtn');
  const importInput = document.getElementById('importInput');
  const workspaceContainer = document.getElementById('workspace-container');
  const layoutBlockBtn = document.getElementById('layoutBlockBtn');
  const layoutSplitBtn = document.getElementById('layoutSplitBtn');
  const projectTitleInput = document.getElementById('projectTitleInput');
  const initialScale = isMobileDevice ? 0.85 : 1.0;
  const maxScale = isMobileDevice ? 2.2 : 3;
  const minScale = isMobileDevice ? 0.5 : 0.3;

  const resolveProjectTitle = () =>
    (projectTitleInput?.value || '').trim() || WorkspaceStorage.DEFAULT_TITLE;

  const hydrateProjectTitle = () => {
    if (!projectTitleInput) return;
    try {
      const storedTitle = localStorage.getItem(PROJECT_TITLE_STORAGE_KEY);
      if (storedTitle) {
        projectTitleInput.value = storedTitle;
        return;
      }
    } catch (error) {
      // localStorage unavailable; fall back to default
    }
    if (!projectTitleInput.value) {
      projectTitleInput.value = WorkspaceStorage.DEFAULT_TITLE;
    }
  };

  hydrateProjectTitle();

  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') html.classList.add('dark');
  const initialTheme = savedTheme === 'dark' ? modernDarkTheme : modernLightTheme;
  applyMobileToolboxIcons(toolbox);

  // --- パレット固定化の強制適用 (Zoom Fix) ---
  // フライアウト（パレット）のスケールを常に1に固定するオーバーライド
  Blockly.VerticalFlyout.prototype.getFlyoutScale = function () {
    return isMobileDevice ? 0.9 : 1;
  };

  // --- Blocklyワークスペースの初期化 ---
  workspace = Blockly.inject(blocklyDiv, {
    toolbox: toolbox,
    horizontalLayout: false,
    trashcan: true,
    zoom: {
      controls: true,
      wheel: true,
      startScale: initialScale,
      maxScale,
      minScale,
      scaleSpeed: 1.2,
    },
    renderer: 'zelos',
    theme: initialTheme,
  });

  // --- ワークスペース保存クラスの初期化 ---
  storage = new WorkspaceStorage(workspace);
  storage.setTitleProvider(() => resolveProjectTitle());

  if (projectTitleInput) {
    projectTitleInput.addEventListener('input', () => {
      try {
        localStorage.setItem(PROJECT_TITLE_STORAGE_KEY, resolveProjectTitle());
      } catch (error) {
        // ignore storage errors
      }
    });
  }

  // --- Blocklyのブロック定義 ---
  const shareFeature = initShareFeature({
    workspace,
    storage,
  });
  setupListManager({
    workspace,
    storage,
    shareFeature,
    workspaceContainer,
  });
  if (isMobileDevice && headerActions && mobileHeaderToggle) {
    mobileHeaderToggle.classList.remove('hidden');
    let headerExpanded = false;
    const syncHeaderVisibility = () => {
      headerActions.classList.toggle('collapsed', !headerExpanded);
      mobileHeaderToggle.setAttribute('aria-expanded', headerExpanded ? 'true' : 'false');
      const label = mobileHeaderToggle.querySelector('#mobileHeaderToggleText');
      if (label) label.textContent = headerExpanded ? '操作を閉じる' : '操作を表示';
      const icon = mobileHeaderToggle.querySelector('svg');
      if (icon) icon.style.transform = headerExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
      if (workspace) {
        setTimeout(() => Blockly.svgResize(workspace), 150);
      }
    };
    syncHeaderVisibility();
    mobileHeaderToggle.addEventListener('click', () => {
      headerExpanded = !headerExpanded;
      syncHeaderVisibility();
    });
  } else if (headerActions) {
    headerActions.classList.remove('collapsed');
  }

  // --- パレット（フライアウト）の固定設定 ---
  if (workspace.getToolbox()) {
    const flyout = workspace.getToolbox().getFlyout();
    if (flyout) {
      flyout.autoClose = false;
    }
  }

  // --- Layout Switching Logic ---
  const setLayout = (mode) => {
    if (mode === 'split') {
      workspaceContainer.classList.add('split-view');
      layoutSplitBtn.classList.remove('text-slate-500', 'dark:text-slate-400');
      layoutSplitBtn.classList.add(
        'bg-white',
        'dark:bg-slate-800',
        'shadow-sm',
        'text-indigo-600',
        'dark:text-indigo-400',
      );

      layoutBlockBtn.classList.remove(
        'bg-white',
        'dark:bg-slate-800',
        'shadow-sm',
        'text-indigo-600',
        'dark:text-indigo-400',
      );
      layoutBlockBtn.classList.add('text-slate-500', 'dark:text-slate-400');
      updateLivePreview();
    } else {
      workspaceContainer.classList.remove('split-view');
      layoutBlockBtn.classList.remove('text-slate-500', 'dark:text-slate-400');
      layoutBlockBtn.classList.add(
        'bg-white',
        'dark:bg-slate-800',
        'shadow-sm',
        'text-indigo-600',
        'dark:text-indigo-400',
      );

      layoutSplitBtn.classList.remove(
        'bg-white',
        'dark:bg-slate-800',
        'shadow-sm',
        'text-indigo-600',
        'dark:text-indigo-400',
      );
      layoutSplitBtn.classList.add('text-slate-500', 'dark:text-slate-400');
    }
    setTimeout(() => Blockly.svgResize(workspace), 350);
  };

  layoutBlockBtn.addEventListener('click', () => setLayout('block'));
  layoutSplitBtn.addEventListener('click', () => setLayout('split'));

  if (isMobileDevice) {
    layoutBlockBtn?.classList.add('hidden');
    layoutSplitBtn?.classList.add('hidden');
  }

  // --- Realtime Sync ---
  workspace.addChangeListener((e) => {
    // UIイベント以外で更新
    if (e.type !== Blockly.Events.UI && workspaceContainer.classList.contains('split-view')) {
      updateLivePreview();
    }

    // Auto Save
    if (
      !shareFeature.isShareViewMode() &&
      !e.isUiEvent &&
      e.type !== Blockly.Events.FINISHED_LOADING
    ) {
      storage?.save();
      const saveStatus = document.getElementById('saveStatus');
      saveStatus.setAttribute('data-show', 'true');
      setTimeout(() => saveStatus.setAttribute('data-show', 'false'), 2000);
    }
  });

  // --- Toolbox Pin Button (Re-implementation) ---
  const pinBtn = document.createElement('button');
  pinBtn.id = 'toolboxPinBtn';
  pinBtn.className =
    'absolute z-20 p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:text-slate-500 dark:hover:text-indigo-400 dark:hover:bg-indigo-900/30 transition-all duration-200 shadow-sm border border-transparent hover:border-indigo-100 dark:hover:border-indigo-900/50';
  pinBtn.style.top = '12px';

  const updatePinState = () => {
    if (!workspace) return;
    const toolbox = workspace.getToolbox();
    if (!toolbox) return;

    let isVisible = true;
    if (typeof toolbox.isVisible === 'function') {
      isVisible = toolbox.isVisible();
    } else if (typeof toolbox.getWidth === 'function') {
      isVisible = toolbox.getWidth() > 0;
    }

    const width = typeof toolbox.getWidth === 'function' ? toolbox.getWidth() : 0;

    if (isVisible) {
      pinBtn.style.left = `${width - 38}px`;
      pinBtn.innerHTML =
        '<i data-lucide="pin" class="w-3.5 h-3.5 fill-indigo-500 text-indigo-600"></i>';
      pinBtn.classList.add('bg-white', 'dark:bg-slate-800');
    } else {
      pinBtn.style.left = '12px';
      pinBtn.innerHTML = '<i data-lucide="pin-off" class="w-3.5 h-3.5"></i>';
      pinBtn.classList.remove('bg-white', 'dark:bg-slate-800');
      pinBtn.classList.add('bg-white/80', 'dark:bg-slate-800/80', 'backdrop-blur-sm');
    }
    lucide.createIcons();
  };

  pinBtn.onclick = () => {
    const toolbox = workspace.getToolbox();
    if (!toolbox) return;
    const isVisible =
      typeof toolbox.isVisible === 'function' ? toolbox.isVisible() : toolbox.getWidth() > 0;
    if (typeof toolbox.setVisible === 'function') toolbox.setVisible(!isVisible);
    Blockly.svgResize(workspace);
    setTimeout(updatePinState, 50);
  };
  document.getElementById('blocklyDiv').appendChild(pinBtn);
  // ピン留めボタンの表示/非表示切り替え
  const syncPinVisibility = (isViewOnly = shareFeature.isShareViewMode()) => {
    pinBtn.classList.toggle('hidden', isViewOnly);
    pinBtn.setAttribute('aria-hidden', isViewOnly ? 'true' : 'false');
  };
  // 共有リンクの閲覧モードではユーザーにツールボックス表示切替を触らせない
  shareFeature.onShareViewModeChange((isViewOnly) => {
    syncPinVisibility(isViewOnly);
    if (!isViewOnly) {
      setTimeout(updatePinState, 50);
    }
  });
  syncPinVisibility();
  setTimeout(updatePinState, 100);
  window.addEventListener('resize', () => {
    Blockly.svgResize(workspace);
    updatePinState();
  });
  workspace.addChangeListener((e) => {
    if (e.type === Blockly.Events.TOOLBOX_ITEM_SELECT) setTimeout(updatePinState, 50);
  });

  // --- Load Saved Data ---
  const sharedApplied = shareFeature.applySharedLayoutFromQuery();
  if (!sharedApplied) {
    storage?.load();
  }

  const toggleTheme = () => {
    const currentTheme = html.classList.contains('dark') ? 'dark' : 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    html.classList.remove(currentTheme);
    html.classList.add(newTheme);
    localStorage.setItem('theme', newTheme);
    if (workspace) {
      workspace.setTheme(newTheme === 'dark' ? modernDarkTheme : modernLightTheme);
    }
    // Re-apply share view UI state (e.g. hide toolbox)
    if (shareFeature.isShareViewMode()) {
      shareFeature.applyUiState();
    }
  };

  themeToggle.addEventListener('click', toggleTheme);

  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file || !storage) return;
    storage
      .importFile(file)
      .then(() => {
        Blockly.svgResize(workspace);
      })
      .catch((err) => console.error(err))
      .finally(() => {
        e.target.value = '';
      });
  });

  exportBtn.addEventListener('click', () => {
    storage?.exportFile();
  });

  // --- モーダル表示ロジック (アニメーション付き) ---
  showCodeBtn.addEventListener('click', () => {
    showCodeBtn.blur();
    // Blocklyの選択ハイライトなどを解除
    if (workspace) Blockly.hideChaff();
    codeOutput.textContent = generatePythonCode();
    codeModal.classList.remove('hidden');
    codeModal.classList.add('flex');
    // Force reflow
    void codeModal.offsetWidth;
    codeModal.classList.add('show-modal');
  });

  const openSplitModal = () => {
    if (!splitCodeModal) return;
    const files = generateSplitPythonFiles();
    renderSplitFiles(files);
    splitCodeModal.classList.remove('hidden');
    splitCodeModal.classList.add('flex');
    void splitCodeModal.offsetWidth;
    splitCodeModal.classList.add('show-modal');
  };

  splitCodeBtn?.addEventListener('click', () => {
    openSplitModal();
  });

  closeModalBtn.addEventListener('click', () => {
    codeModal.classList.remove('show-modal');
    setTimeout(() => {
      codeModal.classList.remove('flex');
      codeModal.classList.add('hidden');
    }, 300); // Wait for transition
  });

  splitModalClose?.addEventListener('click', () => {
    splitCodeModal.classList.remove('show-modal');
    setTimeout(() => {
      splitCodeModal.classList.remove('flex');
      splitCodeModal.classList.add('hidden');
    }, 300);
  });

  splitDownloadAllBtn?.addEventListener('click', () => {
    const files = generateSplitPythonFiles();
    Object.entries(files).forEach(([path, content]) => {
      if (content == null) return;
      const safeName = path.replace(/\//g, '__');
      downloadTextFile(safeName, content);
    });
  });

  copyCodeBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(codeOutput.textContent);
    const originalHtml = copyCodeBtn.innerHTML;
    copyCodeBtn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i> コピー完了';
    copyCodeBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-500');
    copyCodeBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-500', 'border-emerald-400');
    lucide.createIcons();

    setTimeout(() => {
      copyCodeBtn.innerHTML = originalHtml;
      copyCodeBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-500');
      copyCodeBtn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500', 'border-emerald-400');
      lucide.createIcons();
    }, 2000);
  });
};

window.onload = initializeApp;
