import { FakePushChannel } from '@pospay/notifications';
import { sql } from 'drizzle-orm';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createPushDeliveryRepository } from '../persistence/drizzle-push-delivery.repository.ts';
import type { PushAdmission } from '../ports/push-admission.port.ts';
import { SendPush } from '../use-cases/send-push/send-push.ts';
import { KEY_ID, PUSH_PARAMETERS, PUSH_USER, pushHarness, pushRecipient } from './push-harness.ts';

type PushHarness = Awaited<ReturnType<typeof pushHarness>>;

interface PendingAttemptOptions {
  readonly subscriptionId: string;
  readonly locale?: 'ar' | 'en';
  readonly deadline?: string | null;
  readonly templateKey?: string;
  readonly parameters?: { name: string; type: 'text'; value: string }[];
}

// محاولة معلّقة بتدخل مباشرة: المستهلك مش بيوصلها، فبتدخل عشان الفحص المحلي يتشخّص.
async function insertPendingAttempt(
  h: PushHarness,
  options: PendingAttemptOptions,
): Promise<string> {
  const id = h.ids.newId();
  const parameters = options.parameters ?? PUSH_PARAMETERS;
  await h.db.withTenant(TENANT.A.company, (tx) =>
    tx.execute(sql`INSERT INTO push_attempts(company_id,id,subscription_id,subscription_generation,user_id,
      business_id,branch_id,source_event_id,template_key,template_revision,locale,safe_parameters,status,
      send_deadline,execution_id,sending_at,finished_at,failure_code,outcome_known,http_status,created_at,updated_at)
      VALUES(${TENANT.A.company},${id},${options.subscriptionId},1,${PUSH_USER},null,null,${h.ids.newId()},
      ${options.templateKey ?? 'shift_not_clocked_in_self'},1,${options.locale ?? 'ar'},
      ${JSON.stringify(parameters)}::jsonb,'PENDING',${options.deadline ?? null},
      null,null,null,null,null,null,now(),now())`),
  );
  return id;
}

export async function pushSendHarness() {
  const h = await pushHarness();
  const channel = new FakePushChannel(h.clock.now);
  let admitted = true;
  const admission: PushAdmission = { reserve: async () => admitted };
  const send = new SendPush(
    createPushDeliveryRepository(h.db),
    channel,
    admission,
    KEY_ID,
    h.clock,
    h.ids,
  );
  const authorizeAttempt = async (
    locale: 'ar' | 'en' = 'ar',
    options: { deadline?: string } = {},
  ) => {
    const subscriptionId = h.ids.newId();
    const deliveryToken = await h.subscribe(TENANT.A.company, subscriptionId, PUSH_USER, locale);
    const event = await h.request([pushRecipient(PUSH_USER, options.deadline)]);
    await h.deliver(event);
    const rows = await h.attempts(event.id);
    const row = rows.find((candidate) => candidate['subscription_id'] === subscriptionId);
    if (row === undefined) throw new Error('TEST_ATTEMPT_MISSING');
    return {
      attemptId: String(row['id']),
      subscriptionId,
      deliveryToken,
      eventId: event.id,
    };
  };
  return {
    ...h,
    channel,
    send,
    authorizeAttempt,
    pendingAttempt: (options: PendingAttemptOptions) => insertPendingAttempt(h, options),
    allowAdmission: (value: boolean) => {
      admitted = value;
    },
    close: h.close,
  };
}
