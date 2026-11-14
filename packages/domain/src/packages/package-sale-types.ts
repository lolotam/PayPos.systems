import type { Money } from '../money.js';

/** نوع الباقة كما اتقرا تحت أقفال البيع؛ يحمل selling_stopped_at لضبط قبول البيع (PP-100.1). */
export interface SalePackageType {
  readonly id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price: Money;
  readonly validity_days: number;
  readonly revision: number;
  /** بيتقرأ تحت قفل النوع FOR SHARE؛ أي قيمة غير null بترفض البيع (FR-018b). */
  readonly selling_stopped_at: string | null;
  readonly components: readonly SalePackageComponent[];
}

/** حقائق الخدمة التي يقرأها تخطيط البيع بعد قفلها، دون ربط النواة بنوع API الكامل. */
export interface SalePackageService {
  readonly id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price: bigint;
  readonly revision: number;
}

/** الخدمة هي لقطة سعر القائمة والأسماء والنسخة وقاعدة العمولة والعدّادات بعد قفلها، عشان أوزان التوزيع ما تيجيش من سعر خسر السباق (FR-018c). */
export interface SalePackageComponent {
  readonly service_id: string;
  readonly sessions: number;
  readonly position: number;
  readonly service: SalePackageService;
}
