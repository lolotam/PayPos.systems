import { z } from 'zod';

// دول الخليج الست المقبولة لدولة النشاط (قرار المالك OQ-3 = أ، 2026-11-21)، نفس قائمة GCC_IBAN_COUNTRIES
// في packages/domain؛ تتزوّد لاحقاً بإضافة القيمتين هنا وهناك من غير كسر أي متخزن.
export const country = z
  .enum(['KW', 'SA', 'AE', 'BH', 'QA', 'OM'])
  .meta({ id: 'Country' });

export type Country = z.infer<typeof country>;
