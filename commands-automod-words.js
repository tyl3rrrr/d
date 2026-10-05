// commands-automod-words.js
// Manages the word filter's word list via the Discord AutoMod API. Words live
// in the AutoMod rule "tylxrrrr | Word Filter" (visible under Server Settings
// -> AutoMod). There is no local filter anymore.
// Access (administrators) is checked centrally in permissions.js.

const { SlashCommandBuilder } = require('discord.js');
const automod = require('./automod-api');
const { EPHEMERAL, truncate } = require('./util');

const automodWords = {
  data: new SlashCommandBuilder()
    .setName('automod-words')
    .setDescription("Manages the AutoMod word filter's block list (Discord AutoMod)")
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Adds a word to the block list')
        .addStringOption((opt) => opt.setName('word').setDescription('The word to block').setRequired(true).setMaxLength(60))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Removes a word from the block list')
        .addStringOption((opt) => opt.setName('word').setDescription('The word to remove').setRequired(true).setMaxLength(60))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Shows the current block list')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const client = interaction.client;
    const guildId = interaction.guildId;

    await interaction.deferReply({ flags: EPHEMERAL });

    let rule;
    try {
      rule = await automod.ensureWordRule(client, guildId);
    } catch (err) {
      await interaction.editReply(`❌ Could not load/create the AutoMod rule: ${automod.explainError(err)}`);
      return;
    }
    const words = automod.getWordsFromRule(rule);

    if (sub === 'list') {
      const text = words.length > 0 ? words.join(', ') : '';
      await interaction.editReply(words.length > 0 ? `🚫 Blocked words (${words.length}):\n${truncate(text, 1800)}` : 'The block list is empty.');
      return;
    }

    const input = automod.normalizeWord(interaction.options.getString('word'));
    if (!input.ok) {
      await interaction.editReply(`❌ ${input.error}`);
      return;
    }
    const word = input.word;

    try {
      if (sub === 'add') {
        if (words.some((w) => w.toLowerCase() === word.toLowerCase())) {
          await interaction.editReply(`"${word}" is already on the list.`);
          return;
        }
        await automod.setWords(client, guildId, rule, [...words, word]);
        await interaction.editReply(`✅ "${word}" was added to the block list (Discord AutoMod rule updated).`);
        return;
      }

      if (sub === 'remove') {
        const updated = words.filter((w) => w.toLowerCase() !== word.toLowerCase());
        if (updated.length === words.length) {
          await interaction.editReply(`"${word}" was not on the list.`);
          return;
        }
        await automod.setWords(client, guildId, rule, updated);
        await interaction.editReply(`✅ "${word}" was removed from the block list (Discord AutoMod rule updated).`);
      }
    } catch (err) {
      console.error('Error in /automod-words:', err);
      await interaction.editReply(`❌ Discord rejected the change: ${automod.explainError(err)}`);
    }
  },
};

module.exports = { automodWords };
