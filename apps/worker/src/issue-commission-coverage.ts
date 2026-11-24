import { parseArgs } from 'node:util';

import {
  createCoverageIssuer,
  createDatabase,
  createOutboxDispatcherDatabase,
  coverageIssuanceFailure,
} from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';

import {
  createCommissionCoverageReport,
  coverageReportIdentity,
  issueCommissionCoverage,
  isCommissionCoverageCalendarDate,
} from './modules/commissions/index.ts';
import {
  listCurrentPackageSales,
  readCurrentSessionTips,
  readServiceLineCoveragePage,
  createSessionTipsAfterBoundReader,
} from './modules/orders/index.ts';
import { readSalaryCoveragePage } from './modules/staff/index.ts';
import { businessTimeZone, companyOpen, coverageBusinessIds } from './modules/tenancy/index.ts';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function readInput() {
  const { values } = parseArgs({
    options: {
      company: { type: 'string' },
      businesses: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      'run-id': { type: 'string' },
      release: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const companyId = (values.company ?? '').toLowerCase();
  const businessIds = (values.businesses ?? '').split(',').map((id) => id.trim().toLowerCase());
  const from = values.from ?? '',
    to = values.to ?? '';
  const runId = values['run-id'] ?? '',
    release = values.release ?? '';
  if (
    !UUID.test(companyId) ||
    businessIds.some((id) => !UUID.test(id)) ||
    businessIds.length > 200 ||
    new Set(businessIds).size !== businessIds.length ||
    !isCommissionCoverageCalendarDate(from) ||
    !isCommissionCoverageCalendarDate(to) ||
    from > to ||
    !runId.trim() ||
    runId.length > 100 ||
    !release.trim() ||
    release.length > 100
  )
    throw new Error('COVERAGE_OPERATOR_INPUT_INVALID');
  return {
    scope: { companyId, throughId: null, tips: { businessIds, from, to } },
    runId,
    release,
    dryRun: values['dry-run'],
  };
}

// جذر تركيب operator فقط: لا Redis، ولا عامل خلفي، ولا ربط الإصدار بمسار HTTP.
try {
  const input = readInput();
  const appUrl = process.env['DATABASE_URL'],
    dispatcherUrl = process.env['DISPATCHER_DATABASE_URL'];
  if (!appUrl || !dispatcherUrl) throw new Error('COVERAGE_CONFIGURATION_INVALID');
  const ids = systemUuidV7();
  const app = createDatabase({ url: appUrl, ids, maxConnections: 1 });
  const retained = createOutboxDispatcherDatabase({ url: dispatcherUrl, maxConnections: 1 });
  const issuer = createCoverageIssuer(dispatcherUrl);
  try {
    // فحص دور الاتصال قبل أي قراءة: DATABASE_URL لازم يكون pospay_app وDISPATCHER_DATABASE_URL
    // لازم يكون pospay_dispatcher؛ وصلة غلط تفشل هنا فوراً قبل تقرير أو كتابة.
    await Promise.all([app.ping(), retained.ping()]);
    const report = createCommissionCoverageReport({
      database: app,
      retained,
      lines: { readPage: readServiceLineCoveragePage },
      salaries: { readPage: readSalaryCoveragePage },
      sales: { readPage: listCurrentPackageSales },
      companies: { isOpen: companyOpen },
      businesses: {
        isInCompany: async (tx, companyId, businessId) =>
          (await businessTimeZone(tx, companyId, businessId)) !== null,
      },
      tipsReader: { readPage: readCurrentSessionTips },
    });
    const result = await issueCommissionCoverage(
      {
        issuer,
        withTenant: app.withTenant,
        report,
        identity: coverageReportIdentity(app),
        businessIds: coverageBusinessIds,
        tips: {
          existsAfter: createSessionTipsAfterBoundReader({
            isKnown: async (tx, companyId, businessId) =>
              (await businessTimeZone(tx, companyId, businessId)) !== null,
          }),
        },
      },
      { ...input, stateId: ids.newId(), proofId: ids.newId() },
    );
    console.log(JSON.stringify(result));
  } finally {
    await Promise.all([issuer.close(), retained.close(), app.close()]);
  }
} catch (error) {
  console.error(coverageIssuanceFailure(error).code);
  process.exitCode = 1;
}
