// commands-bot-status.js
// /status - ändere Bot-Status
// /bStatNow - Superuser konfiguriert Bot-Presence

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PresenceUpdateStatus,
  ActivityType,
} = require('discord.js');

const storage = require('./storage');
const { hasAdminPermission, isSuperuser, replyNoPermission } = require('./permissions-manager');

// SUPERUSER_ID wird aus isSuperuser() geholt, nicht hardcoded hier
const TWITCH_NAME_DEFAULT = '0tylxrrrr';

const statusCommand = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Stelle den Bot-Status ein')
    .addStringOption(option =>
      option
        .setName('status')
        .setDescription('Der neue Status')
        .setRequired(true)
        .addChoices(
          { name: 'Online', value: 'online' },
          { name: 'AFK / Idle', value: 'idle' },
          { name: 'Nicht stören / DND', value: 'dnd' },
          { name: 'Offline / Invisible', value: 'invisible' }
        )
    )
    .addStringOption(option =>
      option.setName('activity').setDescription('Aktivität (optional)').setRequired(false)
    ),
  async execute(interaction) {
    if (!(await hasAdminPermission(interaction.member, interaction.guild))) {
      return replyNoPermission(interaction, 'Administrator');
    }
    
    const status = interaction.options.getString('status');
    const activity = interaction.options.getString('activity') || null;
    
    // Status-Mapping Discord.js
    const statusMap = {
      'online': PresenceUpdateStatus.Online,
      'idle': PresenceUpdateStatus.Idle,
      'dnd': PresenceUpdateStatus.DoNotDisturb,
      'invisible': PresenceUpdateStatus.Invisible,
    };
    
    const presence = { status: statusMap[status] };
    
    if (activity) {
      presence.activities = [{
        name: activity,
        type: ActivityType.Watching,
      }];
    }
    
    await interaction.client.user.setPresence(presence);
    
    await interaction.reply({
      content: `✅ Bot-Status geändert zu **${status}**${activity ? ` mit Aktivität: ${activity}` : ''}.`,
      ephemeral: true,
    });
    
    // Server-spezifische Konfiguration speichern
    storage.setGuildSetting(interaction.guildId, 'botStatus', {
      status,
      activity,
      timestamp: Date.now(),
    });
  },
};

const bStatNow = {
  data: new SlashCommandBuilder()
    .setName('bStatNow')
    .setDescription('Konfiguriere die Bot-Presence (nur Superuser)')
    .addSubcommand(subcommand =>
      subcommand.setName('config').setDescription('Konfiguriere die Bot-Presence')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-status')
        .setDescription('Stelle den Status ein')
        .addStringOption(option =>
          option
            .setName('status')
            .setDescription('Der neue Status')
            .setRequired(true)
            .addChoices(
              { name: 'Online', value: 'online' },
              { name: 'AFK / Idle', value: 'idle' },
              { name: 'Nicht stören', value: 'dnd' },
              { name: 'Invisible', value: 'invisible' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('streaming')
        .setDescription('Schalte Twitch-Streaming ein')
        .addStringOption(option =>
          option
            .setName('streaming-url')
            .setDescription('Twitch URL (oder leer für Default)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('activity')
        .setDescription('Stelle eine Aktivität ein')
        .addStringOption(option =>
          option.setName('type').setDescription('Aktivitätstyp').setRequired(true)
            .addChoices(
              { name: 'Playing', value: 'Playing' },
              { name: 'Watching', value: 'Watching' },
              { name: 'Listening', value: 'Listening' }
            )
        )
        .addStringOption(option => option.setName('text').setDescription('Text der Aktivität').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand.setName('servers').setDescription('Zeige Server-Anzahl im Status')
    ),
  async execute(interaction) {
    if (!isSuperuser(interaction.user.id)) {
      return interaction.reply({
        content: '❌ Nur der Superuser darf diesen Command verwenden.',
        ephemeral: true,
      });
    }
    
    const subcommand = interaction.options.getSubcommand();
    const client = interaction.client;
    
    if (subcommand === 'config') {
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Bot-Presence Konfiguration')
        .setColor(0x5865F2)
        .addFields(
          { name: 'Verfügbare Befehle', value: '`/bStatNow set-status`, `/bStatNow streaming`, `/bStatNow activity`, `/bStatNow servers`', inline: false },
          { name: 'set-status', value: 'Stelle den Bot-Status ein (online, idle, dnd, invisible)', inline: false },
          { name: 'streaming', value: `Starte Twitch-Streaming (Default: ${process.env.TWITCH_NAME || '0tylxrrrr'})`, inline: false },
          { name: 'activity', value: 'Zeige eine Aktivität an (Playing, Watching, Listening)', inline: false },
          { name: 'servers', value: 'Zeige die Server-Anzahl im Status an', inline: false }
        )
        .setTimestamp();
      
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    if (subcommand === 'set-status') {
      const status = interaction.options.getString('status');
      const statusMap = {
        'online': PresenceUpdateStatus.Online,
        'idle': PresenceUpdateStatus.Idle,
        'dnd': PresenceUpdateStatus.DoNotDisturb,
        'invisible': PresenceUpdateStatus.Invisible,
      };
      
      await client.user.setPresence({
        status: statusMap[status],
      });
      
      return interaction.reply({
        content: `✅ Bot-Status zu **${status}** geändert.`,
        ephemeral: true,
      });
    }
    
    if (subcommand === 'streaming') {
      const twitchName = process.env.TWITCH_NAME || '0tylxrrrr';
      const streamingUrl = interaction.options.getString('streaming-url') || `https://www.twitch.tv/${twitchName}`;
      
      await client.user.setPresence({
        activities: [{
          name: `Streaming auf Twitch`,
          type: ActivityType.Streaming,
          url: streamingUrl,
        }],
        status: PresenceUpdateStatus.Online,
      });
      
      return interaction.reply({
        content: `✅ Bot zeigt jetzt Twitch-Streaming an: ${streamingUrl}`,
        ephemeral: true,
      });
    }
    
    if (subcommand === 'activity') {
      const type = interaction.options.getString('type');
      const text = interaction.options.getString('text');
      
      const typeMap = {
        'Playing': ActivityType.Playing,
        'Watching': ActivityType.Watching,
        'Listening': ActivityType.Listening,
      };
      
      await client.user.setPresence({
        activities: [{
          name: text,
          type: typeMap[type],
        }],
        status: PresenceUpdateStatus.Online,
      });
      
      return interaction.reply({
        content: `✅ Aktivität zu **${type} ${text}** geändert.`,
        ephemeral: true,
      });
    }
    
    if (subcommand === 'servers') {
      const serverCount = client.guilds.cache.size;
      
      await client.user.setPresence({
        activities: [{
          name: `${serverCount} Server`,
          type: ActivityType.Watching,
        }],
        status: PresenceUpdateStatus.Online,
      });
      
      return interaction.reply({
        content: `✅ Bot zeigt jetzt **${serverCount} Server** an.`,
        ephemeral: true,
      });
    }
  },
};

/**
 * Aktualisiere Server-Anzahl im Presence
 */
function setupServerCountPresence(client) {
  setInterval(() => {
    const serverCount = client.guilds.cache.size;
    client.user.setPresence({
      activities: [{
        name: `${serverCount} Server`,
        type: ActivityType.Watching,
      }],
      status: PresenceUpdateStatus.Online,
    }).catch(() => {});
  }, 60 * 1000); // Alle 60 Sekunden aktualisieren
}

module.exports = {
  statusCommand,
  bStatNow,
  setupServerCountPresence,
};
