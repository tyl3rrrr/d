// commands-config.js
// /config - small, separate settings group requested by name (distinct from
// /settings). Currently only holds the suggestions channel, but is its own
// command so more `/config <topic>` subcommands can be added later without
// growing /settings.
// Access (administrators) is checked centrally in permissions.js.

const { SlashCommandBuilder, ChannelType } = require('discord.js');
const storage = require('./storage');
const { EPHEMERAL } = require('./util');

const config = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configures small bot features for this server')
    .addSubcommand((s) =>
      s
        .setName('suggest')
        .setDescription('Sets the channel where /suggest posts new suggestions')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('The suggestions channel (omit to disable /suggest)').addChannelTypes(ChannelType.GuildText).setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'suggest') {
      const channel = interaction.options.getChannel('channel');
      if (!channel) {
        storage.removeGuildSetting(guildId, 'suggestChannelId');
        await interaction.reply({ content: '✅ `/suggest` disabled (no channel set).', flags: EPHEMERAL });
        return;
      }
      storage.setGuildSetting(guildId, 'suggestChannelId', channel.id);
      await interaction.reply({ content: `✅ Suggestions from \`/suggest\` will now be posted in ${channel.toString()}.`, flags: EPHEMERAL });
    }
  },
};

module.exports = { config };
