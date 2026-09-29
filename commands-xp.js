// commands-xp.js
// /xp-board  - admins set the leaderboard channel (auto-updates every 24h)
// /xp-set    - ONLY the hardcoded superuser ID may change XP/level
// /xp-stats  - anyone can view their own (or someone else's) XP stats
//
// Access for /xp-board is checked centrally in permissions.js (access: 'admin').
// /xp-set ALSO checks the user ID directly in code (see below) - this is
// deliberately redundant with the central access:'superuser' check, because
// the brief explicitly requires this ONE ID to be hardcoded.

const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const storage = require('./storage');
const xp = require('./xp');
const config = require('./config');
const { EPHEMERAL, truncate } = require('./util');

// Deliberately hardcoded (per the brief) - NOT read from .env.
const XP_EDITOR_ID = '1324102364608598118';

async function tryGetInviteLink(client, guildId) {
  const cached = storage.getGuildSettings(guildId).permanentInviteUrl;
  if (cached) return cached;
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return null;
    const channel = guild.channels.cache.find((c) => c.isTextBased?.() && c.viewable && c.permissionsFor(client.user)?.has('CreateInstantInvite'));
    if (!channel) return null;
    // maxAge: 0 = technically "never expires" per the Discord API. Discord can
    // still invalidate such an invite server-side (e.g. if the channel is
    // deleted) - a TRULY permanently guaranteed link therefore isn't possible,
    // only the best available one.
    const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: 'XP leaderboard: server link' });
    storage.setGuildSetting(guildId, 'permanentInviteUrl', invite.url);
    return invite.url;
  } catch (err) {
    return null; // no permission/no suitable channel - the link is simply omitted
  }
}

const xpBoard = {
  data: new SlashCommandBuilder()
    .setName('xp-board')
    .setDescription("Sets which channel shows this server's XP leaderboard")
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Channel for the leaderboard (omit to disable)').addChannelTypes(ChannelType.GuildText).setRequired(false)
    ),
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const guildId = interaction.guildId;

    if (!channel) {
      storage.removeGuildSetting(guildId, 'xpBoardChannelId');
      storage.removeGuildSetting(guildId, 'xpBoardMessageId');
      await interaction.reply({ content: '✅ XP leaderboard disabled.', flags: EPHEMERAL });
      return;
    }

    storage.setGuildSetting(guildId, 'xpBoardChannelId', channel.id);
    storage.removeGuildSetting(guildId, 'xpBoardMessageId'); // new channel -> generate a new message
    await interaction.reply({ content: `✅ The XP leaderboard will now be shown in ${channel.toString()} (updates every 24h).`, flags: EPHEMERAL });

    const { updateGuildBoard } = require('./xp-runtime');
    await updateGuildBoard(interaction.client, guildId).catch(() => {});
  },
};

const xpSet = {
  data: new SlashCommandBuilder()
    .setName('xp-set')
    .setDescription(`Sets a user's XP/level (only usable by user ID ${XP_EDITOR_ID})`)
    .addUserOption((o) => o.setName('user').setDescription('The user').setRequired(true))
    .addIntegerOption((o) => o.setName('xp').setDescription('New XP value').setRequired(true).setMinValue(0))
    .addIntegerOption((o) => o.setName('level').setDescription('New level (omit to calculate from XP)').setRequired(false).setMinValue(0))
    .addStringOption((o) => o.setName('server').setDescription('Server ID (omit for this server)').setRequired(false)),

  async execute(interaction) {
    // Hard check directly in the command - independent of permissions.js.
    if (interaction.user.id !== XP_EDITOR_ID) {
      await interaction.reply({ content: '❌ Only one specific person may use this command.', flags: EPHEMERAL });
      return;
    }

    const targetUser = interaction.options.getUser('user');
    const newXp = interaction.options.getInteger('xp');
    const explicitLevel = interaction.options.getInteger('level');
    const guildId = interaction.options.getString('server') || interaction.guildId;

    if (!guildId) {
      await interaction.reply({ content: '❌ Please run this on a server, or provide `server` (a server ID).', flags: EPHEMERAL });
      return;
    }

    const level = explicitLevel !== null ? explicitLevel : xp.levelFromTotalXp(newXp);
    const saved = storage.setUserXP(guildId, targetUser.id, newXp, level);

    await interaction.reply({
      content: `✅ Set ${targetUser.tag} on server \`${guildId}\` to **${saved.xp} XP**, level **${saved.level}**.`,
      flags: EPHEMERAL,
    });
  },
};

const xpStats = {
  data: new SlashCommandBuilder()
    .setName('xp-stats')
    .setDescription('Shows XP stats (default: yourself)')
    .addUserOption((o) => o.setName('user').setDescription('Another person (optional)').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();
    const target = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guildId;

    const record = storage.getUserXP(guildId, target.id);
    const p = xp.progress(record.xp);
    const rank = storage.getGlobalRank(guildId, target.id);

    const embed = new EmbedBuilder()
      .setTitle(`📊 XP Stats: ${target.username}`)
      .setColor(0x5865f2)
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'User ID', value: target.id, inline: true },
        { name: 'Server', value: interaction.guild.name, inline: true },
        { name: 'Global rank', value: rank ? `#${rank}` : 'No entry yet', inline: true },
        { name: 'Level', value: String(p.level), inline: true },
        { name: 'XP (total)', value: String(record.xp), inline: true },
        { name: 'XP to next level', value: String(p.xpToNext), inline: true },
        { name: 'Progress to next level', value: `${p.percent}% (${p.xpIntoLevel}/${p.xpNeededForNext} XP)` }
      );
    await interaction.editReply({ embeds: [embed] });
  },
};

const xpGlobal = {
  data: new SlashCommandBuilder().setName('xp-global').setDescription('Shows the global XP leaderboard across all servers'),
  async execute(interaction) {
    await interaction.deferReply();
    const top = storage.getGlobalLeaderboard(10);
    if (top.length === 0) {
      await interaction.editReply('The global leaderboard is still empty.');
      return;
    }

    const lines = [];
    for (let i = 0; i < top.length; i++) {
      const entry = top[i];
      const guild = interaction.client.guilds.cache.get(entry.guildId);
      const guildName = guild ? guild.name : `Server ${entry.guildId}`;
      const invite = guild ? await tryGetInviteLink(interaction.client, entry.guildId) : null;
      const serverText = invite ? `[${truncate(guildName, 40)}](${invite})` : truncate(guildName, 40);
      lines.push(`**${i + 1}.** <@${entry.userId}> — Level ${entry.level} (${entry.xp} XP) — ${serverText}`);
    }

    const embed = new EmbedBuilder()
      .setTitle('🌍 Global XP Leaderboard')
      .setColor(0xffd700)
      .setDescription(lines.join('\n'))
      .setFooter({ text: "Server links stay valid only as long as Discord keeps that invite alive." });
    await interaction.editReply({ embeds: [embed] });
  },
};

module.exports = { xpBoard, xpSet, xpStats, xpGlobal, XP_EDITOR_ID, tryGetInviteLink };
