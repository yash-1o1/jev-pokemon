# Emerald read-only probe

This is the first Windows-facing component of the Emerald adaptation. It is separate from the existing Pokémon Red runner. It sends only `GET_STATUS` and `READ_CORE_MEMORY` to RetroArch and can fetch a snapshot of RetroAchievements progress. It has no controller input, memory writes, save states, or autonomous gameplay.

## Requirements

- RetroArch with the mGBA core and your own supported Pokémon Emerald ROM.
- Network Commands enabled in RetroArch (`network_cmd_enable = "true"`), bound to `127.0.0.1` if possible. The default UDP port is 55355.
- A `pokeemerald.sym` for the **exact ROM build** to resolve `gSaveBlock1Ptr`, or its verified address supplied explicitly. A symbol from a different build can produce wrong state.
- Optional: your RetroAchievements web API key, username, and the game ID confirmed for your ROM hash. Put the key in the `RA_WEB_API_KEY` environment variable; never commit it.

Run:

```powershell
$env:RA_WEB_API_KEY = '<key>'
npm run emerald:probe -- --symbol-file 'C:\path\to\pokeemerald.sym' --game-id <id> --username <name>
```

The probe reports RetroArch's running-content status, the map group/number and player coordinates, and all achievements that lack a Hardcore unlock date. Omitting the API options still allows the local state read. Omitting the symbol option still allows the RetroArch status and API request.

The `GetGameInfoAndUserProgress` web API is server state, so a just-earned achievement may appear later. Refresh snapshots sparingly. The probe does **not** establish that the ROM was recognized by RetroAchievements or that Hardcore is active. Confirm the game hash and Hardcore indicator inside RetroArch. Read-only memory access also requires a live check to establish whether Hardcore remains active on the chosen RetroArch/mGBA versions.

## Scope and rules

RetroAchievements explicitly prohibits bots and complex scripts from gaining achievements. This probe is for investigation and a possible human-operated advisor. Do not use the Red runner's save-state recovery for Emerald. If Emerald gameplay support is added, progress must use the in-game save and the mGBA cartridge save file; recovery is a fresh boot followed by Continue.

Sources:

- https://docs.libretro.com/development/retroarch/network-control-interface/
- https://github.com/pret/pokeemerald/blob/master/include/global.h
- https://github.com/pret/pokeemerald/blob/master/src/load_save.c
- https://api-docs.retroachievements.org/v1/get-game-info-and-user-progress.html
- https://docs.retroachievements.org/guidelines/users/global-leaderboard-and-achievement-hunting-rules.html
