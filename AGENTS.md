# Game session operation

- Use the OpenAI Decisions API through `npm run play` as the primary game controller. Keep achievement runs attached to the existing `--achievements` session and its in-game save.
- Watch each bounded run's positions and screenshots. If Decisions stops, repeats ineffective inputs, or gets stuck in a menu or battle, inspect the latest screenshot and game state, use the minimum direct controller inputs needed to clear that specific blockage, then resume `npm run play -- --game emerald --achievements ...` promptly. Do not continue the route manually after recovery.
- Do not let a stalled run consume repeated Decisions requests. Stop it, correct the position or menu, and restart a bounded Decisions run with an updated goal and checkpoint.
- Preserve the active game's rules: Dark, male, no Pokémon nicknames; save in game every 30 real minutes and before missable events. Recover a missed event only from an earlier in-game save, never from a fresh game.
- Record only achievements that have been independently verified as unlocked. Keep local keys, saves, and checkpoints in ignored `.local/` files.
