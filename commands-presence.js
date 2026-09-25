// commands-presence.js
// /bot-status - AUSSCHLIESSLICH der Bot-Betreiber (siehe Begründung unten)
// /bstatnow   - AUSSCHLIESSLICH die hartkodierte Superuser-ID, detaillierte Konfiguration
//
// Hinweis zum Namen: Discord verlangt für Slash-Commands einen KOMPLETT
// kleingeschriebenen Namen. "bStatNow" (Großbuchstaben) wird von Discord.js beim
// Erstellen abgelehnt (ExpectedConstraintError) und lässt den ganzen Bot-Prozess
// abstürzen - deshalb heißt der Befehl hier bewusst "bstatnow".
//
// WARUM /bot-status NICHT an normale Server-Administratoren delegiert wird:
// Die Discord-Presence (Online/Idle/DND/Streaming) gehört zur EINEN
// Gateway-Verbindung des Bots und ist damit ZWANGSLÄUFIG für ALLE Server
// gleichzeitig identisch - Discord bietet dafür KEINE Pro-Server-Trennung an.
// Wäre dieser Befehl für jeden Server-Administrator freigegeben, könnte der
// Administrator IRGENDEINES Servers, auf dem der Bot Mitglied ist, den Status
// auf JEDEM ANDEREN Server verändern - das sieht von außen wie "andere Nutzer
// können diesen Server beeinflussen" aus und ist genau das nicht gewollt.
// Deshalb ist der Befehl auf den Bot-Betreiber beschränkt (siehe config.js,
// OWNER_ID/Superuser) - das ist die einzige Person, die ohnehin für alle
// Server, auf denen der Bot läuft, verantwortlich ist.
// Zugriff wird zentral in permissions.js geprüft (access: 'bot-owner' bzw. 'superuser').

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const presence = require('./presence');
const config = require('./config');
const { EPHEMERAL } = require('./util');

// Hinweis: Der Name "/status" ist im Bot bereits durch den BESTEHENDEN Befehl
// "Prüft, ob die Website erreichbar ist" belegt (commands-core.js) - der wird
// laut Auftrag nicht ohne ausdrückliche Anweisung entfernt. Dieser neue Befehl
// heißt deshalb "/bot-status".
const botStatus = {
  data: new SlashCommandBuilder()
    .setName('bot-status')
    .setDescription('Bot-Betreiber: stellt den Bot-Online-Status ein (gilt technisch bedingt bot-weit, nicht pro Server)')
    .addStringOption((o) =>
      o
        .setName('wert')
        .setDescription('Der neue Status')
        .setRequired(true)
        .addChoices(
          { name: 'Online', value: 'online' },
          { name: 'AFK / Idle', value: 'idle' },
          { name: 'Nicht stören / DND', value: 'dnd' },
          { name: 'Offline / Invisible', value: 'invisible' },
          { name: 'Twitch Streaming', value: 'twitch' },
          { name: 'Automatisch (zeigt Serveranzahl)', value: 'auto' }
        )
    ),
  async execute(interaction) {
    const wert = interaction.options.getString('wert');
    const who = `${interaction.user.tag} (Server: ${interaction.guild.name})`;

    if (wert === 'auto') {
      presence.setAuto(who);
    } else if (wert === 'twitch') {
      presence.setManualStreaming(`https://www.twitch.tv/${config.TWITCH_DEFAULT_NAME}`, who);
    } else {
      presence.setManualStatus(wert, who);
    }
    await presence.apply(interaction.client);

    await interaction.reply({
      content:
        `✅ Bot-Status gesetzt auf **${wert}**.\n` +
        `ℹ️ Hinweis: Die Discord-Presence gehört zum Bot-Account und gilt daher für **alle** Server gleichzeitig ` +
        `(Discord erlaubt keine unterschiedliche Presence pro Server) - die zuletzt gewählte Einstellung gewinnt.`,
      flags: EPHEMERAL,
    });
  },
};

const bstatnow = {
  data: new SlashCommandBuilder()
    .setName('bstatnow')
    .setDescription('Superuser: detaillierte Bot-Presence-Konfiguration')
    .addSubcommand((s) => s.setName('config').setDescription('Zeigt die verfügbaren Optionen und den aktuellen Stand'))
    .addSubcommand((s) =>
      s
        .setName('set-status')
        .setDescription('Setzt den Online-Status')
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Status')
            .setRequired(true)
            .addChoices(
              { name: 'Online', value: 'online' },
              { name: 'Idle', value: 'idle' },
              { name: 'DND', value: 'dnd' },
              { name: 'Invisible', value: 'invisible' }
            )
        )
    )
    .addSubcommand((s) =>
      s
        .setName('streaming')
        .setDescription(`Aktiviert Twitch-Streaming (Standard: ${config.TWITCH_DEFAULT_NAME})`)
        .addStringOption((o) => o.setName('url').setDescription('Abweichende Twitch-URL (optional)').setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName('activity')
        .setDescription('Setzt eine Aktivität (Playing/Watching/Listening)')
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Typ')
            .setRequired(true)
            .addChoices({ name: 'Playing', value: 'playing' }, { name: 'Watching', value: 'watching' }, { name: 'Listening', value: 'listening' })
        )
        .addStringOption((o) => o.setName('text').setDescription('Text der Aktivität').setRequired(true).setMaxLength(128))
    )
    .addSubcommand((s) => s.setName('auto').setDescription('Zurück in den Automatikmodus (zeigt die aktuelle Serveranzahl)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const who = `${interaction.user.tag} (Superuser)`;

    if (sub === 'config') {
      const cfg = presence.getConfig();
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Bot-Presence-Konfiguration')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Verfügbare Subcommands', value: '`config` `set-status` `streaming` `activity` `auto`' },
          { name: 'Aktueller Modus', value: cfg.mode === 'auto' ? 'Automatisch (Serveranzahl)' : 'Manuell', inline: true },
          { name: 'Zuletzt gesetzt von', value: cfg.setBy || 'Unbekannt', inline: true }
        );
      await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
      return;
    }

    if (sub === 'set-status') {
      presence.setManualStatus(interaction.options.getString('status'), who);
    } else if (sub === 'streaming') {
      const url = interaction.options.getString('url') || `https://www.twitch.tv/${config.TWITCH_DEFAULT_NAME}`;
      presence.setManualStreaming(url, who);
    } else if (sub === 'activity') {
      presence.setManualActivity(interaction.options.getString('type'), interaction.options.getString('text'), who);
    } else if (sub === 'auto') {
      presence.setAuto(who);
    }

    await presence.apply(interaction.client);
    await interaction.reply({ content: `✅ Presence aktualisiert (${sub}).`, flags: EPHEMERAL });
  },
};

module.exports = { botStatus, bstatnow };
