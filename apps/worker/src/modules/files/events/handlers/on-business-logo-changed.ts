import { businessLogoChanged } from '@pospay/contracts';
import type { ClaimedEvent, Tx } from '@pospay/db';

import type { OutboxConsumer } from '../../../../outbox/consumer.ts';
import type { RetireBusinessLogo } from '../../use-cases/retire-business-logo/retire-business-logo.ts';

export function retireBusinessLogoConsumer(useCase: RetireBusinessLogo): OutboxConsumer {
  return {
    id: 'files.retire-business-logo',
    eventTypes: ['BusinessLogoChanged'],
    handle: (tx, event) => retire(useCase, tx, event),
  };
}

// حمولة ناقصة تُفشل التسليم حتى لا يُقر حدث لا نستطيع تقاعده. أول ربط بلا ملف سابق لا أثر له.
async function retire(useCase: RetireBusinessLogo, tx: Tx, event: ClaimedEvent): Promise<void> {
  const parsed = businessLogoChanged.safeParse(event.payload);
  if (!parsed.success) throw new Error('BUSINESS_LOGO_EVENT_INVALID');
  const previous = parsed.data.previous_file_id;
  if (previous === null) return;
  await useCase.execute(tx, event.companyId, parsed.data.business_id, previous);
}
