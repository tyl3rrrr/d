// commands-logs.js
// /log-channel Command - Setup von Log-Kanälen

const {
  SlashCommandBuilder,
  EmbedBuilder,
  Events,
} = require('discord.js');

const storage = require('./storage');
const { hasModeratorPermission, replyNoPermission } = require('./permissions-manager');

const logChannel = {
  data: new SlashCommandBuilder()
    .setName('log-channel')
    .setDescription('Stelle den Channel für Bot-Logs ein')
    .addChannelOption(option =>
      option.setName('channel').setDescription('Der Log-Channel (leer = deaktivieren)').setRequired(false)
    ),
  async execute(interaction) {
    if (!(await hasModeratorPermission(interaction.member, interaction.guild))) {
      return replyNoPermission(interaction, 'Moderator');
    }
    
    const channel = interaction.options.getChannel('channel');
    
    if (!channel) {
      storage.setGuildSetting(interaction.guildId, 'logChannelId', null);
      return interaction.reply({
        content: '✅ Bot-Logs deaktiviert.',
        ephemeral: true,
      });
    }
    
    if (!channel.isTextBased()) {
      return interaction.reply({
        content: '❌ Der Channel muss ein Text-Channel sein.',
        ephemeral: true,
      });
    }
    
    storage.setGuildSetting(interaction.guildId, 'logChannelId', channel.id);
    
    await interaction.reply({
      content: `✅ Bot-Logs werden jetzt in ${channel} protokolliert.`,
      ephemeral: true,
    });
  },
};

/**
 * Logger-Hilfsfunktion
 */
async function logToChannel(client, guildId, embed) {
  try {
    const settings = storage.getGuildSettings(guildId);
    if (!settings.logChannelId) return;
    
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(settings.logChannelId);
    
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (e) {
    console.warn(`Fehler beim Loggen: ${e.message}`);
  }
}

/**
 * Setup Log-Handler für verschiedene Bot-Events
 */
function setupLogHandlers(client) {
  // Member Join
  client.on(Events.GuildMemberAdd, async (member) => {
    const embed = new EmbedBuilder()
      .setTitle('👋 Member beigetreten')
      .setDescription(`${member} (${member.id})`)
      .setColor(0x57F287)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: 'Account-Alter', value: Math.round((Date.now() - member.user.createdTimestamp) / 1000 / 60 / 60 / 24) + ' Tage', inline: true }
      )
      .setTimestamp();
    
    await logToChannel(client, member.guild.id, embed);
  });
  
  // Member Leave
  client.on(Events.GuildMemberRemove, async (member) => {
    const embed = new EmbedBuilder()
      .setTitle('👋 Member verlassen')
      .setDescription(`${member.user.username} (${member.id})`)
      .setColor(0xED4245)
      .addFields(
        { name: 'Rollen', value: member.roles.cache.map(r => r.toString()).join(', ') || 'Keine', inline: false }
      )
      .setTimestamp();
    
    await logToChannel(client, member.guild.id, embed);
  });
}

/**
 * Helper: Logge eine Moderations-Aktion
 */
async function logModerationAction(client, guildId, action, targetUser, moderator, reason = '') {
  const embed = new EmbedBuilder()
    .setTitle(`⚖️ Moderations-Aktion: ${action}`)
    .setColor(0xFFA500)
    .addFields(
      { name: 'Benutzer', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
      { name: 'Moderator', value: `${moderator.tag} (${moderator.id})`, inline: true },
      { name: 'Grund', value: reason || 'Kein Grund angegeben', inline: false }
    )
    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
    .setTimestamp();
  
  await logToChannel(client, guildId, embed);
}

module.exports = {
  logChannel,
  logToChannel,
  setupLogHandlers,
  logModerationAction,
};
