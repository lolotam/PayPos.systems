import { z } from 'zod';

import { page } from '../pagination/cursor.js';
import { service } from './service.js';

export const packageServiceOption = service
  .pick({ id: true, name_ar: true, name_en: true, price: true })
  .extend({ active: z.boolean() })
  .meta({ id: 'PackageServiceOption' });

export const packageServiceOptionPage = page(packageServiceOption).meta({
  id: 'PackageServiceOptionPage',
});

export const packageServiceOptionSchemas = [packageServiceOption, packageServiceOptionPage];
export type PackageServiceOption = z.infer<typeof packageServiceOption>;
export type PackageServiceOptionPage = z.infer<typeof packageServiceOptionPage>;
