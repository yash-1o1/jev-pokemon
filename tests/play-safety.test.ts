import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { makeDevelopmentConfig, makeAchievementConfig } from '../src/platform/dev-profile.js';
import { buttonPacket } from '../src/platform/input.js';
import { actionFailedToProgress, answerAction, consumeRecoveryAction, decisionRequest, decisionsRequest, recoveryLimitReached, sameGamePosition, sameVisibleUi } from '../src/decisions/decision.js';
import { screenshotActionSignal, screenshotProgressSignal } from '../src/game/progress.js';

test('development profile disables achievements and clears credentials in repeated settings', () => {
  const source = [
    'cheevos_enable = "true"',
    'cheevos_enable = "true"',
    'cheevos_hardcore_mode_enable = "true"',
    'cheevos_username = "player"',
    'cheevos_token = "secret"',
    'cheevos_password = "secret"',
  ].join('\n');
  const profile = makeDevelopmentConfig(source, 'C:\\saves', 'C:\\screenshots');
  assert.equal((profile.match(/^cheevos_enable = "false"$/gm) ?? []).length, 2);
  assert.match(profile, /^cheevos_hardcore_mode_enable = "false"$/m);
  assert.match(profile, /^cheevos_username = ""$/m);
  assert.match(profile, /^cheevos_token = ""$/m);
  assert.match(profile, /^cheevos_password = ""$/m);
  assert.match(profile, /^network_remote_base_port = "55420"$/m);
  assert.doesNotMatch(profile, /secret|player/);
});

test('opt-in achievement profile keeps the login and uses separate saves', () => {
  const source = [
    'cheevos_enable = "false"',
    'cheevos_hardcore_mode_enable = "false"',
    'cheevos_username = "player"',
    'cheevos_token = "test-token"',
  ].join('\n');
  const profile = makeAchievementConfig(source, 'C:\\ra-saves', 'C:\\ra-screenshots');
  assert.match(profile, /^cheevos_enable = "true"$/m);
  assert.match(profile, /^cheevos_hardcore_mode_enable = "true"$/m);
  assert.match(profile, /^cheevos_username = "player"$/m);
  assert.match(profile, /^cheevos_token = "test-token"$/m);
  assert.match(profile, /^savefile_directory = "C:\/ra-saves"$/m);
  assert.throws(() => makeAchievementConfig('cheevos_username = "player"', 'saves'));
});

test('Network RetroPad sends the expected 20-byte start button packet', () => {
  const down = buttonPacket('START', true);
  const up = buttonPacket('START', false);
  assert.equal(down.length, 20);
  assert.equal(down.readInt32LE(0), 0); // Player 1 port (zero-based)
  assert.equal(down.readInt32LE(4), 1); // RETRO_DEVICE_JOYPAD
  assert.equal(down.readInt32LE(8), 0); // Controller index
  assert.equal(down.readInt32LE(12), 3); // RETRO_DEVICE_ID_JOYPAD_START
  assert.equal(down.readUInt16LE(16), 1);
  assert.equal(up.readUInt16LE(16), 0);
});

test('Terra Responses request sends image and limits the answer to controller buttons', () => {
  const request = decisionRequest(
    { status: 'GET_STATUS PLAYING game_boy_advance,Emerald' },
    [{ observation: { status: 'GET_STATUS PLAYING game_boy_advance,Emerald', position: { x: 2, y: 8 } }, action: 'A', ineffective: true }],
    'data:image/png;base64,AAAA',
    'Advance past the title screen',
    'When a start prompt is visible, choose START.',
    { trainerName: 'ALEX' },
  );
  assert.equal(request.model, 'gpt-5.6-terra');
  assert.equal(request.input[0].content[1].type, 'input_image');
  assert.equal(request.text.format.type, 'json_schema');
  assert.match(request.instructions, /When a start prompt is visible, choose START/);
  assert.match(request.input[0].content[0].text, /"ineffective":true/);
  assert.match(request.input[0].content[0].text, /"trainerName":"ALEX"/);
  assert.deepEqual(request.text.format.schema.properties.action.enum,
    ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'START', 'SELECT', 'L', 'R', 'RUN_UP', 'RUN_DOWN', 'RUN_LEFT', 'RUN_RIGHT', 'WAIT', 'SAVE_CONFIRMED', 'NEED_USER_INPUT']);
  assert.equal(answerAction('{"action":"START"}'), 'START');
  assert.equal(answerAction('{"action":"SAVE_CONFIRMED"}'), 'SAVE_CONFIRMED');
  assert.equal(answerAction('{"action":"NEED_USER_INPUT"}'), 'NEED_USER_INPUT');
  assert.throws(() => answerAction('{"action":"RECOVERY_COMPLETE"}'));
  const recoveryRequest = decisionRequest(
    { status: 'GET_STATUS PLAYING game_boy_advance,Emerald' },
    [{ observation: { status: 'GET_STATUS PLAYING game_boy_advance,Emerald', position: { x: 4, y: 7 } }, action: 'RIGHT', ineffective: true }],
    'data:image/png;base64,AAAA',
    'Recover to a safe checkpoint',
    'Continue through the blocked section.',
    {},
    true,
    true,
  );
  assert.ok(recoveryRequest.text.format.schema.properties.action.enum.includes('RECOVERY_COMPLETE'));
  assert.match(recoveryRequest.instructions, /NEXT battle begins/i);
  assert.match(recoveryRequest.instructions, /Do not fight a battle as Terra/i);
  assert.ok(recoveryRequest.text.format.schema.properties.action.enum.includes('RECOVERY_BATTLE_FINISHED'));
  assert.match(recoveryRequest.instructions, /If the current screenshot is already a battle, choose RECOVERY_COMPLETE immediately/i);
  assert.match(recoveryRequest.instructions, /Do not fight a battle as Terra/i);
  const recoveryOverworldRequest = decisionRequest(
    { status: 'GET_STATUS PLAYING game_boy_advance,Emerald' },
    [],
    'data:image/png;base64,AAAA',
    'Recover to the next battle',
    'Continue safely.',
    {},
    true,
    false,
  );
  assert.match(recoveryOverworldRequest.instructions, /Continue safely through the overworld until the NEXT battle begins/i);
  assert.equal(answerAction('{"action":"RECOVERY_COMPLETE"}', true), 'RECOVERY_COMPLETE');
  assert.throws(() => answerAction('{"action":"RESET"}'));
});

test('Decisions request uses GPT-6 Luna with image input and a bounded controller choice set', () => {
  const request = decisionsRequest(
    { status: 'GET_STATUS PLAYING game_boy_advance,Emerald', position: { x: 4, y: 7 } },
    [{ observation: { status: 'GET_STATUS PLAYING game_boy_advance,Emerald', position: { x: 4, y: 7 } }, action: 'RIGHT', ineffective: true }],
    'data:image/png;base64,AAAA',
    'Continue to the gym',
    'Never nickname a Pokemon.',
    { trainerName: 'Dark', avatar: 'Male' },
  );
  assert.equal(request.model, 'gpt-6-luna');
  assert.equal(request.input[0].content[1].type, 'input_image');
  assert.equal(request.questions[0].type, 'choice');
  assert.equal(request.questions[0].choices.length, 17);
  assert.match(request.input[0].content[0].text, /trainerName/);
  assert.match(request.input[0].content[0].text, /"ineffective":true/);
});

test('Terra recovery limit is checked only during Terra turns', () => {
  assert.equal(recoveryLimitReached('decisions', 0), false);
  assert.equal(recoveryLimitReached('terra-recovery', 0), true);
  assert.equal(recoveryLimitReached('terra-recovery', 1), false);
});

test('Terra recovery allowance counts Terra actions only', () => {
  assert.equal(consumeRecoveryAction('decisions', 60), 60);
  assert.equal(consumeRecoveryAction('terra-recovery', 60), 59);
  assert.equal(consumeRecoveryAction('terra-recovery', 0), 0);
});

test('stall detection catches repeated interactions despite sprite animation and ignores visible dialogue progress', () => {
  const position = { x: 2, y: 8, mapGroup: 11, mapNum: 3 };
  const stableDialogue = Buffer.alloc(160, 90);
  const animatedScene = Buffer.from(stableDialogue);
  animatedScene[0] = 110; // Small animation noise is below the visible-change threshold.
  assert.equal(sameGamePosition(position, { ...position }), true);
  assert.equal(sameVisibleUi(stableDialogue, animatedScene), true);
  assert.equal(actionFailedToProgress('A', position, position, stableDialogue, animatedScene), true);

  const nextDialogue = Buffer.from(stableDialogue);
  nextDialogue.fill(190, 80, 120);
  assert.equal(sameVisibleUi(stableDialogue, nextDialogue), false);
  assert.equal(actionFailedToProgress('A', position, position, stableDialogue, nextDialogue), false);
  assert.equal(actionFailedToProgress('DOWN', position, position, stableDialogue, nextDialogue), true);
  assert.equal(actionFailedToProgress('DOWN', position, { ...position, y: 9 }, stableDialogue, stableDialogue), false);
  assert.equal(actionFailedToProgress('WAIT', position, position, stableDialogue, stableDialogue), false);
});

test('progress watchdog ignores dialogue-box text changes but detects gameplay scene changes', async () => {
  const base = sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 80, g: 80, b: 80 } } });
  const baselinePath = '.local/progress-baseline.png';
  const dialoguePath = '.local/progress-dialogue.png';
  const scenePath = '.local/progress-scene.png';
  const dialogueTextPath = '.local/progress-dialogue-text.png';
  await base.png().toFile(baselinePath);
  await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 80, g: 80, b: 80 } } })
    .composite([{ input: { create: { width: 100, height: 25, channels: 3, background: { r: 220, g: 220, b: 220 } } }, top: 75, left: 0 }])
    .png().toFile(dialoguePath);
  await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 80, g: 80, b: 80 } } })
    .composite([{ input: { create: { width: 45, height: 30, channels: 3, background: { r: 220, g: 220, b: 220 } } }, top: 10, left: 10 }])
    .png().toFile(scenePath);
  await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 80, g: 80, b: 80 } } })
    .composite([{ input: { create: { width: 100, height: 32, channels: 3, background: { r: 220, g: 220, b: 220 } } }, top: 68, left: 0 }])
    .png().toFile(dialogueTextPath);

  try {
    const baseline = await screenshotProgressSignal(baselinePath);
    const dialogueOnly = await screenshotProgressSignal(dialoguePath);
    const sceneChanged = await screenshotProgressSignal(scenePath);
    const baselineAction = await screenshotActionSignal(baselinePath);
    const dialogueAction = await screenshotActionSignal(dialogueTextPath);
    assert.equal(sameVisibleUi(baseline, dialogueOnly), true);
    assert.equal(sameVisibleUi(baseline, sceneChanged), false);
    assert.equal(sameVisibleUi(baselineAction, dialogueAction), false);
  } finally {
    const fs = await import('node:fs');
    for (const file of [baselinePath, dialoguePath, scenePath, dialogueTextPath]) fs.rmSync(file, { force: true });
  }
});
