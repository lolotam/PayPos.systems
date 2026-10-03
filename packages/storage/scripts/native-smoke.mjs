import sharp from 'sharp';
import { inspectContent, FILE_UPLOAD_POLICY } from '../dist/index.js';

// نفس مكتبة worker ونسخة الإنتاج؛ فك وترميز حقيقي لكل نوع صورة يقبله قرار المالك.
for (const [format, type] of [
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
]) {
  const source = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#123456' },
  })
    .toFormat(format)
    .toBuffer();
  const result = await inspectContent(source, { type, size: source.length }, FILE_UPLOAD_POLICY);
  const metadata = await sharp(result.bytes).metadata();
  if (metadata.format !== format || metadata.width !== 2 || metadata.height !== 2)
    throw new Error('SHARP_NATIVE_SMOKE_FAILED');
}
console.log(
  `sharp native smoke passed: sharp=${sharp.versions.sharp} vips=${sharp.versions.vips} platform=${process.platform}/${process.arch}`,
);
