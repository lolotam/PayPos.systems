import type { Branch } from '@pospay/contracts';

import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type { OutboxWriter } from '../../../shared/ports/outbox-writer.port.ts';

/**
 * business جديد زي ما الـ use case بيسجله — الشركة جاية من الـ transaction نفسها مش من هنا.
 */
export interface NewBusiness {
  readonly id: string;
  readonly verticalType: string;
  readonly nameEn: string;
  readonly nameAr: string | null;
  readonly currency: string;
  readonly timezone: string;
  readonly settings: Record<string, unknown>;
}

/**
 * فرع جديد تحت business في نفس الشركة.
 */
export interface NewBranch {
  readonly id: string;
  readonly businessId: string;
  readonly nameEn: string;
  readonly nameAr: string | null;
  readonly addressAr: string | null;
  readonly addressEn: string | null;
  readonly geo: { lat: number; lng: number } | null;
  readonly openingHours: unknown;
  readonly timeZone: string | null;
}

/**
 * الكتّاب المربوطين بـ transaction واحدة جوه الشركة المتأكد منها.
 */
export interface TenancyScope {
  readonly companyId: string;
  readonly audit: AuditTrail;
  readonly outbox: OutboxWriter;
  /**
   * بيضيف الـ business ويرجّع وقت الإنشاء (ISO زي ما Postgres كتبه، نفس نص القراءة).
   *
   * @param business الـ business الجديد
   */
  insertBusiness(business: NewBusiness): Promise<{ createdAt: string }>;
  /**
   * بيضيف الفرع ويرجّع وقت الإنشاء (ISO زي ما Postgres كتبه) والـ time zone بتاع النشاط عشان الـ use case يحسب الفعلي
   * — الـ FK المركّب بيرفض business شركة تانية.
   *
   * @param branch الفرع الجديد
   */
  insertBranch(branch: NewBranch): Promise<{ createdAt: string; businessTimeZone: string }>;
}

/**
 * الرد اللي بيتخزن مع مفتاح الـ idempotency.
 */
export interface StoredResult {
  readonly status: number;
  readonly body: unknown;
}

/**
 * نطاق تغيير دولة النشاط: القارئ والكاتب مربوطين بنفس transaction الشركة المتأكد منها، والتدقيق
 * بيكتب جواها (34-pre-3 B-6) — قراءة الصف مقفولاً أول، وبعدين كتابة اختيارية واحدة.
 */
export interface BusinessCountryScope {
  readonly companyId: string;
  readonly audit: AuditTrail;
  /**
   * بيقرأ إعدادات النشاط تحت قفل `FOR NO KEY UPDATE` على صف النشاط نفسه، عشان تغيير متزامنين
   * يترتبوا ورا بعض من غير ما يمنعوا إدخال صفوف وليدة على الـ FK؛ `null` يعني النشاط مش مرئي.
   *
   * @param businessId النشاط المطلوب تغيير دولته
   * @returns كائن الإعدادات، أو `{}` لو القيمة المخزّنة مش كائن JSON، أو `null` لو صف النشاط مش مرئي
   */
  lockBusinessCountry(businessId: string): Promise<Record<string, unknown> | null>;
  /**
   * بيدمج مفتاح `country` فقط في الإعدادات المخزّنة بـ SQL على مستوى قاعدة البيانات، فكل مفتاح
   * تاني — `modules` و`features` ومفاتيح الشاشات — بيفضل بقيمته المخزّنة زي ما هو.
   *
   * @param businessId النشاط المطلوب تحديثه
   * @param country رمز الدولة الجديد المتحقق من العقد
   */
  saveBusinessCountry(businessId: string, country: string): Promise<void>;
}

/**
 * نطاق تعديل مواعيد عمل الفرع: القراءة تحت القفل والكتابة الاختيارية وقراءة الفرع بعد التعديل مربوطين بنفس
 * transaction الشركة المتأكد منها، والتدقيق بيكتب جواها.
 */
export interface BranchOpeningHoursScope {
  readonly companyId: string;
  readonly audit: AuditTrail;
  /**
   * بيقرأ مواعيد الفرع تحت قفل `FOR NO KEY UPDATE` على صف الفرع نفسه، وبيشترط إن الفرع تبع النشاط ده، عشان
   * تعديلين متزامنين يترتبوا ورا بعض وفرع نشاط تاني في نفس الشركة يبان غايب.
   *
   * @param businessId النشاط اللي الصلاحية اتقيّمت عنده
   * @param branchId الفرع المطلوب تعديل مواعيده
   * @returns المواعيد المخزّنة كما هي (`null` لو مفيش)، أو `null` لو الفرع مش مرئي تحت النشاط ده
   */
  lockBranchOpeningHours(
    businessId: string,
    branchId: string,
  ): Promise<{ readonly openingHours: unknown } | null>;
  /**
   * بيستبدل عمود المواعيد وحده بالقيمة الجديدة؛ `null` بيمسحها.
   *
   * @param branchId الفرع المقفول
   * @param openingHours المواعيد الجديدة المتحقق منها من العقد، أو `null`
   */
  saveBranchOpeningHours(branchId: string, openingHours: unknown): Promise<void>;
  /**
   * بيقرأ الفرع كاملاً بشكل عقد `Branch` جوه نفس الـ transaction، فالرد هو اللي اتخزّن فعلاً.
   *
   * @param branchId الفرع المقفول
   * @returns الفرع بعد التعديل
   */
  readBranch(branchId: string): Promise<Branch>;
}

/**
 * بيفتح withTenant للشركة المتأكد منها ويعمل claim للمفتاح في نطاق COMPANY قبل أي كتابة (plan v4 T7).
 */
export interface TenancyTransactions {
  /**
   * بينفّذ الشغل مرة واحدة لكل مفتاح؛ الطلب المتعاد بنفس الشكل بياخد الرد المتخزن.
   *
   * @param context             الشركة والمستخدم والعملية
   * @param context.companyId   الشركة اللي الـ guard اتأكد منها
   * @param context.userId      المستخدم اللي بيعمل التغيير
   * @param context.operation   اسم العملية (kebab-case) — جزء من مفتاح الـ idempotency
   * @param idempotency             المفتاح والـ fingerprint
   * @param idempotency.key         الـ Idempotency-Key
   * @param idempotency.fingerprint sha256 للطلب
   * @param work                الكتابة نفسها جوه نفس الـ transaction
   */
  run(
    context: { companyId: string; userId: string; operation: string },
    idempotency: { key: string; fingerprint: string },
    work: (scope: TenancyScope) => Promise<StoredResult>,
  ): Promise<StoredResult & { replayed: boolean }>;
  /**
   * بيفتح withTenant واحدة لتغيير دولة النشاط من غير idempotency — مفيش أثر مال أو مخزون (B-6) —
   * فالقراءة تحت القفل والكتابة الاختيارية والتدقيق كلها جوه transaction واحدة.
   *
   * @param context           الشركة والمستخدم اللي بيعمل التغيير
   * @param context.companyId الشركة اللي الـ guard اتأكد منها
   * @param context.userId    المستخدم صاحب صلاحية `manage:settings:business`
   * @param work              القرار والكتابة جوه نفس الـ transaction؛ `null` يعني النشاط مش مرئي
   */
  runBusinessCountryChange(
    context: { companyId: string; userId: string },
    work: (scope: BusinessCountryScope) => Promise<StoredResult | null>,
  ): Promise<StoredResult | null>;
  /**
   * بيفتح withTenant واحدة لتعديل مواعيد عمل الفرع من غير idempotency — الكتابة استبدال ومفيش أثر مال أو مخزون —
   * فالقراءة تحت القفل والكتابة الاختيارية والتدقيق والقراءة الأخيرة كلها جوه transaction واحدة.
   *
   * @param context           الشركة والمستخدم اللي بيعمل التغيير
   * @param context.companyId الشركة اللي الـ guard اتأكد منها
   * @param context.userId    المستخدم صاحب صلاحية `create:branches:business`
   * @param work              القرار والكتابة جوه نفس الـ transaction؛ `null` يعني الفرع مش مرئي
   */
  runBranchOpeningHoursChange(
    context: { companyId: string; userId: string },
    work: (scope: BranchOpeningHoursScope) => Promise<StoredResult | null>,
  ): Promise<StoredResult | null>;
}

/**
 * إعدادات كل vertical — config مش كود (PRD §7.1).
 */
export interface VerticalTemplates {
  /**
   * الـ template اللي بيتنسخ في settings للـ vertical ده.
   *
   * @param vertical نوع الـ business
   */
  settingsFor(vertical: string): Record<string, unknown>;
}
