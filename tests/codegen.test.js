import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePythonCode, generateSplitPythonFiles } from '../editor/core/export.js';

const makeBlock = (type, code) => ({
  type, code, isShadow: () => false, isEnabled: () => true,
  getChildren: () => [{ isShadow: () => false, isEnabled: () => true }],
});

function workspaceWith(blocks) {
  globalThis.Blockly = { Python: {
    init() {}, blockToCode: block => block.code, finish: code => code,
  } };
  return { getTopBlocks: () => blocks };
}

test('split message listeners do not dispatch prefix commands a second time', () => {
  const event = makeBlock('on_message_create', `
@bot.event
async def on_message(message):
    print(message.content)
    await bot.process_commands(message)
`);
  const workspace = workspaceWith([event]);
  assert.match(generatePythonCode(workspace), /await bot\.process_commands\(message\)/);
  const files = generateSplitPythonFiles(workspace);
  const listener = files['cogs/event_on_message_create.py'];
  assert.match(listener, /@commands\.Cog\.listener\(\)/);
  assert.match(listener, /async def on_message\(self, message\)/);
  assert.match(listener, /print\(message.content\)/);
  assert.doesNotMatch(listener, /process_commands/);
});

test('split modules import dependencies and helpers used inside procedures', () => {
  const procedure = makeBlock('procedures_defnoreturn', `
async def helper():
    await asyncio.sleep(1)
    print(random.randint(1, 2))
    print(datetime.datetime.now())
    print(math.floor(1.5))
    print(_load_json_data('data.json'))
    return EasyModal('title', 'id', [])
`);
  const event = makeBlock('on_ready', `
@bot.event
async def on_ready():
    await helper()
`);
  const files = generateSplitPythonFiles(workspaceWith([procedure, event]));
  const module = files['cogs/event_on_ready.py'];
  for (const dependency of ['asyncio', 'random', 'datetime', 'math', 'json', 'os']) {
    assert.match(module, new RegExp(`import ${dependency}\\b`));
  }
  assert.match(module, /from \.shared import .*_load_json_data.*EasyModal/);
  assert.match(module, /async def helper\(\)/);
  assert.match(files['cogs/shared.py'], /class EasyModal/);
});

test('custom block initialization preserves Blockly rounding operations', async () => {
  const standardRoundingGenerator = () => ['math.ceil(1.5)', 2];
  globalThis.Blockly = {
    FieldDropdown: class {}, Blocks: {},
    Python: { forBlock: { math_round: standardRoundingGenerator } },
  };
  const { initMisc } = await import('../editor/blocks/misc.js');
  initMisc();
  assert.equal(Blockly.Python.forBlock.math_round, standardRoundingGenerator);
});
