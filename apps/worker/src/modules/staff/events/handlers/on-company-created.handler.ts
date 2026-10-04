import type { Tx } from '@pospay/db';
import type { OutboxConsumer } from '../../../../outbox/consumer.ts';
import type { SeedDocumentTypes } from '../../use-cases/seed-document-types/seed-document-types.ts';

// الشركة الجديدة تبدأ بأنواع الوثائق الموصى بها؛ إعادة التسليم لا تضيف شيئاً.
// قرار المالك 2026-10-04 (DOC-Q7، الخيار الموصى به): شركة تُنشأ أثناء نشر يعمل فيه worker أقدم قد تفوتها البذرة؛ يضيف المدير الأنواع يدوياً.
export function companyCreatedConsumer(seed: (tx: Tx) => SeedDocumentTypes): OutboxConsumer {
  return {
    id: 'staff.document-type-defaults',
    eventTypes: ['CompanyCreated'],
    handle: async (tx) => {
      await seed(tx).execute();
    },
  };
}
