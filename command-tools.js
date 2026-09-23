// command-tools.js
//
// Alles rund um die Registrierung der Slash-Commands bei Discord - gemeinsam
// genutzt von `npm run deploy` (deploy-commands.js) UND vom Auto-Sync beim
// Bot-Start (index.js). Dadurch gibt es genau EINE Wahrheit darüber, was bei
// Discord registriert ist - der Hauptgrund für "Unknown Command" war, dass der
// laufende Bot-Code und die bei Discord registrierte Command-Liste
// auseinanderliefen.

const crypto = require('crypto');
const { Routes } = require('discord.js');
const storage = require('./storage');

// Discord: Installationsarten / Kontexte (siehe Application Commands Doku)
const INTEGRATION_GUILD_INSTALL = 0; // Bot ist auf einem Server installiert
const INTEGRATION_USER_INSTALL = 1; // Nutzer hat den Bot in SEINEN Account installiert
const CONTEXT_GUILD = 0; // in Servern
const CONTEXT_BOT_DM = 1; // in DMs mit dem Bot
const CONTEXT_PRIVATE_CHANNEL = 2; // in Gruppen-DMs / DMs mit anderen Nutzern

const NAME_REGEX = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

// Baut die JSON-Payload für Discord.
// scope 'global': mit integration_types/contexts (User-Install-fähig)
// scope 'guild' : ohne diese Felder (Guild-Commands kennen sie nicht)
function buildPayload(commandList, { scope = 'global' } = {}) {
  const payload = [];
  for (const cmd of commandList) {
    if (!cmd || !cmd.data) continue;
    const json = cmd.data.toJSON();

    // Zugriff wird zentral in permissions.js geprüft, nicht über Discords
    // Standard-Berechtigungen (die würden Rollen-basierte Mod-/Admin-Rechte
    // für Nutzer ohne die entsprechende Discord-Berechtigung verstecken).
    json.default_member_permissions = null;
    delete json.dm_permission; // veraltet - ersetzt durch contexts

    if (scope === 'global') {
      if (cmd.scope === 'guild') {
        json.integration_types = [INTEGRATION_GUILD_INSTALL];
        json.contexts = [CONTEXT_GUILD];
      } else {
        json.integration_types = [INTEGRATION_GUILD_INSTALL, INTEGRATION_USER_INSTALL];
        json.contexts = [CONTEXT_GUILD, CONTEXT_BOT_DM, CONTEXT_PRIVATE_CHANNEL];
      }
    } else {
      delete json.integration_types;
      delete json.contexts;
    }
    payload.push(json);
  }
  return payload;
}

// Prüft die Payload auf alles, was Discord ablehnen würde - VOR dem Senden.
// So bricht `npm run deploy` nicht mit einer kryptischen API-Fehlermeldung ab,
// sondern nennt exakt Command und Problem.
function validatePayload(payload) {
  const errors = [];
  const names = new Set();

  if (payload.length > 100) errors.push(`Zu viele globale Commands: ${payload.length} (Maximum 100).`);

  const checkName = (label, name) => {
    if (typeof name !== 'string' || !NAME_REGEX.test(name)) errors.push(`${label}: ungültiger Name "${name}".`);
    else if (name !== name.toLowerCase()) errors.push(`${label}: Name "${name}" muss komplett kleingeschrieben sein.`);
  };
  const checkDesc = (label, desc) => {
    if (typeof desc !== 'string' || desc.length < 1 || desc.length > 100) {
      errors.push(`${label}: Beschreibung muss 1-100 Zeichen lang sein (ist ${desc ? desc.length : 0}).`);
    }
  };

  const checkOptions = (label, options, allowSub) => {
    if (!options) return;
    if (options.length > 25) errors.push(`${label}: mehr als 25 Optionen.`);
    const hasSub = options.some((o) => o.type === 1 || o.type === 2);
    const hasNonSub = options.some((o) => o.type !== 1 && o.type !== 2);
    if (hasSub && hasNonSub) errors.push(`${label}: Subcommands dürfen nicht mit normalen Optionen gemischt werden.`);
    if (hasSub && !allowSub) errors.push(`${label}: Subcommands sind hier nicht erlaubt (zu tiefe Verschachtelung).`);

    const seen = new Set();
    let optionalSeen = false;
    for (const opt of options) {
      const l = `${label} > ${opt.name}`;
      checkName(l, opt.name);
      checkDesc(l, opt.description);
      if (seen.has(opt.name)) errors.push(`${l}: doppelter Optionsname.`);
      seen.add(opt.name);
      if (opt.type === 1) {
        checkOptions(l, opt.options, false);
      } else if (opt.type === 2) {
        checkOptions(l, opt.options, true);
      } else {
        if (opt.required) {
          if (optionalSeen) errors.push(`${l}: Pflicht-Option steht nach einer optionalen Option (Discord verlangt Pflicht zuerst).`);
        } else {
          optionalSeen = true;
        }
        if (opt.choices && opt.choices.length > 25) errors.push(`${l}: mehr als 25 Auswahlmöglichkeiten.`);
      }
    }
  };

  for (const cmd of payload) {
    const label = `/${cmd.name}`;
    checkName(label, cmd.name);
    if (names.has(cmd.name)) errors.push(`${label}: doppelt vorhanden (jeder Command darf nur EINMAL registriert werden).`);
    names.add(cmd.name);
    if ((cmd.type ?? 1) === 1) checkDesc(label, cmd.description);
    checkOptions(label, cmd.options, true);
  }
  return errors;
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function getApplicationId(rest) {
  const app = await rest.get(Routes.oauth2CurrentApplication());
  return app.id;
}

// Löscht Guild-Commands, die aus früheren Deploys (z.B. mit GUILD_ID) übrig sind.
// Sie würden neben den globalen Commands DOPPELT angezeigt werden bzw. veraltete
// Stände zeigen. Rückgabe: Anzahl bereinigter Server.
async function clearStaleGuildCommands(rest, appId, extraGuildIds = [], log = () => {}) {
  const guildIds = new Set(extraGuildIds.filter(Boolean));
  try {
    const guilds = await rest.get(Routes.userGuilds(), { query: new URLSearchParams({ limit: '200' }) });
    for (const g of guilds) guildIds.add(g.id);
  } catch (err) {
    log(`Hinweis: Server-Liste konnte nicht geladen werden (${err.message}) - prüfe nur die bekannten Server.`);
  }

  let cleaned = 0;
  for (const guildId of guildIds) {
    try {
      const existing = await rest.get(Routes.applicationGuildCommands(appId, guildId));
      if (Array.isArray(existing) && existing.length > 0) {
        await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] });
        cleaned++;
        log(`Veraltete Server-Commands auf ${guildId} entfernt (${existing.length}).`);
      }
    } catch (err) {
      // 403/404 = Bot hat auf diesem Server keinen Command-Zugriff (z.B. nur User-Install) - unkritisch.
      if (![403, 404, 50001].includes(err.status) && err.code !== 50001) {
        log(`Hinweis: Server ${guildId} konnte nicht geprüft werden (${err.message}).`);
      }
    }
  }
  return cleaned;
}

// Registriert ALLE Commands global (PUT ersetzt die komplette Liste - dadurch
// verschwinden veraltete Commands automatisch bei Discord).
async function registerGlobal(rest, appId, payload) {
  return rest.put(Routes.applicationCommands(appId), { body: payload });
}

async function registerGuild(rest, appId, guildId, payload) {
  return rest.put(Routes.applicationGuildCommands(appId, guildId), { body: payload });
}

// Auto-Sync beim Bot-Start: registriert nur, wenn sich etwas geändert hat
// (anderer Hash ODER Command-Namen bei Discord weichen ab). Schont damit das
// Discord-Limit für Command-Registrierungen.
async function syncIfChanged(client, commandList, log = console.log) {
  const payload = buildPayload(commandList, { scope: 'global' });
  const errors = validatePayload(payload);
  if (errors.length > 0) {
    log(`❌ Command-Sync abgebrochen - ungültige Commands:\n  - ${errors.join('\n  - ')}`);
    return { changed: false, error: true };
  }

  const appId = client.application.id;
  const hash = hashPayload(payload);
  const remote = await client.rest.get(Routes.applicationCommands(appId));
  const remoteNames = new Set(remote.map((c) => c.name));
  const localNames = new Set(payload.map((c) => c.name));

  const missing = [...localNames].filter((n) => !remoteNames.has(n));
  const stale = [...remoteNames].filter((n) => !localNames.has(n));
  const hashChanged = storage.getMeta('commandHash') !== hash;

  if (!hashChanged && missing.length === 0 && stale.length === 0) {
    log(`✅ Slash-Commands sind synchron (${payload.length} Commands bei Discord registriert).`);
    return { changed: false, count: payload.length };
  }

  if (missing.length) log(`ℹ️ Bei Discord fehlen: ${missing.map((n) => `/${n}`).join(', ')}`);
  if (stale.length) log(`ℹ️ Bei Discord veraltet (werden entfernt): ${stale.map((n) => `/${n}`).join(', ')}`);
  log('🔄 Registriere Slash-Commands neu ...');

  const registered = await registerGlobal(client.rest, appId, payload);
  storage.setMeta('commandHash', hash);
  const cleaned = await clearStaleGuildCommands(client.rest, appId, [process.env.GUILD_ID], log);
  log(`✅ ${registered.length} Slash-Commands global registriert${cleaned ? `, ${cleaned} Server bereinigt` : ''}.`);
  return { changed: true, count: registered.length };
}

module.exports = {
  buildPayload,
  validatePayload,
  hashPayload,
  getApplicationId,
  clearStaleGuildCommands,
  registerGlobal,
  registerGuild,
  syncIfChanged,
};
