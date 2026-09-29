// command-tools.js
//
// Everything around registering slash commands with Discord - shared by
// `npm run deploy` (deploy-commands.js) AND the auto-sync on bot startup
// (index.js). This gives exactly ONE source of truth for what is registered
// at Discord - the main cause of "Unknown Command" was that the running bot
// code and the command list registered at Discord had drifted apart.

const crypto = require('crypto');
const { Routes } = require('discord.js');
const storage = require('./storage');

// Discord: installation types / contexts (see the Application Commands docs)
const INTEGRATION_GUILD_INSTALL = 0; // bot is installed on a server
const INTEGRATION_USER_INSTALL = 1; // a user installed the bot to THEIR account
const CONTEXT_GUILD = 0; // in servers
const CONTEXT_BOT_DM = 1; // in DMs with the bot
const CONTEXT_PRIVATE_CHANNEL = 2; // in group DMs / DMs with other users

const NAME_REGEX = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

// Builds the JSON payload for Discord.
// scope 'global': with integration_types/contexts (user-install capable)
// scope 'guild' : without these fields (guild commands don't know them)
function buildPayload(commandList, { scope = 'global' } = {}) {
  const payload = [];
  for (const cmd of commandList) {
    if (!cmd || !cmd.data) continue;
    const json = cmd.data.toJSON();

    // Access is checked centrally in permissions.js, not via Discord's default
    // permissions (those would hide role-based mod/admin rights from users who
    // lack the corresponding Discord permission).
    json.default_member_permissions = null;
    delete json.dm_permission; // deprecated - replaced by contexts

    if (scope === 'global') {
      if (cmd.scope === 'guild') {
        json.integration_types = [INTEGRATION_GUILD_INSTALL];
        json.contexts = [CONTEXT_GUILD];
      } else {
        json.integration_types = [INTEGRATION_GUILD_INSTALL, INTEGRATION_USER_INSTALL];
        json.contexts = [CONTEXT_GUILD, CONTEXT_BOT_DM, CONTEXT_PRIVATE_CHANNEL];
      }
    } else {
      delete json.integration_types;
      delete json.contexts;
    }
    payload.push(json);
  }
  return payload;
}

// Checks the payload for anything Discord would reject - BEFORE sending.
// That way `npm run deploy` doesn't fail with a cryptic API error, but names
// the exact command and problem.
function validatePayload(payload) {
  const errors = [];
  const names = new Set();

  if (payload.length > 100) errors.push(`Too many global commands: ${payload.length} (maximum 100).`);

  const checkName = (label, name) => {
    if (typeof name !== 'string' || !NAME_REGEX.test(name)) errors.push(`${label}: invalid name "${name}".`);
    else if (name !== name.toLowerCase()) errors.push(`${label}: name "${name}" must be entirely lowercase.`);
  };
  const checkDesc = (label, desc) => {
    if (typeof desc !== 'string' || desc.length < 1 || desc.length > 100) {
      errors.push(`${label}: description must be 1-100 characters long (is ${desc ? desc.length : 0}).`);
    }
  };

  const checkOptions = (label, options, allowSub) => {
    if (!options) return;
    if (options.length > 25) errors.push(`${label}: more than 25 options.`);
    const hasSub = options.some((o) => o.type === 1 || o.type === 2);
    const hasNonSub = options.some((o) => o.type !== 1 && o.type !== 2);
    if (hasSub && hasNonSub) errors.push(`${label}: subcommands must not be mixed with regular options.`);
    if (hasSub && !allowSub) errors.push(`${label}: subcommands are not allowed here (nesting too deep).`);

    const seen = new Set();
    let optionalSeen = false;
    for (const opt of options) {
      const l = `${label} > ${opt.name}`;
      checkName(l, opt.name);
      checkDesc(l, opt.description);
      if (seen.has(opt.name)) errors.push(`${l}: duplicate option name.`);
      seen.add(opt.name);
      if (opt.type === 1) {
        checkOptions(l, opt.options, false);
      } else if (opt.type === 2) {
        checkOptions(l, opt.options, true);
      } else {
        if (opt.required) {
          if (optionalSeen) errors.push(`${l}: required option comes after an optional option (Discord requires required ones first).`);
        } else {
          optionalSeen = true;
        }
        if (opt.choices && opt.choices.length > 25) errors.push(`${l}: more than 25 choices.`);
      }
    }
  };

  for (const cmd of payload) {
    const label = `/${cmd.name}`;
    checkName(label, cmd.name);
    if (names.has(cmd.name)) errors.push(`${label}: duplicated (each command may only be registered ONCE).`);
    names.add(cmd.name);
    if ((cmd.type ?? 1) === 1) checkDesc(label, cmd.description);
    checkOptions(label, cmd.options, true);
  }
  return errors;
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function getApplicationId(rest) {
  const app = await rest.get(Routes.oauth2CurrentApplication());
  return app.id;
}

// Deletes guild commands left over from earlier deploys (e.g. with GUILD_ID).
// They would show up DOUBLED next to the global commands or show outdated
// versions. Returns: number of cleaned-up servers.
async function clearStaleGuildCommands(rest, appId, extraGuildIds = [], log = () => {}) {
  const guildIds = new Set(extraGuildIds.filter(Boolean));
  try {
    const guilds = await rest.get(Routes.userGuilds(), { query: new URLSearchParams({ limit: '200' }) });
    for (const g of guilds) guildIds.add(g.id);
  } catch (err) {
    log(`Note: could not load the server list (${err.message}) - only checking the known servers.`);
  }

  let cleaned = 0;
  for (const guildId of guildIds) {
    try {
      const existing = await rest.get(Routes.applicationGuildCommands(appId, guildId));
      if (Array.isArray(existing) && existing.length > 0) {
        await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] });
        cleaned++;
        log(`Removed outdated server commands on ${guildId} (${existing.length}).`);
      }
    } catch (err) {
      // 403/404 = the bot has no command access on this server (e.g. user install only) - not critical.
      if (![403, 404, 50001].includes(err.status) && err.code !== 50001) {
        log(`Note: could not check server ${guildId} (${err.message}).`);
      }
    }
  }
  return cleaned;
}

// Registers ALL commands globally (PUT replaces the complete list - so
// outdated commands disappear at Discord automatically).
async function registerGlobal(rest, appId, payload) {
  return rest.put(Routes.applicationCommands(appId), { body: payload });
}

async function registerGuild(rest, appId, guildId, payload) {
  return rest.put(Routes.applicationGuildCommands(appId, guildId), { body: payload });
}

// Auto-sync on bot startup: only registers when something changed (different
// hash OR command names at Discord differ). This spares Discord's limit for
// command registrations.
async function syncIfChanged(client, commandList, log = console.log) {
  const payload = buildPayload(commandList, { scope: 'global' });
  const errors = validatePayload(payload);
  if (errors.length > 0) {
    log(`❌ Command sync aborted - invalid commands:\n  - ${errors.join('\n  - ')}`);
    return { changed: false, error: true };
  }

  const appId = client.application.id;
  const hash = hashPayload(payload);
  const remote = await client.rest.get(Routes.applicationCommands(appId));
  const remoteNames = new Set(remote.map((c) => c.name));
  const localNames = new Set(payload.map((c) => c.name));

  const missing = [...localNames].filter((n) => !remoteNames.has(n));
  const stale = [...remoteNames].filter((n) => !localNames.has(n));
  const hashChanged = storage.getMeta('commandHash') !== hash;

  if (!hashChanged && missing.length === 0 && stale.length === 0) {
    log(`✅ Slash commands are in sync (${payload.length} commands registered at Discord).`);
    return { changed: false, count: payload.length };
  }

  if (missing.length) log(`ℹ️ Missing at Discord: ${missing.map((n) => `/${n}`).join(', ')}`);
  if (stale.length) log(`ℹ️ Outdated at Discord (will be removed): ${stale.map((n) => `/${n}`).join(', ')}`);
  log('🔄 Re-registering slash commands ...');

  const registered = await registerGlobal(client.rest, appId, payload);
  storage.setMeta('commandHash', hash);
  const cleaned = await clearStaleGuildCommands(client.rest, appId, [process.env.GUILD_ID], log);
  log(`✅ ${registered.length} slash commands registered globally${cleaned ? `, ${cleaned} servers cleaned up` : ''}.`);
  return { changed: true, count: registered.length };
}

module.exports = {
  buildPayload,
  validatePayload,
  hashPayload,
  getApplicationId,
  clearStaleGuildCommands,
  registerGlobal,
  registerGuild,
  syncIfChanged,
};
