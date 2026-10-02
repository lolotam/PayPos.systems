import type { StaffSessions } from '@pospay/auth';

/** اختبارات الإدارة ترفض كل عملية موظف ولا تختلق جلسة أو مفتاح قفل. */
export const refusingStaffSessions: StaffSessions = {
  ready: async () => undefined,
  candidate: async () => null,
  issue: async () => {
    throw new Error('SYNTHETIC_STAFF_UNAVAILABLE');
  },
  resolve: async () => null,
  signOut: async () => '',
  normalPurpose: async () => true,
  close: async () => undefined,
};
