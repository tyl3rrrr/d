// commands-extra.js
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const storage = require('./storage');
const { canManageRole, canModerate } = require('./permissions');
const { EPHEMERAL, isMissingPermError } = require('./util');
const logging = require('./logging');

// Access rights (mod / everyone) are checked centrally in permissions.js
// (see the registry in commands.js) - no own permission checks here anymore.

const ping = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Shows the current connection latency'),
  async execute(interaction) {
    const sent = Date.now();
    await interaction.reply('🏓 Pinging...');
    const roundtrip = Date.now() - sent;
    const wsPing = Math.round(interaction.client.ws.ping);
    await interaction.editReply(`🏓 Pong! Bot response time: ${roundtrip} ms | WebSocket: ${wsPing} ms`);
  },
};

const remindme = {
  data: new SlashCommandBuilder()
    .setName('remindme')
    .setDescription('Reminds you by message after a set time')
    .addIntegerOption((opt) =>
      opt.setName('minutes').setDescription('In how many minutes?').setMinValue(1).setMaxValue(1440).setRequired(true)
    )
    .addStringOption((opt) => opt.setName('text').setDescription('What should you be reminded of?').setRequired(true)),

  async execute(interaction) {
    const minutes = interaction.options.getInteger('minutes');
    const text = interaction.options.getString('text');

    await interaction.reply({
      content: `⏰ Okay, I'll remind you in ${minutes} minute(s): "${text}"`,
      flags: EPHEMERAL,
    });

    // Note: this only lives in memory - it is lost when the bot restarts. For
    // important/long reminders, make a note yourself as well.
    //
    // The interaction token (followUp) is only valid for 15 minutes, while
    // reminders can be up to 24 hours - so delivery is primarily via DM, with
    // followUp only as a fallback (if DMs are disabled).
    setTimeout(async () => {
      const reminder = `⏰ Reminder: ${text}`;
      try {
        await interaction.user.send(reminder);
      } catch (err) {
        await interaction.followUp({ content: `<@${interaction.user.id}> ${reminder}` }).catch(() => {});
      }
    }, minutes * 60 * 1000);
  },
};

const SUGGEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes to type the suggestion

const suggest = {
  data: new SlashCommandBuilder().setName('suggest').setDescription('Prompts you for a suggestion and forwards it to the configured channel'),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const settings = storage.getGuildSettings(guildId);
    if (!settings.suggestChannelId) {
      await interaction.reply({ content: '❌ No suggestions channel has been set yet. Ask an admin to run `/config suggest`.', flags: EPHEMERAL });
      return;
    }
    const targetChannel = interaction.guild.channels.cache.get(settings.suggestChannelId);
    if (!targetChannel || !targetChannel.isTextBased()) {
      await interaction.reply({ content: '❌ The configured suggestions channel no longer exists. Ask an admin to set it again.', flags: EPHEMERAL });
      return;
    }

    // Ephemeral so the prompt (and the fact this command was even used) is
    // only visible to the person running it - Discord hides the whole "used
    // /suggest" notice from everyone else for ephemeral responses.
    await interaction.reply({
      content: `💡 What do you want to suggest? Reply **in this channel** within ${SUGGEST_TIMEOUT_MS / 60000} minutes.`,
      flags: EPHEMERAL,
    });

    let collected;
    try {
      collected = await interaction.channel.awaitMessages({
        filter: (m) => m.author.id === interaction.user.id,
        max: 1,
        time: SUGGEST_TIMEOUT_MS,
      });
    } catch (err) {
      collected = null;
    }

    if (!collected || collected.size === 0) {
      await interaction.followUp({ content: '⌛ Timed out - run `/suggest` again when you\'re ready.', flags: EPHEMERAL });
      return;
    }

    const answer = collected.first();
    const text = answer.content;

    // Delete the user's answer message to keep the channel clean - this is
    // a normal guild message the bot can remove (unlike a DM, where bots
    // have no permission to delete anything a user sent).
    await answer.delete().catch((err) => console.warn('Could not delete the /suggest answer message:', err.message));

    const embed = new EmbedBuilder()
      .setTitle('💡 New Suggestion')
      .setDescription(text)
      .setColor(0x5865f2)
      .setFooter({ text: `Suggested by ${interaction.user.tag}` })
      .setTimestamp();

    try {
      const posted = await targetChannel.send({ embeds: [embed] });
      await posted.react('👍').catch(() => {});
      await posted.react('👎').catch(() => {});
      await interaction.user.send('Your suggestion has been sent!').catch(() => {});
    } catch (err) {
      await interaction.followUp({ content: `❌ Could not post your suggestion: ${err.message}`, flags: EPHEMERAL });
    }
  },
};

const role = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Gives a member a role or removes it')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Gives a member a role')
        .addUserOption((opt) => opt.setName('user').setDescription('The member').setRequired(true))
        .addRoleOption((opt) => opt.setName('role').setDescription('The role').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Removes a role from a member')
        .addUserOption((opt) => opt.setName('user').setDescription('The member').setRequired(true))
        .addRoleOption((opt) => opt.setName('role').setDescription('The role').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const member = interaction.options.getMember('user');
    const targetRole = interaction.options.getRole('role');

    if (!member) {
      await interaction.reply({ content: '❌ That member could not be found.', flags: EPHEMERAL });
      return;
    }

    const roleCheck = canManageRole(interaction, targetRole);
    if (!roleCheck.ok) {
      await interaction.reply({ content: roleCheck.reason, flags: EPHEMERAL });
      return;
    }
    const memberCheck = canModerate(interaction, member);
    // Granting/removing roles on yourself is allowed (the role hierarchy is checked above).
    if (!memberCheck.ok && member.id !== interaction.user.id) {
      await interaction.reply({ content: memberCheck.reason, flags: EPHEMERAL });
      return;
    }

    try {
      if (sub === 'add') {
        await member.roles.add(targetRole);
        logging.logModAction(interaction.client, interaction.guildId, {
          action: 'Role added', target: `${member.user.tag} (${member.id})`, moderator: interaction.user.tag, reason: targetRole.name,
        });
        await interaction.reply(`✅ Role **${targetRole.name}** was given to **${member.user.tag}**.`);
      } else {
        await member.roles.remove(targetRole);
        logging.logModAction(interaction.client, interaction.guildId, {
          action: 'Role removed', target: `${member.user.tag} (${member.id})`, moderator: interaction.user.tag, reason: targetRole.name,
        });
        await interaction.reply(`✅ Role **${targetRole.name}** was removed from **${member.user.tag}**.`);
      }
    } catch (err) {
      console.error('Error in /role:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? "❌ I'm missing the permission to manage this role (maybe it's above my own role)."
          : `❌ Error: ${err.message}`,
        flags: EPHEMERAL,
      });
    }
  },
};

const purgeUser = {
  data: new SlashCommandBuilder()
    .setName('purge-user')
    .setDescription("Deletes a specific user's recent messages in this channel")
    .addUserOption((opt) => opt.setName('user').setDescription('The user whose messages should be deleted').setRequired(true))
    .addIntegerOption((opt) =>
      opt.setName('scan').setDescription('How many channel messages to scan (max. 100)').setMinValue(1).setMaxValue(100).setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    const scanAmount = interaction.options.getInteger('scan') || 100;

    await interaction.deferReply({ flags: EPHEMERAL });

    try {
      const messages = await interaction.channel.messages.fetch({ limit: scanAmount });
      const toDelete = messages.filter((m) => m.author.id === targetUser.id);
      const deleted = await interaction.channel.bulkDelete(toDelete, true);
      logging.logModAction(interaction.client, interaction.guildId, {
        action: `Purge user (${deleted.size} messages)`, target: `${targetUser.tag} (${targetUser.id})`, moderator: interaction.user.tag, reason: null,
      });
      await interaction.editReply(`🧹 Deleted ${deleted.size} message(s) from **${targetUser.tag}**.`);
    } catch (err) {
      console.error('Error in /purge-user:', err);
      await interaction.editReply(
        isMissingPermError(err)
          ? "❌ I'm missing the permission to delete messages in this channel."
          : `❌ Error: ${err.message} (Discord can only bulk-delete messages younger than 14 days.)`
      );
    }
  },
};

const say = {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Makes the bot send a message in a channel')
    .addChannelOption((opt) =>
      opt.setName('channel').setDescription('The target channel').addChannelTypes(ChannelType.GuildText).setRequired(true)
    )
    .addStringOption((opt) => opt.setName('message').setDescription('The message text').setRequired(true)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const text = interaction.options.getString('message');

    // Without the Discord "Mention @everyone" permission, /say may not trigger
    // @everyone/@here/role pings (otherwise this would bypass it via the bot).
    const canMassPing = interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.MentionEveryone);

    try {
      await channel.send({
        content: text,
        allowedMentions: { parse: canMassPing ? ['users', 'roles', 'everyone'] : ['users'] },
      });
      logging.logModAction(interaction.client, interaction.guildId, {
        action: '/say used', target: channel.toString(), moderator: interaction.user.tag, reason: text.slice(0, 200),
      });
      await interaction.reply({ content: `✅ Message sent in ${channel.toString()}.`, flags: EPHEMERAL });
    } catch (err) {
      console.error('Error in /say:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? "❌ I'm missing the permission to write in this channel."
          : `❌ Error: ${err.message}`,
        flags: EPHEMERAL,
      });
    }
  },
};

const coinflip = {
  data: new SlashCommandBuilder().setName('coinflip').setDescription('Flips a coin (heads or tails)'),
  async execute(interaction) {
    const result = Math.random() < 0.5 ? 'Heads 🪙' : 'Tails 🪙';
    await interaction.reply(`🎲 Result: **${result}**`);
  },
};

const dice = {
  data: new SlashCommandBuilder()
    .setName('dice')
    .setDescription('Rolls a die')
    .addIntegerOption((opt) => opt.setName('sides').setDescription('Number of sides (default: 6)').setMinValue(2).setMaxValue(1000).setRequired(false)),
  async execute(interaction) {
    const sides = interaction.options.getInteger('sides') || 6;
    const result = Math.floor(Math.random() * sides) + 1;
    await interaction.reply(`🎲 You rolled a **${result}** (1-${sides}).`);
  },
};

const EIGHT_BALL_ANSWERS = [
  'Yes, definitely.',
  'It is certain.',
  'Without a doubt.',
  'Yes.',
  'Probably.',
  'Hazy - try again later.',
  "Can't say right now.",
  'Concentrate and ask again.',
  "Don't count on it.",
  'My answer is no.',
  'My sources say no.',
  "Doesn't look good.",
  'Very doubtful.',
];

const eightball = {
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball a question')
    .addStringOption((opt) => opt.setName('question').setDescription('Your question').setRequired(true)),
  async execute(interaction) {
    const question = interaction.options.getString('question');
    const answer = EIGHT_BALL_ANSWERS[Math.floor(Math.random() * EIGHT_BALL_ANSWERS.length)];
    const embed = new EmbedBuilder()
      .setTitle('🎱 Magic 8-Ball')
      .addFields({ name: 'Question', value: question }, { name: 'Answer', value: answer })
      .setColor(0x2f3136);
    await interaction.reply({ embeds: [embed] });
  },
};

const membercount = {
  data: new SlashCommandBuilder().setName('membercount').setDescription("Shows this server's member count"),
  async execute(interaction) {
    await interaction.guild.fetch().catch(() => {});
    await interaction.reply(`👥 This server has **${interaction.guild.memberCount}** members.`);
  },
};

const roleinfo = {
  data: new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('Shows info about a role')
    .addRoleOption((opt) => opt.setName('role').setDescription('The role').setRequired(true)),
  async execute(interaction) {
    const role = interaction.options.getRole('role');
    const embed = new EmbedBuilder()
      .setTitle(`🎭 Role: ${role.name}`)
      .setColor(role.color || 0x5865f2)
      .addFields(
        { name: 'ID', value: role.id, inline: true },
        { name: 'Members', value: String(role.members?.size ?? 'unknown'), inline: true },
        { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
        { name: 'Created', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`, inline: true }
      );
    await interaction.reply({ embeds: [embed] });
  },
};

module.exports = { ping, remindme, suggest, role, purgeUser, say, coinflip, dice, eightball, membercount, roleinfo };
