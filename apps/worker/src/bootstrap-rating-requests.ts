import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';

import { createRatingBootstrap } from './modules/customers/index.ts';
import { readArguments } from './modules/customers/jobs/bootstrap-arguments.ts';
import { daySessionsReader } from './modules/orders/index.ts';

// رموز أخطاء المشغّل: بتتطبع زي ما هي، وأي فشل تاني باسمه بس — رسالة السائق ممكن تحمل رابط الاتصال.
const CODES = new Set(['DATABASE_URL_REQUIRED', 'BOOTSTRAP_ARGUMENT_INVALID']);

try {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_REQUIRED');
  const params = readArguments(process.argv.slice(2));
  const ids = systemUuidV7();
  const db = createDatabase({ url, ids });
  const bootstrap = createRatingBootstrap({
    ids,
    clock: { now: () => new Date() },
    daySessions: daySessionsReader,
    db,
    log: (line) => process.stdout.write(`${line}\n`),
  });
  const result = await bootstrap(params).finally(() => db.close());
  if (!result.complete) process.exitCode = 1;
} catch (error) {
  const message =
    error instanceof Error && CODES.has(error.message) ? error.message : 'BOOTSTRAP_FAILED';
  console.error('bootstrap rating requests failed:', message);
  process.exitCode = 1;
}
