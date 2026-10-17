import type { Tx } from '@pospay/db';
import { editorLabel, safeDisplayName, t } from '@pospay/i18n';
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
import type { PriceEditNameFallback } from './domain/price-edit-notice.ts';
import { priceEditRecipients } from './persistence/price-edit-recipients.adapter.ts';
import { priceEditPlace } from './persistence/price-edit-place.adapter.ts';
import {
  priceEditRepository,
  priceEditOutbox,
} from './persistence/service-line-edit-notice.repository.ts';
import { RequestPriceEditNotice } from './use-cases/request-price-edit-notice/request-price-edit-notice.ts';
import { onServiceLineChanged } from './events/handlers/on-service-line-changed.handler.ts';
import type { LineCancelNameFallback } from './domain/line-cancel-notice.ts';
import { lineCancelRecipients } from './persistence/line-cancel-recipients.adapter.ts';
import { lineCancelPlace } from './persistence/line-cancel-place.adapter.ts';
import {
  lineCancelRepository,
  lineCancelOutbox,
} from './persistence/service-line-cancel-notice.repository.ts';
import { RequestLineCancelNotice } from './use-cases/request-line-cancel-notice/request-line-cancel-notice.ts';
import { onLineCancelled } from './events/handlers/on-line-cancelled.handler.ts';

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
export function createPriceEditNoticeConsumer(ids: IdGenerator, clock: Clock): OutboxConsumer {
  const bind = (tx: Tx) =>
    new RequestPriceEditNotice(
      {
        recipients: priceEditRecipients(tx),
        place: priceEditPlace(tx),
        repository: priceEditRepository(tx),
        outbox: priceEditOutbox(tx),
      },
      ids,
      clock,
      priceEditFallback(),
    );
  return {
    id: 'orders.price-edit-notice-v1',
    eventTypes: ['ServiceLineChanged'],
    handle: (tx, event) => onServiceLineChanged(bind(tx), event),
  };
}
export function createLineCancelNoticeConsumer(ids: IdGenerator, clock: Clock): OutboxConsumer {
  const bind = (tx: Tx) =>
    new RequestLineCancelNotice(
      {
        recipients: lineCancelRecipients(tx),
        place: lineCancelPlace(tx),
        repository: lineCancelRepository(tx),
        outbox: lineCancelOutbox(tx),
      },
      ids,
      clock,
      lineCancelFallback(),
    );
  return {
    id: 'orders.line-cancel-notice-v1',
    eventTypes: ['ServiceLineChanged'],
    handle: (tx, event) => onLineCancelled(bind(tx), event),
  };
}
function priceEditFallback(): PriceEditNameFallback {
  return {
    service: { ar: t('ar', 'serviceSessions.service'), en: t('en', 'serviceSessions.service') },
    branch: { ar: t('ar', 'inApp.generic_branch'), en: t('en', 'inApp.generic_branch') },
    safeName: safeDisplayName,
    editorText: editorLabel,
  };
}
function lineCancelFallback(): LineCancelNameFallback {
  return {
    service: { ar: t('ar', 'serviceSessions.service'), en: t('en', 'serviceSessions.service') },
    branch: { ar: t('ar', 'inApp.generic_branch'), en: t('en', 'inApp.generic_branch') },
    safeName: safeDisplayName,
  };
}
