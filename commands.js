// commands.js
// REGISTRY: collects ALL slash commands in ONE place - with category (for
// /help), access level (for permissions.js) and scope.
// index.js, deploy-commands.js and command-tools.js only import this file.
//
// Eintrag: [command, { category, access, scope }]
//   category: general | moderation | admin | welcome | tickets | utility | xp | bot | ai
//   access  : everyone | mod | admin | bot-owner | superuser  (or { default, sub: {...} })
//   scope   : 'anywhere' (servers, DMs, user install) | 'guild' (only servers the bot is in)
//
// New command? Import the module and add ONE line here - /help, registration
// and permission checking take care of the rest automatically.

const core = require('./commands-core');
const mod = require('./commands-mod');
const extra = require('./commands-extra');
const utility = require('./commands-utility');
const { settings } = require('./commands-settings');
const { ticket, ticketClose, ticketPanel } = require('./commands-tickets');
const { automodWords } = require('./commands-automod-words');
const { automodCmd } = require('./commands-automod');
const { welcomeSetup } = require('./commands-welcome');
const { appearence } = require('./commands-appearance');
const { admReload } = require('./commands-admin');
const { botStatus, bstatnow } = require('./commands-presence');
const { xpBoard, xpSet, xpStats, xpGlobal } = require('./commands-xp');
const { applyConfig, applyPanel } = require('./commands-apply');
const { config } = require('./commands-config');

const help = core.buildHelpCommand(() => allCommands);

const registry = [
  // General
  [core.antimdm, { category: 'general', access: 'everyone', scope: 'anywhere' }],
  [core.web, { category: 'general', access: 'everyone', scope: 'anywhere' }],
  [core.uptime, { category: 'general', access: 'everyone', scope: 'anywhere' }],
  [core.status, { category: 'general', access: 'everyone', scope: 'anywhere' }],
  [core.changelog, { category: 'general', access: 'everyone', scope: 'anywhere' }],
  [core.links, { category: 'general', access: 'everyone', scope: 'anywhere' }],
  [core.botinfo, { category: 'bot', access: 'everyone', scope: 'anywhere' }],
  [extra.ping, { category: 'general', access: 'everyone', scope: 'anywhere' }],
  [help, { category: 'general', access: 'everyone', scope: 'anywhere' }],
  [core.reload, { category: 'bot', access: 'bot-owner', scope: 'anywhere' }],
  [admReload, { category: 'bot', access: 'admin', scope: 'guild' }],
  [botStatus, { category: 'bot', access: 'bot-owner', scope: 'guild' }],
  [bstatnow, { category: 'bot', access: 'superuser', scope: 'anywhere' }],

  // Moderation (moderator role, administrator role, or server owner)
  [mod.kick, { category: 'moderation', access: 'mod', scope: 'guild' }],
  [mod.ban, { category: 'moderation', access: 'mod', scope: 'guild' }],
  [mod.timeout, { category: 'moderation', access: 'mod', scope: 'guild' }],
  [mod.warn, { category: 'moderation', access: 'mod', scope: 'guild' }],
  [mod.clear, { category: 'moderation', access: 'mod', scope: 'guild' }],
  [mod.slowmode, { category: 'moderation', access: 'mod', scope: 'guild' }],
  [mod.lock, { category: 'moderation', access: 'mod', scope: 'guild' }],
  [mod.unlock, { category: 'moderation', access: 'mod', scope: 'guild' }],
  [mod.nickname, { category: 'moderation', access: 'mod', scope: 'guild' }],
  [extra.role, { category: 'moderation', access: 'mod', scope: 'guild' }],
  [extra.purgeUser, { category: 'moderation', access: 'mod', scope: 'guild' }],
  [extra.say, { category: 'moderation', access: 'mod', scope: 'guild' }],

  // Administration
  [settings, { category: 'admin', access: 'admin', scope: 'guild' }],
  [config, { category: 'admin', access: { default: 'admin', sub: { macrumors: 'mod' } }, scope: 'guild' }],
  [automodWords, { category: 'admin', access: 'admin', scope: 'guild' }],
  [automodCmd, { category: 'admin', access: { default: 'admin', sub: { 'setup-all': 'bot-owner' } }, scope: 'guild' }],
  [appearence, { category: 'admin', access: { default: 'everyone', sub: { nickname: 'admin', profile: 'admin', color: 'admin' } }, scope: 'guild' }],

  // Welcome
  [welcomeSetup, { category: 'welcome', access: 'admin', scope: 'guild' }],

  // Applications
  [applyConfig, { category: 'apply', access: 'admin', scope: 'guild' }],
  [applyPanel, { category: 'apply', access: 'admin', scope: 'guild' }],


  // XP
  [xpBoard, { category: 'xp', access: 'admin', scope: 'guild' }],
  [xpSet, { category: 'xp', access: 'superuser', scope: 'anywhere' }],
  [xpStats, { category: 'xp', access: 'everyone', scope: 'guild' }],
  [xpGlobal, { category: 'xp', access: 'everyone', scope: 'anywhere' }],

  // Tickets
  [ticket, { category: 'tickets', access: 'everyone', scope: 'guild' }],
  [ticketClose, { category: 'tickets', access: 'everyone', scope: 'anywhere' }],
  [ticketPanel, { category: 'tickets', access: 'admin', scope: 'guild' }],

  // Utility & fun
  [utility.userinfo, { category: 'utility', access: 'everyone', scope: 'anywhere' }],
  [utility.serverinfo, { category: 'utility', access: 'everyone', scope: 'guild' }],
  [utility.avatar, { category: 'utility', access: 'everyone', scope: 'anywhere' }],
  [utility.poll, { category: 'utility', access: 'everyone', scope: 'guild' }],
  [extra.remindme, { category: 'utility', access: 'everyone', scope: 'anywhere' }],
  [extra.suggest, { category: 'utility', access: 'everyone', scope: 'guild' }],
  [extra.coinflip, { category: 'utility', access: 'everyone', scope: 'anywhere' }],
  [extra.dice, { category: 'utility', access: 'everyone', scope: 'anywhere' }],
  [extra.eightball, { category: 'utility', access: 'everyone', scope: 'anywhere' }],
  [extra.membercount, { category: 'utility', access: 'everyone', scope: 'guild' }],
  [extra.roleinfo, { category: 'utility', access: 'everyone', scope: 'guild' }],
];

const allCommands = registry.map(([cmd, meta]) => {
  cmd.category = meta.category;
  cmd.access = meta.access;
  cmd.scope = meta.scope;
  return cmd;
});

// Safety net: report duplicate names immediately on load.
const seen = new Set();
for (const cmd of allCommands) {
  const name = cmd.data.name;
  if (seen.has(name)) throw new Error(`Command /${name} is registered twice in commands.js.`);
  seen.add(name);
}

module.exports = allCommands;
