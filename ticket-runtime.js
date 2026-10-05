// ticket-runtime.js
// The ticket system - NO channel creation anymore.
//
// Flow:
//   1. A user runs /ticket (or presses the panel button, or writes !support).
//   2. The bot DMs them: "What do you need help with? Type /ticket-close to close this ticket".
//   3. The user's NEXT DM is the whole ticket (text + any files). The bot forwards
//      it as ONE message to the ticket channel (set in /settings -> "Ticket channel"),
//      pings the ticket role (if set), and answers "We informed our Staff! ...".
//      A ticket is exactly one message - after that the DM is no ticket anymore.
//   4. Typing /ticket-close in the DM (as a slash command OR as plain text)
//      cancels it: "Cancelled Ticket".
//
// "Is this DM a ticket or something else?" (the bot also talks to people in DMs
// for applications): a DM only counts as a ticket if that user has an OPEN ticket
// session. Sessions are stored in data.json (meta.ticketSessions), so they survive
// a restart, and expire after 30 minutes. A user can't have a ticket and an
// application interview open at the same time (both start paths check the other),
// so a DM never has two possible meanings. index.js asks handleDM() first and only
// passes the DM on to the application handler if handleDM() returns false.

const { EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const storage = require('./storage');
const applyRuntime = require('./apply-runtime');
const logging = require('./logging');
const { errText, truncate } = require('./util');

const SESSIONS_KEY = 'ticketSessions';
const SESSION_MS = 30 * 60 * 1000;
const MAX_FILES = 10;
const FALLBACK_UPLOAD_LIMIT = 10 * 1024 * 1024;

const TEXT = {
  prompt: 'What do you need help with? Type /ticket-close to close this ticket',
  done: 'We informed our Staff! Help is in the Way!',
  cancelled: 'Cancelled Ticket',
};

// ---------------------------------------------------------------------------
// Sessions: userId -> { guildId, expiresAt }
// ---------------------------------------------------------------------------
function allSessions() {
  return storage.getMeta(SESSIONS_KEY) || {};
}

function getSession(userId) {
  const sessions = allSessions();
  const s = sessions[userId];
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    clearSession(userId);
    return null;
  }
  return s;
}

function setSession(userId, guildId) {
  const sessions = allSessions();
  for (const [id, s] of Object.entries(sessions)) if (s.expiresAt <= Date.now()) delete sessions[id]; // tidy up
  sessions[userId] = { guildId, expiresAt: Date.now() + SESSION_MS };
  storage.setMeta(SESSIONS_KEY, sessions);
}

function clearSession(userId) {
  const sessions = allSessions();
  if (sessions[userId]) {
    delete sessions[userId];
    storage.setMeta(SESSIONS_KEY, sessions);
  }
}

function hasSession(userId) {
  return Boolean(getSession(userId));
}

// ---------------------------------------------------------------------------
// Starting a ticket (shared by /ticket, the panel button and !support)
// Returns { ok: true } or { ok: false, error }.
// ---------------------------------------------------------------------------
// Checks that the ticket channel is set up and usable. Returns { ok: true } or { ok: false, error }.
function checkSetup(guild) {
  const settings = storage.getGuildSettings(guild.id);
  if (!settings.ticketChannelId) {
    return { ok: false, error: 'Tickets are not set up on this server yet. An admin can pick the ticket channel with `/settings`.' };
  }
  const channel = guild.channels.cache.get(settings.ticketChannelId);
  if (!channel || !channel.isTextBased()) {
    return { ok: false, error: 'The ticket channel no longer exists. An admin needs to pick a new one with `/settings`.' };
  }
  const me = guild.members.me;
  const perms = me && channel.permissionsFor(me);
  if (perms && !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles])) {
    return { ok: false, error: "I can't post in the ticket channel (I need View Channel, Send Messages, Embed Links and Attach Files there). An admin needs to fix that." };
  }
  return { ok: true };
}

async function begin(user, guild) {
  const setup = checkSetup(guild);
  if (!setup.ok) return setup;
  if (applyRuntime.hasSession(user.id)) {
    return { ok: false, error: 'You are in the middle of an application. Finish it first, then open a ticket.' };
  }
  if (hasSession(user.id)) {
    return { ok: false, error: 'You already have an open ticket - check your DMs and write your message there, or type `/ticket-close` to cancel it.' };
  }

  try {
    await user.send(TEXT.prompt);
  } catch (err) {
    return { ok: false, error: "I couldn't DM you - please allow direct messages from server members and try again." };
  }
  setSession(user.id, guild.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Delivering the ticket: ONE message with text + files into the ticket channel.
// payload = { content, attachments: iterable of { url, name, size, contentType, description } }
// Returns { ok: true } or { ok: false, error }.
// ---------------------------------------------------------------------------
async function deliver(client, guildId, user, payload) {
  const guild = client.guilds.cache.get(guildId);
  const settings = storage.getGuildSettings(guildId);
  const channel = guild && settings.ticketChannelId && guild.channels.cache.get(settings.ticketChannelId);
  if (!guild || !channel || !channel.isTextBased()) {
    return { ok: false, gone: true, error: 'The ticket channel is not available anymore. Please contact the server staff directly.' };
  }

  // Re-upload files (Discord DM links expire); anything too big/failing stays a link.
  const limit = guild.maximumUploadLimit || FALLBACK_UPLOAD_LIMIT;
  const files = [];
  const links = [];
  let total = 0;
  const list = [...(payload.attachments || [])];
  for (const [i, att] of list.entries()) {
    if (i >= MAX_FILES || total + (att.size || 0) > limit) {
      links.push(att);
      continue;
    }
    try {
      const res = await fetch(att.url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      total += buf.length;
      const safe = `${files.length + 1}_${String(att.name || 'file').replace(/[^\w.-]+/g, '_')}`.slice(0, 100);
      files.push({ builder: new AttachmentBuilder(buf, { name: safe, description: att.description || undefined }), name: safe, type: att.contentType || '' });
    } catch (err) {
      links.push(att);
    }
  }

  const number = storage.nextTicketNumber(guildId);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎫 Ticket #${number}`)
    .setAuthor({ name: user.tag || user.username, iconURL: user.displayAvatarURL ? user.displayAvatarURL() : undefined })
    .addFields({ name: 'From', value: `<@${user.id}> (${user.id})` })
    .setTimestamp();
  const text = (payload.content || '').trim();
  if (text) embed.setDescription(truncate(text, 4000));
  const firstImage = files.find((f) => f.type.startsWith('image/'));
  if (firstImage) embed.setImage(`attachment://${firstImage.name}`);
  if (files.length) embed.addFields({ name: 'Files', value: truncate(files.map((f) => f.name).join('\n'), 1024) });
  if (links.length) {
    embed.addFields({ name: 'Files that could not be re-uploaded', value: truncate(links.map((a) => `[${truncate(a.name || 'file', 60)}](${a.url})`).join('\n'), 1024) });
  }

  const roleId = settings.ticketStaffRoleId && guild.roles.cache.has(settings.ticketStaffRoleId) ? settings.ticketStaffRoleId : null;
  try {
    await channel.send({
      content: roleId ? `<@&${roleId}>` : undefined,
      embeds: [embed],
      files: files.map((f) => f.builder),
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] },
    });
  } catch (err) {
    console.warn(`Tickets: could not post to ${guildId}:`, errText(err));
    logging.logError(client, guildId, err, `Ticket #${number} from ${user.tag || user.id} could not be posted to the ticket channel`);
    return { ok: false, error: "Sorry, I couldn't deliver your ticket. Please try again later or contact the server staff directly." };
  }

  logging.logToGuild(client, guildId, {
    title: '🎫 Ticket created',
    fields: [
      { name: 'Ticket', value: `#${number}`, inline: true },
      { name: 'By', value: user.tag || user.username, inline: true },
    ],
  });
  return { ok: true, number };
}

// ---------------------------------------------------------------------------
// DM handler. Returns true if the message belonged to a ticket (and was handled).
// ---------------------------------------------------------------------------
const CLOSE_TEXT = /^\/?ticket-close\s*$/i;

async function handleDM(message) {
  const session = getSession(message.author.id);
  if (!session) return false; // no open ticket -> not our message

  const text = (message.content || '').trim();

  if (CLOSE_TEXT.test(text)) {
    clearSession(message.author.id);
    await message.channel.send(TEXT.cancelled);
    return true;
  }

  if (!text && message.attachments.size === 0) {
    await message.channel.send('Please describe your problem in text or send a file - or type `/ticket-close` to cancel.');
    return true;
  }

  const result = await deliver(message.client, session.guildId, message.author, { content: message.content, attachments: message.attachments.values() });
  if (!result.ok) {
    if (result.gone) clearSession(message.author.id);
    await message.channel.send(`❌ ${result.error}`);
    return true;
  }
  clearSession(message.author.id);
  await message.channel.send(TEXT.done);
  return true;
}

// /ticket-close as a slash command. Returns true if a ticket was cancelled.
function cancel(userId) {
  const had = hasSession(userId);
  clearSession(userId);
  return had;
}

module.exports = { TEXT, checkSetup, begin, deliver, handleDM, cancel, hasSession };
