// commands-settings.js
// /settings - ONE interactive panel (only visible to you) for every server setting.
// Pick a setting from the menu, then pick the role/channel from Discord's own
// selector - no IDs, no subcommands. Access (administrators only) is checked
// centrally in permissions.js; the component clicks are checked again below.
//
// How it works without collectors: every menu/button carries a custom ID that
// starts with "st:" and index.js hands those interactions to handleComponent().
// So the panel keeps working even after a bot restart.
//
//   st:menu          - the "what do you want to change?" menu
//   st:set:<id>      - role/channel selector for setting <id>
//   st:clear:<id>    - "Clear" button
//   st:on:<id> / st:off:<id> - toggle buttons (welcome DM)
//   st:back          - back to the overview

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const storage = require('./storage');
const permissions = require('./permissions');
const logging = require('./logging');
const { EPHEMERAL, errText } = require('./util');

const PREFIX = 'st:';
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

// group: heading in the overview. path: where it lives in the server's settings.
// type: role | channel | toggle.  team: role must be a real, non-managed role.
const SETTINGS = [
  { id: 'admin', group: 'Team', label: 'Administrator role', desc: 'Members with this role can use all admin commands.', type: 'role', team: true, path: ['adminRoleId'] },
  { id: 'mod', group: 'Team', label: 'Moderator role', desc: 'Members with this role can use the moderation commands.', type: 'role', team: true, path: ['modRoleId'] },
  { id: 'ticketrole', group: 'Tickets', label: 'Ticket role', desc: 'Gets pinged whenever a new ticket arrives.', type: 'role', path: ['ticketStaffRoleId'] },
  { id: 'ticketchan', group: 'Tickets', label: 'Ticket channel', desc: 'New tickets are posted here (users write them to me in DMs).', type: 'channel', post: true, path: ['ticketChannelId'] },
  { id: 'log', group: 'Channels', label: 'Log channel', desc: 'Moderation actions, joins and setting changes are logged here.', type: 'channel', post: true, path: ['logChannelId'] },
  { id: 'suggest', group: 'Channels', label: 'Suggestions channel', desc: 'Where /suggest posts. Clear it to turn /suggest off.', type: 'channel', post: true, path: ['suggestChannelId'] },
  { id: 'xp', group: 'Channels', label: 'XP leaderboard channel', desc: 'The leaderboard is posted here and refreshed every 24 hours.', type: 'channel', post: true, path: ['xpBoardChannelId'], after: 'xp' },
  { id: 'macrumors', group: 'Channels', label: 'MacRumors channel', desc: 'New MacRumors articles are posted here. Clear it to turn them off.', type: 'channel', post: true, path: ['macrumorsChannelId'], after: 'macrumors' },
  { id: 'apply', group: 'Channels', label: 'Application review channel', desc: 'Submitted applications (with Accept/Deny buttons) go here.', type: 'channel', post: true, path: ['applyReviewChannelId'] },
  { id: 'wchan', group: 'Welcome', label: 'Welcome channel', desc: 'The public welcome message is posted here.', type: 'channel', post: true, path: ['welcome', 'channelId'] },
  { id: 'wrole', group: 'Welcome', label: 'Welcome role', desc: 'Given automatically to every new member.', type: 'role', team: true, hierarchy: true, path: ['welcome', 'roleId'] },
  { id: 'wdm', group: 'Welcome', label: 'Welcome DM', desc: 'Also send new members a private welcome message.', type: 'toggle', path: ['welcome', 'dmEnabled'] },
];
const byId = (id) => SETTINGS.find((s) => s.id === id);

// ---------------------------------------------------------------------------
// Reading / writing (welcome.* settings are nested under `welcome`)
// ---------------------------------------------------------------------------
function readValue(guildId, def) {
  let v = storage.getGuildSettings(guildId);
  for (const k of def.path) v = v ? v[k] : undefined;
  return v === undefined ? null : v;
}

function writeValue(guildId, def, value) {
  if (def.path.length === 1) {
    if (value === null) storage.removeGuildSetting(guildId, def.path[0]);
    else storage.setGuildSetting(guildId, def.path[0], value);
    return;
  }
  const [parent, key] = def.path;
  const cfg = { ...(storage.getGuildSettings(guildId)[parent] || {}) };
  if (value === null || value === false) delete cfg[key];
  else cfg[key] = value;
  if (Object.keys(cfg).length === 0) storage.removeGuildSetting(guildId, parent);
  else storage.setGuildSetting(guildId, parent, cfg);
}

function show(guild, def, value) {
  if (def.type === 'toggle') return value ? '🟢 On' : '⚫ Off';
  if (!value) return '_not set_';
  if (def.type === 'role') return guild.roles.cache.has(value) ? `<@&${value}>` : '⚠️ deleted - pick a new one';
  return guild.channels.cache.has(value) ? `<#${value}>` : '⚠️ deleted - pick a new one';
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
function overview(guild, note) {
  const groups = [];
  for (const def of SETTINGS) {
    let g = groups.find((x) => x.name === def.group);
    if (!g) groups.push((g = { name: def.group, lines: [] }));
    g.lines.push(`**${def.label}:** ${show(guild, def, readValue(guild.id, def))}`);
  }
  const embed = new EmbedBuilder()
    .setTitle(`⚙️ Settings - ${guild.name}`)
    .setColor(0x5865f2)
    .setDescription(groups.map((g) => `__${g.name}__\n${g.lines.join('\n')}`).join('\n\n'))
    .setFooter({ text: 'The server owner and members with the Discord Administrator permission are always administrators.' });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}menu`)
    .setPlaceholder('Choose a setting to change...')
    .addOptions(SETTINGS.map((d) => ({ label: d.label, value: d.id, description: `${d.group}: ${d.desc}`.slice(0, 100) })));
  return { content: note || null, embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

function editor(guild, def) {
  const value = readValue(guild.id, def);
  const embed = new EmbedBuilder()
    .setTitle(`⚙️ ${def.label}`)
    .setColor(0x5865f2)
    .setDescription(`${def.desc}\n\n**Currently:** ${show(guild, def, value)}`);
  const rows = [];
  const back = new ButtonBuilder().setCustomId(`${PREFIX}back`).setLabel('Back').setStyle(ButtonStyle.Secondary);

  if (def.type === 'toggle') {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}on:${def.id}`).setLabel('Turn on').setStyle(value ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}off:${def.id}`).setLabel('Turn off').setStyle(value ? ButtonStyle.Secondary : ButtonStyle.Danger),
        back
      )
    );
  } else {
    const picker =
      def.type === 'role'
        ? new RoleSelectMenuBuilder().setPlaceholder('Pick a role...')
        : new ChannelSelectMenuBuilder().setPlaceholder('Pick a channel...').setChannelTypes(TEXT_CHANNELS);
    picker.setCustomId(`${PREFIX}set:${def.id}`).setMinValues(1).setMaxValues(1);
    rows.push(new ActionRowBuilder().addComponents(picker));
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}clear:${def.id}`).setLabel('Clear').setStyle(ButtonStyle.Danger).setDisabled(!value),
        back
      )
    );
  }
  return { content: null, embeds: [embed], components: rows };
}

// ---------------------------------------------------------------------------
// Validation + saving
// ---------------------------------------------------------------------------
// Returns { ok:false, error } or { ok:true, shown, warning }.
async function check(guild, def, id) {
  if (def.type === 'role') {
    const role = guild.roles.cache.get(id);
    if (!role) return { ok: false, error: 'That role does not exist anymore.' };
    if (role.id === guild.id) return { ok: false, error: "@everyone can't be used here." };
    if (def.team && role.managed) return { ok: false, error: "Bot/integration roles can't be used here." };
    let warning = null;
    if (def.hierarchy) {
      const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
      if (me && role.position >= me.roles.highest.position) warning = "That role is above my highest role - I can't give it out until you move my role higher.";
      else if (me && !me.permissions.has(PermissionFlagsBits.ManageRoles)) warning = 'I am missing the "Manage Roles" permission.';
    }
    return { ok: true, shown: `@${role.name}`, mention: role.toString(), warning };
  }
  const channel = guild.channels.cache.get(id);
  if (!channel || !TEXT_CHANNELS.includes(channel.type)) return { ok: false, error: 'That channel does not exist or is not a text channel.' };
  let warning = null;
  const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  const perms = me && channel.permissionsFor(me);
  if (def.post && perms && !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    warning = `I can't post in ${channel.toString()} yet - give me View Channel, Send Messages and Embed Links there.`;
  }
  return { ok: true, shown: `#${channel.name}`, mention: channel.toString(), warning };
}

// Things that should happen right after a setting changed (run after the panel updated).
async function runAfter(interaction, def, guildId) {
  if (def.after === 'xp') {
    storage.removeGuildSetting(guildId, 'xpBoardMessageId'); // new channel -> new leaderboard message
    await require('./xp-runtime').updateGuildBoard(interaction.client, guildId);
  } else if (def.after === 'macrumors') {
    // Post the newest article once, so you immediately see that it works.
    const ok = await require('./macrumors').postLatest(interaction.client, guildId, readValue(guildId, def));
    if (!ok) await interaction.followUp({ content: "⚠️ Saved, but I couldn't post a first article there. Check my permissions in that channel.", flags: EPHEMERAL });
  }
}

function logChange(interaction, def, shown) {
  logging.logSettingChange(interaction.client, interaction.guildId, { setting: def.label, value: shown, moderator: interaction.user.tag });
}

// ---------------------------------------------------------------------------
// Component handler (called by index.js for every custom ID starting with "st:")
// ---------------------------------------------------------------------------
async function handleComponent(interaction) {
  if (!interaction.inGuild() || !interaction.guild) return;
  if (!permissions.hasAccess(interaction, 'admin')) {
    await interaction.reply({ content: permissions.denyText('admin'), flags: EPHEMERAL });
    return;
  }

  const guild = interaction.guild;
  const [action, id] = interaction.customId.slice(PREFIX.length).split(':');
  const def = id ? byId(id) : null;

  try {
    if (action === 'back') return void (await interaction.update(overview(guild)));

    if (action === 'menu') {
      const picked = byId(interaction.values[0]);
      if (!picked) return void (await interaction.update(overview(guild, '❌ Unknown setting.')));
      return void (await interaction.update(editor(guild, picked)));
    }

    if (!def) return void (await interaction.update(overview(guild, '❌ Unknown setting.')));

    if (action === 'clear' || action === 'off') {
      writeValue(guild.id, def, def.type === 'toggle' ? false : null);
      logChange(interaction, def, null);
      await interaction.update(overview(guild, `✅ **${def.label}** ${def.type === 'toggle' ? 'turned off' : 'cleared'}.`));
      if (action === 'clear' && def.after === 'xp') storage.removeGuildSetting(guild.id, 'xpBoardMessageId');
      return;
    }

    if (action === 'on') {
      writeValue(guild.id, def, true);
      logChange(interaction, def, 'on');
      return void (await interaction.update(overview(guild, `✅ **${def.label}** turned on.`)));
    }

    if (action === 'set') {
      const picked = interaction.values[0];
      const res = await check(guild, def, picked);
      if (!res.ok) return void (await interaction.update({ ...editor(guild, def), content: `❌ ${res.error}` }));

      writeValue(guild.id, def, picked);
      logChange(interaction, def, res.shown);
      await interaction.update(overview(guild, `✅ **${def.label}** set to ${res.mention}.${res.warning ? `\n⚠️ ${res.warning}` : ''}`));
      await runAfter(interaction, def, guild.id).catch((err) => console.warn(`Settings: follow-up for ${def.id} failed:`, errText(err)));
    }
  } catch (err) {
    console.error('Error in the settings panel:', err);
    const payload = { content: `❌ Something went wrong: ${errText(err)}`, flags: EPHEMERAL };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
}

const settings = {
  data: new SlashCommandBuilder().setName('settings').setDescription('Opens the settings panel for this server (roles, channels, tickets, ...)'),

  async execute(interaction) {
    await interaction.reply({ ...overview(interaction.guild), flags: EPHEMERAL });
  },
};

module.exports = { settings, handleComponent, PREFIX, SETTINGS };
