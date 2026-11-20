import { commissionCorrectionBlockedNoticeRequested } from '@pospay/contracts';
import { createLogger } from '@pospay/observability';
import { expect, it } from 'vitest';

import type { ClaimedEvent } from '@pospay/db';
import { createInAppTestModule } from '../../../outbox/__tests__/late-service-session-inbox.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { SECOND_REVIEWER } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  A,
  CURRENT,
  blocks,
  db,
  deliver,
  ids,
  owner,
  seedSeptemberPlanGap,
} from './commission-blocked-corrections-db.fixture.ts';

it('N7 (CM-54) the bell is stored as in-app rows carrying only the period', async () => {
  const { lateEvent } = await seedSeptemberPlanGap();
  expect(await deliver(CURRENT, lateEvent)).toEqual({ delivered: true });
  expect(await blocks()).toHaveLength(1);
  const [bell] = await owner`SELECT id::text AS id, aggregate_type,
    aggregate_id::text AS aggregate_id, payload FROM outbox
    WHERE company_id=${A.company} AND event_type='CommissionCorrectionBlockedNoticeRequested'`;
  if (bell === undefined) throw new Error('the blocked-correction bell is required');
  const input: ClaimedEvent = {
    companyId: A.company,
    id: bell.id as string,
    aggregateType: bell.aggregate_type as string,
    aggregateId: bell.aggregate_id as string,
    eventType: 'CommissionCorrectionBlockedNoticeRequested',
    payload: bell.payload,
    attempt: 1,
  };
  const inApp = createInAppTestModule(db, ids, { now: () => new Date(CURRENT) });
  const deliverer = createDeliverer(db, [inApp.consumer], createLogger('silent'), {
    knownEventTypes: inApp.eventTypes,
  });
  expect(await deliverer(input)).toEqual({ delivered: true });

  const rows =
    await owner`SELECT recipient_user_id, template_key, template_revision, locale, safe_parameters
    FROM in_app_notifications WHERE company_id=${A.company} AND source_event_id=${input.id}
    ORDER BY recipient_user_id`;
  expect(rows.map((row) => row.recipient_user_id)).toEqual([SECOND_REVIEWER.user, USER].sort());
  for (const row of rows) {
    expect(row).toMatchObject({
      template_key: 'commission_correction_blocked',
      template_revision: 1,
      locale: 'ar',
    });
    expect(row['safe_parameters']).toEqual([{ name: 'period', type: 'text', value: '2026-09' }]);
  }

  const payload = commissionCorrectionBlockedNoticeRequested.parse(bell.payload);
  expect(Object.keys(payload).sort()).toEqual([
    'block_id',
    'business_id',
    'group_index',
    'notification_recipients',
    'schema_version',
    'source_period',
  ]);
  for (const recipient of payload.notification_recipients) {
    expect(Object.keys(recipient).sort()).toEqual([
      'channel',
      'locale',
      'safe_parameters',
      'template_key',
      'template_revision',
      'user_id',
    ]);
    expect(recipient.safe_parameters.map((parameter) => parameter.name)).toEqual(['period']);
  }
  expect(JSON.stringify(payload)).not.toMatch(/amount|employee|salary|plan_version/i);
});
