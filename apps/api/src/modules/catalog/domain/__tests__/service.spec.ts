import { MONEY_MAX } from '@pospay/domain';
import { expect, it } from 'vitest';

import { ServiceError } from '../errors.ts';
import {
  newService,
  parseServicePrice,
  planServiceUpdate,
  serviceColumnValues,
  serviceRecordFromRow,
  serviceSnapshot,
  serviceTerms,
  validateServiceCommissionRule,
  validateServiceDraft,
  validateServiceName,
  type ServiceRecord,
  type ServiceTerms,
} from '../service.ts';

const terms = (patch: Partial<ServiceTerms> = {}): ServiceTerms => ({
  name_en: 'Synthetic service',
  name_ar: null,
  price: 12_500n,
  commission_rule: { kind: 'FOLLOW_PLAN' },
  counts_toward_threshold: true,
  ...patch,
});

const record = (patch: Partial<ServiceRecord> = {}): ServiceRecord => ({
  ...newService(terms(), 'svc-1', 'biz-1', new Date('2026-10-05T10:00:00Z')),
  ...patch,
});

it('SV-D1 rejects an empty or over-long English name and an empty Arabic name', () => {
  expect(() => validateServiceName('', null)).toThrow(ServiceError);
  expect(() => validateServiceName('x'.repeat(256), null)).toThrow(ServiceError);
  expect(() => validateServiceName('ok', '')).toThrow(ServiceError);
  expect(() => validateServiceName('ok', 'x'.repeat(256))).toThrow(ServiceError);
  expect(() => validateServiceName('ok', null)).not.toThrow();
});

it.each([
  [{ kind: 'FOLLOW_PLAN' } as const, true],
  [{ kind: 'ZERO' } as const, true],
  [{ kind: 'PCT', value: 0n } as const, true],
  [{ kind: 'PCT', value: 10_000n } as const, true],
  [{ kind: 'PCT', value: 10_001n } as const, false],
  [{ kind: 'PCT', value: -1n } as const, false],
  [{ kind: 'FIXED', value: 0n } as const, true],
  [{ kind: 'FIXED', value: MONEY_MAX } as const, true],
  [{ kind: 'FIXED', value: MONEY_MAX + 1n } as const, false],
  [{ kind: 'FIXED', value: -1n } as const, false],
])('SV-D2 validates commission rule %o as %s', (rule, ok) => {
  const run = () => validateServiceCommissionRule(rule);
  if (ok) expect(run).not.toThrow();
  else expect(run).toThrow(ServiceError);
});

it('SV-D3 accepts a zero price and rejects a negative or overflowing one', () => {
  expect(() => validateServiceDraft(terms({ price: 0n }))).not.toThrow();
  expect(() => validateServiceDraft(terms({ price: MONEY_MAX }))).not.toThrow();
  expect(() => validateServiceDraft(terms({ price: -1n }))).toThrow(ServiceError);
  expect(() => validateServiceDraft(terms({ price: MONEY_MAX + 1n }))).toThrow(ServiceError);
});

it('SV-D4 parses exact KWD strings to mills and refuses a malformed one', () => {
  expect(parseServicePrice('12.500')).toBe(12_500n);
  expect(parseServicePrice('0.000')).toBe(0n);
  expect(() => parseServicePrice('12.5.5')).toThrow(ServiceError);
});

it('SV-D5 builds terms from the wire: trims names and converts both rule kinds', () => {
  expect(
    serviceTerms({
      name_en: '  Service  ',
      name_ar: '  خدمة  ',
      price: '1.250',
      commission_rule: { kind: 'PCT', value: 500 },
      counts_toward_threshold: true,
    }),
  ).toEqual(terms({ name_en: 'Service', name_ar: 'خدمة', price: 1250n, commission_rule: { kind: 'PCT', value: 500n } }));
  expect(
    serviceTerms({
      name_en: 'Service',
      price: '0.000',
      commission_rule: { kind: 'FIXED', value: '2.000' },
      counts_toward_threshold: false,
    }).commission_rule,
  ).toEqual({ kind: 'FIXED', value: 2000n });
});

it('SV-D6 builds a fresh record with revision 1 and one injected timestamp', () => {
  const at = new Date('2026-10-05T10:00:00Z');
  expect(newService(terms(), 'svc-1', 'biz-1', at)).toEqual({
    ...terms(),
    id: 'svc-1',
    business_id: 'biz-1',
    revision: 1,
    created_at: at.toISOString(),
    updated_at: at.toISOString(),
  });
});

it('SV-D7 refuses a stale revision and only bumps when something actually changed', () => {
  const current = record({ revision: 4 });
  expect(() => planServiceUpdate(current, terms({ price: 1n }), 3, new Date())).toThrow(
    ServiceError,
  );
  const noop = planServiceUpdate(current, terms(), 4, new Date('2026-10-06T10:00:00Z'));
  expect(noop).toEqual({ after: current, changed: false });
  const changed = planServiceUpdate(
    current,
    terms({ price: 99_000n }),
    4,
    new Date('2026-10-06T10:00:00Z'),
  );
  expect(changed.changed).toBe(true);
  expect(changed.after).toMatchObject({ price: 99_000n, revision: 5, updated_at: '2026-10-06T10:00:00.000Z' });
});

it('SV-D8 serialises price and rule to the wire without a JS number for money', () => {
  expect(serviceSnapshot(record()).price).toBe('12.500');
  expect(serviceSnapshot(record()).commission_rule).toEqual({ kind: 'FOLLOW_PLAN' });
  expect(serviceSnapshot(record({ commission_rule: { kind: 'PCT', value: 500n } })).commission_rule).toEqual({
    kind: 'PCT',
    value: 500,
  });
  expect(serviceSnapshot(record({ commission_rule: { kind: 'FIXED', value: 2000n } })).commission_rule).toEqual({
    kind: 'FIXED',
    value: '2.000',
  });
});

it('SV-D9 keeps the rule columns mutually consistent in both directions', () => {
  expect(serviceColumnValues(record({ commission_rule: { kind: 'PCT', value: 750n } }))).toEqual({
    price: '12.500',
    commission_rule_kind: 'PCT',
    commission_pct_bps: 750,
    commission_fixed_amount: null,
  });
  expect(
    serviceColumnValues(record({ commission_rule: { kind: 'FIXED', value: 2000n } })),
  ).toEqual({
    price: '12.500',
    commission_rule_kind: 'FIXED',
    commission_pct_bps: null,
    commission_fixed_amount: '2.000',
  });
});

it('SV-D10 round-trips a stored row back to a domain record', () => {
  expect(
    serviceRecordFromRow({
      id: 'svc-1',
      business_id: 'biz-1',
      name_en: 'Synthetic service',
      name_ar: null,
      price: '12.500',
      commission_rule_kind: 'PCT',
      commission_pct_bps: 500,
      commission_fixed_amount: null,
      counts_toward_threshold: true,
      revision: 2,
      created_at: '2026-10-05T10:00:00.000Z',
      updated_at: new Date('2026-10-06T10:00:00.000Z'),
    }),
  ).toMatchObject({ price: 12_500n, commission_rule: { kind: 'PCT', value: 500n }, revision: 2 });
});
