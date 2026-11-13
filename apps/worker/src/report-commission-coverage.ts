import { parseArgs } from 'node:util';

import { createDatabase, createOutboxDispatcherDatabase, ReplayCursorError } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';

import {
  assertCommissionReplayCursor,
  CommissionCoverageEventInvalidError,
  CommissionCoverageScopeInvalidError,
  CommissionReplayCursorError,
  createCommissionCoverageReport,
  type CommissionCoverageScope,
} from './modules/commissions/index.ts';
import { readServiceLineCoveragePage } from './modules/orders/index.ts';
import { readSalaryCoveragePage } from './modules/staff/index.ts';
import { companyOpen } from './modules/tenancy/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONFIGURATION_CODE = 'COMMISSION_COVERAGE_CONFIGURATION';

function readScope(): CommissionCoverageScope {
  try {
    const { values } = parseArgs({
      options: {
        company: { type: 'string' },
        through: { type: 'string' },
      },
    });
    const companyId = values.company ?? '';
    const throughId = values.through ?? null;
    assertCommissionReplayCursor(null, throughId);
    if (!UUID.test(companyId)) throw new Error(CONFIGURATION_CODE);
    return { companyId, throughId };
  } catch (error) {
    if (error instanceof ReplayCursorError) throw error;
    throw new Error(CONFIGURATION_CODE, { cause: error });
  }
}

/** رمز الخطأ الثابت للمشغّل؛ لا يخرج من نطاقه أي نص خام. */
function errorCode(error: unknown): string {
  if (error instanceof Error && error.message === CONFIGURATION_CODE) return CONFIGURATION_CODE;
  if (
    error instanceof ReplayCursorError ||
    error instanceof CommissionReplayCursorError ||
    error instanceof CommissionCoverageEventInvalidError ||
    error instanceof CommissionCoverageScopeInvalidError
  ) {
    return (error as { readonly code: string }).code;
  }
  return 'COMMISSION_COVERAGE_FAILED';
}

// مشغّل صريح فقط؛ main.ts لا يستورده، ولا يحتاج Redis أو أي قدرة اختيارية.
try {
  const appUrl = process.env['DATABASE_URL'];
  const dispatcherUrl = process.env['DISPATCHER_DATABASE_URL'];
  if (!appUrl || !dispatcherUrl) throw new Error(CONFIGURATION_CODE);
  const scope = readScope();
  const app = createDatabase({ url: appUrl, ids: systemUuidV7(), maxConnections: 1 });
  const reader = createOutboxDispatcherDatabase({ url: dispatcherUrl, maxConnections: 1 });
  let failure: unknown;
  try {
    await app.ping();
    await reader.ping();
    const report = await createCommissionCoverageReport({
      database: app,
      lines: { readPage: readServiceLineCoveragePage },
      salaries: { readPage: readSalaryCoveragePage },
      retained: reader,
      companies: { isOpen: companyOpen },
    })(scope);
    console.log(JSON.stringify(report));
    if (report.status !== 'COVERED') process.exitCode = 1;
  } catch (error) {
    failure = error;
  }
  const closed = await Promise.allSettled([reader.close(), app.close()]);
  if (failure !== undefined) throw failure;
  if (closed.some((entry) => entry.status === 'rejected'))
    throw new Error('COMMISSION_COVERAGE_CLOSE_FAILED');
} catch (error) {
  // الخطأ الخام قد يحمل SQL أو رابط اتصال؛ المشغّل يتلقى رمزًا ثابتًا فقط.
  console.error(errorCode(error));
  process.exitCode = 1;
}
