// rules-runtime.js
// Server rules with versions and an "Accept" button.
//
// - /rules edit opens a form (modal) with the current text. Saving a CHANGED text raises the
//   version number (v1 -> v2 ...), keeps the last 10 versions as history and updates the posted
//   rules message. Members have to accept again, because "accepted" is stored per version.
// - /rules post puts the rules message with the button into a channel. The button's custom ID
//   contains the version ("ru:accept:3"): an outdated message can never be used to accept
//   rules the person has not seen - it just refreshes itself and asks to try again.
// - On accept the optional "Rules role" (set in /settings) is granted. Roles are NOT removed
//   automatically when a new version is published.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const storage = require('./storage');
const permissions = require('./permissions');
const logging = require('./logging');
const { EPHEMERAL, truncate, errText } = require('./util');

const PREFIX = 'ru:';
const ACCEPT_PREFIX = 'ru:accept:';
const EDIT_MODAL_ID = 'ru:edit';
const MAX_TEXT = 3900;
const MAX_HISTORY = 10;

function emptyRules() {
  return { text: '', version: 0, history: [], accepted: {}, channelId: null, messageId: null, updatedAt: null, updatedBy: null };
}

function getRules(guildId) {
  return { ...emptyRules(), ...(storage.getRules(guildId) || {}) };
}

function buildMessage(rules) {
  const embed = new EmbedBuilder()
    .setTitle('📜 Server Rules')
    .setColor(0x5865f2)
    .setDescription(truncate(rules.text, 4000))
    .setFooter({ text: `Version ${rules.version}${rules.updatedAt ? ` · updated ${new Date(rules.updatedAt).toISOString().slice(0, 10)}` : ''}` });
  const button = new ButtonBuilder().setCustomId(`${ACCEPT_PREFIX}${rules.version}`).setLabel('I accept the rules').setStyle(ButtonStyle.Success).setEmoji('✅');
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

async function fetchPosted(client, guildId, rules) {
  if (!rules.channelId || !rules.messageId) return null;
  const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
  const channel = guild && (guild.channels.cache.get(rules.channelId) || (await guild.channels.fetch(rules.channelId).catch(() => null)));
  if (!channel || !channel.isTextBased()) return null;
  return channel.messages.fetch(rules.messageId).catch(() => null);
}

async function refreshPosted(client, guildId) {
  const rules = getRules(guildId);
  const message = await fetchPosted(client, guildId, rules);
  if (!message) return false;
  return message.edit(buildMessage(rules)).then(() => true).catch((err) => {
    console.warn(`Rules: could not update the posted message on ${guildId}:`, errText(err));
    return false;
  });
}

// Posts (or re-posts) the rules message in a channel. Old posted message is removed.
async function post(client, guild, channel) {
  const rules = getRules(guild.id);
  if (!rules.text || rules.version < 1) return { ok: false, reason: 'There are no rules yet - write them with `/rules edit` first.' };
  const old = await fetchPosted(client, guild.id, rules);
  let message;
  try {
    message = await channel.send(buildMessage(rules));
  } catch (err) {
    return { ok: false, reason: `I can't post in ${channel.toString()} - I need View Channel, Send Messages and Embed Links there.` };
  }
  if (old && old.id !== message.id) await old.delete().catch(() => {});
  storage.saveRules(guild.id, { ...rules, channelId: channel.id, messageId: message.id });
  return { ok: true, message };
}

// Saves new text. Returns { changed, version }.
function applyEdit(guildId, text, userTag) {
  const rules = getRules(guildId);
  const clean = String(text || '').trim();
  if (clean === rules.text) return { changed: false, version: rules.version };
  const version = rules.version + 1;
  const history = [...rules.history, { version, text: clean, at: Date.now(), by: userTag }].slice(-MAX_HISTORY);
  storage.saveRules(guildId, { ...rules, text: clean, version, history, updatedAt: Date.now(), updatedBy: userTag });
  return { changed: true, version };
}

function countAccepted(rules) {
  let current = 0;
  let older = 0;
  for (const v of Object.values(rules.accepted)) {
    if (v === rules.version) current++;
    else older++;
  }
  return { current, older };
}

// ---------------------------------------------------------------------------
// Edit form
// ---------------------------------------------------------------------------
async function showEditModal(interaction) {
  const rules = getRules(interaction.guildId);
  const input = new TextInputBuilder()
    .setCustomId('text')
    .setLabel(rules.version ? `Rules (currently version ${rules.version})` : 'Rules')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(10)
    .setMaxLength(MAX_TEXT)
    .setRequired(true);
  if (rules.text) input.setValue(rules.text.slice(0, MAX_TEXT));
  const modal = new ModalBuilder().setCustomId(EDIT_MODAL_ID).setTitle('Edit the server rules').addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleModal(interaction) {
  if (!interaction.inGuild() || !permissions.hasAccess(interaction, 'admin')) {
    await interaction.reply({ content: '❌ Only administrators can edit the rules.', flags: EPHEMERAL });
    return;
  }
  await interaction.deferReply({ flags: EPHEMERAL });
  const res = applyEdit(interaction.guildId, interaction.fields.getTextInputValue('text'), interaction.user.tag);
  if (!res.changed) {
    await interaction.editReply('ℹ️ Nothing changed - the text is identical, so the version stays at ' + res.version + '.');
    return;
  }
  const updated = await refreshPosted(interaction.client, interaction.guildId);
  logging.logToGuild(interaction.client, interaction.guildId, { title: '📜 Rules updated', description: `Now **version ${res.version}**, edited by ${interaction.user.tag}.`, level: 'warn' });
  await interaction.editReply(
    `✅ Rules saved as **version ${res.version}**. ` +
      (updated ? 'The posted message was updated; members need to accept again.' : 'Post them with `/rules post` so members can accept them.') +
      ' (Roles already granted are not removed automatically.)'
  );
}

// ---------------------------------------------------------------------------
// Accept button
// ---------------------------------------------------------------------------
async function handleButton(interaction) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: '❌ Rules only exist on servers.', flags: EPHEMERAL });
    return;
  }
  const guildId = interaction.guildId;
  const rules = getRules(guildId);
  const clickedVersion = Number(interaction.customId.slice(ACCEPT_PREFIX.length));

  if (rules.version < 1) {
    await interaction.reply({ content: '❌ The rules are currently being rewritten - please try again later.', flags: EPHEMERAL });
    return;
  }
  if (clickedVersion !== rules.version) {
    // The message the person clicked is outdated: bring it up to date instead of accepting unseen rules.
    refreshPosted(interaction.client, guildId).catch(() => {});
    await interaction.reply({ content: `⚠️ The rules were updated to **version ${rules.version}**. Please read the updated message and click the button again.`, flags: EPHEMERAL });
    return;
  }

  const userId = interaction.user.id;
  const already = rules.accepted[userId] === rules.version;
  if (!already) storage.saveRules(guildId, { ...rules, accepted: { ...rules.accepted, [userId]: rules.version } });

  // Optional role
  let roleNote = '';
  const roleId = storage.getGuildSettings(guildId).rulesRoleId;
  if (roleId) {
    const role = interaction.guild.roles.cache.get(roleId);
    const member = interaction.member;
    if (!role) roleNote = '\n⚠️ The rules role no longer exists - tell an admin.';
    else if (member.roles.cache.has(role.id)) roleNote = '';
    else if (role.managed || !role.editable || role.permissions.has(PermissionFlagsBits.Administrator)) roleNote = "\n⚠️ I can't grant the rules role (it is above my role or has admin rights) - tell an admin.";
    else {
      try {
        await member.roles.add(role, `Accepted the server rules (version ${rules.version})`);
        roleNote = `\n🎭 You received the **${truncate(role.name, 80)}** role.`;
      } catch (err) {
        roleNote = "\n⚠️ I couldn't give you the rules role - tell an admin.";
      }
    }
  }

  if (!already) logging.logToGuild(interaction.client, guildId, { title: '✅ Rules accepted', description: `${interaction.user.tag} accepted version ${rules.version}.` });
  await interaction.reply({ content: (already ? `✅ You had already accepted version ${rules.version}.` : `✅ Thanks! You accepted the rules (version ${rules.version}).`) + roleNote, flags: EPHEMERAL });
}

module.exports = { PREFIX, getRules, post, applyEdit, countAccepted, showEditModal, handleModal, handleButton, buildMessage, refreshPosted };
