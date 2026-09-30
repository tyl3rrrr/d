// index.js
// Discord bot - flat structure, no folder scanning.
//
// STATUS NOTE: presence (online status, activity, streaming) is managed in
// presence.js and controlled via /bot-status and /bstatnow. By default the bot
// shows its current server count. Note: for the purple "Streaming" badge,
// Discord requires the URL to belong to twitch.tv or youtube.com and look like
// a real URL (incl. "https://www.").

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events, Collection, Options } = require('discord.js');

const config = require('./config');
const commandList = require('./commands');
const { OPEN_BUTTON_ID, CLOSE_BUTTON_ID, handleOpenTicket, handleCloseTicket } = require('./commands-tickets');
const legacySupport = require('./legacy-support');
const automod = require('./automod-api');
const commandTools = require('./command-tools');
const permissions = require('./permissions');
const { handleMemberAdd } = require('./commands-welcome');
const presence = require('./presence');
const xpRuntime = require('./xp-runtime');
const applyRuntime = require('./apply-runtime');
const youtube = require('./youtube');
const logging = require('./logging');
const { EPHEMERAL, errText } = require('./util');

// ---------------------------------------------------------------------------
// BUGFIX "infinite/duplicate messages": the most likely cause was that the bot
// PROCESS ran twice at the same time (e.g. because an old process wasn't
// terminated on restart). Discord sends message and interaction events to
// EVERY active connection with the same token - so with two running processes
// every action is executed twice (duplicate DMs, duplicate support requests,
// etc.).
//
// This simple lock file prevents that: on startup it checks whether another,
// still-running process already holds a bot.lock file. If so, startup is
// aborted with a clear error message instead of two instances running at once.
// ---------------------------------------------------------------------------
const LOCK_FILE = path.join(__dirname, 'bot.lock');

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false; // process does not (or no longer) exist
  }
}

function acquireLock() {
  try {
    // 'wx' = create exclusively: fails ATOMICALLY if the file already exists.
    // This avoids the race condition of the earlier version, where two
    // processes starting at exactly the same time could both pass the
    // existsSync() check before either of them wrote.
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return; // Successfully registered as the only process.
  } catch (err) {
    if (err.code !== 'EEXIST') throw err; // unexpected error -> rethrow
  }

  // File already exists - check whether the process named in it is still alive.
  const existingPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
  if (!Number.isNaN(existingPid) && isProcessAlive(existingPid)) {
    console.error(
      `❌ The bot is already running in another process on THIS machine (PID ${existingPid})!\n` +
        'That is exactly what causes duplicate/"infinite" messages (Discord sends events to both processes).\n' +
        `Please stop the other process (e.g. "kill ${existingPid}" or the task manager) and restart.\n` +
        'If you are sure no other process is running, simply delete the file "bot.lock" and start again.\n\n' +
        '⚠️ IMPORTANT: this lock only protects against duplicates on THIS machine. If the same bot token also runs on\n' +
        'another server/hosting service (Railway, Replit, a VPS, a second laptop, ...), this lock does NOT detect it -\n' +
        'every action would still be executed twice there. Please check!'
    );
    process.exit(1);
  }

  // Orphaned lock file (process no longer exists) - overwrite it.
  fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch (err) {
    // Ignore - not critical during shutdown.
  }
}

acquireLock();
process.on('exit', releaseLock);
process.on('SIGINT', () => {
  releaseLock();
  process.exit(0);
});
process.on('SIGTERM', () => {
  releaseLock();
  process.exit(0);
});

const { DISCORD_TOKEN } = process.env;

if (!DISCORD_TOKEN) {
  console.error('Error: DISCORD_TOKEN is missing from the .env file. The bot cannot start.');
  process.exit(1);
}

// INTENTS:
// - Guilds: basic requirement for slash commands.
// - GuildMessages + MessageContent (PRIVILEGED): for the "!support" text command.
// - GuildMembers (PRIVILEGED): for the welcome system (new members joining).
// - AutoModerationExecution: log messages when Discord's AutoMod acts.
// - DirectMessages: needed to RECEIVE the applicant's answers during an
//   application interview (see apply-runtime.js). This is NOT privileged and
//   needs no Developer Portal toggle. Message CONTENT in DMs is available
//   regardless of the (privileged) Message Content Intent - that one only
//   gates content in GUILD messages - so application interviews work under
//   every intent plan below.
// Both privileged intents must be enabled in the Developer Portal under "Bot" ->
// "Privileged Gateway Intents". If one is NOT enabled, the bot still starts: it
// automatically retries without the missing intent and reports loudly in the
// console which feature is disabled as a result.
//
// RAM optimization: limited caches + sweepers (goal: reliably under 2GB).
const INTENT_PLANS = [
  { members: true, content: true, note: 'all intents' },
  { members: false, content: true, note: 'WITHOUT Server Members Intent (welcome system inactive)' },
  { members: false, content: false, note: 'WITHOUT Server Members + Message Content Intent (welcome system and !support inactive)' },
];

function createClient(plan) {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.AutoModerationExecution,
  ];
  if (plan.content) intents.push(GatewayIntentBits.MessageContent);
  if (plan.members) intents.push(GatewayIntentBits.GuildMembers);

  return new Client({
    intents,
    makeCache: Options.cacheWithLimits({
      MessageManager: 50,
      ReactionManager: 0,
      PresenceManager: 0,
      GuildMemberManager: 200,
      ThreadManager: 25,
      GuildBanManager: 0,
      GuildInviteManager: 0,
      GuildScheduledEventManager: 0,
      StageInstanceManager: 0,
      VoiceStateManager: 0,
      ApplicationCommandManager: 0,
      AutoModerationRuleManager: 0,
    }),
    sweepers: {
      messages: { interval: 1800, lifetime: 900 },
      threads: { interval: 3600, lifetime: 3600 },
    },
  });
}

const commands = new Collection();
for (const command of commandList) {
  if (!command || !command.data || typeof command.execute !== 'function') {
    console.warn('Warning: a command module is invalid (missing data or execute) - skipping it.');
    continue;
  }
  commands.set(command.data.name, command);
}

console.log('='.repeat(60));
console.log(`🚀 Bot process started - PID: ${process.pid}`);
console.log(`📦 Node.js: ${process.version}`);
console.log(`${commands.size} command(s) loaded: ${[...commands.keys()].join(', ')}`);
console.log('='.repeat(60));

// Process each interaction ID only ONCE (extra protection against duplicate delivery).
const processedInteractionIds = new Set();
function markInteractionProcessed(id) {
  processedInteractionIds.add(id);
  if (processedInteractionIds.size > 1000) {
    processedInteractionIds.delete(processedInteractionIds.values().next().value);
  }
}

function wire(client, plan) {
  client.commands = commands;

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag} (${readyClient.guilds.cache.size} servers) - mode: ${plan.note}`);
    if (!plan.members) {
      console.error(
        '🚨 The WELCOME SYSTEM is INACTIVE: the "SERVER MEMBERS INTENT" is not enabled in the Developer Portal.\n' +
          '   Enable it at https://discord.com/developers/applications -> your app -> Bot -> Privileged Gateway Intents, then restart.'
      );
    }
    await presence.apply(readyClient);
    // Refresh presence in automatic mode regularly but sparingly (no needless
    // API calls on every small change) - every 10 minutes is enough.
    setInterval(() => presence.apply(readyClient), 10 * 60 * 1000);
    xpRuntime.startBoardScheduler(readyClient);
    youtube.startPoller(readyClient);

    // Auto-sync: makes sure Discord has exactly the commands this code knows
    // (the main cause of "Unknown Command"). AUTO_DEPLOY=false turns it off.
    if (String(process.env.AUTO_DEPLOY || 'true').toLowerCase() !== 'false') {
      try {
        await commandTools.syncIfChanged(readyClient, commandList, (m) => console.log(m));
      } catch (err) {
        console.error('❌ Command sync failed (run "npm run deploy" manually):', errText(err));
      }
    }

    // Make sure the AutoMod word-filter rule exists on all servers (Discord API).
    automod.provisionAllGuilds(readyClient).catch((err) => console.warn('AutoMod provisioning:', errText(err)));
  });

  client.on(Events.GuildCreate, (guild) => {
    automod.provisionGuild(client, guild).catch(() => {});
    presence.apply(client).catch(() => {}); // server count changed (in automatic mode)
  });

  client.on(Events.GuildDelete, () => {
    presence.apply(client).catch(() => {});
  });

  if (plan.members) client.on(Events.GuildMemberAdd, (member) => handleMemberAdd(member));

  client.on(Events.AutoModerationActionExecution, (execution) => automod.logExecution(execution));

  client.on(Events.InteractionCreate, async (interaction) => {
    if (processedInteractionIds.has(interaction.id)) {
      console.warn(`Duplicate interaction ignored: ${interaction.id}`);
      return;
    }
    markInteractionProcessed(interaction.id);

    try {
      if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (command && typeof command.autocomplete === 'function') {
          await command.autocomplete(interaction).catch((err) => console.warn(`Autocomplete error in /${interaction.commandName}:`, errText(err)));
        }
        return;
      }

      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) {
          console.warn(`Unknown command invoked: /${interaction.commandName} (registration at Discord out of date? -> npm run deploy)`);
          await interaction.reply({ content: 'Unknown command.', flags: EPHEMERAL }).catch(() => {});
          return;
        }
        // CENTRAL permission check (permissions.js) - before EVERY command.
        if (!(await permissions.guardInteraction(interaction, command))) return;
        await command.execute(interaction);
        return;
      }

      if (interaction.isButton()) {
        if (interaction.customId === OPEN_BUTTON_ID) return void (await handleOpenTicket(interaction));
        if (interaction.customId === CLOSE_BUTTON_ID) return void (await handleCloseTicket(interaction));
        if (interaction.customId.startsWith(applyRuntime.START_PREFIX)) {
          return void (await applyRuntime.handleApplyStart(interaction, interaction.customId.slice(applyRuntime.START_PREFIX.length)));
        }
        if (interaction.customId.startsWith(applyRuntime.ACCEPT_PREFIX)) {
          return void (await applyRuntime.handleReviewButton(interaction, true, interaction.customId.slice(applyRuntime.ACCEPT_PREFIX.length)));
        }
        if (interaction.customId.startsWith(applyRuntime.DENY_PREFIX)) {
          return void (await applyRuntime.handleReviewButton(interaction, false, interaction.customId.slice(applyRuntime.DENY_PREFIX.length)));
        }
      }
    } catch (error) {
      console.error('Error while processing an interaction:', error);
      if (interaction.guildId) logging.logError(client, interaction.guildId, error, `Interaction /${interaction.commandName || '?'}`);
      const payload = { content: 'An error occurred while running this action.', flags: EPHEMERAL };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    // DMs: message content is available regardless of the Message Content
    // Intent (that privileged intent only gates GUILD messages) - so an
    // active application interview always works, even under the most
    // restrictive intent plan.
    if (!message.guild) {
      try {
        await applyRuntime.handleDMAnswer(message);
      } catch (error) {
        console.error('Error while processing a DM application answer:', error);
      }
      return;
    }

    try {
      if (plan.content) await legacySupport.handleMessage(message);
    } catch (error) {
      console.error('Error while processing a message:', error);
    }
    // XP awarding works independently of the Message Content intent (only uses length/author).
    await xpRuntime.handleMessageXP(message);
  });

  client.on(Events.Error, (error) => console.error('Discord client error:', error));
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

function isDisallowedIntents(err) {
  return Boolean(err) && (err.code === 'DisallowedIntents' || /disallowed intents|privileged intent/i.test(err.message || ''));
}

async function start(planIndex = 0) {
  const plan = INTENT_PLANS[planIndex];
  const client = createClient(plan);
  wire(client, plan);
  try {
    await client.login(DISCORD_TOKEN);
  } catch (err) {
    await client.destroy().catch(() => {});
    if (isDisallowedIntents(err) && planIndex < INTENT_PLANS.length - 1) {
      console.error(
        '⚠️ A PRIVILEGED intent is not enabled in the Developer Portal.\n' +
          '   -> https://discord.com/developers/applications -> your bot -> "Bot" -> "Privileged Gateway Intents":\n' +
          '      enable "SERVER MEMBERS INTENT" and "MESSAGE CONTENT INTENT" and save.\n' +
          `   Retrying now: ${INTENT_PLANS[planIndex + 1].note}`
      );
      return start(planIndex + 1);
    }
    console.error('❌ Login failed:', errText(err));
    process.exit(1);
  }
}

start();
