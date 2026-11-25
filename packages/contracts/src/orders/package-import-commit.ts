import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';

// حدث الطلب بالهوية فقط؛ حقل إضافي يتطلب نشر العامل أولاً لأن المخطط صارم.
export const packageImportCommitRequested = z
  .strictObject({ preview_id: id })
  .meta({ id: 'PackageImportCommitRequested' });
export const packageImportCommitJob = z.strictObject({ companyId: id, previewId: id });
export const commitPackageImportInput = z
  .strictObject({ preview_id: id })
  .meta({ id: 'CommitPackageImportInput' });
// الطلب يقبل مرة واحدة؛ النتيجة النهائية تقرأ من حالة المعاينة بعد تنفيذ الوظيفة.
export const packageImportCommitAccepted = responseObject({ preview_id: id }).meta({
  id: 'PackageImportCommitAccepted',
});
export const packageImportCommitSchemas = [
  packageImportCommitRequested,
  commitPackageImportInput,
  packageImportCommitAccepted,
];
export type PackageImportCommitRequested = z.infer<typeof packageImportCommitRequested>;
export type CommitPackageImportInput = z.infer<typeof commitPackageImportInput>;
export type PackageImportCommitAccepted = z.infer<typeof packageImportCommitAccepted>;
