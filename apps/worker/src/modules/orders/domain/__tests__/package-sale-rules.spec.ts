import { SessionTimeError, type SalePackageType } from '@pospay/domain';
import { describe, expect, it } from 'vitest';
import { PackageSaleError } from '../package-sale-errors.ts';
import {
  assertPackageSaleQuote,
  checkPackageSeller,
  packageSaleTime,
  type PackageSellerFacts,
} from '../package-sale-rules.ts';

const seller: PackageSellerFacts = {
  id: 'seller',
  user_id: 'other-user',
  eligible: true,
};
const type: SalePackageType = {
  id: 'type',
  name_en: 'Package',
  name_ar: null,
  price: 25000n,
  validity_days: 90,
  revision: 2,
  selling_stopped_at: null,
  components: ['b', 'a'].map((id, index) => ({
    service_id: id,
    sessions: 10,
    position: index + 1,
    service: {
      id,
      name_en: id,
      name_ar: null,
      price: 3000n,
      revision: 4,
    },
  })),
};

describe('package seller: eligibility before self, including owner (FR-014)', () => {
  it.each([
    undefined,
    { ...seller, eligible: false },
    { ...seller, eligible: false, user_id: 'recorder' },
  ])('refuses missing or ineligible seller before considering her account: %o', (employee) => {
    expect(() => checkPackageSeller(employee, 'recorder')).toThrow(
      new PackageSaleError('PACKAGE_SELLER_NOT_ELIGIBLE'),
    );
  });
  it('refuses the recorder account regardless of the chosen membership or owner status', () => {
    expect(() => checkPackageSeller({ ...seller, user_id: 'recorder' }, 'recorder')).toThrow(
      new PackageSaleError('PACKAGE_SELLER_SELF_FORBIDDEN'),
    );
  });
  it.each(['other-user', null])(
    'keeps link %s; attendance/leave are warnings, not eligibility',
    (user_id) => {
      expect(checkPackageSeller({ ...seller, user_id }, 'recorder')).toBe(user_id);
    },
  );
});

describe('quote confirmation after catalog locks (FR-018b/c)', () => {
  const quote = [
    { service_id: 'a', revision: 4 },
    { service_id: 'b', revision: 4 },
  ] as const;
  it('accepts an exact set independently of picker order without changing input', () => {
    expect(() => assertPackageSaleQuote(type, 2, Object.freeze(quote))).not.toThrow();
    expect(quote.map((entry) => entry.service_id)).toEqual(['a', 'b']);
  });
  it('reports type revision before service-set differences', () => {
    expect(() => assertPackageSaleQuote(type, 1, [])).toThrow(
      new PackageSaleError('PACKAGE_TYPE_REVISION_CONFLICT', { current_revision: 2 }),
    );
    try {
      assertPackageSaleQuote(type, 1, []);
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PACKAGE_TYPE_REVISION_CONFLICT',
        details: { current_revision: 2 },
      });
    }
  });
  it.each(
    [
      [],
      quote.slice(0, 1),
      [...quote, { service_id: 'c', revision: 4 }],
      [quote[0], quote[0]],
      [quote[0], { service_id: 'c', revision: 4 }],
      [quote[0], { service_id: 'b', revision: 5 }],
    ].map((expected) => ({ expected })),
  )(
    'rejects changed service set or revision, even with unchanged prices: $expected',
    ({ expected }) => {
      expect(() => assertPackageSaleQuote(type, 2, expected)).toThrow(PackageSaleError);
      try {
        assertPackageSaleQuote(type, 2, expected);
      } catch (error) {
        expect(error).toMatchObject({
          code: 'PACKAGE_SALE_QUOTE_STALE',
          details: {
            current_service_revisions: [
              { service_id: 'b', revision: 4 },
              { service_id: 'a', revision: 4 },
            ],
          },
        });
      }
    },
  );
});

describe('stopped package type quote refusal (FR-018b)', () => {
  const stoppedType = { ...type, selling_stopped_at: '2026-11-14T08:00:00.000Z' };
  const quote = [
    { service_id: 'a', revision: 4 },
    { service_id: 'b', revision: 4 },
  ] as const;

  it.each([
    ['matching revision', 2, quote],
    ['stale revision', 1, quote],
    ['stale service revisions', 2, [{ service_id: 'a', revision: 999 }]],
  ])(
    'refuses a stopped type on %s before evaluating revisions with PACKAGE_TYPE_NOT_SELLABLE',
    (_label, expectedRevision, expectedServices) => {
      let thrown: unknown;
      try {
        assertPackageSaleQuote(stoppedType, expectedRevision, expectedServices);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(PackageSaleError);
      expect(thrown).toMatchObject({
        code: 'PACKAGE_TYPE_NOT_SELLABLE',
        details: undefined,
      });
    },
  );

  it('accepts an active type with a matching quote', () => {
    const activeType = { ...type, selling_stopped_at: null };
    expect(() => assertPackageSaleQuote(activeType, 2, quote)).not.toThrow();
  });
});

describe('package sale calendar/window (FR-016, TD-4)', () => {
  const recordedAt = new Date('2026-11-04T09:00:00Z');
  it.each([undefined, new Date('2026-11-04T09:00:00Z'), new Date('2026-11-04T09:02:00Z')])(
    'defaults or normalizes a tolerated future date: %s',
    (soldAt) => {
      expect(packageSaleTime(soldAt, recordedAt, 'Asia/Kuwait')).toEqual({
        occurred_at: recordedAt,
        business_date: '2026-11-04',
        late: false,
      });
    },
  );
  it.each([
    ['2026-11-04T09:02:00.001Z', 'PACKAGE_SALE_IN_FUTURE'],
    ['2026-09-30T20:59:59.999Z', 'PACKAGE_SALE_TOO_OLD'],
  ])('rejects %s with package code %s', (soldAt, code) => {
    expect(() => packageSaleTime(new Date(soldAt), recordedAt, 'Asia/Kuwait')).toThrow(
      expect.objectContaining({ code }),
    );
  });
  it.each([
    ['2026-10-01T00:00:00+03:00', '2026-11-04T09:00:00Z', 'Asia/Kuwait', '2026-10-01', true],
    ['2026-12-01T00:00:00Z', '2027-01-01T00:00:00Z', 'UTC', '2026-12-01', true],
    ['2024-02-29T21:30:00Z', '2024-02-29T21:30:00Z', 'Asia/Kuwait', '2024-03-01', false],
    ['2024-02-29T21:30:00Z', '2024-02-29T21:30:00Z', 'UTC', '2024-02-29', false],
  ] as const)('uses supplied branch zone %s / %s / %s', (soldAt, at, zone, day, late) => {
    expect(packageSaleTime(new Date(soldAt), new Date(at), zone)).toMatchObject({
      business_date: day,
      late,
    });
  });
  it.each([
    [new Date('invalid'), recordedAt, 'UTC'],
    [recordedAt, new Date('invalid'), 'UTC'],
    [recordedAt, recordedAt, 'invalid-zone'],
  ] as const)(
    'preserves unexpected time rejection without disguising it as sale age',
    (soldAt, at, zone) => {
      expect(() => packageSaleTime(soldAt, at, zone)).toThrow(
        new SessionTimeError('SESSION_TIME_INVALID'),
      );
    },
  );
});
