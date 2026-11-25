import type { ReminderRecoveryDatabase } from '@pospay/db';

import type { ReminderRecoveryReaders } from '../ports/reminder-recovery.port.ts';

/**
 * محوّل قارئ الاستعادة من واجهة المرسّل إلى منفذ الموديول: القراءة كلها على دور
 * المرسّل (ADR-0061 §1)، ومفيش عميل خام ولا طريق تاني للقاعدة.
 *
 * @param database واجهة المرسّل
 * @returns قارئ الاستعادة
 */
export function reminderRecoveryReaders(database: ReminderRecoveryDatabase): ReminderRecoveryReaders {
  return {
    sampleReminderRecoveryCutoff: () => database.sampleReminderRecoveryCutoff(),
    companyIdPage: (afterId, pageSize) => database.companyIdPage(afterId, pageSize),
    raiseRecoveryFlag: (id, code) => database.raiseRecoveryFlag(id, code),
    openRecoveryFlags: () => database.openRecoveryFlags(),
    parkedCompanyCreatedAfter: (cutoff, cutoffSeq) =>
      database.parkedCompanyCreatedAfter(cutoff, cutoffSeq),
  };
}
