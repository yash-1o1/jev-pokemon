import OpenAI from 'openai';
import sharp from 'sharp';
import type { Observation } from '../game/observe.js';
import { BUTTONS, type Button } from '../platform/input.js';

export type Action = Button | 'WAIT' | 'SAVE_CONFIRMED' | 'NEED_USER_INPUT';
export interface StepRecord {
  observation: Observation;
  action: Action;
}
export type Backend = 'decisions' | 'mock';

const ACTIONS = [...BUTTONS, 'WAIT', 'SAVE_CONFIRMED', 'NEED_USER_INPUT'] as const;
const DESCRIPTIONS: Record<Action, string> = {
  UP: 'Move up', DOWN: 'Move down', LEFT: 'Move left', RIGHT: 'Move right',
  A: 'Confirm or interact', B: 'Cancel or go back',
  START: 'Start or open the menu', SELECT: 'Select',
  L: 'Left shoulder button', R: 'Right shoulder button',
  WAIT: 'Wait for the game to advance or when the next action is unclear',
  SAVE_CONFIRMED: 'Record that the game visibly confirmed an in-game save; press no button',
  NEED_USER_INPUT: 'Stop when a personal choice is missing or a missable checkpoint needs review',
};

export function decisionRequest(
  observation: Observation,
  history: StepRecord[],
  imageUrl: string,
  goal: string,
  baseInstructions: string,
  gameChoices: Record<string, string>,
) {
  const evidence = {
    goal,
    gameChoices,
    game: observation.status,
    position: observation.position ?? null,
    positionError: observation.positionError ?? null,
    recentActions: history.slice(-8).map(({ action, observation }) => ({
      action,
      position: observation.position ?? null,
    })),
  };
  return {
    model: 'gpt-6-luna',
    input: [{
      role: 'user' as const,
      content: [
        { type: 'input_text' as const, text: JSON.stringify(evidence) },
        { type: 'input_image' as const, image_url: imageUrl, detail: 'high' as const },
      ],
    }],
    questions: [{
      type: 'choice' as const,
      name: 'nextAction',
      instructions: `${baseInstructions.trim()}\n\nChoose one short gamepad action toward the goal provided in the input. Choose SAVE_CONFIRMED only when the screenshot visibly confirms an in-game save. Choose NEED_USER_INPUT when a required choice is missing or a missable checkpoint cannot be verified.`,
      choices: ACTIONS.map(value => ({ value, description: DESCRIPTIONS[value] })),
    }],
  };
}

export function answerAction(answers: Array<{ type: string; name: string | null; choice?: string | boolean }>): Action {
  const answer = answers.find(item => item.name === 'nextAction');
  if (answer?.type === 'refusal') throw new Error('Decisions API refused to choose a game action');
  if (answer?.type !== 'choice' || typeof answer.choice !== 'string' ||
      !ACTIONS.includes(answer.choice as Action))
    throw new Error('Decisions API returned no supported game action');
  return answer.choice as Action;
}

let client: OpenAI | undefined;

export async function chooseAction(
  observation: Observation,
  history: StepRecord[],
  backend: Backend,
  screenshot: string,
  goal: string,
  baseInstructions: string,
  gameChoices: Record<string, string>,
): Promise<Action> {
  if (backend === 'mock') {
    if (!observation.position || (observation.position.x === 0 && observation.position.y === 0))
      return history.length % 2 === 0 ? 'START' : 'A';
    return (['UP', 'RIGHT', 'DOWN', 'LEFT'] as const)[history.length % 4];
  }
  const image = await sharp(screenshot).resize({ width: 960, kernel: 'nearest' }).png().toBuffer();
  const imageUrl = `data:image/png;base64,${image.toString('base64')}`;
  client ??= new OpenAI({ maxRetries: 0 });
  const result = await client.decisions.create(
    decisionRequest(observation, history, imageUrl, goal, baseInstructions, gameChoices),
  );
  return answerAction(result.answers);
}
