// legacy-support.js
//
// Textbasierter "!support"-Befehl (kein Slash-Command).
// - "!support config": Admin/Manage-Guild-Mitglied wird per Nachricht nach
//   Rolle, Kanal UND Ticket-Kategorie gefragt (Wizard). Speichert dieselben
//   Einstellungen wie /settings (ticketStaffRoleId, logChannelId,
//   ticketCategoryId) - es gibt also nur EIN Einstellungs-Set, egal ob per
//   /settings oder per !support config konfiguriert wird.
// - "!support <Anliegen>": Erstellt ein privates Ticket-Kanal (wie der
//   "Create Ticket"-Button) MIT dem Anliegen als Inhalt, UND schickt genau
//   EINE Benachrichtigung in den eingestellten Log-Kanal (kein Spam mehr).
//
// Der Bot verarbeitet NUR Nachrichten aus Servern (message.guild vorhanden).
// DMs an den Bot werden nicht verarbeitet - zusätzlich zur fehlenden
// DirectMessages-Gateway-Intent in index.js (der Bot bekommt DM-Events
// dadurch gar nicht erst zugestellt).
//
// BUGFIX (doppelte/"unendliche" Nachrichten): Das eigentliche Problem war
// mit hoher Wahrscheinlichkeit, dass der Bot-PROZESS zweimal gleichzeitig
// lief (siehe Sperre in index.js) - jede eingehende Nachricht wurde dadurch
// zweimal verarbeitet. Als zusätzliche Absicherung wird hier trotzdem jede
// Nachrichten-ID nur einmal verarbeitet (Set mit automatischer Bereinigung).

const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const storage = require('./storage');
const { createTicketChannel } = require('./commands-tickets');

const PREFIX = process.env.PREFIX || '!';
const COLLECT_TIMEOUT_MS = 30000;

// Zusätzliche Absicherung gegen doppelte Verarbeitung derselben Nachricht.
const processedMessageIds = new Set();
function markProcessed(id) {
  processedMessageIds.add(id);
  if (processedMessageIds.size > 500) {
    // Älteste Einträge grob aufräumen, damit der Set nicht unbegrenzt wächst.
    const first = processedMessageIds.values().next().value;
    processedMessageIds.delete(first);
  }
}

async function handleConfig(message) {
  const member = message.member;
  if (!member || !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply('❌ Nur Mitglieder mit der Berechtigung "Server verwalten" dürfen das Support-System konfigurieren.');
    return;
  }

  await message.reply(
    '⚙️ Support-Einrichtung gestartet.\n' +
      'Bitte **erwähne die Rolle** (z.B. `@Support`), die bei neuen Tickets benachrichtigt werden soll, oder schreibe `keine`. (30 Sekunden Zeit)'
  );

  const roleCollected = await message.channel
    .awaitMessages({
      filter: (m) => m.author.id === message.author.id && (m.mentions.roles.size > 0 || /^keine$/i.test(m.content.trim())),
      max: 1,
      time: COLLECT_TIMEOUT_MS,
    })
    .catch(() => null);

  if (!roleCollected || roleCollected.size === 0) {
    await message.reply(`❌ Zeit abgelaufen oder keine gültige Antwort. Bitte \`${PREFIX}support config\` erneut ausführen.`);
    return;
  }
  const roleReply = roleCollected.first();
  const role = roleReply.mentions.roles.first() || null;

  await message.reply(
    '✅ Weiter.\nJetzt bitte **den Log-Kanal erwähnen** (z.B. `#support-log`), in dem neue Tickets angekündigt werden sollen, oder schreibe `keine`. (30 Sekunden Zeit)'
  );

  const channelCollected = await message.channel
    .awaitMessages({
      filter: (m) => m.author.id === message.author.id && (m.mentions.channels.size > 0 || /^keine$/i.test(m.content.trim())),
      max: 1,
      time: COLLECT_TIMEOUT_MS,
    })
    .catch(() => null);

  if (!channelCollected || channelCollected.size === 0) {
    await message.reply(`❌ Zeit abgelaufen oder keine gültige Antwort. Bitte \`${PREFIX}support config\` erneut ausführen.`);
    return;
  }
  const channelReply = channelCollected.first();
  const logChannel = channelReply.mentions.channels.first() || null;

  const existingSettings = storage.getGuildSettings(message.guild.id);
  let categoryId = existingSettings.ticketCategoryId || null;

  if (!categoryId) {
    await message.reply(
      '✅ Weiter.\nZuletzt: **Name der Kategorie**, in der Ticket-Kanäle erstellt werden sollen (z.B. `Tickets` - muss bereits existieren). (30 Sekunden Zeit)'
    );

    const categoryCollected = await message.channel
      .awaitMessages({
        filter: (m) => m.author.id === message.author.id,
        max: 1,
        time: COLLECT_TIMEOUT_MS,
      })
      .catch(() => null);

    if (!categoryCollected || categoryCollected.size === 0) {
      await message.reply(`❌ Zeit abgelaufen. Bitte \`${PREFIX}support config\` erneut ausführen.`);
      return;
    }

    const typed = categoryCollected.first().content.trim();
    const category =
      message.guild.channels.cache.get(typed) ||
      message.guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === typed.toLowerCase()
      );

    if (!category) {
      await message.reply(
        `❌ Konnte keine Kategorie namens "${typed}" finden. Bitte erstelle sie zuerst auf dem Server und führe \`${PREFIX}support config\` erneut aus.`
      );
      return;
    }
    categoryId = category.id;
  }

  storage.setGuildSetting(message.guild.id, 'ticketStaffRoleId', role ? role.id : null);
  storage.setGuildSetting(message.guild.id, 'logChannelId', logChannel ? logChannel.id : null);
  storage.setGuildSetting(message.guild.id, 'ticketCategoryId', categoryId);

  await message.reply(
    '✅ Support-System eingerichtet!\n' +
      `• Rolle: ${role ? `<@&${role.id}>` : 'keine'}\n` +
      `• Log-Kanal: ${logChannel ? `<#${logChannel.id}>` : 'keiner'}\n` +
      `• Ticket-Kategorie: <#${categoryId}>\n\n` +
      `Nutzer können jetzt mit \`${PREFIX}support <Anliegen>\` ein Ticket öffnen.`
  );
}

async function handleSupportRequest(message, text) {
  const result = await createTicketChannel(message.guild, message.author, text);

  if (!result.ok) {
    await message.reply(`❌ ${result.error}`);
    return;
  }

  if (result.existing) {
    await message.reply(`❗ Du hast bereits ein offenes Ticket: ${result.channel.toString()}`);
    return;
  }

  await message.reply(`✅ Dein Ticket wurde erstellt: ${result.channel.toString()}`);
}

async function handleMessage(message) {
  if (message.author.bot) return;
  if (!message.guild) return; // Keine DM-Verarbeitung (siehe Kommentar oben)
  if (!message.content.startsWith(PREFIX)) return;

  // Zusätzliche Absicherung gegen doppelte Verarbeitung (siehe Kommentar oben).
  if (processedMessageIds.has(message.id)) return;
  markProcessed(message.id);

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = (args.shift() || '').toLowerCase();
  if (command !== 'support') return;

  const sub = (args[0] || '').toLowerCase();

  if (sub === 'config') {
    args.shift();
    await handleConfig(message);
    return;
  }

  const text = args.join(' ').trim();
  if (!text) {
    await message.reply(`Bitte gib dein Anliegen an, z.B. \`${PREFIX}support Ich brauche Hilfe bei...\``);
    return;
  }
  await handleSupportRequest(message, text);
}

module.exports = { handleMessage };
