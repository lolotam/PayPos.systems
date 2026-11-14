import type { SalePackageType } from '@pospay/domain';
import type { PackageSellerFacts } from '../../../../domain/package-sale-rules.ts';
import type {
  PackageSaleClock,
  PackageSaleIds,
  PackageSalePlan,
  PackageSaleRequest,
  PackageSaleScope,
  PackageSaleTransactions,
} from '../../../../ports/package-sale.port.ts';
import { ExecutePackageSale } from '../../execute-package-sale.ts';

export const CLOCK_INSTANT = '2026-12-01T00:00:00.000Z';
export const RECORDED_AT = '2026-11-05T12:00:00.000Z';

const TYPE: SalePackageType = {
  id: 'type',
  name_en: 'Synthetic package',
  name_ar: null,
  price: 25000n,
  validity_days: 90,
  revision: 1,
  selling_stopped_at: null,
  components: [
    {
      service_id: 'service',
      sessions: 10,
      position: 1,
      service: {
        id: 'service',
        name_en: 'Synthetic service',
        name_ar: null,
        price: 3000n,
        revision: 1,
      },
    },
  ],
};

const FIRST_COMPONENT = TYPE.components[0];
if (FIRST_COMPONENT === undefined) throw new Error('fixture requires a component');
export const TWO_COMPONENT_TYPE: SalePackageType = {
  ...TYPE,
  components: [
    FIRST_COMPONENT,
    {
      ...FIRST_COMPONENT,
      service_id: 'service-2',
      position: 2,
      sessions: 2,
      service: { ...FIRST_COMPONENT.service, id: 'service-2', price: 2000n },
    },
  ],
};

const SELLER: PackageSellerFacts = { id: 'seller', user_id: 'seller-user', eligible: true };

const BASE_REQUEST: PackageSaleRequest = {
  id: 'request',
  business_id: 'business',
  branch_id: 'branch',
  recorded_by: 'recorder',
  recorded_by_membership_id: 'membership',
  discount_limit_bps: 1000,
  customer_id: 'customer',
  package_type_id: 'type',
  expected_type_revision: 1,
  expected_service_revisions: [{ service_id: 'service', revision: 1 }],
  price_paid: '22.500',
  paid_method: 'CASH',
  seller_employee_id: 'seller',
  sold_at: null,
  recorded_at: RECORDED_AT,
};

export type Failure = { readonly code: string; readonly details: unknown; readonly at: string };
export type Completion = { readonly entitlementId: string; readonly at: string };

/** سجل النداءات والخطط، عشان ترتيب الأقفال وعقد الهويات يتثبتوا من الاختبار. */
export type Recorder = {
  readonly calls: string[];
  readonly failures: Failure[];
  readonly completions: Completion[];
  readonly plans: PackageSalePlan[];
  readonly generated: string[];
};

export type HarnessOptions = {
  readonly type?: SalePackageType;
  readonly request?: Partial<PackageSaleRequest>;
  readonly scopeError?: unknown;
  readonly place?: { readonly timezone: string } | null;
  readonly customerExists?: boolean;
  readonly skipWork?: boolean;
  readonly runError?: unknown;
  readonly failError?: unknown;
};

export type Harness = Recorder & { readonly useCase: ExecutePackageSale };

function createScope(
  request: PackageSaleRequest,
  options: HarnessOptions,
  recorder: Recorder,
): PackageSaleScope {
  return {
    request,
    lockType: async () => {
      recorder.calls.push('lockType');
      if (options.scopeError !== undefined) throw options.scopeError;
      return options.type ?? TYPE;
    },
    lockSeller: async () => {
      recorder.calls.push('lockSeller');
    },
    readPlace: async () => {
      recorder.calls.push('readPlace');
      return options.place === undefined ? { timezone: 'Asia/Kuwait' } : options.place;
    },
    customerExists: async () => {
      recorder.calls.push('customerExists');
      return options.customerExists ?? true;
    },
    readSeller: async () => {
      recorder.calls.push('readSeller');
      return SELLER;
    },
    insert: async (plan) => {
      recorder.calls.push('insert');
      recorder.plans.push(plan);
    },
    audit: async () => {
      recorder.calls.push('audit');
    },
    emit: async () => {
      recorder.calls.push('emit');
    },
    complete: async (entitlementId, at) => {
      recorder.calls.push('complete');
      recorder.completions.push({ entitlementId, at });
    },
  };
}

/** use case بيوصله نطاق ومسجّلات مزيفة؛ السجل بيسجّل الترتيب عشان عقود الأقفال تتثبت. */
export function createHarness(options: HarnessOptions = {}): Harness {
  const recorder: Recorder = {
    calls: [],
    failures: [],
    completions: [],
    plans: [],
    generated: [],
  };
  const type = options.type ?? TYPE;
  const request: PackageSaleRequest = Object.assign(
    {},
    BASE_REQUEST,
    {
      package_type_id: type.id,
      expected_type_revision: type.revision,
      expected_service_revisions: type.components.map((component) => ({
        service_id: component.service_id,
        revision: component.service.revision,
      })),
    },
    options.request,
  );
  const ids: PackageSaleIds = {
    newId: () => {
      const id = `generated-${recorder.generated.length + 1}`;
      recorder.generated.push(id);
      return id;
    },
  };
  const clock: PackageSaleClock = { now: () => new Date(CLOCK_INSTANT) };
  const scope = createScope(request, options, recorder);
  const transactions: PackageSaleTransactions = {
    run: async (_companyId, _requestId, work) => {
      if (options.runError !== undefined) throw options.runError;
      if (options.skipWork === true) return;
      await work(scope);
    },
    fail: async (_companyId, _requestId, code, details, at) => {
      if (options.failError !== undefined) throw options.failError;
      recorder.failures.push({ code, details, at });
    },
  };
  return { ...recorder, useCase: new ExecutePackageSale(transactions, ids, clock) };
}
