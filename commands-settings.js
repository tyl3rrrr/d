// commands-settings.js
// Access (administrators only) is checked centrally in permissions.js.
const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const storage = require('./storage');
const { EPHEMERAL } = require('./util');
const logging = require('./logging');

function roleText(id) {
  return id ? `<@&${id}>` : 'Not set';
}

const settings = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Shows or changes the bot settings for this server')
    .addSubcommand((sub) => sub.setName('view').setDescription('Shows the current settings'))
    .addSubcommand((sub) =>
      sub
        .setName('admin-role')
        .setDescription("Sets the bot's administrator role (omit to reset)")
        .addRoleOption((opt) => opt.setName('role').setDescription('The administrator role').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('mod-role')
        .setDescription("Sets the bot's moderator role (omit to reset)")
        .addRoleOption((opt) => opt.setName('role').setDescription('The moderator role').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('ticket-category')
        .setDescription('Sets the category where ticket channels are created')
        .addChannelOption((opt) =>
          opt.setName('category').setDescription('The category for tickets').addChannelTypes(ChannelType.GuildCategory).setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('ticket-staff-role')
        .setDescription('Sets the role that can see all tickets')
        .addRoleOption((opt) => opt.setName('role').setDescription('The support role').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('log-channel')
        .setDescription('Sets the channel where mod/ticket/bot actions are logged')
        .addChannelOption((opt) =>
          opt.setName('channel').setDescription('The log channel').addChannelTypes(ChannelType.GuildText).setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'view') {
      const s = storage.getGuildSettings(guildId);
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Bot Settings')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Administrator role', value: roleText(s.adminRoleId), inline: true },
          { name: 'Moderator role', value: roleText(s.modRoleId), inline: true },
          { name: '\u200b', value: '\u200b', inline: true },
          { name: 'Ticket category', value: s.ticketCategoryId ? `<#${s.ticketCategoryId}>` : 'Not set' },
          { name: 'Support role', value: roleText(s.ticketStaffRoleId) },
          { name: 'Log channel', value: s.logChannelId ? `<#${s.logChannelId}>` : 'Not set' }
        )
        .setFooter({ text: 'The server owner and members with the Discord Administrator permission are always administrators.' });
      await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
      return;
    }

    if (sub === 'admin-role' || sub === 'mod-role') {
      const key = sub === 'admin-role' ? 'adminRoleId' : 'modRoleId';
      const label = sub === 'admin-role' ? 'Administrator role' : 'Moderator role';
      const role = interaction.options.getRole('role');

      if (!role) {
        storage.removeGuildSetting(guildId, key);
        logging.logSettingChange(interaction.client, guildId, { setting: label, value: null, moderator: interaction.user.tag });
        await interaction.reply({ content: `✅ ${label} was reset.`, flags: EPHEMERAL });
        return;
      }
      if (role.id === guildId) {
        await interaction.reply({ content: "❌ @everyone can't be used as a team role.", flags: EPHEMERAL });
        return;
      }
      if (role.managed) {
        await interaction.reply({ content: "❌ Bot/integration roles can't be used as a team role.", flags: EPHEMERAL });
        return;
      }
      storage.setGuildSetting(guildId, key, role.id);
      logging.logSettingChange(interaction.client, guildId, { setting: label, value: role.name, moderator: interaction.user.tag });
      await interaction.reply({
        content: `✅ ${label} set to ${role.toString()}.`,
        flags: EPHEMERAL,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (sub === 'ticket-category') {
      const channel = interaction.options.getChannel('category');
      storage.setGuildSetting(guildId, 'ticketCategoryId', channel.id);
      logging.logSettingChange(interaction.client, guildId, { setting: 'Ticket category', value: channel.name, moderator: interaction.user.tag });
      await interaction.reply({ content: `✅ Ticket category set to **${channel.name}**.`, flags: EPHEMERAL });
      return;
    }

    if (sub === 'ticket-staff-role') {
      const role = interaction.options.getRole('role');
      storage.setGuildSetting(guildId, 'ticketStaffRoleId', role.id);
      logging.logSettingChange(interaction.client, guildId, { setting: 'Support role', value: role.name, moderator: interaction.user.tag });
      await interaction.reply({ content: `✅ Support role set to **${role.name}**.`, flags: EPHEMERAL });
      return;
    }

    if (sub === 'log-channel') {
      const channel = interaction.options.getChannel('channel');
      storage.setGuildSetting(guildId, 'logChannelId', channel.id);
      await interaction.reply({ content: `✅ Log channel set to **${channel.toString()}**.`, flags: EPHEMERAL });
      logging.logToGuild(interaction.client, guildId, {
        title: '⚙️ Log channel set',
        fields: [
          { name: 'Channel', value: channel.toString(), inline: true },
          { name: 'By', value: interaction.user.tag, inline: true },
        ],
      });
      return;
    }
  },
};

module.exports = { settings };
