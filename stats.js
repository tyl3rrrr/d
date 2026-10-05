// stats.js
// Real command-usage statistics for /stats - counted live, never made up.
//
//   total      - how many slash commands were run
//   perCommand - how often each command was run
//   hours      - 24 counters: how many commands were run in each hour of the day
//   errors     - how many commands/buttons ended in a real error
//
// Stored in data.json (meta.stats). Writes are batched (every few seconds and on
// exit) so a busy bot doesn't rewrite the file on every single command.
//
// Hour of day uses STATS_TIMEZONE from .env (default Europe/Berlin).

const storage = require('./storage');

const META_KEY = 'stats';
const SAVE_DELAY_MS = 5000;

function fresh() {
  return { since: Date.now(), total: 0, errors: 0, perCommand: {}, hours: new Array(24).fill(0) };
}

let stats = (() => {
  const saved = storage.getMeta(META_KEY);
  if (!saved || typeof saved !== 'object') return fresh();
  const base = fresh();
  return {
    since: Number(saved.since) || base.since,
    total: Number(saved.total) || 0,
    errors: Number(saved.errors) || 0,
    perCommand: saved.perCommand && typeof saved.perCommand === 'object' ? saved.perCommand : {},
    hours: Array.isArray(saved.hours) && saved.hours.length === 24 ? saved.hours.map((n) => Number(n) || 0) : base.hours,
  };
})();

let timer = null;
function scheduleSave() {
  if (timer) return;
  timer = setTimeout(flush, SAVE_DELAY_MS);
  if (timer.unref) timer.unref();
}

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  storage.setMeta(META_KEY, stats);
}
process.on('exit', () => {
  try {
    flush();
  } catch (err) {
    // nothing sensible left to do while exiting
  }
});

// Time zone handling: an invalid STATS_TIMEZONE must never break the bot.
function timeZone() {
  const tz = process.env.STATS_TIMEZONE || 'Europe/Berlin';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch (err) {
    return 'UTC';
  }
}

function currentHour() {
  try {
    const part = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: timeZone() })
      .formatToParts(new Date())
      .find((p) => p.type === 'hour');
    const h = Number(part && part.value);
    return Number.isInteger(h) && h >= 0 && h < 24 ? h : new Date().getUTCHours();
  } catch (err) {
    return new Date().getUTCHours();
  }
}

function recordCommand(name) {
  if (!name) return;
  stats.total += 1;
  stats.perCommand[name] = (stats.perCommand[name] || 0) + 1;
  stats.hours[currentHour()] += 1;
  scheduleSave();
}

function recordError() {
  stats.errors += 1;
  scheduleSave();
}

// Snapshot for /stats.
function summary() {
  const ranked = Object.entries(stats.perCommand).sort((a, b) => b[1] - a[1]);
  let bestHour = null;
  stats.hours.forEach((count, hour) => {
    if (count > 0 && (bestHour === null || count > stats.hours[bestHour])) bestHour = hour;
  });
  return {
    since: stats.since,
    total: stats.total,
    errors: stats.errors,
    top: ranked.slice(0, 5),
    mostUsed: ranked[0] || null,
    activeHour: bestHour === null ? null : { hour: bestHour, count: stats.hours[bestHour] },
    timeZone: timeZone(),
  };
}

module.exports = { recordCommand, recordError, summary, flush };
