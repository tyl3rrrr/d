// spotify.js
//
// Spotify-OAuth (Authorization Code Flow) + Spotify Web API Client.
//
// WICHTIGE EINSCHRÄNKUNG (von Spotify selbst vorgegeben, nicht umgehbar):
// Die Spotify-API erlaubt es NICHT, Audio-Streams von Spotify in eine
// Drittanwendung (wie einen Discord-Sprachkanal) einzuspeisen - das wäre
// eine Lizenzverletzung. Was die API erlaubt, und was hier genutzt wird:
// - Login/Verknüpfung des eigenen Spotify-Accounts
// - Anzeigen, was aktuell läuft ("Currently Playing")
// - Steuern der Wiedergabe auf dem eigenen, BEREITS GEÖFFNETEN Spotify-Gerät
//   (Play/Pause/Skip - das ist die offizielle "Spotify Connect"-Funktion)
// - Songsuche im Spotify-Katalog
//
// Es wird KEIN Audio im Discord-Sprachkanal abgespielt - das kann kein Bot,
// der über die offizielle Spotify-API arbeitet.

const crypto = require('crypto');
const storage = require('./storage');

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:8888/callback';

const SCOPES = ['user-read-currently-playing', 'user-read-playback-state', 'user-modify-playback-state'].join(' ');

// state -> discordUserId (nur temporär während des Login-Vorgangs im Speicher)
const pendingStates = new Map();

function isConfigured() {
  return Boolean(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET);
}

function createAuthUrl(discordUserId) {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, discordUserId);
  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000); // 10 Min. gültig

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: SCOPES,
    state,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function consumeState(state) {
  const userId = pendingStates.get(state);
  pendingStates.delete(state);
  return userId || null;
}

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
}

async function exchangeCodeForToken(code) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_REDIRECT_URI }),
  });
  if (!res.ok) throw new Error(`Spotify-Token-Fehler (${res.status})`);
  return res.json();
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`Spotify-Refresh-Fehler (${res.status})`);
  return res.json();
}

async function getValidAccessToken(discordUserId) {
  const tokens = storage.getSpotifyTokens(discordUserId);
  if (!tokens) return null;

  if (Date.now() < tokens.expiresAt - 30000) {
    return tokens.accessToken;
  }

  const refreshed = await refreshAccessToken(tokens.refreshToken);
  const newTokens = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
  };
  storage.setSpotifyTokens(discordUserId, newTokens);
  return newTokens.accessToken;
}

async function spotifyFetch(discordUserId, endpoint, options = {}) {
  const token = await getValidAccessToken(discordUserId);
  if (!token) throw new Error('NOT_LINKED');

  return fetch(`https://api.spotify.com/v1${endpoint}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
}

async function getNowPlaying(discordUserId) {
  const res = await spotifyFetch(discordUserId, '/me/player/currently-playing');
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Spotify-API-Fehler (${res.status})`);
  return res.json();
}

async function controlPlayback(discordUserId, action) {
  const endpointMap = { play: '/me/player/play', pause: '/me/player/pause', next: '/me/player/next' };
  const method = action === 'next' ? 'POST' : 'PUT';
  const res = await spotifyFetch(discordUserId, endpointMap[action], { method });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify-API-Fehler (${res.status}) - läuft evtl. kein Spotify auf einem Gerät?`);
  }
}

async function searchTrack(discordUserId, query) {
  const params = new URLSearchParams({ q: query, type: 'track', limit: '5' });
  const res = await spotifyFetch(discordUserId, `/search?${params.toString()}`);
  if (!res.ok) throw new Error(`Spotify-Suche fehlgeschlagen (${res.status})`);
  const data = await res.json();
  return data.tracks.items;
}

module.exports = {
  isConfigured,
  createAuthUrl,
  consumeState,
  exchangeCodeForToken,
  getNowPlaying,
  controlPlayback,
  searchTrack,
};
