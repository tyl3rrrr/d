// commands-core.js
const os = require('os');
const { SlashCommandBuilder, EmbedBuilder, version: djsVersion } = require('discord.js');

const config = require('./config');
const pkg = require('./package.json');
const { EPHEMERAL, truncate, splitLines } = require('./util');

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
    // Prozess-Uptime: startet bei jedem Neustart des Bots UND nach einem
    // Aus-/Wiedereinschalten des Hosts wieder bei 0 (siehe config.js).
    await interaction.reply(`⏱️ Uptime: ${formatUptime(config.getUptimeMs())}`);
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
      await interaction.reply({ content: 'Es sind noch keine Changelog-Einträge vorhanden.', flags: EPHEMERAL });
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
      await interaction.reply({ content: 'Es sind noch keine Links konfiguriert.', flags: EPHEMERAL });
      return;
    }
    const embed = new EmbedBuilder().setTitle('🔗 Wichtige Links').setColor(0x5865f2).addFields(fields);
    await interaction.reply({ embeds: [embed] });
  },
};

const reloadCmd = {
  // Zugriff (nur Bot-Betreiber) wird zentral in permissions.js geprüft (access: 'bot-owner').
  data: new SlashCommandBuilder().setName('reload').setDescription('Lädt die .env neu, ohne den Bot neuzustarten'),
  async execute(interaction) {
    try {
      config.reloadAll();
      await interaction.reply({ content: '✅ Konfiguration wurde neu geladen (.env).', flags: EPHEMERAL });
    } catch (err) {
      console.error('Fehler beim Neuladen der Konfiguration:', err);
      await interaction.reply({ content: '❌ Fehler beim Neuladen der Konfiguration.', flags: EPHEMERAL });
    }
  },
};

const botinfo = {
  data: new SlashCommandBuilder().setName('botinfo').setDescription('Zeigt technische Informationen über den Bot'),
  async execute(interaction) {
    const client = interaction.client;
    const mem = process.memoryUsage();
    const uptimeMs = config.getUptimeMs();
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
        { name: 'Uptime', value: formatUptime(uptimeMs), inline: true }
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
};

// ---------------------------------------------------------------------------
// /help - wird AUTOMATISCH aus der tatsächlich registrierten Command-Liste
// erzeugt. Es gibt keine manuelle Command-Liste mehr, die man bei neuen
// Commands vergessen könnte: Jeder Command trägt seine Kategorie (siehe
// Registry in commands.js). Commands ohne bekannte Kategorie landen unter
// "Weitere" - es fällt also nie ein Command aus der Übersicht.
// ---------------------------------------------------------------------------
const CATEGORY_ORDER = [
  ['general', '📌 Allgemein'],
  ['moderation', '🛡️ Moderation'],
  ['admin', '⚙️ Administration'],
  ['welcome', '👋 Welcome'],
  ['tickets', '🎫 Tickets'],
  ['utility', '🧰 Nützliches & Spaß'],
  ['xp', '⭐ XP'],
  ['bot', '🤖 Bot'],
  ['ai', '🧠 KI'],
];
const FALLBACK_CATEGORY = '📦 Weitere';

function accessBadge(cmd) {
  const a = cmd.access;
  if (!a || a === 'everyone') return '';
  if (typeof a === 'string') {
    if (a === 'mod') return ' `🛡️ Mod`';
    if (a === 'admin') return ' `🔧 Admin`';
    return ' `👑 Owner`';
  }
  const restricted = Object.values(a.sub || {}).some((v) => v && v !== 'everyone');
  return restricted ? ' `teils 🔧 Admin`' : '';
}

function describeCommand(cmd) {
  const json = cmd.data.toJSON();
  const subs = (json.options || []).filter((o) => o.type === 1 || o.type === 2).map((o) => o.name);
  const subText = subs.length ? ` _(${subs.join(' · ')})_` : '';
  return `\`/${json.name}\`${subText} — ${truncate(json.description || '', 70)}${accessBadge(cmd)}`;
}

function buildHelpCommand(getAllCommands) {
  return {
    data: new SlashCommandBuilder().setName('help').setDescription('Zeigt alle verfügbaren Befehle'),
    async execute(interaction) {
      const all = getAllCommands();

      const groups = new Map(CATEGORY_ORDER.map(([key, label]) => [key, { label, lines: [] }]));
      groups.set('__other', { label: FALLBACK_CATEGORY, lines: [] });

      for (const cmd of all) {
        const group = groups.get(cmd.category) || groups.get('__other');
        group.lines.push(describeCommand(cmd));
      }

      // Felder bauen (max. 1024 Zeichen pro Feld) und auf Embeds verteilen
      // (Discord: max. 6000 Zeichen pro Nachricht über alle Embeds hinweg -
      // deshalb wird bei Bedarf auf mehrere Nachrichten aufgeteilt).
      const fields = [];
      for (const { label, lines } of groups.values()) {
        if (lines.length === 0) continue;
        splitLines(lines, 1000).forEach((block, i) => {
          fields.push({ name: i === 0 ? `${label} (${lines.length})` : `${label} (Forts.)`, value: block });
        });
      }

      const total = all.length;
      const embeds = [];
      let current = null;
      let size = 0;
      for (const f of fields) {
        const fieldSize = f.name.length + f.value.length;
        if (!current || size + fieldSize > 5000 || current.data.fields?.length >= 25) {
          current = new EmbedBuilder().setColor(0x5865f2);
          embeds.push(current);
          size = 0;
        }
        current.addFields(f);
        size += fieldSize;
      }
      embeds[0].setTitle(`📖 Befehlsübersicht (${total} Befehle)`);
      embeds[embeds.length - 1].setFooter({
        text: 'Außerdem: !support <Anliegen> und !support config (Text-Befehl, kein Slash-Command)',
      });

      await interaction.reply({ embeds: [embeds[0]], flags: EPHEMERAL });
      for (const extra of embeds.slice(1)) {
        await interaction.followUp({ embeds: [extra], flags: EPHEMERAL });
      }
    },
  };
}

module.exports = {
  antimdm,
  web,
  uptime,
  status,
  changelog: changelogCmd,
  links: linksCmd,
  reload: reloadCmd,
  botinfo,
  buildHelpCommand,
};
