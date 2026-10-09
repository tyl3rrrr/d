// commands-ai.js
// /ask - ask the AI a question directly as a slash command (everyone; same engine as @mentions
// and DMs, see ai.js / ai-runtime.js). /ask reset forgets your conversation with the bot.

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
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


const CODE_LANGUAGES = {
  html: 'html',
  css: 'css',
  javascript: 'js',
  js: 'js',
  typescript: 'ts',
  ts: 'ts',
  python: 'py',
  py: 'py',
  json: 'json',
  markdown: 'md',
  md: 'md',
  sql: 'sql',
  yaml: 'yml',
  yml: 'yml',
  xml: 'xml',
  svg: 'svg',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  'c#': 'cs',
  'c++': 'cpp',
  'shell script': 'sh',
  php: 'php',
  ruby: 'rb',
  go: 'go',
  rust: 'rs',
  shell: 'sh',
  bash: 'sh',
};

const code = {
  data: new SlashCommandBuilder()
    .setName('code')
    .setDescription('Creates a source-code file with AI and sends it to you by DM')
    .addStringOption((o) => o.setName('language').setDescription('File type, e.g. html, javascript, python or css').setMaxLength(30).setRequired(true))
    .addStringOption((o) => o.setName('info').setDescription('Describe what the file should do').setMaxLength(1500).setRequired(true)),

  async execute(interaction) {
    const requestedLanguage = interaction.options.getString('language').trim().toLowerCase();
    const extension = CODE_LANGUAGES[requestedLanguage];
    if (!extension) {
      await interaction.reply({
        content: `❌ I don't support that file type yet. Supported types: ${'html, css, javascript, typescript, python, json, markdown, sql, yaml, xml, svg, java, c, cpp, csharp, php, ruby, go, rust, shell'}.`,
        flags: EPHEMERAL,
      });
      return;
    }

    if (!ai.isConfigured()) {
      await interaction.reply({ content: '❌ The AI is not set up yet. The bot owner needs to configure `GEMINI_KEY` in the `.env` file.', flags: EPHEMERAL });
      return;
    }

    await interaction.deferReply({ flags: EPHEMERAL });
    const info = interaction.options.getString('info').trim();
    const result = await ai.generateCode({
      userId: interaction.user.id,
      userName: interaction.user.globalName || interaction.user.username,
      language: requestedLanguage,
      info,
      isOwner: permissions.isBotOwner(interaction.user.id),
    });

    botlog.log({
      type: 'ai-code',
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      guildId: interaction.guildId,
      guildName: interaction.guild ? interaction.guild.name : null,
      channelId: interaction.channelId,
      text: `Generated file request: language=${requestedLanguage}; description length=${info.length}`,
    });

    if (!result.ok) {
      await interaction.editReply(`⚠️ ${result.reason}`);
      return;
    }

    // Remove accidental Markdown fences if the model ignored the system instruction.
    let source = String(result.text || '').trim();
    source = source.replace(/^```[\w.+#-]*\s*\n/, '').replace(/\n```\s*$/, '').trim();
    if (!source) {
      await interaction.editReply('⚠️ The AI returned an empty file. Please try a more specific description.');
      return;
    }

    // Keep the attachment below Discord's common upload limit and avoid huge accidental outputs.
    const fileBuffer = Buffer.from(source, 'utf8');
    if (fileBuffer.length > 7 * 1024 * 1024) {
      await interaction.editReply('⚠️ The generated file is too large to send safely. Please request a smaller or simpler file.');
      return;
    }

    const attachment = new AttachmentBuilder(fileBuffer, { name: `generated.${extension}` });
    try {
      await interaction.user.send({
        content: `Here is your generated **${requestedLanguage}** file. It has not been executed by the bot.`,
        files: [attachment],
      });
      await interaction.editReply('✅ Your file was generated and sent to you by DM.');
    } catch (err) {
      if (err && (err.code === 50007 || err.code === '50007')) {
        await interaction.editReply('❌ I generated the file, but could not DM you. Please enable direct messages from this server and try again.');
        return;
      }
      throw err;
    }
  },
};

module.exports = { ask, code };
