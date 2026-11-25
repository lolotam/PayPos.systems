import { expect, it } from 'vitest';

import { countsAsPendingCommissionEvent } from '../domain/parked-commission-event.ts';

it('counts the six counted types of ADR-0012', () => {
  for (const eventType of [
    'ServiceSessionRecorded',
    'ServiceSessionLinesAdded',
    'ServiceLineChanged',
    'SessionTipsChanged',
    'SalaryChanged',
    'PackageSaleChanged',
  ]) {
    expect(countsAsPendingCommissionEvent(eventType)).toBe(true);
  }
});

it('counts no other type, and nothing at all', () => {
  for (const eventType of [
    'BusinessCreated',
    'CommissionPeriodRepairSaved',
    'CommissionEventParkedNoticeRequested',
    'sessiontipschanged',
    '',
  ]) {
    expect(countsAsPendingCommissionEvent(eventType)).toBe(false);
  }
});
