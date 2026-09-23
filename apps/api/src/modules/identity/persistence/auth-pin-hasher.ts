import { hashCashierPin, verifyCashierPin } from '@pospay/auth';

import type { PinHasher } from '../ports/cashier-pins.port.ts';

// packages/auth hashes and checks every PIN (CLAUDE.md §8); this adapter only hands them to the use cases.
export const authPinHasher: PinHasher = {
  hash: hashCashierPin,
  verify: verifyCashierPin,
};
