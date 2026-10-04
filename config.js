// config.js
// Central configuration - a single file, no folder.

const dotenv = require('dotenv');
dotenv.config();

// ---------------------------------------------------------------------------
// Fixed bot constants
// ---------------------------------------------------------------------------

// The bot's superuser (deliberately hardcoded, not in .env). Treated as
// "superuser" by the central permission system (permissions.js) and also
// accepted as a bot owner.
const SUPERUSER_ID = '1324102364608598118';

// Timestamp of the PROCESS start. process.uptime() starts at 0 for every new
// Node process - i.e. after a bot restart AND after the host is restarted/
// powered back on. (Deliberately NOT client.readyTimestamp: that refers to
// the Discord connection, not the process.)
const PROCESS_STARTED_AT = Date.now() - Math.round(process.uptime() * 1000);

function getUptimeMs() {
  return Date.now() - PROCESS_STARTED_AT;
}

// Bot owners: OWNER_ID from .env (optional) plus the superuser.
function getBotOwnerIds() {
  const ids = new Set([SUPERUSER_ID]);
  const fromEnv = (process.env.OWNER_ID || '').trim();
  if (fromEnv) ids.add(fromEnv);
  return ids;
}

// Twitch name for the streaming status - configured ONCE here (overridable
// via .env) so it isn't hardcoded in multiple places.
const TWITCH_DEFAULT_NAME = process.env.TWITCH_NAME || '0tylxrrrr';

const links = {
  website: process.env.WEBSITE_URL || 'https://tylxrrrr.is-great.net',
  antimdm: process.env.ANTIMDM_LINK || 'https://tinyurl.com/vr27mahv',
  discordInvite: process.env.DISCORD_INVITE || '',
  github: process.env.GITHUB_URL || '',
};

const changelog = [
  {
    date: '2026-09-09',
    text: 'Bot created: added status display, /antimdm, /web and /uptime.',
  },
  {
    date: '2026-09-09',
    text: 'New commands: /status, /changelog, /links, /reload, /botinfo and /automod-setup added.',
  },
  {
    date: '2026-09-10',
    text: 'Simplified structure: no more subfolders.',
  },
  {
    date: '2026-09-10',
    text: 'Mega update: mod commands, /help, ticket system, /settings, AutoMod fix, purple status.',
  },
  {
    date: '2026-09-10',
    text:
      '/automod-setup removed entirely (was unreliable). New commands: /ping, /remindme, ' +
      '/suggest, /role, /purge-user, /userinfo, /serverinfo, /avatar, /poll, /slowmode, /lock, /unlock, /nickname. ' +
      'New: text command !support (+ !support config) and DM notifications for warn/kick/ban/timeout.',
  },
  {
    date: '2026-09-20',
    text:
      'v7.1 (part 1): /appearence, welcome system (/welcome-setup), central permissions (owner/admin/mod role), ' +
      'fixed command registration (auto-sync, no more "Unknown Command"), AutoMod now runs via the ' +
      'Discord AutoMod API (/automod, /automod-words), removed Spotify/developer commands, ' +
      'bot can be user-installed without a server invite, /uptime now resets on process start.',
  },
  {
    date: '2026-09-25',
    text:
      'v7.2 (part 2): full English translation, /automod setup now deletes ALL existing rules first and ' +
      'recreates them cleanly (fixes persistent "max rules of type" errors), new /automod setup-all rolls ' +
      'the standard rules out to every server at once (bot owner only), /welcome-setup now warns directly ' +
      'when the required Server Members Intent is missing and also greets bots, /appearence color no longer ' +
      'fails on a plain single color, /bot-status is now bot-owner only (presence is bot-wide, not per server) ' +
      'and gained view/set/streaming/activity/clear-activity/auto subcommands.',
  },
  {
    date: '2026-09-29',
    text:
      'v7.3 (part 3): /ticket-panel and /apply-panel no longer show a public "used /command" notice, new ' +
      'application system (/apply-config, /apply-panel, DM interviews, Accept/Deny review buttons), new ' +
      '/ytnotify YouTube upload notifications, /suggest reworked into a prompt-and-collect flow with a new ' +
      '/config suggest channel setting, and an updated default welcome DM text.',
  },
  {
    date: '2026-09-30',
    text:
      'v7.4 (part 4): removed the YouTube notification feature (/ytnotify, youtube.js) entirely, and the ' +
      '"Unknown Command" message now explains the real cause (the bot process needs a full restart after a ' +
      'file update or deploy - editing files or running "npm run deploy" alone does not reload running code).',
  },
  {
    date: '2026-10-04',
    text:
      'v7.5: new MacRumors news feed (/config macrumors), tickets reworked - no more ticket channels: /ticket and ' +
      '/ticket-close now work through DMs and forward your one message (with files) to the ticket channel, ' +
      'and /settings is now one interactive panel with selection menus for every server setting.',
  },
];

function reloadEnv() {
  return dotenv.config({ override: true });
}

function reloadLinks() {
  links.website = process.env.WEBSITE_URL || links.website;
  links.antimdm = process.env.ANTIMDM_LINK || links.antimdm;
  links.discordInvite = process.env.DISCORD_INVITE || links.discordInvite;
  links.github = process.env.GITHUB_URL || links.github;
}

function reloadAll() {
  reloadEnv();
  reloadLinks();
}

module.exports = {
  SUPERUSER_ID,
  TWITCH_DEFAULT_NAME,
  PROCESS_STARTED_AT,
  getUptimeMs,
  getBotOwnerIds,
  links,
  changelog,
  reloadEnv,
  reloadLinks,
  reloadAll,
};
