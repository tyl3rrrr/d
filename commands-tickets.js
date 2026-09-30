// commands-tickets.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const storage = require('./storage');
const { getMemberLevel, LEVEL } = require('./permissions');
const { EPHEMERAL } = require('./util');
const logging = require('./logging');

const OPEN_BUTTON_ID = 'ticket_open';
const CLOSE_BUTTON_ID = 'ticket_close';

function sanitizeChannelName(username) {
  return `ticket-${username}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90);
}

// ---------------------------------------------------------------------------
// Shared ticket creation - used by the button interaction (panel) AND the
// "!support" text command, so there's only ONE ticket system with consistent
// behavior (instead of two separate implementations).
// ---------------------------------------------------------------------------
async function createTicketChannel(guild, requester, initialText) {
  const settings = storage.getGuildSettings(guild.id);

  if (!settings.ticketCategoryId) {
    return { ok: false, error: 'No ticket category has been set yet (`/settings ticket-category` or `!support config`).' };
  }

  const category = guild.channels.cache.get(settings.ticketCategoryId);
  if (!category) {
    return { ok: false, error: 'The configured ticket category no longer exists. Please set it again.' };
  }

  // Prevent duplicate tickets per user (topic = user ID)
  const existing = category.children?.cache?.find((ch) => ch.topic === requester.id);
  if (existing) {
    return { ok: true, existing: true, channel: existing };
  }

  let me;
  try {
    me = await guild.members.fetchMe();
  } catch (err) {
    return { ok: false, error: `Could not check my own permissions: ${err.message}` };
  }

  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return { ok: false, error: 'I\'m missing the "Manage Channels" permission needed to create a ticket.' };
  }

  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: requester.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
    {
      id: me.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
    },
  ];

  if (settings.ticketStaffRoleId) {
    permissionOverwrites.push({
      id: settings.ticketStaffRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  try {
    const ticketNumber = storage.nextTicketNumber(guild.id);
    const channel = await guild.channels.create({
      name: sanitizeChannelName(requester.username),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: requester.id,
      permissionOverwrites,
      reason: `Ticket #${ticketNumber} by ${requester.tag}`,
    });

    const embed = new EmbedBuilder()
      .setTitle(`🎫 Ticket #${ticketNumber}`)
      .setDescription(
        initialText
          ? `**Request from <@${requester.id}>:**\n${initialText}`
          : `Hello <@${requester.id}>! Describe your problem or question - the support team will respond here.`
      )
      .setColor(0x5865f2)
      .setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CLOSE_BUTTON_ID).setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
    );

    await channel.send({
      content: settings.ticketStaffRoleId ? `<@&${settings.ticketStaffRoleId}>` : undefined,
      embeds: [embed],
      components: [closeRow],
    });

    // Exactly ONE notification in the log channel (via the central logger).
    logging.logToGuild(guild.client, guild.id, {
      title: '🎫 Ticket created',
      fields: [
        { name: 'Ticket', value: `#${ticketNumber} - ${channel.toString()}`, inline: true },
        { name: 'By', value: requester.tag, inline: true },
      ],
    });

    return { ok: true, existing: false, channel, ticketNumber };
  } catch (err) {
    console.error('Error creating the ticket channel:', err);
    return { ok: false, error: err.message };
  }
}

const ticketPanel = {
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Posts a panel where users can open support tickets ("Create Ticket" button)'),

  async execute(interaction) {
    const settings = storage.getGuildSettings(interaction.guild.id);

    if (!settings.ticketCategoryId) {
      await interaction.reply({
        content:
          '❌ No ticket category has been set yet. Please run `/settings ticket-category` first (or `!support config`).',
        flags: EPHEMERAL,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🎫 Support Ticket')
      .setDescription('Click the button below to open a private support ticket.')
      .setColor(0x5865f2);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(OPEN_BUTTON_ID).setLabel('Create Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫')
    );

    // Reply ephemerally (only the admin who ran the command sees anything - per
    // Discord, an ephemeral interaction reply hides the whole "used /command"
    // notice from everyone else too), then post the actual panel as a plain
    // channel message so it looks like a normal bot post, not a command reply.
    await interaction.reply({ content: '✅ Panel posted below.', flags: EPHEMERAL });
    await interaction.channel.send({ embeds: [embed], components: [row] });
  },
};

async function handleOpenTicket(interaction) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: '❌ Tickets only exist on servers.', flags: EPHEMERAL });
    return;
  }
  await interaction.deferReply({ flags: EPHEMERAL });

  const result = await createTicketChannel(interaction.guild, interaction.user, null);

  if (!result.ok) {
    await interaction.editReply(`❌ ${result.error}`);
    return;
  }

  if (result.existing) {
    await interaction.editReply(`❗ You already have an open ticket: ${result.channel.toString()}`);
    return;
  }

  await interaction.editReply(`✅ Your ticket was created: ${result.channel.toString()}`);
}

async function handleCloseTicket(interaction) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: '❌ Tickets only exist on servers.', flags: EPHEMERAL });
    return;
  }
  const channel = interaction.channel;
  const guild = interaction.guild;
  const settings = storage.getGuildSettings(guild.id);

  const isOwner = channel.topic === interaction.user.id;
  const member = interaction.member;
  // Staff = support role, Manage Channels permission, OR moderator/admin/owner per the central rank system.
  const isStaff =
    member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    (settings.ticketStaffRoleId && member.roles.cache.has(settings.ticketStaffRoleId)) ||
    getMemberLevel(guild, member) >= LEVEL.MOD;

  if (!isOwner && !isStaff) {
    await interaction.reply({ content: '❌ Only the ticket creator or the support team can close this ticket.', flags: EPHEMERAL });
    return;
  }

  await interaction.reply('🔒 This ticket will be closed in 5 seconds...');

  logging.logToGuild(interaction.client, interaction.guildId, {
    title: '🔒 Ticket closed',
    fields: [
      { name: 'Channel', value: channel.name, inline: true },
      { name: 'By', value: interaction.user.tag, inline: true },
    ],
  });

  setTimeout(async () => {
    try {
      await channel.delete('Ticket closed');
    } catch (err) {
      console.error('Error deleting the ticket channel:', err);
    }
  }, 5000);
}

module.exports = {
  ticketPanel,
  OPEN_BUTTON_ID,
  CLOSE_BUTTON_ID,
  handleOpenTicket,
  handleCloseTicket,
  createTicketChannel,
};
