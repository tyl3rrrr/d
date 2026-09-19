// commands-automod-words.js
// Verwaltet die lokale Wortfilter-Liste (siehe automod-filter.js).

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getBannedWords, setBannedWords } = require('./automod-filter');

const automodWords = {
  data: new SlashCommandBuilder()
    .setName('automod-words')
    .setDescription('Verwaltet die Liste lokal blockierter Wörter')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Fügt ein Wort zur Blockliste hinzu')
        .addStringOption((opt) => opt.setName('wort').setDescription('Das zu blockierende Wort').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Entfernt ein Wort von der Blockliste')
        .addStringOption((opt) => opt.setName('wort').setDescription('Das zu entfernende Wort').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Zeigt die aktuelle Blockliste')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'list') {
      const words = getBannedWords(guildId);
      await interaction.reply({
        content: words.length > 0 ? `🚫 Blockierte Wörter (${words.length}):\n${words.join(', ')}` : 'Die Blockliste ist leer.',
        ephemeral: true,
      });
      return;
    }

    const word = interaction.options.getString('wort').trim();

    if (sub === 'add') {
      const words = getBannedWords(guildId);
      if (words.some((w) => w.toLowerCase() === word.toLowerCase())) {
        await interaction.reply({ content: `"${word}" ist bereits in der Liste.`, ephemeral: true });
        return;
      }
      setBannedWords(guildId, [...words, word]);
      await interaction.reply({ content: `✅ "${word}" wurde zur Blockliste hinzugefügt.`, ephemeral: true });
      return;
    }

    if (sub === 'remove') {
      const words = getBannedWords(guildId);
      const updated = words.filter((w) => w.toLowerCase() !== word.toLowerCase());
      if (updated.length === words.length) {
        await interaction.reply({ content: `"${word}" war nicht in der Liste.`, ephemeral: true });
        return;
      }
      setBannedWords(guildId, updated);
      await interaction.reply({ content: `✅ "${word}" wurde von der Blockliste entfernt.`, ephemeral: true });
      return;
    }
  },
};

module.exports = { automodWords };
