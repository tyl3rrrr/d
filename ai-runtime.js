// ai-runtime.js
// Discord side of the AI features:
//   - @Bot in a server channel   -> the bot answers (as a reply, never pinging anybody)
//   - a DM to the bot            -> the bot answers individually (own conversation memory per person)
// DMs that belong to a ticket or a staff application are handled BEFORE this (see index.js) and
// never reach the AI. Everything the AI does is written to the bot log (type "ai").
// First DM answer per person carries a short privacy note.

const ai = require('./ai');
const storage = require('./storage');
const permissions = require('./permissions');
const botlog = require('./botlog');
const { chunkText } = require('./util');

const NOTICE_KEY = 'dmNoticed';
const PRIVACY_NOTE = '\n\n-# ℹ️ Messages sent to this bot may be stored for safety and abuse prevention. See `/privacy-policy`.';

function aiEnabledIn(guildId) {
  if (!guildId) return true;
  return storage.getGuildSettings(guildId).aiEnabled !== false; // on by default, /config ai turns it off
}

// Text mention only ("@Bot hello"); replies to the bot's messages and @everyone do not count.
// message.mentions is populated by discord.js regardless of the Message Content Intent, so the
// bot can tell IT WAS mentioned even without that privileged intent; reading the actual question
// after the mention still needs the intent (checked in handleMention below).
function mentionRegex(botId) {
  return new RegExp(`<@!?${botId}>`, 'g');
}
function isMentioned(message, botId) {
  if (!botId) return false;
  if (message.mentions && message.mentions.users) return message.mentions.users.has(botId);
  return mentionRegex(botId).test(String(message.content || ''));
}

async function send(message, text, { dm }) {
  const chunks = chunkText(text, 1900);
  for (let i = 0; i < chunks.length; i++) {
    if (dm || i > 0) await message.channel.send({ content: chunks[i], allowedMentions: { parse: [] } });
    else await message.reply({ content: chunks[i], allowedMentions: { parse: [], repliedUser: false } });
  }
}

async function respond(message, { scope, place, prompt }) {
  const user = message.author;
  try {
    if (message.channel && typeof message.channel.sendTyping === 'function') await message.channel.sendTyping().catch(() => {});
  } catch (err) {
    // typing indicator is optional
  }

  const res = await ai.ask({
    scope,
    userId: user.id,
    userName: user.globalName || user.username,
    text: prompt,
    place,
    botName: message.client.user && message.client.user.username,
    isOwner: permissions.isBotOwner(user.id),
  });

  let text = res.ok ? res.text : `⚠️ ${res.reason}`;
  botlog.log({
    type: 'ai',
    userId: user.id,
    userTag: user.tag,
    guildId: message.guild ? message.guild.id : null,
    guildName: message.guild ? message.guild.name : null,
    channelId: message.channelId || (message.channel && message.channel.id),
    text: `Q: ${prompt}\nA: ${res.ok ? res.text : `(no answer: ${res.reason})`}`,
  });

  // Privacy note once per person, in DMs only.
  if (res.ok && place === 'dm') {
    const noticed = storage.getMeta(NOTICE_KEY) || {};
    if (!noticed[user.id]) {
      storage.setMeta(NOTICE_KEY, { ...noticed, [user.id]: Date.now() });
      text += PRIVACY_NOTE;
    }
  }
  await send(message, text, { dm: place === 'dm' });
}

// Returns true when the DM was answered by the AI.
async function handleDM(message) {
  if (!ai.isConfigured()) return false; // not set up -> stay silent
  const text = String(message.content || '').trim();
  if (!text || text.startsWith('/')) return false;
  await respond(message, { scope: 'dm', place: 'dm', prompt: text });
  return true;
}

// Returns true when the message mentioned the bot and was handled.
async function handleMention(message, { hasContent }) {
  const botId = message.client.user && message.client.user.id;
  if (!message.guild || !isMentioned(message, botId)) return false;
  if (!ai.isConfigured() || !aiEnabledIn(message.guild.id)) return false;

  if (!hasContent) {
    // Without the Message Content Intent we can see that we were mentioned, but not what was asked.
    await message.reply({ content: "👋 Hi! I can't read message text in this server yet - use `/ask` instead.", allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
    return true;
  }

  const prompt = String(message.content || '').replace(mentionRegex(botId), '').trim();
  if (prompt.startsWith(process.env.PREFIX || '!')) return false; // "!support" etc. belong to the text commands
  if (!prompt) {
    await message.reply({ content: '👋 Hi! Mention me with a question, or use `/ask`.', allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
    return true;
  }
  await respond(message, { scope: `ch${message.channelId || message.channel.id}`, place: 'guild', prompt });
  return true;
}

module.exports = { handleDM, handleMention, isMentioned, aiEnabledIn, PRIVACY_NOTE };
