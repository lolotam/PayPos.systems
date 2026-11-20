import { z } from 'zod';
import { id } from '../scalars/id.js';

// بلا meta ولا تسجيل في قائمة OpenAPI: المستهلك يُسجّل قبل المنتج، ويأتي تسجيل المخطط مع مسار الطلب في 47-2d.
export const packageImportCommitRequested = z.strictObject({ preview_id: id });
export const packageImportCommitJob = z.strictObject({ companyId: id, previewId: id });
export type PackageImportCommitRequested = z.infer<typeof packageImportCommitRequested>;
