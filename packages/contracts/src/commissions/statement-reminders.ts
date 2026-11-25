import { z } from 'zod';

import { id } from '../scalars/id.js';

/** اسم طابور تذكيرات كشف العمولة في Redis؛ الجدولة نفسها باسم الشركة (FR-053). */
export const commissionStatementReminderQueue = 'commissions-statement-reminders';

/** دورية جدولة تذكيرات كشف العمولة: ساعة واحدة (FR-053). */
export const commissionStatementReminderEveryMs = 60 * 60 * 1000;

/** معرّف الجدولة لكل شركة: اسم الطابور ومعرّف الشركة (FR-053). */
export const commissionStatementReminderSchedulerId = (companyId: string): string =>
  `${commissionStatementReminderQueue}-${companyId}`;

/** أنواع سطر دفتر التذكيرات: مراجعة اليوم الثالث واعتماد اليومين الثالث والخامس (FR-053، FR-055). */
export const commissionStatementReminderKinds = [
  'REVIEW_DAY3',
  'APPROVAL_DAY3',
  'APPROVAL_DAY5',
] as const;

/** نوع سطر دفتر التذكيرات. */
export type CommissionStatementReminderKind = (typeof commissionStatementReminderKinds)[number];

/** بيانات مهمة التذكير في Redis هوية الشركة وحدها؛ كل حقيقة أخرى تُقرأ داخل withTenant. */
export const commissionStatementReminderJob = z.strictObject({ companyId: id });
export type CommissionStatementReminderJob = z.infer<typeof commissionStatementReminderJob>;
