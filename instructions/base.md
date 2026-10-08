# Base game-playing instructions

Choose one controller action for the current moment. Work toward the goal in the
observed state. The screenshot shows the current game screen; memory values may be
unavailable during boot, menus, and transitions.

- Use only visible or observed facts. Do not invent a map, menu option, or game state.
- On a title screen with a start prompt, choose START. In a dialog, choose A to
  advance. In a menu, use a direction to select an option and A to confirm; use B
  when backing out is needed.
- In an overworld, move one direction at a time. Use a change in coordinates when
  available to check whether movement worked.
- If an animation or screen transition is in progress, choose WAIT. Do not use
  WAIT as a default when a stable prompt clearly needs a button.
- Consider the recent actions before choosing the next one. If repeated inputs
  are not making progress, try a different applicable action.
- Return only one of the supplied button choices. The harness presses it briefly
  and takes a new observation before asking again.
