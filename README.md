# tylxrrrr Discord Bot (v7.2)

A single, flat Node.js folder (no subfolders) built on discord.js v14. This
README is deliberately the **only** Markdown file in this delivery.

---

## 1. Quick start

```bash
npm install
cp .env.template .env      # then fill in DISCORD_TOKEN (and anything else you need)
npm run deploy               # registers all slash commands with Discord
npm start                     # starts the bot
```

`npm run deploy` checks **every** command against Discord's name/length/
structure rules (see `command-tools.js`) **before** sending, and aborts with
a clear error message instead of firing an unvalidated request at the API.
This rules out crashes from invalid commands (e.g. a command name with
capital letters) - that was the cause of an earlier crash,
`ExpectedConstraintError ... given: 'bStatNow'`: Discord requires slash
command names to be **entirely lowercase**. The command is now correctly
named `/bstatnow`.

The bot also **automatically re-registers its commands on every startup** if
anything changed (`AUTO_DEPLOY=true`, the default) - that was the main cause
of "Unknown Command" errors: the running bot code and the list registered
with Discord had drifted apart. `npm run deploy` remains available for
manual/targeted registration and never fails with an unclear API error
because everything is validated locally first.

## 2. Discord Developer Portal - required settings

- **Bot -> Privileged Gateway Intents:**
  - `SERVER MEMBERS INTENT` - for the welcome system (new members).
  - `MESSAGE CONTENT INTENT` - for the `!support` text command.
  - If either is missing, the bot still starts **anyway**: it detects this
    automatically (`DisallowedIntents`) and restarts without the missing
    intent, but loudly reports in the console which feature that disables.
    `/welcome-setup` also shows a direct warning in Discord when the Server
    Members Intent is missing.
- **Installation -> Installation Contexts:** also enable "User Install" in
  addition to "Guild Install" so people can install the bot to their own
  account without inviting it to a server (see sections 6/12 below).
- **Bot permissions** (request these when inviting the bot): Administrator
  is simplest; the minimum needed is: Kick/Ban Members, Moderate Members
  (Timeout), Manage Messages, Manage Channels, Manage Roles, Manage Guild
  (for AutoMod), Manage Nicknames, Send Messages, Create Instant Invite
  (for the global XP server link), View Channels.

## 3. Central architecture (important for future changes)

| File | Purpose |
|---|---|
| `commands.js` | **The one place** where every command is registered - with category (for `/help`) and access level (for `permissions.js`). New command? Add one line here. |
| `permissions.js` | Central permission check. No command checks permissions itself anymore - `index.js` calls `guardInteraction()` before every execution. Rank levels: mod role < admin role/Discord Administrator < server owner. |
| `command-tools.js` | Builds & validates the Discord payload, registers globally, cleans up outdated server commands, auto-syncs on bot startup. |
| `storage.js` | One `data.json` file in the folder, settings separated per server (`guilds[guildId]`), XP data separated per server (`xp[guildId][userId]`). Writes atomically (temp file + rename), backs up a corrupted `data.json` instead of overwriting it. |
| `automod-api.js` | AutoMod **exclusively via the official Discord AutoMod API** - no local message filter in the bot code anymore. |
| `logging.js` | Central logging into the channel set via `/settings log-channel`. |
| `xp.js` / `xp-runtime.js` | XP/level curve and runtime logic (message XP, level roles, leaderboard updates), respectively. |
| `presence.js` | Bot online status (bot-wide, see the limitation below). |
| `apply-runtime.js` | DM-interview state machine and Accept/Deny button logic for the applications system (see `commands-apply.js`). |

## 4. Fixes made after your test feedback (this round)

- **`/appearence color` -> "Missing guild feature":** the code always sent
  the `colors` field (gradient/holographic), which Discord only accepts with
  "Enhanced Role Styles" - that rejected EVERY color, even a plain one.
  Fixed: a plain color (only `primary`) now uses the classic `color` field
  directly; the `colors` field is only attempted for `secondary`/
  `holographic` (with a fallback to `color` if the server doesn't support it).
- **`/automod setup` -> still failing with "Invalid Form Body" / "max rules
  of type exceeded":** Discord only allows a limited number of rules **per
  type per server**, regardless of who created them. The previous version
  only adopted existing rules it recognized by exact name, and still tried
  to create new ones when it didn't recognize a rule - which could still hit
  the per-type cap. **Fixed with a clean-slate approach, as requested:**
  `/automod setup` now **deletes every existing AutoMod rule on the server
  first** (any type, any creator), then creates the 5 standard rules fresh.
  This can never hit "max rules of type exceeded" again, because nothing is
  left over when it creates the new ones. Verified with a mock that
  reproduces the exact reported scenario (all 5 rule types already at their
  maximum from foreign rules) - now resolves cleanly with 0 errors.
- **New: `/automod setup-all` (bot owner only)** rolls the same clean-slate
  setup out to **every server the bot is in**, not just the one the command
  was run on - exactly as requested ("publish on all servers").
- **`/welcome-setup`: no message, no role:** the most likely cause is the
  privileged **"SERVER MEMBERS INTENT"** in the Discord Developer Portal -
  if it isn't enabled, the bot automatically starts WITHOUT it (see
  `index.js`, `INTENT_PLANS`), and Discord then never sends the join event,
  no matter the configuration. `/welcome-setup` now shows this as a clear
  warning directly in its reply, with a link to the Developer Portal and
  the exact click path. Also, **bots** are now greeted too (previously
  excluded on purpose - per your feedback, that's not wanted).
- **Bot status appeared "global" / changeable by "other people":** not a
  bug, but a real Discord limitation - presence (Online/DND/...) belongs to
  the bot's ONE gateway connection and is identical across ALL servers at
  once; Discord doesn't offer per-server separation for this. Since
  `/bot-status` used to be open to every server's administrator, that meant
  an administrator of ANY server the bot is in could change the status on
  EVERY OTHER server - exactly what looked like "other people can affect
  this". Fixed: `/bot-status` is now **exclusively** for the bot owner (like
  `/bstatnow`) - the one person already responsible for the bot everywhere
  it runs. A genuine per-server separation of presence isn't possible via
  the Discord API, no matter the code.
- **Full English translation:** every user-facing string (command/option
  descriptions, embeds, replies, error messages) and every code comment/log
  message across all 28 files is now in English.

## 5. `/bot-status` - expanded (new subcommands)

`/bot-status` (bot owner only) now has five subcommands instead of a single
choice list:
- `view` - shows the current status, who last changed it, and a short
  change history (up to 5 recent entries).
- `set` - sets the online status (online/idle/dnd/invisible) and, in the
  same call, an optional custom activity (Playing/Watching/Listening + text).
- `streaming` - switches to Twitch streaming (defaults to the configured
  name, `TWITCH_NAME` in `.env`, currently `0tylxrrrr`).
- `clear-activity` - keeps the current status but removes any custom
  activity/streaming link.
- `auto` - switches back to automatic mode (shows the current server count).

`/bstatnow` (superuser ID only) keeps its own, separate set of subcommands
(`config`, `set-status`, `streaming`, `activity`, `auto`) as before, per the
original brief that this one specific ID must be able to configure presence
directly.

## 6. New features (this round)

### `/ticket-panel` no longer shows "used /ticket-panel" publicly
Discord's ephemeral responses hide the entire interaction notice (not just
the reply content) from everyone except the person who ran the command.
`/ticket-panel` (and the new `/apply-panel`, see below) now reply
ephemerally with a short confirmation, then post the actual panel as a
plain channel message - so it looks exactly like a normal bot post, with no
visible "@user used /command" trace for anyone else.

### Applications ("apply") system
A full application/recruitment flow, entirely new:
- `/apply-config` (admin) configures up to 5 application types (e.g.
  Developer/Moderator/Administrator) - `add-type`, `remove-type`,
  `add-question`/`remove-question` (up to 15 questions per type, asked in
  order), `set-role` (an optional role granted automatically on acceptance),
  `set-review-channel` (where submissions are posted), and `list`. The
  `type` option has autocomplete, so you don't have to retype exact names.
- `/apply-panel` (admin) posts a panel with one button per configured type
  (ephemeral confirmation + plain channel message, see above).
- Clicking a button DMs the applicant the first question; each reply in
  that DM is recorded and the next question follows, until all are
  answered. The bot then DMs "Your application will be reviewed as soon as
  possible" and posts the full Q&A as an embed with **Accept**/**Deny**
  buttons in the review channel.
- Only moderators/admins can press Accept/Deny. Doing so edits the embed to
  show the decision and reviewer, DMs the applicant the result, and (on
  acceptance) grants the configured role if one was set. Everything is
  logged to the log channel.
- Submitted applications are saved to `data.json` and survive a restart;
  an **in-progress** interview (questions asked but not yet all answered)
  lives only in memory and is lost on restart, the same trade-off as
  `/remindme`. An abandoned interview also auto-cancels after 30 minutes of
  inactivity, with a DM saying so.
- Needs the (non-privileged) `DirectMessages` gateway intent to receive the
  applicant's DM replies - already added in `index.js`, no Developer Portal
  toggle required. DM content is available regardless of the privileged
  Message Content Intent (that one only restricts guild messages), so this
  works under every intent fallback plan.

### `/suggest` reworked into a prompt-and-collect flow
Running `/suggest` (no options anymore) replies ephemerally asking "What do
you want to suggest?" - your next message in that channel (within 5
minutes) is captured, forwarded as an embed to the channel configured via
`/config suggest`, and then deleted (keeping the channel clean, since it
was just a prompt/response exchange). You get a DM confirming "Your
suggestion has been sent!". A DM-based prompt/answer couldn't satisfy the
"delete the message afterward" part of the request - bots have no
permission to delete messages other users sent in a DM - so this uses an
in-channel exchange instead, where deleting is possible.

### `/config suggest`
A small, separate settings command (as requested, distinct from
`/settings`) that sets the channel `/suggest` posts to. Built as its own
command/file so more `/config <topic>` subcommands can be added later
without growing `/settings`.

### Welcome DM text updated
The default DM sent to new members is now: *"Hello {user}, enjoy your time
on **{server}**! Be respectful and nice!"* - matching the wording you asked
for. The public channel message's default was already exactly *"Welcome to
the Server {user}! You are Member Number {number}"* and is unchanged.
`{user}` renders as an `@mention`, which is what actually displays as
"@username" in Discord's client.

## 7. Implemented points (brief, items 1-17)

### 1) `/appearence` - appearance
Reference image was **IMG_2347** (bot profile card: avatar, green online
dot, "APP" tag, gradient name). Implemented via `/appearence overview|
nickname|profile|color`:
- `overview` (everyone): shows name, status, name color, badges (incl.
  "Uses AutoMod"), available features, and the bot's permissions on this server.
- `nickname`/`profile` (admin): the bot's server nickname, avatar, banner,
  bio (`PATCH /guilds/{id}/members/@me`).
- `color` (admin): name color/gradient/holographic via the bot's own,
  permission-less cosmetic role, assigned to itself. Gradient/holographic
  needs "Enhanced Role Styles" on the server (3 boosts) - without it, the
  command automatically falls back to a solid color and says so. The "APP"
  tag is set by Discord itself and can't be influenced.

### 2) Welcome system
`/welcome-setup` (admin) with `role`, `channel`, `dm`, custom `message`/
`dm-message` text (placeholders `{user} {username} {server} {number}`), and
`reset`. Stored strictly per server. A default text is provided. On join it
automatically grants the role, posts the message, optionally sends a DM, and
logs to the log channel - all fault-tolerant (missing permissions/role
above the bot's own role, etc. are caught and noted in the console/log
channel, never crashing the bot). Greets bots too (see section 4).

### 3) Central permissions
See `permissions.js` above. Every mod/admin command now only declares its
required level in `commands.js`; the check (including rank-vs-rank for
moderation actions, so a moderator can't ban an admin) runs centrally.
Missing permission -> ephemeral error message.

### 4) Slash command registration / "Unknown Command"
Auto-sync on every startup + local validation before every send (see
section 1). `/help` reads the list automatically from `commands.js` - no
command can ever be "forgotten".

### 5) AutoMod badge
`/automod setup` creates the 5 possible standard rules via the **Discord
AutoMod API** - at most 10 rules per server (Discord's limit), now always
starting from a clean slate (see section 4). `/automod status` additionally
shows the bot owner the real progress toward the "Uses AutoMod" badge: per
Discord's developer help center, it needs **at least 100 self-created
AutoMod rules across all servers** - the "100 / 12 rules" math from the
original brief is NOT the official basis and was deliberately not used. With
e.g. 9 servers and a max of 10 rules/server, at most 90 rules are possible -
not enough for 100, regardless of the code. `/automod status` shows this
live (bot owner only) and explains the minimum number of servers needed.

### 6) Removed: Spotify & developer commands; `/uptime` reset; usable without an invite
- `commands-dev.js`, `commands-spotify.js`, `spotify.js` deleted; stored
  Spotify tokens are automatically dropped from `data.json` on first save
  (migration, no manual step needed).
- `/uptime` now measures **process** uptime (`config.js`,
  `PROCESS_STARTED_AT`) instead of connection time - guaranteed to start at 0
  whenever the bot **process** restarts (bot restart or host power cycle).
- User install enabled (see section 2, "Installation Contexts") - most
  commands work without inviting the bot to a server (exceptions:
  anything that inherently needs a server, e.g. moderation, welcome, XP).

### 8) `/help`
Generated automatically from `commands.js`, sorted by category (General,
Moderation, Administration, Welcome, Tickets, Utility, XP, Bot). Shows each
command's subcommands and required access level.

### 9) `/adm-reload`
Performs a **real process restart** (`process.exit(0)`), not just a
`.env` reload (that's still `/reload`, bot owner only). **Limitation:**
Node.js can't replace itself - the process must exit and be restarted
automatically by a process manager (systemd with `Restart=always`, PM2,
Docker with `--restart unless-stopped`, Railway/Render, etc.). **Without**
such auto-restart, the bot stays offline after `/adm-reload` until started
manually - that can't be worked around from Discord/Node.js.

### 10) Bot status with server count
Runs automatically in the background (`presence.js`): shows "👀 X servers"
by default, refreshes immediately on join/leave and otherwise sparingly
every 10 minutes (no unnecessary API calls). `/bstatnow` (**exclusively**
superuser ID `1324102364608598118`) switches to manual mode and configures
status/activity/streaming in detail; `/bstatnow auto` switches back to the
automatic server-count mode.

**Naming conflict resolved:** the bot already had an existing `/status`
command ("checks whether the website is reachable") - per the brief, that
was NOT removed without an explicit request. The new presence command is
therefore called **`/bot-status`** (see section 5 for its full feature set).

### 11) `/bot-status`
See section 5 above for its subcommands. Twitch mode always uses the
centrally configured name `0tylxrrrr` (`config.js`, overridable via
`.env`/`TWITCH_NAME`, not duplicated across the code).

**Honest technical limitation:** Discord presence (online dot, activity)
belongs to the **bot account itself** and is therefore identical across
**all** servers at once - Discord provides no way to show it differently
per server. "Configurable per server" is implemented so that the most
recently chosen setting by any authorized user applies bot-wide (with a
note of who/where it was set) - a true per-server separation isn't possible
via the Discord API. Access is restricted to the bot owner (see section 4)
so this power isn't spread across every server's administrators.

### 12) Bot logs
`/settings log-channel` (admin, stored per server). Logged events: kick/ban/
timeout/warn/clear/nickname changes, role add/remove, slowmode/lock/unlock,
`/say` usage, tickets created/closed, members joining, setting changes
(admin/mod role, log channel), bot restarts, XP level-ups, and interaction
errors. **Never** logs tokens/API keys (`logging.js` only ever sends the
harmless fields passed in to it).

### 13) Duplicate/old commands removed
Every command now runs through the one registry `commands.js` - a built-in
check (in `commands.js`, on load) throws a clear error if a name is ever
duplicated again, instead of letting Discord silently register two
conflicting definitions. Old, UUID-style test commands from earlier
versions are no longer part of the registry and get removed at Discord
automatically on the first auto-sync (`clearStaleGuildCommands`/diff
against the global list).

### 14) XP/level system
- XP is awarded on sending a message (5-15 XP, 15-second cooldown per user/
  server against spam-farming), stored **strictly per server**
  (`storage.xp[guildId][userId]`).
- **Level curve:** linear, level 1 costs exactly 15 XP as requested, each
  further level costs 15 XP more than the previous one (`xp.js`) - so every
  XP total maps to exactly one level, no contradictory values possible.
- **Level roles** `Level 1, 10, 20, ..., 100` and then automatically every
  10 levels after that, created per server individually (only created when
  that level is actually reached, not pre-created for every possible level).
  Missing permission/role-too-low is caught, logged, and never crashes the bot.
- On level-up: role granted (if it's a milestone), a DM with level/XP/any
  new role, and a log entry.
- `/xp-board` (admin): sets the leaderboard channel; the message is
  **edited** every 24 hours instead of being reposted.
- `/xp-set` (**exclusively** the hardcoded user ID
  `1324102364608598118` - checked directly in code in addition to the
  central permission check): sets a user's XP/level, even on a different
  server (`server` option with a server ID, since the database structure -
  separated per server - allows it).
- `/xp-stats` (everyone): your own or someone else's stats including global
  rank and a progress bar to the next level.
- `/xp-global` (everyone): global leaderboard across all servers ("User |
  Rank | Server" format), servers are **clickable** as long as the bot has
  "Create Instant Invite" permission in a text channel - then a single
  invite with `max_age: 0` (treated by Discord as "never expires") is
  created once and reused. Discord can still invalidate such an invite
  server-side (e.g. if the channel is deleted) - a truly permanently
  guaranteed link isn't possible via the Discord API, only the best
  available one.

### 15) Database/server isolation
All server settings live under `guilds[guildId]`, all XP data under
`xp[guildId][userId]` - one server structurally cannot affect another
server's values. The global leaderboard is built purely by reading and
aggregating these separate per-server datasets (`storage.getGlobalLeaderboard`),
never changing a single server's values.

## 8. Command overview

| Category | Commands |
|---|---|
| General | `/antimdm` `/web` `/uptime` `/status` `/changelog` `/links` `/botinfo` `/ping` `/help` |
| Moderation (mod+) | `/kick` `/ban` `/timeout` `/warn` `/clear` `/slowmode` `/lock` `/unlock` `/nickname` `/role` `/purge-user` `/say` |
| Administration (admin) | `/settings` `/config suggest` `/automod-words` `/automod setup\|status\|remove` `/appearence nickname\|profile\|color` `/adm-reload` |
| Bot owner/superuser | `/reload` (owner) `/bot-status` (owner) `/automod setup-all` (owner) `/bstatnow` (superuser ID only) |
| Welcome | `/welcome-setup` |
| Applications | `/apply-config` (admin) `/apply-panel` (admin) (+ apply/Accept/Deny buttons) |
| Tickets | `/ticket-panel` (+ "Create Ticket"/"Close" buttons) |
| XP | `/xp-board` (admin) `/xp-set` (superuser ID only) `/xp-stats` `/xp-global` |
| Utility/fun | `/userinfo` `/serverinfo` `/avatar` `/poll` `/remindme` `/suggest` `/coinflip` `/dice` `/8ball` `/membercount` `/roleinfo` |
| Text command | `!support <request>`, `!support config` |

## 9. Required dependencies

```json
"discord.js": "^14.16.3",
"dotenv": "^16.4.5"
```
Nothing else - no database drivers, no extra packages.

## 10. Required `.env` variables

See `.env.template` (a copyable starting point). Only `DISCORD_TOKEN` is
required; everything else has a sensible default or is optional.

## 11. Database

A single `data.json` file in the folder (created automatically on first
start, listed in `.gitignore`). Contains: `guilds` (per-server settings),
`warns`, `xp` (per-server XP), `meta` (incl. the command hash for auto-sync,
presence configuration). Writes atomically and automatically backs up the
file if it's ever corrupted (`data.json.corrupt-*`) instead of losing data.

## 12. How to start the bot

```bash
npm install
npm start          # equivalent to: node --max-old-space-size=1536 index.js
```

For a real auto-restart after `/adm-reload`, use a process manager, e.g. PM2:

```bash
npm install -g pm2
pm2 start index.js --name tylxrrrr-bot --max-memory-restart 1536M
```

## 13. Known limitations (technically justified, see details above)

- Bot presence is identical across every server at once (sections 5/10/11).
- A server invite that's "permanent forever" can't be guaranteed, only the
  technically best available one (`max_age: 0`) (section 14).
- `/adm-reload` needs a process manager with auto-restart, otherwise the
  bot stays offline after the restart command (section 9).
- The "Uses AutoMod" badge depends on Discord itself (at least 100 rules
  across all servers) - the bot can create the prerequisite (`/automod
  setup` or `/automod setup-all` on every server), but granting the badge
  itself is entirely up to Discord.
- If the privileged intents (Developer Portal) are missing, the welcome
  system and `!support` start automatically disabled instead of blocking
  the bot from starting - and `/welcome-setup` warns about this directly.
- An in-progress application interview (some but not all questions
  answered) lives only in memory and is lost on a bot restart - a
  submitted/completed application is always saved and survives restarts.
- `/suggest`'s "reply within 5 minutes" step is a live Discord message
  collector - it does not survive a bot restart either, the same trade-off
  as `/remindme`.

## 14. Tests performed

- Every `.js` file checked with `node --check` for syntax errors.
- The complete command registry (`commands.js`) loaded offline against a
  Discord API simulation: every command (including `/apply-config`,
  `/apply-panel`, `/config`) serializes to JSON without errors, no duplicate
  names, no invalid (upper/lowercase) names, and autocomplete is correctly
  attached to `/apply-config`.
- `command-tools.validatePayload` ran against the real, complete payload:
  0 errors.
- The full `index.js` startup path (requires, client construction with the
  new `DirectMessages` intent, event wiring) was run end-to-end against a
  Discord API simulation up to the actual `login()` call (which can't be
  tested without real network access here).
- **The application system's DM interview was simulated end-to-end**:
  starting an application, answering both configured questions via
  simulated DM messages, and confirming the bot sends the next question
  each time and finally posts the completed application (as an embed with
  Accept/Deny buttons) to the review channel.
- `storage.js`'s new application functions (`addApplication`,
  `getApplication`, `updateApplication`, `getApplyTypes`/`setApplyTypes`)
  were verified with test data, including status updates.
- **`/automod setup`'s reset-then-create flow was tested against a mock
  that enforces Discord's real per-type rule limits**, reproducing the
  exact reported scenario (all 5 rule types already at their maximum, from
  rules with foreign names/creators): result is now 10/10 rules removed,
  all 5 standard rules created, 0 errors. `/automod setup-all` was verified
  across three simulated servers in different states (existing rules, no
  rules, different rule types) - all three processed correctly.
- The XP/level curve was worked out with simulated messages (level 1 costs
  exactly 15 XP, then increases linearly, milestone levels detected correctly).
- `storage.js` functions (leaderboards, server separation) verified with
  test data across multiple servers/users.

**Not possible in this environment:** an actual login to Discord (no
network access here) - please run `npm run deploy` and `npm start` once on
your end and let me know if anything still comes up.
