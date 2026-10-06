import { createWorker, type Worker } from 'tesseract.js';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export class ScreenReader {
  private worker?: Worker;

  async read(file: string): Promise<string> {
    if (!this.worker) {
      const cachePath = path.resolve('.local/ocr');
      fs.mkdirSync(cachePath, { recursive: true });
      this.worker = await createWorker('eng', undefined, { cachePath });
    }
    const clean = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 1200);
    const original = clean((await this.worker.recognize(file)).data.text);
    if (original) return original;
    const enlarged = await sharp(file).resize({ width: 1200, kernel: 'lanczos3' })
      .grayscale().normalize().threshold(128).png().toBuffer();
    return clean((await this.worker.recognize(enlarged)).data.text);
  }

  async close(): Promise<void> {
    await this.worker?.terminate();
  }
}
