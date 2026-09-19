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
// Gemeinsame Ticket-Erstellung - wird von der Button-Interaktion (Panel)
// UND vom Text-Befehl "!support" genutzt, damit es nur EIN Ticket-System
// mit einheitlichem Verhalten gibt (statt zwei getrennten Implementierungen).
// ---------------------------------------------------------------------------
async function createTicketChannel(guild, requester, initialText) {
  const settings = storage.getGuildSettings(guild.id);

  if (!settings.ticketCategoryId) {
    return { ok: false, error: 'Es ist noch keine Ticket-Kategorie eingestellt (`/settings ticket-category` oder `!support config`).' };
  }

  const category = guild.channels.cache.get(settings.ticketCategoryId);
  if (!category) {
    return { ok: false, error: 'Die eingestellte Ticket-Kategorie existiert nicht mehr. Bitte neu einstellen.' };
  }

  // Doppelte Tickets pro Nutzer verhindern (Topic = User-ID)
  const existing = category.children?.cache?.find((ch) => ch.topic === requester.id);
  if (existing) {
    return { ok: true, existing: true, channel: existing };
  }

  let me;
  try {
    me = await guild.members.fetchMe();
  } catch (err) {
    return { ok: false, error: `Konnte eigene Berechtigungen nicht prüfen: ${err.message}` };
  }

  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return { ok: false, error: 'Mir fehlt die Berechtigung "Kanäle verwalten", um ein Ticket zu erstellen.' };
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
      reason: `Ticket #${ticketNumber} von ${requester.tag}`,
    });

    const embed = new EmbedBuilder()
      .setTitle(`🎫 Ticket #${ticketNumber}`)
      .setDescription(
        initialText
          ? `**Anliegen von <@${requester.id}>:**\n${initialText}`
          : `Hallo <@${requester.id}>! Beschreibe dein Problem oder deine Frage - das Support-Team meldet sich hier.`
      )
      .setColor(0x5865f2)
      .setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CLOSE_BUTTON_ID).setLabel('Ticket schließen').setStyle(ButtonStyle.Danger).setEmoji('🔒')
    );

    await channel.send({
      content: settings.ticketStaffRoleId ? `<@&${settings.ticketStaffRoleId}>` : undefined,
      embeds: [embed],
      components: [closeRow],
    });

    // Genau EINE Benachrichtigung im Log-Kanal - nicht wiederholt.
    if (settings.logChannelId) {
      const logChannel = guild.channels.cache.get(settings.logChannelId);
      if (logChannel && logChannel.isTextBased()) {
        await logChannel
          .send(`🎫 Ticket #${ticketNumber} von **${requester.tag}** erstellt: ${channel.toString()}`)
          .catch(() => {});
      }
    }

    return { ok: true, existing: false, channel, ticketNumber };
  } catch (err) {
    console.error('Fehler beim Erstellen des Ticket-Kanals:', err);
    return { ok: false, error: err.message };
  }
}

const ticketPanel = {
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Postet ein Panel, über das Nutzer Support-Tickets öffnen können (Button "Create Ticket")')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const settings = storage.getGuildSettings(interaction.guild.id);

    if (!settings.ticketCategoryId) {
      await interaction.reply({
        content:
          '❌ Es ist noch keine Ticket-Kategorie eingestellt. Bitte zuerst `/settings ticket-category` ausführen (oder `!support config`).',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🎫 Support-Ticket')
      .setDescription('Klicke auf den Button unten, um ein privates Support-Ticket zu öffnen.')
      .setColor(0x5865f2);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(OPEN_BUTTON_ID).setLabel('Create Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫')
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};

async function handleOpenTicket(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const result = await createTicketChannel(interaction.guild, interaction.user, null);

  if (!result.ok) {
    await interaction.editReply(`❌ ${result.error}`);
    return;
  }

  if (result.existing) {
    await interaction.editReply(`❗ Du hast bereits ein offenes Ticket: ${result.channel.toString()}`);
    return;
  }

  await interaction.editReply(`✅ Dein Ticket wurde erstellt: ${result.channel.toString()}`);
}

async function handleCloseTicket(interaction) {
  const channel = interaction.channel;
  const guild = interaction.guild;
  const settings = storage.getGuildSettings(guild.id);

  const isOwner = channel.topic === interaction.user.id;
  const member = interaction.member;
  const isStaff =
    member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    (settings.ticketStaffRoleId && member.roles.cache.has(settings.ticketStaffRoleId));

  if (!isOwner && !isStaff) {
    await interaction.reply({ content: '❌ Nur der Ticket-Ersteller oder das Support-Team kann dieses Ticket schließen.', ephemeral: true });
    return;
  }

  await interaction.reply('🔒 Dieses Ticket wird in 5 Sekunden geschlossen...');

  if (settings.logChannelId) {
    const logChannel = guild.channels.cache.get(settings.logChannelId);
    if (logChannel && logChannel.isTextBased()) {
      await logChannel.send(`🔒 Ticket **${channel.name}** wurde von **${interaction.user.tag}** geschlossen.`).catch(() => {});
    }
  }

  setTimeout(async () => {
    try {
      await channel.delete('Ticket geschlossen');
    } catch (err) {
      console.error('Fehler beim Löschen des Ticket-Kanals:', err);
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
