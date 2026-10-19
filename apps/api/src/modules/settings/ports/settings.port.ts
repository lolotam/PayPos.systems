import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type { OutboxWriter } from '../../../shared/ports/outbox-writer.port.ts';
import type { SettingsOverrides } from '../domain/business-settings.ts';
import type { BusinessDiscountAccess } from './business-discount-access.port.ts';
import type { BusinessIdentityAccess } from './business-identity-access.port.ts';
import type { LogoFileReader } from './logo-file.port.ts';

/**
 * صف إعدادات النشاط زي ما اتخزن — التعديلات بس، مش القيم الفعلية.
 */
export interface StoredSettings extends SettingsOverrides {
  readonly limitBps: number | null;
  /** قاعدة الضريبة زي ما اتخزنت (شكل الـ contract)، أو null = مفيش ضريبة. */
  readonly taxRule: unknown;
  /** الاسم الرسمي العربي المخزن، أو null لو لسه ما اتكتبش. */
  readonly officialNameAr: string | null;
  /** الاسم الرسمي الإنجليزي المخزن، أو null لو لسه ما اتكتبش. */
  readonly officialNameEn: string | null;
  /** ملف الشعار المخزن، أو null لو مفيش شعار. */
  readonly logoFileId: string | null;
  /** آخر تعديل، ISO زي ما Postgres كتبه. */
  readonly updatedAt: string;
}

/**
 * الأسماء الرسمية الحاضرة في الطلب: null يمسح، والمفتاح الغايب مش موجود هنا.
 */
export interface IdentityNamesChange {
  readonly officialNameAr?: string | null;
  readonly officialNameEn?: string | null;
}

/**
 * التغيير المطلوب: مفتاح مش موجود = سيبه، null = رجّعه للـ template.
 */
export interface SettingsChange {
  readonly limitBps?: number | null;
  readonly defaultLanguage?: SettingsOverrides['defaultLanguage'];
  readonly calendar?: SettingsOverrides['calendar'];
}

/**
 * القرايات والكتابات بتاعة الإعدادات جوه transaction واحدة في الشركة.
 */
export interface SettingsScope {
  readonly discountAccess: BusinessDiscountAccess;
  readonly identityAccess: BusinessIdentityAccess;
  readonly audit: AuditTrail;
  /** الحدث بيتكتب في نفس المعاملة لما إشارة الشعار تتغير. */
  readonly outbox: OutboxWriter;
  /** قفل صف الإعدادات ثم ملف الشعار عند الربط. */
  readonly logoFiles: LogoFileReader;
  /**
   * صف الإعدادات مقفول لحد آخر الـ transaction، أو null لو النشاط لسه ما غيّرش حاجة — عشان الـ audit يسجل قبل وبعد صح.
   *
   * @param businessId النشاط
   */
  findForUpdate(businessId: string): Promise<StoredSettings | null>;
  /**
   * بيطبّق التغيير (بيعمل الصف لو مش موجود) ويرجّعه بعد التغيير.
   *
   * @param businessId النشاط
   * @param change     المفاتيح اللي اتغيرت
   * @param updatedBy  المستخدم اللي غيّر
   */
  save(businessId: string, change: SettingsChange, updatedBy: string): Promise<StoredSettings>;
  /**
   * بيكتب الأسماء الرسمية الحاضرة بس؛ null يمسح والمفتاح الغايب يفضل زي ما هو.
   *
   * @param businessId النشاط
   * @param change     المفاتيح الحاضرة في الطلب
   * @param updatedBy  المستخدم اللي غيّر
   */
  saveIdentity(
    businessId: string,
    change: IdentityNamesChange,
    updatedBy: string,
  ): Promise<StoredSettings>;
  /**
   * بيكتب ملف الشعار أو يمسحه ويرجّع الصف، والأسماء الرسمية بتفضل زي ما هي.
   *
   * @param businessId النشاط
   * @param logoFileId الملف أو null للإزالة
   * @param updatedBy المستخدم اللي غيّر
   */
  saveLogo(
    businessId: string,
    logoFileId: string | null,
    updatedBy: string,
  ): Promise<StoredSettings>;
}

/**
 * بيفتح withTenant للشركة المتأكد منها — النشاط اتأكد إنه تبعها في الـ guard قبل كده.
 */
export interface SettingsTransactions {
  /**
   * @param companyId الشركة
   * @param userId    المستخدم اللي بيغيّر
   * @param work      الشغل جوه الـ transaction
   */
  run<T>(companyId: string, userId: string, work: (scope: SettingsScope) => Promise<T>): Promise<T>;
}

/**
 * الـ cache بتاع قراية الإعدادات في Redis (PRD P0-T10.2) — موديول settings بس هو اللي بيمسحه.
 */
export interface SettingsCache {
  /**
   * بيخلّي أي قيمة متخزنة قديمة بعد تغيير اتكتب: القراية الجاية تيجي من الداتابيز، وأي قراية كانت شغالة قبل التغيير
   * ما تقدرش تخزن القيمة القديمة بعده.
   *
   * @param companyId  الشركة
   * @param businessId النشاط
   */
  invalidate(companyId: string, businessId: string): Promise<void>;
}
