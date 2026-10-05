// commands-rules.js
// /rules - view, edit, post and check the server rules (see rules-runtime.js).
// Access is set in commands.js: everyone may view, administrators do the rest.

const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const runtime = require('./rules-runtime');
const storage = require('./storage');
const { EPHEMERAL, truncate } = require('./util');

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const rules = {
  data: new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Shows and manages the server rules')
    .addSubcommand((s) => s.setName('view').setDescription('Shows the current server rules'))
    .addSubcommand((s) => s.setName('edit').setDescription('Writes or changes the rules (a changed text creates a new version)'))
    .addSubcommand((s) =>
      s
        .setName('post')
        .setDescription('Posts the rules with the Accept button')
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post (default: this channel)').addChannelTypes(...TEXT_CHANNELS).setRequired(false))
    )
    .addSubcommand((s) => s.setName('status').setDescription('Shows the version and how many members accepted it')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'edit') {
      await runtime.showEditModal(interaction); // a form IS the response
      return;
    }

    await interaction.deferReply({ flags: EPHEMERAL });
    const guildId = interaction.guildId;
    const r = runtime.getRules(guildId);

    if (sub === 'view') {
      if (r.version < 1) return void (await interaction.editReply('📜 This server has no rules yet.'));
      const accepted = r.accepted[interaction.user.id] === r.version;
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle('📜 Server Rules').setColor(0x5865f2).setDescription(truncate(r.text, 4000)).setFooter({ text: `Version ${r.version} · ${accepted ? 'you accepted this version' : 'not accepted yet'}` })],
      });
      return;
    }

    if (sub === 'post') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      if (!channel || !TEXT_CHANNELS.includes(channel.type)) return void (await interaction.editReply('❌ Please pick a normal text or announcement channel.'));
      const res = await runtime.post(interaction.client, interaction.guild, channel);
      await interaction.editReply(res.ok ? `✅ Rules posted in ${channel.toString()}: ${res.message.url}` : `❌ ${res.reason}`);
      return;
    }

    if (sub === 'status') {
      if (r.version < 1) return void (await interaction.editReply('📜 No rules written yet - use `/rules edit`.'));
      const { current, older } = runtime.countAccepted(r);
      const roleId = storage.getGuildSettings(guildId).rulesRoleId;
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('📜 Rules status')
            .setColor(0x5865f2)
            .addFields(
              { name: 'Current version', value: `${r.version}`, inline: true },
              { name: 'Accepted this version', value: `${current}`, inline: true },
              { name: 'Accepted an older version', value: `${older}`, inline: true },
              { name: 'Posted', value: r.channelId && r.messageId ? `<#${r.channelId}>` : 'not posted yet - use `/rules post`', inline: true },
              { name: 'Rules role', value: roleId ? `<@&${roleId}>` : 'not set (`/settings`)', inline: true },
              { name: 'Last change', value: r.updatedAt ? `<t:${Math.floor(r.updatedAt / 1000)}:R> by ${truncate(r.updatedBy || 'unknown', 60)}` : '-', inline: true }
            ),
        ],
      });
    }
  },
};

module.exports = { rules };
