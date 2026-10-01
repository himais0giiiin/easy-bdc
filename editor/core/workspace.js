// editor/core/workspace.js

export const setupBlocklyEnvironment = () => {
  // Modern Theme Definition

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

  // blocks.js has already extended the global Blockly object
  // Keep indentation width fixed so generated function bodies are consistent.
  Blockly.Python.INDENT = '    ';

  return { modernLightTheme, modernDarkTheme };
};

const PRIMITIVE_LITERAL_INPUT_CHECKS = new Set(['String', 'Number']);

const getLiteralShadowTypeForChecks = (checks) => {
  const normalized = (Array.isArray(checks) ? checks : [checks]).filter(Boolean);
  if (!normalized.length) return null;
  const uniqueChecks = [...new Set(normalized)];
  if (uniqueChecks.some((check) => !PRIMITIVE_LITERAL_INPUT_CHECKS.has(check))) {
    return null;
  }
  if (uniqueChecks.includes('Number')) {
    return 'math_number';
  }
  return 'text';
};

const createLiteralShadowBlock = (workspaceRef, blockType) => {
  if (!workspaceRef || !blockType) return null;
  const shadow = workspaceRef.newBlock(blockType);
  shadow.setShadow(true);
  if (blockType === 'math_number') {
    shadow.setFieldValue('0', 'NUM');
  }
  if (blockType === 'text') {
    shadow.setFieldValue('', 'TEXT');
  }
  if (workspaceRef.rendered) {
    shadow.initSvg?.();
    shadow.render?.();
  }
  return shadow;
};

const ensureLiteralShadowForInput = (block, input) => {
  const valueInputType = Blockly.inputTypes?.VALUE ?? Blockly.INPUT_VALUE;
  if (!input || input.type !== valueInputType) return;
  const connection = input.connection;
  if (!connection || connection.targetConnection) return;
  const blockType = getLiteralShadowTypeForChecks(connection.getCheck?.() || null);
  if (!blockType) return;
  const shadow = createLiteralShadowBlock(block.workspace, blockType);
  if (!shadow?.outputConnection) return;
  try {
    connection.connect(shadow.outputConnection);
  } catch (error) {
    shadow.dispose(false, true);
  }
};

const ensureLiteralShadowsForBlock = (block) => {
  if (!block || block.isShadow?.() || block.isInsertionMarker?.()) return;
  if (block.workspace?.isFlyout) return;
  for (const input of block.inputList || []) {
    ensureLiteralShadowForInput(block, input);
  }
};

const ensureLiteralShadowsForWorkspace = (workspaceRef) => {
  for (const block of workspaceRef?.getAllBlocks(false) || []) {
    ensureLiteralShadowsForBlock(block);
  }
};

export const setupLiteralInputAutofill = (workspaceRef) => {
  if (!workspaceRef) return;

  const queueBlockCheck = (blockId) => {
    if (!blockId) return;
    setTimeout(() => {
      const block = workspaceRef.getBlockById(blockId);
      ensureLiteralShadowsForBlock(block);
    }, 0);
  };

  workspaceRef.addChangeListener((event) => {
    if (!event || event.isUiEvent) return;
    if (event.type === Blockly.Events.FINISHED_LOADING) {
      ensureLiteralShadowsForWorkspace(workspaceRef);
      return;
    }
    if (event.type === Blockly.Events.BLOCK_CREATE) {
      for (const id of event.ids || []) {
        queueBlockCheck(id);
      }
      return;
    }
    if (event.type === Blockly.Events.BLOCK_MOVE) {
      queueBlockCheck(event.blockId);
      queueBlockCheck(event.newParentId);
      queueBlockCheck(event.oldParentId);
      return;
    }
    if (event.type === Blockly.Events.BLOCK_CHANGE) {
      queueBlockCheck(event.blockId);
    }
  });

  ensureLiteralShadowsForWorkspace(workspaceRef);
};
