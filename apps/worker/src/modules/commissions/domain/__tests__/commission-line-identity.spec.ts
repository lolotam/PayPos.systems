import { expect, it } from 'vitest';

import type { CommissionLineSnapshot } from '../commission-line-types.ts';
import { selectNewerCommissionLines, validateCommissionLineEvent } from '../commission-lines.ts';
import { CommissionLineEventInvalidError } from '../errors.ts';

const original: CommissionLineSnapshot = {
  lineId: 'line-a',
  sessionId: 'session-a',
  businessId: 'business-a',
  branchId: 'branch-a',
  serviceId: 'service-a',
  customerId: 'customer-a',
  status: 'ACTIVE',
  occurredAt: '2026-11-01T09:00:00Z',
  recordedAt: '2026-11-01T09:00:00Z',
  businessDate: '2026-11-01',
  net: '10.001',
  performers: [{ employeeId: 'employee-a', shareBps: 10000 }],
  ruleSnapshot: { kind: 'ZERO' },
  countsSnapshot: true,
  revision: 2,
};
const held = { ...original, period: '2026-11' };
const identityFields = ['businessId', 'sessionId', 'branchId', 'serviceId', 'customerId'] as const;

it.each(identityFields)(
  '#802 rejects a newer change to %s with the typed identity error',
  (field) => {
    const incoming = { ...original, revision: 3, [field]: `${field}-other` };
    // تغيير غلاف النشاط والجلسة مع البند يمنع فشل التحقق السابق من إخفاء عيب الهوية.
    expect(() =>
      validateCommissionLineEvent({
        companyId: 'company-a',
        businessId: incoming.businessId,
        sessionId: incoming.sessionId,
        lines: [incoming],
      }),
    ).not.toThrow();
    expect(() => selectNewerCommissionLines([incoming], [held])).toThrowError(
      new CommissionLineEventInvalidError('IDENTITY_CHANGED', original.lineId),
    );
  },
);

it.each(identityFields)(
  '#802 ignores equal/stale %s conflicts before identity comparison',
  (field) => {
    const incoming = [1, 2].map((revision) => ({
      ...original,
      revision,
      [field]: `${field}-other`,
    }));
    for (const line of incoming) {
      expect(selectNewerCommissionLines([line], [held])).toEqual([]);
    }
  },
);

it('#802 rejects a mixed batch rather than returning its earlier valid update', () => {
  const valid = { ...original, lineId: 'line-b', revision: 3, net: '20.000' };
  const invalid = { ...original, revision: 3, customerId: 'customer-other' };
  expect(() =>
    selectNewerCommissionLines([valid, invalid], [held, { ...held, lineId: 'line-b' }]),
  ).toThrowError(new CommissionLineEventInvalidError('IDENTITY_CHANGED', original.lineId));
});

it('#802 accepts unseen lines and mutable changes including legitimate month movement', () => {
  const newer: CommissionLineSnapshot = {
    ...original,
    revision: 3,
    businessDate: '2026-12-01',
    net: '20.001',
    occurredAt: '2026-12-01T09:00:00Z',
    recordedAt: '2026-12-02T09:00:00Z',
    status: 'CANCELLED',
    countsSnapshot: false,
    ruleSnapshot: { kind: 'PCT', value: 500 },
    performers: [{ employeeId: 'employee-b', shareBps: 10000 }],
  };
  const unseen = { ...original, lineId: 'line-new', revision: 1 };
  expect(selectNewerCommissionLines([newer, unseen], [held])).toEqual([newer, unseen]);
});
