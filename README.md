# Pokémon Emerald observer

A small, read-only starting point for a Pokémon Emerald project. It connects to **your** RetroArch installation running the mGBA core and **your** Emerald ROM. It does not bundle an emulator or ROM.

The current command can:

- Check whether RetroArch is running content.
- Read the player's map group, map number, and X/Y through RetroArch's memory read command.
- Fetch your locked Hardcore achievements from the official RetroAchievements web API.

It cannot yet verify Hardcore activity, press game buttons, save the game, or run Jev. In particular, it is not an autonomous achievement player. [RetroAchievements prohibits bots and complex scripts from earning achievements](https://docs.retroachievements.org/guidelines/users/global-leaderboard-and-achievement-hunting-rules.html).

## Setup

1. Install Node.js 20 or newer and run `npm ci`.
2. Start your RetroArch with the mGBA core and your own supported Pokémon Emerald ROM. Configure your RetroAchievements account in RetroArch if you want achievements.
3. Enable RetroArch Network Commands on its default UDP port 55355. Bind it to `127.0.0.1` if possible.
4. Supply the `gSaveBlock1Ptr` address for **your exact ROM build**, preferably via a matching `pokeemerald.sym` file. An address from another build may decode the wrong memory.

```powershell
npm run probe -- --symbol-file 'C:\path\to\pokeemerald.sym'
```

To also fetch your achievement list, set your [RetroAchievements web API key](https://api-docs.retroachievements.org/getting-started.html) in the local environment. Do not commit the key.

```powershell
$env:RA_WEB_API_KEY = '<your key>'
npm run probe -- --symbol-file 'C:\path\to\pokeemerald.sym' --game-id <game-id> --username <username>
```

The ROM must be recognized by RetroAchievements; confirm its hash in RetroArch. The API game ID and symbol address must correspond to that ROM. You can omit the symbol option to check RetroArch status and fetch achievements, or omit API options to check status and position.

Run `npm run typecheck` to check the complete project. No generated Pokémon Red data is needed.

## Limits

The probe uses only `GET_STATUS` and `READ_CORE_MEMORY`. RetroArch documents these as read commands, but we have not verified on a live RetroArch/mGBA session that observation leaves Hardcore active. The web API may lag behind an unlock. RetroArch does not expose a Hardcore-active status through this command interface, so confirm it in RetroArch itself. No emulator save states are used; any future gameplay recovery must use Emerald's in-game save and a fresh boot followed by Continue.

Sources: [RetroArch network commands](https://docs.libretro.com/development/retroarch/network-control-interface/), [pokeemerald SaveBlock1](https://github.com/pret/pokeemerald/blob/master/include/global.h), [official achievement API](https://api-docs.retroachievements.org/v1/get-game-info-and-user-progress.html).

This repository is a fork of [christianmat/jev-pokemon](https://github.com/christianmat/jev-pokemon). Licensed under GPL-2.0-or-later; see [LICENSE](LICENSE).
