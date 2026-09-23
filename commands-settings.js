// commands-settings.js
const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const storage = require('./storage');
const { EPHEMERAL } = require('./util');
const logging = require('./logging');

// Zugriff (nur Administratoren) wird zentral in permissions.js geprüft.

function roleText(id) {
  return id ? `<@&${id}>` : 'Nicht gesetzt';
}

const settings = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Zeigt oder ändert die Bot-Einstellungen für diesen Server')
    .addSubcommand((sub) => sub.setName('view').setDescription('Zeigt die aktuellen Einstellungen'))
    .addSubcommand((sub) =>
      sub
        .setName('admin-role')
        .setDescription('Legt die Administrator-Rolle des Bots fest (ohne Angabe: zurücksetzen)')
        .addRoleOption((opt) => opt.setName('rolle').setDescription('Die Administrator-Rolle').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('mod-role')
        .setDescription('Legt die Moderator-Rolle des Bots fest (ohne Angabe: zurücksetzen)')
        .addRoleOption((opt) => opt.setName('rolle').setDescription('Die Moderator-Rolle').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('ticket-category')
        .setDescription('Legt die Kategorie fest, in der Ticket-Kanäle erstellt werden')
        .addChannelOption((opt) =>
          opt
            .setName('kategorie')
            .setDescription('Die Kategorie für Tickets')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('ticket-staff-role')
        .setDescription('Legt die Rolle fest, die alle Tickets sehen darf')
        .addRoleOption((opt) => opt.setName('rolle').setDescription('Die Support-Rolle').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('log-channel')
        .setDescription('Legt den Kanal fest, in dem Mod-/Ticket-Aktionen geloggt werden')
        .addChannelOption((opt) =>
          opt
            .setName('kanal')
            .setDescription('Der Log-Kanal')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'view') {
      const s = storage.getGuildSettings(guildId);
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Bot-Einstellungen')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Administrator-Rolle', value: roleText(s.adminRoleId), inline: true },
          { name: 'Moderator-Rolle', value: roleText(s.modRoleId), inline: true },
          { name: '\u200b', value: '\u200b', inline: true },
          { name: 'Ticket-Kategorie', value: s.ticketCategoryId ? `<#${s.ticketCategoryId}>` : 'Nicht gesetzt' },
          { name: 'Support-Rolle', value: roleText(s.ticketStaffRoleId) },
          { name: 'Log-Kanal', value: s.logChannelId ? `<#${s.logChannelId}>` : 'Nicht gesetzt' }
        )
        .setFooter({ text: 'Server-Owner und Mitglieder mit Discord-Administrator-Recht sind immer Administratoren.' });
      await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
      return;
    }

    if (sub === 'admin-role' || sub === 'mod-role') {
      const key = sub === 'admin-role' ? 'adminRoleId' : 'modRoleId';
      const label = sub === 'admin-role' ? 'Administrator-Rolle' : 'Moderator-Rolle';
      const role = interaction.options.getRole('rolle');

      if (!role) {
        storage.removeGuildSetting(guildId, key);
        logging.logSettingChange(interaction.client, guildId, { setting: label, value: null, moderator: interaction.user.tag });
        await interaction.reply({ content: `✅ ${label} wurde zurückgesetzt.`, flags: EPHEMERAL });
        return;
      }
      if (role.id === guildId) {
        await interaction.reply({ content: '❌ @everyone kann nicht als Team-Rolle verwendet werden.', flags: EPHEMERAL });
        return;
      }
      if (role.managed) {
        await interaction.reply({ content: '❌ Bot-/Integrationsrollen können nicht als Team-Rolle verwendet werden.', flags: EPHEMERAL });
        return;
      }
      storage.setGuildSetting(guildId, key, role.id);
      logging.logSettingChange(interaction.client, guildId, { setting: label, value: role.name, moderator: interaction.user.tag });
      await interaction.reply({
        content: `✅ ${label} gesetzt auf ${role.toString()}.`,
        flags: EPHEMERAL,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (sub === 'ticket-category') {
      const channel = interaction.options.getChannel('kategorie');
      storage.setGuildSetting(guildId, 'ticketCategoryId', channel.id);
      await interaction.reply({ content: `✅ Ticket-Kategorie gesetzt auf **${channel.name}**.`, flags: EPHEMERAL });
      return;
    }

    if (sub === 'ticket-staff-role') {
      const role = interaction.options.getRole('rolle');
      storage.setGuildSetting(guildId, 'ticketStaffRoleId', role.id);
      await interaction.reply({ content: `✅ Support-Rolle gesetzt auf **${role.name}**.`, flags: EPHEMERAL });
      return;
    }

    if (sub === 'log-channel') {
      const channel = interaction.options.getChannel('kanal');
      storage.setGuildSetting(guildId, 'logChannelId', channel.id);
      await interaction.reply({ content: `✅ Log-Kanal gesetzt auf **${channel.toString()}**.`, flags: EPHEMERAL });
      logging.logToGuild(interaction.client, guildId, {
        title: '⚙️ Log-Kanal gesetzt',
        fields: [{ name: 'Kanal', value: channel.toString(), inline: true }, { name: 'Von', value: interaction.user.tag, inline: true }],
      });
      return;
    }
  },
};

module.exports = { settings };
