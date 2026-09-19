// commands-dev.js
// Nützliche Werkzeuge für Entwickler - laufen komplett lokal, keine
// externen Aufrufe.

const crypto = require('crypto');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const base64 = {
  data: new SlashCommandBuilder()
    .setName('base64')
    .setDescription('Kodiert oder dekodiert Text als Base64')
    .addSubcommand((sub) =>
      sub.setName('encode').setDescription('Text -> Base64').addStringOption((opt) => opt.setName('text').setDescription('Der Text').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('decode').setDescription('Base64 -> Text').addStringOption((opt) => opt.setName('text').setDescription('Der Base64-String').setRequired(true))
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const text = interaction.options.getString('text');
    try {
      const result =
        sub === 'encode' ? Buffer.from(text, 'utf8').toString('base64') : Buffer.from(text, 'base64').toString('utf8');
      await interaction.reply({ content: `\`\`\`\n${result}\n\`\`\``, ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: `❌ Fehler: ${err.message}`, ephemeral: true });
    }
  },
};

const hash = {
  data: new SlashCommandBuilder()
    .setName('hash')
    .setDescription('Erzeugt einen Hash von Text')
    .addStringOption((opt) =>
      opt.setName('algorithmus').setDescription('md5, sha1 oder sha256').setRequired(true).addChoices(
        { name: 'md5', value: 'md5' },
        { name: 'sha1', value: 'sha1' },
        { name: 'sha256', value: 'sha256' }
      )
    )
    .addStringOption((opt) => opt.setName('text').setDescription('Der Text').setRequired(true)),
  async execute(interaction) {
    const algo = interaction.options.getString('algorithmus');
    const text = interaction.options.getString('text');
    const result = crypto.createHash(algo).update(text, 'utf8').digest('hex');
    await interaction.reply({ content: `\`${algo}\`: \`\`\`\n${result}\n\`\`\``, ephemeral: true });
  },
};

const json = {
  data: new SlashCommandBuilder()
    .setName('json')
    .setDescription('Formatiert JSON lesbar (pretty-print)')
    .addStringOption((opt) => opt.setName('text').setDescription('Der JSON-Text').setRequired(true)),
  async execute(interaction) {
    const text = interaction.options.getString('text');
    try {
      const parsed = JSON.parse(text);
      const pretty = JSON.stringify(parsed, null, 2);
      const truncated = pretty.length > 1900 ? pretty.slice(0, 1900) + '\n... (gekürzt)' : pretty;
      await interaction.reply({ content: `\`\`\`json\n${truncated}\n\`\`\``, ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: `❌ Ungültiges JSON: ${err.message}`, ephemeral: true });
    }
  },
};

const timestamp = {
  data: new SlashCommandBuilder()
    .setName('timestamp')
    .setDescription('Wandelt einen Unix-Timestamp in ein Discord-Zeitformat um')
    .addIntegerOption((opt) => opt.setName('unix').setDescription('Unix-Timestamp in Sekunden').setRequired(true)),
  async execute(interaction) {
    const unix = interaction.options.getInteger('unix');
    const embed = new EmbedBuilder()
      .setTitle('🕐 Zeitstempel-Umwandlung')
      .addFields(
        { name: 'Kurz', value: `<t:${unix}:t>` },
        { name: 'Lang', value: `<t:${unix}:F>` },
        { name: 'Relativ', value: `<t:${unix}:R>` },
        { name: 'ISO', value: new Date(unix * 1000).toISOString() }
      )
      .setColor(0x5865f2);
    await interaction.reply({ embeds: [embed] });
  },
};

const uuid = {
  data: new SlashCommandBuilder().setName('uuid').setDescription('Generiert eine zufällige UUID (v4)'),
  async execute(interaction) {
    await interaction.reply({ content: `\`${crypto.randomUUID()}\``, ephemeral: true });
  },
};

const snowflake = {
  data: new SlashCommandBuilder()
    .setName('snowflake')
    .setDescription('Zerlegt eine Discord-Snowflake-ID in ihre Bestandteile')
    .addStringOption((opt) => opt.setName('id').setDescription('Die Snowflake-ID (z.B. eine User- oder Nachrichten-ID)').setRequired(true)),
  async execute(interaction) {
    const idStr = interaction.options.getString('id').trim();
    if (!/^\d{17,20}$/.test(idStr)) {
      await interaction.reply({ content: '❌ Das sieht nicht wie eine gültige Discord-Snowflake-ID aus.', ephemeral: true });
      return;
    }
    const DISCORD_EPOCH = 1420070400000n;
    const id = BigInt(idStr);
    const timestampMs = (id >> 22n) + DISCORD_EPOCH;
    const workerId = (id & 0x3e0000n) >> 17n;
    const processId = (id & 0x1f000n) >> 12n;
    const increment = id & 0xfffn;

    const embed = new EmbedBuilder()
      .setTitle('❄️ Snowflake zerlegt')
      .addFields(
        { name: 'Erstellt am', value: `<t:${Math.floor(Number(timestampMs) / 1000)}:F>` },
        { name: 'Timestamp (ms)', value: String(timestampMs), inline: true },
        { name: 'Worker-ID', value: String(workerId), inline: true },
        { name: 'Process-ID', value: String(processId), inline: true },
        { name: 'Increment', value: String(increment), inline: true }
      )
      .setColor(0x5865f2);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

const regexTest = {
  data: new SlashCommandBuilder()
    .setName('regex-test')
    .setDescription('Testet, ob ein regulärer Ausdruck auf einen Text passt')
    .addStringOption((opt) => opt.setName('pattern').setDescription('Der Regex (ohne Slashes)').setRequired(true))
    .addStringOption((opt) => opt.setName('text').setDescription('Der zu testende Text').setRequired(true))
    .addStringOption((opt) => opt.setName('flags').setDescription('Regex-Flags, z.B. "gi"').setRequired(false)),
  async execute(interaction) {
    const pattern = interaction.options.getString('pattern');
    const text = interaction.options.getString('text');
    const flags = interaction.options.getString('flags') || '';

    try {
      const regex = new RegExp(pattern, flags);
      const matches = text.match(new RegExp(pattern, flags.includes('g') ? flags : flags + 'g'));
      const embed = new EmbedBuilder()
        .setTitle('🔍 Regex-Test')
        .addFields(
          { name: 'Pattern', value: `\`/${pattern}/${flags}\`` },
          { name: 'Treffer?', value: regex.test(text) ? '✅ Ja' : '❌ Nein' },
          { name: 'Gefundene Matches', value: matches && matches.length > 0 ? matches.slice(0, 10).join(', ') : 'Keine' }
        )
        .setColor(0x5865f2);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: `❌ Ungültiger regulärer Ausdruck: ${err.message}`, ephemeral: true });
    }
  },
};

module.exports = { base64, hash, json, timestamp, uuid, snowflake, regexTest };
