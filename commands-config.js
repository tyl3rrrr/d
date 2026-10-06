// commands-config.js
// /config - small, separate settings group requested by name (distinct from /settings). Holds the
// suggestions channel, the MacRumors news channel, the GitHub release channel, AI on/off and the
// bot owner's activity log viewer.
// Access is checked centrally in permissions.js: administrators for everything, moderators AND
// administrators for `/config macrumors`, and the BOT OWNER ONLY for `/config bot-logs` (see commands.js).

const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const storage = require('./storage');
const macrumors = require('./macrumors');
const github = require('./github');
const botlog = require('./botlog');
const logging = require('./logging');
const { EPHEMERAL, errText, truncate } = require('./util');

const TYPE_LABEL = { dm: '📩 DM', command: '⌨️ Command', error: '⚠️ Error', guild: '🏠 Server', ai: '🧠 AI', audit: '📋 Other' };
const TYPE_CHOICES = [{ name: 'All', value: 'all' }, ...botlog.TYPES.map((t) => ({ name: TYPE_LABEL[t].replace(/^\S+\s/, ''), value: t }))];

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
    )
    .addSubcommand((s) =>
      s
        .setName('ai')
        .setDescription('Turns @mention AI replies on or off in this server (/ask and DMs are unaffected)')
        .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('bot-logs')
        .setDescription('BOT OWNER ONLY: shows the activity log of the bot itself (DMs, commands, AI chats, errors)')
        .addStringOption((o) => o.setName('type').setDescription('Only this kind of entry').addChoices(...TYPE_CHOICES).setRequired(false))
        .addUserOption((o) => o.setName('user').setDescription('Only entries from this user').setRequired(false))
        .addStringOption((o) => o.setName('search').setDescription('Only entries containing this text').setMinLength(2).setRequired(false))
        .addIntegerOption((o) => o.setName('count').setDescription('How many entries (default 10, max 25)').setMinValue(1).setMaxValue(25).setRequired(false))
    ),

  async execute(interaction) {
    const permissions = require('./permissions');
    const sub = interaction.options.getSubcommand();
    if (sub === 'bot-logs' && !permissions.isBotOwner(interaction.user.id)) {
      await interaction.reply({ content: '❌ This is only for the bot operator.', flags: EPHEMERAL });
      return;
    }
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

    if (sub === 'ai') {
      const enabled = interaction.options.getBoolean('enabled');
      storage.setGuildSetting(guildId, 'aiEnabled', enabled);
      logging.logSettingChange(interaction.client, guildId, { setting: 'AI @mention replies', value: enabled ? 'on' : 'off', moderator: interaction.user.tag });
      await interaction.reply({ content: `✅ AI replies to @mentions are now **${enabled ? 'on' : 'off'}** in this server. \`/ask\` and DMs to the bot still work either way.`, flags: EPHEMERAL });
      return;
    }

    if (sub === 'bot-logs') {
      await interaction.deferReply({ flags: EPHEMERAL });
      const type = interaction.options.getString('type') || 'all';
      const userOpt = interaction.options.getUser('user');
      const search = interaction.options.getString('search') || '';
      const count = interaction.options.getInteger('count') || 10;

      const { total, entries } = await botlog.query({ type, userId: userOpt ? userOpt.id : null, search, limit: count });
      if (entries.length === 0) {
        const { total: grand, byType } = await botlog.counts();
        await interaction.editReply(
          grand
            ? `No matching log entries. In total there are **${grand}** entries: ${Object.entries(byType).map(([t, n]) => `${TYPE_LABEL[t] || t} ${n}`).join(', ')}.`
            : 'The bot log is empty so far.'
        );
        return;
      }
      const lines = entries.map((e) => {
        const who = e.userTag ? `${e.userTag} (\`${e.userId}\`)` : e.userId ? `\`${e.userId}\`` : 'unknown';
        const where = e.guildName ? ` · ${truncate(e.guildName, 40)}` : e.type === 'dm' || e.type === 'ai' ? ' · DM' : '';
        const files = e.attachments && e.attachments.length ? `\n📎 ${e.attachments.map((a) => a.name).join(', ')}` : '';
        return `**${TYPE_LABEL[e.type] || e.type}** <t:${Math.floor(e.t / 1000)}:R> - ${who}${where}\n${truncate(e.text || '(no text)', 300)}${files}`;
      });
      const embed = new EmbedBuilder()
        .setTitle('📋 Bot activity log')
        .setColor(0x5865f2)
        .setDescription(truncate(lines.join('\n\n'), 4000))
        .setFooter({ text: `Showing ${entries.length} of ${total} matching entries · kept ${botlog.retentionDays()} days` });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'macrumors') {
      const channel = interaction.options.getChannel('channel');
      if (!channel) {
        storage.removeGuildSetting(guildId, 'macrumorsChannelId');
        await interaction.reply({ content: '✅ MacRumors news disabled (no channel set).', flags: EPHEMERAL });
        return;
      }
      await interaction.deferReply({ flags: EPHEMERAL });
      storage.setGuildSetting(guildId, 'macrumorsChannelId', channel.id);
      const res = await macrumors.postLatest(interaction.client, guildId, channel.id).catch((err) => ({ ok: false, reason: errText(err) }));
      await interaction.editReply(
        res.ok
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
