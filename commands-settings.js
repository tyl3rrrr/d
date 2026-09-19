// commands-settings.js
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const storage = require('./storage');

const settings = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Zeigt oder ändert die Bot-Einstellungen für diesen Server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('view').setDescription('Zeigt die aktuellen Einstellungen'))
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
          { name: 'Ticket-Kategorie', value: s.ticketCategoryId ? `<#${s.ticketCategoryId}>` : 'Nicht gesetzt' },
          { name: 'Support-Rolle', value: s.ticketStaffRoleId ? `<@&${s.ticketStaffRoleId}>` : 'Nicht gesetzt' },
          { name: 'Log-Kanal', value: s.logChannelId ? `<#${s.logChannelId}>` : 'Nicht gesetzt' }
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === 'ticket-category') {
      const channel = interaction.options.getChannel('kategorie');
      storage.setGuildSetting(guildId, 'ticketCategoryId', channel.id);
      await interaction.reply({ content: `✅ Ticket-Kategorie gesetzt auf **${channel.name}**.`, ephemeral: true });
      return;
    }

    if (sub === 'ticket-staff-role') {
      const role = interaction.options.getRole('rolle');
      storage.setGuildSetting(guildId, 'ticketStaffRoleId', role.id);
      await interaction.reply({ content: `✅ Support-Rolle gesetzt auf **${role.name}**.`, ephemeral: true });
      return;
    }

    if (sub === 'log-channel') {
      const channel = interaction.options.getChannel('kanal');
      storage.setGuildSetting(guildId, 'logChannelId', channel.id);
      await interaction.reply({ content: `✅ Log-Kanal gesetzt auf **${channel.toString()}**.`, ephemeral: true });
      return;
    }
  },
};

module.exports = { settings };
