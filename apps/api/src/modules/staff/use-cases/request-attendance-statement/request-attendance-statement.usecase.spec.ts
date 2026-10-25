import type { AttendanceStatementRequest } from '@pospay/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AttendanceStatementError } from '../../domain/errors.ts';
import {
  createStatementRequestFixture,
  inputsWithShift,
  type StatementRequestFixture,
} from './request-attendance-statement.fixture.ts';

let f: StatementRequestFixture;

beforeEach(() => {
  f = createStatementRequestFixture();
});

async function expectRefusal(
  input: Partial<AttendanceStatementRequest>,
  code: AttendanceStatementError['code'],
) {
  await expect(f.execute(input)).rejects.toMatchObject({ code });
}

describe('the admission refusals', () => {
  it('refuses a down renderer before hitting the limiter or writing anything', async () => {
    f.state.alive = false;
    await expectRefusal({}, 'RENDERER_UNAVAILABLE');
    expect(f.state.limitHits).toBe(0);
    expect(f.state.inserted).toEqual([]);
    expect(f.state.queued).toEqual([]);
  });

  it('refuses the 21st hit without inserting a request', async () => {
    f.state.limitHits = 20;
    await expectRefusal({}, 'RATE_LIMITED');
    expect(f.state.limitHits).toBe(21);
    expect(f.state.inserted).toEqual([]);
    expect(f.state.queued).toEqual([]);
  });

  it('reports a missing branch before an invalid period', async () => {
    f.state.branch = null;
    await expectRefusal({ from: '2026-10-24', to: '2026-10-23' }, 'BRANCH_NOT_FOUND');
    expect(f.state.inserted).toEqual([]);
  });

  it('refuses a shift on the employee form', async () => {
    await expectRefusal(
      {
        form: 'EMPLOYEE',
        employee_id: 'employee-1',
        shift: { start: '08:00', end: '09:30' },
      },
      'SHIFT_FILTER_INVALID',
    );
    expect(f.state.inserted).toEqual([]);
  });

  it('refuses an invalid period', async () => {
    await expectRefusal({ from: '2026-10-24', to: '2026-10-23' }, 'PERIOD_INVALID');
    expect(f.state.inserted).toEqual([]);
  });
});

describe('the employee eligibility', () => {
  it('refuses an employee with no inputs', async () => {
    f.state.inputs = null;
    await expectRefusal({ form: 'EMPLOYEE', employee_id: 'employee-1' }, 'EMPLOYEE_NOT_FOUND');
    expect(f.state.inserted).toEqual([]);
  });

  it('accepts an ended shift without a session or contract', async () => {
    await expect(f.execute({ form: 'EMPLOYEE', employee_id: 'employee-1' })).resolves.toEqual({
      render_id: 'render-1',
    });
    expect(f.state.inserted).toHaveLength(1);
    expect(f.state.queued).toHaveLength(1);
  });

  it('refuses a shift ending at 17:00 when asked at 10:00', async () => {
    f.state.inputs = inputsWithShift('17:00');
    await expectRefusal({ form: 'EMPLOYEE', employee_id: 'employee-1' }, 'EMPLOYEE_NOT_FOUND');
    expect(f.state.inserted).toEqual([]);
  });

  it('refuses a branch employee filter whose shift pair does not match', async () => {
    await expectRefusal(
      {
        employee_id: 'employee-1',
        shift: { start: '09:00', end: '20:00' },
      },
      'EMPLOYEE_NOT_FOUND',
    );
    expect(f.state.inserted).toEqual([]);
  });

  it('an upper-case employee id behaves like the lower case and the row stores it lower case', async () => {
    await expect(f.execute({ form: 'EMPLOYEE', employee_id: 'EMPLOYEE-1' })).resolves.toEqual({
      render_id: 'render-1',
    });
    expect(f.state.inserted[0]?.employeeId).toBe('employee-1');
  });
});

describe('the accepted request', () => {
  it('inserts a branch request with its logo and shift, then queues its filename', async () => {
    await expect(
      f.execute({ shift: { start: '08:00', end: '09:30' }, language: 'en' }),
    ).resolves.toEqual({ render_id: 'render-1' });
    expect(f.state.inserted).toEqual([
      {
        id: 'render-1',
        companyId: 'company-1',
        businessId: 'business-1',
        branchId: 'branch-1',
        form: 'BRANCH',
        employeeId: null,
        from: '2026-10-23',
        to: '2026-10-23',
        language: 'en',
        shift: { start: '08:00', end: '09:30' },
        logoFileId: 'logo-file-1',
        requestedBy: 'user-1',
        requestedAt: new Date('2026-10-23T07:00:00.000Z'),
      },
    ]);
    expect(f.state.queued).toEqual([
      {
        companyId: 'company-1',
        renderId: 'render-1',
        kind: 'attendance-statement',
        requestedBy: 'user-1',
        filename: 'attendance-statement-branch-2026-10-23_2026-10-23.pdf',
      },
    ]);
  });
});

describe('the enqueue failure', () => {
  it('keeps the request and marks the render failed when enqueueing fails', async () => {
    f.state.queueFails = true;
    await expectRefusal({}, 'RENDERER_UNAVAILABLE');
    expect(f.state.inserted).toHaveLength(1);
    expect(f.state.failed).toEqual(['company-1:render-1']);
    expect(f.state.queued).toEqual([]);
  });
});
