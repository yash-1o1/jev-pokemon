import assert from 'node:assert/strict';
import test from 'node:test';
import { makeDevelopmentConfig } from '../src/platform/dev-profile.js';
import { buttonPacket } from '../src/platform/input.js';
import { answerAction, decisionRequest } from '../src/decisions/decision.js';

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

test('Network RetroPad sends the expected 20-byte start button packet', () => {
  const down = buttonPacket('START', true);
  const up = buttonPacket('START', false);
  assert.equal(down.length, 20);
  assert.equal(down.readInt32LE(4), 1);
  assert.equal(down.readInt32LE(12), 3);
  assert.equal(down.readUInt16LE(16), 1);
  assert.equal(up.readUInt16LE(16), 0);
});

test('Decisions request sends image and limits the answer to controller buttons', () => {
  const request = decisionRequest(
    { status: 'GET_STATUS PLAYING game_boy_advance,Emerald' },
    [],
    'data:image/png;base64,AAAA',
    'Advance past the title screen',
    'When a start prompt is visible, choose START.',
  );
  assert.equal(request.model, 'gpt-6-luna');
  assert.equal(request.input[0].content[1].type, 'input_image');
  assert.equal(request.questions[0].type, 'choice');
  assert.match(request.questions[0].instructions, /When a start prompt is visible, choose START/);
  assert.deepEqual(request.questions[0].choices.map(choice => choice.value),
    ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'START', 'SELECT', 'L', 'R', 'WAIT']);
  assert.equal(answerAction([{ type: 'choice', name: 'nextAction', choice: 'START' }]), 'START');
  assert.throws(() => answerAction([{ type: 'choice', name: 'nextAction', choice: 'RESET' }]));
});
