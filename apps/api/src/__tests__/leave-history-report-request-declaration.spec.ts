import { expect, it } from 'vitest';
import { AUTHENTICATED_WRITES } from '../modules/identity/index.ts';

it('declares LeaveHistoryReportJobsController.request in AUTHENTICATED_WRITES per PP-7.1', () => {
  const declaration = AUTHENTICATED_WRITES['LeaveHistoryReportJobsController.request'];
  expect(declaration).toBeDefined();
  expect(declaration?.access).toBe('RECORD_SCOPED');
  expect(declaration?.checkedIn).toContain('leave-history-report-request.transactions.ts#authorizeLeaveHistoryReportRequest');
});
