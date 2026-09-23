// commands-admin.js
// /adm-reload - Admin-Befehle für Betrieb/Wartung.
// Zugriff (Administratoren) wird zentral in permissions.js geprüft.
//
// ECHTER Neustart aus Discord heraus: Node.js kann sich nicht "selbst" neu
// starten (der Prozess, der den Code ausführt, kann sich nicht ersetzen).
// Was funktioniert: der Prozess beendet sich (process.exit), und der
// Prozess-Manager des Hostings startet ihn automatisch neu (systemd mit
// "Restart=always", PM2, Docker mit "--restart unless-stopped", Railway/
// Render/Heroku-artige Plattformen tun das standardmäßig). OHNE einen solchen
// Auto-Restart-Mechanismus bleibt der Bot nach /adm-reload offline, bis er
// manuell wieder gestartet wird - das ist die technische Grenze, die sich aus
// Discord/Node.js heraus nicht umgehen lässt.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { EPHEMERAL } = require('./util');
const logging = require('./logging');

const admReload = {
  data: new SlashCommandBuilder().setName('adm-reload').setDescription('Startet den Bot-Prozess vollständig neu (kein reines .env-Neuladen)'),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🔄 Neustart eingeleitet')
      .setDescription(
        'Der Bot-Prozess wird in 3 Sekunden beendet.\n' +
          'Läuft er unter einem Prozess-Manager mit Auto-Restart (systemd, PM2, Docker, ' +
          'Railway/Render o.ä.), kommt er automatisch wieder online. **Ohne** Auto-Restart ' +
          'bleibt er offline, bis er manuell neu gestartet wird - das lässt sich von hier aus nicht umgehen.'
      )
      .setColor(0xfee75c);
    await interaction.reply({ embeds: [embed] });

    logging.logToGuild(interaction.client, interaction.guildId, {
      title: '🔄 Bot-Neustart ausgelöst',
      fields: [{ name: 'Von', value: interaction.user.tag }],
      level: 'warn',
    });

    console.log(`🔄 Neustart ausgelöst von ${interaction.user.tag} (${interaction.user.id}) - PID ${process.pid} beendet sich in 3s.`);
    setTimeout(() => process.exit(0), 3000);
  },
};

module.exports = { admReload };
