// apply-runtime.js
// Runtime logic for the application ("apply") system: starting a DM
// interview when someone clicks an apply-panel button, collecting their
// answers via DM messages, submitting the finished application to the
// review channel, and handling the Accept/Deny buttons there.
//
// Limitation: an in-progress interview (someone who has been asked some but
// not all questions) lives only in memory - like /remindme, it is lost if
// the bot restarts mid-interview. A finished, submitted application is
// always saved to data.json and survives restarts (see storage.js).

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const storage = require('./storage');
const { getMemberLevel, LEVEL } = require('./permissions');
const { EPHEMERAL, errText, truncate } = require('./util');
const logging = require('./logging');

const START_PREFIX = 'apply_start:';
const ACCEPT_PREFIX = 'apply_accept:';
const DENY_PREFIX = 'apply_deny:';
const INTERVIEW_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of inactivity cancels the interview

// userId -> { guildId, guildName, typeId, typeLabel, questions, index, answers, timer }
const activeSessions = new Map();

function typeButtonId(typeId) {
  return `${START_PREFIX}${typeId}`;
}

function buildPanelRow(types) {
  const row = new ActionRowBuilder();
  for (const t of types.slice(0, 5)) {
    // Discord allows at most 5 buttons per action row.
    row.addComponents(new ButtonBuilder().setCustomId(typeButtonId(t.id)).setLabel(t.label).setStyle(ButtonStyle.Primary));
  }
  return row;
}

function clearSession(userId) {
  const session = activeSessions.get(userId);
  if (session?.timer) clearTimeout(session.timer);
  activeSessions.delete(userId);
}

function armTimeout(userId) {
  const session = activeSessions.get(userId);
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(async () => {
    activeSessions.delete(userId);
    try {
      const user = await session.client.users.fetch(userId);
      await user.send("⌛ Your application timed out after 30 minutes of inactivity. Feel free to start again with the apply panel.");
    } catch (err) {
      // DMs closed - nothing more we can do.
    }
  }, INTERVIEW_TIMEOUT_MS);
}

// Called from index.js when an "apply_start:<typeId>" button is clicked.
async function handleApplyStart(interaction, typeId) {
  const guild = interaction.guild;
  const types = storage.getApplyTypes(guild.id);
  const type = types.find((t) => t.id === typeId);

  if (!type) {
    await interaction.reply({ content: '❌ This application type no longer exists.', flags: EPHEMERAL });
    return;
  }
  if (!type.questions || type.questions.length === 0) {
    await interaction.reply({
      content: '❌ This application type has no questions configured yet. Ask an admin to run `/apply-config add-question`.',
      flags: EPHEMERAL,
    });
    return;
  }
  if (require('./ticket-runtime').hasSession(interaction.user.id)) {
    await interaction.reply({ content: '❗ You have an open ticket - write your message to me in DMs (or type `/ticket-close` to cancel it) before starting an application.', flags: EPHEMERAL });
    return;
  }
  if (activeSessions.has(interaction.user.id)) {
    await interaction.reply({ content: '❗ You already have an application in progress - check your DMs to continue it.', flags: EPHEMERAL });
    return;
  }

  const session = {
    guildId: guild.id,
    guildName: guild.name,
    typeId: type.id,
    typeLabel: type.label,
    questions: type.questions,
    index: 0,
    answers: [],
    client: interaction.client,
  };

  try {
    await interaction.user.send(
      `📋 **Application: ${type.label}** (on ${guild.name})\n` +
        `I'll ask you ${type.questions.length} question(s) one at a time - just reply here with your answer to each.\n\n` +
        `**Question 1/${type.questions.length}:** ${type.questions[0]}`
    );
  } catch (err) {
    await interaction.reply({
      content: "❌ I couldn't DM you - please enable direct messages from server members and try again.",
      flags: EPHEMERAL,
    });
    return;
  }

  activeSessions.set(interaction.user.id, session);
  armTimeout(interaction.user.id);
  await interaction.reply({ content: "📬 Check your DMs - I've sent you the first question!", flags: EPHEMERAL });
}

// Called from index.js's MessageCreate handler for DMs from a user with an active session.
async function handleDMAnswer(message) {
  const session = activeSessions.get(message.author.id);
  if (!session) return false; // not an active applicant - let other handlers process the message

  session.answers.push({ question: session.questions[session.index], answer: truncate(message.content, 1000) });
  session.index++;

  if (session.index < session.questions.length) {
    armTimeout(message.author.id);
    await message.channel.send(`**Question ${session.index + 1}/${session.questions.length}:** ${session.questions[session.index]}`);
    return true;
  }

  // Interview complete - submit it.
  clearSession(message.author.id);
  await message.channel.send('✅ Thanks! Your application will be reviewed as soon as possible.');

  const client = message.client;
  const guild = client.guilds.cache.get(session.guildId);
  const settings = storage.getGuildSettings(session.guildId);

  const record = storage.addApplication(session.guildId, {
    typeId: session.typeId,
    typeLabel: session.typeLabel,
    userId: message.author.id,
    userTag: message.author.tag,
    answers: session.answers,
    createdAt: Date.now(),
  });

  if (!settings.applyReviewChannelId) {
    console.warn(`Applications: no review channel set on ${session.guildId} - application ${record.id} was saved but not posted anywhere.`);
    return true;
  }
  const channel = guild?.channels.cache.get(settings.applyReviewChannelId);
  if (!channel || !channel.isTextBased()) {
    console.warn(`Applications: review channel ${settings.applyReviewChannelId} on ${session.guildId} is missing or not text-based.`);
    return true;
  }

  const embed = new EmbedBuilder()
    .setTitle(`📋 New Application: ${session.typeLabel}`)
    .setColor(0x5865f2)
    .setDescription(`From <@${message.author.id}> (${message.author.tag})`)
    .addFields(session.answers.map((a, i) => ({ name: truncate(`${i + 1}. ${a.question}`, 256), value: truncate(a.answer, 1024) })))
    .setFooter({ text: `Application ID: ${record.id}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${ACCEPT_PREFIX}${record.id}`).setLabel('Accept').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`${DENY_PREFIX}${record.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji('❌')
  );

  try {
    await channel.send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.warn(`Applications: could not post application ${record.id} to the review channel:`, errText(err));
  }
  return true;
}

// Called from index.js when an "apply_accept:<id>" / "apply_deny:<id>" button is clicked.
async function handleReviewButton(interaction, accept, applicationId) {
  if (getMemberLevel(interaction.guild, interaction.member) < LEVEL.MOD) {
    await interaction.reply({ content: "❌ You don't have permission to review applications.", flags: EPHEMERAL });
    return;
  }

  const application = storage.getApplication(interaction.guildId, applicationId);
  if (!application) {
    await interaction.reply({ content: '❌ This application no longer exists (maybe already deleted).', flags: EPHEMERAL });
    return;
  }
  if (application.status !== 'pending') {
    await interaction.reply({ content: `❗ This application was already **${application.status}** by <@${application.reviewerId}>.`, flags: EPHEMERAL });
    return;
  }

  const status = accept ? 'accepted' : 'denied';
  storage.updateApplication(interaction.guildId, applicationId, { status, reviewerId: interaction.user.id, reviewedAt: Date.now() });

  const originalEmbed = interaction.message.embeds[0];
  const updatedEmbed = originalEmbed
    ? EmbedBuilder.from(originalEmbed)
        .setColor(accept ? 0x57f287 : 0xed4245)
        .setFooter({ text: `${accept ? 'Accepted' : 'Denied'} by ${interaction.user.tag} - Application ID: ${applicationId}` })
    : new EmbedBuilder().setDescription(`${accept ? 'Accepted' : 'Denied'} by ${interaction.user.tag}`);

  await interaction.update({ embeds: [updatedEmbed], components: [] });

  const type = storage.getApplyTypes(interaction.guildId).find((t) => t.id === application.typeId);
  if (accept && type?.roleId) {
    try {
      const member = await interaction.guild.members.fetch(application.userId);
      await member.roles.add(type.roleId, `Application ${applicationId} accepted by ${interaction.user.tag}`);
    } catch (err) {
      console.warn(`Applications: could not grant role for application ${applicationId}:`, errText(err));
    }
  }

  try {
    const applicant = await interaction.client.users.fetch(application.userId);
    await applicant.send(
      accept
        ? `🎉 Your application for **${application.typeLabel}** on **${interaction.guild.name}** was **accepted**! Welcome aboard.`
        : `Your application for **${application.typeLabel}** on **${interaction.guild.name}** was **denied**. Thanks for applying.`
    );
  } catch (err) {
    // DMs closed - not critical.
  }

  logging.logToGuild(interaction.client, interaction.guildId, {
    title: `📋 Application ${status}`,
    fields: [
      { name: 'Applicant', value: application.userTag, inline: true },
      { name: 'Type', value: application.typeLabel, inline: true },
      { name: 'By', value: interaction.user.tag, inline: true },
    ],
  });
}

function hasSession(userId) {
  return activeSessions.has(userId);
}

module.exports = { hasSession, START_PREFIX, ACCEPT_PREFIX, DENY_PREFIX, typeButtonId, buildPanelRow, handleApplyStart, handleDMAnswer, handleReviewButton };
