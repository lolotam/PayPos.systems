import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type { SettingsOverrides } from '../domain/business-settings.ts';

/**
 * صف إعدادات النشاط زي ما اتخزن — التعديلات بس، مش القيم الفعلية.
 */
export interface StoredSettings extends SettingsOverrides {
  /** قاعدة الضريبة زي ما اتخزنت (شكل الـ contract)، أو null = مفيش ضريبة. */
  readonly taxRule: unknown;
  /** آخر تعديل، ISO زي ما Postgres كتبه. */
  readonly updatedAt: string;
}

/**
 * التغيير المطلوب: مفتاح مش موجود = سيبه، null = رجّعه للـ template.
 */
export interface SettingsChange {
  readonly defaultLanguage?: SettingsOverrides['defaultLanguage'];
  readonly calendar?: SettingsOverrides['calendar'];
}

/**
 * القرايات والكتابات بتاعة الإعدادات جوه transaction واحدة في الشركة.
 */
export interface SettingsScope {
  readonly audit: AuditTrail;
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
   * الرد المتخزن كـ JSON، أو null لو مش موجود أو خلص.
   *
   * @param companyId  الشركة
   * @param businessId النشاط
   */
  get(companyId: string, businessId: string): Promise<string | null>;
  /**
   * بيخزن الرد لمدة قصيرة — لو المسح فات، القيمة القديمة بتفضل دقيقة بالكتير.
   *
   * @param companyId  الشركة
   * @param businessId النشاط
   * @param json       الرد
   */
  set(companyId: string, businessId: string, json: string): Promise<void>;
  /**
   * بيمسح الرد بعد أي تغيير اتكتب، عشان القراية الجاية تيجي من الداتابيز.
   *
   * @param companyId  الشركة
   * @param businessId النشاط
   */
  invalidate(companyId: string, businessId: string): Promise<void>;
}
