// menus.js
// The interactive /help and /changelog menus.
//
// /help      - an overview with a drop-down: pick a category and the message switches to its commands.
//              Generated AUTOMATICALLY from the registered command list (every command carries its
//              category, see commands.js), so removed commands disappear and new ones appear on their own.
// /changelog - newest updates first, 3 per page, with Previous / Next buttons.
//
// Both are ephemeral (every person gets their own menu, nobody can flip someone else's page).
// Components: "hp:menu" (select), "cl:<page>" (buttons) - routed in index.js.

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const config = require('./config');
const { EPHEMERAL, truncate } = require('./util');

const HELP_PREFIX = 'hp:';
const CHANGELOG_PREFIX = 'cl:';
const HELP_MENU_ID = 'hp:menu';
const PAGE_SIZE = 3;

const CATEGORIES = [
  ['general', '📌 General', 'Info and links'],
  ['moderation', '🛡️ Moderation', 'Kick, ban, warn, clear and more'],
  ['admin', '⚙️ Administration', 'Server setup'],
  ['welcome', '👋 Welcome', 'Welcome messages'],
  ['apply', '📋 Applications', 'Staff applications'],
  ['tickets', '🎫 Tickets', 'Support tickets'],
  ['reports', '🚨 Reports', 'Report members to the moderators'],
  ['rules', '📜 Rules', 'Server rules with versions'],
  ['partner', '🤝 Partners', 'Partner requests and list'],
  ['giveaway', '🎉 Giveaways', 'Giveaways with several winners'],
  ['utility', '🧰 Utility', 'Handy tools'],
  ['bot', '🤖 Bot', 'Bot status and statistics'],
  ['ai', '🧠 AI', 'AI features'],
];
const OTHER = ['__other', '📦 Other', 'Everything else'];

function accessBadge(cmd) {
  const badge = (a) => (a === 'mod' ? '🛡️ Mod' : a === 'admin' ? '🔧 Admin' : '👑 Owner');
  const a = cmd.access;
  if (!a || a === 'everyone') return '';
  if (typeof a === 'string') return ` \`${badge(a)}\``;
  const def = a.default || 'everyone';
  const subs = Object.values(a.sub || {});
  if (def === 'everyone') return subs.some((v) => v && v !== 'everyone') ? ' `partly 🔧 Admin`' : '';
  return subs.some((v) => v === 'everyone') ? ` \`partly ${badge(def)}\`` : ` \`${badge(def)}\``;
}

function describeCommand(cmd) {
  const json = cmd.data.toJSON();
  const subs = (json.options || []).filter((o) => o.type === 1 || o.type === 2).map((o) => o.name);
  const subText = subs.length ? ` _(${subs.join(' · ')})_` : '';
  return `\`/${json.name}\`${subText} — ${truncate(json.description || '', 70)}${accessBadge(cmd)}`;
}

function groupCommands(all) {
  const groups = new Map([...CATEGORIES, OTHER].map(([key, label, blurb]) => [key, { key, label, blurb, cmds: [] }]));
  for (const cmd of all) (groups.get(cmd.category) || groups.get(OTHER[0])).cmds.push(cmd);
  return [...groups.values()].filter((g) => g.cmds.length > 0);
}

function buildHelp(all, selected) {
  const groups = groupCommands(all);
  const current = groups.find((g) => g.key === selected) || null;

  const embed = new EmbedBuilder().setColor(0x5865f2);
  if (!current) {
    embed
      .setTitle(`📖 Help — ${all.length} commands`)
      .setDescription('Pick a category from the menu below to see its commands.')
      .addFields(groups.map((g) => ({ name: `${g.label} (${g.cmds.length})`, value: truncate(g.cmds.map((c) => `\`/${c.data.name}\``).join(' '), 1000) })).slice(0, 25))
      .setFooter({ text: 'Also: !support [request] (text command) - same as /ticket' });
  } else {
    embed
      .setTitle(`${current.label} — ${current.cmds.length} command${current.cmds.length === 1 ? '' : 's'}`)
      .setDescription(truncate(current.cmds.map(describeCommand).join('\n'), 4000))
      .setFooter({ text: 'Use the menu to switch category' });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(HELP_MENU_ID)
    .setPlaceholder('Choose a category…')
    .addOptions([
      { label: '📖 Overview', value: 'overview', description: 'All categories at a glance', default: !current },
      ...groups.map((g) => ({ label: g.label, value: g.key, description: `${g.cmds.length} command${g.cmds.length === 1 ? '' : 's'} · ${g.blurb}`.slice(0, 100), default: !!current && current.key === g.key })),
    ]);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

function changelogEntries() {
  return [...(config.changelog || [])].reverse(); // newest first
}

function buildChangelog(page) {
  const entries = changelogEntries();
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = entries.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setTitle('📋 Changelog')
    .setColor(0x5865f2)
    .setFooter({ text: `Page ${p + 1} of ${pages} · ${entries.length} updates` });
  if (!slice.length) embed.setDescription('There are no changelog entries yet.');
  else embed.addFields(slice.map((e) => ({ name: `🗓️ ${e.date || '?'}`, value: truncate(e.text || '(no text)', 1000) })));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${CHANGELOG_PREFIX}${p - 1}`).setLabel('Previous').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
    new ButtonBuilder().setCustomId(`${CHANGELOG_PREFIX}x`).setLabel(`${p + 1} / ${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`${CHANGELOG_PREFIX}${p + 1}`).setLabel('Next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(p >= pages - 1)
  );
  return { embeds: [embed], components: [row] };
}

function buildHelpCommand() {
  return {
    data: new SlashCommandBuilder().setName('help').setDescription('Shows all commands in a menu'),
    async execute(interaction) {
      await interaction.reply({ ...buildHelp([...interaction.client.commands.values()], null), flags: EPHEMERAL });
    },
  };
}

const changelog = {
  data: new SlashCommandBuilder().setName('changelog').setDescription("Shows the project's latest updates"),
  async execute(interaction) {
    await interaction.reply({ ...buildChangelog(0), flags: EPHEMERAL });
  },
};

// Select menu + page buttons.
async function handleComponent(interaction) {
  if (interaction.customId === HELP_MENU_ID && interaction.isStringSelectMenu()) {
    await interaction.update(buildHelp([...interaction.client.commands.values()], interaction.values[0]));
    return;
  }
  if (interaction.customId.startsWith(CHANGELOG_PREFIX)) {
    const page = Number(interaction.customId.slice(CHANGELOG_PREFIX.length));
    await interaction.update(buildChangelog(Number.isInteger(page) ? page : 0));
    return;
  }
  await interaction.reply({ content: '❌ This menu is no longer available - run the command again.', flags: EPHEMERAL });
}

module.exports = { HELP_PREFIX, CHANGELOG_PREFIX, buildHelpCommand, changelog, handleComponent, buildHelp, buildChangelog, groupCommands };
