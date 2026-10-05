// commands-giveaway.js
// /giveaway - create, end, reroll, cancel and list giveaways.
// Access (moderators and above) is checked centrally in permissions.js (see commands.js).
// The logic lives in giveaway-runtime.js.
//
// Every subcommand answers IMMEDIATELY with an ephemeral "thinking..." state and
// then edits that reply - so none of them can end in "The application did not respond".

const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const storage = require('./storage');
const permissions = require('./permissions');
const logging = require('./logging');
const runtime = require('./giveaway-runtime');
const { EPHEMERAL, truncate } = require('./util');

const MAX_ACTIVE_PER_GUILD = 25;
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const idOption = (o, description) => o.setName('id').setDescription(description).setAutocomplete(true).setRequired(true);

const giveaway = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Creates and manages giveaways')
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Starts a giveaway')
        .addStringOption((o) => o.setName('prize').setDescription('What can be won?').setMaxLength(200).setRequired(true))
        .addStringOption((o) => o.setName('duration').setDescription('How long it runs, e.g. 30m, 2h, 1d, 1d12h (1 minute to 60 days)').setRequired(true))
        .addIntegerOption((o) => o.setName('winners').setDescription('How many winners (default 1)').setMinValue(1).setMaxValue(25).setRequired(false))
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: this channel)').addChannelTypes(...TEXT_CHANNELS).setRequired(false))
        .addRoleOption((o) => o.setName('role').setDescription('Only members with this role may enter').setRequired(false))
        .addIntegerOption((o) => o.setName('min-days').setDescription('Only members who joined at least this many days ago may enter').setMinValue(1).setMaxValue(3650).setRequired(false))
        .addStringOption((o) => o.setName('conditions').setDescription('Extra conditions shown on the giveaway (text)').setMaxLength(300).setRequired(false))
    )
    .addSubcommand((s) => s.setName('end').setDescription('Ends a giveaway right now and draws the winners').addStringOption((o) => idOption(o, 'The giveaway to end')))
    .addSubcommand((s) =>
      s
        .setName('reroll')
        .setDescription('Draws new winners for an ended giveaway')
        .addStringOption((o) => idOption(o, 'The ended giveaway'))
        .addIntegerOption((o) => o.setName('winners').setDescription('How many new winners (default 1)').setMinValue(1).setMaxValue(25).setRequired(false))
    )
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancels a running giveaway without drawing').addStringOption((o) => idOption(o, 'The giveaway to cancel')))
    .addSubcommand((s) => s.setName('list').setDescription('Shows running and recent giveaways')),

  // Suggestions for the "id" option (shows the prize, inserts the ID).
  async autocomplete(interaction) {
    if (!interaction.inGuild() || !permissions.hasAccess(interaction, 'mod')) return void (await interaction.respond([]));
    const sub = interaction.options.getSubcommand(false);
    const typed = String(interaction.options.getFocused() || '').toLowerCase();
    const wanted = sub === 'reroll' ? 'ended' : 'active';
    const choices = storage
      .listGiveaways(interaction.guildId)
      .filter((g) => g.status === wanted && (!typed || g.id.includes(typed) || g.prize.toLowerCase().includes(typed)))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 25)
      .map((g) => ({ name: truncate(`${g.prize} (${g.id})`, 100), value: g.id }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    await interaction.deferReply({ flags: EPHEMERAL }); // answer first, work afterwards
    const sub = interaction.options.getSubcommand();
    const client = interaction.client;
    const guildId = interaction.guildId;

    if (sub === 'create') return create(interaction);

    if (sub === 'list') {
      const all = storage.listGiveaways(guildId).sort((a, b) => b.createdAt - a.createdAt);
      const active = all.filter((g) => g.status === 'active');
      const recent = all.filter((g) => g.status !== 'active').slice(0, 5);
      const line = (g) => `\`${g.id}\` · **${truncate(g.prize, 60)}** · ${g.entries.length} entr${g.entries.length === 1 ? 'y' : 'ies'} · <#${g.channelId}>`;
      const embed = new EmbedBuilder()
        .setTitle('🎉 Giveaways')
        .setColor(0x5865f2)
        .addFields(
          { name: `Running (${active.length})`, value: active.length ? active.slice(0, 10).map((g) => `${line(g)} · ends <t:${Math.floor(g.endsAt / 1000)}:R>`).join('\n') : '_none_' },
          { name: 'Recently finished', value: recent.length ? recent.map((g) => `${line(g)} · ${g.status}`).join('\n') : '_none_' }
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // end / reroll / cancel all need an ID.
    const id = interaction.options.getString('id').trim().toLowerCase();
    const g = storage.getGiveaway(guildId, id);
    if (!g) {
      await interaction.editReply('❌ I could not find a giveaway with that ID. Pick one from the suggestions, or use `/giveaway list`.');
      return;
    }

    if (sub === 'end') {
      if (g.status !== 'active') return void (await interaction.editReply(`❌ That giveaway is already ${g.status}.`));
      const done = await runtime.endGiveaway(client, guildId, id);
      if (!done) return void (await interaction.editReply("❌ I couldn't end that giveaway (is the channel still there?)."));
      logging.logToGuild(client, guildId, { title: '🎉 Giveaway ended', description: `**${truncate(done.prize, 100)}** (\`${id}\`) was ended by ${interaction.user.tag}.` });
      await interaction.editReply(done.winners.length ? `✅ Ended. Winner${done.winners.length === 1 ? '' : 's'}: ${done.winners.map((w) => `<@${w}>`).join(', ')}` : '✅ Ended - there were no valid entries, so nobody won.');
      return;
    }

    if (sub === 'reroll') {
      const res = await runtime.rerollGiveaway(client, guildId, id, interaction.options.getInteger('winners') || 1);
      await interaction.editReply(res.ok ? `✅ New winner${res.winners.length === 1 ? '' : 's'}: ${res.winners.map((w) => `<@${w}>`).join(', ')}` : `❌ ${res.reason}`);
      return;
    }

    if (sub === 'cancel') {
      if (g.status !== 'active') return void (await interaction.editReply(`❌ That giveaway is already ${g.status}.`));
      await runtime.cancelGiveaway(client, guildId, id);
      logging.logToGuild(client, guildId, { title: '🎉 Giveaway cancelled', description: `**${truncate(g.prize, 100)}** (\`${id}\`) was cancelled by ${interaction.user.tag}.`, level: 'warn' });
      await interaction.editReply('✅ Giveaway cancelled.');
    }
  },
};

async function create(interaction) {
  const guild = interaction.guild;
  const prize = interaction.options.getString('prize').trim();
  const durationMs = runtime.parseDuration(interaction.options.getString('duration'));

  if (!prize) return void (await interaction.editReply('❌ Please enter a prize.'));
  if (!durationMs) return void (await interaction.editReply('❌ I could not read that duration. Examples: `30m`, `2h`, `1d`, `1d12h`, `1w`.'));
  if (durationMs < runtime.MIN_DURATION_MS || durationMs > runtime.MAX_DURATION_MS) {
    return void (await interaction.editReply('❌ The duration must be between **1 minute** and **60 days**.'));
  }

  const channel = interaction.options.getChannel('channel') || interaction.channel;
  if (!channel || !TEXT_CHANNELS.includes(channel.type)) return void (await interaction.editReply('❌ Please pick a normal text or announcement channel.'));

  const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  const perms = me && channel.permissionsFor(me);
  if (perms && !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    return void (await interaction.editReply(`❌ I can't post in ${channel.toString()} yet - give me **View Channel**, **Send Messages** and **Embed Links** there.`));
  }

  const running = storage.listGiveaways(guild.id).filter((g) => g.status === 'active').length;
  if (running >= MAX_ACTIVE_PER_GUILD) return void (await interaction.editReply(`❌ This server already has ${MAX_ACTIVE_PER_GUILD} running giveaways. End or cancel one first.`));

  const role = interaction.options.getRole('role');
  if (role && role.id === guild.id) return void (await interaction.editReply("❌ @everyone can't be used as a requirement - just leave the role out."));

  const { giveaway: g, message } = await runtime.create(guild, channel, {
    prize,
    durationMs,
    winnersCount: interaction.options.getInteger('winners') || 1,
    hostId: interaction.user.id,
    requiredRoleId: role ? role.id : null,
    minDays: interaction.options.getInteger('min-days') || 0,
    conditions: (interaction.options.getString('conditions') || '').trim() || null,
  });

  logging.logToGuild(interaction.client, guild.id, {
    title: '🎉 Giveaway started',
    description: `**${truncate(prize, 100)}** (\`${g.id}\`) in ${channel.toString()} by ${interaction.user.tag}.`,
  });
  await interaction.editReply(`✅ Giveaway started in ${channel.toString()}: ${message.url}\nIt ends <t:${Math.floor(g.endsAt / 1000)}:R> and the winners are drawn automatically. ID: \`${g.id}\``);
}

module.exports = { giveaway };
