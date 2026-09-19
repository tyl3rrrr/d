// deploy-commands.js
// Registriert alle Slash-Commands bei Discord. Ausführen mit: npm run deploy

require('dotenv').config();
const { REST, Routes } = require('discord.js');

const commandList = require('./commands');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error(
    'Fehler: DISCORD_TOKEN und/oder CLIENT_ID fehlen in der .env Datei. ' +
      'Bitte .env ausfüllen, bevor die Commands registriert werden.'
  );
  process.exit(1);
}

const commands = [];
for (const command of commandList) {
  if (!command || !command.data) {
    console.warn('Warnung: Ein Command-Modul hat kein "data" Feld - wird übersprungen.');
    continue;
  }
  commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log(
      `Starte Registrierung von ${commands.length} Slash-Command(s): ${commands.map((c) => c.name).join(', ')}`
    );

    let data;
    if (GUILD_ID && GUILD_ID.trim() !== '') {
      data = await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log(`Erfolgreich ${data.length} Command(s) für Server ${GUILD_ID} registriert.`);
    } else {
      data = await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log(
        `Erfolgreich ${data.length} Command(s) global registriert. ` +
          'Hinweis: Es kann bis zu einer Stunde dauern, bis sie überall sichtbar sind.'
      );
    }
  } catch (error) {
    console.error('Fehler beim Registrieren der Slash-Commands:');
    console.error(error);
    process.exit(1);
  }
})();
