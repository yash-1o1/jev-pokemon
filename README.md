# OpenAI game harness

A small RetroArch harness for games you own. Pokémon Emerald on GBA is the first game adapter. It uses your existing RetroArch installation, libretro core, and ROM; none are distributed here.

## What it does

The `play` command launches an isolated RetroArch profile, captures screenshots, reads core RAM when available, and defaults to a hybrid controller: GPT-6 Luna through the Decisions API chooses normal gameplay actions; GPT-5.6 Terra through Responses takes a bounded recovery episode after the progress watchdog detects repeated ineffective actions. Terra must identify a safe checkpoint before control returns to Decisions; if it cannot do so within 24 actions, the runner pauses for review. Both APIs choose from the same bounded controller action set, and actions go through RetroArch's Network RetroPad. Each observation and action is logged to `.local/play.jsonl`. You can also run an offline mock controller loop to check the plumbing without an API key.

During a hybrid play run, Decisions is the primary controller and Terra handles detected recovery episodes. The runner keeps separate model ledgers but enforces one shared 2.5 million token daily safety cap across both models. These are local safety limits; check the API Usage dashboard to verify actual project pool availability. At the cap, RetroArch pauses and the runner waits for the next UTC day.

```text
ROM + libretro core in RetroArch
       | screenshots + optional RAM
       v
  game observation + screenshot
       | state and image
       v
Decisions API choice (normal play) --> RetroArch Network RetroPad
       ^                                      |
       +---- Terra recovery to safe checkpoint-+
       ^
       | Terra recovery through a safe checkpoint, then hand back
       +----------------------------------------
```

The platform layer can run another RetroArch game by changing the ROM and core paths. The Emerald adapter adds player coordinates from its save block. Other games need their own memory decoder for reliable structured state. Both APIs receive an enlarged screenshot; small game text and visuals can still be ambiguous.

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
  "rom": "gba/Pokemon - Emerald Version.gba",
  "gameChoices": {}
}
```

`core` is a libretro core DLL, not a standalone emulator executable. `rom` is relative to `romsDirectory`, or it may be an absolute path. The local config is ignored by Git. On this machine, `config.local.json` points to Wingosy's managed RetroArch, mGBA core, and Emerald ROM under `AppData/Roaming/wingosy/launcher/data`. The project never copies the ROM or core into the repository.

Set personal game choices in the ignored `config.local.json`, for example
`"gameChoices": { "trainerName": "Alex", "avatar": "Male" }`. The harness
includes these choices in each model request. If the game asks for a
personal choice that is missing, the agent can choose `NEED_USER_INPUT`;
play stops and prints the screenshot path so you can add the choice and rerun.
Entering a name still requires the agent to navigate the game's on-screen
keyboard one button at a time.

Check the paths and isolated profile:

```powershell
npm run play -- --check
```

## Play

Save a project-scoped API key to `.local/openai-api-key.txt` or set `OPENAI_API_KEY` in your shell, then run a short session:

```powershell
$env:OPENAI_API_KEY = '<your API key>'
npm run play -- --game emerald --steps 10
```

The local key file is ignored by Git. The API key's account must have usable API access; the local token ledgers are safety caps and do not verify a complimentary pool allocation. Without a key, use the offline plumbing check:

```powershell
npm run play -- --backend mock --game emerald --steps 10
```

Omit `--game emerald` to use status and screenshots only with a different configured game. `--config FILE` selects another local config. `--goal TEXT` sets the objective sent with each decision. The default `--backend hybrid` uses `gpt-6-luna` through Decisions for ordinary play and `gpt-5.6-terra` through Responses for detected recovery. `--backend responses` forces Terra for every move; `--backend mock` cycles buttons offline. Separate ignored ledgers `.local/openai-decisions-token-usage.json` and `.local/openai-free-token-usage.json` track each model, with a shared 2.5 million daily cap across both. The local cap does not confirm an account's free-pool allocation; the API Usage dashboard is authoritative. Each run leaves the development RetroArch session open, and another run attaches to it.

Shared play rules live in [instructions/base.md](instructions/base.md). The harness sends
them with every Decisions or Responses API request. For private additions, copy the neutral
[personal instructions template](instructions/personal.example.md) into the ignored
`.local` folder, edit your copy, and select it:

```powershell
Copy-Item instructions/personal.example.md .local/my-instructions.md
npm run play -- --game emerald --instructions .local/my-instructions.md
```

The extra file is appended to the shared rules; it is never committed. Decisions
receives the game rules and screenshot/state together as user evidence; Terra
receives the same rules as Responses instructions and the screenshot/state as
user input.

The default Emerald `gSaveBlock1Ptr` address is `0x03005D8C`, verified against this machine's retail Emerald ROM. For another build, pass `--symbol-file FILE` containing `gSaveBlock1Ptr`, or `--save-block-pointer-address 0x...`. The adapter reports position errors during boot or when the pointer cannot be resolved.

## RetroAchievements profiles

By default, autonomous play launches RetroArch with `.local/retroarch-dev.cfg`, built from your installed config. This development profile disables RetroAchievements and Hardcore, clears its credentials, enables network commands on port 55356 and Network RetroPad on port 55420, and uses local save and screenshot folders. It does not edit your installed RetroArch config. Close the RetroArch window when finished.

An explicit `--achievements` run uses `.local/ra-run/retroarch-ra.cfg` with the installed RetroAchievements login and Hardcore enabled. It has separate saves, screenshots, and logs under `.local/ra-run`. Attach to the existing achievement session and in-game save to continue this run; never start a fresh game to recover a missed achievement. Keep the installed RetroArch login private; generated profiles remain ignored by Git.

```powershell
npm run play -- --game emerald --achievements --steps 10
```

Space is RetroArch's fast-forward toggle. The harness toggles it once after launching a new RetroArch session and leaves an attached session's setting alone; the current attached session was toggled on once. Core screenshots may omit the speed indicator, so do not toggle again based only on a missing icon. For a complete Emerald route, check the live [achievement set and missable filter](https://retroachievements.org/game/668) and the [community guide](https://github.com/RetroAchievements/guides/wiki/(WIP)-Pokemon-Emerald-(Game-Boy-Advance)) before story checkpoints.

Emerald achievement runs automatically include [completion rules](instructions/emerald-achievement-rules.md) and the current checkpoint in every Decisions or Terra request. The [missable checkpoint ledger](instructions/emerald-missables.md) stays on disk; only the current slice is sent each step. Copy the relevant checkpoint text to ignored `.local/ra-run/current-checkpoint.md` as the route advances. The default is [Littleroot through Route 103](instructions/emerald-early-checkpoint.md). The rules prohibit Pokemon nicknames, require an in-game save every 30 minutes and before missable events, and call for a reload from an earlier save if one is lost. Do not start a new game to recover a missed event. Recheck the live set's missable filter at each boundary because the community guide is still in progress.

When the game visibly confirms an in-game save, the agent can choose `SAVE_CONFIRMED` to update ignored `.local/ra-run/last-save-at.txt` and make an `.srm` backup after RetroArch flushes it; the elapsed time is then included in later goals. Keep pre-event `.srm` backups under `.local/ra-run/backups`. To restore one, close RetroArch first, replace the active `.srm` in `.local/ra-run/saves/mGBA`, then relaunch the same achievement profile. This keeps the earlier in-game save as the recovery point.

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

Sources: [OpenAI Decisions API](https://developers.openai.com/api/docs/guides/decisions), [OpenAI Responses API](https://developers.openai.com/api/docs/guides/text), [GPT-5.6 Terra model](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [RetroArch command line](https://docs.libretro.com/guides/cli-intro/), [Network Control Interface](https://docs.libretro.com/development/retroarch/network-control-interface/), [Remote RetroPad](https://docs.libretro.com/library/remote_retropad/), [Emerald SaveBlock1 structure](https://github.com/pret/pokeemerald/blob/master/include/global.h).

Forked from [christianmat/jev-pokemon](https://github.com/christianmat/jev-pokemon). Licensed under GPL-2.0-or-later; see [LICENSE](LICENSE).
