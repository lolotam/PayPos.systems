import { safeDisplayName, t } from '@pospay/i18n';
import type { Tx } from '@pospay/db';
import type { OutboxConsumer } from '../../outbox/consumer.ts';
import type { PackageRefundNameFallback } from './domain/package-refund-notice.ts';
import { onPackageRefundRecorded } from './events/handlers/on-package-refund-recorded.handler.ts';
import { lineCancelPlace } from './persistence/line-cancel-place.adapter.ts';
import { lineCancelRecipients } from './persistence/line-cancel-recipients.adapter.ts';
import {
  packageRefundOutbox,
  packageRefundRepository,
} from './persistence/package-refund-notice.repository.ts';
import type { Clock, IdGenerator } from './ports/late-service-session-notice.port.ts';
import { RequestPackageRefundNotice } from './use-cases/request-package-refund-notice/request-package-refund-notice.ts';

/**
 * مستهلك جرس استرداد الباقة: بيقرأ حدث PackageRefundRecorded وبيحجز صف الدفتر مرة واحدة
 * لكل استرداد، ويكتب طلب الجرس في مجموعات لحد مئة.
 */
export function createPackageRefundNoticeConsumer(ids: IdGenerator, clock: Clock): OutboxConsumer {
  const bind = (tx: Tx) =>
    new RequestPackageRefundNotice(
      {
        recipients: lineCancelRecipients(tx),
        place: lineCancelPlace(tx),
        repository: packageRefundRepository(tx),
        outbox: packageRefundOutbox(tx),
      },
      ids,
      clock,
      packageRefundFallback(),
    );
  return {
    id: 'orders.package-refund-notice-v1',
    eventTypes: ['PackageRefundRecorded'],
    handle: (tx, event) => onPackageRefundRecorded(bind(tx), event),
  };
}

function packageRefundFallback(): PackageRefundNameFallback {
  return {
    packageName: {
      ar: t('ar', 'inApp.generic_package'),
      en: t('en', 'inApp.generic_package'),
    },
    branch: { ar: t('ar', 'inApp.generic_branch'), en: t('en', 'inApp.generic_branch') },
    safeName: safeDisplayName,
  };
}
