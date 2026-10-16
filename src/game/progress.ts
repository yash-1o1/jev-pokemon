import sharp from 'sharp';

/** Capture gameplay state above Emerald's dialogue box, so changing text alone
 * cannot masquerade as route progress. Position tracking covers overworld moves. */
export async function screenshotProgressSignal(screenshot: string): Promise<Buffer> {
  const metadata = await sharp(screenshot).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Cannot read screenshot dimensions: ${screenshot}`);
  const gameplayHeight = Math.floor(metadata.height * 0.68);
  return sharp(screenshot)
    .extract({ left: 0, top: 0, width: metadata.width, height: gameplayHeight })
    .resize({ width: 160, height: 50, fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
}
