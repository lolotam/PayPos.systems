import type { StatementLogo, StatementLogoFile, StatementLogoRequest } from '../domain/statement-logo.ts';
import type { Clock, IdGenerator } from './verification.port.ts';

// مصادر الوقت والهوية مشتركة مع باقي الوحدة، وبتتصدّر من هنا عشان مستهلكي بوابة الشعار ياخدوها من مكان واحد.
export type { Clock, IdGenerator };

/** صف الشعار في ملف الوحدة: فحص الملف وتسجيل وصول واحد لكل رندر. */
export interface StatementLogoStore {
  /**
   * يفحص صف الملف ويسجّل وصول واحداً للرندر جوه معاملة واحدة.
   * الملف اللي ما بيستاهلش (مش READY، أو بدأ حذفه، أو مش بتاع النشاط) بيرجع null من غير أي كتابة.
   *
   * @param companyId الشركة
   * @param request النشاط والملف ومَن طلبه ومعرّف الرندر
   * @param at وقت الوصول المحقون
   * @returns مفتاح الشعار ونوعه، أو null لو الملف ما بيستاهلش
   */
  record(
    companyId: string,
    request: StatementLogoRequest,
    at: Date,
  ): Promise<StatementLogoFile | null>;
}

/** بايتات الشعار من التخزين، من غير أي معاملة مفتوحة. */
export interface StatementLogoBytes {
  /**
   * يقرأ الشعار ويعيد ترميزه لحدود البيان.
   * الملف الناقص في التخزين بيرجع null؛ أي عطل تاني بيفشل المحاولة.
   *
   * @param file مفتاح الشعار ونوعه
   * @param signal إلغاء المهلة
   * @returns الشعار بعد التصغير، أو null لو الكائن مش موجود
   */
  read(file: StatementLogoFile, signal?: AbortSignal): Promise<StatementLogo | null>;
}
