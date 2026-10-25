import sharp from 'sharp';

import { FileValidationError } from './domain/files.ts';

/**
 * أضلاع التصغير بالترتيب: الحد الأقصى للضلع أولًا، وبعدين ضلعان أصغر.
 * سببها إن صورة صاخبة (فوتوغرافية أو PNG فيها تفاصيل كتير) ممكن تفضل فوق سقف البايتات
 * حتى بعد القصّ على الحد الأقصى، فمحتاجة درجات تانية قبل ما نرفض الشعار.
 */
const FALLBACK_SIDES = [384, 256] as const;

/** إعدادات ترميز PNG بالدرّج اللوني: عدد الألوان والجودة ومعايرة الجهد اختيارية، والافتراضي أعلى جودة. */
interface PaletteOptions {
  palette: boolean;
  compressionLevel: number;
  colours?: number;
  quality?: number;
  effort?: number;
}

/**
 * إعدادات التدرّج اللوني بالترتيب: الأول بالافتراضي، وبعدين بألوان أقل لما يبقى محتاج.
 * الثوابت دي هي اللي بتخلي نفس المدخلات تطلع نفس البايتات في كل تشغيل.
 */
const PALETTE_ATTEMPTS: PaletteOptions[] = [
  { palette: true, compressionLevel: 9 },
  { palette: true, compressionLevel: 9, colours: 128, quality: 90, effort: 10 },
  { palette: true, compressionLevel: 9, colours: 64, quality: 80, effort: 10 },
];

/**
 * بيقصّ الصورة وبيعيد ترميزها لحدود المستند اللي بيستقبلها.
 * الشعار المخزّن ممكن يوصل 10 MiB، والـ base64 بتاعه في قالب الـ PDF بياخد نص السقف تقريباً (4 MiB)؛
 * القصّ على 512 px وحد 512 KiB بيخلي الشعار جوه السقف من غير ما يفقد معناه.
 * القصّ لوحده مش كفّي: الصورة الصاخبة ممكن تفضل فوق حد الـ 512 KiB بعد أول ترميز، وده كان بيخلي
 * كل بيانات النشاط ده تفشل والشعار يفضل مربوط. عشان كده بنرجع للصورة الأصلية بأضلاع أصغر
 * (384 وبعدين 256) قبل ما نرفض، وللـ PNG بنجرب التدرّج اللوني كمان.
 * كل خطوة بتبدأ من الصورة الأصلية مش من الناتج اللي قبلها، والخطوات ثابتة عشان نفس المدخلات
 * تطلع نفس البايتات في كل تشغيل.
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
  const sides = sizeSteps(limits.maxSide);
  for (const side of sides) {
    const encoded = await encode(bytes, type, side);
    if (encoded.byteLength <= limits.maxBytes) return new Uint8Array(encoded);
  }
  const palette =
    type === 'image/png' ? await encodePalette(bytes, sides.at(-1), limits.maxBytes) : null;
  if (palette !== null) return palette;
  throw new FileValidationError('FILE_SIZE_INVALID');
}

// خطوات التصغير: الحد الأقصى أولًا، وبعدين الأضلاع الأصغر اللي تدخل في السقف، من غير تكرار.
function sizeSteps(maxSide: number): number[] {
  const candidates = [maxSide, ...FALLBACK_SIDES].filter((side) => side <= maxSide);
  return [...new Set(candidates)];
}

// الترميز بحدّ معيّن؛ المدخل اللي مش صورة بيقع هنا من أول خطوة، فما بيرجعش يتجرّب تاني.
async function encode(
  bytes: Uint8Array,
  type: 'image/png' | 'image/jpeg',
  side: number,
): Promise<Buffer> {
  try {
    const image = sharp(bytes, {
      limitInputPixels: 16_000_000,
      failOn: 'warning',
      animated: false,
    })
      .autoOrient()
      .resize({
        width: side,
        height: side,
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

// خطوة التدرّج اللوني: آخر ضلع بس بألوان أقل، وهي الخطوة الأخيرة قبل رفض الشعار.
async function encodePalette(
  bytes: Uint8Array,
  side: number | undefined,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (side === undefined) return null;
  for (const options of PALETTE_ATTEMPTS) {
    try {
      const encoded = await sharp(bytes, {
        limitInputPixels: 16_000_000,
        failOn: 'warning',
        animated: false,
      })
        .autoOrient()
        .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
        .png(options)
        .toBuffer();
      if (encoded.byteLength <= maxBytes) return new Uint8Array(encoded);
    } catch {
      continue;
    }
  }
  return null;
}
