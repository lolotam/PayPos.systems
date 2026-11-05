import { expect, it } from 'vitest';

import { PackageSaleError, PackageSalePricingError } from '../../../domain/errors.ts';
import type { SalePackageType } from '../../../domain/package-sale-types.ts';
import type { SessionAccess } from '../../../domain/session-authority.ts';
import type {
  PackageSaleContext,
  PackageSaleTransaction,
  PackageSaleTransactions,
} from '../../../ports/package-sale-transactions.port.ts';
import { SellPackageUseCase } from '../sell-package.usecase.ts';

const AT = new Date('2026-10-15T08:00:00.000Z');
const clock = { now: () => AT };
let counter = 0;
const ids = { newId: () => `id-${(counter += 1)}` };
const context = {
  companyId: 'company-1',
  userId: 'user-1',
  businessId: 'business-1',
  branchId: 'branch-1',
  key: 'key-1',
  fingerprint: 'a'.repeat(64),
};
const input = {
  customer_id: 'customer-1',
  package_type_id: 'type-1',
  expected_type_revision: 1,
  expected_service_revisions: [{ service_id: 'service-1', revision: 1 }],
  price_paid: '30.000',
  paid_method: 'CASH' as const,
  seller_employee_id: 'employee-1',
};
const type: SalePackageType = {
  id: 'type-1',
  name_en: 'Synthetic package',
  name_ar: null,
  price: 30000n,
  validity_days: 90,
  revision: 1,
  components: [
    {
      service_id: 'service-1',
      sessions: 4,
      position: 1,
      service: {
        id: 'service-1',
        name_en: 'Synthetic service',
        name_ar: null,
        price: 25000n,
        rule: { kind: 'ZERO' },
        counts: true,
        revision: 1,
      },
    },
  ],
};
const access: SessionAccess = {
  record: true,
  denied: false,
  feature: true,
  membership_ids: ['membership-1'],
};
const seller = {
  id: 'employee-1',
  name_en: 'Synthetic employee',
  name_ar: null,
  user_id: null,
  eligible: true,
  clocked_in: false,
  approved_leave: false,
};

interface Fake {
  readonly calls: string[];
  readonly transactions: PackageSaleTransactions;
}

/** معاملة وهمية بأسطر قراءة مرتبة، عشان الترتيب نفسه يكون assertion. */
function fake(overrides: {
  place?: { readonly timezone: string } | null;
  catalog?: PackageSaleTransaction['catalog'];
  performers?: PackageSaleTransaction['performers'];
  discount?: PackageSaleTransaction['discount'];
  customer?: PackageSaleTransaction['customer'];
  access?: SessionAccess;
  replayed?: boolean;
} = {}): Fake {
  const calls: string[] = [];
  const transaction: PackageSaleTransaction = {
    place: {
      read: async () => {
        calls.push('place');
        return overrides.place === undefined ? { timezone: 'Asia/Kuwait' } : overrides.place;
      },
    },
    access: {
      lock: async () => { calls.push('lock'); },
      read: async () => { calls.push('access'); return overrides.access ?? access; },
    },
    catalog: overrides.catalog ?? {
      lock: async () => undefined,
      read: async () => [],
      readPackageTypeForSale: async () => {
        calls.push('catalog');
        return type;
      },
    },
    customer: overrides.customer ?? { read: async () => { calls.push('customer'); return { id: 'customer-1', name: 'Synthetic customer', phone_masked: '***123' }; } },
    performers: overrides.performers ?? {
      lock: async () => { calls.push('performers.lock'); },
      read: async () => { calls.push('performers.read'); return [seller]; },
    },
    discount: overrides.discount ?? { read: async () => { calls.push('discount'); return { source: 'PERSON' as const, bps: 1000 }; } },
    idempotent: async <T>(_operation: 'sell-package', work: () => Promise<T>) => {
      calls.push('idempotent');
      if (overrides.replayed === true) return { body: { entitlement: { id: 'stored' } } as T, replayed: true };
      return { body: await work(), replayed: false };
    },
    insert: async () => { calls.push('insert'); },
    audit: async () => { calls.push('audit'); },
    emit: async () => { calls.push('emit'); },
  };
  return {
    calls,
    transactions: {
      run: async <T>(_context: PackageSaleContext, work: (tx: PackageSaleTransaction) => Promise<T>) => work(transaction),
    },
  };
}

it('reads the place and the authority before the claim, and writes the sale after it', async () => {
  const f = fake();
  const response = await new SellPackageUseCase(f.transactions, ids, clock).execute(context, input);
  expect(f.calls).toEqual([
    'place',
    'access',
    'idempotent',
    'lock',
    'catalog',
    'performers.lock',
    'access',
    'place',
    'customer',
    'performers.read',
    'discount',
    'insert',
    'audit',
    'emit',
  ]);
  expect(response.entitlement).toMatchObject({
    id: 'id-1',
    business_id: 'business-1',
    customer_id: 'customer-1',
    package_type_id: 'type-1',
    sold_branch_id: 'branch-1',
    list_price: '30.000',
    price_paid: '30.000',
    discount: '0.000',
    discount_bps: 0,
    seller_employee_id: 'employee-1',
    sold_at: '2026-10-15T08:00:00.000Z',
    sold_business_date: '2026-10-15',
    refunded_amount: '0.000',
    revision: 1,
  });
});

it('re-checks the authority on the replay and writes nothing', async () => {
  const f = fake({ replayed: true });
  const response = await new SellPackageUseCase(f.transactions, ids, clock).execute(context, input);
  expect(f.calls).toEqual(['place', 'access', 'idempotent', 'access']);
  expect(response).toEqual({ entitlement: { id: 'stored' } });
});

it('refuses a recorder without the sale permission before the claim', async () => {
  const f = fake({ access: { ...access, record: false } });
  await expect(new SellPackageUseCase(f.transactions, ids, clock).execute(context, input)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect(f.calls).toEqual(['place', 'access']);
});

it('refuses a branch that is not an active sale place and writes nothing', async () => {
  const f = fake({ place: null });
  await expect(new SellPackageUseCase(f.transactions, ids, clock).execute(context, input)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect(f.calls).toEqual(['place']);
});

it('refuses a missing package type and writes nothing', async () => {
  const f = fake({
    catalog: {
      lock: async () => undefined,
      read: async () => [],
      readPackageTypeForSale: async () => null,
    },
  });
  await expect(new SellPackageUseCase(f.transactions, ids, clock).execute(context, input)).rejects.toBeInstanceOf(
    PackageSaleError,
  );
  expect(f.calls).not.toContain('insert');
  expect(f.calls).not.toContain('audit');
  expect(f.calls).not.toContain('emit');
});

it('refuses a seller who is not eligible and writes nothing', async () => {
  const f = fake({
    performers: {
      lock: async () => undefined,
      read: async () => [{ ...seller, eligible: false }],
    },
  });
  await expect(new SellPackageUseCase(f.transactions, ids, clock).execute(context, input)).rejects.toMatchObject({
    code: 'PACKAGE_SELLER_NOT_ELIGIBLE',
  });
  expect(f.calls).not.toContain('insert');
  expect(f.calls).not.toContain('emit');
});

it('refuses a discount above the recorder limit and writes nothing', async () => {
  const f = fake({ discount: { read: async () => ({ source: 'PERSON' as const, bps: 100 }) } });
  const refused = new SellPackageUseCase(f.transactions, ids, clock).execute(context, {
    ...input,
    price_paid: '26.000',
  });
  await expect(refused).rejects.toBeInstanceOf(PackageSalePricingError);
  expect(f.calls).not.toContain('insert');
  expect(f.calls).not.toContain('emit');
});

it('refuses a stale quote and writes nothing', async () => {
  const f = fake();
  await expect(
    new SellPackageUseCase(f.transactions, ids, clock).execute(context, {
      ...input,
      expected_service_revisions: [{ service_id: 'service-1', revision: 9 }],
    }),
  ).rejects.toMatchObject({ code: 'PACKAGE_SALE_QUOTE_STALE' });
  expect(f.calls).not.toContain('insert');
  expect(f.calls).not.toContain('emit');
});

it('refuses a missing customer and writes nothing', async () => {
  const f = fake({ customer: { read: async () => null } });
  await expect(new SellPackageUseCase(f.transactions, ids, clock).execute(context, input)).rejects.toMatchObject({
    code: 'PACKAGE_CUSTOMER_NOT_FOUND',
  });
  expect(f.calls).not.toContain('insert');
  expect(f.calls).not.toContain('emit');
});
