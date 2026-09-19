// commands-core.js
const os = require('os');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  version: djsVersion,
} = require('discord.js');

const config = require('./config');
const pkg = require('./package.json');

function formatUptime(ms) {
  let totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  totalSeconds -= days * 86400;
  const hours = Math.floor(totalSeconds / 3600);
  totalSeconds -= hours * 3600;
  const minutes = Math.floor(totalSeconds / 60);
  totalSeconds -= minutes * 60;
  const seconds = totalSeconds;

  const parts = [];
  if (days > 0) parts.push(`${days} Tag${days === 1 ? '' : 'e'}`);
  if (hours > 0) parts.push(`${hours} Stunde${hours === 1 ? '' : 'n'}`);
  if (minutes > 0) parts.push(`${minutes} Minute${minutes === 1 ? '' : 'n'}`);
  parts.push(`${seconds} Sekunde${seconds === 1 ? '' : 'n'}`);
  return parts.join(', ');
}

const antimdm = {
  data: new SlashCommandBuilder().setName('antimdm').setDescription('Sendet den AntiMDM-Link'),
  async execute(interaction) {
    await interaction.reply(config.links.antimdm);
  },
};

const web = {
  data: new SlashCommandBuilder().setName('web').setDescription('Zeigt den Link zur Website'),
  async execute(interaction) {
    await interaction.reply(`Link: ${config.links.website}`);
  },
};

const uptime = {
  data: new SlashCommandBuilder().setName('uptime').setDescription('Zeigt an, wie lange der Bot schon läuft'),
  async execute(interaction) {
    const readyAt = interaction.client.readyTimestamp || Date.now();
    await interaction.reply(`⏱️ Uptime: ${formatUptime(Date.now() - readyAt)}`);
  },
};

const status = {
  data: new SlashCommandBuilder().setName('status').setDescription('Prüft, ob die Website erreichbar ist'),
  async execute(interaction) {
    await interaction.deferReply();
    const url = config.links.website;
    const TIMEOUT_MS = 6000;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const start = Date.now();

    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' });
      const ms = Date.now() - start;
      const embed = new EmbedBuilder()
        .setTitle('🌐 Website-Status')
        .setColor(res.ok ? 0x57f287 : 0xfee75c)
        .addFields(
          { name: 'URL', value: url },
          { name: 'Erreichbarkeit', value: res.ok ? '🟢 Erreichbar' : `🟡 HTTP-Status ${res.status}` },
          { name: 'HTTP-Code', value: String(res.status), inline: true },
          { name: 'Antwortzeit', value: `${ms} ms`, inline: true }
        )
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      const timedOut = err.name === 'AbortError';
      const embed = new EmbedBuilder()
        .setTitle('🌐 Website-Status')
        .setColor(0xed4245)
        .addFields(
          { name: 'URL', value: url },
          { name: 'Erreichbarkeit', value: '🔴 Nicht erreichbar' },
          { name: 'Fehler', value: timedOut ? `Zeitüberschreitung (> ${TIMEOUT_MS / 1000}s)` : err.message }
        )
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } finally {
      clearTimeout(timeoutHandle);
    }
  },
};

const changelogCmd = {
  data: new SlashCommandBuilder().setName('changelog').setDescription('Zeigt die letzten Updates des Projekts'),
  async execute(interaction) {
    const entries = config.changelog;
    if (!entries || entries.length === 0) {
      await interaction.reply({ content: 'Es sind noch keine Changelog-Einträge vorhanden.', ephemeral: true });
      return;
    }
    const latest = entries.slice(-5).reverse();
    const embed = new EmbedBuilder()
      .setTitle('📋 Changelog')
      .setColor(0x5865f2)
      .setDescription(latest.map((e) => `**${e.date || '?'}** — ${e.text || '(kein Text)'}`).join('\n\n'))
      .setFooter({ text: `Letzte ${latest.length} von ${entries.length} Einträgen` });
    await interaction.reply({ embeds: [embed] });
  },
};

const linksCmd = {
  data: new SlashCommandBuilder().setName('links').setDescription('Zeigt wichtige Links zum Projekt'),
  async execute(interaction) {
    const l = config.links || {};
    const fields = [];
    if (l.website) fields.push({ name: '🌐 Website', value: l.website });
    if (l.discordInvite) fields.push({ name: '💬 Discord-Server', value: l.discordInvite });
    if (l.github) fields.push({ name: '🐙 GitHub', value: l.github });
    if (l.antimdm) fields.push({ name: '🛡️ AntiMDM', value: l.antimdm });

    if (fields.length === 0) {
      await interaction.reply({ content: 'Es sind noch keine Links konfiguriert.', ephemeral: true });
      return;
    }
    const embed = new EmbedBuilder().setTitle('🔗 Wichtige Links').setColor(0x5865f2).addFields(fields);
    await interaction.reply({ embeds: [embed] });
  },
};

const reloadCmd = {
  data: new SlashCommandBuilder()
    .setName('reload')
    .setDescription('Lädt die .env neu, ohne den Bot neuzustarten')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const ownerId = process.env.OWNER_ID;
    if (ownerId && ownerId.trim() !== '' && interaction.user.id !== ownerId.trim()) {
      await interaction.reply({ content: 'Nur der Bot-Owner darf die Konfiguration neu laden.', ephemeral: true });
      return;
    }
    try {
      config.reloadAll();
      await interaction.reply({ content: '✅ Konfiguration wurde neu geladen (.env).', ephemeral: true });
    } catch (err) {
      console.error('Fehler beim Neuladen der Konfiguration:', err);
      await interaction.reply({ content: '❌ Fehler beim Neuladen der Konfiguration.', ephemeral: true });
    }
  },
};

const botinfo = {
  data: new SlashCommandBuilder().setName('botinfo').setDescription('Zeigt technische Informationen über den Bot'),
  async execute(interaction) {
    const client = interaction.client;
    const mem = process.memoryUsage();
    const uptimeMs = Date.now() - (client.readyTimestamp || Date.now());
    const embed = new EmbedBuilder()
      .setTitle('🤖 Bot-Info')
      .setColor(0x5865f2)
      .addFields(
        { name: 'Bot-Version', value: pkg.version || 'unbekannt', inline: true },
        { name: 'discord.js', value: djsVersion, inline: true },
        { name: 'Node.js', value: process.version, inline: true },
        { name: 'Server', value: String(client.guilds.cache.size), inline: true },
        { name: 'RAM-Nutzung', value: `${(mem.rss / 1024 / 1024).toFixed(1)} MB`, inline: true },
        { name: 'Plattform', value: `${os.platform()} (${os.arch()})`, inline: true },
        { name: 'Uptime (ms)', value: String(uptimeMs), inline: true }
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
};

// /help wird als Funktion exportiert, die die komplette Command-Liste braucht
// (wird von commands.js mit der finalen Liste verdrahtet, um Zirkelbezüge zu vermeiden).
function buildHelpCommand(getAllCommands) {
  return {
    data: new SlashCommandBuilder().setName('help').setDescription('Zeigt alle verfügbaren Befehle'),
    async execute(interaction) {
      const all = getAllCommands();

      const categories = {
        '📌 Allgemein': ['antimdm', 'web', 'uptime', 'status', 'changelog', 'links', 'botinfo', 'ping', 'help'],
        '🛡️ Moderation': [
          'kick',
          'ban',
          'timeout',
          'warn',
          'clear',
          'slowmode',
          'lock',
          'unlock',
          'nickname',
          'role',
          'purge-user',
          'say',
          'automod-words',
        ],
        '🎫 Tickets': ['ticket-panel'],
        '🧰 Sonstiges': [
          'userinfo',
          'serverinfo',
          'avatar',
          'poll',
          'remindme',
          'suggest',
          'coinflip',
          'dice',
          '8ball',
          'membercount',
          'roleinfo',
        ],
        '👨‍💻 Developer': ['base64', 'hash', 'json', 'timestamp', 'uuid', 'snowflake', 'regex-test'],
        '🎧 Spotify': ['spotify-login', 'spotify-nowplaying', 'spotify-play', 'spotify-pause', 'spotify-skip', 'spotify-search'],
        '⚙️ Einstellungen & Admin': ['settings', 'reload'],
      };

      const embed = new EmbedBuilder()
        .setTitle('📖 Befehlsübersicht')
        .setColor(0x5865f2)
        .setFooter({
          text: 'Außerdem: !support <Anliegen> und !support config (Text-Befehl, kein Slash-Command)',
        });

      for (const [category, names] of Object.entries(categories)) {
        const lines = names
          .map((name) => {
            const cmd = all.find((c) => c.data.name === name);
            if (!cmd) return null;
            const desc = cmd.data.toJSON().description || '';
            return `\`/${name}\` — ${desc}`;
          })
          .filter(Boolean);
        if (lines.length > 0) {
          embed.addFields({ name: category, value: lines.join('\n') });
        }
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
    },
  };
}

module.exports = {
  simpleCommands: [antimdm, web, uptime, status, changelogCmd, linksCmd, reloadCmd, botinfo],
  buildHelpCommand,
};
