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

// Splits lines into blocks so each block is <= maxLen characters (for embed
// fields, which allow at most 1024 characters).
function splitLines(lines, maxLen = 1000) {
  const blocks = [];
  let current = '';
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLen && current) {
      blocks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

// Short, user-readable error text (no internal details/stack traces).
function errText(err) {
  if (!err) return 'Unknown error';
  return truncate(err.message || String(err), 300);
}

module.exports = { EPHEMERAL, isMissingPermError, sleep, truncate, splitLines, errText };
