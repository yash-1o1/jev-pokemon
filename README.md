# Game harness starter

A small starting point for observing games in your own RetroArch installation. Pokémon Emerald is the first game-specific decoder. The project does not include an emulator, ROM, or Jev integration.

## How the pieces fit

```text
RetroArch + core + your game
          │
          ▼
platform adapter (status, raw memory)
          │
          ├── raw probe for any core exposing a memory map
          └── game adapter (Emerald position today)
                       │
                       ▼
              structured observations
                       │
                       ▼
          future action choices and Jev client
```

The [original Pokémon Red project](https://github.com/christianmat/jev-pokemon) used the `serverboy` Game Boy emulator directly in Node. Its harness advanced frames, read memory, generated legal choices, sent those choices to Jev, and executed the selected choice as button presses. It was not a desktop computer-use system. A [Balatro Jev project](https://github.com/IgorWarzocha/jev-plays-balatro) uses the same basic pattern with a game mod that provides state and actions.

There is no universal game-state decoder. Raw memory reads can work across supported cores, but every game's map, menus, rules, and legal actions need a game adapter. A later visual adapter could use screenshots for games without useful memory structures. Jev would receive structured observations and bounded action choices from those adapters. Controller input, decision calls, and action execution are **not yet implemented**.

## Configure your installation

Install Node.js 20 or newer, then run `npm ci`. Copy `config.example.json` to `config.local.json` and edit the paths for your machine:

```powershell
Copy-Item config.example.json config.local.json
```

```json
{
  "retroarch": "C:/RetroArch/retroarch.exe",
  "core": "C:/RetroArch/cores/mgba_libretro.dll",
  "romsDirectory": "C:/Games/ROMs",
  "rom": "gba/Pokemon - Emerald Version.gba"
}
```

`retroarch` points to the RetroArch executable. `core` points to a **libretro core DLL** (mGBA for GBA games), not a standalone emulator executable. `romsDirectory` is the folder containing your games; `rom` is the game path within it. Absolute paths also work. Relative paths for `retroarch`, `core`, and `romsDirectory` are resolved from the config file's folder. The local config is ignored by Git so machine-specific paths stay out of the fork.

This machine's `config.local.json` is set to Wingosy's managed RetroArch, mGBA core, and Emerald ROM under `AppData/Roaming/wingosy/launcher/data`. Those files were found locally. The personal config is not committed; copy the example and edit it on another machine.

## Development memory probe

Use the memory probe for development or testing outside an achievement-earning run. Enable Network Commands (`network_cmd_enable = "true"`) in RetroArch on UDP port 55355, preferably bound to `127.0.0.1`. Wingosy may install RetroArch with this setting disabled; enable it in RetroArch's `retroarch.cfg` before the probe can connect. With `config.local.json` filled in, run:

```powershell
npm run probe
```

To use a different file, run `npm run probe -- --config 'C:\path\to\config.json'`. If no local config exists, the probe connects to an already running RetroArch session. You can also pass `--retroarch`, `--core`, and `--rom` together to override the configured launch paths.

For a one-off launch without a config file:

```powershell
npm run probe -- --retroarch 'C:\RetroArch\retroarch.exe' --core 'C:\RetroArch\cores\mgba_libretro.dll' --rom 'C:\Games\Emerald.gba'
```

Paths with spaces are supported. The probe launches RetroArch with `-L CORE ROM` and waits for its network command interface. This project does not copy the ROM or core into the repository. RetroAchievements is configured within RetroArch; its web API key is only needed for the separate achievement lookup command below.

Check status and read raw bytes from a core memory address:

```powershell
npm run probe -- --read 0x02000000:16
```

You can repeat `--read`. The address is hexadecimal with `0x` or decimal without it; length is decimal and limited to 256 bytes per read. The core must expose a compatible memory map.

For Pokémon Emerald, provide the `gSaveBlock1Ptr` address for the **exact ROM build**, preferably from a matching `pokeemerald.sym`:

```powershell
npm run probe -- --game emerald --symbol-file 'C:\path\to\pokeemerald.sym'
```

You can instead supply `--save-block-pointer-address 0x...` if its value has been verified for your build. The Emerald adapter reads map group, map number, and player X/Y. Another game's decoder would live beside `src/emerald/state.ts` and consume the same `MemoryReader` interface.

## Achievement lookup

The official RetroAchievements web API can list your progress without connecting to RetroArch or reading emulator memory. Set your key locally; never commit it. The game ID must match your game.

```powershell
$env:RA_WEB_API_KEY = '<your key>'
npm run achievements -- --game-id <game-id> --username <username>
```

The API may lag behind an unlock. The achievement lookup and memory probe are separate commands. Do not combine memory probing and automated play to earn RetroAchievements.

## Current limits

The probe sends only `GET_STATUS` and `READ_CORE_MEMORY`. RetroArch documents memory reads, but we have not verified on a live session whether they leave the Hardcore indicator active. Even if it stays active, that would **not** establish RetroAchievements permission to use a memory-driven bot. The network interface does not report whether Hardcore is active. No controller input or save-state recovery is present.

RetroAchievements [prohibits bots and complex scripts from gaining achievements](https://docs.retroachievements.org/guidelines/users/global-leaderboard-and-achievement-hunting-rules.html). A future autonomous player must not be presented as a compliant achievement run. A human-operated advisor can use achievement information without automating gameplay.

Sources: [RetroArch command line](https://docs.libretro.com/guides/cli-intro/), [RetroArch network commands](https://docs.libretro.com/development/retroarch/network-control-interface/), [pokeemerald SaveBlock1](https://github.com/pret/pokeemerald/blob/master/include/global.h), [official achievement API](https://api-docs.retroachievements.org/v1/get-game-info-and-user-progress.html).

This repository is a fork of `christianmat/jev-pokemon`. Licensed under GPL-2.0-or-later; see [LICENSE](LICENSE).
