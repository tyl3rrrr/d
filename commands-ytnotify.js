// commands-ytnotify.js
// /ytnotify add|remove|list - lets moderators/admins get notified in a
// channel whenever a tracked YouTube creator uploads a new video.
// Access (moderators+) is checked centrally in permissions.js.
// Requires YOUTUBE_API_KEY in .env - see youtube.js.

const { SlashCommandBuilder, EmbedBuilder, ChannelType, StringSelectMenuBuilder, ActionRowBuilder, ComponentType } = require('discord.js');
const storage = require('./storage');
const youtube = require('./youtube');
const { EPHEMERAL, truncate, errText } = require('./util');

const SELECT_TIMEOUT_MS = 60 * 1000;

async function autocompleteTracked(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const list = storage.getYtNotifyList(interaction.guildId);
  const matches = list.filter((e) => e.channelTitle.toLowerCase().includes(focused)).slice(0, 25);
  await interaction.respond(matches.map((e) => ({ name: e.channelTitle, value: e.channelId })));
}

const ytnotify = {
  data: new SlashCommandBuilder()
    .setName('ytnotify')
    .setDescription('Manages YouTube upload notifications for this server')
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription("Searches YouTube by name and starts tracking the channel you pick")
        .addStringOption((o) => o.setName('name').setDescription("The creator's channel name to search for").setRequired(true).setMaxLength(100))
        .addChannelOption((o) =>
          o.setName('notify-channel').setDescription('Where new-upload notifications should be posted').addChannelTypes(ChannelType.GuildText).setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Stops tracking a YouTube channel')
        .addStringOption((o) => o.setName('channel').setDescription('The tracked channel').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((s) => s.setName('list').setDescription('Shows all YouTube channels tracked on this server')),

  async autocomplete(interaction) {
    await autocompleteTracked(interaction);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (!youtube.isConfigured()) {
      await interaction.reply({
        content: '❌ YouTube notifications are not configured - the bot operator needs to set `YOUTUBE_API_KEY` in `.env`.',
        flags: EPHEMERAL,
      });
      return;
    }

    if (sub === 'list') {
      const list = storage.getYtNotifyList(guildId);
      if (list.length === 0) {
        await interaction.reply({ content: 'No YouTube channels are tracked on this server yet.', flags: EPHEMERAL });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle('📺 Tracked YouTube Channels')
        .setColor(0xff0000)
        .setDescription(list.map((e) => `• **${e.channelTitle}** → <#${e.notifyChannelId}>`).join('\n'));
      await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
      return;
    }

    if (sub === 'remove') {
      const channelId = interaction.options.getString('channel');
      const list = storage.getYtNotifyList(guildId);
      const entry = list.find((e) => e.channelId === channelId || e.channelTitle.toLowerCase() === channelId.toLowerCase());
      if (!entry) {
        await interaction.reply({ content: '❌ That channel is not currently tracked. Use `/ytnotify list` to see what is.', flags: EPHEMERAL });
        return;
      }
      storage.setYtNotifyList(guildId, list.filter((e) => e.channelId !== entry.channelId));
      await interaction.reply({ content: `✅ Stopped tracking **${entry.channelTitle}**.`, flags: EPHEMERAL });
      return;
    }

    if (sub === 'add') {
      const query = interaction.options.getString('name');
      const notifyChannel = interaction.options.getChannel('notify-channel');
      await interaction.deferReply({ flags: EPHEMERAL });

      let results;
      try {
        results = await youtube.searchChannels(query, 5);
      } catch (err) {
        await interaction.editReply(`❌ YouTube search failed: ${errText(err)}`);
        return;
      }
      if (results.length === 0) {
        await interaction.editReply(`❌ No YouTube channel found for "${query}".`);
        return;
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('ytnotify_pick')
        .setPlaceholder('Select the correct channel...')
        .addOptions(results.map((r) => ({ label: truncate(r.title, 100), description: truncate(r.description || '', 100) || undefined, value: r.channelId })));

      const reply = await interaction.editReply({
        content: `Found ${results.length} channel(s) for "${query}" - pick the right one:`,
        components: [new ActionRowBuilder().addComponents(menu)],
      });

      let picked;
      try {
        picked = await reply.awaitMessageComponent({
          componentType: ComponentType.StringSelect,
          time: SELECT_TIMEOUT_MS,
          filter: (i) => i.user.id === interaction.user.id,
        });
      } catch (err) {
        await interaction.editReply({ content: '⌛ Timed out - run `/ytnotify add` again.', components: [] });
        return;
      }

      const chosen = results.find((r) => r.channelId === picked.values[0]);
      const list = storage.getYtNotifyList(guildId);
      if (list.some((e) => e.channelId === chosen.channelId)) {
        await picked.update({ content: `❗ **${chosen.title}** is already tracked on this server.`, components: [] });
        return;
      }

      try {
        const uploadsPlaylistId = await youtube.getUploadsPlaylistId(chosen.channelId);
        const latest = await youtube.getLatestVideo(uploadsPlaylistId);
        list.push({
          channelId: chosen.channelId,
          channelTitle: chosen.title,
          uploadsPlaylistId,
          notifyChannelId: notifyChannel.id,
          lastVideoId: latest ? latest.videoId : null, // baseline - only videos AFTER this one trigger a notification
        });
        storage.setYtNotifyList(guildId, list);
        await picked.update({
          content: `✅ Now tracking **${chosen.title}** - new uploads will be posted in ${notifyChannel.toString()}.`,
          components: [],
        });
      } catch (err) {
        await picked.update({ content: `❌ Could not set up tracking: ${errText(err)}`, components: [] });
      }
    }
  },
};

module.exports = { ytnotify };
