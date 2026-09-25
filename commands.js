// commands.js
// REGISTRY: Sammelt ALLE Slash-Commands an EINER Stelle - mit Kategorie
// (für /help), Zugriffsstufe (für permissions.js) und Geltungsbereich.
// index.js, deploy-commands.js und command-tools.js importieren nur diese Datei.
//
// Eintrag: [command, { category, access, scope }]
//   category: general | moderation | admin | welcome | tickets | utility | xp | bot | ai
//   access  : everyone | mod | admin | bot-owner | superuser  (oder { default, sub: {...} })
//   scope   : 'anywhere' (Server, DMs, User-Install) | 'guild' (nur Server, in denen der Bot ist)
//
// Neuer Command? Modul importieren und hier EINE Zeile ergänzen - /help,
// Registrierung und Berechtigungsprüfung übernehmen den Rest automatisch.

const core = require('./commands-core');
const mod = require('./commands-mod');
const extra = require('./commands-extra');
const utility = require('./commands-utility');
const { settings } = require('./commands-settings');
const { ticketPanel } = require('./commands-tickets');
const { automodWords } = require('./commands-automod-words');
const { automodCmd } = require('./commands-automod');
const { welcomeSetup } = require('./commands-welcome');
const { appearence } = require('./commands-appearance');
const { admReload } = require('./commands-admin');
const { botStatus, bstatnow } = require('./commands-presence');
const { xpBoard, xpSet, xpStats, xpGlobal } = require('./commands-xp');

const help = core.buildHelpCommand(() => allCommands);

const registry = [
  // Allgemein
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

  // Moderation (Moderator-Rolle, Administrator-Rolle oder Server-Owner)
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
  [automodWords, { category: 'admin', access: 'admin', scope: 'guild' }],
  [automodCmd, { category: 'admin', access: 'admin', scope: 'guild' }],
  [appearence, { category: 'admin', access: { default: 'everyone', sub: { nickname: 'admin', profile: 'admin', color: 'admin' } }, scope: 'guild' }],

  // Welcome
  [welcomeSetup, { category: 'welcome', access: 'admin', scope: 'guild' }],

  // XP
  [xpBoard, { category: 'xp', access: 'admin', scope: 'guild' }],
  [xpSet, { category: 'xp', access: 'superuser', scope: 'anywhere' }],
  [xpStats, { category: 'xp', access: 'everyone', scope: 'guild' }],
  [xpGlobal, { category: 'xp', access: 'everyone', scope: 'anywhere' }],

  // Tickets
  [ticketPanel, { category: 'tickets', access: 'admin', scope: 'guild' }],

  // Nützliches & Spaß
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

// Sicherheitsnetz: doppelte Namen sofort beim Laden melden.
const seen = new Set();
for (const cmd of allCommands) {
  const name = cmd.data.name;
  if (seen.has(name)) throw new Error(`Command /${name} ist doppelt in commands.js registriert.`);
  seen.add(name);
}

module.exports = allCommands;
