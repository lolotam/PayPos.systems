import { z } from 'zod';

import { ISO_4217_MINOR_UNITS } from '../generated/iso-4217.js';

// أي كود ISO 4217 (قرار Waleed) من قائمة SIX المتخزنة في الـ package، مش من Intl.
// Money في packages/domain لسه بـ 3 خانات، فالحساب صح لـ KWD بس لحد multi-currency.
export const currency = z
  .enum([...ISO_4217_MINOR_UNITS.keys()] as [string, ...string[]])
  .meta({ id: 'Currency' });
