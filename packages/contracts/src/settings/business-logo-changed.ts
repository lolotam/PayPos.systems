import { z } from 'zod';

import { id } from '../scalars/id.js';

export const businessLogoChanged = z.strictObject({
  business_id: id,
  previous_file_id: id.nullable(),
  file_id: id.nullable(),
});

export type BusinessLogoChanged = z.infer<typeof businessLogoChanged>;
