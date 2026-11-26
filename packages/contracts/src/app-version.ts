import { z } from 'zod';

/**
 * صيغة إصدار التطبيق: `MAJOR.MINOR` أو `MAJOR.MINOR.PATCH`، أرقام بس.
 *
 * الصيغة دي ثابتة من أول بناء موقّع، لأن التطبيق المثبّت مش هيعرف حقل اتضاف بعدين
 * (spec 066، «Version file»). أي حاجة تانية — `v1.3` أو `1.3.0-beta` — مش مقروءة.
 */
export const appVersionSemver = z
  .string()
  .regex(/^\d+\.\d+(?:\.\d+)?$/, 'app version must be MAJOR.MINOR or MAJOR.MINOR.PATCH');

/**
 * مدخلات النسخة بتاعة منصة واحدة: الحد الأدنى، وآخر نسخة، ولينك المتجر.
 *
 * التطبيق المثبّت بيقرا `minimum` و`store_url` بس؛ `latest` موجود من دلوق عشان لو
 * اختيار صاحب النسخة اتغيّر بعدين (APP-Q18) يبقى في نسخة التطبيق الجديدة مكان
 * يتفرق عليه من غير تغيير في الشكل.
 */
export const platformAppVersionSchema = z.strictObject({
  minimum: appVersionSemver,
  latest: appVersionSemver,
  store_url: z.string().min(1),
});

/**
 * ملف النسخة: مدخل واحد لكل منصة، لأن iOS وAndroid ليهم حد أدنى مستقلين.
 *
 * رفع الحد الأدنى في منصة واحدة ما بيمنعش المنصة التانية (SC-004).
 */
export const appVersionManifestSchema = z.strictObject({
  ios: platformAppVersionSchema,
  android: platformAppVersionSchema,
});

export type PlatformAppVersion = z.infer<typeof platformAppVersionSchema>;
export type AppVersionManifest = z.infer<typeof appVersionManifestSchema>;
