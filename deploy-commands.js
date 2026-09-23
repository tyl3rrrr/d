// deploy-commands.js
// Registriert alle Slash-Commands bei Discord. Ausführen mit: npm run deploy
//
// - Registriert GLOBAL (nötig für alle Server UND für User-Install).
// - Prüft alle Commands vorher auf Fehler, die Discord ablehnen würde.
// - Ermittelt die Application-ID aus dem Token (CLIENT_ID ist optional).
// - Entfernt veraltete Server-Commands (verursachen doppelte/alte Commands).
// - Optional: DEPLOY_SCOPE=guild + GUILD_ID nur zum Testen auf EINEM Server.

require('dotenv').config();
const { REST } = require('discord.js');

const commandList = require('./commands');
const tools = require('./command-tools');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID, DEPLOY_SCOPE } = process.env;

if (!DISCORD_TOKEN) {
  console.error('Fehler: DISCORD_TOKEN fehlt in der .env Datei.');
  process.exit(1);
}

(async () => {
  try {
    const guildMode = String(DEPLOY_SCOPE || '').toLowerCase() === 'guild';
    if (guildMode && !GUILD_ID) throw new Error('DEPLOY_SCOPE=guild gesetzt, aber GUILD_ID fehlt.');

    const payload = tools.buildPayload(commandList, { scope: guildMode ? 'guild' : 'global' });
    const errors = tools.validatePayload(payload);
    if (errors.length > 0) {
      console.error(`❌ ${errors.length} Problem(e) in den Commands - nichts wurde gesendet:\n  - ${errors.join('\n  - ')}`);
      process.exit(1);
    }

    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    const appId = await tools.getApplicationId(rest);
    if (CLIENT_ID && CLIENT_ID.trim() !== appId) {
      console.warn(`⚠️ CLIENT_ID in der .env (${CLIENT_ID.trim()}) passt nicht zum Token (${appId}). Es wird die ID des Tokens verwendet.`);
    }

    console.log(`Registriere ${payload.length} Slash-Commands: ${payload.map((c) => c.name).join(', ')}`);

    if (guildMode) {
      const data = await tools.registerGuild(rest, appId, GUILD_ID.trim(), payload);
      console.log(`✅ ${data.length} Commands nur für Server ${GUILD_ID} registriert (Testmodus, ohne User-Install).`);
      return;
    }

    const data = await tools.registerGlobal(rest, appId, payload);
    const cleaned = await tools.clearStaleGuildCommands(rest, appId, [GUILD_ID], (m) => console.log(m));
    console.log(`✅ ${data.length} Commands global registriert${cleaned ? `, ${cleaned} Server von alten Commands bereinigt` : ''}.`);
    console.log('Globale Commands sind sofort verfügbar; falls ein Command im Client fehlt: Discord mit Strg+R neu laden.');
  } catch (error) {
    console.error('❌ Fehler beim Registrieren der Slash-Commands:', error.message || error);
    process.exit(1);
  }
})();
