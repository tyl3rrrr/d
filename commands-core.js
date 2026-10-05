// commands-core.js
const os = require('os');
const { SlashCommandBuilder, EmbedBuilder, version: djsVersion } = require('discord.js');

const config = require('./config');
const pkg = require('./package.json');
const { EPHEMERAL } = require('./util');

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
        { name: 'Process', value: `PID ${process.pid} @ ${os.hostname()}`.slice(0, 1000), inline: true },
        { name: 'Uptime', value: formatUptime(uptimeMs), inline: true }
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
};

module.exports = {
  uptime,
  status,
  reload: reloadCmd,
  botinfo,
};
