import type { Money } from '@pospay/domain';
import type { SessionService } from './session-types.ts';

/** نوع الباقة كما اتقرا تحت أقفال البيع؛ بلا selling_stopped_at لحد ما 33b يضيف العمود (PP-100.1). */
export interface SalePackageType {
  readonly id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price: Money;
  readonly validity_days: number;
  readonly revision: number;
  readonly components: readonly SalePackageComponent[];
}

/** الخدمة هي لقطة سعر القائمة والأسماء والنسخة وقاعدة العمولة والعدّادات بعد قفلها، عشان أوزان التوزيع ما تيجيش من سعر خسر السباق (FR-018c). */
export interface SalePackageComponent {
  readonly service_id: string;
  readonly sessions: number;
  readonly position: number;
  readonly service: SessionService;
}
