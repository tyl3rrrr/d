// deploy-commands.js
// Registers all slash commands with Discord. Run with: npm run deploy
//
// - Registers GLOBALLY (needed for all servers AND for user install).
// - Checks all commands beforehand for errors Discord would reject.
// - Determines the application ID from the token (CLIENT_ID is optional).
// - Removes outdated server commands (they cause duplicate/old commands).
// - Optional: DEPLOY_SCOPE=guild + GUILD_ID only for testing on ONE server.

require('dotenv').config();
const { REST } = require('discord.js');

const commandList = require('./commands');
const tools = require('./command-tools');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID, DEPLOY_SCOPE } = process.env;

if (!DISCORD_TOKEN) {
  console.error('Error: DISCORD_TOKEN is missing from the .env file.');
  process.exit(1);
}

(async () => {
  try {
    const guildMode = String(DEPLOY_SCOPE || '').toLowerCase() === 'guild';
    if (guildMode && !GUILD_ID) throw new Error('DEPLOY_SCOPE=guild is set, but GUILD_ID is missing.');

    const payload = tools.buildPayload(commandList, { scope: guildMode ? 'guild' : 'global' });
    const errors = tools.validatePayload(payload);
    if (errors.length > 0) {
      console.error(`❌ ${errors.length} problem(s) in the commands - nothing was sent:\n  - ${errors.join('\n  - ')}`);
      process.exit(1);
    }

    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    const appId = await tools.getApplicationId(rest);
    if (CLIENT_ID && CLIENT_ID.trim() !== appId) {
      console.warn(`⚠️ CLIENT_ID in .env (${CLIENT_ID.trim()}) does not match the token (${appId}). Using the ID from the token.`);
    }

    console.log(`Registering ${payload.length} slash commands: ${payload.map((c) => c.name).join(', ')}`);

    if (guildMode) {
      const data = await tools.registerGuild(rest, appId, GUILD_ID.trim(), payload);
      console.log(`✅ ${data.length} commands registered for server ${GUILD_ID} only (test mode, no user install).`);
      return;
    }

    const data = await tools.registerGlobal(rest, appId, payload);
    const cleaned = await tools.clearStaleGuildCommands(rest, appId, [GUILD_ID], (m) => console.log(m));
    console.log(`✅ ${data.length} commands registered globally${cleaned ? `, ${cleaned} servers cleaned of old commands` : ''}.`);
    console.log('Global commands are available immediately; if a command is missing in the client, reload Discord with Ctrl+R.');
  } catch (error) {
    console.error('❌ Error while registering the slash commands:', error.message || error);
    process.exit(1);
  }
})();
