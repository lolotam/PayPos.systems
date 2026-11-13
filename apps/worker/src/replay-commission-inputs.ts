import { parseArgs } from 'node:util';
import { createDatabase, createOutboxDispatcherDatabase, ReplayCursorError } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import {
  assertCommissionReplayCursor,
  CommissionReplayCursorError,
  CommissionReplayEventInvalidError,
  createCommissionInputsConsumer,
  recordCommissionFailureCodes,
  runCommissionInputReplay,
} from './modules/commissions/index.ts';
import { readEmployeeBusiness } from './modules/staff/index.ts';
import { businessCalendar, businessTimeZone } from './modules/tenancy/index.ts';
import { createDeliverer } from './outbox/deliver.ts';

// مشغّل صريح فقط؛ main.ts لا يستورده، ولا يحتاج Redis أو أي قدرة اختيارية.
try {
  const { values } = parseArgs({
    options: {
      company: { type: 'string' },
      after: { type: 'string' },
      through: { type: 'string' },
    },
  });
  assertCommissionReplayCursor(values.after ?? null, values.through ?? null);
  const appUrl = process.env['DATABASE_URL'];
  const dispatcherUrl = process.env['DISPATCHER_DATABASE_URL'];
  if (!values.company || !appUrl || !dispatcherUrl)
    throw new Error('COMMISSION_REPLAY_CONFIGURATION');
  const ids = systemUuidV7();
  const app = createDatabase({ url: appUrl, ids, maxConnections: 1 });
  const reader = createOutboxDispatcherDatabase({ url: dispatcherUrl, maxConnections: 1 });
  let failure: unknown;
  try {
    await app.ping();
    await reader.ping();
    const consumer = createCommissionInputsConsumer({
      ids,
      clock: { now: () => new Date() },
      businessTimeZone,
      employeeBusiness: readEmployeeBusiness,
      businessCalendar,
    });
    const failures = new Map<string, string>();
    const wrapped = recordCommissionFailureCodes(consumer, failures);
    const deliver = createDeliverer(app, [wrapped], createLogger('error'), {
      knownEventTypes: wrapped.eventTypes,
    });
    const result = await runCommissionInputReplay(
      { reader, deliver, failures },
      {
        companyId: values.company,
        afterId: values.after ?? null,
        throughId: values.through ?? null,
      },
    );
    console.log(JSON.stringify(result));
    if (result.status !== 'COMPLETE') process.exitCode = 1;
  } catch (error) {
    failure = error;
  }
  const closed = await Promise.allSettled([reader.close(), app.close()]);
  if (failure !== undefined) throw failure;
  if (closed.some((entry) => entry.status === 'rejected'))
    throw new Error('COMMISSION_REPLAY_CLOSE_FAILED');
} catch (error) {
  // الخطأ الخام قد يحمل SQL أو رابط اتصال؛ المشغّل يتلقى رمزًا ثابتًا فقط.
  console.error(
    error instanceof ReplayCursorError ||
    error instanceof CommissionReplayCursorError ||
    error instanceof CommissionReplayEventInvalidError
      ? (error as { readonly code: string }).code
      : 'COMMISSION_REPLAY_FAILED',
  );
  process.exitCode = 1;
}
