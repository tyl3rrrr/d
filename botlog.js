// botlog.js
// The bot's own activity log - for the BOT OWNER ONLY (shown with /config bot logs).
// Its purpose is abuse prevention: you can see which DMs the bot received (from whom, with what
// content), which commands were used where, errors, server joins/leaves, AI chats and every use of
// the owner tools - so the bot is not misused for anything illegal.
//
// - Stored as JSON lines in botlogs.jsonl (next to index.js, readable only by the bot's user).
// - Secrets (tokens, API keys) are removed from everything before it is written.
// - Entries older than BOTLOG_RETENTION_DAYS (default 30) are deleted automatically (checked on start
//   and every 6 hours); the file never keeps more than 20,000 entries.
// - Only what the bot itself receives is logged: DMs sent TO the bot, commands, ... - never
//   conversations between other people (a bot cannot see those anyway).
// - All writes go through one queue, so parallel events can never corrupt the file.
// IMPORTANT: logging DMs/commands must be mentioned in your Privacy Policy.

const fs = require('fs');
const path = require('path');
const { truncate, redactSecrets, errText } = require('./util');

const FILE = process.env.BOTLOG_FILE || path.join(__dirname, 'botlogs.jsonl');
const MAX_LINES = 20000;
const MAX_TEXT = 2000;
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;

const TYPES = ['dm', 'command', 'error', 'guild', 'ai', 'audit'];

let queue = Promise.resolve();
function enqueue(task) {
  queue = queue.then(task).catch((err) => console.warn('Bot log: write failed:', errText(err)));
  return queue;
}

function retentionDays() {
  const n = Number(process.env.BOTLOG_RETENTION_DAYS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
}

// Never throws - logging must not be able to break the bot.
function log(entry) {
  try {
    const e = {
      t: Date.now(),
      type: TYPES.includes(entry.type) ? entry.type : 'audit',
      userId: entry.userId ? String(entry.userId) : null,
      userTag: entry.userTag ? truncate(redactSecrets(entry.userTag), 80) : null,
      guildId: entry.guildId ? String(entry.guildId) : null,
      guildName: entry.guildName ? truncate(redactSecrets(entry.guildName), 100) : null,
      channelId: entry.channelId ? String(entry.channelId) : null,
      text: truncate(redactSecrets(entry.text || ''), MAX_TEXT),
    };
    if (Array.isArray(entry.attachments) && entry.attachments.length) {
      e.attachments = entry.attachments.slice(0, 5).map((a) => ({ name: truncate(redactSecrets(a.name || 'file'), 100), url: truncate(redactSecrets(a.url || ''), 300) }));
    }
    return enqueue(() => fs.promises.appendFile(FILE, `${JSON.stringify(e)}\n`, { mode: 0o600 }));
  } catch (err) {
    console.warn('Bot log: could not create an entry:', errText(err));
    return Promise.resolve();
  }
}

async function readAll() {
  await queue; // wait for pending writes
  let raw;
  try {
    raw = await fs.promises.readFile(FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch (err) {
      // a damaged line is skipped
    }
  }
  return out;
}

// Newest first. Returns { total, entries } (entries limited to `limit`).
async function query({ type = 'all', userId = null, search = '', limit = 10 } = {}) {
  const all = await readAll();
  const needle = String(search || '').toLowerCase();
  const matches = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const e = all[i];
    if (type !== 'all' && e.type !== type) continue;
    if (userId && e.userId !== userId) continue;
    if (needle && !`${e.text} ${e.userTag || ''} ${e.guildName || ''}`.toLowerCase().includes(needle)) continue;
    matches.push(e);
  }
  return { total: matches.length, entries: matches.slice(0, limit) };
}

async function counts() {
  const all = await readAll();
  const byType = {};
  for (const e of all) byType[e.type] = (byType[e.type] || 0) + 1;
  return { total: all.length, byType };
}

function prune() {
  return enqueue(async () => {
    let raw;
    try {
      raw = await fs.promises.readFile(FILE, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    const limit = Date.now() - retentionDays() * 86400000;
    const kept = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        if (JSON.parse(line).t >= limit) kept.push(line);
      } catch (err) {
        // drop damaged lines
      }
    }
    const trimmed = kept.slice(-MAX_LINES);
    await fs.promises.writeFile(FILE, trimmed.length ? `${trimmed.join('\n')}\n` : '', { mode: 0o600 });
  });
}

function start() {
  prune();
  const timer = setInterval(prune, PRUNE_EVERY_MS);
  if (timer.unref) timer.unref();
}

// "/giveaway create prize:Nitro winners:2" - readable text for a slash command call.
function commandText(interaction) {
  const flatten = (options) =>
    (options || [])
      .map((o) => {
        if (o.type === 1 || o.type === 2) return `${o.name} ${flatten(o.options)}`.trim();
        const v = o.value !== undefined ? o.value : o.attachment ? o.attachment.name : '';
        return `${o.name}:${truncate(String(v), 200)}`;
      })
      .join(' ');
  const data = interaction.options && interaction.options.data;
  return `/${interaction.commandName} ${flatten(data)}`.trim();
}

module.exports = { FILE, TYPES, log, query, counts, prune, start, commandText, idle: () => queue, retentionDays };
