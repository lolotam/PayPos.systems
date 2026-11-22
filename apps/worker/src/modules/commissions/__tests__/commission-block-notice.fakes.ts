import type { CommissionBlockNotices } from '@pospay/commissions-posting';

/**
 * منفذ جرس صامت للاختبارات اللي مش مهمها الجرس: صفر مستلمين وبلا كتابة،
 * فخطوة التوقف بتمرّ من غير أي حدث (CM-54).
 */
export const noCommissionBlockNotices: CommissionBlockNotices = {
  now: () => new Date(0),
  recipientGroups: async () => [],
  append: async () => undefined,
};
