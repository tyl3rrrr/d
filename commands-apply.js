// commands-apply.js
// /apply-config - administrators define application types (a role you can
// apply for, e.g. "Developer") and their questions, plus the review channel.
// /apply-panel   - administrators post the panel with a button per type;
// clicking a button starts a DM interview (see apply-runtime.js).
// Access (administrators) is checked centrally in permissions.js.

const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const storage = require('./storage');
const { EPHEMERAL, truncate } = require('./util');
const { buildPanelRow } = require('./apply-runtime');

const MAX_TYPES = 5; // one Discord action row holds at most 5 buttons
const MAX_QUESTIONS = 15;

function slugify(label) {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `type-${Date.now()}`
  );
}

function findType(guildId, name) {
  const types = storage.getApplyTypes(guildId);
  return types.find((t) => t.label.toLowerCase() === name.toLowerCase() || t.id === name.toLowerCase());
}

async function autocompleteType(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const types = storage.getApplyTypes(interaction.guildId);
  const matches = types.filter((t) => t.label.toLowerCase().includes(focused)).slice(0, 25);
  await interaction.respond(matches.map((t) => ({ name: `${t.label} (${t.questions.length} question(s))`, value: t.label })));
}

const applyConfig = {
  data: new SlashCommandBuilder()
    .setName('apply-config')
    .setDescription('Configures application types, their questions, and the review channel')
    .addSubcommand((s) =>
      s
        .setName('add-type')
        .setDescription('Adds a new application type (e.g. "Developer")')
        .addStringOption((o) => o.setName('name').setDescription('Display name, e.g. Developer').setRequired(true).setMaxLength(80))
    )
    .addSubcommand((s) =>
      s
        .setName('remove-type')
        .setDescription('Removes an application type and all its questions')
        .addStringOption((o) => o.setName('type').setDescription('The application type').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((s) =>
      s
        .setName('add-question')
        .setDescription('Adds a question to an application type (asked in order)')
        .addStringOption((o) => o.setName('type').setDescription('The application type').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('question').setDescription('The question text').setRequired(true).setMaxLength(300))
    )
    .addSubcommand((s) =>
      s
        .setName('remove-question')
        .setDescription("Removes one of a type's questions by its number")
        .addStringOption((o) => o.setName('type').setDescription('The application type').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('number').setDescription('Question number (see /apply-config list)').setRequired(true).setMinValue(1))
    )
    .addSubcommand((s) =>
      s
        .setName('set-role')
        .setDescription('Sets (or clears) the role automatically granted when this type is accepted')
        .addStringOption((o) => o.setName('type').setDescription('The application type').setRequired(true).setAutocomplete(true))
        .addRoleOption((o) => o.setName('role').setDescription('The role to grant (omit to clear)').setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName('set-review-channel')
        .setDescription('Sets the channel where submitted applications (with Accept/Deny buttons) are posted')
        .addChannelOption((o) => o.setName('channel').setDescription('The review channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
    )
    .addSubcommand((s) => s.setName('list').setDescription('Shows all configured application types and their questions')),

  async autocomplete(interaction) {
    await autocompleteType(interaction);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'add-type') {
      const name = interaction.options.getString('name').trim();
      const types = storage.getApplyTypes(guildId);
      if (types.length >= MAX_TYPES) {
        await interaction.reply({ content: `❌ At most ${MAX_TYPES} application types are supported (one button row).`, flags: EPHEMERAL });
        return;
      }
      if (types.some((t) => t.label.toLowerCase() === name.toLowerCase())) {
        await interaction.reply({ content: `❌ An application type named "${name}" already exists.`, flags: EPHEMERAL });
        return;
      }
      const id = slugify(name);
      types.push({ id, label: name, questions: [], roleId: null });
      storage.setApplyTypes(guildId, types);
      await interaction.reply({ content: `✅ Added application type **${name}**. Now add questions with \`/apply-config add-question\`.`, flags: EPHEMERAL });
      return;
    }

    if (sub === 'remove-type') {
      const name = interaction.options.getString('type');
      const types = storage.getApplyTypes(guildId);
      const type = findType(guildId, name);
      if (!type) {
        await interaction.reply({ content: `❌ No application type found matching "${name}".`, flags: EPHEMERAL });
        return;
      }
      storage.setApplyTypes(guildId, types.filter((t) => t.id !== type.id));
      await interaction.reply({ content: `✅ Removed application type **${type.label}**.`, flags: EPHEMERAL });
      return;
    }

    if (sub === 'add-question') {
      const type = findType(guildId, interaction.options.getString('type'));
      if (!type) {
        await interaction.reply({ content: '❌ Application type not found. Use `/apply-config list` to see the current types.', flags: EPHEMERAL });
        return;
      }
      if (type.questions.length >= MAX_QUESTIONS) {
        await interaction.reply({ content: `❌ At most ${MAX_QUESTIONS} questions per type are supported.`, flags: EPHEMERAL });
        return;
      }
      const question = interaction.options.getString('question').trim();
      const types = storage.getApplyTypes(guildId);
      types.find((t) => t.id === type.id).questions.push(question);
      storage.setApplyTypes(guildId, types);
      await interaction.reply({ content: `✅ Added question ${type.questions.length + 1} to **${type.label}**: "${question}"`, flags: EPHEMERAL });
      return;
    }

    if (sub === 'remove-question') {
      const type = findType(guildId, interaction.options.getString('type'));
      const number = interaction.options.getInteger('number');
      if (!type) {
        await interaction.reply({ content: '❌ Application type not found.', flags: EPHEMERAL });
        return;
      }
      if (number < 1 || number > type.questions.length) {
        await interaction.reply({ content: `❌ **${type.label}** only has ${type.questions.length} question(s).`, flags: EPHEMERAL });
        return;
      }
      const types = storage.getApplyTypes(guildId);
      const removed = types.find((t) => t.id === type.id).questions.splice(number - 1, 1);
      storage.setApplyTypes(guildId, types);
      await interaction.reply({ content: `✅ Removed question ${number} from **${type.label}**: "${removed[0]}"`, flags: EPHEMERAL });
      return;
    }

    if (sub === 'set-role') {
      const type = findType(guildId, interaction.options.getString('type'));
      if (!type) {
        await interaction.reply({ content: '❌ Application type not found.', flags: EPHEMERAL });
        return;
      }
      const role = interaction.options.getRole('role');
      const types = storage.getApplyTypes(guildId);
      types.find((t) => t.id === type.id).roleId = role ? role.id : null;
      storage.setApplyTypes(guildId, types);
      await interaction.reply({
        content: role ? `✅ Accepted **${type.label}** applicants will now receive ${role.toString()}.` : `✅ Cleared the auto-role for **${type.label}**.`,
        flags: EPHEMERAL,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (sub === 'set-review-channel') {
      const channel = interaction.options.getChannel('channel');
      storage.setGuildSetting(guildId, 'applyReviewChannelId', channel.id);
      await interaction.reply({ content: `✅ Applications will now be reviewed in ${channel.toString()}.`, flags: EPHEMERAL });
      return;
    }

    if (sub === 'list') {
      const types = storage.getApplyTypes(guildId);
      const settings = storage.getGuildSettings(guildId);
      if (types.length === 0) {
        await interaction.reply({ content: 'No application types configured yet. Start with `/apply-config add-type`.', flags: EPHEMERAL });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle('📋 Application Types')
        .setColor(0x5865f2)
        .addFields(
          types.map((t) => ({
            name: `${t.label} (${t.questions.length} question(s))${t.roleId ? ` — grants <@&${t.roleId}>` : ''}`,
            value: t.questions.length ? t.questions.map((q, i) => `${i + 1}. ${truncate(q, 200)}`).join('\n') : '_No questions yet_',
          }))
        )
        .setFooter({ text: settings.applyReviewChannelId ? `Review channel: #${settings.applyReviewChannelId}` : 'No review channel set - use /apply-config set-review-channel' });
      await interaction.reply({ embeds: [embed], flags: EPHEMERAL, allowedMentions: { parse: [] } });
    }
  },
};

const applyPanel = {
  data: new SlashCommandBuilder().setName('apply-panel').setDescription('Posts the application panel (one button per configured type)'),
  async execute(interaction) {
    const types = storage.getApplyTypes(interaction.guildId);
    if (types.length === 0) {
      await interaction.reply({ content: '❌ No application types configured yet. Use `/apply-config add-type` first.', flags: EPHEMERAL });
      return;
    }
    const settings = storage.getGuildSettings(interaction.guildId);
    if (!settings.applyReviewChannelId) {
      await interaction.reply({ content: '❌ No review channel set yet. Use `/apply-config set-review-channel` first.', flags: EPHEMERAL });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 Applications')
      .setDescription(types.map((t) => `• **${t.label}**`).join('\n'))
      .setColor(0x5865f2)
      .setFooter({ text: "Click a button below - I'll DM you the questions." });

    // Ephemeral confirmation (hides the whole "used /apply-panel" notice from
    // everyone else), then the actual panel is a plain channel message.
    await interaction.reply({ content: '✅ Panel posted below.', flags: EPHEMERAL });
    await interaction.channel.send({ embeds: [embed], components: [buildPanelRow(types)] });
  },
};

module.exports = { applyConfig, applyPanel };
