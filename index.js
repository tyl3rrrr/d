// index.js
// Discord Bot - flache Struktur, kein Ordner-Scan.
//
// STATUS-HINWEIS ("lilaner Punkt") - v2 Fix:
// Die Vorversion setzte ZWEI Aktivitäten gleichzeitig (Watching + Streaming).
// Berichte/Community-Threads zu genau diesem Verhalten zeigen, dass Discord
// bei mehreren Aktivitäten nicht zuverlässig die lilane Streaming-Badge
// anzeigt - oft gewinnt die zuerst gesendete Aktivität, oder der Client
// zeigt gar keine Badge. Jetzt wird NUR EINE Aktivität vom Typ "Streaming"
// gesetzt (Name = Website-Text, damit die Website trotzdem sichtbar bleibt:
// "Streaming https://...").
//
// WICHTIG (von Discord selbst so vorgegeben, nicht änderbar): Die "url" MUSS
// zu twitch.tv oder youtube.com gehören und exakt wie eine echte URL
// aussehen (inkl. "https://www."), sonst wird die Badge nicht lila, sondern
// bleibt grün. Anpassbar über STREAM_URL in der .env.

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
const logging = require('./logging');
const { EPHEMERAL, errText } = require('./util');

// ---------------------------------------------------------------------------
// BUGFIX "unendliche/doppelte Nachrichten": Die wahrscheinlichste Ursache
// war, dass der Bot-PROZESS zweimal gleichzeitig lief (z.B. weil ein alter
// Prozess beim Neustart nicht beendet wurde). Discord schickt Nachrichten-
// und Interaktions-Events an JEDE aktive Verbindung mit demselben Token -
// bei zwei laufenden Prozessen wird deshalb jede Aktion zweimal ausgeführt
// (doppelte DMs, doppelte Support-Anfragen, etc.).
//
// Diese einfache Sperrdatei verhindert das: Beim Start wird geprüft, ob
// bereits ein anderer, noch laufender Prozess eine bot.lock-Datei hält.
// Falls ja, wird der Start abgebrochen und eine klare Fehlermeldung
// ausgegeben, statt dass zwei Instanzen gleichzeitig laufen.
// ---------------------------------------------------------------------------
const LOCK_FILE = path.join(__dirname, 'bot.lock');

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false; // Prozess existiert nicht (mehr)
  }
}

function acquireLock() {
  try {
    // 'wx' = exklusiv erstellen: schlägt ATOMAR fehl, wenn die Datei schon
    // existiert. Das verhindert die Race Condition der Vorversion, bei der
    // zwei Prozesse, die exakt gleichzeitig starten, beide den
    // existsSync()-Check bestehen könnten, bevor einer von ihnen schreibt.
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return; // Erfolgreich als einziger Prozess registriert.
  } catch (err) {
    if (err.code !== 'EEXIST') throw err; // unerwarteter Fehler -> weiterwerfen
  }

  // Datei existiert bereits - prüfen, ob der darin stehende Prozess noch lebt.
  const existingPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
  if (!Number.isNaN(existingPid) && isProcessAlive(existingPid)) {
    console.error(
      `❌ Der Bot läuft bereits in einem anderen Prozess auf DIESER Maschine (PID ${existingPid})!\n` +
        'Genau DAS verursacht doppelte/"unendliche" Nachrichten (Discord schickt Events an beide Prozesse).\n' +
        `Bitte beende den anderen Prozess (z.B. "kill ${existingPid}" oder den Task-Manager) und starte danach neu.\n` +
        `Falls du sicher bist, dass kein anderer Prozess läuft, lösche einfach die Datei "bot.lock" und starte erneut.\n\n` +
        `⚠️ WICHTIG: Diese Sperre schützt nur VOR DIESER MASCHINE. Läuft derselbe Bot-Token zusätzlich auf\n` +
        `einem anderen Server/Hosting-Dienst (Railway, Replit, VPS, ein zweiter Laptop, ...), erkennt diese\n` +
        `Sperre das NICHT - dort würde jede Aktion trotzdem doppelt ausgeführt. Bitte prüfen!`
    );
    process.exit(1);
  }

  // Verwaiste Lock-Datei (Prozess existiert nicht mehr) - überschreiben.
  fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch (err) {
    // Ignorieren - beim Herunterfahren nicht kritisch.
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
  console.error('Fehler: DISCORD_TOKEN fehlt in der .env Datei. Bot kann nicht starten.');
  process.exit(1);
}

// INTENTS:
// - Guilds: Grundvoraussetzung für Slash-Commands.
// - GuildMessages + MessageContent (PRIVILEGIERT): für den "!support"-Text-Befehl.
// - GuildMembers (PRIVILEGIERT): für das Welcome-System (Beitritt neuer Mitglieder).
// - AutoModerationExecution: Log-Meldungen, wenn Discords AutoMod eingreift.
// Beide privilegierten Intents müssen im Developer Portal unter "Bot" ->
// "Privileged Gateway Intents" aktiviert sein. Ist einer NICHT aktiviert, startet
// der Bot trotzdem: er versucht es automatisch ohne den fehlenden Intent und
// meldet laut in der Konsole, welche Funktion dadurch deaktiviert ist.
// DirectMessages wird bewusst NICHT angefordert (Bot verarbeitet keine DMs).
//
// RAM-Optimierung: begrenzte Caches + Sweeper (Ziel: zuverlässig unter 2GB).
const INTENT_PLANS = [
  { members: true, content: true, note: 'alle Intents' },
  { members: false, content: true, note: 'OHNE Server Members Intent (Welcome-System inaktiv)' },
  { members: false, content: false, note: 'OHNE Server Members + Message Content Intent (Welcome-System und !support inaktiv)' },
];

function createClient(plan) {
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.AutoModerationExecution];
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
    console.warn('Warnung: Ein Command-Modul ist ungültig (fehlt data oder execute) - wird übersprungen.');
    continue;
  }
  commands.set(command.data.name, command);
}

console.log('='.repeat(60));
console.log(`🚀 Bot-Prozess gestartet - PID: ${process.pid}`);
console.log(`📦 Node.js: ${process.version}`);
console.log(`${commands.size} Command(s) geladen: ${[...commands.keys()].join(', ')}`);
console.log('='.repeat(60));


// Jede Interaktions-ID nur EINMAL verarbeiten (zusätzlicher Schutz gegen doppelte Zustellung).
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
    console.log(`Eingeloggt als ${readyClient.user.tag} (${readyClient.guilds.cache.size} Server) - Modus: ${plan.note}`);
    await presence.apply(readyClient);
    // Presence im Automatikmodus regelmäßig, aber zurückhaltend aktualisieren (keine
    // unnötigen API-Anfragen bei jeder kleinen Änderung) - alle 10 Minuten reicht.
    setInterval(() => presence.apply(readyClient), 10 * 60 * 1000);
    xpRuntime.startBoardScheduler(readyClient);

    // Auto-Sync: sorgt dafür, dass bei Discord genau die Commands registriert sind,
    // die dieser Code kennt (Hauptursache von "Unknown Command"). AUTO_DEPLOY=false schaltet es ab.
    if (String(process.env.AUTO_DEPLOY || 'true').toLowerCase() !== 'false') {
      try {
        await commandTools.syncIfChanged(readyClient, commandList, (m) => console.log(m));
      } catch (err) {
        console.error('❌ Command-Sync fehlgeschlagen (führe "npm run deploy" manuell aus):', errText(err));
      }
    }

    // AutoMod-Regeln (Discord-API) auf allen Servern sicherstellen.
    automod.provisionAllGuilds(readyClient).catch((err) => console.warn('AutoMod-Provisionierung:', errText(err)));
  });

  client.on(Events.GuildCreate, (guild) => {
    automod.provisionGuild(client, guild).catch(() => {});
    presence.apply(client).catch(() => {}); // Serveranzahl hat sich geändert (im Automatikmodus)
  });

  client.on(Events.GuildDelete, () => {
    presence.apply(client).catch(() => {});
  });

  if (plan.members) client.on(Events.GuildMemberAdd, (member) => handleMemberAdd(member));

  client.on(Events.AutoModerationActionExecution, (execution) => automod.logExecution(execution));

  client.on(Events.InteractionCreate, async (interaction) => {
    if (processedInteractionIds.has(interaction.id)) {
      console.warn(`Doppelte Interaktion ignoriert: ${interaction.id}`);
      return;
    }
    markInteractionProcessed(interaction.id);

    try {
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) {
          console.warn(`Unbekannter Command aufgerufen: /${interaction.commandName} (Registrierung bei Discord veraltet? -> npm run deploy)`);
          await interaction.reply({ content: 'Unbekannter Befehl.', flags: EPHEMERAL }).catch(() => {});
          return;
        }
        // ZENTRALE Berechtigungsprüfung (permissions.js) - vor JEDEM Command.
        if (!(await permissions.guardInteraction(interaction, command))) return;
        await command.execute(interaction);
        return;
      }

      if (interaction.isButton()) {
        if (interaction.customId === OPEN_BUTTON_ID) return void (await handleOpenTicket(interaction));
        if (interaction.customId === CLOSE_BUTTON_ID) return void (await handleCloseTicket(interaction));
      }
    } catch (error) {
      console.error('Fehler beim Verarbeiten einer Interaktion:', error);
      if (interaction.guildId) logging.logError(client, interaction.guildId, error, `Interaktion /${interaction.commandName || '?'}`);
      const payload = { content: 'Beim Ausführen dieser Aktion ist ein Fehler aufgetreten.', flags: EPHEMERAL };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (plan.content) await legacySupport.handleMessage(message);
    } catch (error) {
      console.error('Fehler beim Verarbeiten einer Nachricht:', error);
    }
    // XP-Vergabe funktioniert unabhängig vom Message-Content-Intent (nutzt nur Länge/Autor).
    await xpRuntime.handleMessageXP(message);
  });

  client.on(Events.Error, (error) => console.error('Discord-Client-Fehler:', error));
}

process.on('unhandledRejection', (error) => {
  console.error('Unbehandelte Promise-Ablehnung:', error);
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
        '⚠️ Ein PRIVILEGIERTER Intent ist im Developer Portal nicht aktiviert.\n' +
          '   -> https://discord.com/developers/applications -> dein Bot -> "Bot" -> "Privileged Gateway Intents":\n' +
          '      "SERVER MEMBERS INTENT" und "MESSAGE CONTENT INTENT" einschalten und speichern.\n' +
          `   Ich versuche es jetzt: ${INTENT_PLANS[planIndex + 1].note}`
      );
      return start(planIndex + 1);
    }
    console.error('❌ Login fehlgeschlagen:', errText(err));
    process.exit(1);
  }
}

start();
