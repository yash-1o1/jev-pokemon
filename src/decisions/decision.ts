import OpenAI from 'openai';
import sharp from 'sharp';
import type { Observation } from '../game/observe.js';
import { BUTTONS, type Button } from '../platform/input.js';
import { assertDailyBudgetAvailable, recordDailyUsage, REQUEST_TOKEN_RESERVE, type QuotaModel } from './quota.js';

export type Action = Button | 'RUN_UP' | 'RUN_DOWN' | 'RUN_LEFT' | 'RUN_RIGHT' |
  'WAIT' | 'SAVE_CONFIRMED' | 'NEED_USER_INPUT' | 'RECOVERY_COMPLETE';
export interface StepRecord {
  observation: Observation;
  action: Action;
}
export type Backend = 'hybrid' | 'responses' | 'mock';
export type Controller = 'decisions' | 'terra' | 'terra-recovery' | 'mock';

export const GAME_MODEL = 'gpt-6-luna';
export const TERRA_MODEL = 'gpt-5.6-terra';
const ACTIONS = [...BUTTONS, 'RUN_UP', 'RUN_DOWN', 'RUN_LEFT', 'RUN_RIGHT', 'WAIT', 'SAVE_CONFIRMED', 'NEED_USER_INPUT'] as const;
const TERRA_ACTIONS: readonly Action[] = [...ACTIONS, 'RECOVERY_COMPLETE'];
const DESCRIPTIONS: Record<Action, string> = {
  UP: 'Move up', DOWN: 'Move down', LEFT: 'Move left', RIGHT: 'Move right',
  A: 'Confirm or interact', B: 'Cancel or go back',
  START: 'Start or open the menu', SELECT: 'Select',
  L: 'Left shoulder button', R: 'Right shoulder button',
  RUN_UP: 'Run up by holding B and Up together; use in the overworld',
  RUN_DOWN: 'Run down by holding B and Down together; use in the overworld',
  RUN_LEFT: 'Run left by holding B and Left together; use in the overworld',
  RUN_RIGHT: 'Run right by holding B and Right together; use in the overworld',
  WAIT: 'Wait for the game to advance or when the next action is unclear',
  SAVE_CONFIRMED: 'Record that the game visibly confirmed an in-game save; press no button',
  NEED_USER_INPUT: 'Stop when a personal choice is missing or a missable checkpoint needs review',
  RECOVERY_COMPLETE: 'Recovery reached the next safe checkpoint; hand control back to Decisions without pressing a button',
};

export function decisionRequest(
  observation: Observation,
  history: StepRecord[],
  imageUrl: string,
  goal: string,
  baseInstructions: string,
  gameChoices: Record<string, string>,
  recovery = false,
) {
  const evidence = {
    goal,
    gameChoices,
    game: observation.status,
    position: observation.position ?? null,
    positionError: observation.positionError ?? null,
    recentActions: history.slice(-8).map(({ action, observation: recordedObservation }, index, recent) => {
      const nextPosition = recent[index + 1]?.observation.position ??
        (index === recent.length - 1 ? observation.position : undefined);
      return {
        action,
        position: recordedObservation.position ?? null,
        nextPosition: nextPosition ?? null,
      };
    }),
  };
  const allowedActions = recovery ? TERRA_ACTIONS : ACTIONS;
  const actionGuide = allowedActions.map(action => `${action}: ${DESCRIPTIONS[action]}`).join('\n');
  return {
    model: TERRA_MODEL,
    instructions: `${baseInstructions.trim()}\n\nChoose one short gamepad action toward the goal provided in the input. For recent directional actions, compare position with nextPosition. If the screenshot shows the player turned but still in place, repeat that direction once to move; after the repeat, try a different direction if the position remains unchanged. Return one action from this list:\n${actionGuide}\nChoose SAVE_CONFIRMED only when the screenshot visibly confirms an in-game save. Choose NEED_USER_INPUT when a required choice is missing or a missable checkpoint cannot be verified.${recovery ? ' During this recovery episode, keep playing through the blocked segment and any battle already in progress. Choose RECOVERY_COMPLETE only after a safe, visibly verified checkpoint is reached; do not hand back mid-battle or mid-menu.' : ''}`,
    input: [{
      role: 'user' as const,
      content: [
        { type: 'input_text' as const, text: JSON.stringify(evidence) },
        { type: 'input_image' as const, image_url: imageUrl, detail: 'high' as const },
      ],
    }],
    max_output_tokens: 2048,
    reasoning: { effort: 'low' as const },
    text: {
      format: {
        type: 'json_schema' as const,
        name: 'game_controller_action',
        strict: true,
        schema: {
          type: 'object',
          properties: { action: { type: 'string', enum: allowedActions } },
          required: ['action'],
          additionalProperties: false,
        },
      },
    },
  };
}

export function decisionsRequest(
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
    recentActions: history.slice(-8).map(({ action, observation: recordedObservation }) => ({
      action,
      position: recordedObservation.position ?? null,
    })),
  };
  const actionGuide = ACTIONS.map(action => `${action}: ${DESCRIPTIONS[action]}`).join('\n');
  return {
    model: GAME_MODEL,
    input: [{ role: 'user' as const, content: [
      { type: 'input_text' as const, text: `${baseInstructions.trim()}\n\nChoose one controller action from the listed options.\n${actionGuide}\n\nCurrent evidence: ${JSON.stringify(evidence)}` },
      { type: 'input_image' as const, image_url: imageUrl, detail: 'high' as const },
    ] }],
    questions: [{
      type: 'choice' as const,
      name: 'action',
      instructions: 'Choose the single best immediate gamepad action for the observed game state and goal. Use only visible facts. Return NEED_USER_INPUT when a required personal choice or missable checkpoint cannot be verified.',
      choices: ACTIONS.map(action => ({ value: action, description: DESCRIPTIONS[action] })),
    }],
  };
}

export function answerAction(output: string, recovery = false): Action {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('OpenAI returned an invalid game action');
  }
  if (!parsed || typeof parsed !== 'object' || !('action' in parsed) ||
      typeof parsed.action !== 'string' || !(recovery ? TERRA_ACTIONS : ACTIONS).some(action => action === parsed.action))
    throw new Error('OpenAI returned no supported game action');
  return parsed.action as Action;
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
  controller: Controller = backend === 'mock' ? 'mock' : 'terra',
): Promise<Action> {
  if (backend === 'mock') {
    if (!observation.position || (observation.position.x === 0 && observation.position.y === 0))
      return history.length % 2 === 0 ? 'START' : 'A';
    return (['UP', 'RIGHT', 'DOWN', 'LEFT'] as const)[history.length % 4];
  }

  const model: QuotaModel = controller === 'decisions' ? GAME_MODEL : TERRA_MODEL;
  assertDailyBudgetAvailable(model);
  const image = await sharp(screenshot).resize({ width: 960, kernel: 'nearest' }).png().toBuffer();
  const imageUrl = `data:image/png;base64,${image.toString('base64')}`;
  client ??= new OpenAI({ maxRetries: 0 });
  if (controller === 'decisions') {
    const result = await client.decisions.create(decisionsRequest(observation, history, imageUrl, goal, baseInstructions, gameChoices));
    const usedTokens = result.usage?.total_tokens;
    if (typeof usedTokens !== 'number' || !Number.isSafeInteger(usedTokens) || usedTokens <= 0) {
      recordDailyUsage(REQUEST_TOKEN_RESERVE, model);
      throw new Error('Decisions response omitted token usage; recorded a conservative reserve and stopped');
    }
    recordDailyUsage(usedTokens, model);
    const answer = result.answers[0];
    if (!answer || answer.type === 'refusal' || answer.type !== 'choice' || typeof answer.choice !== 'string' || !ACTIONS.some(action => action === answer.choice))
      throw new Error('Decisions API returned no supported game action');
    return answer.choice as Action;
  }
  const recovery = controller === 'terra-recovery';
  const result = await client.responses.create(decisionRequest(observation, history, imageUrl, goal, baseInstructions, gameChoices, recovery));
  const usedTokens = result.usage?.total_tokens;
  if (typeof usedTokens !== 'number' || !Number.isSafeInteger(usedTokens) || usedTokens <= 0) {
    recordDailyUsage(REQUEST_TOKEN_RESERVE, model);
    throw new Error('Terra response omitted token usage; recorded a conservative reserve and stopped');
  }
  recordDailyUsage(usedTokens, model);
  if (!result.output_text.trim())
    throw new Error(`OpenAI returned no action text (response status: ${result.status}, reason: ${result.incomplete_details?.reason ?? 'none'})`);
  return answerAction(result.output_text, recovery);
}
