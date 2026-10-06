import { readEmeraldPosition, type EmeraldPosition } from '../emerald/state.js';
import { RetroArchObserver } from '../platform/retroarch.js';

// Verified for English Emerald's retail memory layout; other builds should use a matching symbol file.
export const EMERALD_SAVE_BLOCK_POINTER = 0x03005d8c;

export interface Observation {
  status: string;
  position?: EmeraldPosition;
  positionError?: string;
  screenText?: string;
}

export async function observeGame(observer: RetroArchObserver, game?: string, pointerAddress = EMERALD_SAVE_BLOCK_POINTER): Promise<Observation> {
  const status = await observer.status();
  if (!/^GET_STATUS (PLAYING|PAUSED)\b/.test(status)) throw new Error(`No running game: ${status}`);
  const observation: Observation = { status };
  if (game === 'emerald') {
    try {
      observation.position = await readEmeraldPosition(observer, pointerAddress);
    } catch (error) {
      observation.positionError = error instanceof Error ? error.message : String(error);
    }
  }
  return observation;
}
