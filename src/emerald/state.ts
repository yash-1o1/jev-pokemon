import type { MemoryReader } from '../platform/types.js';

export interface EmeraldPosition {
  saveBlockAddress: string;
  x: number;
  y: number;
  mapGroup: number;
  mapNum: number;
}

/**
 * pokeemerald SaveBlock1: pos at +0x00, location map group/number at +0x04.
 * The pointer itself moves, so resolve it from a symbol for the exact ROM build.
 */
export async function readEmeraldPosition(observer: MemoryReader, saveBlock1PointerAddress: number): Promise<EmeraldPosition> {
  const pointerBytes = await observer.readMemory(saveBlock1PointerAddress, 4);
  const address = pointerBytes.readUInt32LE(0);
  if (address < 0x02000000 || address > 0x0203fff7)
    throw new Error(`gSaveBlock1Ptr is outside GBA EWRAM: 0x${address.toString(16)}`);
  const block = await observer.readMemory(address, 8);
  return {
    saveBlockAddress: `0x${address.toString(16).padStart(8, '0')}`,
    x: block.readInt16LE(0),
    y: block.readInt16LE(2),
    mapGroup: block.readInt8(4),
    mapNum: block.readInt8(5),
  };
}
