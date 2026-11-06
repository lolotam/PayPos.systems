import { parseArgs } from 'node:util';
import { createDatabase, createOutboxDispatcherDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import {
  createRatingSchedulingConsumer,
  recoverRatingClaims,
  startRatingClaimsRegistrar,
} from './modules/customers/index.ts';
import { daySessionsReader } from './modules/orders/index.ts';
import { createDeliverer } from './outbox/deliver.ts';

// مشغّل صريح فقط؛ main.ts لا يستورده، ولا تُنشأ قدرة token أو Worker للمطالبة هنا.
try {
  const { values } = parseArgs({
    options: {
      company: { type: 'string' },
      after: { type: 'string' },
      through: { type: 'string' },
    },
  });
  const appUrl = process.env['DATABASE_URL'];
  const dispatcherUrl = process.env['DISPATCHER_DATABASE_URL'];
  const redisUrl = process.env['REDIS_URL'];
  if (!values.company || !appUrl || !dispatcherUrl || !redisUrl)
    throw new Error('RATING_CLAIMS_RECOVERY_CONFIGURATION');
  const ids = systemUuidV7();
  const app = createDatabase({ url: appUrl, ids, maxConnections: 1 });
  const reader = createOutboxDispatcherDatabase({ url: dispatcherUrl, maxConnections: 1 });
  const registrar = startRatingClaimsRegistrar({ redisUrl });
  let failure: unknown;
  try {
    await app.ping();
    await reader.ping();
    await registrar.ready();
    const deliverSchedules = createDeliverer(
      app,
      [
        createRatingSchedulingConsumer({
          ids,
          clock: { now: () => new Date() },
          daySessions: daySessionsReader,
        }),
      ],
      createLogger('error'),
      { knownEventTypes: [] },
    );
    const result = await recoverRatingClaims(
      { reader, registrar, deliverSchedules },
      {
        companyId: values.company,
        afterId: values.after ?? null,
        throughId: values.through ?? null,
      },
    );
    console.log(JSON.stringify(result));
    if (!result.complete) process.exitCode = 1;
  } catch (error) {
    failure = error;
  }
  const closed = await Promise.allSettled([registrar.close(), reader.close(), app.close()]);
  if (failure !== undefined) throw failure;
  if (closed.some((entry) => entry.status === 'rejected'))
    throw new Error('RATING_CLAIMS_RECOVERY_CLOSE_FAILED');
} catch {
  // الأخطاء الخام قد تحمل SQL أو رابط اتصال؛ الحالة الثابتة تمنع كشفها في تشغيل يدوي.
  console.error('RATING_CLAIMS_RECOVERY_FAILED');
  process.exitCode = 1;
}
