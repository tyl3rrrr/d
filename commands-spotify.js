// commands-spotify.js
// Spotify-Login, Now-Playing, Play/Pause/Skip (auf dem eigenen Gerät), Suche.
// Siehe spotify.js für die wichtige Einschränkung: kein Audio-Streaming in
// den Discord-Sprachkanal möglich - das erlaubt Spotifys API nicht.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const spotify = require('./spotify');

function formatSpotifyError(err) {
  if (err.message === 'NOT_LINKED') {
    return '❌ Du hast deinen Spotify-Account noch nicht verknüpft. Nutze zuerst `/spotify-login`.';
  }
  return `❌ Fehler: ${err.message}`;
}

function notConfiguredReply() {
  return {
    content:
      '❌ Spotify ist auf diesem Bot nicht eingerichtet. Der Betreiber muss `SPOTIFY_CLIENT_ID` und ' +
      '`SPOTIFY_CLIENT_SECRET` in der `.env` setzen (siehe README).',
    ephemeral: true,
  };
}

const spotifyLogin = {
  data: new SlashCommandBuilder().setName('spotify-login').setDescription('Verknüpft deinen Spotify-Account mit diesem Bot'),
  async execute(interaction) {
    if (!spotify.isConfigured()) {
      await interaction.reply(notConfiguredReply());
      return;
    }
    const url = spotify.createAuthUrl(interaction.user.id);
    await interaction.reply({
      content:
        `🎧 Klicke hier, um deinen Spotify-Account zu verknüpfen:\n${url}\n\n` +
        '_Der Link ist 10 Minuten gültig und nur für dich bestimmt - nicht weitergeben._\n\n' +
        'ℹ️ Hinweis: Dies verknüpft nur Now-Playing-Anzeige und Wiedergabesteuerung auf deinem eigenen ' +
        'Gerät - der Bot kann keine Musik in einen Discord-Sprachkanal streamen (Spotify erlaubt das nicht).',
      ephemeral: true,
    });
  },
};

const nowplaying = {
  data: new SlashCommandBuilder().setName('spotify-nowplaying').setDescription('Zeigt, was du aktuell auf Spotify hörst'),
  async execute(interaction) {
    if (!spotify.isConfigured()) {
      await interaction.reply(notConfiguredReply());
      return;
    }
    try {
      const current = await spotify.getNowPlaying(interaction.user.id);
      if (!current || !current.item) {
        await interaction.reply({ content: 'Aktuell läuft nichts auf deinem Spotify-Account.', ephemeral: true });
        return;
      }
      const track = current.item;
      const artists = track.artists.map((a) => a.name).join(', ');
      const embed = new EmbedBuilder()
        .setTitle(`🎵 ${track.name}`)
        .setDescription(`von ${artists}`)
        .setURL(track.external_urls.spotify)
        .setThumbnail(track.album.images[0]?.url || null)
        .setColor(0x1db954)
        .addFields(
          { name: 'Album', value: track.album.name },
          { name: 'Status', value: current.is_playing ? '▶️ Läuft' : '⏸️ Pausiert' }
        );
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      await interaction.reply({ content: formatSpotifyError(err), ephemeral: true });
    }
  },
};

const play = {
  data: new SlashCommandBuilder().setName('spotify-play').setDescription('Setzt deine Spotify-Wiedergabe fort (auf deinem aktiven Gerät)'),
  async execute(interaction) {
    if (!spotify.isConfigured()) {
      await interaction.reply(notConfiguredReply());
      return;
    }
    try {
      await spotify.controlPlayback(interaction.user.id, 'play');
      await interaction.reply({ content: '▶️ Wiedergabe fortgesetzt.', ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: formatSpotifyError(err), ephemeral: true });
    }
  },
};

const pause = {
  data: new SlashCommandBuilder().setName('spotify-pause').setDescription('Pausiert deine Spotify-Wiedergabe'),
  async execute(interaction) {
    if (!spotify.isConfigured()) {
      await interaction.reply(notConfiguredReply());
      return;
    }
    try {
      await spotify.controlPlayback(interaction.user.id, 'pause');
      await interaction.reply({ content: '⏸️ Pausiert.', ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: formatSpotifyError(err), ephemeral: true });
    }
  },
};

const skip = {
  data: new SlashCommandBuilder().setName('spotify-skip').setDescription('Überspringt den aktuellen Song'),
  async execute(interaction) {
    if (!spotify.isConfigured()) {
      await interaction.reply(notConfiguredReply());
      return;
    }
    try {
      await spotify.controlPlayback(interaction.user.id, 'next');
      await interaction.reply({ content: '⏭️ Übersprungen.', ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: formatSpotifyError(err), ephemeral: true });
    }
  },
};

const search = {
  data: new SlashCommandBuilder()
    .setName('spotify-search')
    .setDescription('Sucht einen Song auf Spotify')
    .addStringOption((opt) => opt.setName('suche').setDescription('Songtitel/Künstler').setRequired(true)),
  async execute(interaction) {
    if (!spotify.isConfigured()) {
      await interaction.reply(notConfiguredReply());
      return;
    }
    try {
      const tracks = await spotify.searchTrack(interaction.user.id, interaction.options.getString('suche'));
      if (tracks.length === 0) {
        await interaction.reply({ content: 'Keine Ergebnisse gefunden.', ephemeral: true });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle('🔍 Spotify-Suchergebnisse')
        .setColor(0x1db954)
        .setDescription(
          tracks
            .map((t, i) => `**${i + 1}.** [${t.name}](${t.external_urls.spotify}) - ${t.artists.map((a) => a.name).join(', ')}`)
            .join('\n')
        );
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      await interaction.reply({ content: formatSpotifyError(err), ephemeral: true });
    }
  },
};

module.exports = { spotifyLogin, nowplaying, play, pause, skip, search };
