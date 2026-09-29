// legacy-support.js
//
// Text-based "!support" command (not a slash command).
// - "!support config": the server owner/administrator is asked by message for
//   a role, a channel AND a ticket category (wizard). Saves the same settings
//   as /settings (ticketStaffRoleId, logChannelId, ticketCategoryId) - so
//   there is only ONE settings set, whether configured via /settings or via
//   !support config.
// - "!support <request>": creates a private ticket channel (like the "Create
//   Ticket" button) WITH the request as content, and sends exactly ONE
//   notification to the configured log channel (no more spam).
//
// The bot ONLY processes messages from servers (message.guild present). DMs to
// the bot are not processed - in addition to the missing DirectMessages
// gateway intent in index.js (so the bot never even receives DM events).
//
// BUGFIX (duplicate/"infinite" messages): the real problem was most likely
// that the bot PROCESS ran twice at the same time (see the lock in index.js) -
// every incoming message was therefore processed twice. As an extra safeguard,
// each message ID is still only processed once here (a Set with automatic
// cleanup).

const { ChannelType } = require('discord.js');
const storage = require('./storage');
const { createTicketChannel } = require('./commands-tickets');
const { getMemberLevel, LEVEL } = require('./permissions');

const PREFIX = process.env.PREFIX || '!';
const COLLECT_TIMEOUT_MS = 30000;
const NONE_REGEX = /^(none|keine)$/i; // "keine" kept as an accepted alias for existing users

// Extra safeguard against processing the same message twice.
const processedMessageIds = new Set();
function markProcessed(id) {
  processedMessageIds.add(id);
  if (processedMessageIds.size > 500) {
    // Roughly clean up the oldest entries so the Set doesn't grow unbounded.
    const first = processedMessageIds.values().next().value;
    processedMessageIds.delete(first);
  }
}

async function handleConfig(message) {
  // Central rank system (permissions.js): server owner, administrator role, or
  // Discord administrator - the same rule as /settings.
  const member = message.member;
  if (!member || getMemberLevel(message.guild, member) < LEVEL.ADMIN) {
    await message.reply('❌ Only the server owner or the administrator role of this server may configure the support system.');
    return;
  }

  await message.reply(
    '⚙️ Support setup started.\n' +
      'Please **mention the role** (e.g. `@Support`) that should be notified about new tickets, or type `none`. (30 seconds)'
  );

  const roleCollected = await message.channel
    .awaitMessages({
      filter: (m) => m.author.id === message.author.id && (m.mentions.roles.size > 0 || NONE_REGEX.test(m.content.trim())),
      max: 1,
      time: COLLECT_TIMEOUT_MS,
    })
    .catch(() => null);

  if (!roleCollected || roleCollected.size === 0) {
    await message.reply(`❌ Timed out or no valid answer. Please run \`${PREFIX}support config\` again.`);
    return;
  }
  const roleReply = roleCollected.first();
  const role = roleReply.mentions.roles.first() || null;

  await message.reply(
    '✅ Next.\nNow please **mention the log channel** (e.g. `#support-log`) where new tickets should be announced, or type `none`. (30 seconds)'
  );

  const channelCollected = await message.channel
    .awaitMessages({
      filter: (m) => m.author.id === message.author.id && (m.mentions.channels.size > 0 || NONE_REGEX.test(m.content.trim())),
      max: 1,
      time: COLLECT_TIMEOUT_MS,
    })
    .catch(() => null);

  if (!channelCollected || channelCollected.size === 0) {
    await message.reply(`❌ Timed out or no valid answer. Please run \`${PREFIX}support config\` again.`);
    return;
  }
  const channelReply = channelCollected.first();
  const logChannel = channelReply.mentions.channels.first() || null;

  const existingSettings = storage.getGuildSettings(message.guild.id);
  let categoryId = existingSettings.ticketCategoryId || null;

  if (!categoryId) {
    await message.reply(
      '✅ Next.\nLast: the **name of the category** in which ticket channels should be created (e.g. `Tickets` - it must already exist). (30 seconds)'
    );

    const categoryCollected = await message.channel
      .awaitMessages({
        filter: (m) => m.author.id === message.author.id,
        max: 1,
        time: COLLECT_TIMEOUT_MS,
      })
      .catch(() => null);

    if (!categoryCollected || categoryCollected.size === 0) {
      await message.reply(`❌ Timed out. Please run \`${PREFIX}support config\` again.`);
      return;
    }

    const typed = categoryCollected.first().content.trim();
    const category =
      message.guild.channels.cache.get(typed) ||
      message.guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === typed.toLowerCase());

    if (!category) {
      await message.reply(`❌ Couldn't find a category named "${typed}". Please create it on the server first and run \`${PREFIX}support config\` again.`);
      return;
    }
    categoryId = category.id;
  }

  storage.setGuildSetting(message.guild.id, 'ticketStaffRoleId', role ? role.id : null);
  storage.setGuildSetting(message.guild.id, 'logChannelId', logChannel ? logChannel.id : null);
  storage.setGuildSetting(message.guild.id, 'ticketCategoryId', categoryId);

  await message.reply(
    '✅ Support system set up!\n' +
      `• Role: ${role ? `<@&${role.id}>` : 'none'}\n` +
      `• Log channel: ${logChannel ? `<#${logChannel.id}>` : 'none'}\n` +
      `• Ticket category: <#${categoryId}>\n\n` +
      `Users can now open a ticket with \`${PREFIX}support <request>\`.`
  );
}

async function handleSupportRequest(message, text) {
  const result = await createTicketChannel(message.guild, message.author, text);

  if (!result.ok) {
    await message.reply(`❌ ${result.error}`);
    return;
  }

  if (result.existing) {
    await message.reply(`❗ You already have an open ticket: ${result.channel.toString()}`);
    return;
  }

  await message.reply(`✅ Your ticket was created: ${result.channel.toString()}`);
}

async function handleMessage(message) {
  if (message.author.bot) return;
  if (!message.guild) return; // No DM processing (see comment above)
  if (!message.content.startsWith(PREFIX)) return;

  // Extra safeguard against duplicate processing (see comment above).
  if (processedMessageIds.has(message.id)) return;
  markProcessed(message.id);

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = (args.shift() || '').toLowerCase();
  if (command !== 'support') return;

  const sub = (args[0] || '').toLowerCase();

  if (sub === 'config') {
    args.shift();
    await handleConfig(message);
    return;
  }

  const text = args.join(' ').trim();
  if (!text) {
    await message.reply(`Please describe your request, e.g. \`${PREFIX}support I need help with...\``);
    return;
  }
  await handleSupportRequest(message, text);
}

module.exports = { handleMessage };
