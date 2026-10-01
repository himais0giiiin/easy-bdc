// editor/core/export.js

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

// innerHTML へ埋め込む文字列のエスケープ（属性値でも安全なようにクォートも対象）
const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// 生成コードの整形: 行末の空白を除去し、3行以上の連続空行を2行に圧縮してファイルを軽くする
const normalizePythonOutput = (code) => {
  const cleaned = String(code || '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return cleaned ? `${cleaned}\n` : '';
};

// 使用しているブロックに必要な intent だけを有効化する
// (不要な特権インテントを要求しないことで、Developer Portal での設定ミスも防ぐ)
const buildIntentsSection = (bodyCode) => {
  const source = String(bodyCode || '');
  const flags = [];
  if (/async def on_message|process_commands|@(?:bot|commands)\.command\b|message\.content/.test(source)) {
    flags.push('intents.message_content = True');
  }
  if (/on_member_join|on_member_remove|\.members\b|fetch_members/.test(source)) {
    flags.push('intents.members = True');
  }
  if (/voice|FFmpeg/i.test(source)) {
    flags.push('intents.voice_states = True');
  }
  return ['intents = discord.Intents.default()', ...flags].join('\n');
};

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

const buildInteractionHandler = (componentEvents, modalEvents, isCog = true) => {
  let componentBody = componentEvents.trim()
    ? (isCog ? componentEvents.replace(/await on_button_/g, 'await self.on_button_') : componentEvents)
    : '                pass';
  let modalBody = modalEvents.trim()
    ? (isCog ? modalEvents.replace(/await on_modal_/g, 'await self.on_modal_') : modalEvents)
    : '                pass';

  return `
${isCog ? '@commands.Cog.listener()' : '@bot.event'}
async def on_interaction(${isCog ? 'self, ' : ''}interaction):
    try:
        if interaction.type == discord.InteractionType.component:
${componentBody}
        elif interaction.type == discord.InteractionType.modal_submit:
${modalBody}
    except Exception as e:
        print(f"Interaction Error: {e}")
`.trim();
};

const detectJsonUsage = (code) => {
  const source = String(code || '');
  return (
    source.includes('_load_json_data') ||
    source.includes('_save_json_data') ||
    source.includes('_resolve_json_path') ||
    source.includes('_save_json_dataset_cache') ||
    source.includes('json.')
  );
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
  if (detectJsonUsage(bodyCode)) {
    imports.push('import json');
    imports.push('import os');
  }
  if (
    bodyCode.includes('logging.') ||
    detectJsonUsage(bodyCode)
  ) {
    imports.push('import logging');
  }
  return imports;
};


export const downloadTextFile = (filename, content) => {
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

export const renderSplitFiles = (files) => {
  const container = document.getElementById('splitFileList');
  container.innerHTML = '';
  Object.entries(files).forEach(([path, content]) => {
    if (content == null) return;
    const item = document.createElement('div');
    item.className =
      'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden';
    const safePath = escapeHtml(path);
    item.innerHTML = `
      <div class="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono text-xs">
        <div class="text-slate-600 dark:text-slate-300 font-bold overflow-hidden text-ellipsis whitespace-nowrap" title="${safePath}">${safePath}</div>
        <div class="flex items-center gap-2 shrink-0">
          <button class="splitCopyBtn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800" data-path="${safePath}">
            <i data-lucide="copy" class="w-3.5 h-3.5"></i> Copy
          </button>
          <button class="splitDownloadBtn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm" data-path="${safePath}">
            <i data-lucide="download" class="w-3.5 h-3.5"></i> DL
          </button>
        </div>
      </div>
      <pre class="p-4 text-xs font-mono bg-[#0f172a] text-[#e2e8f0] overflow-x-auto selection:bg-indigo-500/30"></pre>
    `;
    const pre = item.querySelector('pre');
    if (pre) pre.textContent = content;
    container.appendChild(item);
  });

  container.querySelectorAll('.splitCopyBtn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const path = btn.getAttribute('data-path');
      if (!path || !Object.hasOwn(files, path)) return;
      try {
        await navigator.clipboard.writeText(files[path] || '');
        btn.textContent = 'Copied';
        setTimeout(() => {
          btn.innerHTML = '<i data-lucide="copy" class="w-3.5 h-3.5"></i> Copy';
          lucide.createIcons();
        }, 1200);
      } catch (err) {
        console.error('Failed to copy text: ', err);
      }
    });
  });

  container.querySelectorAll('.splitDownloadBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const path = btn.getAttribute('data-path');
      if (!path || !Object.hasOwn(files, path)) return;
      const safeName = path.replace(/\//g, '__');
      downloadTextFile(safeName, files[path]);
    });
  });

  lucide.createIcons();
};

function extractInteractionEvents(code) {
  const source = String(code || '');
  const markerRegex = /^[ \t]*#\s*(BUTTON_EVENT|MODAL_EVENT)\s*:\s*(.+?)\s*$/gm;
  const componentIds = [];
  const modalIds = [];
  let match;

  while ((match = markerRegex.exec(source)) !== null) {
    const eventType = match[1];
    const customId = String(match[2] || '').trim();
    if (!customId) continue;
    if (eventType === 'BUTTON_EVENT') {
      if (!componentIds.includes(customId)) componentIds.push(customId);
    } else if (eventType === 'MODAL_EVENT') {
      if (!modalIds.includes(customId)) modalIds.push(customId);
    }
  }

  const cleanedCode = source
    .split('\n')
    .filter((line) => !/^[ \t]*#\s*(BUTTON_EVENT|MODAL_EVENT)\s*:/.test(line))
    .join('\n');

  const buildDispatchBody = (ids, prefix) => {
    if (!ids.length) return '';
    const lines = [`            custom_id = str((interaction.data or {}).get('custom_id', ''))`];
    ids.forEach((id, index) => {
      const escapedId = id.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const safeId = id.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
      const keyword = index === 0 ? 'if' : 'elif';
      lines.push(`            ${keyword} custom_id == '${escapedId}':`);
      lines.push(`                await ${prefix}${safeId}(interaction)`);
    });
    return lines.join('\n');
  };

  const componentEvents = buildDispatchBody(componentIds, 'on_button_');
  const modalEvents = buildDispatchBody(modalIds, 'on_modal_');

  return {
    cleanedCode,
    componentEvents,
    modalEvents,
    hasComponentEvents: componentIds.length > 0,
    hasModalEvents: modalIds.length > 0,
  };
}

const extractInteractionEventsSafe = (code) => {
  if (typeof extractInteractionEvents === 'function') {
    return extractInteractionEvents(code);
  }
  if (typeof window !== 'undefined' && typeof window.extractInteractionEvents === 'function') {
    return window.extractInteractionEvents(code);
  }
  return {
    cleanedCode: String(code || ''),
    componentEvents: '',
    modalEvents: '',
    hasComponentEvents: false,
    hasModalEvents: false,
  };
};

const PYTHON_IDENTIFIER_PATTERN = (() => {
  try {
    return new RegExp('^[_\\p{L}][_\\p{L}\\p{N}]*$', 'u');
  } catch (error) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/;
  }
})();

const isPythonIdentifierLike = (value) => PYTHON_IDENTIFIER_PATTERN.test(String(value ?? ''));

const normalizeSlashCommandName = (rawName) => String(rawName ?? '').trim().toLowerCase().replace(/\s+/g, '_');

const COMMAND_VALIDATION_RULES = {
  on_command_executed: {
    label: 'スラッシュコマンド',
    normalize: (rawName) => String(rawName ?? '').trim().toLowerCase(),
    invalidMessage:
      'このエディターではコマンド名を Python の関数名にも使うため、先頭は文字または_、以降は文字/数字/_のみ使用できます。',
  },
  bc_slash_command: {
    label: '\u5f15\u6570\u4ed8\u304d\u30b9\u30e9\u30c3\u30b7\u30e5\u30b3\u30de\u30f3\u30c9',
    fieldName: 'NAME',
    normalize: normalizeSlashCommandName,
    invalidMessage:
      '\u3053\u306e\u30a8\u30c7\u30a3\u30bf\u30fc\u3067\u306f\u30b3\u30de\u30f3\u30c9\u540d\u3092 Python \u306e\u95a2\u6570\u540d\u306b\u3082\u4f7f\u3046\u305f\u3081\u3001\u5148\u982d\u306f\u6587\u5b57\u307e\u305f\u306f_\u3001\u4ee5\u964d\u306f\u6587\u5b57\u30fb\u6570\u5b57\u30fb_\u306e\u307f\u4f7f\u7528\u3067\u304d\u307e\u3059\u3002',
  },
  prefix_command: {
    label: 'プレフィックスコマンド',
    normalize: (rawName) => String(rawName ?? '').trim().replace(/^[!~#&?]/, ''),
    invalidMessage:
      'このエディターではコマンド名を Python の関数名にも使うため、先頭は文字または_、以降は文字/数字/_のみ使用できます。',
  },
};

const formatBlockRef = (block) => {
  const shortId = String(block?.id || '').slice(0, 8);
  return shortId ? `ブロックID: ${shortId}` : 'ブロックID不明';
};

export const analyzeWorkspaceForCodegen = (workspaceRef) => {
  if (!workspaceRef) return [];

  const diagnostics = [];
  const commandRegistry = new Map();
  const handlerRegistry = new Map();
  const relevantBlockIds = getCodegenRelevantBlockIds(workspaceRef);

  relevantBlockIds.forEach((blockId) => {
    const block = workspaceRef.getBlockById(blockId);
    if (!block || block.isShadow?.()) return;
    if (typeof block.isEnabled === 'function' && !block.isEnabled()) return;

    const rule = COMMAND_VALIDATION_RULES[block.type];
    if (!rule) return;

    const rawName = block.getFieldValue(rule.fieldName || 'COMMAND_NAME');
    const normalizedName = rule.normalize(rawName);
    const blockRef = formatBlockRef(block);
    const shownName = normalizedName || '(空)';

    if (!normalizedName) {
      diagnostics.push({
        blockId: block.id,
        message: `${rule.label}名が空です。${blockRef}`,
      });
      return;
    }

    if (!isPythonIdentifierLike(normalizedName)) {
      diagnostics.push({
        blockId: block.id,
        message: `${rule.label}名「${shownName}」は無効です。${rule.invalidMessage} ${blockRef}`,
      });
      return;
    }

    const commandKey = `${block.type}:${normalizedName}`;
    const firstRegisteredCommand = commandRegistry.get(commandKey);
    if (firstRegisteredCommand) {
      diagnostics.push({
        blockId: block.id,
        message: `${rule.label}名「${shownName}」が重複しています。${formatBlockRef(firstRegisteredCommand.block)} / ${blockRef}`,
      });
    } else {
      commandRegistry.set(commandKey, { block, normalizedName });
    }

    const handlerName = `${normalizedName}_cmd`;
    const firstRegisteredHandler = handlerRegistry.get(handlerName);
    if (firstRegisteredHandler && firstRegisteredHandler.block.id !== block.id) {
      diagnostics.push({
        blockId: block.id,
        message: `Python側の関数名「${handlerName}」が重複します。${formatBlockRef(firstRegisteredHandler.block)} / ${blockRef}`,
      });
    } else {
      handlerRegistry.set(handlerName, { block, handlerName });
    }
  });

  return diagnostics;
};

const hasNonShadowConnectedDescendant = (block) => {
  if (!block?.getChildren) return false;

  const stack = [...(block.getChildren(false) || [])];
  while (stack.length) {
    const child = stack.pop();
    if (!child) continue;

    const disabled = typeof child.isEnabled === 'function' && !child.isEnabled();
    if (!child.isShadow?.() && !disabled) {
      return true;
    }

    if (child.getChildren) {
      stack.push(...(child.getChildren(false) || []));
    }
  }

  return false;
};

const isOrphanTopBlock = (block) => {
  if (!block || block.isShadow?.()) return false;
  if (typeof block.isEnabled === 'function' && !block.isEnabled()) return false;
  if (block.getParent?.()) return false;
  if (block.previousConnection || block.outputConnection) return true;
  return !hasNonShadowConnectedDescendant(block);
};

const getCodegenTopBlocks = (workspaceRef) => {
  if (!workspaceRef?.getTopBlocks) return [];
  return workspaceRef
    .getTopBlocks(true)
    .filter((block) => block && !block.isShadow?.())
    .filter((block) => !(typeof block.isEnabled === 'function' && !block.isEnabled()))
    .filter((block) => !isOrphanTopBlock(block));
};

const getCodegenRelevantBlockIds = (workspaceRef) => {
  const ids = new Set();
  getCodegenTopBlocks(workspaceRef).forEach((topBlock) => {
    const descendants = topBlock?.getDescendants?.(false) || [topBlock];
    descendants.forEach((block) => {
      if (!block || block.isShadow?.()) return;
      if (typeof block.isEnabled === 'function' && !block.isEnabled()) return;
      ids.add(block.id);
    });
  });
  return ids;
};

const workspaceToCodeExcludingOrphans = (workspaceRef) => {
  if (!workspaceRef) return '';

  const generator = Blockly.Python;
  const code = [];
  generator.init(workspaceRef);

  getCodegenTopBlocks(workspaceRef).forEach((block) => {
    let line = generator.blockToCode(block);
    if (Array.isArray(line)) line = line[0];
    if (line) code.push(line);
  });

  if (typeof generator.finish !== 'function') {
    return code.join('\n');
  }

  const finishedCode = generator.finish(code.join('\n'));
  return String(finishedCode || '').replace(/^\s+\n/, '');
};

// --- Code Generation & UI Sync ---
const buildInlineRuntimeHelpers = ({ usesJson, usesModal, usesLogging }) => {
  let helpers = '';

  if (usesLogging) {
    helpers += `logging.basicConfig(level = logging.INFO, format = '%(asctime)s - %(levelname)s - %(message)s')\n\n`;
  }

  if (usesJson) {
    helpers += `_JSON_DATA_DIR = 'json'\n\n`;
    helpers += `def _resolve_json_path(filename):\n`;
    helpers += `    _raw_name = '' if filename is None else str(filename).strip()\n`;
    helpers += `    _safe_name = os.path.basename(_raw_name) if _raw_name else 'dataset.json'\n`;
    helpers += `    return os.path.join(_JSON_DATA_DIR, _safe_name)\n\n`;
    helpers += `def _load_json_data(filename):\n`;
    helpers += `    _path = _resolve_json_path(filename)\n`;
    helpers += `    if not os.path.exists(_path):\n`;
    helpers += `        return {}\n`;
    helpers += `    try:\n`;
    helpers += `        with open(_path, 'r', encoding = 'utf-8') as f:\n`;
    helpers += `            return json.load(f)\n`;
    helpers += `    except Exception as e:\n`;
    helpers += `        logging.error(f"JSON Load Error: {e}")\n`;
    helpers += `        return {}\n\n`;
    helpers += `def _save_json_data(filename, data):\n`;
    helpers += `    try:\n`;
    helpers += `        _path = _resolve_json_path(filename)\n`;
    helpers += `        os.makedirs(os.path.dirname(_path), exist_ok = True)\n`;
    helpers += `        with open(_path, 'w', encoding = 'utf-8') as f:\n`;
    helpers += `            json.dump(data, f, ensure_ascii = False, indent = 4)\n`;
    helpers += `    except Exception as e:\n`;
    helpers += `        logging.error(f"JSON Save Error: {e}")\n\n`;
    helpers += `def _save_json_dataset_cache():\n`;
    helpers += `    _cache = globals().get('_edbb_json_dataset_cache', {})\n`;
    helpers += `    _files = globals().get('_edbb_json_dataset_files', {})\n`;
    helpers += `    if not isinstance(_cache, dict) or not isinstance(_files, dict):\n`;
    helpers += `        return\n`;
    helpers += `    for _dataset_name, _dataset_data in _cache.items():\n`;
    helpers += `        _filename = _files.get(_dataset_name)\n`;
    helpers += `        if not _filename:\n`;
    helpers += `            continue\n`;
    helpers += `        _save_json_data(_filename, _dataset_data)\n\n`;
  }

  if (usesModal) {
    helpers += `class EasyModal(discord.ui.Modal):\n`;
    helpers += `    def __init__(self, title, custom_id, inputs):\n`;
    helpers += `        super().__init__(title = title, timeout = None, custom_id = custom_id)\n`;
    helpers += `        for item in inputs:\n`;
    helpers += `            self.add_item(discord.ui.TextInput(label = item['label'], custom_id = item['id']))\n\n`;
  }

  return helpers.trim();
};

export const generatePythonCode = (workspace) => {
  if (!workspace) return '';

  // --- Filter top-level blocks (Issue #28) ---
  // Only allow event-related blocks, procedures, and specifically allowed blocks at the top level.
  const topBlocks = workspace.getTopBlocks(true);
  const allowedTopBlockTypes = [
    'on_ready',
    'on_message_create',
    'on_member_join',
    'on_member_remove',
    'on_command_executed',
    'bc_slash_command',
    'prefix_command',
    'on_reaction_add',
    'on_button_click',
    'on_modal_submit',
    'procedures_defnoreturn',
    'procedures_defreturn',
    'print_to_console',
    'custom_python_code',
  ];

  Blockly.Python.init(workspace);
  const codeParts = [];
  topBlocks.forEach((block) => {
    if (block && !block.isShadow() && allowedTopBlockTypes.includes(block.type)) {
      let line = Blockly.Python.blockToCode(block);
      if (Array.isArray(line)) {
        // Value blocks return [code, order], but at the top level we only want the code.
        line = line[0];
      }
      if (line) {
        codeParts.push(line);
      }
    }
  });
  const rawCode = Blockly.Python.finish(codeParts.join('\n'));

  const {
    cleanedCode,
    componentEvents,
    modalEvents,
    hasComponentEvents,
    hasModalEvents,
  } = extractInteractionEventsSafe(rawCode);

  let bodyCode = cleanedCode;
  if (hasComponentEvents || hasModalEvents) {
    const handler = buildInteractionHandler(componentEvents, modalEvents, false);
    bodyCode = bodyCode.trim() + '\n\n' + handler;
  }

  // --- Dependency Analysis ---
  const usesJson = detectJsonUsage(bodyCode);
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
    'import os',
  ];
  if (needInteractionHandler || usesModal || bodyCode.includes('discord.ui')) imports.push('from discord import ui');
  if (usesRandom) imports.push('import random');
  if (usesAsyncio) imports.push('import asyncio');
  if (usesDatetime) imports.push('import datetime');
  if (usesMath) imports.push('import math');
  if (usesJson) {
    imports.push('import json');
  }
  if (usesLogging) imports.push('import logging');

  const header = imports.join('\n');
  const inlineHelpers = buildInlineRuntimeHelpers({ usesJson, usesModal, usesLogging });
  const helperSection = inlineHelpers ? `\n${inlineHelpers}\n` : '';

  const fullBoiler = `
# Easy Discord Bot Builderによって作成されました！ 製作：@himais0giiiin
# Created with Easy Discord Bot Builder! created by @himais0giiiin!

${header}

# 使用しているブロックに必要な intent のみ有効化しています
${buildIntentsSection(bodyCode)}

bot = commands.Bot(command_prefix='!', intents=intents)
${helperSection}
${bodyCode}

if __name__ == "__main__":
    # トークンの設定 / Set your token here
    token = "TOKEN"
    token = os.getenv("DISCORD_TOKEN", token) # 環境変数DISCORD_TOKENがあればそちらを優先 (If DISCORD_TOKEN environment variable is set, it will be used)
    if token == "TOKEN":
        print('\\x1b[31m!!!!注意!!!! トークンを設定していない場合は、環境変数DISCORD_TOKENを設定するか、上のtoken変数を書き換えてください。\\x1b[0m')
        print('\\x1b[31m!!!!Warning!!!! If you have not set a token, please set the DISCORD_TOKEN environment variable or replace the token variable above.\\x1b[0m')
        exit(1)

    bot.run(token)
`;

  return normalizePythonOutput(fullBoiler).trim();
};

const buildSharedModule = (bodyCode) => {
  const usesJson = detectJsonUsage(bodyCode);
  const usesModal = bodyCode.includes('EasyModal');
  const usesLogging = bodyCode.includes('logging.') || usesJson;

  if (!usesJson && !usesModal && !usesLogging) return '';

  let content = `# Shared helpers\n`;
  if (usesLogging) {
    content += `import logging\n\n`;
    content += `logging.basicConfig(level = logging.INFO, format = '%(asctime)s - %(levelname)s - %(message)s') \n\n`;
  }
  if (usesJson) {
    content += `import json\nimport os\n\n`;
    content += `_JSON_DATA_DIR = 'json'\n\n`;
    content += `def _resolve_json_path(filename): \n`;
    content += `    _raw_name = '' if filename is None else str(filename).strip() \n`;
    content += `    _safe_name = os.path.basename(_raw_name) if _raw_name else 'dataset.json' \n`;
    content += `    return os.path.join(_JSON_DATA_DIR, _safe_name) \n\n`;
    content += `def _load_json_data(filename): \n`;
    content += `    _path = _resolve_json_path(filename) \n`;
    content += `    if not os.path.exists(_path): \n`;
    content += `        return {}\n`;
    content += `    try: \n`;
    content += `        with open(_path, 'r', encoding = 'utf-8') as f: \n`;
    content += `            return json.load(f) \n`;
    content += `    except Exception as e: \n`;
    content += `        logging.error(f"JSON Load Error: {e}") \n`;
    content += `        return {}\n\n`;
    content += `def _save_json_data(filename, data): \n`;
    content += `    try: \n`;
    content += `        _path = _resolve_json_path(filename) \n`;
    content += `        os.makedirs(os.path.dirname(_path), exist_ok = True) \n`;
    content += `        with open(_path, 'w', encoding = 'utf-8') as f: \n`;
    content += `            json.dump(data, f, ensure_ascii = False, indent = 4) \n`;
    content += `    except Exception as e: \n`;
    content += `        logging.error(f"JSON Save Error: {e}") \n\n`;
    content += `def _save_json_dataset_cache(): \n`;
    content += `    _cache = globals().get('_edbb_json_dataset_cache', {}) \n`;
    content += `    _files = globals().get('_edbb_json_dataset_files', {}) \n`;
    content += `    if not isinstance(_cache, dict) or not isinstance(_files, dict): \n`;
    content += `        return \n`;
    content += `    for _dataset_name, _dataset_data in _cache.items(): \n`;
    content += `        _filename = _files.get(_dataset_name) \n`;
    content += `        if not _filename: \n`;
    content += `            continue \n`;
    content += `        _save_json_data(_filename, _dataset_data) \n\n`;
  }
  if (usesModal) {
    content += `import discord\n\n`;
    content += `class EasyModal(discord.ui.Modal): \n`;
    content += `    def __init__(self, title, custom_id, inputs): \n`;
    content += `        super().__init__(title = title, timeout = None, custom_id = custom_id) \n`;
    content += `        for item in inputs: \n`;
    content += `            self.add_item(discord.ui.TextInput(label = item['label'], custom_id = item['id'])) \n`;
  }
  return content.trim();
};

const buildCogFile = (className, blocks, imports, sharedImports = '', preamble = '') => {
  const body = blocks.map((block) => indentBlock(block)).join('\n\n');
  const header = `${imports.join('\n')} \n${sharedImports} `.trim();
  const preambleBlock = preamble ? `${preamble} \n\n` : '';
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
  const header = `${imports.join('\n')} \n${sharedImports} `.trim();
  const preambleBlock = preamble ? `${preamble} \n\n` : '';
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
  } else if (type === 'on_command_executed' || type === 'bc_slash_command') {
    kind = 'slash';
  } else if (type === 'prefix_command') {
    kind = 'prefix';
  } else if (type === 'on_button_click') {
    kind = 'button';
  } else if (type === 'on_modal_submit') {
    kind = 'modal';
  }

  if (type === 'on_command_executed' || type === 'bc_slash_command' || type === 'prefix_command') {
    label = block.getFieldValue(type === 'bc_slash_command' ? 'NAME' : 'COMMAND_NAME') || type;
  } else if (type === 'on_button_click' || type === 'on_modal_submit') {
    label = block.getFieldValue('CUSTOM_ID') || type;
  }

  return { kind, label, type };
};

export const generateSplitPythonFiles = (workspace) => {
  if (!workspace) return {};
  Blockly.Python.init(workspace);
  const topBlocks = getCodegenTopBlocks(workspace);
  const topBlockEntries = topBlocks.map((block) => {
    const code = blockCodeToString(Blockly.Python.blockToCode(block));
    return { block, rawGroup: code };
  });
  const finishedCode = Blockly.Python.finish(topBlockEntries.map(({ rawGroup }) => rawGroup).join('\n'));
  const rawAll = finishedCode;
  const { cleanedCode: allCleaned } = extractInteractionEventsSafe(rawAll);

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
    } = extractInteractionEventsSafe(rawGroup);

    const { kind, label } = deriveGroupMeta(block);
    const baseSlug = slugify(`${kind}_${label}`);
    const fileSlug = makeUniqueSlug(baseSlug).trim();
    const className = `${toPascalCase(fileSlug)}Cog`.replace(/^[0-9]/, 'Cog$&');

    const needsInteractionHandler = hasComponentEvents || hasModalEvents;
    const imports = buildImports(cleanedCode, needsInteractionHandler);

    const usesJson = detectJsonUsage(cleanedCode);
    const usesModal = cleanedCode.includes('EasyModal');
    const sharedSymbols = [];
    if (usesJson) sharedSymbols.push('_load_json_data', '_save_json_data', '_resolve_json_path', '_save_json_dataset_cache');
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

import os
import discord
from discord.ext import commands

# 使用しているブロックに必要な intent のみ有効化しています
${buildIntentsSection(allCleaned)}

class EasyBot(commands.Bot):
    async def setup_hook(self):
        for ext in ${JSON.stringify(cogsToLoad)}:
            await self.load_extension(ext)

bot = EasyBot(command_prefix='!', intents=intents)

if __name__ == "__main__":
    # トークンの設定
    # Set your token here
    token = "TOKEN"

    # Token check
    token = os.getenv("DISCORD_TOKEN", token) # 環境変数DISCORD_TOKENがあればそちらを優先 (If DISCORD_TOKEN environment variable is set, it will be used)
    if token == "TOKEN":
        print('\\x1b[31m!!!!注意!!!! トークンを設定していない場合は、環境変数DISCORD_TOKENを設定するか、上のtoken変数を書き換えてください。\\x1b[0m')
        print('\\x1b[31m!!!!Warning!!!! If you have not set a token, please set the DISCORD_TOKEN environment variable or replace the token variable above.\\x1b[0m')
        exit(1)

    bot.run(token)
`.trim();

  files['bot.py'] = botFile;

  // 各ファイルの末尾スペース・余分な空行を除去して軽量化する
  Object.keys(files).forEach((path) => {
    if (path.endsWith('.py') && files[path]) {
      files[path] = normalizePythonOutput(files[path]);
    }
  });
  return files;
};