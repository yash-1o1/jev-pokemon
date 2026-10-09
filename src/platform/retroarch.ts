import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';

/** Read-only subset of RetroArch's UDP network command interface. */
export class RetroArchObserver {
  constructor(private readonly host = '127.0.0.1', private readonly port = 55355) {}

  private command(message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      let settled = false;
      const timer = setTimeout(() => finish(new Error('RetroArch did not respond; enable Network Commands')), 2000);
      const finish = (error?: Error, response?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.close();
        if (error) reject(error);
        else resolve(response!);
      };
      socket.once('error', finish);
      socket.once('message', data => finish(undefined, data.toString('utf8').trim()));
      socket.send(Buffer.from(message), this.port, this.host, error => {
        if (error) finish(error);
      });
    });
  }

  status(): Promise<string> {
    return this.command('GET_STATUS');
  }

  toggleFastForward(): Promise<void> {
    return this.send('FAST_FORWARD');
  }

  togglePause(): Promise<void> {
    return this.send('PAUSE_TOGGLE');
  }

  private send(message: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      socket.send(Buffer.from(message), this.port, this.host, error => {
        socket.close();
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async screenshot(directory: string): Promise<string> {
    // Let the previous screenshot notification expire so controller decisions
    // are based on an unobstructed game frame.
    await new Promise(resolve => setTimeout(resolve, 3500));
    const latest = () => fs.readdirSync(directory)
      .filter(name => name.toLowerCase().endsWith('.png'))
      .map(name => ({ file: path.join(directory, name), time: fs.statSync(path.join(directory, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time)[0];
    const before = latest();
    await this.send('SCREENSHOT');
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const after = latest();
      if (after && (!before || after.file !== before.file || after.time > before.time)) {
        // RetroArch can create the file before it has finished writing the PNG.
        // Wait for size and mtime to settle so image decoders don't see a partial file.
        await new Promise(resolve => setTimeout(resolve, 200));
        const first = fs.statSync(after.file);
        await new Promise(resolve => setTimeout(resolve, 100));
        const second = fs.statSync(after.file);
        if (first.size === second.size && first.mtimeMs === second.mtimeMs)
          return after.file;
      }
    }
    throw new Error('RetroArch did not save a screenshot');
  }

  async readMemory(address: number, length: number): Promise<Buffer> {
    if (!Number.isInteger(address) || address < 0 || address > 0xffffffff)
      throw new Error('Invalid memory address');
    if (!Number.isInteger(length) || length < 1 || length > 256)
      throw new Error('Read length must be between 1 and 256');
    let response = await this.command(`READ_CORE_MEMORY ${address.toString(16).toUpperCase()} ${length}`);
    // Some libretro cores (including the tested mGBA build) expose no system memory map
    // to READ_CORE_MEMORY. RetroAchievements' linear GBA RAM map is available instead.
    if (response.includes('-1 no memory map defined')) {
      const physical = gbaAchievementAddress(address);
      if (physical === undefined) throw new Error(`RetroArch memory read failed: ${response}`);
      response = await this.command(`READ_CORE_RAM ${physical.toString(16).toUpperCase()} ${length}`);
    }
    const parts = response.split(/\s+/);
    if (!['READ_CORE_MEMORY', 'READ_CORE_RAM'].includes(parts[0]) || parts[2] === '-1')
      throw new Error(`RetroArch memory read failed: ${response}`);
    const bytes = parts.slice(2);
    if (bytes.length !== length || bytes.some(byte => !/^[0-9a-fA-F]{2}$/.test(byte)))
      throw new Error(`Unexpected RetroArch memory response: ${response}`);
    return Buffer.from(bytes.map(byte => parseInt(byte, 16)));
  }
}

export function gbaAchievementAddress(address: number): number | undefined {
  if (address >= 0x03000000 && address <= 0x03007fff) return address - 0x03000000;
  if (address >= 0x02000000 && address <= 0x0203ffff) return address - 0x02000000 + 0x8000;
  return undefined;
}
