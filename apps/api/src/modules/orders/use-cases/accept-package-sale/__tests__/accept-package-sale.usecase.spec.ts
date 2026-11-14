import type { AcceptedPackageSale, SellPackageInput } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { expect, it } from 'vitest';
import type { PendingPackageSaleRequest } from '../../../domain/package-sale-request.ts';
import type { SessionAccess } from '../../../domain/session-authority.ts';
import type { SessionLimit } from '../../../domain/session-types.ts';
import type {
  PackageSaleRequestTransaction,
  PackageSaleRequestTransactions,
} from '../../../ports/package-sale-request.port.ts';
import type { SessionWriteContext } from '../../../ports/service-session-transactions.port.ts';
import { AcceptPackageSaleUseCase } from '../accept-package-sale.usecase.ts';

const ids = systemUuidV7();
const AT = new Date('2026-10-15T08:00:00.000Z');
const clock = { now: () => AT };

class FakePackageSaleRequestTransactions implements PackageSaleRequestTransactions {
  readonly inserted: PendingPackageSaleRequest[] = [];
  readonly published: string[] = [];
  readonly accessReads: Date[] = [];
  accessLocks = 0;

  access: SessionAccess;
  limit: SessionLimit;
  placeTimezone: string | null = 'Asia/Kuwait';
  replayed = false;
  storedBody: AcceptedPackageSale | null = null;

  constructor(membershipId: string, limitBps: number | null = 1000) {
    this.access = {
      record: true,
      denied: false,
      feature: true,
      membership_ids: [membershipId],
    };
    this.limit =
      limitBps === null ? { source: 'OWNER', bps: null } : { source: 'PERSON', bps: limitBps };
  }

  async run<T>(
    _context: SessionWriteContext,
    work: (tx: PackageSaleRequestTransaction) => Promise<T>,
  ): Promise<T> {
    const tx: PackageSaleRequestTransaction = {
      access: {
        lock: async () => {
          this.accessLocks += 1;
        },
        read: async (at: Date) => {
          this.accessReads.push(at);
          return this.access;
        },
      },
      discountLimit: {
        read: async () => this.limit,
      },
      place: {
        timezone: async () => this.placeTimezone,
      },
      idempotent: async <R>(handler: () => Promise<R>): Promise<{ body: R; replayed: boolean }> => {
        if (this.replayed) {
          return {
            body: (this.storedBody ?? { sale_request_id: ids.newId() }) as unknown as R,
            replayed: true,
          };
        }
        const body = await handler();
        return { body, replayed: false };
      },
      insertPending: async (request: PendingPackageSaleRequest) => {
        this.inserted.push(request);
      },
      publishRequested: async (requestId: string) => {
        this.published.push(requestId);
      },
    };
    return work(tx);
  }
}

function createSaleInput(overrides: Partial<SellPackageInput> = {}): SellPackageInput {
  return {
    customer_id: ids.newId(),
    package_type_id: ids.newId(),
    expected_type_revision: 1,
    expected_service_revisions: [{ service_id: ids.newId(), revision: 1 }],
    price_paid: '50.000',
    paid_method: 'CARD',
    seller_employee_id: ids.newId(),
    sold_at: '2026-10-14T10:00:00.000Z',
    ...overrides,
  };
}

function createContext(input = createSaleInput()) {
  const generatedId = ids.newId();
  return {
    generatedId,
    idGenerator: { newId: () => generatedId },
    context: {
      companyId: ids.newId(),
      userId: ids.newId(),
      businessId: ids.newId(),
      branchId: ids.newId(),
      key: ids.newId(),
      fingerprint: 'a'.repeat(64),
      input,
    },
  };
}

it('accepts package sale, inserts pending row with recorder, limit and instant, and publishes requested event', async () => {
  const membershipId = ids.newId();
  const fake = new FakePackageSaleRequestTransactions(membershipId, 1200);
  const { generatedId, idGenerator, context } = createContext();
  const useCase = new AcceptPackageSaleUseCase(fake, idGenerator, clock);

  const result = await useCase.execute(context);
  expect(result).toEqual({ sale_request_id: generatedId });
  expect(fake.inserted).toHaveLength(1);
  expect(fake.inserted[0]).toEqual({
    company_id: context.companyId,
    id: generatedId,
    business_id: context.businessId,
    branch_id: context.branchId,
    recorded_by: context.userId,
    recorded_by_membership_id: membershipId,
    discount_limit_bps: 1200,
    customer_id: context.input.customer_id,
    package_type_id: context.input.package_type_id,
    expected_type_revision: context.input.expected_type_revision,
    expected_service_revisions: context.input.expected_service_revisions,
    price_paid: context.input.price_paid,
    paid_method: context.input.paid_method,
    seller_employee_id: context.input.seller_employee_id,
    sold_at: new Date(String(context.input.sold_at)),
    recorded_at: AT,
    status: 'pending',
  });
  expect(fake.published).toEqual([generatedId]);
});

it('replays stored body, inserts nothing again, and re-reads access', async () => {
  const membershipId = ids.newId();
  const fake = new FakePackageSaleRequestTransactions(membershipId);
  const storedId = ids.newId();
  fake.replayed = true;
  fake.storedBody = { sale_request_id: storedId };
  const { idGenerator, context } = createContext();
  const useCase = new AcceptPackageSaleUseCase(fake, idGenerator, clock);

  const result = await useCase.execute(context);
  expect(result).toEqual({ sale_request_id: storedId });
  expect(fake.inserted).toHaveLength(0);
  expect(fake.published).toHaveLength(0);
  expect(fake.accessReads).toEqual([AT]);
  expect(fake.accessLocks).toBe(1);
});

it('replays the stored body even when the caller now has two eligible memberships and the body names none', async () => {
  const fake = new FakePackageSaleRequestTransactions(m1);
  fake.access.membership_ids = [m1, m2];
  fake.replayed = true;
  fake.storedBody = { sale_request_id: ids.newId() };
  const { idGenerator, context } = createContext();
  const useCase = new AcceptPackageSaleUseCase(fake, idGenerator, clock);

  const result = await useCase.execute(context);
  expect(result).toEqual(fake.storedBody);
  expect(fake.inserted).toHaveLength(0);
  expect(fake.published).toHaveLength(0);
});

it.each([
  ['denied access', { denied: true }, 'FORBIDDEN'],
  ['feature off', { feature: false }, 'FEATURE_DISABLED'],
])('replay still re-checks access: %s', async (_scenario, patch, expectedCode) => {
  const fake = new FakePackageSaleRequestTransactions(m1);
  fake.access = { ...fake.access, ...patch };
  fake.replayed = true;
  fake.storedBody = { sale_request_id: ids.newId() };
  const { idGenerator, context } = createContext();
  const useCase = new AcceptPackageSaleUseCase(fake, idGenerator, clock);

  await expect(useCase.execute(context)).rejects.toMatchObject({ code: expectedCode });
  expect(fake.inserted).toHaveLength(0);
  expect(fake.published).toHaveLength(0);
});

const m1 = ids.newId();
const m2 = ids.newId();
const otherM = ids.newId();

it.each([
  [
    'denied access',
    { record: true, denied: true, feature: true, membership_ids: [m1] },
    undefined,
    'FORBIDDEN',
  ],
  [
    'feature off',
    { record: true, denied: false, feature: false, membership_ids: [m1] },
    undefined,
    'FEATURE_DISABLED',
  ],
  [
    'no eligible membership',
    { record: false, denied: false, feature: true, membership_ids: [] },
    undefined,
    'FORBIDDEN',
  ],
  [
    'two eligible memberships without recorder_membership_id',
    { record: true, denied: false, feature: true, membership_ids: [m1, m2] },
    undefined,
    'SESSION_RECORDER_MEMBERSHIP_REQUIRED',
  ],
  [
    'an explicit recorder_membership_id not among eligible',
    { record: true, denied: false, feature: true, membership_ids: [m1] },
    otherM,
    'FORBIDDEN',
  ],
])(
  'refuses %s and writes nothing',
  async (_scenario, accessConfig, explicitSelection, expectedCode) => {
    const fake = new FakePackageSaleRequestTransactions(m1);
    fake.access = accessConfig;
    const input = createSaleInput(
      explicitSelection === undefined ? {} : { recorder_membership_id: explicitSelection },
    );
    const { idGenerator, context } = createContext(input);
    const useCase = new AcceptPackageSaleUseCase(fake, idGenerator, clock);

    await expect(useCase.execute(context)).rejects.toMatchObject({
      code: expectedCode,
    });
    expect(fake.inserted).toHaveLength(0);
    expect(fake.published).toHaveLength(0);
  },
);

it('refuses with FORBIDDEN and writes nothing when place is null', async () => {
  const membershipId = ids.newId();
  const fake = new FakePackageSaleRequestTransactions(membershipId);
  fake.placeTimezone = null;
  const { idGenerator, context } = createContext();
  const useCase = new AcceptPackageSaleUseCase(fake, idGenerator, clock);

  await expect(useCase.execute(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(fake.inserted).toHaveLength(0);
  expect(fake.published).toHaveLength(0);
});
