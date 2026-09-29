/** The minimum memory capability required by a game-specific decoder. */
export interface MemoryReader {
  readMemory(address: number, length: number): Promise<Buffer>;
}
