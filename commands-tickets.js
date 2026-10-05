// commands-tickets.js
// Ticket commands. The actual logic (DM flow, forwarding, sessions) lives in
// ticket-runtime.js - there are NO ticket channels created anymore.
//
//   /ticket        - starts a ticket: the bot DMs the user (everyone)
//   /ticket-close  - cancels the open ticket; works in DMs with the bot (everyone)
//
// About "the bot deletes the user's message": Discord does not allow a bot to
// delete a slash-command invocation, but replying EPHEMERALLY hides it from
// everyone else completely - so nothing about /ticket stays visible in the channel.

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const storage = require('./storage');
const ticketRuntime = require('./ticket-runtime');
const { getMemberLevel, LEVEL } = require('./permissions');
const { EPHEMERAL } = require('./util');
const logging = require('./logging');

// Panels posted by OLDER versions (/ticket-panel, now removed) still carry this button - keep it working.
const OPEN_BUTTON_ID = 'ticket_open';
const CLOSE_BUTTON_ID = 'ticket_close'; // only used by ticket channels created by OLDER versions

// Shared by /ticket and the panel button.
async function startTicket(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const result = await ticketRuntime.begin(interaction.user, interaction.guild);
  await interaction.editReply(result.ok ? "📬 Check your DMs - I've asked you what you need help with." : `❌ ${result.error}`);
}

const ticket = {
  data: new SlashCommandBuilder().setName('ticket').setDescription('Opens a private support ticket (I will ask you in DMs)'),
  async execute(interaction) {
    await startTicket(interaction);
  },
};

const ticketClose = {
  data: new SlashCommandBuilder().setName('ticket-close').setDescription('Cancels your open ticket'),
  async execute(interaction) {
    const cancelled = ticketRuntime.cancel(interaction.user.id);
    const content = cancelled ? ticketRuntime.TEXT.cancelled : 'You have no open ticket.';
    await interaction.reply(interaction.inGuild() ? { content, flags: EPHEMERAL } : { content });
  },
};

async function handleOpenTicket(interaction) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: '❌ Tickets can only be opened on a server.', flags: EPHEMERAL });
    return;
  }
  await startTicket(interaction);
}

// Legacy: ticket channels created by older versions still carry a "Close Ticket"
// button. Keep it working so those old tickets can be closed; new tickets never use it.
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

module.exports = { ticket, ticketClose, OPEN_BUTTON_ID, CLOSE_BUTTON_ID, handleOpenTicket, handleCloseTicket };
