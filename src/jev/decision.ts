import { choice, TypeSafeClient } from '@typesafe-ai/sdk';
import type { Observation } from '../game/observe.js';
import { BUTTONS, type Button } from '../platform/input.js';

export type Action = Button | 'WAIT';

export interface StepRecord {
  observation: Observation;
  action: Action;
}

const ACTIONS = [...BUTTONS, 'WAIT'] as const;
const CRITERIA = {
  UP: 'Move up one short step', DOWN: 'Move down one short step',
  LEFT: 'Move left one short step', RIGHT: 'Move right one short step',
  A: 'Confirm or interact', B: 'Cancel or close a menu',
  START: 'Open or confirm the game menu', SELECT: 'Use Select',
  L: 'Left shoulder button', R: 'Right shoulder button',
  WAIT: 'Wait briefly for an animation or new state',
} as const;

export async function chooseAction(observation: Observation, history: StepRecord[], backend: 'jev' | 'mock'): Promise<Action> {
  if (backend === 'mock') {
    if (!observation.position || (observation.position.x === 0 && observation.position.y === 0))
      return history.length % 2 === 0 ? 'START' : 'A';
    return (['UP', 'RIGHT', 'DOWN', 'LEFT'] as const)[history.length % 4];
  }
  const client = new TypeSafeClient();
  const position = (value: Observation['position']) => value
    ? { x: value.x, y: value.y, mapGroup: value.mapGroup, mapNum: value.mapNum }
    : null;
  const result = await client.systemOne({
    state: {
      game: observation.status,
      position: position(observation.position),
      positionError: observation.positionError ?? null,
      screenText: observation.screenText ?? null,
      recentActions: history.slice(-8).map(step => ({ action: step.action, position: position(step.observation.position) })),
    },
    questions: {
      nextAction: choice(
        'Choose one short controller action for the next moment of gameplay. Use only the observed facts; choose WAIT when the state is unclear or an animation may be running.',
        CRITERIA,
      ),
    },
  });
  const picked = result.answers.nextAction.choice;
  if (!ACTIONS.includes(picked)) throw new Error(`Jev returned an unsupported action: ${picked}`);
  return picked;
}
