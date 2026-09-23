// util.js
// Kleine gemeinsame Helfer (flach, keine Abhängigkeiten außer discord.js).

const { MessageFlags } = require('discord.js');

// Ersetzt das veraltete `ephemeral: true` (wird in neueren discord.js-Versionen
// als deprecated gewarnt). Verwendung: interaction.reply({ content, flags: EPHEMERAL })
const EPHEMERAL = MessageFlags.Ephemeral;

function isMissingPermError(err) {
  return Boolean(err) && (err.code === 50013 || err.code === '50013');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Kürzt Text auf eine Maximallänge (mit "…").
function truncate(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

// Teilt Zeilen so in Blöcke auf, dass jeder Block <= maxLen Zeichen hat
// (für Embed-Felder, die max. 1024 Zeichen erlauben).
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

// Kurzer, für Nutzer lesbarer Fehlertext (ohne interne Details/Stacktraces).
function errText(err) {
  if (!err) return 'Unbekannter Fehler';
  return truncate(err.message || String(err), 300);
}

module.exports = { EPHEMERAL, isMissingPermError, sleep, truncate, splitLines, errText };
