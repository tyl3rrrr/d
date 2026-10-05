// giveaway-runtime.js
// Giveaway logic: creating, joining, automatic draw, early end, reroll, cancel.
// The slash command lives in commands-giveaway.js; the "Join" button is routed here
// by index.js (custom IDs start with "gw:join:").
//
// - Everything is stored in data.json (storage.js), so giveaways survive restarts.
//   A scheduler checks every 15 s for giveaways whose time is up and draws them
//   automatically - also ones that ended while the bot was offline.
// - Winners are drawn with crypto.randomInt (fair shuffle). Every candidate is
//   re-checked at draw time (still on the server, still has the required role,
//   still meets the minimum membership time) so nobody wins who left in between.
// - Reroll never picks anyone who was already drawn for that giveaway.

const crypto = require('crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const storage = require('./storage');
const { EPHEMERAL, truncate, errText } = require('./util');

const JOIN_PREFIX = 'gw:join:';
const TICK_MS = 15 * 1000;
const REFRESH_DELAY_MS = 8 * 1000; // entry counter on the message updates at most this often
const MAX_MEMBER_FETCHES = 500;

const MIN_DURATION_MS = 60 * 1000;
const MAX_DURATION_MS = 60 * 24 * 60 * 60 * 1000;
const UNIT_MS = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };

// "30m", "2h", "1d", "1d12h", "1w" -> milliseconds (or null when unreadable).
function parseDuration(text) {
  const clean = String(text || '').toLowerCase().replace(/\s+/g, '');
  if (!/^(?:\d+[smhdw])+$/.test(clean)) return null;
  let total = 0;
  for (const [, n, unit] of clean.matchAll(/(\d+)([smhdw])/g)) total += Number(n) * UNIT_MS[unit];
  return Number.isFinite(total) && total > 0 ? total : null;
}

function newId(guildId) {
  for (;;) {
    const id = crypto.randomBytes(3).toString('hex');
    if (!storage.getGiveaway(guildId, id)) return id;
  }
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const mentions = (ids) => ids.map((id) => `<@${id}>`).join(', ');

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------
function roleIdsOf(member) {
  if (!member || !member.roles) return [];
  return Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()];
}

function joinedAtOf(member) {
  if (!member) return null;
  if (member.joinedTimestamp) return member.joinedTimestamp;
  return member.joined_at ? Date.parse(member.joined_at) : null;
}

// Returns a short reason why this member may NOT enter, or null when everything is fine.
function ineligibleReason(member, g) {
  if (g.requiredRoleId && !roleIdsOf(member).includes(g.requiredRoleId)) {
    return `you need the <@&${g.requiredRoleId}> role.`;
  }
  if (g.minDays) {
    const joined = joinedAtOf(member);
    if (joined && Date.now() - joined < g.minDays * 86400000) {
      return `you must have been a member of this server for at least ${g.minDays} day${g.minDays === 1 ? '' : 's'}.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The giveaway message
// ---------------------------------------------------------------------------
function requirementLines(g) {
  const lines = [];
  if (g.requiredRoleId) lines.push(`• Role: <@&${g.requiredRoleId}>`);
  if (g.minDays) lines.push(`• Member of this server for at least ${g.minDays} day${g.minDays === 1 ? '' : 's'}`);
  if (g.conditions) lines.push(`• ${g.conditions}`);
  return lines;
}

function buildMessage(g) {
  const ends = Math.floor(g.endsAt / 1000);
  const embed = new EmbedBuilder().setTitle(`🎉 ${truncate(g.prize, 240)}`).setFooter({ text: `Entries: ${g.entries.length} · ID: ${g.id}` });
  const lines = [];

  if (g.status === 'active') {
    embed.setColor(0x5865f2);
    lines.push('Click **Join** below to enter!', '', `⏰ Ends: <t:${ends}:R> (<t:${ends}:f>)`, `🏆 Winners: **${g.winnersCount}**`, `👤 Hosted by: <@${g.hostId}>`);
  } else if (g.status === 'cancelled') {
    embed.setColor(0xed4245);
    lines.push('❌ This giveaway was cancelled.', '', `👤 Hosted by: <@${g.hostId}>`);
  } else {
    embed.setColor(0x99aab5);
    lines.push(
      g.winners && g.winners.length ? `🏆 Winner${g.winners.length === 1 ? '' : 's'}: ${mentions(g.winners)}` : '😕 No valid entries - nobody won.',
      `⏹️ Ended: <t:${Math.floor((g.endedAt || g.endsAt) / 1000)}:R>`,
      `👤 Hosted by: <@${g.hostId}>`
    );
    if (g.rerolled && g.rerolled.length) lines.push(`🔁 Reroll winner${g.rerolled.length === 1 ? '' : 's'}: ${mentions(g.rerolled)}`);
  }

  const req = requirementLines(g);
  if (req.length) lines.push('', '**Requirements**', ...req);
  embed.setDescription(truncate(lines.join('\n'), 4000));

  const button = new ButtonBuilder().setCustomId(`${JOIN_PREFIX}${g.id}`).setStyle(g.status === 'active' ? ButtonStyle.Primary : ButtonStyle.Secondary);
  if (g.status === 'active') button.setLabel('Join').setEmoji('🎉');
  else button.setLabel(g.status === 'cancelled' ? 'Cancelled' : 'Giveaway ended').setDisabled(true);

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

async function locate(client, guildId, g) {
  const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return { guild: null, channel: null, message: null };
  const channel = guild.channels.cache.get(g.channelId) || (await guild.channels.fetch(g.channelId).catch(() => null));
  if (!channel || !channel.isTextBased()) return { guild, channel: null, message: null };
  const message = g.messageId ? await channel.messages.fetch(g.messageId).catch(() => null) : null;
  return { guild, channel, message };
}

async function refreshMessage(client, guildId, id) {
  const g = storage.getGiveaway(guildId, id);
  if (!g) return;
  const { message } = await locate(client, guildId, g);
  if (message) await message.edit(buildMessage(g)).catch((err) => console.warn(`Giveaway ${id}: could not update the message:`, errText(err)));
}

const refreshTimers = new Map();
function scheduleRefresh(client, guildId, id) {
  const key = `${guildId}:${id}`;
  if (refreshTimers.has(key)) return;
  const timer = setTimeout(() => {
    refreshTimers.delete(key);
    refreshMessage(client, guildId, id).catch(() => {});
  }, REFRESH_DELAY_MS);
  if (timer.unref) timer.unref();
  refreshTimers.set(key, timer);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
async function create(guild, channel, opts) {
  const g = {
    id: newId(guild.id),
    guildId: guild.id,
    channelId: channel.id,
    messageId: null,
    prize: opts.prize,
    winnersCount: opts.winnersCount,
    hostId: opts.hostId,
    createdAt: Date.now(),
    endsAt: Date.now() + opts.durationMs,
    requiredRoleId: opts.requiredRoleId || null,
    minDays: opts.minDays || 0,
    conditions: opts.conditions || null,
    status: 'active',
    entries: [],
    winners: [],
    drawn: [],
    rerolled: [],
  };
  const message = await channel.send(buildMessage(g)); // throws on missing permissions -> clear error via interaction-guard
  g.messageId = message.id;
  storage.saveGiveaway(guild.id, g);
  return { giveaway: g, message };
}

// ---------------------------------------------------------------------------
// Join button
// ---------------------------------------------------------------------------
async function handleButton(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '❌ Giveaways only work on servers.', flags: EPHEMERAL });
    return;
  }
  const id = interaction.customId.slice(JOIN_PREFIX.length);
  const g = storage.getGiveaway(interaction.guildId, id);
  if (!g) {
    await interaction.reply({ content: '❌ This giveaway no longer exists.', flags: EPHEMERAL });
    return;
  }
  if (g.status !== 'active' || g.endsAt <= Date.now()) {
    await interaction.reply({ content: '⏹️ This giveaway has already ended.', flags: EPHEMERAL });
    return;
  }

  const reason = ineligibleReason(interaction.member, g);
  if (reason) {
    await interaction.reply({ content: `❌ You can't enter: ${reason}`, flags: EPHEMERAL, allowedMentions: { parse: [] } });
    return;
  }

  const entered = storage.toggleGiveawayEntry(interaction.guildId, id, interaction.user.id);
  scheduleRefresh(interaction.client, interaction.guildId, id);
  await interaction.reply({
    content: entered ? "✅ You're in - good luck! 🍀 (Click the button again to leave.)" : '👋 You left the giveaway.',
    flags: EPHEMERAL,
  });
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
async function pickWinners(guild, g, count, exclude = []) {
  const skip = new Set(exclude);
  const pool = shuffle(g.entries.filter((uid) => !skip.has(uid)));
  const winners = [];
  let fetches = 0;
  for (const userId of pool) {
    if (winners.length >= count || fetches >= MAX_MEMBER_FETCHES) break;
    fetches++;
    const member = await guild.members.fetch(userId).catch(() => null); // left the server -> skipped
    if (!member || member.user.bot) continue;
    if (ineligibleReason(member, g)) continue;
    winners.push(userId);
  }
  return winners;
}

async function announce(channel, g, content, winners) {
  if (!channel) return;
  const payload = { content, allowedMentions: { users: winners } };
  if (g.messageId) payload.reply = { messageReference: g.messageId, failIfNotExists: false };
  await channel.send(payload).catch((err) => console.warn(`Giveaway ${g.id}: could not announce in the channel:`, errText(err)));
}

// Ends a running giveaway NOW and draws the winners. Returns the updated record or null.
async function endGiveaway(client, guildId, id) {
  const g = storage.getGiveaway(guildId, id);
  if (!g || g.status !== 'active') return null;

  const { guild, channel, message } = await locate(client, guildId, g);
  if (!guild) {
    // The bot is no longer on that server - nothing to draw.
    storage.updateGiveaway(guildId, id, { status: 'cancelled', endedAt: Date.now() });
    return null;
  }

  // Mark as ended FIRST so a second tick/click can never draw twice.
  storage.updateGiveaway(guildId, id, { status: 'ended', endedAt: Date.now() });

  let winners = [];
  try {
    winners = await pickWinners(guild, g, g.winnersCount);
  } catch (err) {
    console.warn(`Giveaway ${id}: drawing failed:`, errText(err));
  }
  const done = storage.updateGiveaway(guildId, id, { winners, drawn: [...winners] });

  if (message) await message.edit(buildMessage(done)).catch((err) => console.warn(`Giveaway ${id}: could not update the message:`, errText(err)));
  await announce(
    channel,
    done,
    winners.length ? `🎉 Congratulations ${mentions(winners)}! You won **${truncate(done.prize, 200)}**!` : `😕 Nobody could win **${truncate(done.prize, 200)}** - there were no valid entries.`,
    winners
  );
  return done;
}

// Draws NEW winners for an ended giveaway (never someone drawn before).
// Returns { ok, winners } or { ok:false, reason }.
async function rerollGiveaway(client, guildId, id, count) {
  const g = storage.getGiveaway(guildId, id);
  if (!g) return { ok: false, reason: 'That giveaway was not found.' };
  if (g.status !== 'ended') return { ok: false, reason: g.status === 'active' ? 'That giveaway is still running - use `/giveaway end` first.' : 'That giveaway was cancelled.' };

  const { guild, channel, message } = await locate(client, guildId, g);
  if (!guild) return { ok: false, reason: "I can't reach that server right now." };

  const winners = await pickWinners(guild, g, count, g.drawn || []);
  if (winners.length === 0) return { ok: false, reason: 'There is nobody left to draw - every valid entry has already been drawn.' };

  const done = storage.updateGiveaway(guildId, id, { drawn: [...(g.drawn || []), ...winners], rerolled: [...(g.rerolled || []), ...winners] });
  if (message) await message.edit(buildMessage(done)).catch(() => {});
  await announce(channel, done, `🔁 New winner${winners.length === 1 ? '' : 's'}: ${mentions(winners)}! Congratulations - you won **${truncate(done.prize, 200)}**!`, winners);
  return { ok: true, winners };
}

async function cancelGiveaway(client, guildId, id) {
  const g = storage.getGiveaway(guildId, id);
  if (!g || g.status !== 'active') return null;
  const done = storage.updateGiveaway(guildId, id, { status: 'cancelled', endedAt: Date.now() });
  const { message } = await locate(client, guildId, done);
  if (message) await message.edit(buildMessage(done)).catch(() => {});
  return done;
}

// ---------------------------------------------------------------------------
// Scheduler: automatic draw
// ---------------------------------------------------------------------------
let ticking = false;
async function tick(client) {
  if (ticking) return;
  ticking = true;
  try {
    for (const { guildId, giveaway } of storage.listActiveGiveaways()) {
      if (giveaway.endsAt > Date.now()) continue;
      try {
        await endGiveaway(client, guildId, giveaway.id);
      } catch (err) {
        console.warn(`Giveaway ${giveaway.id}: automatic draw failed:`, errText(err));
      }
    }
  } finally {
    ticking = false;
  }
}

function start(client) {
  tick(client); // also draws giveaways that ended while the bot was offline
  setInterval(() => tick(client), TICK_MS);
  setInterval(() => storage.pruneGiveaways(60), 6 * 60 * 60 * 1000).unref();
}

module.exports = {
  JOIN_PREFIX,
  MIN_DURATION_MS,
  MAX_DURATION_MS,
  parseDuration,
  create,
  handleButton,
  endGiveaway,
  rerollGiveaway,
  cancelGiveaway,
  start,
  // exported for tests
  pickWinners,
  ineligibleReason,
  buildMessage,
};
