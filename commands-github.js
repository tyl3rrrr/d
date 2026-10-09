// /github-check add|list|remove - per-server GitHub release watches.
// Permissions are declared in commands.js and checked centrally.
const { SlashCommandBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const github = require('./github');
const { EPHEMERAL } = require('./util');

const githubCheck = {
  data: new SlashCommandBuilder()
    .setName('github-check')
    .setDescription('Manage automatic GitHub release notifications for this server')
    .addSubcommand((s) => s.setName('add').setDescription('Watch a GitHub repository for new releases')
      .addStringOption((o) => o.setName('url').setDescription('GitHub repository URL, e.g. https://github.com/owner/repository').setMaxLength(200).setRequired(true))
      .addChannelOption((o) => o.setName('channel').setDescription('Where new releases should be posted').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List repositories watched by this server'))
    .addSubcommand((s) => s.setName('remove').setDescription('Stop watching a repository')
      .addStringOption((o) => o.setName('url').setDescription('The GitHub repository URL to remove').setMaxLength(200).setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'list') {
      const watches = github.getWatches(guildId);
      if (!watches.length) {
        await interaction.reply({ content: '📭 This server is not watching any custom GitHub repositories yet. Use `/github-check add` to add one.', flags: EPHEMERAL });
        return;
      }
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`GitHub watches · ${interaction.guild.name}`)
        .setDescription(watches.map((w, i) => `**${i + 1}.** [${w.repo}](https://github.com/${w.repo}) → <#${w.channelId}>`).join('\n').slice(0, 4000))
        .setFooter({ text: `${watches.length} watched ${watches.length === 1 ? 'repository' : 'repositories'} · checks every ${Math.max(2, Number(process.env.GITHUB_INTERVAL_MIN) || 10)} minutes` });
      await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
      return;
    }

    if (sub === 'remove') {
      const repo = interaction.options.getString('url', true);
      const result = github.removeWatch(guildId, repo);
      await interaction.reply({ content: result.ok ? `✅ No longer watching **${result.repo}** on this server.` : `❌ ${result.reason}`, flags: EPHEMERAL });
      return;
    }

    const repo = interaction.options.getString('url', true);
    const channel = interaction.options.getChannel('channel', true);
    await interaction.deferReply({ flags: EPHEMERAL });
    const result = await github.addWatch(interaction.client, guildId, repo, channel.id);
    if (!result.ok) {
      await interaction.editReply(`❌ ${result.reason}`);
      return;
    }
    await interaction.editReply(
      result.updated
        ? `✅ Updated the destination for **${result.repo}** to ${channel}. New published releases will be announced there.`
        : `✅ Now watching **${result.repo}**. New published releases will be announced in ${channel}. Existing releases won't be reposted. Checks run about every ${Math.max(2, Number(process.env.GITHUB_INTERVAL_MIN) || 10)} minutes.`
    );
  },
};

module.exports = { githubCheck };
