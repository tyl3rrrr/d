// commands-appearance.js
// /appearence - Erscheinungsbild des Bots auf diesem Server.
//
// Referenzbild (IMG_2347): Bot-Profil mit Avatar, grünem Online-Punkt, "APP"-Tag
// und Namen im Farbverlauf. Was davon ein Bot beeinflussen kann:
//   - Avatar/Banner/Bio/Nickname pro Server -> PATCH /guilds/{id}/members/@me
//   - Online-Punkt (Status)                 -> Presence (kommt mit /status, Teil 2)
//   - Name im Farbverlauf                   -> ist eine ROLLENFARBE ("Enhanced Role Styles",
//                                              Server braucht dafür 3 Boosts). Der Bot legt dafür
//                                              eine eigene Kosmetik-Rolle an und gibt sie sich selbst.
//   - "APP"-Tag                             -> setzt Discord automatisch bei jedem Bot.
// Zugriff: overview = jeder, Änderungen = Administratoren (siehe Registry in commands.js).

const { SlashCommandBuilder, EmbedBuilder, Routes, PermissionFlagsBits } = require('discord.js');
const storage = require('./storage');
const { EPHEMERAL, errText, truncate } = require('./util');

const HEX = /^#?([0-9a-fA-F]{6})$/;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
// Konstanten laut Discord-Doku: Holografischer Stil erzwingt diese Werte
const HOLO = { primary_color: 11127295, secondary_color: 16759788, tertiary_color: 16761760 };

function parseHex(value) {
  const m = HEX.exec(String(value || '').trim());
  return m ? parseInt(m[1], 16) : null;
}

async function toDataUri(attachment) {
  if (!IMAGE_TYPES.includes(attachment.contentType)) throw new Error('Nur PNG, JPG, GIF oder WEBP erlaubt.');
  if (attachment.size > MAX_IMAGE_BYTES) throw new Error('Bild ist größer als 8 MB.');
  const res = await fetch(attachment.url);
  if (!res.ok) throw new Error(`Bild konnte nicht geladen werden (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${attachment.contentType};base64,${buf.toString('base64')}`;
}

function patchSelf(client, guildId, body, reason) {
  return client.rest.patch(Routes.guildMember(guildId, '@me'), { body, reason });
}

const appearence = {
  data: new SlashCommandBuilder()
    .setName('appearence')
    .setDescription('Zeigt/ändert das Erscheinungsbild des Bots auf diesem Server')
    .addSubcommand((s) => s.setName('overview').setDescription('Zeigt Profil, Status, Badges und verfügbare Discord-Funktionen'))
    .addSubcommand((s) =>
      s
        .setName('nickname')
        .setDescription('Setzt den Server-Nickname des Bots (ohne Angabe: zurücksetzen)')
        .addStringOption((o) => o.setName('name').setDescription('Neuer Nickname').setMaxLength(32).setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName('profile')
        .setDescription('Setzt Server-Avatar, -Banner und -Bio des Bots')
        .addAttachmentOption((o) => o.setName('avatar').setDescription('Neuer Server-Avatar').setRequired(false))
        .addAttachmentOption((o) => o.setName('banner').setDescription('Neues Server-Banner').setRequired(false))
        .addStringOption((o) => o.setName('bio').setDescription('Neue Server-Bio').setMaxLength(400).setRequired(false))
        .addBooleanOption((o) => o.setName('reset').setDescription('Server-Avatar/-Banner/-Bio zurücksetzen').setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName('color')
        .setDescription('Setzt die Namensfarbe des Bots (Verlauf/holografisch, wenn der Server es erlaubt)')
        .addStringOption((o) => o.setName('primary').setDescription('Hauptfarbe als Hex, z.B. #ff8a00').setRequired(false))
        .addStringOption((o) => o.setName('secondary').setDescription('Zweite Farbe für den Verlauf, z.B. #e52e71').setRequired(false))
        .addBooleanOption((o) => o.setName('holographic').setDescription('Holografischer Stil').setRequired(false))
        .addBooleanOption((o) => o.setName('reset').setDescription('Farbe entfernen').setRequired(false))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const client = interaction.client;
    const guild = interaction.guild;
    await interaction.deferReply({ flags: EPHEMERAL });

    try {
      if (sub === 'overview') return await overview(interaction);

      if (sub === 'nickname') {
        const name = interaction.options.getString('name') || null;
        await patchSelf(client, guild.id, { nick: name }, `Nickname geändert von ${interaction.user.tag}`);
        await interaction.editReply(name ? `✅ Nickname gesetzt auf **${name}**.` : '✅ Nickname zurückgesetzt.');
        return;
      }

      if (sub === 'profile') {
        const body = {};
        if (interaction.options.getBoolean('reset')) {
          body.avatar = null;
          body.banner = null;
          body.bio = null;
        } else {
          const avatar = interaction.options.getAttachment('avatar');
          const banner = interaction.options.getAttachment('banner');
          const bio = interaction.options.getString('bio');
          if (avatar) body.avatar = await toDataUri(avatar);
          if (banner) body.banner = await toDataUri(banner);
          if (bio) body.bio = bio;
        }
        if (Object.keys(body).length === 0) {
          await interaction.editReply('Bitte gib mindestens `avatar`, `banner`, `bio` oder `reset` an.');
          return;
        }
        await patchSelf(client, guild.id, body, `Server-Profil geändert von ${interaction.user.tag}`);
        await interaction.editReply('✅ Server-Profil des Bots aktualisiert.');
        return;
      }

      if (sub === 'color') return await setColor(interaction);
    } catch (err) {
      console.error('Fehler bei /appearence:', err);
      await interaction.editReply(`❌ Discord hat die Änderung abgelehnt bzw. sie ist fehlgeschlagen: ${errText(err)}`);
    }
  },
};

async function setColor(interaction) {
  const client = interaction.client;
  const guild = interaction.guild;
  const settings = storage.getGuildSettings(guild.id);
  const reset = interaction.options.getBoolean('reset');

  if (reset) {
    if (settings.appearanceRoleId) {
      await client.rest.delete(Routes.guildRole(guild.id, settings.appearanceRoleId), { reason: 'Bot-Farbe entfernt' }).catch(() => {});
      storage.removeGuildSetting(guild.id, 'appearanceRoleId');
    }
    await interaction.editReply('✅ Namensfarbe des Bots entfernt.');
    return;
  }

  const holo = interaction.options.getBoolean('holographic');
  const p = interaction.options.getString('primary');
  const s = interaction.options.getString('secondary');
  const primary = p ? parseHex(p) : null;
  const secondary = s ? parseHex(s) : null;
  if ((p && primary === null) || (s && secondary === null)) {
    await interaction.editReply('❌ Farben bitte als Hex angeben, z.B. `#ff8a00`.');
    return;
  }
  if (!holo && primary === null) {
    await interaction.editReply('❌ Gib `primary` (und optional `secondary`) oder `holographic:true` an.');
    return;
  }

  const colors = holo ? { ...HOLO } : { primary_color: primary, secondary_color: secondary ?? null, tertiary_color: null };
  const wantsEnhanced = holo || secondary !== null;
  const enhancedAvailable = guild.features.includes('ENHANCED_ROLE_COLORS');

  const buildBody = (useColors) => ({
    name: client.user.username,
    permissions: '0',
    hoist: false,
    mentionable: false,
    ...(useColors ? { colors } : { color: colors.primary_color }),
  });

  const apply = async (useColors) => {
    let roleId = settings.appearanceRoleId;
    let existing = roleId ? guild.roles.cache.get(roleId) : null;
    if (existing) {
      await client.rest.patch(Routes.guildRole(guild.id, roleId), { body: buildBody(useColors), reason: 'Bot-Farbe geändert' });
    } else {
      const created = await client.rest.post(Routes.guildRoles(guild.id), { body: buildBody(useColors), reason: 'Bot-Farbe' });
      roleId = created.id;
      storage.setGuildSetting(guild.id, 'appearanceRoleId', roleId);
    }
    await client.rest.put(Routes.guildMemberRole(guild.id, client.user.id, roleId), { reason: 'Bot-Farbe' });
  };

  let fellBack = false;
  try {
    await apply(true);
  } catch (err) {
    if (!wantsEnhanced) throw err;
    // Server unterstützt keinen Verlauf -> solide Hauptfarbe als Fallback
    if (holo) throw err;
    await apply(false);
    fellBack = true;
  }

  await interaction.editReply(
    fellBack || (wantsEnhanced && !enhancedAvailable)
      ? '✅ Farbe gesetzt — aber dieser Server hat „Enhanced Role Styles“ nicht freigeschaltet (3 Boosts nötig), daher ggf. nur die Hauptfarbe sichtbar.'
      : '✅ Namensfarbe des Bots gesetzt.'
  );
}

async function overview(interaction) {
  const client = interaction.client;
  const guild = interaction.guild;

  const me = await guild.members.fetchMe();
  const user = await client.user.fetch().catch(() => client.user);
  const presence = me.presence?.status || client.user.presence?.status || 'online';
  const presenceIcon = { online: '🟢 Online', idle: '🟡 Abwesend', dnd: '🔴 Nicht stören', offline: '⚫ Unsichtbar/Offline' }[presence] || presence;

  let bits = 0;
  try {
    const app = await client.application.fetch();
    bits = Number(app.flags?.bitfield || 0);
  } catch (err) {
    /* Flags nicht ermittelbar */
  }
  const badges = [
    `Supports Commands: ${bits & (1 << 23) ? '✅' : '❌'}`,
    `Uses AutoMod: ${bits & (1 << 6) ? '✅' : '❌ (siehe /automod status)'}`,
  ].join('\n');

  const settings = storage.getGuildSettings(guild.id);
  let colorText = 'Keine Farbe (Standard)';
  try {
    const roles = await client.rest.get(Routes.guildRoles(guild.id));
    const mine = roles.filter((r) => me.roles.cache.has(r.id) && (r.colors?.primary_color || r.color)).sort((a, b) => b.position - a.position)[0];
    if (mine) {
      const c = mine.colors || {};
      const hex = (n) => `#${Number(n).toString(16).padStart(6, '0')}`;
      colorText = c.tertiary_color ? 'Holografisch' : c.secondary_color ? `Verlauf ${hex(c.primary_color)} → ${hex(c.secondary_color)}` : hex(c.primary_color ?? mine.color);
    }
  } catch (err) {
    colorText = 'nicht ermittelbar';
  }

  const need = [
    ['Rollen verwalten', PermissionFlagsBits.ManageRoles],
    ['Server verwalten (AutoMod)', PermissionFlagsBits.ManageGuild],
    ['Nachrichten verwalten', PermissionFlagsBits.ManageMessages],
    ['Mitglieder kicken', PermissionFlagsBits.KickMembers],
    ['Mitglieder bannen', PermissionFlagsBits.BanMembers],
    ['Mitglieder moderieren (Timeout)', PermissionFlagsBits.ModerateMembers],
    ['Kanäle verwalten', PermissionFlagsBits.ManageChannels],
    ['Nicknames verwalten', PermissionFlagsBits.ManageNicknames],
  ];
  const permText = need.map(([label, flag]) => `${me.permissions.has(flag) ? '✅' : '❌'} ${label}`).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`🎨 Erscheinungsbild — ${me.displayName}`)
    .setColor(me.displayColor || 0x5865f2)
    .setThumbnail(me.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Name / Tag', value: `${me.displayName} \`APP\`${user.flags?.has?.('VerifiedBot') ? ' ✔ verifiziert' : ''}`, inline: true },
      { name: 'Status', value: presenceIcon, inline: true },
      { name: 'Namensfarbe', value: colorText, inline: true },
      { name: 'Badges', value: badges },
      {
        name: 'Verfügbare Funktionen',
        value:
          `• Server-Nickname / -Avatar / -Banner / -Bio: \`/appearence nickname\`, \`/appearence profile\`\n` +
          `• Namensfarbe: \`/appearence color\` — Verlauf/holografisch: ${guild.features.includes('ENHANCED_ROLE_COLORS') ? '✅ auf diesem Server verfügbar' : '❌ Server braucht „Enhanced Role Styles“ (3 Boosts)'}\n` +
          `• Der „APP“-Tag wird von Discord automatisch gesetzt.`,
      },
      { name: 'Bot-Berechtigungen hier', value: permText }
    );
  if (user.bannerURL?.()) embed.setImage(user.bannerURL({ size: 1024 }));
  if (settings.appearanceRoleId) embed.setFooter({ text: 'Kosmetik-Rolle des Bots ist aktiv.' });

  await interaction.editReply({ embeds: [embed] });
}

module.exports = { appearence, parseHex };
