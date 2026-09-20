// commands.js
// Sammelt ALLE Slash-Commands in einem Array. index.js und deploy-commands.js
// importieren nur diese eine Datei - kein Ordner-Scan.
//
// Hinweis: /automod-setup wurde komplett entfernt. Da deploy-commands.js
// bei Discord immer die VOLLSTÄNDIGE Liste übermittelt (PUT-Request),
// verschwindet der Befehl bei Discord automatisch, sobald `npm run deploy`
// erneut ausgeführt wird - ein manuelles Löschen ist nicht nötig.

const core = require('./commands-core');
const mod = require('./commands-mod');
const extra = require('./commands-extra');
const utility = require('./commands-utility');
const { settings } = require('./commands-settings');
const { ticketPanel } = require('./commands-tickets');
const { automodWords } = require('./commands-automod-words');
const { xpStats, xpBoard, xpSet } = require('./commands-xp');
const { welcomeSetup } = require('./commands-welcome');
const { appearence } = require('./commands-appearance');
const { logChannel } = require('./commands-logs');
const { statusCommand, bStatNow } = require('./commands-bot-status');
const { admReload } = require('./commands-admin');

const withoutHelp = [
  ...core.simpleCommands,
  mod.kick,
  mod.ban,
  mod.timeout,
  mod.warn,
  mod.clear,
  mod.slowmode,
  mod.lock,
  mod.unlock,
  mod.nickname,
  extra.ping,
  extra.remindme,
  extra.suggest,
  extra.role,
  extra.purgeUser,
  extra.say,
  extra.coinflip,
  extra.dice,
  extra.eightball,
  extra.membercount,
  extra.roleinfo,
  utility.userinfo,
  utility.serverinfo,
  utility.avatar,
  utility.poll,
  settings,
  ticketPanel,
  automodWords,
  xpStats,
  xpBoard,
  xpSet,
  welcomeSetup,
  appearence,
  logChannel,
  statusCommand,
  bStatNow,
  admReload,
];

// /help braucht die vollständige Liste (inkl. sich selbst) für die Anzeige,
// daher wird es erst hier zusammengesetzt, um einen Zirkelbezug zu vermeiden.
const help = core.buildHelpCommand(() => allCommands);

const allCommands = [...withoutHelp, help];

module.exports = allCommands;
