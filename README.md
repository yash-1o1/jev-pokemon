# OpenAI Decisions game harness

A small RetroArch harness for games you own. Pokémon Emerald on GBA is the first game adapter. It uses your existing RetroArch installation, libretro core, and ROM; none are distributed here.

## What it does

The `play` command launches an isolated RetroArch profile, captures screenshots, reads core RAM when available, asks the OpenAI Decisions API to choose one bounded controller button from the screenshot and state, and sends that button through RetroArch's Network RetroPad. Each observation and action is logged to `.local/play.jsonl`. You can also run an offline mock controller loop to check the plumbing without an API key.

```text
ROM + libretro core in RetroArch
       | screenshots + optional RAM
       v
  game observation + screenshot
       | state and image
       v
   Decisions choice question
       | one RetroPad button
       v
  RetroArch Network RetroPad
```

The platform layer can run another RetroArch game by changing the ROM and core paths. The Emerald adapter adds player coordinates from its save block. Other games need their own memory decoder for reliable structured state. The Decisions API receives an enlarged screenshot directly; small game text and visuals can still be ambiguous.

## Set up your installation

Install Node.js 20 or newer and run `npm ci`. Copy `config.example.json` to `config.local.json` and set paths for your machine:

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

`core` is a libretro core DLL, not a standalone emulator executable. `rom` is relative to `romsDirectory`, or it may be an absolute path. The local config is ignored by Git. On this machine, `config.local.json` points to Wingosy's managed RetroArch, mGBA core, and Emerald ROM under `AppData/Roaming/wingosy/launcher/data`. The project never copies the ROM or core into the repository.

Check the paths and isolated profile:

```powershell
npm run play -- --check
```

## Play

Set your OpenAI API key in your shell and run a short session:

```powershell
$env:OPENAI_API_KEY = '<your API key>'
npm run play -- --game emerald --steps 10
```

The key stays in the environment; do not put it in a tracked file. The API account also needs available credits. Without a key, use the offline plumbing check:

```powershell
npm run play -- --backend mock --game emerald --steps 10
```

Omit `--game emerald` to use status and screenshots only with a different configured game. `--config FILE` selects another local config. `--goal TEXT` sets the objective sent with each decision. The Decisions API currently supports `gpt-6-luna` only. The mock backend cycles buttons; it does not play strategically. Each run leaves the development RetroArch session open, and another run attaches to it.

The default Emerald `gSaveBlock1Ptr` address is `0x03005D8C`, verified against this machine's retail Emerald ROM. For another build, pass `--symbol-file FILE` containing `gSaveBlock1Ptr`, or `--save-block-pointer-address 0x...`. The adapter reports position errors during boot or when the pointer cannot be resolved.

## RetroAchievements isolation

Autonomous play launches RetroArch with `.local/retroarch-dev.cfg`, built from your installed config. The development profile disables RetroAchievements and Hardcore, clears its credentials, enables network commands on port 55356 and Network RetroPad on port 55420, and uses local save and screenshot folders. It does not edit your installed RetroArch config. Close the development RetroArch window when finished.

[RetroAchievements rules prohibit bots and complex scripts from earning achievements](https://docs.retroachievements.org/guidelines/users/global-leaderboard-and-achievement-hunting-rules.html). Do not use `probe` or `play` to earn achievements. Your regular RetroArch login and achievements settings remain in its own config.

## Probe and achievement lookup

`npm run probe` is a development memory probe. It connects to RetroArch's network command port 55355 by default, or launches the configured ROM there. For a raw read:

```powershell
npm run probe -- --read 0x02000000:16
```

For Emerald's position, provide a matching symbol file:

```powershell
npm run probe -- --game emerald --symbol-file 'C:\path\to\pokeemerald.sym'
```

`probe` uses the regular RetroArch config if it launches a game, so use it only for development outside an achievement session. Some cores expose no `READ_CORE_MEMORY` map; the probe falls back to the GBA RAM layout used by `READ_CORE_RAM` for GBA addresses.

The separate official RetroAchievements web API lookup needs your own API key:

```powershell
$env:RA_WEB_API_KEY = '<your key>'
npm run achievements -- --game-id <game-id> --username <username>
```

Sources: [OpenAI Decisions API](https://developers.openai.com/api/reference/resources/decisions/methods/create), [RetroArch command line](https://docs.libretro.com/guides/cli-intro/), [Network Control Interface](https://docs.libretro.com/development/retroarch/network-control-interface/), [Remote RetroPad](https://docs.libretro.com/library/remote_retropad/), [Emerald SaveBlock1 structure](https://github.com/pret/pokeemerald/blob/master/include/global.h).

Forked from [christianmat/jev-pokemon](https://github.com/christianmat/jev-pokemon). Licensed under GPL-2.0-or-later; see [LICENSE](LICENSE).
