import dgram from 'node:dgram';

export const BUTTONS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'START', 'SELECT', 'L', 'R'] as const;
export type Button = typeof BUTTONS[number];

const IDS: Record<Button, number> = { B: 0, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, L: 10, R: 11 };
export const INPUT_PORT = 55420;

export function buttonPacket(button: Button, pressed: boolean): Buffer {
  if (!BUTTONS.includes(button)) throw new Error(`Unsupported button: ${button}`);
  const packet = Buffer.alloc(20);
  // RetroArch 1.19.1 remote_message is { int port, device, index, id; uint16_t state; }.
  packet.writeInt32LE(0, 0); // Player 1 port (zero-based)
  packet.writeInt32LE(1, 4); // RETRO_DEVICE_JOYPAD
  packet.writeInt32LE(0, 8); // Controller index
  packet.writeInt32LE(IDS[button], 12);
  packet.writeUInt16LE(pressed ? 1 : 0, 16);
  return packet;
}

export async function pressButton(button: Button, durationMs = 700, port = INPUT_PORT): Promise<void> {
  return pressButtons([button], durationMs, port);
}

export async function pressButtons(buttons: readonly Button[], durationMs = 700, port = INPUT_PORT): Promise<void> {
  if (!buttons.length || buttons.some(button => !BUTTONS.includes(button)))
    throw new Error('At least one supported button is required');
  if (!Number.isInteger(durationMs) || durationMs < 40 || durationMs > 1000)
    throw new Error('Button duration must be between 40 and 1000 ms');
  const socket = dgram.createSocket('udp4');
  try {
    const send = (packet: Buffer) => new Promise<void>((resolve, reject) => {
      socket.send(packet, port, '127.0.0.1', error => error ? reject(error) : resolve());
    });
    // Network RetroPad consumes one datagram per input poll. Space releases out
    // so a burst cannot queue ahead of the next press and delay it by many frames.
    const releaseAll = async () => {
      for (const candidate of BUTTONS) {
        await send(buttonPacket(candidate, false));
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    await releaseAll();
    await new Promise(resolve => setTimeout(resolve, 100));
    for (const button of buttons) await send(buttonPacket(button, true));
    await new Promise(resolve => setTimeout(resolve, durationMs));
    for (const button of buttons) await send(buttonPacket(button, false));
    await new Promise(resolve => setTimeout(resolve, 60));
    for (const button of buttons) await send(buttonPacket(button, false));
  } finally {
    socket.close();
  }
}
