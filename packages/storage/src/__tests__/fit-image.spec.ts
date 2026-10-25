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

// ضوضاء ثابتة البذرة: مولد xorshift ببت 32 بت، عشان نفس المدخل يطلع نفس البايتات في كل تشغيل.
function noisyPixels(width: number, height: number, seed: number): Buffer {
  const pixels = Buffer.alloc(width * height * 3);
  let state = seed >>> 0;
  for (let index = 0; index < pixels.length; index += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    pixels[index] = (state >>> 24) & 0xff;
  }
  return pixels;
}

function noisyPng(width: number, height: number, seed: number): Promise<Buffer> {
  return sharp(noisyPixels(width, height, seed), { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
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

describe('fitImage size fallback', () => {
  it('shrinks a noisy PNG that stays over the cap at the full side', async () => {
    const source = await noisyPng(512, 512, 0x1234_5678);
    const atFullSide = await sharp(source)
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(atFullSide.byteLength).toBeGreaterThan(limits.maxBytes);
    const out = await fitImage(source, 'image/png', limits);
    expect(out.byteLength).toBeLessThanOrEqual(limits.maxBytes);
    const metadata = await sharp(out).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(384);
  });

  it('quantizes to a palette when only the palette fits the cap', async () => {
    const tight = { maxSide: 512, maxBytes: 120 * 1024 };
    const source = await noisyPng(512, 512, 0x9e37_79b9);
    const atSmallSide = await sharp(source)
      .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(atSmallSide.byteLength).toBeGreaterThan(tight.maxBytes);
    const out = await fitImage(source, 'image/png', tight);
    expect(out.byteLength).toBeLessThanOrEqual(tight.maxBytes);
    const metadata = await sharp(out).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(256);
    expect(metadata.isPalette).toBe(true);
  });

  it('encodes the same input to the same bytes every time', async () => {
    const source = await noisyPng(512, 512, 0x0bad_c0de);
    const first = await fitImage(source, 'image/png', limits);
    const second = await fitImage(source, 'image/png', limits);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it('refuses a JPEG that stays over the cap even at the smallest side', async () => {
    const source = await sharp(noisyPixels(512, 512, 0x2468_1357), {
      raw: { width: 512, height: 512, channels: 3 },
    })
      .jpeg()
      .toBuffer();
    await expect(fitImage(source, 'image/jpeg', { maxSide: 512, maxBytes: 1024 })).rejects.toThrow(
      'FILE_SIZE_INVALID',
    );
  });

  it('refuses a PNG that stays over the cap even with a palette', async () => {
    const source = await noisyPng(512, 512, 0x1357_9bdf);
    await expect(fitImage(source, 'image/png', { maxSide: 512, maxBytes: 10 })).rejects.toThrow(
      'FILE_SIZE_INVALID',
    );
  });
});
