import { initEvents } from './events.js';
import { initMessages } from './messages.js';
import { initCommands } from './commands.js';
import { initUsers } from './users.js';
import { initChannels } from './channels.js';
import { initEmbeds } from './embed.js';
import { initJson } from './json.js';
import { initLists } from './lists.js';
import { initUI } from './ui.js';
import { initMisc } from './misc.js';

export function initializeBlocks() {
    initEvents();
    initMessages();
    initCommands();
    initUsers();
    initChannels();
    initEmbeds();
    initJson();
    initLists();
    initUI();
    initMisc();
}

// Call the initialization to register all blocks and generators to the global Blockly object
initializeBlocks();

// Export the global Blockly object for backward compatibility
export default window.Blockly;
