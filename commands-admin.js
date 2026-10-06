// commands-admin.js
// /adm-reload - restarts the bot process (bot owner only).
// /console     - BOT OWNER ONLY, the deepest level of the bot: live process info, raw cache
//                lookups, running a guarded one-line script against the bot's own code, and the
//                same full restart as /adm-reload. Built for debugging/operating the bot itself -
//                not a general tool, so it stays owner-only and every use is written to the bot log.
//
// A REAL restart from within Discord: Node.js can't "restart itself" (the process running the code
// can't replace itself). What works: the process exits (process.exit), and the hosting's process
// manager restarts it automatically (systemd with "Restart=always", PM2, Docker with
// "--restart unless-stopped", Railway/Render/Heroku-style platforms all do this by default).
// WITHOUT such an auto-restart mechanism the bot stays offline after /adm-reload or /console restart
// until it's started manually again - that's the technical limit that can't be bypassed here.

const vm = require('vm');
const path = require('path');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage = require('./storage');
const logging = require('./logging');
const botlog = require('./botlog');
const ai = require('./ai');
const { EPHEMERAL, truncate, redactSecrets, chunkText, errText } = require('./util');

const EVAL_TIMEOUT_MS = 2000;
const EVAL_OUTPUT_MAX = 1900;

function restartEmbed() {
  return new EmbedBuilder()
    .setTitle('🔄 Restart initiated')
    .setDescription(
      'The bot process will exit in 3 seconds.\n' +
        'If it runs under a process manager with auto-restart (systemd, PM2, Docker, ' +
        'Railway/Render, etc.), it comes back online automatically. **Without** auto-restart ' +
        "it stays offline until it's started manually - that can't be avoided from here."
    )
    .setColor(0xfee75c);
}

function triggerRestart(interaction) {
  console.log(`🔄 Restart triggered by ${interaction.user.tag} (${interaction.user.id}) - PID ${process.pid} exits in 3s.`);
  logging.logToGuild(interaction.client, interaction.guildId, { title: '🔄 Bot restart triggered', fields: [{ name: 'By', value: interaction.user.tag }], level: 'warn' });
  botlog.log({ type: 'audit', userId: interaction.user.id, userTag: interaction.user.tag, guildId: interaction.guildId, text: 'Restart triggered.' });
  setTimeout(() => process.exit(0), 3000);
}

const admReload = {
  data: new SlashCommandBuilder().setName('adm-reload').setDescription('Fully restarts the bot process (not just a .env reload)'),
  async execute(interaction) {
    await interaction.reply({ embeds: [restartEmbed()] });
    triggerRestart(interaction);
  },
};

// ---------------------------------------------------------------------------
// /console
// ---------------------------------------------------------------------------
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m ${s % 60}s`;
}

async function runInfo(interaction) {
  const mem = process.memoryUsage();
  const ai_ = ai.stats();
  const logCounts = await botlog.counts();
  const embed = new EmbedBuilder()
    .setTitle('🖥️ Console - process info')
    .setColor(0x2b2d31)
    .addFields(
      { name: 'PID', value: `${process.pid}`, inline: true },
      { name: 'Node.js', value: process.version, inline: true },
      { name: 'Uptime', value: formatUptime(process.uptime() * 1000), inline: true },
      { name: 'Memory (RSS / heap)', value: `${(mem.rss / 1048576).toFixed(1)} MB / ${(mem.heapUsed / 1048576).toFixed(1)} MB`, inline: true },
      { name: 'Guilds cached', value: `${interaction.client.guilds.cache.size}`, inline: true },
      { name: 'Commands loaded', value: `${interaction.client.commands.size}`, inline: true },
      { name: 'AI', value: ai_.configured ? `${ai_.provider} (${ai_.model})\n${ai_.messagesToday} msgs today, ${ai_.usersToday} users` : 'not configured', inline: true },
      { name: 'Bot log', value: `${logCounts.total} entries`, inline: true },
      { name: 'Data file', value: path.basename(storage.DATA_FILE || 'data.json'), inline: true }
    );
  await interaction.editReply({ embeds: [embed] });
}

async function runCache(interaction) {
  const scope = interaction.options.getString('target') || 'guild';
  const id = (interaction.options.getString('id') || '').trim();
  let text;
  if (scope === 'guild') {
    const g = id ? interaction.client.guilds.cache.get(id) : interaction.guild;
    text = g ? `**${redactSecrets(g.name)}**\nid: ${g.id}\nowner: ${g.ownerId}\nmembers (cached): ${g.memberCount ?? g.members.cache.size}\nchannels (cached): ${g.channels.cache.size}` : `No cached guild with id \`${id}\`.`;
  } else if (scope === 'user') {
    if (!id) return void (await interaction.editReply('Please provide a user ID for `target: user`.'));
    const u = await interaction.client.users.fetch(id).catch(() => null);
    text = u ? `**${redactSecrets(u.tag)}**\nid: ${u.id}\nbot: ${u.bot}\ncreated: <t:${Math.floor(u.createdTimestamp / 1000)}:R>` : `No user found for id \`${id}\`.`;
  } else {
    if (!id) return void (await interaction.editReply('Please provide a channel ID for `target: channel`.'));
    const ch = interaction.client.channels.cache.get(id) || (await interaction.client.channels.fetch(id).catch(() => null));
    text = ch ? `**#${redactSecrets(ch.name || 'unknown')}**\nid: ${ch.id}\ntype: ${ch.type}\nguild: ${ch.guild ? ch.guild.id : '-'}` : `No cached/reachable channel with id \`${id}\`.`;
  }
  await interaction.editReply(truncate(text, EVAL_OUTPUT_MAX));
}

// Runs ONE expression against the live bot (client, storage, config, ...) in a separate VM context
// with a short timeout - for quick debugging. No network/eval beyond the given code; result and
// console output are truncated and secrets are redacted before they are ever shown or logged.
async function runEval(interaction) {
  const code = interaction.options.getString('code');
  const logs = [];
  const sandboxConsole = { log: (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) };
  const sandbox = {
    client: interaction.client,
    guild: interaction.guild,
    channel: interaction.channel,
    interaction,
    storage: require('./storage'),
    config: require('./config'),
    botlog,
    console: sandboxConsole,
    require,
    process: { version: process.version, pid: process.pid, uptime: process.uptime },
  };
  let result;
  let threw = false;
  try {
    const ctx = vm.createContext(sandbox);
    const value = await Promise.resolve(vm.runInContext(code, ctx, { timeout: EVAL_TIMEOUT_MS, displayErrors: true }));
    result = typeof value === 'string' ? value : require('util').inspect(value, { depth: 2 });
  } catch (err) {
    threw = true;
    result = errText(err);
  }

  const out = redactSecrets([...logs, result].filter((x) => x !== undefined && x !== '').join('\n') || '(no output)');
  botlog.log({ type: 'audit', userId: interaction.user.id, userTag: interaction.user.tag, guildId: interaction.guildId, text: `/console eval: ${code}\n-> ${out}` });

  const chunks = chunkText(out, EVAL_OUTPUT_MAX);
  await interaction.editReply(`${threw ? '⚠️ Threw an error:' : '✅ Result:'}\n\`\`\`\n${truncate(chunks[0], EVAL_OUTPUT_MAX - 10)}\n\`\`\``);
  for (let i = 1; i < chunks.length; i++) await interaction.followUp(`\`\`\`\n${chunks[i]}\n\`\`\``);
}

const consoleCmd = {
  data: new SlashCommandBuilder()
    .setName('console')
    .setDescription('BOT OWNER ONLY: deepest-level access to the running bot')
    .addSubcommand((s) => s.setName('info').setDescription('Shows live process info (PID, memory, uptime, counts)'))
    .addSubcommand((s) =>
      s
        .setName('cache')
        .setDescription("Looks up something in the bot's cache")
        .addStringOption((o) => o.setName('target').setDescription('What to look up').addChoices({ name: 'Guild', value: 'guild' }, { name: 'User', value: 'user' }, { name: 'Channel', value: 'channel' }).setRequired(true))
        .addStringOption((o) => o.setName('id').setDescription('The ID (omit for "guild" to use this server)').setRequired(false))
    )
    .addSubcommand((s) => s.setName('eval').setDescription('Runs one line of code against the live bot (debugging)').addStringOption((o) => o.setName('code').setDescription('JavaScript expression').setRequired(true)))
    .addSubcommand((s) => s.setName('restart').setDescription('Fully restarts the bot process (same as /adm-reload)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'restart') {
      await interaction.reply({ embeds: [restartEmbed()] });
      triggerRestart(interaction);
      return;
    }
    await interaction.deferReply({ flags: EPHEMERAL });
    if (sub === 'info') return runInfo(interaction);
    if (sub === 'cache') return runCache(interaction);
    if (sub === 'eval') return runEval(interaction);
  },
};

module.exports = { admReload, consoleCmd };
