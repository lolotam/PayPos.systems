import { z } from 'zod';
import { id } from '../scalars/id.js';

// بلا meta ولا تسجيل في قائمة OpenAPI: المستهلك (32b-3) بيتسجل قبل المنتج (32b-5)، وييجي تسجيل المخطط مع مسار القبول.
export const serviceImportCommitRequested = z.strictObject({ preview_id: id });
export const serviceImportCommitJob = z.strictObject({ companyId: id, previewId: id });
export type ServiceImportCommitRequested = z.infer<typeof serviceImportCommitRequested>;
