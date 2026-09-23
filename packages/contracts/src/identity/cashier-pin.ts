import { z } from 'zod';

import { id } from '../scalars/id.js';

// PIN الكاشير على جهاز متوافق عليه (ADR-0003 §4 path B، PRD D-08): 4 أرقام، والـ PIN نفسه عمره ما بيرجع في رد.
export const verifyCashierPinInput = z
  .object({ employee_id: id, pin: z.string().regex(/^[0-9]{4}$/) })
  .strict()
  .meta({ id: 'VerifyCashierPinInput' });

export const cashierPinVerified = z.object({ employee_id: id }).meta({ id: 'CashierPinVerified' });

export type VerifyCashierPinInput = z.infer<typeof verifyCashierPinInput>;
export type CashierPinVerified = z.infer<typeof cashierPinVerified>;
