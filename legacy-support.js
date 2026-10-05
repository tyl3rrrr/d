// legacy-support.js
// Text-based "!support" command (not a slash command) - the same ticket system
// as /ticket, no ticket channels:
//   "!support"            - deletes the message and starts the DM flow (like /ticket)
//   "!support <request>"  - deletes the message and sends <request> (plus any files
//                           attached to that message) straight to the ticket channel
//   "!support config"     - just points to /settings (the old wizard is gone)
//
// Unlike a slash command, a text message CAN be deleted by the bot (needs the
// "Manage Messages" permission in that channel; without it the message simply stays).
//
// The bot ONLY processes messages from servers (message.guild present). DMs are
// handled in index.js (ticket-runtime.js / apply-runtime.js).
//
// Safeguard against double processing: each message ID is only handled once.

const storage = require('./storage');
const ticketRuntime = require('./ticket-runtime');
const applyRuntime = require('./apply-runtime');
const { sleep } = require('./util');

const PREFIX = process.env.PREFIX || '!';

const processedMessageIds = new Set();
function markProcessed(id) {
  processedMessageIds.add(id);
  if (processedMessageIds.size > 500) {
    const first = processedMessageIds.values().next().value;
    processedMessageIds.delete(first);
  }
}

// Short notice in the channel that removes itself again (nothing stays visible).
async function notice(message, text) {
  try {
    const sent = await message.channel.send({ content: `<@${message.author.id}> ${text}`, allowedMentions: { users: [message.author.id] } });
    await sleep(10000);
    await sent.delete().catch(() => {});
  } catch (err) {
    // no permission to post - nothing more we can do
  }
}

async function handleSupport(message, text) {
  const user = message.author;
  const guild = message.guild;
  const attachments = [...message.attachments.values()].map((a) => ({
    url: a.url,
    name: a.name,
    size: a.size,
    contentType: a.contentType,
    description: a.description,
  }));
  const content = message.content;

  // Take the command message away (Manage Messages needed; ignore failures).
  await message.delete().catch(() => {});

  if (!text && attachments.length === 0) {
    const result = await ticketRuntime.begin(user, guild);
    await notice(message, result.ok ? "📬 Check your DMs - I've asked you what you need help with." : `❌ ${result.error}`);
    return;
  }

  // Direct ticket: the whole request is in this one message.
  const setup = ticketRuntime.checkSetup(guild);
  if (!setup.ok) return void (await notice(message, `❌ ${setup.error}`));
  if (applyRuntime.hasSession(user.id)) return void (await notice(message, '❌ You are in the middle of an application. Finish it first, then open a ticket.'));
  if (ticketRuntime.hasSession(user.id)) return void (await notice(message, '❌ You already have an open ticket - check your DMs, or type `/ticket-close` to cancel it.'));

  const body = text ? content.slice(content.toLowerCase().indexOf('support') + 'support'.length).trim() : '';
  const result = await ticketRuntime.deliver(message.client, guild.id, user, { content: body, attachments });
  if (!result.ok) return void (await notice(message, `❌ ${result.error}`));

  // Confirmation by DM (fall back to a self-deleting note if DMs are closed).
  try {
    await user.send(ticketRuntime.TEXT.done);
  } catch (err) {
    await notice(message, ticketRuntime.TEXT.done);
  }
}

async function handleMessage(message) {
  if (message.author.bot) return;
  if (!message.guild) return; // DMs are handled in index.js
  if (!message.content.startsWith(PREFIX)) return;

  if (processedMessageIds.has(message.id)) return;
  markProcessed(message.id);

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = (args.shift() || '').toLowerCase();
  if (command !== 'support') return;

  const sub = (args[0] || '').toLowerCase();
  if (sub === 'config') {
    await message.reply('⚙️ The old setup wizard is gone. An administrator can now set the **Ticket channel** and **Ticket role** with `/settings` (pick them from the menu).');
    return;
  }

  await handleSupport(message, args.join(' ').trim());
}

module.exports = { handleMessage };
