import { z } from 'zod';

import { documentRenderErrorCode, documentRenderState } from '../documents-render.js';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';

/**
 * طلب تصدير كشف شهر معتمد: لغة الملف بيختارها المستخدم في كل طلب ومفيش لغة افتراضية من السيرفر (CS-Q33).
 * النطاق والفروع والموظفات مش من العميل أبداً؛ السيرفر بيحلّها من صلاحية الطالب وقت الطلب (FR-050).
 */
export const commissionStatementExportRequest = z
  .strictObject({ language: z.enum(['ar', 'en']) })
  .meta({ id: 'CommissionStatementExportRequest' });

/** رد قبول الطلب: معرّف المستند اللي بيتتابع بيه ويتحمّل (ADR-0049). */
export const commissionStatementExportAccepted = responseObject({ render_id: id }).meta({
  id: 'CommissionStatementExportAccepted',
});

/** حالة المستند عند الاستعلام؛ كود الفشل بيظهر في حالة FAILED بس. */
export const commissionStatementExportStatus = responseObject({
  state: documentRenderState,
  error_code: documentRenderErrorCode.optional(),
}).meta({ id: 'CommissionStatementExportStatus' });

export type CommissionStatementExportRequest = z.infer<typeof commissionStatementExportRequest>;
export type CommissionStatementExportStatus = z.infer<typeof commissionStatementExportStatus>;

export const commissionStatementExportSchemas = [
  commissionStatementExportRequest,
  commissionStatementExportAccepted,
  commissionStatementExportStatus,
] as const;
