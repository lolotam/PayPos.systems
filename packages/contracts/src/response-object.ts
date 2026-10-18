import { z } from 'zod';

const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };

// السيرفر واختبارات الـ API والـ OpenAPI بيشغلوا العقود strict عشان تسريب حقل (راتب، تليفون، IBAN) يفضل بيفشل؛ المتصفح من غير المتغير ده بيشيل المفتاح الزيادة.
const serverSide = runtime.process?.env?.['POSPAY_STRICT_RESPONSES'] === '1';

/**
 * سكيما رد يتجاهلها المتصفح القديم لو زاد حقل أثناء النشر.
 * الحزمة المفتوحة لسه ماسكة السكيما القديمة، ورفض المفتاح الجديد كان بيسقط الشاشة كلها لحد ما تتعمل إعادة تحميل.
 * إعادة التحميل بتضيع سطور البيع اللي لسه متتحفظتش وطابور الأوفلاين، فالمفتاح الزيادة يتشال من الناتج والمتصفح يكمل بالحقول اللي يعرفها.
 * لما POSPAY_STRICT_RESPONSES=1 (اختبارات الـ API وتوليد OpenAPI) بتتصرف strict، فالسيرفر مايقدرش يسرّب حقل من غير ما اختبار يفشل.
 *
 * @param shape حقول الرد المعروفة للنسخة دي
 * @returns سكيما Zod بتشيل المفاتيح غير المعروفة بدل ما ترفض الرد، أو strict على السيرفر
 */
export const responseObject: typeof z.object = serverSide
  ? (((shape, params) => z.strictObject(shape ?? {}, params)) as typeof z.object)
  : z.object;
