// commands-welcome.js
// Welcome-System: /welcome-setup und Welcome-Handler

const {
  SlashCommandBuilder,
  EmbedBuilder,
  Events,
} = require('discord.js');

const storage = require('./storage');
const { hasAdminPermission, replyNoPermission } = require('./permissions-manager');

const welcomeSetup = {
  data: new SlashCommandBuilder()
    .setName('welcome-setup')
    .setDescription('Konfiguriere das Welcome-System')
    .addSubcommand(subcommand =>
      subcommand
        .setName('role')
        .setDescription('Rolle, die neue User automatisch erhalten')
        .addRoleOption(option => option.setName('role').setDescription('Die Rolle').setRequired(false))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('channel')
        .setDescription('Channel für öffentliche Willkommensnachrichten')
        .addChannelOption(option => option.setName('channel').setDescription('Der Channel').setRequired(false))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('dm')
        .setDescription('Willkommensnachricht per DM aktivieren/deaktivieren')
        .addBooleanOption(option => option.setName('enabled').setDescription('DM aktivieren?').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand.setName('status').setDescription('Zeige aktuelle Welcome-Einstellungen')
    ),
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    // Berechtigungsprüfung (außer bei status)
    if (subcommand !== 'status') {
      if (!(await hasAdminPermission(interaction.member, interaction.guild))) {
        return replyNoPermission(interaction, 'Administrator');
      }
    }
    
    const guildId = interaction.guildId;
    let settings = storage.getGuildSettings(guildId);
    
    if (!settings.welcomeConfig) {
      settings.welcomeConfig = {};
    }
    
    if (subcommand === 'role') {
      const role = interaction.options.getRole('role');
      
      if (!role) {
        storage.setGuildSetting(guildId, 'welcomeConfig', { ...settings.welcomeConfig, welcomeRoleId: null });
        return interaction.reply({
          content: '✅ Willkommens-Rolle deaktiviert.',
          ephemeral: true,
        });
      }
      
      storage.setGuildSetting(guildId, 'welcomeConfig', { ...settings.welcomeConfig, welcomeRoleId: role.id });
      
      await interaction.reply({
        content: `✅ Neue User erhalten jetzt automatisch die Rolle ${role}.`,
        ephemeral: true,
      });
    } else if (subcommand === 'channel') {
      const channel = interaction.options.getChannel('channel');
      
      if (!channel) {
        storage.setGuildSetting(guildId, 'welcomeConfig', { ...settings.welcomeConfig, welcomeChannelId: null });
        return interaction.reply({
          content: '✅ Öffentliche Willkommensnachrichten deaktiviert.',
          ephemeral: true,
        });
      }
      
      storage.setGuildSetting(guildId, 'welcomeConfig', { ...settings.welcomeConfig, welcomeChannelId: channel.id });
      
      await interaction.reply({
        content: `✅ Willkommensnachrichten werden jetzt in ${channel} geposted.`,
        ephemeral: true,
      });
    } else if (subcommand === 'dm') {
      const enabled = interaction.options.getBoolean('enabled');
      
      storage.setGuildSetting(guildId, 'welcomeConfig', { ...settings.welcomeConfig, welcomeDM: enabled });
      
      await interaction.reply({
        content: `✅ Welcome-DMs sind jetzt ${enabled ? 'aktiviert' : 'deaktiviert'}.`,
        ephemeral: true,
      });
    } else if (subcommand === 'status') {
      settings = storage.getGuildSettings(guildId);
      const welcomeConfig = settings.welcomeConfig || {};
      
      const roleId = welcomeConfig.welcomeRoleId;
      const channelId = welcomeConfig.welcomeChannelId;
      const dmEnabled = welcomeConfig.welcomeDM || false;
      
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Welcome-Einstellungen')
        .setColor(0x5865F2)
        .addFields(
          { name: 'Willkommens-Rolle', value: roleId ? `<@&${roleId}>` : 'Nicht gesetzt', inline: false },
          { name: 'Willkommens-Channel', value: channelId ? `<#${channelId}>` : 'Nicht gesetzt', inline: false },
          { name: 'Welcome-DM', value: dmEnabled ? '✅ Aktiviert' : '❌ Deaktiviert', inline: false }
        )
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};

/**
 * Handler für GuildMemberAdd Event
 * @param {Client} client - Discord Client
 */
function setupWelcomeHandler(client) {
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const guildId = member.guild.id;
      const settings = storage.getGuildSettings(guildId);
      const welcomeConfig = settings.welcomeConfig || {};
      
      // Rolle automatisch vergeben
      if (welcomeConfig.welcomeRoleId) {
        try {
          const role = await member.guild.roles.fetch(welcomeConfig.welcomeRoleId);
          if (role) {
            await member.roles.add(role).catch(() => {
              console.warn(`Konnte Rolle ${welcomeConfig.welcomeRoleId} nicht an ${member.id} vergeben.`);
            });
          }
        } catch (e) {
          console.warn(`Fehler beim Abrufen der Welcome-Rolle: ${e.message}`);
        }
      }
      
      // Berechne Member-Nummer
      const memberCount = member.guild.memberCount;
      
      // Öffentliche Willkommensnachricht
      if (welcomeConfig.welcomeChannelId) {
        try {
          const channel = await member.guild.channels.fetch(welcomeConfig.welcomeChannelId);
          if (channel && channel.isTextBased()) {
            const embed = new EmbedBuilder()
              .setTitle('👋 Willkommen!')
              .setDescription(`Willkommen auf dem Server, ${member}! Du bist Member Nummer **${memberCount}**!`)
              .setColor(0x57F287)
              .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
              .setTimestamp();
            
            await channel.send({ embeds: [embed] });
          }
        } catch (e) {
          console.warn(`Konnte Welcome-Nachricht nicht senden: ${e.message}`);
        }
      }
      
      // DM-Willkommensnachricht
      if (welcomeConfig.welcomeDM) {
        try {
          const dmEmbed = new EmbedBuilder()
            .setTitle(`Willkommen auf ${member.guild.name}!`)
            .setDescription(`Hallo ${member}! Du bist Member Nummer **${memberCount}** auf unserem Server. Wir freuen uns, dich hier zu haben!`)
            .setColor(0x5865F2)
            .setThumbnail(member.guild.iconURL({ dynamic: true }))
            .setTimestamp();
          
          await member.send({ embeds: [dmEmbed] }).catch(() => {
            console.warn(`Konnte DM an ${member.id} nicht senden (wahrscheinlich DMs blockiert).`);
          });
        } catch (e) {
          console.warn(`Fehler beim Versand der Welcome-DM: ${e.message}`);
        }
      }
    } catch (error) {
      console.error('Fehler im Welcome-Handler:', error);
    }
  });
}

module.exports = {
  welcomeSetup,
  setupWelcomeHandler,
};
