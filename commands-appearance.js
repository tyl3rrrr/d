// commands-appearance.js
// /appearence - the bot's appearance on this server.
//
// Reference image (IMG_2347): bot profile with avatar, green online dot, "APP"
// tag and a gradient name. What a bot can influence of that:
//   - Avatar/banner/bio/nickname per server -> PATCH /guilds/{id}/members/@me
//   - Online dot (status)                   -> presence (see /bot-status)
//   - Gradient name                         -> is a ROLE COLOR ("Enhanced Role Styles",
//                                              the server needs 3 boosts). The bot creates its
//                                              own cosmetic role for this and assigns it to itself.
//   - "APP" tag                             -> set automatically by Discord for every bot.
// Access: overview = everyone, changes = administrators (see registry in commands.js).

const { SlashCommandBuilder, EmbedBuilder, Routes, PermissionFlagsBits } = require('discord.js');
const storage = require('./storage');
const { EPHEMERAL, errText, truncate } = require('./util');

const HEX = /^#?([0-9a-fA-F]{6})$/;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
// Constants per Discord docs: the holographic style enforces these values
const HOLO = { primary_color: 11127295, secondary_color: 16759788, tertiary_color: 16761760 };

function parseHex(value) {
  const m = HEX.exec(String(value || '').trim());
  return m ? parseInt(m[1], 16) : null;
}

async function toDataUri(attachment) {
  if (!IMAGE_TYPES.includes(attachment.contentType)) throw new Error('Only PNG, JPG, GIF or WEBP are allowed.');
  if (attachment.size > MAX_IMAGE_BYTES) throw new Error('Image is larger than 8 MB.');
  const res = await fetch(attachment.url);
  if (!res.ok) throw new Error(`Could not load the image (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${attachment.contentType};base64,${buf.toString('base64')}`;
}

function patchSelf(client, guildId, body, reason) {
  return client.rest.patch(Routes.guildMember(guildId, '@me'), { body, reason });
}

const appearence = {
  data: new SlashCommandBuilder()
    .setName('appearence')
    .setDescription("Shows/changes the bot's appearance on this server")
    .addSubcommand((s) => s.setName('overview').setDescription('Shows profile, status, badges and available Discord features'))
    .addSubcommand((s) =>
      s
        .setName('nickname')
        .setDescription("Sets the bot's server nickname (omit to reset)")
        .addStringOption((o) => o.setName('name').setDescription('New nickname').setMaxLength(32).setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName('profile')
        .setDescription("Sets the bot's server avatar, banner and bio")
        .addAttachmentOption((o) => o.setName('avatar').setDescription('New server avatar').setRequired(false))
        .addAttachmentOption((o) => o.setName('banner').setDescription('New server banner').setRequired(false))
        .addStringOption((o) => o.setName('bio').setDescription('New server bio').setMaxLength(400).setRequired(false))
        .addBooleanOption((o) => o.setName('reset').setDescription('Reset server avatar/banner/bio').setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName('color')
        .setDescription("Sets the bot's name color (gradient/holographic if the server allows it)")
        .addStringOption((o) => o.setName('primary').setDescription('Primary color as hex, e.g. #ff8a00').setRequired(false))
        .addStringOption((o) => o.setName('secondary').setDescription('Second color for a gradient, e.g. #e52e71').setRequired(false))
        .addBooleanOption((o) => o.setName('holographic').setDescription('Holographic style').setRequired(false))
        .addBooleanOption((o) => o.setName('reset').setDescription('Remove the color').setRequired(false))
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
        await patchSelf(client, guild.id, { nick: name }, `Nickname changed by ${interaction.user.tag}`);
        await interaction.editReply(name ? `✅ Nickname set to **${name}**.` : '✅ Nickname reset.');
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
          await interaction.editReply('Please provide at least `avatar`, `banner`, `bio` or `reset`.');
          return;
        }
        await patchSelf(client, guild.id, body, `Server profile changed by ${interaction.user.tag}`);
        await interaction.editReply("✅ The bot's server profile was updated.");
        return;
      }

      if (sub === 'color') return await setColor(interaction);
    } catch (err) {
      console.error('Error in /appearence:', err);
      await interaction.editReply(`❌ Discord rejected the change, or it failed: ${errText(err)}`);
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
      await client.rest.delete(Routes.guildRole(guild.id, settings.appearanceRoleId), { reason: 'Bot color removed' }).catch(() => {});
      storage.removeGuildSetting(guild.id, 'appearanceRoleId');
    }
    await interaction.editReply("✅ The bot's name color was removed.");
    return;
  }

  const holo = interaction.options.getBoolean('holographic');
  const p = interaction.options.getString('primary');
  const s = interaction.options.getString('secondary');
  const primary = p ? parseHex(p) : null;
  const secondary = s ? parseHex(s) : null;
  if ((p && primary === null) || (s && secondary === null)) {
    await interaction.editReply('❌ Please give colors as hex, e.g. `#ff8a00`.');
    return;
  }
  if (!holo && primary === null) {
    await interaction.editReply('❌ Provide `primary` (and optionally `secondary`) or `holographic:true`.');
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
      await client.rest.patch(Routes.guildRole(guild.id, roleId), { body: buildBody(useColors), reason: 'Bot color changed' });
    } else {
      const created = await client.rest.post(Routes.guildRoles(guild.id), { body: buildBody(useColors), reason: 'Bot color' });
      roleId = created.id;
      storage.setGuildSetting(guild.id, 'appearanceRoleId', roleId);
    }
    await client.rest.put(Routes.guildMemberRole(guild.id, client.user.id, roleId), { reason: 'Bot color' });
  };

  // IMPORTANT: the `colors` field (gradient/holographic) may only be sent
  // when a gradient is actually wanted - otherwise Discord ALWAYS rejects it
  // with "Missing guild feature", even for a single plain color. A plain
  // color (only `primary`, no `secondary`/`holographic`) must be set via the
  // classic `color` field.
  let fellBack = false;
  try {
    await apply(wantsEnhanced);
  } catch (err) {
    if (!wantsEnhanced || holo) throw err;
    // Server doesn't support gradients -> fall back to the solid primary color
    await apply(false);
    fellBack = true;
  }

  await interaction.editReply(
    fellBack || (wantsEnhanced && !enhancedAvailable)
      ? '✅ Color set — but this server hasn\'t unlocked "Enhanced Role Styles" (3 boosts needed), so only the primary color may be visible.'
      : "✅ The bot's name color was set."
  );
}

async function overview(interaction) {
  const client = interaction.client;
  const guild = interaction.guild;

  const me = await guild.members.fetchMe();
  const user = await client.user.fetch().catch(() => client.user);
  const presence = me.presence?.status || client.user.presence?.status || 'online';
  const presenceIcon = { online: '🟢 Online', idle: '🟡 Idle', dnd: '🔴 Do Not Disturb', offline: '⚫ Invisible/Offline' }[presence] || presence;

  let bits = 0;
  try {
    const app = await client.application.fetch();
    bits = Number(app.flags?.bitfield || 0);
  } catch (err) {
    /* flags could not be determined */
  }
  const badges = [
    `Supports Commands: ${bits & (1 << 23) ? '✅' : '❌'}`,
    `Uses AutoMod: ${bits & (1 << 6) ? '✅' : '❌ (see /automod status)'}`,
  ].join('\n');

  const settings = storage.getGuildSettings(guild.id);
  let colorText = 'No color (default)';
  try {
    const roles = await client.rest.get(Routes.guildRoles(guild.id));
    const mine = roles.filter((r) => me.roles.cache.has(r.id) && (r.colors?.primary_color || r.color)).sort((a, b) => b.position - a.position)[0];
    if (mine) {
      const c = mine.colors || {};
      const hex = (n) => `#${Number(n).toString(16).padStart(6, '0')}`;
      colorText = c.tertiary_color ? 'Holographic' : c.secondary_color ? `Gradient ${hex(c.primary_color)} → ${hex(c.secondary_color)}` : hex(c.primary_color ?? mine.color);
    }
  } catch (err) {
    colorText = 'could not be determined';
  }

  const need = [
    ['Manage Roles', PermissionFlagsBits.ManageRoles],
    ['Manage Server (AutoMod)', PermissionFlagsBits.ManageGuild],
    ['Manage Messages', PermissionFlagsBits.ManageMessages],
    ['Kick Members', PermissionFlagsBits.KickMembers],
    ['Ban Members', PermissionFlagsBits.BanMembers],
    ['Moderate Members (Timeout)', PermissionFlagsBits.ModerateMembers],
    ['Manage Channels', PermissionFlagsBits.ManageChannels],
    ['Manage Nicknames', PermissionFlagsBits.ManageNicknames],
  ];
  const permText = need.map(([label, flag]) => `${me.permissions.has(flag) ? '✅' : '❌'} ${label}`).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`🎨 Appearance — ${me.displayName}`)
    .setColor(me.displayColor || 0x5865f2)
    .setThumbnail(me.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Name / Tag', value: `${me.displayName} \`APP\`${user.flags?.has?.('VerifiedBot') ? ' ✔ verified' : ''}`, inline: true },
      { name: 'Status', value: presenceIcon, inline: true },
      { name: 'Name color', value: colorText, inline: true },
      { name: 'Badges', value: badges },
      {
        name: 'Available features',
        value:
          `• Server nickname / avatar / banner / bio: \`/appearence nickname\`, \`/appearence profile\`\n` +
          `• Name color: \`/appearence color\` — gradient/holographic: ${guild.features.includes('ENHANCED_ROLE_COLORS') ? '✅ available on this server' : '❌ server needs "Enhanced Role Styles" (3 boosts)'}\n` +
          `• The "APP" tag is set automatically by Discord.`,
      },
      { name: 'Bot permissions here', value: permText }
    );
  if (user.bannerURL?.()) embed.setImage(user.bannerURL({ size: 1024 }));
  if (settings.appearanceRoleId) embed.setFooter({ text: "The bot's cosmetic role is active." });

  await interaction.editReply({ embeds: [embed] });
}

module.exports = { appearence, parseHex };
