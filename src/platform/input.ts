import dgram from 'node:dgram';

export const BUTTONS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'START', 'SELECT', 'L', 'R'] as const;
export type Button = typeof BUTTONS[number];

const IDS: Record<Button, number> = { B: 0, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, L: 10, R: 11 };
export const INPUT_PORT = 55420;

export function buttonPacket(button: Button, pressed: boolean): Buffer {
  if (!BUTTONS.includes(button)) throw new Error(`Unsupported button: ${button}`);
  const packet = Buffer.alloc(20);
  packet.writeInt32LE(0, 0);
  packet.writeInt32LE(1, 4);
  packet.writeInt32LE(0, 8);
  packet.writeInt32LE(IDS[button], 12);
  packet.writeUInt16LE(pressed ? 1 : 0, 16);
  return packet;
}

export async function pressButton(button: Button, durationMs = 450, port = INPUT_PORT): Promise<void> {
  if (!Number.isInteger(durationMs) || durationMs < 40 || durationMs > 1000)
    throw new Error('Button duration must be between 40 and 1000 ms');
  const socket = dgram.createSocket('udp4');
  try {
    const send = (packet: Buffer) => new Promise<void>((resolve, reject) => {
      socket.send(packet, port, '127.0.0.1', error => error ? reject(error) : resolve());
    });
    // Network RetroPad is UDP. A missed release leaves a direction held and can
    // make later actions appear ineffective, especially while fast-forwarding.
    const releaseAll = async () => {
      for (const candidate of BUTTONS) await send(buttonPacket(candidate, false));
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      await releaseAll();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await send(buttonPacket(button, true));
    await new Promise(resolve => setTimeout(resolve, durationMs));
    for (let attempt = 0; attempt < 3; attempt++) {
      await releaseAll();
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 30));
    }
  } finally {
    socket.close();
  }
}
