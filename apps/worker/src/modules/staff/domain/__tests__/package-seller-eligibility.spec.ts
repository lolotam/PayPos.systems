import { describe, expect, it } from 'vitest';
import { packageSellerEligible } from '../package-seller-eligibility.ts';

const employee = {
  hire_date: '2026-10-01',
  contract_end: '2026-10-31',
  deleted_at: null,
  attachments: [{ branch_id: 'branch', from: '2026-09-01', to: null }],
};

describe('package seller employment window', () => {
  it.each([
    ['before hire', '2026-09-30', false],
    ['hire day', '2026-10-01', true],
    ['after hire', '2026-10-02', true],
    ['before contract end', '2026-10-30', true],
    ['contract-end day', '2026-10-31', true],
    ['after contract end', '2026-11-01', false],
  ])('%s', (_label, date, eligible) => {
    expect(packageSellerEligible(employee, 'branch', date)).toBe(eligible);
  });

  it('allows an open-ended contract', () => {
    expect(
      packageSellerEligible({ ...employee, contract_end: null }, 'branch', '2030-01-01'),
    ).toBe(true);
  });

  it.each(['2026-09-30T00:00:00Z', '2026-10-15T00:00:00Z', '2026-11-01T00:00:00Z'])(
    'refuses a deleted seller even when the deletion is later than the sale day: %s',
    (deleted_at) => {
      expect(packageSellerEligible({ ...employee, deleted_at }, 'branch', '2026-10-15')).toBe(false);
    },
  );
});

describe('package seller branch attachment window', () => {
  const linked = {
    ...employee,
    attachments: [{ branch_id: 'branch', from: '2026-10-10', to: '2026-10-20' }],
  };

  it.each([
    ['before link start', '2026-10-09', false],
    ['link start', '2026-10-10', true],
    ['after link start', '2026-10-11', true],
    ['before link end', '2026-10-19', true],
    ['link end', '2026-10-20', false],
    ['after link end', '2026-10-21', false],
  ])('%s', (_label, date, eligible) => {
    expect(packageSellerEligible(linked, 'branch', date)).toBe(eligible);
  });

  it('keeps a link with no end open for every later day', () => {
    expect(packageSellerEligible({ ...employee, contract_end: null }, 'branch', '2030-01-01')).toBe(true);
  });

  it('refuses a seller with no link at all', () => {
    expect(packageSellerEligible({ ...employee, attachments: [] }, 'branch', '2026-10-15')).toBe(false);
  });

  it('refuses a link for another branch', () => {
    expect(packageSellerEligible(employee, 'other', '2026-10-15')).toBe(false);
  });

  it('requires employment and branch windows to both cover the day', () => {
    expect(
      packageSellerEligible({ ...employee, attachments: [{ branch_id: 'branch', from: '2026-09-01', to: null }] }, 'branch', '2026-09-30'),
    ).toBe(false);
    expect(
      packageSellerEligible({ ...employee, attachments: [{ branch_id: 'branch', from: '2026-09-01', to: null }] }, 'branch', '2026-11-01'),
    ).toBe(false);
  });
});
