import type { CommissionBlockNotices } from '../ports/commission-block-notice.port.ts';

/**
 * منفذ جرس صامت للاختبارات اللي مش مهمها الجرس: صفر مستلمين وبلا كتابة،
 * فخطوة التوقف بتمرّ من غير أي حدث (CM-54).
 */
export const noCommissionBlockNotices: CommissionBlockNotices = {
  now: () => new Date(0),
  recipients: async () => [],
  append: async () => undefined,
};
