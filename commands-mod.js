// commands-mod.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage = require('./storage');
const { sendModActionDM } = require('./dm-notify');
const { canModerate } = require('./permissions');
const { EPHEMERAL, isMissingPermError } = require('./util');
const logging = require('./logging');

// Access (moderator / admin / owner) is checked centrally in permissions.js
// (access: 'mod' in the registry in commands.js) - deliberately no own
// permission check here anymore. The rank check against the TARGET
// (a moderator may not kick/ban admins ...) is handled by canModerate().
async function denyIfNotModerable(interaction, targetMember) {
  const check = canModerate(interaction, targetMember);
  if (check.ok) return false;
  await interaction.reply({ content: check.reason, flags: EPHEMERAL });
  return true;
}

const kick = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kicks a member from the server')
    .addUserOption((opt) => opt.setName('user').setDescription('The member to kick').setRequired(true))
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the kick').setRequired(false)),

  async execute(interaction) {
    const member = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason given';

    if (!member) {
      await interaction.reply({ content: '❌ That member could not be found.', flags: EPHEMERAL });
      return;
    }
    if (await denyIfNotModerable(interaction, member)) return;
    if (!member.kickable) {
      await interaction.reply({
        content: "❌ I can't kick this member (higher role or missing permission).",
        flags: EPHEMERAL,
      });
      return;
    }

    try {
      await sendModActionDM(member.user, {
        action: 'kick',
        reason,
        moderatorTag: interaction.user.tag,
        guildName: interaction.guild.name,
      });
      await member.kick(reason);
      logging.logModAction(interaction.client, interaction.guildId, {
        action: 'Kick', target: `${member.user.tag} (${member.id})`, moderator: interaction.user.tag, reason,
      });
      await interaction.reply(`👋 **${member.user.tag}** was kicked. Reason: ${reason}`);
    } catch (err) {
      console.error('Error in /kick:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? "❌ I'm missing the permission to kick this member."
          : `❌ Error while kicking: ${err.message}`,
        flags: EPHEMERAL,
      });
    }
  },
};

const ban = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bans a member from the server')
    .addUserOption((opt) => opt.setName('user').setDescription('The member to ban').setRequired(true))
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the ban').setRequired(false))
    .addIntegerOption((opt) =>
      opt
        .setName('delete_days')
        .setDescription('Delete messages from the last X days (0-7)')
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason given';
    const deleteDays = interaction.options.getInteger('delete_days') || 0;

    // If the target is still on the server the rank check applies; users who
    // have already left may still be banned by ID.
    const targetMember = interaction.options.getMember('user');
    if (await denyIfNotModerable(interaction, targetMember)) return;
    if (targetMember && !targetMember.bannable) {
      await interaction.reply({
        content: "❌ I can't ban this member (higher role or missing permission).",
        flags: EPHEMERAL,
      });
      return;
    }

    try {
      logging.logModAction(interaction.client, interaction.guildId, {
        action: 'Ban', target: `${targetUser.tag} (${targetUser.id})`, moderator: interaction.user.tag, reason,
      });
      await sendModActionDM(targetUser, {
        action: 'ban',
        reason,
        moderatorTag: interaction.user.tag,
        guildName: interaction.guild.name,
      });
      await interaction.guild.members.ban(targetUser.id, {
        reason,
        deleteMessageSeconds: deleteDays * 86400,
      });
      await interaction.reply(`🔨 **${targetUser.tag}** was banned. Reason: ${reason}`);
    } catch (err) {
      console.error('Error in /ban:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? "❌ I'm missing the permission to ban this member."
          : `❌ Error while banning: ${err.message}`,
        flags: EPHEMERAL,
      });
    }
  },
};

const timeout = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Puts a member in timeout')
    .addUserOption((opt) => opt.setName('user').setDescription('The member').setRequired(true))
    .addIntegerOption((opt) =>
      opt.setName('minutes').setDescription('Duration in minutes (max. 40320 = 28 days)').setMinValue(1).setMaxValue(40320).setRequired(true)
    )
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the timeout').setRequired(false)),

  async execute(interaction) {
    const member = interaction.options.getMember('user');
    const minutes = interaction.options.getInteger('minutes');
    const reason = interaction.options.getString('reason') || 'No reason given';

    if (!member) {
      await interaction.reply({ content: '❌ That member could not be found.', flags: EPHEMERAL });
      return;
    }

    if (await denyIfNotModerable(interaction, member)) return;
    if (!member.moderatable) {
      await interaction.reply({
        content: "❌ I can't timeout this member (higher role or missing permission).",
        flags: EPHEMERAL,
      });
      return;
    }

    try {
      await member.timeout(minutes * 60 * 1000, reason);
      logging.logModAction(interaction.client, interaction.guildId, {
        action: `Timeout (${minutes} min)`, target: `${member.user.tag} (${member.id})`, moderator: interaction.user.tag, reason,
      });
      await sendModActionDM(member.user, {
        action: 'timeout',
        reason,
        moderatorTag: interaction.user.tag,
        guildName: interaction.guild.name,
        durationMinutes: minutes,
      });
      await interaction.reply(`🔇 **${member.user.tag}** was timed out for ${minutes} minute(s). Reason: ${reason}`);
    } catch (err) {
      console.error('Error in /timeout:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? "❌ I'm missing the permission to timeout this member."
          : `❌ Error during timeout: ${err.message}`,
        flags: EPHEMERAL,
      });
    }
  },
};

const warn = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Manages warnings for members')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Warns a member')
        .addUserOption((opt) => opt.setName('user').setDescription('The member').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the warning').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription("Shows all of a member's warnings")
        .addUserOption((opt) => opt.setName('user').setDescription('The member').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription("Deletes all of a member's warnings")
        .addUserOption((opt) => opt.setName('user').setDescription('The member').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('user');
    const guildId = interaction.guild.id;

    if (sub === 'add') {
      const reason = interaction.options.getString('reason');
      if (await denyIfNotModerable(interaction, interaction.options.getMember('user'))) return;
      const entry = {
        reason,
        date: new Date().toISOString(),
        moderatorId: interaction.user.id,
      };
      const all = storage.addWarn(guildId, targetUser.id, entry);
      logging.logModAction(interaction.client, interaction.guildId, {
        action: 'Warn', target: `${targetUser.tag} (${targetUser.id})`, moderator: interaction.user.tag, reason,
      });
      const dmSent = await sendModActionDM(targetUser, {
        action: 'warn',
        reason,
        moderatorTag: interaction.user.tag,
        guildName: interaction.guild.name,
      });
      await interaction.reply(
        `⚠️ **${targetUser.tag}** was warned. Reason: ${reason}\nTotal warnings: ${all.length}` +
          (dmSent ? '' : '\n_(Note: the DM could not be delivered - the user may have DMs disabled.)_')
      );
      return;
    }

    if (sub === 'list') {
      const entries = storage.getWarns(guildId, targetUser.id);
      if (entries.length === 0) {
        await interaction.reply({ content: `${targetUser.tag} has no warnings.`, flags: EPHEMERAL });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle(`⚠️ Warnings for ${targetUser.tag}`)
        .setColor(0xfee75c)
        .setDescription(
          entries
            .map((e, i) => `**#${i + 1}** — ${e.reason}\n<t:${Math.floor(new Date(e.date).getTime() / 1000)}:R> by <@${e.moderatorId}>`)
            .join('\n\n')
        );
      await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
      return;
    }

    if (sub === 'clear') {
      storage.clearWarns(guildId, targetUser.id);
      logging.logModAction(interaction.client, interaction.guildId, {
        action: 'Warnings cleared', target: `${targetUser.tag} (${targetUser.id})`, moderator: interaction.user.tag, reason: null,
      });
      await interaction.reply(`🧹 All warnings for **${targetUser.tag}** were deleted.`);
      return;
    }
  },
};

const clear = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Deletes several messages in this channel')
    .addIntegerOption((opt) =>
      opt.setName('amount').setDescription('How many messages to delete (1-100)').setMinValue(1).setMaxValue(100).setRequired(true)
    ),

  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');

    await interaction.deferReply({ flags: EPHEMERAL });

    try {
      const deleted = await interaction.channel.bulkDelete(amount, true);
      logging.logModAction(interaction.client, interaction.guildId, {
        action: `Clear (${deleted.size} messages)`, target: interaction.channel.toString(), moderator: interaction.user.tag, reason: null,
      });
      await interaction.editReply(`🧹 Deleted ${deleted.size} message(s).`);
    } catch (err) {
      console.error('Error in /clear:', err);
      await interaction.editReply(
        isMissingPermError(err)
          ? "❌ I'm missing the permission to delete messages in this channel."
          : `❌ Error while deleting: ${err.message} (Discord can only bulk-delete messages younger than 14 days.)`
      );
    }
  },
};

const slowmode = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Sets the slowmode (delay) for this channel')
    .addIntegerOption((opt) =>
      opt
        .setName('seconds')
        .setDescription('Delay in seconds (0 = off, max. 21600 = 6 hours)')
        .setMinValue(0)
        .setMaxValue(21600)
        .setRequired(true)
    ),

  async execute(interaction) {
    const seconds = interaction.options.getInteger('seconds');
    try {
      await interaction.channel.setRateLimitPerUser(seconds, `Set by ${interaction.user.tag}`);
      logging.logModAction(interaction.client, interaction.guildId, {
        action: seconds === 0 ? 'Slowmode disabled' : `Slowmode set to ${seconds}s`, target: interaction.channel.toString(), moderator: interaction.user.tag, reason: null,
      });
      await interaction.reply(seconds === 0 ? '✅ Slowmode was disabled.' : `✅ Slowmode set to ${seconds} second(s).`);
    } catch (err) {
      console.error('Error in /slowmode:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? "❌ I'm missing the permission to change the slowmode."
          : `❌ Error: ${err.message}`,
        flags: EPHEMERAL,
      });
    }
  },
};

const lock = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Locks this channel for @everyone (no more messages)'),

  async execute(interaction) {
    try {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: false,
      });
      logging.logModAction(interaction.client, interaction.guildId, {
        action: 'Channel locked', target: interaction.channel.toString(), moderator: interaction.user.tag, reason: null,
      });
      await interaction.reply('🔒 Channel locked - @everyone can no longer send messages.');
    } catch (err) {
      console.error('Error in /lock:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? "❌ I'm missing the permission to lock this channel."
          : `❌ Error: ${err.message}`,
        flags: EPHEMERAL,
      });
    }
  },
};

const unlock = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlocks this channel for @everyone again'),

  async execute(interaction) {
    try {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: null,
      });
      logging.logModAction(interaction.client, interaction.guildId, {
        action: 'Channel unlocked', target: interaction.channel.toString(), moderator: interaction.user.tag, reason: null,
      });
      await interaction.reply('🔓 Channel unlocked.');
    } catch (err) {
      console.error('Error in /unlock:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? "❌ I'm missing the permission to unlock this channel."
          : `❌ Error: ${err.message}`,
        flags: EPHEMERAL,
      });
    }
  },
};

const nickname = {
  data: new SlashCommandBuilder()
    .setName('nickname')
    .setDescription("Changes a member's server nickname")
    .addUserOption((opt) => opt.setName('user').setDescription('The member').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('name').setDescription('New nickname (leave empty to reset)').setRequired(false)
    ),

  async execute(interaction) {
    const member = interaction.options.getMember('user');
    const name = interaction.options.getString('name') || null;

    if (!member) {
      await interaction.reply({ content: '❌ That member could not be found.', flags: EPHEMERAL });
      return;
    }

    if (await denyIfNotModerable(interaction, member)) return;
    if (!member.manageable) {
      await interaction.reply({
        content: "❌ I can't change this member's nickname (higher role or server owner).",
        flags: EPHEMERAL,
      });
      return;
    }

    try {
      await member.setNickname(name);
      logging.logModAction(interaction.client, interaction.guildId, {
        action: 'Nickname changed', target: `${member.user.tag} (${member.id})`, moderator: interaction.user.tag, reason: name || '(reset)',
      });
      await interaction.reply(name ? `✅ Changed the nickname of **${member.user.tag}** to **${name}**.` : `✅ Reset the nickname of **${member.user.tag}**.`);
    } catch (err) {
      console.error('Error in /nickname:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? "❌ I'm missing the permission to change this member's nickname (maybe a higher role)."
          : `❌ Error: ${err.message}`,
        flags: EPHEMERAL,
      });
    }
  },
};

module.exports = { kick, ban, timeout, warn, clear, slowmode, lock, unlock, nickname };
