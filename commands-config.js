// commands-config.js
// /config - small, separate settings group requested by name (distinct from
// /settings). Holds the suggestions channel, the MacRumors news channel and the
// GitHub release channel.
// Access is checked centrally in permissions.js: administrators for everything,
// moderators AND administrators for `/config macrumors` (see commands.js).

const { SlashCommandBuilder, ChannelType } = require('discord.js');
const storage = require('./storage');
const macrumors = require('./macrumors');
const github = require('./github');
const logging = require('./logging');
const { EPHEMERAL, errText } = require('./util');

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
    )
    .addSubcommand((s) =>
      s
        .setName('macrumors')
        .setDescription('Sets the channel where new MacRumors articles are posted')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('The news channel (omit to turn MacRumors news off)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('github')
        .setDescription('Sets the channel where new GitHub releases are posted')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('The release channel (omit to turn GitHub releases off)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
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
      return;
    }

    if (sub === 'macrumors') {
      const channel = interaction.options.getChannel('channel');
      if (!channel) {
        storage.removeGuildSetting(guildId, 'macrumorsChannelId');
        logging.logSettingChange(interaction.client, guildId, { setting: 'MacRumors channel', value: null, moderator: interaction.user.tag });
        await interaction.reply({ content: '✅ MacRumors news turned off (no channel set).', flags: EPHEMERAL });
        return;
      }
      await interaction.deferReply({ flags: EPHEMERAL });
      storage.setGuildSetting(guildId, 'macrumorsChannelId', channel.id);
      logging.logSettingChange(interaction.client, guildId, { setting: 'MacRumors channel', value: `#${channel.name}`, moderator: interaction.user.tag });
      // Post the newest article once so you can see right away that it works.
      let posted = false;
      try {
        posted = await macrumors.postLatest(interaction.client, guildId, channel.id);
      } catch (err) {
        console.warn('MacRumors: first post failed:', errText(err));
      }
      await interaction.editReply(
        posted
          ? `✅ New MacRumors articles will be posted in ${channel.toString()}. The latest one was just sent as a test.`
          : `⚠️ Saved ${channel.toString()}, but I couldn't post there. Check that I have View Channel, Send Messages and Embed Links in that channel (or that macrumors.com is reachable). New articles will be tried again automatically.`
      );
      return;
    }

    if (sub === 'github') {
      const channel = interaction.options.getChannel('channel');
      if (!channel) {
        storage.removeGuildSetting(guildId, 'githubChannelId');
        logging.logSettingChange(interaction.client, guildId, { setting: 'GitHub release channel', value: null, moderator: interaction.user.tag });
        await interaction.reply({ content: '✅ GitHub releases turned off (no channel set).', flags: EPHEMERAL });
        return;
      }
      await interaction.deferReply({ flags: EPHEMERAL });
      storage.setGuildSetting(guildId, 'githubChannelId', channel.id);
      logging.logSettingChange(interaction.client, guildId, { setting: 'GitHub release channel', value: `#${channel.name}`, moderator: interaction.user.tag });
      // Post the newest release once so you can see right away that it works.
      const res = await github.postLatest(interaction.client, guildId, channel.id).catch((err) => ({ ok: false, reason: errText(err) }));
      await interaction.editReply(
        res.ok
          ? `✅ New releases of **${github.REPO}** will be posted in ${channel.toString()}. The latest one was just sent as a test.`
          : res.empty
            ? `✅ Saved ${channel.toString()}. ${res.reason}`
            : `⚠️ Saved ${channel.toString()}, but the test post failed: ${res.reason}`
      );
    }
  },
};

module.exports = { config };
