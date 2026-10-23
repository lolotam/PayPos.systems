import sharp from 'sharp';

import { FileValidationError } from './domain/files.ts';

/**
 * بيقصّ الصورة وبيعيد ترميزها لحدود المستند اللي بيستقبلها.
 * الشعار المخزّن ممكن يوصل 10 MiB، والـ base64 بتاعه في قالب الـ PDF بياخد نص السقف تقريباً (4 MiB)؛
 * القصّ على 512 px وحد 512 KiB بيخلي الشعار جوه السقف من غير ما يفقد معناه.
 * نفس إعدادات sharp المستخدمة في فحص الرفع، عشان الصورة اللي عدّت الفحص تطلع بنفس الشكل.
 *
 * @param bytes بايتات الصورة المخزّنة
 * @param type نوع الصورة المخزّن
 * @param limits الحد الأقصى للضلع والحجم بالبايت
 * @returns بايتات الصورة بعد القصّ والترميز
 */
export async function fitImage(
  bytes: Uint8Array,
  type: 'image/png' | 'image/jpeg',
  limits: { maxSide: number; maxBytes: number },
): Promise<Uint8Array> {
  const encoded = await encode(bytes, type, limits);
  if (encoded.byteLength > limits.maxBytes) throw new FileValidationError('FILE_SIZE_INVALID');
  return new Uint8Array(encoded);
}

async function encode(
  bytes: Uint8Array,
  type: 'image/png' | 'image/jpeg',
  limits: { maxSide: number; maxBytes: number },
): Promise<Buffer> {
  try {
    const image = sharp(bytes, {
      limitInputPixels: 16_000_000,
      failOn: 'warning',
      animated: false,
    })
      .autoOrient()
      .resize({
        width: limits.maxSide,
        height: limits.maxSide,
        fit: 'inside',
        withoutEnlargement: true,
      });
    // PNG يضيع في الضغط الافتراضي، والصورة الصاخبة بتعدّي حد الـ 512 KiB؛ فضغطه بأعلى درجة.
    if (type === 'image/png') return await image.png({ compressionLevel: 9 }).toBuffer();
    return await image.jpeg().toBuffer();
  } catch {
    throw new FileValidationError('FILE_CONTENT_INVALID');
  }
}
