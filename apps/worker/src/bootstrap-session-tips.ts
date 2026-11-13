import { parseArgs } from 'node:util';
import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createCommissionTipsBootstrap } from './modules/commissions/index.ts';
import { readCurrentSessionTips } from './modules/orders/index.ts';
import { readEmployeeBusiness } from './modules/staff/index.ts';
import { businessCalendar, businessTimeZone } from './modules/tenancy/index.ts';

const MAX_BUSINESS_IDS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** خطأ إعدادات ثابت؛ المشغّل لا يطبع مدخلات المشغّل ولا تفاصيل الاتصال. */
class BootstrapConfigurationError extends Error {
  readonly code = 'SESSION_TIPS_BOOTSTRAP_CONFIGURATION';

  constructor() {
    super('SESSION_TIPS_BOOTSTRAP_CONFIGURATION');
    this.name = 'BootstrapConfigurationError';
  }
}

/** مدخلات المشغّل: الشركة والأنشطة ونطاق يومي العمل، وكلها مطلوبة وصريحة. */
function readScope(): {
  companyId: string;
  businessIds: string[];
  from: string;
  to: string;
} {
  const values = parseOptions();
  const companyId = values.company ?? '';
  const businessIds = parseBusinessIds(values.businesses ?? '');
  const from = values.from ?? '';
  const to = values.to ?? '';
  if (!UUID.test(companyId) || !DATE.test(from) || !DATE.test(to))
    throw new BootstrapConfigurationError();
  return { companyId, businessIds, from, to };
}

function parseOptions() {
  try {
    return parseArgs({
      options: {
        company: { type: 'string' },
        businesses: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
      },
    }).values;
  } catch {
    throw new BootstrapConfigurationError();
  }
}

/** قائمة الأنشطة بحروف صغيرة بلا تكرار وبالترتيب المُعطى؛ السقف يُحسب بعد الحسم. */
function parseBusinessIds(value: string): string[] {
  const ids = [...new Set(value.split(',').map((entry) => entry.trim().toLowerCase()))];
  if (ids.length === 0 || ids.length > MAX_BUSINESS_IDS) throw new BootstrapConfigurationError();
  for (const id of ids) if (!UUID.test(id)) throw new BootstrapConfigurationError();
  return ids;
}

// مشغّل صريح فقط؛ main.ts لا يستورده، ولا يحتاج Redis أو أي قدرة اختيارية.
try {
  const appUrl = process.env['DATABASE_URL'];
  if (!appUrl) throw new BootstrapConfigurationError();
  const scope = readScope();
  const ids = systemUuidV7();
  const app = createDatabase({ url: appUrl, ids, maxConnections: 1 });
  let failure: unknown;
  try {
    await app.ping();
    const bootstrap = createCommissionTipsBootstrap({
      ids,
      clock: { now: () => new Date() },
      businessTimeZone,
      employeeBusiness: readEmployeeBusiness,
      businessCalendar,
      database: app,
      tipsReader: { readPage: readCurrentSessionTips },
    });
    const result = await bootstrap(scope);
    console.log(JSON.stringify(result));
    if (result.status !== 'COMPLETE') process.exitCode = 1;
  } catch (error) {
    failure = error;
  }
  const closed = await Promise.allSettled([app.close()]);
  if (failure !== undefined) throw failure;
  if (closed.some((entry) => entry.status === 'rejected'))
    throw new Error('SESSION_TIPS_BOOTSTRAP_CLOSE_FAILED');
} catch (error) {
  // الخطأ الخام قد يحمل مدخلات أو اتصال؛ المشغّل يتلقى رمزًا ثابتًا فقط.
  console.error(
    error instanceof RangeError
      ? error.message
      : error instanceof BootstrapConfigurationError
        ? 'SESSION_TIPS_BOOTSTRAP_CONFIGURATION'
        : 'SESSION_TIPS_BOOTSTRAP_FAILED',
  );
  process.exitCode = 1;
}
