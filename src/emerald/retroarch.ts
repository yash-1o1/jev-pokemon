import dgram from 'node:dgram';

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

  async readMemory(address: number, length: number): Promise<Buffer> {
    if (!Number.isInteger(address) || address < 0 || address > 0xffffffff)
      throw new Error('Invalid memory address');
    if (!Number.isInteger(length) || length < 1 || length > 256)
      throw new Error('Read length must be between 1 and 256');
    const response = await this.command(`READ_CORE_MEMORY ${address.toString(16).toUpperCase()} ${length}`);
    const parts = response.split(/\s+/);
    if (parts[0] !== 'READ_CORE_MEMORY' || parts[2] === '-1')
      throw new Error(`RetroArch memory read failed: ${response}`);
    const bytes = parts.slice(2);
    if (bytes.length !== length || bytes.some(byte => !/^[0-9a-fA-F]{2}$/.test(byte)))
      throw new Error(`Unexpected RetroArch memory response: ${response}`);
    return Buffer.from(bytes.map(byte => parseInt(byte, 16)));
  }
}
