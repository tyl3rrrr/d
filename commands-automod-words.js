// commands-automod-words.js
// Verwaltet die Wortliste des Wortfilters - über die Discord-AutoMod-API.
// Die Wörter stehen in der AutoMod-Regel "tylxrrrr | Wortfilter" (sichtbar unter
// Servereinstellungen -> AutoMod). Es gibt keinen lokalen Filter mehr.
// Zugriff (Administratoren) wird zentral in permissions.js geprüft.

const { SlashCommandBuilder } = require('discord.js');
const automod = require('./automod-api');
const { EPHEMERAL, truncate } = require('./util');

const automodWords = {
  data: new SlashCommandBuilder()
    .setName('automod-words')
    .setDescription('Verwaltet die Wortliste des AutoMod-Wortfilters (Discord-AutoMod)')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Fügt ein Wort zur Blockliste hinzu')
        .addStringOption((opt) =>
          opt.setName('wort').setDescription('Das zu blockierende Wort (Platzhalter: *wort*)').setRequired(true).setMaxLength(60)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Entfernt ein Wort von der Blockliste')
        .addStringOption((opt) => opt.setName('wort').setDescription('Das zu entfernende Wort').setRequired(true).setMaxLength(60))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Zeigt die aktuelle Blockliste')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const client = interaction.client;
    const guildId = interaction.guildId;

    await interaction.deferReply({ flags: EPHEMERAL });

    let rule;
    try {
      rule = await automod.ensureWordRule(client, guildId);
    } catch (err) {
      await interaction.editReply(`❌ AutoMod-Regel konnte nicht geladen/erstellt werden: ${automod.explainError(err)}`);
      return;
    }
    const words = automod.getWordsFromRule(rule);

    if (sub === 'list') {
      const text = words.length > 0 ? words.join(', ') : '';
      await interaction.editReply(
        words.length > 0
          ? `🚫 Blockierte Wörter (${words.length}):\n${truncate(text, 1800)}`
          : 'Die Blockliste ist leer.'
      );
      return;
    }

    const input = automod.normalizeWord(interaction.options.getString('wort'));
    if (!input.ok) {
      await interaction.editReply(`❌ ${input.error}`);
      return;
    }
    const word = input.word;

    try {
      if (sub === 'add') {
        if (words.some((w) => w.toLowerCase() === word.toLowerCase())) {
          await interaction.editReply(`"${word}" ist bereits in der Liste.`);
          return;
        }
        await automod.setWords(client, guildId, rule, [...words, word]);
        await interaction.editReply(`✅ "${word}" wurde zur Blockliste hinzugefügt (Discord-AutoMod-Regel aktualisiert).`);
        return;
      }

      if (sub === 'remove') {
        const updated = words.filter((w) => w.toLowerCase() !== word.toLowerCase());
        if (updated.length === words.length) {
          await interaction.editReply(`"${word}" war nicht in der Liste.`);
          return;
        }
        await automod.setWords(client, guildId, rule, updated);
        await interaction.editReply(`✅ "${word}" wurde von der Blockliste entfernt (Discord-AutoMod-Regel aktualisiert).`);
      }
    } catch (err) {
      console.error('Fehler bei /automod-words:', err);
      await interaction.editReply(`❌ Discord hat die Änderung abgelehnt: ${automod.explainError(err)}`);
    }
  },
};

module.exports = { automodWords };
