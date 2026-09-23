import {
  formatDeviceToken,
  hashDeviceSecret,
  newDeviceSecret,
  parseDeviceToken,
  verifyDeviceSecret,
} from '@pospay/auth';

import type { DeviceSecrets } from '../ports/devices.port.ts';

// packages/auth makes and checks every device secret (CLAUDE.md §8); this adapter only hands them to the use cases.
export const authDeviceSecrets: DeviceSecrets = {
  newSecret: newDeviceSecret,
  hash: hashDeviceSecret,
  verify: verifyDeviceSecret,
  format: formatDeviceToken,
  parse: parseDeviceToken,
};
