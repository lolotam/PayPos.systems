import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';

import { createRatingBootstrap, type BootstrapParams } from './modules/customers/index.ts';
import { daySessionsReader } from './modules/orders/index.ts';

// رموز أخطاء المشغّل: بتتطبع زي ما هي، وأي فشل تاني باسمه بس — رسالة السائق ممكن تحمل رابط الاتصال.
const CODES = new Set(['DATABASE_URL_REQUIRED', 'BOOTSTRAP_ARGUMENT_INVALID']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const FLAGS = new Set(
  '--company --cutoff --checkpoint --max-session-id --recorded-before --page-size'.split(' '),
);

function invalid(): Error {
  return new Error('BOOTSTRAP_ARGUMENT_INVALID');
}

function uuidOf(value: string | undefined): string | undefined {
  if (value !== undefined && !UUID.test(value)) throw invalid();
  return value;
}

function instantOf(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const instant = new Date(value);
  if (!INSTANT.test(value) || Number.isNaN(instant.getTime())) throw invalid();
  return instant;
}

function readArguments(argv: readonly string[]): BootstrapParams {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined || !FLAGS.has(flag) || values.has(flag))
      throw invalid();
    values.set(flag, value);
  }
  const companyId = uuidOf(values.get('--company'));
  const cutoff = instantOf(values.get('--cutoff'));
  if (companyId === undefined || cutoff === undefined) throw invalid();
  const checkpoint = uuidOf(values.get('--checkpoint'));
  const maxSessionId = uuidOf(values.get('--max-session-id'));
  const recordedBefore = instantOf(values.get('--recorded-before'));
  const pageSize = values.get('--page-size');
  if (pageSize !== undefined && !/^\d{1,3}$/.test(pageSize)) throw invalid();
  const size = pageSize === undefined ? undefined : Number(pageSize);
  if (size !== undefined && (size < 1 || size > 200)) throw invalid();
  return {
    companyId,
    cutoff,
    ...(checkpoint === undefined ? {} : { checkpoint }),
    ...(maxSessionId === undefined ? {} : { maxSessionId }),
    ...(recordedBefore === undefined ? {} : { recordedAtOrBefore: recordedBefore }),
    ...(size === undefined ? {} : { pageSize: size }),
  };
}

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
