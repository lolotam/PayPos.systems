import type { Tx } from '@pospay/db';
import { t } from '@pospay/i18n';
import type { OutboxConsumer } from '../../outbox/consumer.ts';
import type { Clock, IdGenerator } from './ports/late-service-session-notice.port.ts';
import { lateNoticeRecipients } from './persistence/branch-manager-recipients.adapter.ts';
import { lateNoticePlace } from './persistence/branch-place.adapter.ts';
import {
  lateNoticeRepository,
  lateNoticeOutbox,
} from './persistence/late-service-session-notice.repository.ts';
import { RequestLateServiceSessionNotice } from './use-cases/request-late-service-session-notice/request-late-service-session-notice.ts';
import { onLateServiceSession } from './events/handlers/on-late-service-session.handler.ts';

export function createLateServiceSessionNoticeConsumer(
  ids: IdGenerator,
  clock: Clock,
): OutboxConsumer {
  const bind = (tx: Tx) =>
    new RequestLateServiceSessionNotice(
      {
        recipients: lateNoticeRecipients(tx),
        place: lateNoticePlace(tx),
        repository: lateNoticeRepository(tx),
        outbox: lateNoticeOutbox(tx),
      },
      ids,
      clock,
      { ar: t('ar', 'inApp.generic_branch'), en: t('en', 'inApp.generic_branch') },
    );
  return {
    id: 'orders.late-service-session-notice-v1',
    eventTypes: ['ServiceSessionRecorded', 'ServiceSessionLinesAdded'],
    handle: (tx, event) => onLateServiceSession(bind(tx), event),
  };
}
