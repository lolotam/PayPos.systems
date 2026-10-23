import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { fitImage } from '../fit-image.ts';

const limits = { maxSide: 512, maxBytes: 512 * 1024 };

async function image(width: number, height: number, format: 'png' | 'jpeg'): Promise<Buffer> {
  const created = sharp({
    create: { width, height, channels: 3, background: '#112233' },
  });
  return format === 'png' ? created.png().toBuffer() : created.jpeg().toBuffer();
}

describe('fitImage', () => {
  it('keeps a wide PNG a PNG, at most the long side limit, with its aspect', async () => {
    const out = await fitImage(await image(2000, 1000, 'png'), 'image/png', limits);
    const metadata = await sharp(out).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(256);
  });

  it('keeps a wide JPEG a JPEG, at most the long side limit', async () => {
    const out = await fitImage(await image(2000, 1000, 'jpeg'), 'image/jpeg', limits);
    const metadata = await sharp(out).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(256);
  });

  it('never enlarges a small image', async () => {
    const out = await fitImage(await image(100, 100, 'png'), 'image/png', limits);
    const metadata = await sharp(out).metadata();
    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(100);
  });

  it('refuses bytes that are not an image', async () => {
    await expect(fitImage(Buffer.from('not an image'), 'image/png', limits)).rejects.toThrow(
      'FILE_CONTENT_INVALID',
    );
  });

  it('refuses a result larger than the byte limit', async () => {
    await expect(
      fitImage(await image(2000, 1000, 'png'), 'image/png', { maxSide: 512, maxBytes: 10 }),
    ).rejects.toThrow('FILE_SIZE_INVALID');
  });
});
