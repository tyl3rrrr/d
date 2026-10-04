// interaction-guard.js
// Makes sure a command can never end with Discord's "The application did not
// respond" or a generic "An error occurred" message.
//
// WHY "did not respond" happens: Discord wants a first answer within 3 SECONDS.
// Several commands do slow work BEFORE they reply (kick/ban/timeout/warn send a
// DM and call the API first, /clear deletes messages, /lock edits permissions,
// ...). If that takes longer than 3 seconds the interaction expires, the later
// reply fails with "Unknown interaction" and the user sees "did not respond".
//
// What this file does for every slash command (see run()):
//   1. SAFETY NET: if the command has not answered after 1.5 s, the bot answers
//      for it with a "thinking..." state (an ephemeral defer). The command then
//      keeps working normally - its later reply() is turned into editReply()
//      automatically:
//        - private reply  -> replaces the "thinking..." message
//        - public reply   -> "thinking..." becomes a short private "Done" and the
//                            real answer is posted publicly right below it
//      Commands that answer within 1.5 s behave exactly as before.
//   2. EXPIRED / DOUBLE-ANSWERED interactions (Discord codes 10062 / 40060, or
//      discord.js "already replied") are logged quietly and never shown to the
//      user. A line in the console tells you which command it was - if you see
//      these often for EVERY command, the same bot token is most likely running
//      twice (e.g. on a host AND on your PC): both copies receive each command
//      and one of them always answers too late.
//   3. REAL ERRORS get a clear, specific message ("I'm missing a permission...")
//      instead of a generic one, are logged in the console, and (on servers) in
//      the log channel.

const { EPHEMERAL, errText } = require('./util');
const logging = require('./logging');

const AUTO_DEFER_MS = 1500;
const EPH_BIT = Number(EPHEMERAL); // 64
const STALE_CODES = new Set([10062, 40060, 10015]); // Unknown interaction / already acknowledged / Unknown webhook

function codeOf(err) {
  if (!err) return null;
  const c = err.code ?? (err.rawError && err.rawError.code);
  return typeof c === 'string' && /^\d+$/.test(c) ? Number(c) : c;
}

// The interaction is gone or was already answered - nothing useful left to tell the user.
function isStale(err) {
  const c = codeOf(err);
  return STALE_CODES.has(c) || c === 'InteractionAlreadyReplied' || c === 'InteractionNotReplied';
}

// A specific, readable explanation for the most common Discord errors.
function explain(err) {
  switch (codeOf(err)) {
    case 50013:
      return "I'm missing a permission for that. Please check my role and permissions on this server (or in this channel).";
    case 50001:
      return "I don't have access to that channel or server. Please check my permissions there.";
    case 50007:
      return "I couldn't send that person a DM (their DMs are closed).";
    case 10003:
      return 'That channel no longer exists.';
    case 10008:
      return 'That message no longer exists.';
    case 10011:
      return 'That role no longer exists.';
    case 10007:
    case 10013:
      return 'That member/user could not be found.';
    case 50035:
      return `Discord rejected that input: ${errText(err)}`;
    default:
  }
  if (err && (err.status === 429 || err.httpStatus === 429)) return 'Discord is rate-limiting me right now - please try again in a few seconds.';
  return `That didn't work: ${errText(err)}`;
}

function flagsValue(f) {
  if (typeof f === 'number') return f;
  if (typeof f === 'bigint') return Number(f);
  if (Array.isArray(f)) return f.reduce((a, x) => a | (typeof x === 'number' ? x : 0), 0);
  if (f && typeof f.bitfield === 'number') return f.bitfield;
  return 0;
}

// Sends `content` as privately as the interaction's current state allows. Never throws.
async function respond(interaction, content) {
  const raw = interaction.__raw || interaction;
  try {
    if (interaction.__ctx && interaction.__ctx.deferPromise) await interaction.__ctx.deferPromise;
    if (interaction.deferred && !interaction.replied) await raw.editReply({ content });
    else if (interaction.replied || interaction.deferred) await raw.followUp({ content, flags: EPH_BIT });
    else await raw.reply({ content, flags: EPH_BIT });
  } catch (err) {
    if (!isStale(err)) console.warn('Could not send an error message to the user:', errText(err));
  }
}

// Central error handling for an interaction (also used for buttons/menus by index.js).
async function handleError(interaction, err) {
  const label = interaction.commandName ? `/${interaction.commandName}` : interaction.customId || 'interaction';
  if (isStale(err)) {
    console.warn(
      `Interaction ${label} expired or was already answered (${errText(err)}). ` +
        'If this happens for every command, the same bot token is probably running twice (host + your PC) - stop the extra copy.'
    );
    return;
  }
  console.error(`Error in ${label}:`, err);
  if (interaction.guildId) {
    try {
      logging.logError(interaction.client, interaction.guildId, err, `Interaction ${label}`);
    } catch (e) {
      // logging must never make things worse
    }
  }
  await respond(interaction, `❌ ${explain(err)}`);
}

// Wraps the answering methods of one interaction (see header). Returns its context.
function wrap(interaction) {
  const ctx = { acked: false, auto: false, deferPromise: null, usedReply: false };
  const orig = {};
  for (const m of ['reply', 'deferReply', 'editReply', 'followUp', 'deleteReply', 'deferUpdate', 'update', 'showModal']) {
    if (typeof interaction[m] === 'function') orig[m] = interaction[m].bind(interaction);
  }
  interaction.__raw = orig;
  interaction.__ctx = ctx;
  const waitAuto = async () => {
    if (ctx.deferPromise) await ctx.deferPromise;
  };

  if (orig.deferReply) {
    interaction.deferReply = (o) => {
      if (ctx.auto) return waitAuto(); // already deferred by the safety net
      ctx.acked = true;
      return orig.deferReply(o);
    };
  }
  for (const m of ['deferUpdate', 'update', 'showModal']) {
    if (orig[m]) {
      interaction[m] = (...a) => {
        ctx.acked = true;
        return orig[m](...a);
      };
    }
  }
  for (const m of ['editReply', 'followUp', 'deleteReply']) {
    if (orig[m]) {
      interaction[m] = async (...a) => {
        await waitAuto();
        return orig[m](...a);
      };
    }
  }
  if (orig.reply) {
    interaction.reply = async (opts) => {
      if (!ctx.auto) {
        ctx.acked = true;
        return orig.reply(opts);
      }
      // The safety net already deferred -> answer through editReply/followUp.
      await waitAuto();
      const o = typeof opts === 'string' ? { content: opts } : { ...(opts || {}) };
      const flags = flagsValue(o.flags);
      const wantsPrivate = o.ephemeral === true || (flags & EPH_BIT) !== 0;
      const rest = flags & ~EPH_BIT;
      delete o.ephemeral;
      delete o.fetchReply;
      delete o.flags;

      if (ctx.usedReply) return orig.followUp({ ...o, flags: wantsPrivate ? rest | EPH_BIT : rest || undefined });
      ctx.usedReply = true;
      if (wantsPrivate) return orig.editReply(o);
      await orig.editReply({ content: '✅ Done.' });
      return orig.followUp({ ...o, flags: rest || undefined });
    };
  }
  return ctx;
}

// Runs a slash command (or any async function) with the safety net and error handling.
async function run(interaction, fn) {
  const ctx = wrap(interaction);
  const timer = setTimeout(() => {
    if (ctx.acked || interaction.deferred || interaction.replied) return;
    ctx.acked = true;
    ctx.auto = true;
    ctx.deferPromise = interaction.__raw.deferReply({ flags: EPH_BIT }).catch((err) => {
      if (!isStale(err)) console.warn('Auto-defer failed:', errText(err));
    });
  }, AUTO_DEFER_MS);
  try {
    await fn();
  } catch (err) {
    await handleError(interaction, err);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { run, handleError, respond, explain, isStale, AUTO_DEFER_MS };
