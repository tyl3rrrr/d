// index.js
// Discord bot - flat structure, no folder scanning.
//
// STATUS NOTE: presence (online status, activity, streaming) is managed in
// presence.js and controlled via /bot-status. By default the bot
// shows its current server count. Note: for the purple "Streaming" badge,
// Discord requires the URL to belong to twitch.tv or youtube.com and look like
// a real URL (incl. "https://www.").

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events, Collection, Options, Partials } = require('discord.js');

const config = require('./config'); // must stay first: loading it reads the .env file (dotenv) for every other module
const commandList = require('./commands');
const { OPEN_BUTTON_ID, CLOSE_BUTTON_ID, handleOpenTicket, handleCloseTicket } = require('./commands-tickets');
const legacySupport = require('./legacy-support');
const automod = require('./automod-api');
const commandTools = require('./command-tools');
const permissions = require('./permissions');
const { handleMemberAdd } = require('./commands-welcome');
const presence = require('./presence');
const github = require('./github');
const giveawayRuntime = require('./giveaway-runtime');
const reportRuntime = require('./report-runtime');
const partnerRuntime = require('./partner-runtime');
const rulesRuntime = require('./rules-runtime');
const menus = require('./menus');
const stats = require('./stats');
const botlog = require('./botlog');
const aiRuntime = require('./ai-runtime');
const applyRuntime = require('./apply-runtime');
const ticketRuntime = require('./ticket-runtime');
const settingsPanel = require('./commands-settings');
const macrumors = require('./macrumors');
const interactionGuard = require('./interaction-guard');
const { errText } = require('./util');

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
  // A lock that names OUR OWN pid (or our parent's) is a leftover from a previous run: in containers/hosts the
  // restarted bot often gets the same low PID again, which used to make the bot refuse to start at all
  // (-> every command: "The application did not respond").
  const isUs = existingPid === process.pid || existingPid === process.ppid;
  if (!Number.isNaN(existingPid) && !isUs && isProcessAlive(existingPid)) {
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

// custom-ID prefix -> handler. A NEW button/menu/form only needs one line here.
const COMPONENT_ROUTES = [
  { prefix: giveawayRuntime.JOIN_PREFIX, handle: giveawayRuntime.handleButton },
  { prefix: reportRuntime.PREFIX, handle: reportRuntime.handleButton },
  { prefix: partnerRuntime.PREFIX, handle: partnerRuntime.handleButton },
  { prefix: rulesRuntime.PREFIX, handle: (i) => (i.isModalSubmit() ? rulesRuntime.handleModal(i) : rulesRuntime.handleButton(i)) },
  { prefix: menus.HELP_PREFIX, handle: menus.handleComponent },
  { prefix: menus.CHANGELOG_PREFIX, handle: menus.handleComponent },
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
    // Needed so DMs are also received after a bot restart (ticket/application answers).
    partials: [Partials.Channel],
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
console.log(`🚀 Bot process started - v${require('./package.json').version} - PID: ${process.pid}`);
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
    macrumors.start(readyClient); // posts new MacRumors articles to the channels set with /config macrumors
    github.start(readyClient); // posts new GitHub releases to the channels set with /config github
    giveawayRuntime.start(readyClient); // automatic draw when a giveaway's time is up
    botlog.start(); // periodic cleanup of old bot-log entries

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
    botlog.log({ type: 'guild', guildId: guild.id, guildName: guild.name, text: `Joined server (owner ${guild.ownerId}, ${guild.memberCount ?? '?'} members).` });
  });

  client.on(Events.GuildDelete, (guild) => {
    presence.apply(client).catch(() => {});
    botlog.log({ type: 'guild', guildId: guild.id, guildName: guild.name, text: 'Removed from server.' });
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
          console.warn(
            `Unknown command invoked: /${interaction.commandName} - this command is registered at Discord but not in ` +
              `this running process's command list. This almost always means the bot's FILES were updated/deployed ` +
              `but the PROCESS itself was never restarted (editing files or running "npm run deploy" alone does NOT ` +
              `reload already-running code - only an actual process restart does, e.g. "npm start" again, or /adm-reload).`
          );
          stats.recordError();
          await interactionGuard.respond(
            interaction,
            '❌ Unknown command. If this command should exist, the bot process most likely needs a full restart ' +
              '(not just a redeploy) to pick up new code - ask the bot operator to restart it (e.g. `/adm-reload`).'
          );
          return;
        }
        stats.recordCommand(interaction.commandName); // real usage numbers for /stats
        // CENTRAL permission check (permissions.js) - before EVERY command.
        // interaction-guard.js adds the 3-second safety net (auto "thinking..." state for
        // slow commands) and turns errors into clear messages (never "did not respond").
        await interactionGuard.run(interaction, async () => {
          if (!(await permissions.guardInteraction(interaction, command))) return;
          botlog.log({
            type: 'command',
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            guildId: interaction.guildId,
            guildName: interaction.guild ? interaction.guild.name : null,
            channelId: interaction.channelId,
            text: botlog.commandText(interaction),
          });
          await command.execute(interaction);
        });
        return;
      }

      // /settings panel: menus, selectors and buttons all use custom IDs starting with "st:".
      if ((interaction.isAnySelectMenu() || interaction.isButton()) && interaction.customId.startsWith(settingsPanel.PREFIX)) {
        return void (await settingsPanel.handleComponent(interaction));
      }

      // Buttons, menus and forms of the newer systems (giveaways, reports, partners, rules, /help,
      // /changelog). Each runs inside the interaction guard like a slash command, so it can never end
      // in "This interaction failed" (auto-acknowledges after 1.5 s, readable errors).
      if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
        const route = COMPONENT_ROUTES.find((r) => interaction.customId.startsWith(r.prefix));
        if (route) return void (await interactionGuard.run(interaction, () => route.handle(interaction)));
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
      await interactionGuard.handleError(interaction, error);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    // DMs: message content is available regardless of the Message Content
    // Intent (that privileged intent only gates GUILD messages) - so an
    // active application interview always works, even under the most
    // restrictive intent plan.
    if (!message.guild) {
      botlog.log({
        type: 'dm',
        userId: message.author.id,
        userTag: message.author.tag,
        channelId: message.channelId,
        text: message.content || '',
        attachments: [...message.attachments.values()].map((a) => ({ name: a.name, url: a.url })),
      });
      try {
        // Ticket or an application interview? Only a user with one of those OPEN is handled that
        // way; every other DM falls through to the AI (see ai-runtime.js) - the bot replies
        // individually, like a normal chat.
        const isTicket = await ticketRuntime.handleDM(message);
        if (!isTicket) {
          const isApplication = await applyRuntime.handleDMAnswer(message);
          if (!isApplication) await aiRuntime.handleDM(message);
        }
      } catch (error) {
        console.error('Error while processing a DM:', error);
      }
      return;
    }

    try {
      if (plan.content) await legacySupport.handleMessage(message);
      const handledMention = await aiRuntime.handleMention(message, { hasContent: plan.content });
      if (!handledMention) return;
    } catch (error) {
      console.error('Error while processing a message:', error);
    }
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
