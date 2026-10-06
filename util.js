// util.js
// Small shared helpers (flat, no dependencies besides discord.js).

const { MessageFlags } = require('discord.js');

// Replaces the deprecated `ephemeral: true` (newer discord.js versions warn
// about it). Usage: interaction.reply({ content, flags: EPHEMERAL })
const EPHEMERAL = MessageFlags.Ephemeral;

function isMissingPermError(err) {
  return Boolean(err) && (err.code === 50013 || err.code === '50013');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Truncates text to a maximum length (with "…").
function truncate(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

// Short, user-readable error text (no internal details/stack traces).
function errText(err) {
  if (!err) return 'Unknown error';
  return truncate(err.message || String(err), 300);
}

// Replaces secrets (tokens, API keys ...) in a text with "[hidden]". Used for everything that is
// stored in the bot log or shown in the owner tools, so a key can never leak through them.
const SECRET_ENV_NAME = /(TOKEN|KEY|SECRET|PASSWORD)/i;
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/g, // OpenAI-style keys
  /[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}/g, // Discord bot tokens
];
function redactSecrets(text) {
  let out = String(text ?? '');
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= 8 && SECRET_ENV_NAME.test(name)) out = out.split(value).join('[hidden]');
  }
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[hidden]');
  return out;
}

// Splits a long text into pieces of at most `max` characters (Discord allows 2000 per message),
// preferably at line breaks or spaces.
function chunkText(text, max = 1900) {
  const chunks = [];
  let rest = String(text ?? '').trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.length ? chunks : [''];
}

module.exports = { EPHEMERAL, isMissingPermError, sleep, truncate, errText, redactSecrets, chunkText };
