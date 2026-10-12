import { describe, expect, it } from 'vitest';
import { performerEligible, type PerformerEligibilityFacts } from '../performer-eligibility.ts';

const employee: PerformerEligibilityFacts = {
  hire_date: '2026-10-01',
  contract_end: '2026-10-31',
  deleted_at: null,
  attachments: [{ branch_id: 'branch', from: '2026-09-01', to: null }],
};

describe('performer employment eligibility', () => {
  it.each([
    ['before hire', '2026-09-30', false],
    ['hire day', '2026-10-01', true],
    ['after hire', '2026-10-02', true],
    ['before contract end', '2026-10-30', true],
    ['contract-end day', '2026-10-31', true],
    ['after contract end', '2026-11-01', false],
  ])('%s', (_label, date, eligible) => {
    expect(performerEligible(employee, 'branch', date)).toBe(eligible);
  });

  it('allows hire and contract end on the same day', () => {
    expect(performerEligible({ ...employee, contract_end: employee.hire_date }, 'branch', employee.hire_date)).toBe(true);
  });

  it('allows an open-ended contract', () => {
    expect(performerEligible({ ...employee, contract_end: null }, 'branch', '2030-01-01')).toBe(true);
  });

  it.each(['2026-09-30T00:00:00Z', '2026-10-15T00:00:00Z', '2026-11-01T00:00:00Z'])(
    'refuses a deleted employee even when deletion is later than the session: %s',
    (deleted_at) => {
      expect(performerEligible({ ...employee, deleted_at }, 'branch', '2026-10-15')).toBe(false);
    },
  );
});

describe('performer branch windows', () => {
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
    expect(performerEligible(linked, 'branch', date)).toBe(eligible);
  });

  it('refuses an employee with no link', () => {
    expect(performerEligible({ ...employee, attachments: [] }, 'branch', '2026-10-15')).toBe(false);
  });

  it('refuses a link for a different branch', () => {
    expect(performerEligible(employee, 'other', '2026-10-15')).toBe(false);
  });

  it('refuses an empty link window', () => {
    expect(performerEligible({ ...employee, attachments: [{ branch_id: 'branch', from: '2026-10-15', to: '2026-10-15' }] }, 'branch', '2026-10-15')).toBe(false);
  });

  it.each([
    ['first link only', '2026-10-01', true],
    ['gap after first link', '2026-10-10', false],
    ['gap before second link', '2026-10-14', false],
    ['second link start', '2026-10-15', true],
    ['second link open end', '2026-10-31', true],
  ])('multiple links: %s', (_label, date, eligible) => {
    const attachments = [
      { branch_id: 'branch', from: '2026-10-01', to: '2026-10-10' },
      { branch_id: 'branch', from: '2026-10-15', to: null },
      { branch_id: 'other', from: '2026-10-01', to: null },
    ];
    expect(performerEligible({ ...employee, attachments }, 'branch', date)).toBe(eligible);
    expect(performerEligible({ ...employee, attachments: [...attachments].reverse() }, 'branch', date)).toBe(eligible);
  });

  it('allows adjacent links on the shared boundary through the new link', () => {
    const attachments = [
      { branch_id: 'branch', from: '2026-10-01', to: '2026-10-15' },
      { branch_id: 'branch', from: '2026-10-15', to: '2026-10-20' },
    ];
    expect(performerEligible({ ...employee, attachments }, 'branch', '2026-10-15')).toBe(true);
  });

  it('requires employment and branch windows to both cover the date', () => {
    const attachments = [{ branch_id: 'branch', from: '2026-09-01', to: null }];
    expect(performerEligible({ ...employee, attachments }, 'branch', '2026-09-30')).toBe(false);
    expect(performerEligible({ ...employee, attachments }, 'branch', '2026-11-01')).toBe(false);
  });
});
