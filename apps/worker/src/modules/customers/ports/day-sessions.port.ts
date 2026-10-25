import type { Tx } from '@pospay/db';
import type { ActiveLine } from '../domain/sessions-of-day.ts';

/** نطاق مجمد يمنع اختلاط كتابات حية جديدة بصفحات الـ bootstrap. */
export interface BootstrapRange {
  readonly cutoff: Date;
  readonly maxSessionId: string;
  readonly recordedAtOrBefore: Date;
}

/** صف زيارة مختصر يكفي لتغذية مسار الجدولة الحي نفسه أثناء الـ bootstrap. */
export interface BootstrapSession {
  readonly sessionId: string;
  readonly businessId: string;
  readonly customerId: string;
  readonly branchId: string;
  readonly occurredAt: Date;
}

/** حالة الزيارات الموجودة في orders، وتصل بحقن callback حتى لا يستوردها customers. */
export interface DaySessionsPort {
  /** يرجع البنود النشطة ومنفذيها في نافذة اليوم لإعادة حساب الجدولة والإسناد من المصدر. */
  activeLines(
    tx: Tx,
    companyId: string,
    businessId: string,
    customerId: string,
    fromInstant: Date,
    toInstant: Date,
  ): Promise<readonly ActiveLine[]>;
  /** يرجع صفحة keyset من الزيارات النشطة ضمن النطاق المجمد لاستكمال الـ bootstrap. */
  sessionsSince(
    tx: Tx,
    companyId: string,
    range: BootstrapRange,
    afterSessionId: string | null,
    limit: number,
  ): Promise<readonly BootstrapSession[]>;
  /** يرجع عدد الزيارات المشمولة بالنطاق للتحقق من تغطية الـ bootstrap. */
  countSince(tx: Tx, companyId: string, range: BootstrapRange): Promise<number>;
}
