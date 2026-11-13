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
import { readCurrentSessionTips, readServiceLineCoveragePage } from './modules/orders/index.ts';
import { readSalaryCoveragePage } from './modules/staff/index.ts';
import { companyOpen } from './modules/tenancy/index.ts';

const MAX_BUSINESS_IDS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const CONFIGURATION_CODE = 'COMMISSION_COVERAGE_CONFIGURATION';

/** مدخلات المشغّل؛ نطاق البقشيش إما كامل أو غائب، والجزء رُفض. */
interface ScopeOptions {
  readonly company?: string;
  readonly through?: string;
  readonly businesses?: string;
  readonly from?: string;
  readonly to?: string;
}

function readScope(): CommissionCoverageScope {
  try {
    const { values } = parseArgs({
      options: {
        company: { type: 'string' },
        through: { type: 'string' },
        businesses: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
      },
    });
    const companyId = values.company ?? '';
    const throughId = values.through ?? null;
    assertCommissionReplayCursor(null, throughId);
    if (!UUID.test(companyId)) throw new Error(CONFIGURATION_CODE);
    const tips = readTipScope(values);
    return { companyId, throughId, ...(tips === undefined ? {} : { tips }) };
  } catch (error) {
    if (error instanceof ReplayCursorError) throw error;
    throw new Error(CONFIGURATION_CODE, { cause: error });
  }
}

/**
 * نطاق فحص البقشيش: الأنشطة والتاريخان معاً أو لا شيء؛ الأنواع ناقصة أو الأعداد خارج السقف
 * ترفض التشغيل بدل أن تفحص نطاقاً ناقصاً وتُقرأ نتيجته كنجاح.
 */
function readTipScope(values: ScopeOptions): CommissionCoverageScope['tips'] {
  const { businesses, from, to } = values;
  if (businesses === undefined && from === undefined && to === undefined) return undefined;
  if (businesses === undefined || from === undefined || to === undefined)
    throw new Error(CONFIGURATION_CODE);
  if (!DATE.test(from) || !DATE.test(to) || from > to) throw new Error(CONFIGURATION_CODE);
  const ids = [...new Set(businesses.split(',').map((entry) => entry.trim().toLowerCase()))];
  if (ids.length === 0 || ids.length > MAX_BUSINESS_IDS) throw new Error(CONFIGURATION_CODE);
  for (const id of ids) if (!UUID.test(id)) throw new Error(CONFIGURATION_CODE);
  return { businessIds: ids, from, to };
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
      tipsReader: { readPage: readCurrentSessionTips },
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
