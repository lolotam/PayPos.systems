import type { QrBranch, QrSecretScope } from '../domain/attendance-qr.ts';

/** منفذ قراءة الفرع؛ التنفيذ بيرجع بيانات العرض من tenancy تحت RLS. */
export interface AttendanceBranchReader {
  /**
   * بيرجع اسم وتوقيت الفرع النشط تحت RLS عشان الإصدار مايكشفش بيانات فرع تاني.
   *
   * @param companyId الشركة الموثقة
   * @param branchId الفرع الموثق
   * @returns بيانات الفرع أو null لو مش متاح
   */
  read(companyId: string, branchId: string): Promise<QrBranch | null>;
}

/** منفذ حفظ السر اليومي المشترك؛ أسراره بتفضل جوه السيرفر. */
export interface AttendanceQrSecrets {
  /**
   * بيختار سر يومي واحد لكل فرع حتى لو أكتر من سيرفر بيصدروا أول رمز مع بعض.
   *
   * @param scope نطاق الشركة والفرع واليوم ووقت انتهاء الاحتفاظ
   * @returns السر الموجود أو السر الجديد اللي كسب الاختيار الذري
   */
  getOrCreate(scope: QrSecretScope): Promise<string>;
  /**
   * بيقرا السر الموجود بس؛ التحقق ماينفعش يعيد إنشاء سر ضاع من Redis.
   *
   * @param scope نطاق السر الخاص بالنافذة المقبولة
   * @returns السر الموجود أو null
   */
  read(scope: QrSecretScope): Promise<string | null>;
}

/** منفذ توقيع إثبات الفرع وفحصه من غير اعتماد دومين الحضور على مكتبة تشفير. */
export interface AttendanceQrSigner {
  /**
   * بيوقع إثبات الفرع والنافذة بالسر اليومي من غير ما السر يدخل عقد الـ API.
   *
   * @param companyId الشركة الموثقة
   * @param branchId الفرع الموثق
   * @param window النافذة المطلوب توقيعها
   * @param secret السر اليومي داخل السيرفر فقط
   * @returns توقيع الإثبات
   */
  sign(companyId: string, branchId: string, window: number, secret: string): string;
  /**
   * بيفحص التوقيع بزمن ثابت عشان الفروق الزمنية ماتكشفش أجزاء منه.
   *
   * @param companyId الشركة الموثقة
   * @param branchId الفرع المقصود
   * @param window النافذة المقبولة
   * @param secret السر اليومي داخل السيرفر فقط
   * @param signature التوقيع المقروء من الرمز
   * @returns هل التوقيع يطابق الإثبات المتوقع
   */
  verify(
    companyId: string,
    branchId: string,
    window: number,
    secret: string,
    signature: string,
  ): boolean;
}
