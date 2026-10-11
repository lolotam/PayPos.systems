import type { Tx } from '@pospay/db';

/** يرجع نطاق الفرع وتوقيته كي تقرأ اللوحة الفرع المطلوب وتحسب يومه المحلي. */
export type AttendanceBoardContext = (
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
) => Promise<{
  companyId: string;
  businessId: string;
  branchId: string;
  timezone: string;
} | null>;
