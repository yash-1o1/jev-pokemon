---
name: show-retroachievements
description: Pause the active jev-pokemon RetroArch run and leave its Achievements page visible when the user asks to pause and show RetroAchievements.
---

# Show RetroAchievements

Use this for the active `jev-pokemon` achievement session when the user says to pause and show RetroAchievements. The desired end state is the RetroArch **Achievements** page visible and the emulated game paused.

1. Stop any active `npm run play` Decisions loop with Ctrl+C, leaving RetroArch open. Do not close or reset the content.
2. Query RetroArch's network command port (55356 in this project) with `GET_STATUS`. If it says `PLAYING`, send `PAUSE_TOGGLE` once and confirm `PAUSED`. If already paused, do not toggle it.
3. Open the RetroArch menu with `MENU_TOGGLE` only if it is not already open. Navigate **Main Menu → Quick Menu → Achievements**. The network menu commands are `MENU_UP`, `MENU_DOWN`, `MENU_LEFT`, `MENU_RIGHT`, `MENU_A`, and `MENU_B`. On this Wingosy RetroArch configuration, `MENU_B` accepts a selected item and `MENU_A` goes back; verify the highlighted item visually before accepting because bindings can change.
4. Inspect the actual RetroArch window to confirm its heading says **Achievements**. Core screenshots from the `SCREENSHOT` network command omit the RetroArch menu, so they cannot verify this step. Leave the window on that page and keep the game paused.
5. Report the next visible locked or unlocked achievements and whether Hardcore is active. Do **not** select the page's **Pause Achievements Hardcore Mode** item; that control is separate from pausing the emulated game.

Send a network command from Node when needed:

```powershell
node -e "const d=require('dgram');const s=d.createSocket('udp4');s.send(Buffer.from('MENU_TOGGLE'),55356,'127.0.0.1',()=>s.close())"
```

For `GET_STATUS`, use the project's `RetroArchObserver.status()` or a UDP socket that waits for a reply. For other menu commands, replace `MENU_TOGGLE` in the example with the command name. Use the active session's configured port if it differs from 55356.
