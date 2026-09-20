// commands-appearance.js
// /appearence Command - zeigt Discord Features und Bot-Einstellungen

const {
  SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');

const appearence = {
  data: new SlashCommandBuilder()
    .setName('appearence')
    .setDescription('Zeige verfügbare Discord-Features und Bot-Einstellungen')
    .addSubcommand(subcommand =>
      subcommand.setName('features').setDescription('Zeige verfügbare Features')
    )
    .addSubcommand(subcommand =>
      subcommand.setName('bot').setDescription('Zeige Bot-Einstellungen')
    )
    .addSubcommand(subcommand =>
      subcommand.setName('themes').setDescription('Zeige verfügbare Themes/Darstellungen')
    ),
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'features') {
      const embed = new EmbedBuilder()
        .setTitle('✨ Discord Features')
        .setColor(0x5865F2)
        .addFields(
          { name: '🎨 Theme', value: 'Hellmodus / Dunkelmodus', inline: true },
          { name: '🔔 Benachrichtigungen', value: 'Konfigurierbar pro Channel', inline: true },
          { name: '🎌 Sprache', value: 'Mehrsprachig (30+ Sprachen)', inline: true },
          { name: '👤 Status', value: 'Online / AFK / DND / Unsichtbar', inline: true },
          { name: '🎮 Rich Presence', value: 'Zeige deine Aktivität', inline: true },
          { name: '🎙️ Sprachkanal', value: 'Push-to-Talk / Sprachwechsel', inline: true },
          { name: '🎬 Stream', value: 'Screenshare & Streaming', inline: true },
          { name: '⚡ Emojis & Sticker', value: 'Benutzerdefinierte Server-Emojis', inline: true },
          { name: '🔐 Zwei-Faktor-Authentifizierung', value: 'Server & Account Sicherheit', inline: true },
          { name: '📱 Mobile App', value: 'iOS & Android Support', inline: true }
        )
        .setThumbnail(interaction.client.user.displayAvatarURL())
        .setFooter({ text: 'Discord Appearance Settings' })
        .setTimestamp();
      
      return interaction.reply({ embeds: [embed], ephemeral: false });
    } else if (subcommand === 'bot') {
      const embed = new EmbedBuilder()
        .setTitle('🤖 Bot-Einstellungen & Funktionen')
        .setColor(0x5865F2)
        .addFields(
          { name: '💬 Slash-Commands', value: 'Moderne, intuitive Befehle mit `/`', inline: true },
          { name: '⚙️ Konfigurierbarkeit', value: 'Per-Server Einstellungen speichern', inline: true },
          { name: '📊 XP-System', value: 'Level & Erfahrung sammeln', inline: true },
          { name: '👋 Welcome-System', value: 'Auto-Willkommensnachrichten & Rollen', inline: true },
          { name: '🛡️ Moderation', value: 'Kick, Ban, Timeout, Warn & mehr', inline: true },
          { name: '📝 Logs', value: 'Alle Bot-Aktionen protokolliert', inline: true },
          { name: '🎫 Tickets', value: 'Automatisches Ticket-System', inline: true },
          { name: '🔤 AutoMod', value: 'Lokaler Wortfilter & Automatische Moderation', inline: true },
          { name: '🌍 Globale Ranglisten', value: 'Globales XP-Leaderboard', inline: true },
          { name: '📱 Bot-Status', value: 'Anpassbarer Presence & Status', inline: true }
        )
        .setThumbnail(interaction.client.user.displayAvatarURL())
        .setFooter({ text: 'tylxrrrr Discord Bot' })
        .setTimestamp();
      
      return interaction.reply({ embeds: [embed], ephemeral: false });
    } else if (subcommand === 'themes') {
      const embed = new EmbedBuilder()
        .setTitle('🎨 Verfügbare Themes & Designs')
        .setColor(0x5865F2)
        .addFields(
          { name: '🌙 Dunkelmodus', value: 'Standard-Theme von Discord', inline: true },
          { name: '☀️ Hellmodus', value: 'Helles Theme für die Augen', inline: true },
          { name: '🎨 Custom Emojis', value: 'Benutzerdefinierte Server-Emojis verwenden', inline: true },
          { name: '💎 Premium Skins', value: 'Discord Nitro Exclusive Themes', inline: true },
          { name: '🔴 Red Theme', value: 'Warm & Intensiv', inline: true },
          { name: '🔵 Blue Theme', value: 'Kühl & Professionell', inline: true },
          { name: '💜 Purple Theme', value: 'Discord-Farbe als Standard', inline: true },
          { name: '🟢 Green Theme', value: 'Entspannend & Natürlich', inline: true },
          { name: '🎭 Dark Mode High Contrast', value: 'Verbesserte Barrierefreiheit', inline: true },
          { name: '⌨️ Custom Tastaturlayout', value: 'Für verschiedene Sprachen', inline: true }
        )
        .setThumbnail(interaction.client.user.displayAvatarURL())
        .setDescription('Nutzer können ihre eigenen Theme-Einstellungen in den Discord User Settings vornehmen.')
        .setFooter({ text: 'Alle Themes sind in Discord > User Settings > Appearance verfügbar' })
        .setTimestamp();
      
      return interaction.reply({ embeds: [embed], ephemeral: false });
    }
  },
};

module.exports = {
  appearence,
};
