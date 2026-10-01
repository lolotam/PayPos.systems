import type { Job } from 'bullmq';
import type { RecoverWhatsappInbox } from '../use-cases/recover-whatsapp-inbox/recover-whatsapp-inbox.ts';
import type { ClearWhatsappPayloads } from '../use-cases/clear-whatsapp-payloads/clear-whatsapp-payloads.ts';

export function whatsappMaintenanceProcessor(
  recover: RecoverWhatsappInbox,
  clear: ClearWhatsappPayloads,
) {
  return async (job: Pick<Job, 'name'>): Promise<void> => {
    if (job.name === 'recover-inbox') await recover.execute();
    else if (job.name === 'clear-payloads') await clear.execute();
    else throw new Error('WHATSAPP_MAINTENANCE_JOB_INVALID');
  };
}
