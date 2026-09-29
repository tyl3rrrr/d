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
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
  return parts.join(', ');
}

const antimdm = {
  data: new SlashCommandBuilder().setName('antimdm').setDescription('Sends the AntiMDM link'),
  async execute(interaction) {
    await interaction.reply(config.links.antimdm);
  },
};

const web = {
  data: new SlashCommandBuilder().setName('web').setDescription('Shows the link to the website'),
  async execute(interaction) {
    await interaction.reply(`Link: ${config.links.website}`);
  },
};

const uptime = {
  data: new SlashCommandBuilder().setName('uptime').setDescription('Shows how long the bot has been running'),
  async execute(interaction) {
    // Process uptime: starts at 0 again on every bot restart AND after the
    // host is powered off/on (see config.js).
    await interaction.reply(`⏱️ Uptime: ${formatUptime(config.getUptimeMs())}`);
  },
};

const status = {
  data: new SlashCommandBuilder().setName('status').setDescription('Checks whether the website is reachable'),
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
        .setTitle('🌐 Website Status')
        .setColor(res.ok ? 0x57f287 : 0xfee75c)
        .addFields(
          { name: 'URL', value: url },
          { name: 'Reachability', value: res.ok ? '🟢 Reachable' : `🟡 HTTP status ${res.status}` },
          { name: 'HTTP code', value: String(res.status), inline: true },
          { name: 'Response time', value: `${ms} ms`, inline: true }
        )
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      const timedOut = err.name === 'AbortError';
      const embed = new EmbedBuilder()
        .setTitle('🌐 Website Status')
        .setColor(0xed4245)
        .addFields(
          { name: 'URL', value: url },
          { name: 'Reachability', value: '🔴 Unreachable' },
          { name: 'Error', value: timedOut ? `Timed out (> ${TIMEOUT_MS / 1000}s)` : err.message }
        )
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } finally {
      clearTimeout(timeoutHandle);
    }
  },
};

const changelogCmd = {
  data: new SlashCommandBuilder().setName('changelog').setDescription("Shows the project's latest updates"),
  async execute(interaction) {
    const entries = config.changelog;
    if (!entries || entries.length === 0) {
      await interaction.reply({ content: 'There are no changelog entries yet.', flags: EPHEMERAL });
      return;
    }
    const latest = entries.slice(-5).reverse();
    const embed = new EmbedBuilder()
      .setTitle('📋 Changelog')
      .setColor(0x5865f2)
      .setDescription(latest.map((e) => `**${e.date || '?'}** — ${e.text || '(no text)'}`).join('\n\n'))
      .setFooter({ text: `Latest ${latest.length} of ${entries.length} entries` });
    await interaction.reply({ embeds: [embed] });
  },
};

const linksCmd = {
  data: new SlashCommandBuilder().setName('links').setDescription('Shows important project links'),
  async execute(interaction) {
    const l = config.links || {};
    const fields = [];
    if (l.website) fields.push({ name: '🌐 Website', value: l.website });
    if (l.discordInvite) fields.push({ name: '💬 Discord server', value: l.discordInvite });
    if (l.github) fields.push({ name: '🐙 GitHub', value: l.github });
    if (l.antimdm) fields.push({ name: '🛡️ AntiMDM', value: l.antimdm });

    if (fields.length === 0) {
      await interaction.reply({ content: 'No links have been configured yet.', flags: EPHEMERAL });
      return;
    }
    const embed = new EmbedBuilder().setTitle('🔗 Important Links').setColor(0x5865f2).addFields(fields);
    await interaction.reply({ embeds: [embed] });
  },
};

const reloadCmd = {
  // Access (bot operator only) is checked centrally in permissions.js (access: 'bot-owner').
  data: new SlashCommandBuilder().setName('reload').setDescription('Reloads the .env without restarting the bot'),
  async execute(interaction) {
    try {
      config.reloadAll();
      await interaction.reply({ content: '✅ Configuration reloaded (.env).', flags: EPHEMERAL });
    } catch (err) {
      console.error('Error reloading the configuration:', err);
      await interaction.reply({ content: '❌ Error reloading the configuration.', flags: EPHEMERAL });
    }
  },
};

const botinfo = {
  data: new SlashCommandBuilder().setName('botinfo').setDescription('Shows technical information about the bot'),
  async execute(interaction) {
    const client = interaction.client;
    const mem = process.memoryUsage();
    const uptimeMs = config.getUptimeMs();
    const embed = new EmbedBuilder()
      .setTitle('🤖 Bot Info')
      .setColor(0x5865f2)
      .addFields(
        { name: 'Bot version', value: pkg.version || 'unknown', inline: true },
        { name: 'discord.js', value: djsVersion, inline: true },
        { name: 'Node.js', value: process.version, inline: true },
        { name: 'Server', value: String(client.guilds.cache.size), inline: true },
        { name: 'RAM usage', value: `${(mem.rss / 1024 / 1024).toFixed(1)} MB`, inline: true },
        { name: 'Platform', value: `${os.platform()} (${os.arch()})`, inline: true },
        { name: 'Uptime', value: formatUptime(uptimeMs), inline: true }
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
};

// ---------------------------------------------------------------------------
// /help - generated AUTOMATICALLY from the actually registered command list.
// There is no manual command list anymore that could be forgotten when adding
// commands: every command carries its category (see the registry in
// commands.js). Commands without a known category land under "Other" - so no
// command ever drops out of the overview.
// ---------------------------------------------------------------------------
const CATEGORY_ORDER = [
  ['general', '📌 General'],
  ['moderation', '🛡️ Moderation'],
  ['admin', '⚙️ Administration'],
  ['welcome', '👋 Welcome'],
  ['tickets', '🎫 Tickets'],
  ['utility', '🧰 Utility & Fun'],
  ['xp', '⭐ XP'],
  ['bot', '🤖 Bot'],
  ['ai', '🧠 AI'],
];
const FALLBACK_CATEGORY = '📦 Other';

function accessBadge(cmd) {
  const a = cmd.access;
  if (!a || a === 'everyone') return '';
  if (typeof a === 'string') {
    if (a === 'mod') return ' `🛡️ Mod`';
    if (a === 'admin') return ' `🔧 Admin`';
    return ' `👑 Owner`';
  }
  const restricted = Object.values(a.sub || {}).some((v) => v && v !== 'everyone');
  return restricted ? ' `partly 🔧 Admin`' : '';
}

function describeCommand(cmd) {
  const json = cmd.data.toJSON();
  const subs = (json.options || []).filter((o) => o.type === 1 || o.type === 2).map((o) => o.name);
  const subText = subs.length ? ` _(${subs.join(' · ')})_` : '';
  return `\`/${json.name}\`${subText} — ${truncate(json.description || '', 70)}${accessBadge(cmd)}`;
}

function buildHelpCommand(getAllCommands) {
  return {
    data: new SlashCommandBuilder().setName('help').setDescription('Shows all available commands'),
    async execute(interaction) {
      const all = getAllCommands();

      const groups = new Map(CATEGORY_ORDER.map(([key, label]) => [key, { label, lines: [] }]));
      groups.set('__other', { label: FALLBACK_CATEGORY, lines: [] });

      for (const cmd of all) {
        const group = groups.get(cmd.category) || groups.get('__other');
        group.lines.push(describeCommand(cmd));
      }

      // Build fields (max. 1024 characters per field) and distribute them across
      // embeds (Discord: max. 6000 characters per message across all embeds -
      // so it's split across multiple messages when needed).
      const fields = [];
      for (const { label, lines } of groups.values()) {
        if (lines.length === 0) continue;
        splitLines(lines, 1000).forEach((block, i) => {
          fields.push({ name: i === 0 ? `${label} (${lines.length})` : `${label} (cont.)`, value: block });
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
      embeds[0].setTitle(`📖 Command Overview (${total} commands)`);
      embeds[embeds.length - 1].setFooter({
        text: 'Also: !support <request> and !support config (text command, not a slash command)',
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
