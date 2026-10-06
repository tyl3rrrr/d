// commands-ai.js
// /ask - ask the AI a question directly as a slash command (everyone; same engine as @mentions
// and DMs, see ai.js / ai-runtime.js). /ask reset forgets your conversation with the bot.

const { SlashCommandBuilder } = require('discord.js');
const ai = require('./ai');
const permissions = require('./permissions');
const botlog = require('./botlog');
const { EPHEMERAL, chunkText } = require('./util');

const ask = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Asks the AI a question')
    .addSubcommand((s) => s.setName('question').setDescription('Asks the AI a question').addStringOption((o) => o.setName('text').setDescription('Your question').setMaxLength(1500).setRequired(true)))
    .addSubcommand((s) => s.setName('reset').setDescription('Forgets the conversation the bot has with you')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'reset') {
      await interaction.deferReply({ flags: EPHEMERAL });
      const n = ai.resetHistory(interaction.user.id);
      await interaction.editReply(n ? '🧹 Done - I forgot our conversation.' : "There wasn't anything to forget.");
      return;
    }

    if (!ai.isConfigured()) {
      await interaction.reply({ content: '❌ The AI is not set up yet (the bot owner has to add `GEMINI_KEY` to the .env file).', flags: EPHEMERAL });
      return;
    }

    await interaction.deferReply();
    const question = interaction.options.getString('text').trim();
    const res = await ai.ask({
      scope: interaction.guildId ? `ch${interaction.channelId}` : 'dm',
      userId: interaction.user.id,
      userName: interaction.user.globalName || interaction.user.username,
      text: question,
      place: interaction.guildId ? 'guild' : 'dm',
      botName: interaction.client.user && interaction.client.user.username,
      isOwner: permissions.isBotOwner(interaction.user.id),
    });

    botlog.log({
      type: 'ai',
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      guildId: interaction.guildId,
      guildName: interaction.guild ? interaction.guild.name : null,
      channelId: interaction.channelId,
      text: `Q: ${question}\nA: ${res.ok ? res.text : `(no answer: ${res.reason})`}`,
    });

    if (!res.ok) return void (await interaction.editReply(`⚠️ ${res.reason}`));
    const chunks = chunkText(res.text, 1900);
    await interaction.editReply(chunks[0]);
    for (let i = 1; i < chunks.length; i++) await interaction.followUp(chunks[i]);
  },
};

module.exports = { ask };
