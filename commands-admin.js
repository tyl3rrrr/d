// commands-admin.js
// Admin-Commands: /adm-reload für echten Bot-Neustart

const {
  SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');

const { hasAdminPermission, replyNoPermission } = require('./permissions-manager');

const admReload = {
  data: new SlashCommandBuilder()
    .setName('adm-reload')
    .setDescription('Führe einen echten Bot-Neustart durch (nur Admin)'),
  async execute(interaction) {
    if (!(await hasAdminPermission(interaction.member, interaction.guild))) {
      return replyNoPermission(interaction, 'Administrator');
    }
    
    const embed = new EmbedBuilder()
      .setTitle('🔄 Bot-Neustart eingeleitet')
      .setDescription('Der Bot wird in 3 Sekunden neu gestartet...\nDer Bot geht kurz offline.')
      .setColor(0x5865F2)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: false });
    
    // Gib dem Discord-Client Zeit, die Antwort zu senden
    setTimeout(() => {
      // Echtes Prozess-Exit triggert den Restart durch den Hosting-Provider
      // (z.B. systemd, Docker, PM2, Railway, etc.)
      console.log('🔄 Bot-Neustart durch Admin (PID: ' + process.pid + ') eingeleitet...');
      process.exit(0);
    }, 3000);
  },
};

module.exports = {
  admReload,
};
