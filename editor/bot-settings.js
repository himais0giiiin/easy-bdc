export const BOT_SETTINGS_EXTRA_STATE_KEY = 'edbbBotSettings';

export const DEFAULT_BOT_SETTINGS = Object.freeze({
  commandPrefix: '!',
  autoDetectIntents: true,
  messageContent: false,
  members: false,
  presences: false,
  voiceStates: false,
});

const normalizeBoolean = (value, fallback = false) =>
  typeof value === 'boolean' ? value : fallback;

export const normalizeCommandPrefix = (value) => {
  const normalized = String(value ?? '')
    .replace(/[\r\n\t]/g, '')
    .trim()
    .slice(0, 8);
  return normalized || DEFAULT_BOT_SETTINGS.commandPrefix;
};

export const normalizeBotSettings = (value = {}) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    commandPrefix: normalizeCommandPrefix(source.commandPrefix),
    autoDetectIntents: normalizeBoolean(
      source.autoDetectIntents,
      DEFAULT_BOT_SETTINGS.autoDetectIntents,
    ),
    messageContent: normalizeBoolean(source.messageContent),
    members: normalizeBoolean(source.members),
    presences: normalizeBoolean(source.presences),
    voiceStates: normalizeBoolean(source.voiceStates),
  };
};

export const getWorkspaceBotSettings = (workspace) =>
  normalizeBotSettings(workspace?.__edbbBotSettings);

export const buildIntentsSection = (bodyCode, settingsValue) => {
  const source = String(bodyCode || '');
  const settings = normalizeBotSettings(settingsValue);
  const enabled = {
    messageContent: settings.messageContent,
    members: settings.members,
    presences: settings.presences,
    voiceStates: settings.voiceStates,
  };

  if (settings.autoDetectIntents) {
    enabled.messageContent ||= /async def on_message|process_commands|@(?:bot|commands)\.command\b|message\.content/.test(source);
    enabled.members ||= /on_member_join|on_member_remove|\.members\b|fetch_members/.test(source);
    enabled.presences ||= /on_presence_update|\.status\b|\.activity\b|\.activities\b/.test(source);
    enabled.voiceStates ||= /voice|FFmpeg/i.test(source);
  }

  const flags = [];
  if (enabled.messageContent) flags.push('intents.message_content = True');
  if (enabled.members) flags.push('intents.members = True');
  if (enabled.presences) flags.push('intents.presences = True');
  if (enabled.voiceStates) flags.push('intents.voice_states = True');
  return ['intents = discord.Intents.default()', ...flags].join('\n');
};

export const attachBotSettingsState = (workspace, onChange = () => {}, { persistDefaults = true } = {}) => {
  if (!workspace) throw new TypeError('workspace is required');

  let settings = getWorkspaceBotSettings(workspace);
  let hasSettings = persistDefaults || Boolean(workspace.__edbbBotSettings);
  workspace.__edbbBotSettings = settings;
  const originalGetExtraState = workspace.getExtraState?.bind(workspace);
  const originalSetExtraState = workspace.setExtraState?.bind(workspace);

  const notify = (source) => onChange({ ...settings }, source);

  workspace.getExtraState = () => {
    const base = originalGetExtraState ? originalGetExtraState() : {};
    const safeBase = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
    return hasSettings ? { ...safeBase, [BOT_SETTINGS_EXTRA_STATE_KEY]: { ...settings } } : { ...safeBase };
  };

  workspace.setExtraState = (state) => {
    if (originalSetExtraState) originalSetExtraState(state);
    settings = normalizeBotSettings(state?.[BOT_SETTINGS_EXTRA_STATE_KEY]);
    hasSettings = persistDefaults || Object.hasOwn(state || {}, BOT_SETTINGS_EXTRA_STATE_KEY);
    workspace.__edbbBotSettings = settings;
    notify('load');
  };

  return {
    get: () => ({ ...settings }),
    set: (next) => {
      hasSettings = true;
      settings = normalizeBotSettings({ ...settings, ...next });
      workspace.__edbbBotSettings = settings;
      notify('local');
      return { ...settings };
    },
  };
};
