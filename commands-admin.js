// commands-admin.js
// /adm-reload - admin command for operations/maintenance.
// Access (administrators) is checked centrally in permissions.js.
//
// A REAL restart from within Discord: Node.js can't "restart itself" (the
// process running the code can't replace itself). What works: the process
// exits (process.exit), and the hosting's process manager restarts it
// automatically (systemd with "Restart=always", PM2, Docker with
// "--restart unless-stopped", Railway/Render/Heroku-style platforms all do
// this by default). WITHOUT such an auto-restart mechanism the bot stays
// offline after /adm-reload until it's started manually again - that's the
// technical limit that can't be bypassed from Discord/Node.js.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const logging = require('./logging');

const admReload = {
  data: new SlashCommandBuilder().setName('adm-reload').setDescription('Fully restarts the bot process (not just a .env reload)'),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🔄 Restart initiated')
      .setDescription(
        'The bot process will exit in 3 seconds.\n' +
          'If it runs under a process manager with auto-restart (systemd, PM2, Docker, ' +
          'Railway/Render, etc.), it comes back online automatically. **Without** auto-restart ' +
          "it stays offline until it's started manually - that can't be avoided from here."
      )
      .setColor(0xfee75c);
    await interaction.reply({ embeds: [embed] });

    logging.logToGuild(interaction.client, interaction.guildId, {
      title: '🔄 Bot restart triggered',
      fields: [{ name: 'By', value: interaction.user.tag }],
      level: 'warn',
    });

    console.log(`🔄 Restart triggered by ${interaction.user.tag} (${interaction.user.id}) - PID ${process.pid} exits in 3s.`);
    setTimeout(() => process.exit(0), 3000);
  },
};

module.exports = { admReload };
